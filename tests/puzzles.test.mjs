import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import puzzles from "../data/puzzles.mjs";
import { ITEMS_PER_PUZZLE } from "../public/src/engine.js";

test("the library passes structural validation", () => {
  // Same check the build runs, so a bad puzzle fails here rather than in prod.
  assert.doesNotThrow(() =>
    execFileSync("node", ["scripts/validate-puzzles.mjs"], { stdio: "pipe" })
  );
});

test("there are enough puzzles for a meaningful first run", () => {
  assert.ok(puzzles.length >= 30, `only ${puzzles.length} puzzles`);
});

test("every puzzle has the exact board size the engine expects", () => {
  for (const p of puzzles) {
    assert.equal(p.items.length, ITEMS_PER_PUZZLE, `puzzle ${p.id}`);
  }
});

test("ids are unique, so saved progress can never point at two puzzles", () => {
  assert.equal(new Set(puzzles.map((p) => p.id)).size, puzzles.length);
});
