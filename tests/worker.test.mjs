import test from "node:test";
import assert from "node:assert/strict";
import { summarise } from "../worker/src/index.js";

/** Scores run 0..6; 5 is unreachable, so it stays zero throughout. */
const counts = (o) => ({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, ...o });

test("an empty puzzle reports nothing rather than dividing by zero", () => {
  const s = summarise(counts({}), 4);
  assert.equal(s.total, 0);
  assert.equal(s.averageScore, 0);
  assert.equal(s.perfectRate, 0);
  assert.equal(s.percentile, 0);
});

test("the average is the mean score across every player", () => {
  // 10 players: four scored 0, four scored 3, two scored 6 → 24/10.
  const s = summarise(counts({ 0: 4, 3: 4, 6: 2 }));
  assert.equal(s.total, 10);
  assert.equal(s.averageScore, 2.4);
  assert.equal(s.perfectRate, 0.2);
});

test("percentile counts everyone who scored strictly lower", () => {
  const c = counts({ 0: 2, 1: 1, 2: 2, 3: 2, 4: 2, 6: 1 });
  assert.equal(summarise(c, 0).percentile, 0, "the floor beats nobody");
  assert.equal(summarise(c, 2).percentile, 30, "beats the 0s and the 1s");
  assert.equal(summarise(c, 6).percentile, 90, "a tie is not a win, so not 100");
});

test("omitting a score returns the aggregate without a percentile", () => {
  const s = summarise(counts({ 4: 5 }));
  assert.equal(s.total, 5);
  assert.equal(s.averageScore, 4);
  assert.equal(s.percentile, 0);
});
