import test from "node:test";
import assert from "node:assert/strict";
import { summarise } from "../worker/src/index.js";

const dist = (o) => ({ 1: 0, 2: 0, 3: 0, 4: 0, fail: 0, ...o });

test("an empty day reports no players rather than dividing by zero", () => {
  const s = summarise(dist({}), { won: true, tries: 2 });
  assert.equal(s.total, 0);
  assert.equal(s.percentile, 0);
  assert.equal(s.solvedRate, 0);
});

test("percentile counts everyone who did strictly worse", () => {
  // 10 players: 1 solved in 1, 2 in 2, 3 in 3, 2 in 4, 2 failed.
  const d = dist({ 1: 1, 2: 2, 3: 3, 4: 2, fail: 2 });
  // Solving in 2 beats the 3s, the 4s and the failures: 3 + 2 + 2 = 7 of 10.
  assert.equal(summarise(d, { won: true, tries: 2 }).percentile, 70);
  // Solving in 1 beats everyone else: 9 of 10 — not 100, because a tie is not a win.
  assert.equal(summarise(d, { won: true, tries: 1 }).percentile, 90);
  // Solving on the last try beats only the failures.
  assert.equal(summarise(d, { won: true, tries: 4 }).percentile, 20);
});

test("a failure beats nobody", () => {
  const d = dist({ 1: 1, 2: 2, fail: 7 });
  assert.equal(summarise(d, { won: false, tries: 4 }).percentile, 0);
});

test("solved rate excludes failures and totals every bucket", () => {
  const s = summarise(dist({ 1: 2, 2: 3, 3: 1, fail: 4 }));
  assert.equal(s.total, 10);
  assert.equal(s.solvedRate, 0.6);
});

test("omitting an outcome still returns the distribution", () => {
  const s = summarise(dist({ 2: 5 }));
  assert.equal(s.total, 5);
  assert.equal(s.percentile, 0);
  assert.deepEqual(s.distribution, dist({ 2: 5 }));
});
