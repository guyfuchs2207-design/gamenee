/**
 * Orders game engine — pure, DOM-free, deterministic.
 *
 * One puzzle a day, one attempt at it. An "order" is an array of item indices
 * into the puzzle's canonical `items` array, which is stored already sorted so
 * that index 0 is rank #1. The correct order is therefore always [0..5].
 *
 * Scoring is exact-position only: an item is either in its true slot or it is
 * not. There is no partial credit, and no feedback loop — you commit once and
 * the real order is revealed with the numbers behind it.
 */

export const ITEMS_PER_PUZZLE = 6;

/** How many days back the archive reaches, today included. */
export const ARCHIVE_DAYS = 7;

/**
 * The launch date — the local day that is puzzle #1.
 * Moving this shifts which puzzle every date maps to, so change it before
 * launch and not after.
 */
export const EPOCH = { year: 2026, month: 9, day: 12 };

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
 * Whole days from EPOCH to `date`, in the player's own timezone.
 *
 * Both endpoints are normalised to local noon before subtracting, so a
 * daylight-saving shift (which moves midnight by an hour) can never round the
 * difference to the wrong day.
 */
export function dayIndex(date = new Date(), epoch = EPOCH) {
  const start = new Date(epoch.year, epoch.month - 1, epoch.day, 12, 0, 0, 0);
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  return Math.floor((today - start) / 86400000);
}

/** 1-based puzzle number: what the player sees and what global stats bucket by. */
export function puzzleNumber(date = new Date(), epoch = EPOCH) {
  return dayIndex(date, epoch) + 1;
}

/** The local calendar date a given puzzle number belongs to. */
export function dateForNumber(number, epoch = EPOCH) {
  return new Date(epoch.year, epoch.month - 1, epoch.day + (number - 1), 12, 0, 0, 0);
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The archive: today's puzzle first, then back through the week.
 * Bounded at puzzle #1, so a freshly launched game shows only what exists
 * rather than offering days that never happened.
 */
export function archiveNumbers(todayNumber, span = ARCHIVE_DAYS) {
  const count = Math.max(0, Math.min(span, todayNumber));
  return Array.from({ length: count }, (_, i) => todayNumber - i);
}

/** True when a number is a real, already-released puzzle. */
export function isPlayable(number, todayNumber) {
  return Number.isInteger(number) && number >= 1 && number <= todayNumber;
}

/**
 * Pick a puzzle. The library cycles once exhausted, but each lap is
 * re-shuffled so the sequence does not visibly repeat.
 */
export function selectPuzzle(puzzles, number) {
  const n = puzzles.length;
  if (n === 0) throw new Error("puzzle library is empty");
  const index = number - 1;
  const lap = Math.floor(index / n);
  const within = ((index % n) + n) % n;
  if (lap === 0) return puzzles[within];

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
 * Re-rolled until no item sits in its correct slot. With a single attempt, a
 * free correct placement in the opening deal would be an outright gift.
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
  return Array.from({ length: size }, (_, i) => (i + 1) % size);
}

/**
 * Grade a submitted order.
 * @returns {boolean[]} one flag per slot — true when that item is exactly right.
 */
export function gradeOrder(order, size = ITEMS_PER_PUZZLE) {
  if (!Array.isArray(order) || order.length !== size) {
    throw new Error(`expected an order of ${size} items, got ${order?.length}`);
  }
  return order.map((item, slot) => item === slot);
}

/** How many items landed in their true position, 0 to 6. */
export function scoreOrder(order, size = ITEMS_PER_PUZZLE) {
  return gradeOrder(order, size).filter(Boolean).length;
}

/** A perfect order. Note 5/6 is impossible — one item out forces a second. */
export function isPerfect(score, size = ITEMS_PER_PUZZLE) {
  return score === size;
}

/**
 * Where the player put each item, indexed by the item's true rank.
 * Drives the reveal, which shows the real order against what was submitted.
 */
export function placementsByTrueRank(order, size = ITEMS_PER_PUZZLE) {
  const placed = new Array(size).fill(-1);
  order.forEach((item, slot) => {
    if (item >= 0 && item < size) placed[item] = slot;
  });
  return placed;
}
