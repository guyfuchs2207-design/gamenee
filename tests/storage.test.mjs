import test from "node:test";
import assert from "node:assert/strict";

/** Minimal localStorage stand-in; `fail` makes every access throw, the way
 *  Safari private mode and blocked site-data do. */
function installStorage({ fail = false } = {}) {
  const map = new Map();
  globalThis.window = {
    localStorage: {
      getItem(k) { if (fail) throw new Error("denied"); return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { if (fail) throw new Error("denied"); map.set(k, String(v)); },
    },
  };
  return map;
}

installStorage();
const { loadStats, recordResult, loadProgress, saveProgress, resetEverything, emptyStats } =
  await import("../public/src/storage.js");

test("a fresh player starts at zero", () => {
  const s = loadStats();
  assert.equal(s.played, 0);
  assert.equal(s.currentStreak, 0);
  assert.deepEqual(s.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, fail: 0 });
});

test("consecutive wins build a streak and record the try count", () => {
  resetEverything();
  recordResult({ number: 10, won: true, tries: 3 });
  const s = recordResult({ number: 11, won: true, tries: 1 });
  assert.equal(s.played, 2);
  assert.equal(s.wins, 2);
  assert.equal(s.currentStreak, 2);
  assert.equal(s.maxStreak, 2);
  assert.equal(s.distribution[3], 1);
  assert.equal(s.distribution[1], 1);
});

test("a loss breaks the streak but keeps the record", () => {
  resetEverything();
  recordResult({ number: 1, won: true, tries: 2 });
  recordResult({ number: 2, won: true, tries: 2 });
  const s = recordResult({ number: 3, won: false, tries: 4 });
  assert.equal(s.currentStreak, 0);
  assert.equal(s.maxStreak, 2);
  assert.equal(s.distribution.fail, 1);
});

test("skipping a day resets the streak to one rather than continuing it", () => {
  resetEverything();
  recordResult({ number: 1, won: true, tries: 2 });
  const s = recordResult({ number: 5, won: true, tries: 2 });
  assert.equal(s.currentStreak, 1, "puzzle 5 does not follow puzzle 1");
  assert.equal(s.maxStreak, 1);
});

test("re-recording the same puzzle cannot inflate a streak", () => {
  resetEverything();
  recordResult({ number: 7, won: true, tries: 1 });
  const before = loadStats();
  recordResult({ number: 7, won: true, tries: 1 });
  recordResult({ number: 7, won: true, tries: 1 });
  const after = loadStats();
  assert.deepEqual(after, before, "a refresh on a finished board changes nothing");
});

test("progress only comes back for the day it was saved on", () => {
  saveProgress({ dateKey: "2026-09-17", number: 1, order: [1, 0, 2, 3, 4, 5], rows: [], status: "playing" });
  assert.equal(loadProgress("2026-09-17").number, 1);
  assert.equal(loadProgress("2026-09-18"), null, "yesterday's board must not leak into today");
});

test("stats survive a storage backend that throws on every call", async () => {
  // Re-import with a hostile storage so the module-level fallback is exercised.
  installStorage({ fail: true });
  const mod = await import(`../public/src/storage.js?hostile=${Date.now()}`);
  assert.doesNotThrow(() => mod.loadStats());
  const s = mod.recordResult({ number: 3, won: true, tries: 2 });
  assert.equal(s.wins, 1, "in-memory fallback still tracks the session");
  assert.equal(mod.loadStats().wins, 1);
});
