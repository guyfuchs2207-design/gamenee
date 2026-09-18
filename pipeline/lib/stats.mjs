/**
 * Statistics used to judge whether six rows make a good puzzle.
 * Pure functions, no I/O — all of this is unit tested.
 */

/** Ranks, 1-based, ties averaged. */
export function ranks(values) {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => b.v - a.v);
  const out = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[indexed[k].i] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation. Returns 0 when either series is constant. */
export function spearman(a, b) {
  if (a.length !== b.length || a.length < 2) return 0;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    const xa = ra[i] - ma;
    const xb = rb[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

/**
 * How surprising the ordering is, given how famous each item is.
 *
 * If fame predicts the ranking, everyone guesses right and the puzzle is dull.
 * rho = 1 (fame tracks the metric exactly) → 0. rho = -1 (the famous one is
 * the *smallest*) → 1. That inversion is the whole "sharks kill almost nobody"
 * effect, which is what makes a puzzle worth playing.
 */
export function surpriseScore(values, fames) {
  return (1 - spearman(values, fames)) / 2;
}

/**
 * The tightest gap between consecutive values, as a ratio.
 *
 * This is the load-bearing filter for an exact-placement game: two items a few
 * percent apart are a coin flip nobody can win, and a wrong flip costs two
 * points because swapping displaces both. Values must be sorted descending.
 */
export function minSeparation(sorted) {
  let min = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const hi = Math.abs(sorted[i - 1]);
    const lo = Math.abs(sorted[i]);
    if (hi === 0 && lo === 0) return 1; // identical values: no separation at all
    if (lo === 0) continue; // an infinite gap never constrains the minimum
    min = Math.min(min, hi / lo);
  }
  return min;
}

/** Orders of magnitude covered, top to bottom. */
export function spread(sorted) {
  const hi = Math.abs(sorted[0]);
  const lo = Math.abs(sorted[sorted.length - 1]);
  if (lo === 0 || hi === 0) return 0;
  return Math.log10(hi / lo);
}

/** Mulberry32 — same seed, same sequence, so a build is reproducible. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Bell curve centred on `target`, used to reward a difficulty band. */
export function gaussian(x, target, width) {
  const d = (x - target) / width;
  return Math.exp(-0.5 * d * d);
}

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
