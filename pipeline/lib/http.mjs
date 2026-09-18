/**
 * HTTP with the manners public data sources expect: a real User-Agent, a
 * request floor so we never hammer an endpoint, bounded retries with backoff,
 * and a disk cache so re-running the pipeline costs nothing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const CACHE_DIR = path.resolve("pipeline/state/cache");

/**
 * Wikimedia's policy requires a descriptive UA with contact details; requests
 * without one get throttled or blocked outright. Set PIPELINE_CONTACT.
 */
const CONTACT = process.env.PIPELINE_CONTACT || "unset-contact@example.com";
export const USER_AGENT = `OrdersPuzzlePipeline/1.0 (${CONTACT})`;

let lastRequestAt = 0;
let gate = Promise.resolve();

/**
 * Space out request *starts* by at least minIntervalMs.
 *
 * Chained rather than a bare timestamp check: callers run concurrently, and a
 * read-then-write on a shared timestamp lets a burst all see the same stale
 * value and fire at once — exactly the behaviour that gets a client blocked.
 */
function throttle(minIntervalMs) {
  const next = gate.then(async () => {
    const wait = lastRequestAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  gate = next.catch(() => {});
  return next;
}

function cachePath(key) {
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
  return path.join(CACHE_DIR, `${hash}.json`);
}

async function readCache(key, maxAgeMs) {
  try {
    const raw = await fs.readFile(cachePath(key), "utf8");
    const entry = JSON.parse(raw);
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry.body;
  } catch {
    return null;
  }
}

async function writeCache(key, body) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(key), JSON.stringify({ at: Date.now(), body }));
}

/**
 * GET a URL and parse the response.
 *
 * @returns {Promise<{ok: true, body: any} | {ok: false, error: string}>}
 * Never throws — a dead source should skip one table, not abort the run.
 */
export async function get(url, {
  accept = "application/json",
  parse = "json",
  minIntervalMs = 250,
  maxAgeMs = 7 * 86400000,
  retries = 3,
  timeoutMs = 60000,
  cache = true,
} = {}) {
  const key = `${url}|${accept}`;
  if (cache) {
    const hit = await readCache(key, maxAgeMs);
    if (hit !== null) return { ok: true, body: hit, cached: true };
  }

  let lastError = "no attempt made";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 1s, 2s, 4s — enough to ride out a rate limit without stalling a run.
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
    await throttle(minIntervalMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept },
        signal: controller.signal,
      });

      // 4xx other than 429 will not improve on retry.
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        continue;
      }

      const body = parse === "text" ? await res.text() : await res.json();
      if (cache) await writeCache(key, body);
      return { ok: true, body };
    } catch (err) {
      lastError = err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(err?.message || err);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError };
}
