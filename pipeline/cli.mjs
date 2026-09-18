#!/usr/bin/env node
/**
 * Pipeline entry point.
 *
 *   npm run pipeline:harvest [-- --only <table-id>]
 *   npm run pipeline:enrich
 *   npm run pipeline:build   [-- --judge --limit 60 --trials 4]
 *   npm run pipeline:review  [-- --top 20]
 *   npm run pipeline:approve [-- --dry-run]
 */
import { loadQueue } from "./lib/store.mjs";

const argv = process.argv.slice(2);
const command = argv[0];

function flag(name) {
  return argv.includes(`--${name}`);
}
function value(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i === argv.length - 1) return fallback;
  const raw = argv[i + 1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

const bar = (x, width = 12) =>
  "█".repeat(Math.round(Math.max(0, Math.min(1, x)) * width)).padEnd(width, "·");

async function review() {
  const queue = await loadQueue();
  if (queue.length === 0) {
    console.log("Queue is empty — run `npm run pipeline:build`.");
    return;
  }
  const top = Number(value("top", 20));
  console.log(`\n${queue.length} candidates. Showing top ${Math.min(top, queue.length)}.`);
  console.log("Approve by editing pipeline/state/queue.json: set `approved: true` and write a `fact`.\n");

  for (const [i, e] of queue.slice(0, top).entries()) {
    const s = e.signals ?? {};
    console.log(`${String(i + 1).padStart(3)}. ${e.prompt}  (${e.hint})`);
    console.log(`     interest ${bar(e.interest)} ${e.interest.toFixed(3)}   ` +
      `surprise ${(s.surprise ?? 0).toFixed(2)}  sep ${(s.rawSeparation ?? 0).toFixed(2)}×  ` +
      `min-fame ${Math.round(s.minFame ?? 0).toLocaleString()}/mo` +
      (e.predictedPlayerScore != null ? `  predicted ${e.predictedPlayerScore}/6` : ""));
    for (const [rank, item] of e.items.entries()) {
      console.log(`       ${rank + 1}. ${item.label.padEnd(30)} ${item.value}`);
    }
    console.log(`     source: ${e.source}`);
    console.log(`     ${e.approved ? "approved" : "not approved"}` +
      `${e.fact ? "" : "  · fact not written"}\n`);
  }
}

async function main() {
  switch (command) {
    case "harvest": {
      const { harvest } = await import("./harvest.mjs");
      console.log("Harvesting tables…");
      await harvest({ only: value("only", null) });
      console.log("\nNext: npm run pipeline:enrich");
      break;
    }
    case "enrich": {
      const { enrich } = await import("./enrich.mjs");
      console.log("Fetching pageviews (cached for 30 days; the first run is the slow one)…");
      await enrich();
      console.log("\nNext: npm run pipeline:build");
      break;
    }
    case "build": {
      const { build } = await import("./build.mjs");
      console.log("Sampling and scoring candidates…");
      const queue = await build({
        limit: Number(value("limit", 60)),
        judge: flag("judge"),
        trials: Number(value("trials", 4)),
        judgeTop: Number(value("judge-top", 30)),
        seed: Number(value("seed", 1)),
      });
      console.log(`\n✓ ${queue.length} candidates written to pipeline/state/queue.json`);
      console.log("  Next: npm run pipeline:review");
      break;
    }
    case "review":
      await review();
      break;
    case "approve": {
      const { approve } = await import("./approve.mjs");
      await approve({ dryRun: flag("dry-run") });
      break;
    }
    default:
      console.log(`Orders puzzle pipeline

  harvest [--only <id>]                  fetch ranked tables from sources
  enrich                                 attach Wikipedia pageview fame scores
  build   [--judge] [--limit N]          sample, score, write the review queue
          [--trials N] [--judge-top N]
  review  [--top N]                      print the queue for a human to read
  approve [--dry-run]                    append approved entries to the library

Run them in that order. See pipeline/README.md.`);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
});
