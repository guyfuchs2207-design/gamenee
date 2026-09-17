/**
 * Rankle game engine — pure, DOM-free, deterministic.
 *
 * An "order" is an array of item indices into the puzzle's canonical
 * `items` array, which is stored already sorted so that index 0 is rank #1.
 * The solved order is therefore always [0, 1, 2, 3, 4, 5].
 */

export const MAX_TRIES = 4;
export const ITEMS_PER_PUZZLE = 6;

/** Per-slot feedback tiers. */
export const EXACT = 2; // right item, right place
export const NEAR = 1; // off by exactly one place
export const FAR = 0; // off by two or more

/** The launch date. Puzzle #1 is the local day this lands on. */
export const EPOCH = { year: 2026, month: 9, day: 17 };

/** Small fast seeded PRNG (mulberry32) — same seed, same sequence, everywhere. */
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

/**
 * Number of whole days from EPOCH to `date`, in the player's own timezone.
 *
 * Both endpoints are normalised to local noon before subtracting so that a
 * daylight-saving shift (which moves midnight by an hour) can never round the
 * difference to the wrong day.
 */
export function dayIndex(date = new Date(), epoch = EPOCH) {
  const start = new Date(epoch.year, epoch.month - 1, epoch.day, 12, 0, 0, 0);
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  return Math.floor((today - start) / 86400000);
}

/** 1-based puzzle number shown to the player and used to bucket global stats. */
export function puzzleNumber(date = new Date(), epoch = EPOCH) {
  return dayIndex(date, epoch) + 1;
}

/** Local calendar date as YYYY-MM-DD — the key a day's saved progress hangs on. */
export function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Pick the day's puzzle. The library cycles once exhausted, but each lap is
 * re-shuffled so the sequence does not visibly repeat.
 */
export function selectPuzzle(puzzles, number) {
  const n = puzzles.length;
  if (n === 0) throw new Error("puzzle library is empty");
  const index = number - 1;
  const lap = Math.floor(index / n);
  const within = ((index % n) + n) % n;
  if (lap === 0) return puzzles[within];

  // Fisher-Yates over the index space, seeded by the lap number.
  const rng = makeRng(0x9e3779b9 ^ (lap * 2654435761));
  const order = puzzles.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return puzzles[order[within]];
}

/**
 * The starting arrangement every player sees, derived from the puzzle number
 * so it is identical worldwide.
 *
 * Re-rolled until no item sits in its correct slot: opening on a free 🟩 (or,
 * worse, on the solution) would hand out information nobody earned.
 */
export function openingOrder(number, size = ITEMS_PER_PUZZLE) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const rng = makeRng((number * 0x85ebca6b) ^ (attempt * 0xc2b2ae35));
    const order = Array.from({ length: size }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (order.every((item, slot) => item !== slot)) return order;
  }
  // Unreachable in practice; a rotation is a guaranteed derangement.
  return Array.from({ length: size }, (_, i) => (i + 1) % size);
}

/**
 * Grade one submitted order.
 * @returns {number[]} one tier per slot, aligned to the submitted order.
 */
export function gradeGuess(order, size = ITEMS_PER_PUZZLE) {
  if (!Array.isArray(order) || order.length !== size) {
    throw new Error(`expected an order of ${size} items, got ${order?.length}`);
  }
  return order.map((item, slot) => {
    const delta = Math.abs(item - slot);
    if (delta === 0) return EXACT;
    if (delta === 1) return NEAR;
    return FAR;
  });
}

/** True when every slot is EXACT. */
export function isSolved(marks) {
  return marks.length > 0 && marks.every((m) => m === EXACT);
}

/** How many slots are exactly right — used for the "4/6 in place" readout. */
export function exactCount(marks) {
  return marks.filter((m) => m === EXACT).length;
}

/** Terminal state check for a list of graded rows. */
export function isGameOver(rows, maxTries = MAX_TRIES) {
  if (rows.length === 0) return false;
  return isSolved(rows[rows.length - 1].marks) || rows.length >= maxTries;
}

export function didWin(rows) {
  return rows.length > 0 && isSolved(rows[rows.length - 1].marks);
}
