/**
 * localStorage persistence.
 *
 * Two stores, both keyed by puzzle number so the archive works the same way
 * today's puzzle does:
 *   plays  — finished attempts. One per puzzle, permanent, never overwritten.
 *   drafts — the arrangement in progress, so leaving the page mid-thought
 *            does not cost you your work.
 *
 * Every access is wrapped. Safari private mode, blocked site data and cleared
 * storage all make these throw or return null; losing a streak is annoying,
 * a blank screen is fatal, so failures degrade to in-memory.
 */

const KEY_PLAYS = "orders.plays.v1";
const KEY_DRAFTS = "orders.drafts.v1";

const memory = new Map();

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
  } catch {
    /* fall through to memory */
  }
  return memory.has(key) ? memory.get(key) : null;
}

function write(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* the in-memory copy is already saved */
  }
}

/** All finished attempts, keyed by puzzle number. */
export function loadPlays() {
  const stored = read(KEY_PLAYS);
  return stored && typeof stored === "object" ? stored : {};
}

export function getPlay(number) {
  return loadPlays()[number] ?? null;
}

/**
 * Record a finished attempt.
 *
 * A puzzle can only be played once. Re-submitting returns the original result
 * untouched, so replaying an archive entry cannot rewrite history or inflate
 * an average.
 */
export function recordPlay({ number, score, order }) {
  const plays = loadPlays();
  if (plays[number]) return plays[number];
  plays[number] = { score, order: order.slice(), at: Date.now() };
  write(KEY_PLAYS, plays);
  clearDraft(number);
  return plays[number];
}

export function loadDraft(number) {
  const drafts = read(KEY_DRAFTS);
  const order = drafts?.[number];
  return Array.isArray(order) ? order : null;
}

export function saveDraft(number, order) {
  const drafts = read(KEY_DRAFTS) || {};
  drafts[number] = order.slice();
  write(KEY_DRAFTS, drafts);
}

export function clearDraft(number) {
  const drafts = read(KEY_DRAFTS) || {};
  delete drafts[number];
  write(KEY_DRAFTS, drafts);
}

/**
 * Lifetime summary, derived from the plays rather than counted alongside them —
 * so it can never drift out of sync with the results it describes.
 *
 * The streak counts consecutive days played, ending at today. Today being
 * unplayed does not break it: the day is not over yet, so the walk starts at
 * yesterday instead.
 */
export function computeStats(todayNumber, plays = loadPlays()) {
  const numbers = Object.keys(plays).map(Number).filter(Number.isInteger);
  const scores = numbers.map((n) => plays[n].score);
  const played = numbers.length;
  const perfect = scores.filter((s) => s === 6).length;
  const average = played ? scores.reduce((a, b) => a + b, 0) / played : 0;
  const best = played ? Math.max(...scores) : 0;

  let streak = 0;
  let cursor = plays[todayNumber] ? todayNumber : todayNumber - 1;
  while (cursor >= 1 && plays[cursor]) {
    streak++;
    cursor--;
  }

  return { played, perfect, average, best, streak };
}

export function resetEverything() {
  write(KEY_PLAYS, {});
  write(KEY_DRAFTS, {});
}
