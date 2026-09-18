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
const {
  loadPlays, getPlay, recordPlay, loadDraft, saveDraft, clearDraft,
  computeStats, resetEverything,
} = await import("../public/src/storage.js");

test("a fresh player has no plays and an empty record", () => {
  resetEverything();
  assert.deepEqual(loadPlays(), {});
  const s = computeStats(7);
  assert.equal(s.played, 0);
  assert.equal(s.average, 0);
  assert.equal(s.streak, 0);
});

test("a play is recorded once and is then immutable", () => {
  resetEverything();
  const first = recordPlay({ number: 5, score: 4, order: [1, 0, 2, 3, 4, 5] });
  assert.equal(first.score, 4);
  // Replaying an archive entry must not rewrite history or inflate an average.
  const again = recordPlay({ number: 5, score: 6, order: [0, 1, 2, 3, 4, 5] });
  assert.equal(again.score, 4, "the original result stands");
  assert.equal(getPlay(5).score, 4);
});

test("the stored order is a copy, not a live reference", () => {
  resetEverything();
  const order = [1, 0, 2, 3, 4, 5];
  recordPlay({ number: 2, score: 4, order });
  order[0] = 99; // mutate the caller's array afterwards
  assert.deepEqual(getPlay(2).order, [1, 0, 2, 3, 4, 5]);
});

test("the record averages across every play", () => {
  resetEverything();
  recordPlay({ number: 1, score: 6, order: [0, 1, 2, 3, 4, 5] });
  recordPlay({ number: 2, score: 2, order: [0, 1, 3, 2, 5, 4] });
  recordPlay({ number: 3, score: 4, order: [1, 0, 2, 3, 4, 5] });
  const s = computeStats(3);
  assert.equal(s.played, 3);
  assert.equal(s.average, 4);
  assert.equal(s.best, 6);
  assert.equal(s.perfect, 1);
});

test("the day streak counts consecutive days up to today", () => {
  resetEverything();
  for (const n of [5, 6, 7]) recordPlay({ number: n, score: 3, order: [1, 0, 2, 3, 4, 5] });
  assert.equal(computeStats(7).streak, 3);
});

test("an unplayed today does not break the streak — the day is not over", () => {
  resetEverything();
  for (const n of [5, 6]) recordPlay({ number: n, score: 3, order: [1, 0, 2, 3, 4, 5] });
  assert.equal(computeStats(7).streak, 2, "yesterday still anchors it");
  assert.equal(computeStats(8).streak, 0, "but skipping a whole day does break it");
});

test("a gap breaks the streak without erasing the plays", () => {
  resetEverything();
  for (const n of [1, 2, 3, 6, 7]) recordPlay({ number: n, score: 3, order: [1, 0, 2, 3, 4, 5] });
  const s = computeStats(7);
  assert.equal(s.streak, 2, "only 6 and 7 are consecutive");
  assert.equal(s.played, 5);
});

test("drafts are kept per puzzle and cleared once it is played", () => {
  resetEverything();
  saveDraft(4, [2, 1, 0, 3, 4, 5]);
  saveDraft(9, [5, 4, 3, 2, 1, 0]);
  assert.deepEqual(loadDraft(4), [2, 1, 0, 3, 4, 5]);
  assert.deepEqual(loadDraft(9), [5, 4, 3, 2, 1, 0]);
  assert.equal(loadDraft(3), null, "an untouched puzzle has no draft");

  recordPlay({ number: 4, score: 0, order: [2, 1, 0, 3, 4, 5] });
  assert.equal(loadDraft(4), null, "playing clears the draft");
  assert.deepEqual(loadDraft(9), [5, 4, 3, 2, 1, 0], "other drafts survive");

  clearDraft(9);
  assert.equal(loadDraft(9), null);
});

test("the record survives a storage backend that throws on every call", async () => {
  installStorage({ fail: true });
  const mod = await import(`../public/src/storage.js?hostile=${Date.now()}`);
  assert.doesNotThrow(() => mod.loadPlays());
  mod.recordPlay({ number: 3, score: 6, order: [0, 1, 2, 3, 4, 5] });
  assert.equal(mod.computeStats(3).played, 1, "in-memory fallback still tracks the session");
});
