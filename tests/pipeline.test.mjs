import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Redirect pipeline state and the library to throwaway paths BEFORE importing
// anything that resolves them at module load.
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "orders-pipeline-"));
process.env.ORDERS_PIPELINE_STATE = path.join(tmp, "state");
process.env.ORDERS_LIBRARY = path.join(tmp, "puzzles.mjs");

const { ranks, spearman, surpriseScore, minSeparation, spread, gaussian, makeRng, shuffled } =
  await import("../pipeline/lib/stats.mjs");
const { formatValue, cleanLabel } = await import("../pipeline/lib/format.mjs");
const { sampleCandidates, DEFAULTS } = await import("../pipeline/sample.mjs");
const { scoreCandidate, freshnessPenalty, applyJudge } = await import("../pipeline/score.mjs");
const { parseOrder, scoreGuess } = await import("../pipeline/judge.mjs");
const { checkEntry } = await import("../pipeline/approve.mjs");
const { saveTable, saveQueue, loadQueue } = await import("../pipeline/lib/store.mjs");
const { build } = await import("../pipeline/build.mjs");
const { approve } = await import("../pipeline/approve.mjs");
const { animalDeaths, predictable } = await import("./fixtures/table.mjs");

// ─────────────────────────────── stats

test("ranks are 1-based and average ties", () => {
  assert.deepEqual(ranks([10, 30, 20]), [3, 1, 2]);
  assert.deepEqual(ranks([5, 5, 1]), [1.5, 1.5, 3]);
});

test("spearman spans perfect agreement to perfect inversion", () => {
  assert.equal(spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), 0, "a constant series correlates with nothing");
  assert.equal(spearman([1], [1]), 0, "too short to correlate");
});

test("surprise is high exactly when fame fails to predict the metric", () => {
  const values = animalDeaths.rows.slice(0, 6).map((r) => r.value);
  const fames = animalDeaths.rows.slice(0, 6).map((r) => r.fame);
  const surprising = surpriseScore(values, fames);

  const pv = predictable.rows.map((r) => r.value);
  const pf = predictable.rows.map((r) => r.fame);
  const boring = surpriseScore(pv, pf);

  assert.ok(surprising > 0.8, `expected a high surprise score, got ${surprising}`);
  assert.ok(boring < 0.1, `fame-tracks-value should score near zero, got ${boring}`);
});

test("minSeparation reports the tightest consecutive gap", () => {
  assert.equal(minSeparation([100, 50, 10]), 2);
  assert.equal(minSeparation([1000, 999]), 1000 / 999);
  assert.equal(minSeparation([5, 5]), 1, "identical values have no separation");
});

test("minSeparation survives zeroes instead of returning NaN", () => {
  assert.equal(minSeparation([0, 0]), 1);
  assert.equal(minSeparation([100, 10, 0]), 10, "an infinite gap never sets the minimum");
});

test("spread counts orders of magnitude", () => {
  assert.equal(spread([1000, 1]), 3);
  assert.equal(spread([5, 5]), 0);
  assert.equal(spread([5, 0]), 0, "a zero floor is treated as no spread, not infinity");
});

test("gaussian peaks at the target", () => {
  assert.equal(gaussian(2, 2, 1.6), 1);
  assert.ok(gaussian(6, 2, 1.6) < gaussian(3, 2, 1.6));
});

test("the seeded shuffle is reproducible and preserves membership", () => {
  const items = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(shuffled(items, makeRng(9)), shuffled(items, makeRng(9)));
  assert.deepEqual([...shuffled(items, makeRng(3))].sort(), items);
});

// ─────────────────────────────── formatting

test("large numbers format compactly", () => {
  assert.equal(formatValue(725000, { kind: "compact" }), "725,000");
  assert.equal(formatValue(1460000000, { kind: "compact" }), "1.46 billion");
  assert.equal(formatValue(2920000000, { kind: "compact", prefix: "$" }), "$2.92 billion");
  assert.equal(formatValue(17100000, { kind: "compact", suffix: " km²" }), "17.1 million km²");
});

test("plain numbers, percentages and years each format their own way", () => {
  assert.equal(formatValue(8849, { suffix: " m" }), "8,849 m");
  assert.equal(formatValue(46.1, { kind: "percent", decimals: 1 }), "46.1%");
  assert.equal(formatValue(1440, { kind: "year" }), "1440", "a year is not thousands-separated");
});

test("labels lose Wikidata disambiguators", () => {
  assert.equal(cleanLabel("Mercury (planet)"), "Mercury");
  assert.equal(cleanLabel("  Blue   whale "), "Blue whale");
});

// ─────────────────────────────── sampling

test("every sampled set is the right size and properly separated", () => {
  const sets = sampleCandidates(animalDeaths.rows, { seed: 7 });
  assert.ok(sets.length > 0, "expected at least one candidate");
  for (const set of sets) {
    assert.equal(set.length, 6);
    for (let i = 1; i < set.length; i++) {
      assert.ok(set[i - 1].value >= set[i].value, "sets must be descending");
      assert.ok(
        set[i - 1].value / set[i].value >= DEFAULTS.minRatio,
        `gap ${set[i - 1].entity}→${set[i].entity} is too tight to be knowable`
      );
    }
  }
});

test("items below the fame floor never reach a puzzle", () => {
  const sets = sampleCandidates(animalDeaths.rows, { seed: 7 });
  for (const set of sets) {
    assert.ok(!set.some((r) => r.entity === "Obscure parasite"), "an unrecognisable item leaked through");
    for (const row of set) assert.ok(row.fame >= DEFAULTS.fameFloor);
  }
});

test("the near-duplicate value is filtered out by the separation rule", () => {
  // 725,000 and 717,750 are 1% apart — a coin flip that costs two points.
  const sets = sampleCandidates(animalDeaths.rows, { seed: 7 });
  for (const set of sets) {
    const keys = set.map((r) => r.key);
    assert.ok(
      !(keys.includes("Q1234") && keys.includes("Q7006")),
      "two near-identical values ended up in the same puzzle"
    );
  }
});

test("sampling is reproducible and returns no duplicate sets", () => {
  const a = sampleCandidates(animalDeaths.rows, { seed: 42 });
  const b = sampleCandidates(animalDeaths.rows, { seed: 42 });
  assert.deepEqual(a.map((s) => s.map((r) => r.key)), b.map((s) => s.map((r) => r.key)));
  const keys = a.map((s) => s.map((r) => r.key).sort().join("|"));
  assert.equal(new Set(keys).size, keys.length);
});

test("a table with too few eligible rows yields nothing rather than throwing", () => {
  assert.deepEqual(sampleCandidates([], { seed: 1 }), []);
  assert.deepEqual(sampleCandidates(animalDeaths.rows.slice(0, 2), { seed: 1 }), []);
});

// ─────────────────────────────── scoring

test("the surprising set outscores the predictable one", () => {
  const surprising = scoreCandidate(animalDeaths.rows.slice(0, 6));
  const boring = scoreCandidate(predictable.rows);
  assert.ok(
    surprising.interest > boring.interest,
    `surprising ${surprising.interest.toFixed(3)} should beat boring ${boring.interest.toFixed(3)}`
  );
});

test("recently used entities are damped, and recover with age", () => {
  const rows = animalDeaths.rows.slice(0, 6);
  const now = Date.now();
  const fresh = { entities: {} };
  const usedToday = { entities: { Q1234: { lastUsedAt: now, uses: 1 } } };
  const usedLongAgo = { entities: { Q1234: { lastUsedAt: now - 90 * 86400000, uses: 1 } } };

  assert.equal(freshnessPenalty(rows, fresh, now), 1);
  assert.ok(freshnessPenalty(rows, usedToday, now) < 0.3);
  assert.equal(freshnessPenalty(rows, usedLongAgo, now), 1, "old usage stops mattering");
  assert.equal(freshnessPenalty(rows, null, now), 1, "no ledger is not a penalty");
});

test("the judge rewards a mid-difficulty prediction over a trivial one", () => {
  const base = scoreCandidate(animalDeaths.rows.slice(0, 6));
  const hard = applyJudge(base, 2.0);
  const trivial = applyJudge(base, 6.0);
  assert.ok(hard.interest > trivial.interest, "a puzzle the model always nails should rank lower");
  assert.equal(applyJudge(base, null).interest, base.interest, "no verdict leaves the score alone");
});

// ─────────────────────────────── judge parsing

test("an order is parsed out of a fenced or chatty response", () => {
  const labels = ["Mosquitoes", "Snakes", "Dogs"];
  assert.deepEqual(parseOrder('["Mosquitoes","Snakes","Dogs"]', labels), labels);
  assert.deepEqual(parseOrder('Sure!\n```json\n["Dogs","Snakes","Mosquitoes"]\n```', labels),
    ["Dogs", "Snakes", "Mosquitoes"]);
  assert.deepEqual(parseOrder('["mosquitoes","SNAKES","dogs"]', labels), labels, "case-insensitive");
});

test("a response that is not an exact permutation is rejected, not guessed at", () => {
  const labels = ["Mosquitoes", "Snakes", "Dogs"];
  assert.equal(parseOrder('["Mosquitoes","Snakes"]', labels), null, "too few");
  assert.equal(parseOrder('["Mosquitoes","Snakes","Sharks"]', labels), null, "invented an item");
  assert.equal(parseOrder('["Dogs","Dogs","Snakes"]', labels), null, "repeated an item");
  assert.equal(parseOrder("no array here", labels), null);
  assert.equal(parseOrder("[not json]", labels), null);
});

test("the judge scores a guess the way the game does", () => {
  const truth = ["a", "b", "c", "d", "e", "f"];
  assert.equal(scoreGuess(truth, truth), 6);
  assert.equal(scoreGuess(["b", "a", "c", "d", "e", "f"], truth), 4);
  assert.equal(scoreGuess(["f", "a", "b", "c", "d", "e"], truth), 0);
});

// ─────────────────────────────── approval gate

const goodEntry = () => ({
  approved: true,
  fact: "Mosquitoes kill more people in a day than sharks have in a century.",
  prompt: "Human deaths caused per year",
  hint: "most → least",
  unit: "deaths / year",
  source: "Fixture source, 2025",
  items: animalDeaths.rows.slice(0, 6).map((r) => ({
    label: r.entity, value: String(r.value), raw: r.value, key: r.key, fame: r.fame,
  })),
});

test("a complete entry passes the gate", () => {
  assert.deepEqual(checkEntry(goodEntry()), []);
});

test("an entry with no fact is refused — that line is the payoff", () => {
  const e = goodEntry();
  e.fact = "   ";
  assert.match(checkEntry(e).join(" "), /no fact/);
});

test("duplicate display values are refused as having no correct order", () => {
  const e = goodEntry();
  e.items[1].value = e.items[0].value;
  assert.match(checkEntry(e).join(" "), /no single correct order/);
});

test("items out of descending order are caught", () => {
  const e = goodEntry();
  [e.items[0], e.items[1]] = [e.items[1], e.items[0]];
  assert.match(checkEntry(e).join(" "), /not in descending order/);
});

test("wrong item count, missing source and over-long labels are all caught", () => {
  const short = goodEntry();
  short.items = short.items.slice(0, 5);
  assert.match(checkEntry(short).join(" "), /exactly 6 items/);

  const noSource = goodEntry();
  noSource.source = "";
  assert.match(checkEntry(noSource).join(" "), /no source/);

  const longLabel = goodEntry();
  longLabel.items[0].label = "x".repeat(60);
  assert.match(checkEntry(longLabel).join(" "), /too long/);
});

// ─────────────────────────────── end to end

test("harvested table → queue → approved puzzle lands in the library", async () => {
  await fs.writeFile(
    process.env.ORDERS_LIBRARY,
    "const puzzles = [\n  {\n    id: 1,\n    prompt: \"Seed\",\n    hint: \"most → least\",\n    unit: \"x\",\n    items: [],\n    source: \"seed\",\n    fact: \"seed\",\n  },\n];\n\nexport default puzzles;\n"
  );
  await saveTable(animalDeaths);

  const queue = await build({ limit: 10, judge: false, seed: 5 });
  assert.ok(queue.length > 0, "build produced no candidates");

  const entry = queue[0];
  assert.equal(entry.approved, false, "nothing is approved without a human");
  assert.equal(entry.fact, "", "the fact is left for the reviewer to write");
  assert.equal(entry.items.length, 6);
  assert.ok(entry.items.every((i) => typeof i.value === "string" && i.value.length > 0));
  assert.ok(entry.interest > 0);

  // Stand in for the human review step.
  entry.approved = true;
  entry.fact = "A fact worth screenshotting.";
  await saveQueue(queue);

  const result = await approve();
  assert.equal(result.added, 1, "expected exactly one puzzle to be appended");

  const { default: library } = await import(`${process.env.ORDERS_LIBRARY}?v=${Date.now()}`);
  assert.equal(library.length, 2);
  const added = library[1];
  assert.equal(added.id, 2, "ids continue from the existing library");
  assert.equal(added.items.length, 6);
  assert.equal(added.fact, "A fact worth screenshotting.");
  assert.ok(added.items.every((i) => i.label && i.value));

  const remaining = await loadQueue();
  assert.ok(!remaining.some((e) => e.id === entry.id), "an approved entry leaves the queue");
});

test("approving an incomplete entry changes nothing", async () => {
  const queue = await loadQueue();
  if (queue.length === 0) return;
  queue[0].approved = true;
  queue[0].fact = ""; // still missing
  await saveQueue(queue);

  const before = (await import(`${process.env.ORDERS_LIBRARY}?v=${Date.now()}`)).default.length;
  const result = await approve();
  const after = (await import(`${process.env.ORDERS_LIBRARY}?v=${Date.now()}`)).default.length;

  assert.equal(result.added, 0);
  assert.equal(after, before, "a rejected entry must not touch the library");
});

test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// ─────────────────────────────── diversity

const { diversify } = await import("../pipeline/build.mjs");

const entryWith = (keys, interest, tableId = "t") => ({
  tableId, interest, items: keys.map((k) => ({ key: k, label: k, value: "1" })),
});

test("near-duplicate candidates are collapsed to the best of the cluster", () => {
  const entries = [
    entryWith(["a", "b", "c", "d", "e", "f"], 0.9),
    entryWith(["a", "b", "c", "d", "e", "g"], 0.89), // 5 of 6 shared
    entryWith(["a", "b", "c", "d", "h", "i"], 0.88), // 4 of 6 shared
    entryWith(["a", "b", "c", "x", "y", "z"], 0.80), // 3 shared — allowed
    entryWith(["p", "q", "r", "s", "t", "u"], 0.70), // nothing shared
  ];
  const kept = diversify(entries, { maxOverlap: 3 });
  assert.deepEqual(kept.map((e) => e.interest), [0.9, 0.8, 0.7]);
});

test("diversity is scoped per table — different tables never collide", () => {
  const entries = [
    entryWith(["a", "b", "c", "d", "e", "f"], 0.9, "one"),
    entryWith(["a", "b", "c", "d", "e", "f"], 0.8, "two"),
  ];
  assert.equal(diversify(entries, { maxOverlap: 3 }).length, 2);
});

test("the diversity limit is respected", () => {
  const entries = Array.from({ length: 10 }, (_, i) =>
    entryWith([`a${i}`, `b${i}`, `c${i}`, `d${i}`, `e${i}`, `f${i}`], 1 - i / 100)
  );
  assert.equal(diversify(entries, { maxOverlap: 3, limit: 4 }).length, 4);
});
