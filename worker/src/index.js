/**
 * Rankle backend — Cloudflare Worker + D1.
 *
 * Two jobs:
 *   1. Serve exactly one day's puzzle, so the full answer set is not sitting
 *      in every visitor's bundle.
 *   2. Aggregate anonymous results into a daily distribution.
 *
 * Static assets are served by the [assets] binding; anything under /api/
 * lands here. The front end treats every endpoint as optional — see
 * public/src/api.js — so an outage degrades to offline play, not a blank page.
 */
import puzzles from "../../data/puzzles.mjs";
import { selectPuzzle, MAX_TRIES } from "../../public/src/engine.js";

const BUCKETS = ["1", "2", "3", "4", "fail"];
const SUBMISSION_RETENTION_DAYS = 30;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!url.pathname.startsWith("/api/")) {
      // Not an API route and not a static asset — let the platform 404 it.
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    try {
      switch (url.pathname) {
        case "/api/daily":
          return handleDaily(url);
        case "/api/stats":
          return handleStats(url, env);
        case "/api/result":
          return request.method === "POST"
            ? handleResult(request, env, ctx)
            : json({ error: "method_not_allowed" }, 405);
        default:
          return json({ error: "not_found" }, 404);
      }
    } catch (err) {
      console.error("unhandled", err?.stack || err);
      return json({ error: "internal" }, 500);
    }
  },
};

// ---------------------------------------------------------------- routes

/** Today's puzzle only. Asking for another number still returns that day's. */
function handleDaily(url) {
  const number = parseNumber(url.searchParams.get("n"));
  if (number == null) return json({ error: "bad_number" }, 400);
  const puzzle = selectPuzzle(puzzles, number);
  return json(
    { number, puzzle },
    200,
    // Safe to cache: puzzle N is immutable once chosen.
    { "Cache-Control": "public, max-age=3600" }
  );
}

async function handleStats(url, env) {
  const number = parseNumber(url.searchParams.get("n"));
  if (number == null) return json({ error: "bad_number" }, 400);
  if (!env.DB) return json({ error: "no_database" }, 503);
  const distribution = await readDistribution(env, number);
  return json({ number, ...summarise(distribution) });
}

async function handleResult(request, env, ctx) {
  if (!env.DB) return json({ error: "no_database" }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const number = parseNumber(body?.number);
  const won = body?.won === true;
  const tries = Number(body?.tries);

  if (number == null) return json({ error: "bad_number" }, 400);
  if (!Number.isInteger(tries) || tries < 1 || tries > MAX_TRIES) {
    return json({ error: "bad_tries" }, 400);
  }

  const bucket = won ? String(tries) : "fail";
  const clientHash = await hashClient(request, env);

  // INSERT OR IGNORE is the whole rate limit: the primary key rejects a repeat
  // submission for the same puzzle, so a refresh cannot inflate the numbers.
  const claim = await env.DB.prepare(
    "INSERT OR IGNORE INTO submissions (puzzle_number, client_hash, created_at) VALUES (?, ?, ?)"
  )
    .bind(number, clientHash, Date.now())
    .run();

  const isFirstSubmission = (claim.meta?.changes ?? 0) > 0;

  if (isFirstSubmission) {
    await env.DB.prepare(
      `INSERT INTO results (puzzle_number, bucket, count) VALUES (?, ?, 1)
       ON CONFLICT(puzzle_number, bucket) DO UPDATE SET count = count + 1`
    )
      .bind(number, bucket)
      .run();

    // Housekeeping runs after the response is already on its way out.
    ctx.waitUntil(pruneSubmissions(env));
  }

  const distribution = await readDistribution(env, number);
  return json({
    number,
    counted: isFirstSubmission,
    ...summarise(distribution, { won, tries }),
  });
}

// ---------------------------------------------------------------- helpers

function parseNumber(raw) {
  const n = Number(raw);
  // Upper bound keeps a hostile client from asking for puzzle 1e9.
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : null;
}

async function readDistribution(env, number) {
  const { results } = await env.DB.prepare(
    "SELECT bucket, count FROM results WHERE puzzle_number = ?"
  )
    .bind(number)
    .all();

  const dist = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const row of results ?? []) {
    if (row.bucket in dist) dist[row.bucket] = row.count;
  }
  return dist;
}

/**
 * Turn raw counts into what the sheet displays.
 *
 * `percentile` is the share of players this result strictly beat — fewer tries
 * beats more tries, and any win beats a failure. Ties are excluded on purpose:
 * "beat 100%" should mean nobody did better *or equal*, which is the honest
 * reading when a player solves it in one.
 */
export function summarise(distribution, outcome = null) {
  const total = BUCKETS.reduce((sum, b) => sum + distribution[b], 0);
  const solved = total - distribution.fail;
  const payload = {
    distribution,
    total,
    solvedRate: total ? solved / total : 0,
  };

  if (!outcome || !total) return { ...payload, percentile: 0 };

  let beaten = 0;
  if (outcome.won) {
    for (const b of ["1", "2", "3", "4"]) {
      if (Number(b) > outcome.tries) beaten += distribution[b];
    }
    beaten += distribution.fail;
  }
  return { ...payload, percentile: (beaten / total) * 100 };
}

/**
 * A salted, truncated hash of the caller's IP — enough to deduplicate
 * submissions for one puzzle, not enough to track anyone across days.
 * The salt lives in a secret; without it the space of IPs is small enough
 * to brute-force a stored digest back to an address.
 */
async function hashClient(request, env) {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  const salt = env.HASH_SALT || "rankle-dev-salt";
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Drop dedup rows once the puzzle they guard is long past. */
async function pruneSubmissions(env) {
  const cutoff = Date.now() - SUBMISSION_RETENTION_DAYS * 86400000;
  try {
    await env.DB.prepare("DELETE FROM submissions WHERE created_at < ?").bind(cutoff).run();
  } catch (err) {
    console.error("prune failed", err?.message);
  }
}
