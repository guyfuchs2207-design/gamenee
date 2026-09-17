/**
 * Stats backend client.
 *
 * Hard rule: the backend is an enhancement, never a dependency. Every call
 * resolves to null on any failure and the caller carries on with the local
 * puzzle pack. A dead API costs the player the percentile line, nothing else.
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
 * Today's puzzle, served fresh.
 *
 * Preferred over the bundled pack because the pack necessarily ships every
 * future answer to every visitor; the API hands out only the current day.
 * @returns {Promise<object|null>}
 */
export function fetchDaily(number) {
  return request(`/api/daily?n=${encodeURIComponent(number)}`);
}

/**
 * Report a finished round and get the day's distribution back.
 * @returns {Promise<{total:number, distribution:object, percentile:number}|null>}
 */
export function submitResult({ number, won, tries }) {
  return request("/api/result", {
    method: "POST",
    body: JSON.stringify({ number, won, tries }),
  });
}

/** Read the day's distribution without contributing to it. */
export function fetchStats(number) {
  return request(`/api/stats?n=${encodeURIComponent(number)}`);
}
