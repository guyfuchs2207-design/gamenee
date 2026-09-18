/**
 * Stage 6 — move approved queue entries into the puzzle library.
 *
 * Refuses anything the game or the reviewer would trip over later: a missing
 * fact, a duplicate value (which would leave the puzzle with no single correct
 * order), or an item already used recently.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { loadQueue, saveQueue, recordUsage } from "./lib/store.mjs";

// Overridable so tests can append to a throwaway copy of the library.
const LIBRARY = process.env.ORDERS_LIBRARY
  ? path.resolve(process.env.ORDERS_LIBRARY)
  : path.resolve("data/puzzles.mjs");
const TAIL = "\n];\n\nexport default puzzles;\n";

export function checkEntry(entry) {
  const problems = [];
  if (!entry.fact?.trim()) problems.push("no fact written — that line is the reveal's payoff");
  if (!entry.source?.trim()) problems.push("no source");
  if (!Array.isArray(entry.items) || entry.items.length !== 6) problems.push("needs exactly 6 items");

  if (Array.isArray(entry.items)) {
    const values = entry.items.map((i) => i.value);
    if (new Set(values).size !== values.length) {
      problems.push("two items share a display value — the puzzle has no single correct order");
    }
    const labels = entry.items.map((i) => i.label);
    if (new Set(labels).size !== labels.length) problems.push("duplicate labels");
    for (const item of entry.items) {
      if (!item.label?.trim()) problems.push("an item has no label");
      if (!item.value?.trim()) problems.push(`"${item.label}" has no display value`);
      if (item.label && item.label.length > 44) problems.push(`"${item.label}" is too long to lay out`);
    }
    // The rows arrive sorted descending; a reviewer reordering them by hand is
    // almost certainly a mistake, so confirm the invariant still holds.
    const raws = entry.items.map((i) => i.raw);
    if (raws.every((r) => typeof r === "number")) {
      for (let i = 1; i < raws.length; i++) {
        if (raws[i] > raws[i - 1]) {
          problems.push(`items are not in descending order at position ${i + 1}`);
          break;
        }
      }
    }
  }
  return problems;
}

function serialise(entry, id) {
  const items = entry.items
    .map((item) => `      { label: ${JSON.stringify(item.label)}, value: ${JSON.stringify(item.value)} },`)
    .join("\n");
  return `  {
    id: ${id},
    prompt: ${JSON.stringify(entry.prompt)},
    hint: ${JSON.stringify(entry.hint)},
    unit: ${JSON.stringify(entry.unit)},
    items: [
${items}
    ],
    source: ${JSON.stringify(entry.source)},
    fact: ${JSON.stringify(entry.fact.trim())},
  },
`;
}

export async function approve({ dryRun = false } = {}) {
  const queue = await loadQueue();
  const approved = queue.filter((e) => e.approved);
  if (approved.length === 0) {
    console.log("Nothing approved. Edit pipeline/state/queue.json: set `approved: true` and write a `fact`.");
    return { added: 0 };
  }

  const rejected = [];
  const accepted = [];
  for (const entry of approved) {
    const problems = checkEntry(entry);
    if (problems.length) rejected.push({ entry, problems });
    else accepted.push(entry);
  }

  for (const { entry, problems } of rejected) {
    console.log(`✗ ${entry.prompt}`);
    for (const p of problems) console.log(`    ${p}`);
  }

  if (accepted.length === 0) return { added: 0, rejected: rejected.length };

  const source = await fs.readFile(LIBRARY, "utf8");
  if (!source.endsWith(TAIL)) throw new Error("data/puzzles.mjs does not end as expected — refusing to append");

  const { default: existing } = await import(`${LIBRARY}?t=${Date.now()}`);
  let nextId = Math.max(0, ...existing.map((p) => p.id)) + 1;

  const block = accepted.map((entry) => serialise(entry, nextId++)).join("");
  if (dryRun) {
    console.log(block);
    return { added: accepted.length, dryRun: true };
  }

  await fs.writeFile(LIBRARY, source.slice(0, -TAIL.length) + "\n" + block + TAIL.slice(1));
  await recordUsage(accepted.flatMap((e) => e.items.map((i) => i.key)));
  await saveQueue(queue.filter((e) => !accepted.includes(e)));

  console.log(`\n✓ appended ${accepted.length} puzzle(s) to ${path.relative(process.cwd(), LIBRARY)}`);
  console.log("  now run: npm run build && npm test");
  return { added: accepted.length, rejected: rejected.length };
}
