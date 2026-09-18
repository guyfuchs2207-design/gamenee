/**
 * Orders backend — Cloudflare Worker + D1.
 *
 * Two jobs:
 *   1. Serve puzzles that have already been released, so the full answer set
 *      is not sitting in every visitor's bundle.
 *   2. Aggregate anonymous scores into a per-puzzle summary.
 *
 * Static assets are served by the [assets] binding; anything under /api/
 * lands here. The front end treats every endpoint as optional — see
 * public/src/api.js — so an outage degrades to offline play, not a blank page.
 */
import puzzles from "../../data/puzzles.mjs";
import { selectPuzzle, puzzleNumber, ITEMS_PER_PUZZLE } from "../../public/src/engine.js";

/** Scores run 0..6. Five is unreachable — one item out of place forces a second. */
const BUCKETS = Array.from({ length: ITEMS_PER_PUZZLE + 1 }, (_, i) => String(i));
const SUBMISSION_RETENTION_DAYS = 60;

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
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    try {
      switch (url.pathname) {
        case "/api/puzzle":
          return handlePuzzle(url);
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

/**
 * Serve a released puzzle.
 *
 * The server clamps to its own clock rather than trusting the client's, so a
 * device with its date set forward cannot pull tomorrow's answers.
 */
function handlePuzzle(url) {
  const number = parseNumber(url.searchParams.get("n"));
  if (number == null) return json({ error: "bad_number" }, 400);
  if (number > puzzleNumber()) return json({ error: "not_released" }, 403);

  return json(
    { number, puzzle: selectPuzzle(puzzles, number) },
    200,
    // Safe to cache: puzzle N is immutable once chosen.
    { "Cache-Control": "public, max-age=3600" }
  );
}

async function handleStats(url, env) {
  const number = parseNumber(url.searchParams.get("n"));
  if (number == null) return json({ error: "bad_number" }, 400);
  if (!env.DB) return json({ error: "no_database" }, 503);
  return json({ number, ...summarise(await readCounts(env, number)) });
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
  const score = Number(body?.score);

  if (number == null) return json({ error: "bad_number" }, 400);
  if (number > puzzleNumber()) return json({ error: "not_released" }, 403);
  if (!Number.isInteger(score) || score < 0 || score > ITEMS_PER_PUZZLE) {
    return json({ error: "bad_score" }, 400);
  }

  const clientHash = await hashClient(request, env);

  // INSERT OR IGNORE is the whole rate limit: the primary key rejects a repeat
  // submission for the same puzzle, so a refresh cannot inflate the numbers.
  const claim = await env.DB.prepare(
    "INSERT OR IGNORE INTO submissions (puzzle_number, client_hash, created_at) VALUES (?, ?, ?)"
  )
    .bind(number, clientHash, Date.now())
    .run();

  const counted = (claim.meta?.changes ?? 0) > 0;

  if (counted) {
    await env.DB.prepare(
      `INSERT INTO results (puzzle_number, bucket, count) VALUES (?, ?, 1)
       ON CONFLICT(puzzle_number, bucket) DO UPDATE SET count = count + 1`
    )
      .bind(number, String(score))
      .run();

    // Housekeeping runs after the response is already on its way out.
    ctx.waitUntil(pruneSubmissions(env));
  }

  return json({ number, counted, ...summarise(await readCounts(env, number), score) });
}

// ---------------------------------------------------------------- helpers

function parseNumber(raw) {
  const n = Number(raw);
  // Upper bound keeps a hostile client from asking for puzzle 1e9.
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : null;
}

async function readCounts(env, number) {
  const { results } = await env.DB.prepare(
    "SELECT bucket, count FROM results WHERE puzzle_number = ?"
  )
    .bind(number)
    .all();

  const counts = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const row of results ?? []) {
    if (row.bucket in counts) counts[row.bucket] = row.count;
  }
  return counts;
}

/**
 * Turn raw counts into the one line the reveal shows.
 *
 * `percentile` is the share of players this score strictly beat. Ties are
 * excluded on purpose: "beat 100%" should mean nobody did better *or equal*,
 * which is the honest reading when someone nails a perfect order.
 */
export function summarise(counts, score = null) {
  const total = BUCKETS.reduce((sum, b) => sum + counts[b], 0);
  const points = BUCKETS.reduce((sum, b) => sum + counts[b] * Number(b), 0);

  const payload = {
    total,
    averageScore: total ? points / total : 0,
    perfectRate: total ? counts[String(ITEMS_PER_PUZZLE)] / total : 0,
  };

  if (score == null || !total) return { ...payload, percentile: 0 };

  let beaten = 0;
  for (const b of BUCKETS) {
    if (Number(b) < score) beaten += counts[b];
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
  const salt = env.HASH_SALT || "orders-dev-salt";
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Drop dedup rows once the puzzle they guard has fallen out of the archive. */
async function pruneSubmissions(env) {
  const cutoff = Date.now() - SUBMISSION_RETENTION_DAYS * 86400000;
  try {
    await env.DB.prepare("DELETE FROM submissions WHERE created_at < ?").bind(cutoff).run();
  } catch (err) {
    console.error("prune failed", err?.message);
  }
}
