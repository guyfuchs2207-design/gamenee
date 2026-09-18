import test from "node:test";
import assert from "node:assert/strict";
import { buildShareText, marksToRow } from "../public/src/share.js";
import { gradeOrder, scoreOrder } from "../public/src/engine.js";
import puzzles from "../data/puzzles.mjs";

const card = (order, number = 12) =>
  buildShareText({ number, marks: gradeOrder(order), score: scoreOrder(order), url: "" });

test("marks render as a single row of six squares", () => {
  assert.equal(marksToRow(gradeOrder([1, 0, 2, 3, 4, 5])), "⬜⬜🟩🟩🟩🟩");
  assert.equal(marksToRow(gradeOrder([0, 1, 2, 3, 4, 5])), "🟩🟩🟩🟩🟩🟩");
});

test("the card states the score out of six", () => {
  assert.match(card([1, 0, 2, 3, 4, 5]), /^Orders #12 — 4\/6 in place$/m);
});

test("a perfect order gets its own headline rather than 6/6", () => {
  const text = card([0, 1, 2, 3, 4, 5]);
  assert.match(text, /^Orders #12 — perfect order$/m);
  assert.ok(!text.includes("6/6"));
});

test("a shutout still produces a shareable card", () => {
  assert.match(card([5, 0, 1, 2, 3, 4]), /0\/6 in place/);
});

test("there is exactly one row of squares — this is a one-attempt game", () => {
  const rows = card([1, 0, 2, 3, 4, 5]).split("\n").filter((l) => /[🟩⬜]/.test(l));
  assert.equal(rows.length, 1);
  assert.equal([...rows[0]].length, 6);
});

test("the card never names an item, a metric or a value", () => {
  // The whole point is that posting a result spoils nothing for the next player.
  const puzzle = puzzles[0];
  const text = buildShareText({
    number: 1, marks: gradeOrder([0, 1, 2, 3, 4, 5]), score: 6, url: "https://orders.game",
  });
  for (const item of puzzle.items) {
    assert.ok(!text.includes(item.label), `leaked "${item.label}"`);
    assert.ok(!text.includes(item.value), `leaked "${item.value}"`);
  }
  assert.ok(!text.includes(puzzle.prompt), "leaked the prompt");
});

test("the link is included when set and omitted when not", () => {
  const marks = gradeOrder([0, 1, 2, 3, 4, 5]);
  assert.ok(buildShareText({ number: 1, marks, score: 6, url: "https://orders.game" }).endsWith("https://orders.game"));
  assert.ok(buildShareText({ number: 1, marks, score: 6, url: "" }).trim().endsWith("🟩"));
});
