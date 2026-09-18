/**
 * Stage 3 — turn one ranked table into candidate six-item sets.
 *
 * Constraints, all of which exist because of how the game scores:
 *   fame floor   every item must be recognisable; the weakest sets difficulty
 *   separation   consecutive values must differ enough to be *knowable*
 *   spread       the set should cover a real range, not a narrow band
 *
 * Separation is the one that matters most. Under exact-placement scoring two
 * items a few percent apart are a coin flip, and losing the flip costs two
 * points because swapping displaces both.
 */
import { makeRng } from "./lib/stats.mjs";

export const DEFAULTS = {
  size: 6,
  minRatio: 1.35,
  fameFloor: 20000, // mean monthly enwiki pageviews
  attempts: 600,
  keepPerTable: 40,
};

/**
 * Walk down the sorted rows taking items that clear the separation ratio,
 * skipping some at random so repeated runs explore different sets.
 */
function buildChain(sorted, { size, minRatio, rng }) {
  if (sorted.length < size) return null;
  let i = Math.floor(rng() * Math.max(1, sorted.length - size));
  const chain = [sorted[i]];
  let last = sorted[i].value;

  for (i += 1; i < sorted.length && chain.length < size; i++) {
    const candidate = sorted[i];
    if (last / candidate.value < minRatio) continue;
    // Skip roughly half the eligible rows so the sampler does not always
    // return the same greedy chain from a given start.
    if (rng() < 0.45) continue;
    chain.push(candidate);
    last = candidate.value;
  }
  return chain.length === size ? chain : null;
}

/**
 * @returns {Array<Array<object>>} unique candidate sets, each sorted descending.
 */
export function sampleCandidates(rows, options = {}) {
  const { size, minRatio, fameFloor, attempts, keepPerTable } = { ...DEFAULTS, ...options };
  const rng = options.rng ?? makeRng(options.seed ?? 1);

  const eligible = rows
    // Ratio-based separation is only meaningful for positive quantities. Every
    // metric in the registry is one; a signed metric (temperature, latitude)
    // would need a different separation rule.
    .filter((r) => Number.isFinite(r.value) && r.value > 0 && (r.fame ?? 0) >= fameFloor)
    .sort((a, b) => b.value - a.value);

  const seen = new Set();
  const out = [];
  for (let attempt = 0; attempt < attempts && out.length < keepPerTable; attempt++) {
    const chain = buildChain(eligible, { size, minRatio, rng });
    if (!chain) continue;
    const key = chain.map((r) => r.key).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chain);
  }
  return out;
}
