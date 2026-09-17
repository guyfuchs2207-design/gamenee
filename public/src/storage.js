/**
 * localStorage persistence: today's in-progress board, and lifetime stats.
 *
 * Every access is wrapped — Safari private mode, blocked third-party storage
 * and cleared site data all make these throw or return null. Losing a streak
 * is annoying; a blank screen is fatal, so failures degrade to in-memory.
 */

const KEY_STATS = "rankle.stats.v1";
const KEY_PROGRESS = "rankle.progress.v1";

const memory = new Map(); // fallback when localStorage is unavailable

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
    /* in-memory copy is already saved */
  }
}

export function emptyStats() {
  return {
    played: 0,
    wins: 0,
    currentStreak: 0,
    maxStreak: 0,
    /** wins bucketed by try count, plus failures */
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, fail: 0 },
    /** puzzle number of the most recent recorded result — guards double-counting */
    lastNumber: null,
  };
}

export function loadStats() {
  const stored = read(KEY_STATS);
  if (!stored || typeof stored !== "object") return emptyStats();
  const base = emptyStats();
  return {
    ...base,
    ...stored,
    distribution: { ...base.distribution, ...(stored.distribution || {}) },
  };
}

/**
 * Fold a finished round into lifetime stats.
 *
 * Returns the updated stats. Recording the same puzzle number twice is a no-op,
 * so a page refresh on a finished board cannot inflate a streak.
 */
export function recordResult({ number, won, tries }) {
  const stats = loadStats();
  if (stats.lastNumber === number) return stats;

  stats.played += 1;
  if (won) {
    stats.wins += 1;
    // A streak survives only if yesterday's puzzle was the one before this.
    stats.currentStreak = stats.lastNumber === number - 1 ? stats.currentStreak + 1 : 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
    stats.distribution[tries] = (stats.distribution[tries] || 0) + 1;
  } else {
    stats.currentStreak = 0;
    stats.distribution.fail += 1;
  }
  stats.lastNumber = number;
  write(KEY_STATS, stats);
  return stats;
}

/** Today's board, so a refresh mid-round does not cost the player their guesses. */
export function loadProgress(dateKey) {
  const stored = read(KEY_PROGRESS);
  if (!stored || stored.dateKey !== dateKey) return null;
  return stored;
}

export function saveProgress(progress) {
  write(KEY_PROGRESS, progress);
}

export function clearProgress() {
  write(KEY_PROGRESS, null);
}

/** Exposed for the "reset" affordance in the stats panel. */
export function resetEverything() {
  write(KEY_STATS, emptyStats());
  write(KEY_PROGRESS, null);
}
