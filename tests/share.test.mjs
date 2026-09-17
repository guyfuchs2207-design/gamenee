import test from "node:test";
import assert from "node:assert/strict";
import { buildShareText, marksToRow } from "../public/src/share.js";
import { gradeGuess, MAX_TRIES } from "../public/src/engine.js";
import puzzles from "../data/puzzles.mjs";

const row = (order) => ({ order, marks: gradeGuess(order) });

test("marks render as squares, with a dark-mode variant for the misses", () => {
  const marks = gradeGuess([1, 0, 5, 3, 4, 2]);
  assert.equal(marksToRow(marks), "🟨🟨⬜🟩🟩⬜");
  assert.equal(marksToRow(marks, true), "🟨🟨⬛🟩🟩⬛");
});

test("a win is scored out of the try limit", () => {
  const text = buildShareText({
    number: 12,
    rows: [row([1, 0, 2, 3, 4, 5]), row([0, 1, 2, 3, 4, 5])],
    won: true,
  });
  assert.match(text, /^Rankle #12 2\/4$/m);
  assert.match(text, /🟩🟩🟩🟩🟩🟩/);
});

test("a loss is scored X out of the try limit", () => {
  const rows = Array.from({ length: MAX_TRIES }, () => row([5, 4, 3, 2, 1, 0]));
  assert.match(buildShareText({ number: 3, rows, won: false }), /^Rankle #3 X\/4$/m);
});

test("the share card never names an item, a metric or a value", () => {
  // The whole point of the grid is that it spoils nothing for the next player.
  const puzzle = puzzles[0];
  const text = buildShareText({
    number: 1,
    rows: [row([0, 1, 2, 3, 4, 5])],
    won: true,
    url: "https://rankle.gg",
  });
  for (const item of puzzle.items) {
    assert.ok(!text.includes(item.label), `leaked "${item.label}"`);
    assert.ok(!text.includes(item.value), `leaked "${item.value}"`);
  }
  assert.ok(!text.includes(puzzle.prompt), "leaked the prompt");
});

test("the link is included when set and omitted when not", () => {
  const rows = [row([0, 1, 2, 3, 4, 5])];
  assert.ok(buildShareText({ number: 1, rows, won: true, url: "https://rankle.gg" }).endsWith("https://rankle.gg"));
  assert.ok(buildShareText({ number: 1, rows, won: true, url: "" }).trim().endsWith("🟩"));
});

test("every grid row is exactly six squares", () => {
  const rows = [row([2, 1, 0, 5, 4, 3]), row([0, 1, 2, 3, 4, 5])];
  const text = buildShareText({ number: 9, rows, won: true });
  for (const line of text.split("\n").filter((l) => /[🟩🟨⬜⬛]/.test(l))) {
    assert.equal([...line].length, 6, `"${line}" is not six squares`);
  }
});
