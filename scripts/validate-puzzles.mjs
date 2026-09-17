/**
 * Structural validation for the puzzle library.
 *
 * Ordering correctness (item 0 really is rank #1) cannot be machine-checked —
 * `value` is a display string, deliberately, so units like "1 in 292,201,338"
 * and "243 Earth days" can sit in the same field. What this catches is every
 * failure that *is* mechanical: ties, duplicates, missing sources, and labels
 * too long to lay out on a phone.
 */
import puzzles from "../data/puzzles.mjs";

const ITEMS_PER_PUZZLE = 6;
const MAX_LABEL = 44;
const MAX_PROMPT = 60;

const errors = [];
const warnings = [];
const seenIds = new Set();

for (const [i, p] of puzzles.entries()) {
  const at = `puzzle[${i}] (id ${p?.id ?? "?"})`;

  if (typeof p.id !== "number" || !Number.isInteger(p.id)) {
    errors.push(`${at}: id must be an integer`);
  } else if (seenIds.has(p.id)) {
    errors.push(`${at}: duplicate id`);
  } else {
    seenIds.add(p.id);
  }

  for (const field of ["prompt", "hint", "unit", "source", "fact"]) {
    if (typeof p[field] !== "string" || !p[field].trim()) {
      errors.push(`${at}: missing "${field}"`);
    }
  }

  if (p.prompt && p.prompt.length > MAX_PROMPT) {
    warnings.push(`${at}: prompt is ${p.prompt.length} chars (>${MAX_PROMPT}), may wrap awkwardly`);
  }

  if (!Array.isArray(p.items) || p.items.length !== ITEMS_PER_PUZZLE) {
    errors.push(`${at}: needs exactly ${ITEMS_PER_PUZZLE} items, got ${p.items?.length}`);
    continue;
  }

  const labels = new Set();
  const values = new Set();
  for (const [j, item] of p.items.entries()) {
    if (!item.label?.trim()) errors.push(`${at} item[${j}]: missing label`);
    if (!item.value?.trim()) errors.push(`${at} item[${j}]: missing value`);
    if (labels.has(item.label)) errors.push(`${at} item[${j}]: duplicate label "${item.label}"`);
    labels.add(item.label);

    // Identical display values mean the puzzle has no single correct order.
    if (values.has(item.value)) {
      errors.push(`${at} item[${j}]: value "${item.value}" ties with an earlier item — ambiguous ranking`);
    }
    values.add(item.value);

    if (item.label && item.label.length > MAX_LABEL) {
      warnings.push(`${at} item[${j}]: label is ${item.label.length} chars (>${MAX_LABEL})`);
    }
  }
}

for (const w of warnings) console.warn(`  warn  ${w}`);
for (const e of errors) console.error(`  ERROR ${e}`);

if (errors.length) {
  console.error(`\n✗ ${errors.length} error(s) in ${puzzles.length} puzzles`);
  process.exit(1);
}
console.log(`✓ ${puzzles.length} puzzles valid${warnings.length ? ` (${warnings.length} warning(s))` : ""}`);
