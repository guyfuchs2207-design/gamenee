/**
 * Stages 3-4 — sample candidates, score them, and write the review queue.
 *
 * The queue is just a JSON file. Review is editing it: set `approved: true`
 * and write the `fact` line. No interactive UI to learn, and the diff is
 * reviewable like anything else in the repo.
 */
import { loadAllTables, loadLedger, saveQueue } from "./lib/store.mjs";
import { formatValue } from "./lib/format.mjs";
import { sampleCandidates, DEFAULTS } from "./sample.mjs";
import { scoreCandidate, applyJudge } from "./score.mjs";
import { judgeCandidate, judgeAvailable, DEFAULT_TRIALS } from "./judge.mjs";

/** Judging costs money per trial, so only the arithmetic front-runners get it. */
export const JUDGE_TOP = 30;

function toQueueEntry(table, rows, score) {
  return {
    id: `${table.id}:${rows.map((r) => r.key).join("+")}`,
    tableId: table.id,

    // ─── review these two, then flip approved ───
    approved: false,
    fact: "", // required: the line that makes someone screenshot the reveal

    prompt: table.prompt,
    hint: table.hint,
    unit: table.unit,
    category: table.category,
    volatility: table.volatility,
    source: table.sourceNote,
    items: rows.map((r) => ({
      label: r.entity,
      value: formatValue(r.value, table.format),
      raw: r.value,
      key: r.key,
      fame: r.fame ?? 0,
    })),
    interest: Number(score.interest.toFixed(4)),
    signals: Object.fromEntries(
      Object.entries(score.signals).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(3)) : v])
    ),
  };
}

/**
 * Greedy diversity pass.
 *
 * Sampling one table produces many near-identical sets — the top candidates
 * routinely differ by a single row. Ranked purely by score, the queue fills
 * with the same puzzle five times over and wastes the one genuinely scarce
 * resource in this pipeline, which is reviewer attention. Keep the best of
 * each cluster instead.
 */
export function diversify(entries, { maxOverlap = 3, limit = Infinity } = {}) {
  const picked = [];
  for (const entry of entries) {
    if (picked.length >= limit) break;
    const keys = new Set(entry.items.map((i) => i.key));
    const tooSimilar = picked.some((chosen) => {
      if (chosen.tableId !== entry.tableId) return false;
      const shared = chosen.items.filter((i) => keys.has(i.key)).length;
      return shared > maxOverlap;
    });
    if (!tooSimilar) picked.push(entry);
  }
  return picked;
}

export async function build({
  limit = 60,
  judge = false,
  trials = DEFAULT_TRIALS,
  judgeTop = JUDGE_TOP,
  maxOverlap = 3,
  seed = 1,
  sampleOptions = {},
} = {}) {
  const tables = await loadAllTables();
  if (tables.length === 0) throw new Error("no harvested tables — run `npm run pipeline:harvest` first");

  const ledger = await loadLedger();
  const now = Date.now();
  const entries = [];

  for (const table of tables) {
    const enriched = table.rows.some((r) => typeof r.fame === "number");
    if (!enriched) {
      console.log(`  ${table.id} … skipped (not enriched — run \`npm run pipeline:enrich\`)`);
      continue;
    }

    const candidates = sampleCandidates(table.rows, { ...DEFAULTS, ...sampleOptions, seed });
    for (const rows of candidates) {
      entries.push(toQueueEntry(table, rows, scoreCandidate(rows, { ledger, now })));
    }
    console.log(`  ${table.id} … ${candidates.length} candidates`);
  }

  entries.sort((a, b) => b.interest - a.interest);

  // Diversify before judging, so no trial money is spent on near-duplicates.
  const diverse = diversify(entries, { maxOverlap, limit: limit * 2 });
  entries.length = 0;
  entries.push(...diverse);

  if (judge && entries.length > 0) {
    if (!judgeAvailable()) {
      console.log("\n  ⚠ --judge requested but no Anthropic credentials found; skipping the judge.");
      console.log("    Set ANTHROPIC_API_KEY, or run `ant auth login`.\n");
    } else {
      const shortlist = entries.slice(0, judgeTop);
      console.log(`\n  judging the top ${shortlist.length} candidates (${trials} trials each)…`);
      for (const [i, entry] of shortlist.entries()) {
        const rows = entry.items.map((it) => ({ entity: it.label }));
        const verdict = await judgeCandidate(
          { rows, prompt: entry.prompt, hint: entry.hint },
          { trials, seed: seed + i }
        );
        if (!verdict) {
          console.log(`    ${i + 1}/${shortlist.length} ${entry.prompt} — no usable trials`);
          continue;
        }
        const rescored = applyJudge({ interest: entry.interest, signals: entry.signals }, verdict.predictedMean);
        entry.interest = Number(rescored.interest.toFixed(4));
        entry.signals = rescored.signals;
        entry.predictedPlayerScore = Number(verdict.predictedMean.toFixed(2));
        console.log(
          `    ${i + 1}/${shortlist.length} ${entry.prompt} — predicted ${verdict.predictedMean.toFixed(1)}/6`
        );
      }
      entries.sort((a, b) => b.interest - a.interest);
    }
  }

  const queue = entries.slice(0, limit);
  await saveQueue(queue);
  return queue;
}
