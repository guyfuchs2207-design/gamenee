import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TRIES, EXACT, NEAR, FAR,
  gradeGuess, isSolved, exactCount, isGameOver, didWin,
  openingOrder, selectPuzzle, dayIndex, puzzleNumber, localDateKey, makeRng,
} from "../public/src/engine.js";
import puzzles from "../data/puzzles.mjs";

test("a perfect order grades all EXACT and counts as solved", () => {
  const marks = gradeGuess([0, 1, 2, 3, 4, 5]);
  assert.deepEqual(marks, [EXACT, EXACT, EXACT, EXACT, EXACT, EXACT]);
  assert.equal(isSolved(marks), true);
  assert.equal(exactCount(marks), 6);
});

test("an item one place from home is NEAR, two or more is FAR", () => {
  // item 1 sits in slot 0 (off by one), item 0 in slot 1 (off by one),
  // item 5 in slot 2 (off by three), item 2 in slot 5 (off by three).
  assert.deepEqual(
    gradeGuess([1, 0, 5, 3, 4, 2]),
    [NEAR, NEAR, FAR, EXACT, EXACT, FAR]
  );
});

test("a full reversal leaves only the two middle items near home", () => {
  assert.deepEqual(gradeGuess([5, 4, 3, 2, 1, 0]), [FAR, FAR, NEAR, NEAR, FAR, FAR]);
});

test("isSolved rejects an empty board rather than treating it as a win", () => {
  assert.equal(isSolved([]), false);
});

test("gradeGuess refuses a malformed order instead of scoring it", () => {
  assert.throws(() => gradeGuess([0, 1, 2]), /expected an order of 6/);
  assert.throws(() => gradeGuess(null), /expected an order of 6/);
});

test("the round ends on a win or on the last try, not before", () => {
  const solved = { marks: gradeGuess([0, 1, 2, 3, 4, 5]) };
  const miss = { marks: gradeGuess([1, 0, 2, 3, 4, 5]) };
  assert.equal(isGameOver([]), false);
  assert.equal(isGameOver([miss]), false);
  assert.equal(isGameOver([miss, solved]), true);
  assert.equal(didWin([miss, solved]), true);
  assert.equal(isGameOver(Array(MAX_TRIES).fill(miss)), true);
  assert.equal(didWin(Array(MAX_TRIES).fill(miss)), false);
});

test("the opening order never gives away a correct slot", () => {
  // A free green on load would be information the player did not earn.
  for (let n = 1; n <= 500; n++) {
    const order = openingOrder(n);
    assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], `#${n} is a permutation`);
    assert.ok(order.every((item, slot) => item !== slot), `#${n} is a derangement`);
    assert.equal(exactCount(gradeGuess(order)), 0, `#${n} opens with zero exact`);
  }
});

test("the opening order is identical for every player on the same day", () => {
  assert.deepEqual(openingOrder(42), openingOrder(42));
  assert.notDeepEqual(openingOrder(42), openingOrder(43));
});

test("the first lap walks the library in order, then re-shuffles", () => {
  for (let i = 0; i < puzzles.length; i++) {
    assert.equal(selectPuzzle(puzzles, i + 1).id, puzzles[i].id);
  }
  const lapOne = puzzles.map((_, i) => selectPuzzle(puzzles, i + 1).id);
  const lapTwo = puzzles.map((_, i) => selectPuzzle(puzzles, puzzles.length + i + 1).id);
  assert.notDeepEqual(lapOne, lapTwo, "a second lap must not repeat the first order");
  assert.deepEqual([...lapTwo].sort((a, b) => a - b), [...lapOne].sort((a, b) => a - b),
    "every puzzle still appears exactly once per lap");
});

test("selecting is deterministic and never runs dry", () => {
  for (const n of [1, 60, 61, 500, 5000]) {
    assert.equal(selectPuzzle(puzzles, n).id, selectPuzzle(puzzles, n).id);
    assert.ok(selectPuzzle(puzzles, n).items.length === 6);
  }
});

test("an empty library is an error, not a crash deep in the renderer", () => {
  assert.throws(() => selectPuzzle([], 1), /empty/);
});

test("the day index advances by exactly one per calendar day", () => {
  const epoch = { year: 2026, month: 9, day: 17 };
  assert.equal(dayIndex(new Date(2026, 8, 17, 0, 0, 1), epoch), 0);
  assert.equal(dayIndex(new Date(2026, 8, 17, 23, 59, 59), epoch), 0);
  assert.equal(dayIndex(new Date(2026, 8, 18, 0, 0, 1), epoch), 1);
  assert.equal(puzzleNumber(new Date(2026, 8, 17, 9), epoch), 1);
});

test("a daylight-saving shift does not skip or repeat a puzzle", () => {
  // Both US and EU clock changes fall in these windows; normalising to local
  // noon is what keeps the 23- and 25-hour days a single step apart.
  const epoch = { year: 2026, month: 3, day: 1 };
  for (const [a, b] of [[new Date(2026, 2, 7), new Date(2026, 2, 8)],
                        [new Date(2026, 2, 8), new Date(2026, 2, 9)],
                        [new Date(2026, 9, 24), new Date(2026, 9, 25)],
                        [new Date(2026, 9, 25), new Date(2026, 9, 26)]]) {
    assert.equal(dayIndex(b, epoch) - dayIndex(a, epoch), 1,
      `${a.toDateString()} → ${b.toDateString()}`);
  }
});

test("the date key is the local calendar date, zero-padded", () => {
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
  assert.equal(localDateKey(new Date(2026, 11, 31, 0, 30)), "2026-12-31");
});

test("the seeded generator is reproducible and stays in range", () => {
  const a = makeRng(7), b = makeRng(7);
  for (let i = 0; i < 200; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});
