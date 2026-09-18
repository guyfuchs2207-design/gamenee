/**
 * Stats backend client.
 *
 * Hard rule: the backend is an enhancement, never a dependency. Every call
 * resolves to null on any failure and the caller carries on with the local
 * puzzle pack. A dead API costs the player one line of context, nothing else.
 */
import { API_BASE, API_TIMEOUT_MS } from "./config.js";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch one puzzle by number.
 *
 * Preferred over the bundled pack because the pack necessarily ships every
 * future answer to every visitor; the API only serves puzzles already released.
 */
export function fetchPuzzle(number) {
  return request(`/api/puzzle?n=${encodeURIComponent(number)}`);
}

/**
 * Report a finished attempt and get the day's aggregate back.
 * @returns {Promise<{total:number, averageScore:number, perfectRate:number, percentile:number}|null>}
 */
export function submitScore({ number, score }) {
  return request("/api/result", {
    method: "POST",
    body: JSON.stringify({ number, score }),
  });
}

/** Read a puzzle's aggregate without contributing to it. */
export function fetchStats(number) {
  return request(`/api/stats?n=${encodeURIComponent(number)}`);
}
