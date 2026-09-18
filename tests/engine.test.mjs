import test from "node:test";
import assert from "node:assert/strict";
import {
  ITEMS_PER_PUZZLE, ARCHIVE_DAYS,
  gradeOrder, scoreOrder, isPerfect, placementsByTrueRank,
  openingOrder, selectPuzzle, archiveNumbers, isPlayable,
  dayIndex, puzzleNumber, dateForNumber, localDateKey, makeRng,
} from "../public/src/engine.js";
import puzzles from "../data/puzzles.mjs";

test("the correct order scores six out of six", () => {
  const marks = gradeOrder([0, 1, 2, 3, 4, 5]);
  assert.deepEqual(marks, [true, true, true, true, true, true]);
  assert.equal(scoreOrder([0, 1, 2, 3, 4, 5]), 6);
  assert.equal(isPerfect(6), true);
});

test("scoring is exact-position only — being one place out earns nothing", () => {
  // Every item shifted by one: a sensible ordering, but zero items are home.
  assert.equal(scoreOrder([5, 0, 1, 2, 3, 4]), 0);
  // Swapping a single adjacent pair costs both of them, and only them.
  assert.deepEqual(gradeOrder([1, 0, 2, 3, 4, 5]), [false, false, true, true, true, true]);
  assert.equal(scoreOrder([1, 0, 2, 3, 4, 5]), 4);
});

test("a score of five is unreachable", () => {
  // One item out of place necessarily displaces a second, so 5/6 cannot occur.
  // Worth pinning: the copy and the stats both assume it.
  const seen = new Set();
  const permute = (rest, acc = []) => {
    if (!rest.length) return seen.add(scoreOrder(acc));
    rest.forEach((x, i) => permute(rest.filter((_, j) => j !== i), [...acc, x]));
  };
  permute([0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 6]);
});

test("gradeOrder refuses a malformed order instead of scoring it", () => {
  assert.throws(() => gradeOrder([0, 1, 2]), /expected an order of 6/);
  assert.throws(() => gradeOrder(null), /expected an order of 6/);
});

test("placements map each true rank to where the player actually put it", () => {
  // Submitted [2,1,0,4,5,3]: item 0 sat in slot 2, item 1 in slot 1, and so on.
  assert.deepEqual(placementsByTrueRank([2, 1, 0, 4, 5, 3]), [2, 1, 0, 5, 3, 4]);
  assert.deepEqual(placementsByTrueRank([0, 1, 2, 3, 4, 5]), [0, 1, 2, 3, 4, 5]);
});

test("the opening deal never places an item correctly", () => {
  // With a single attempt, a free correct slot on load would be an outright gift.
  for (let n = 1; n <= 500; n++) {
    const order = openingOrder(n);
    assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], `#${n} is a permutation`);
    assert.equal(scoreOrder(order), 0, `#${n} opens on zero`);
  }
});

test("the opening deal is the same for every player on a given puzzle", () => {
  assert.deepEqual(openingOrder(42), openingOrder(42));
  assert.notDeepEqual(openingOrder(42), openingOrder(43));
});

test("the archive runs backwards from today and stops at puzzle one", () => {
  assert.deepEqual(archiveNumbers(7), [7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(archiveNumbers(30), [30, 29, 28, 27, 26, 25, 24]);
  assert.equal(archiveNumbers(30).length, ARCHIVE_DAYS);
  // A freshly launched game must not offer days that never happened.
  assert.deepEqual(archiveNumbers(3), [3, 2, 1]);
  assert.deepEqual(archiveNumbers(1), [1]);
  assert.deepEqual(archiveNumbers(0), []);
});

test("only released puzzles are playable", () => {
  assert.equal(isPlayable(5, 7), true);
  assert.equal(isPlayable(7, 7), true);
  assert.equal(isPlayable(8, 7), false, "tomorrow is not playable");
  assert.equal(isPlayable(0, 7), false);
  assert.equal(isPlayable(-3, 7), false);
  assert.equal(isPlayable(2.5, 7), false);
  assert.equal(isPlayable(NaN, 7), false);
});

test("puzzle numbers and dates are inverses of each other", () => {
  const epoch = { year: 2026, month: 9, day: 12 };
  for (const n of [1, 2, 7, 40, 365]) {
    assert.equal(puzzleNumber(dateForNumber(n, epoch), epoch), n);
  }
  assert.equal(localDateKey(dateForNumber(1, epoch)), "2026-09-12");
  assert.equal(localDateKey(dateForNumber(7, epoch)), "2026-09-18");
});

test("the day index advances by exactly one per calendar day", () => {
  const epoch = { year: 2026, month: 9, day: 12 };
  assert.equal(dayIndex(new Date(2026, 8, 12, 0, 0, 1), epoch), 0);
  assert.equal(dayIndex(new Date(2026, 8, 12, 23, 59, 59), epoch), 0);
  assert.equal(dayIndex(new Date(2026, 8, 13, 0, 0, 1), epoch), 1);
});

test("a daylight-saving shift does not skip or repeat a puzzle", () => {
  // Both US and EU clock changes fall in these windows; normalising to local
  // noon is what keeps the 23- and 25-hour days a single step apart.
  const epoch = { year: 2026, month: 3, day: 1 };
  for (const [a, b] of [[new Date(2026, 2, 7), new Date(2026, 2, 8)],
                        [new Date(2026, 2, 8), new Date(2026, 2, 9)],
                        [new Date(2026, 9, 24), new Date(2026, 9, 25)],
                        [new Date(2026, 9, 25), new Date(2026, 9, 26)]]) {
    assert.equal(dayIndex(b, epoch) - dayIndex(a, epoch), 1, `${a.toDateString()} → ${b.toDateString()}`);
  }
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
    assert.equal(selectPuzzle(puzzles, n).items.length, ITEMS_PER_PUZZLE);
  }
  assert.throws(() => selectPuzzle([], 1), /empty/);
});

test("the seeded generator is reproducible and stays in range", () => {
  const a = makeRng(7), b = makeRng(7);
  for (let i = 0; i < 200; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});
