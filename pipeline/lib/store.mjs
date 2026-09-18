/**
 * On-disk artifacts. Each stage reads the previous stage's output and writes
 * its own, so any stage can be re-run in isolation and inspected by hand.
 *
 *   state/tables/<id>.json   harvested + enriched rows
 *   state/queue.json         scored candidates awaiting human review
 *   state/ledger.json        which entities have already shipped, and when
 */
import fs from "node:fs/promises";
import path from "node:path";

// Overridable so the pipeline can be exercised end to end against a temp
// directory in tests, without touching real harvested state.
const STATE = process.env.ORDERS_PIPELINE_STATE
  ? path.resolve(process.env.ORDERS_PIPELINE_STATE)
  : path.resolve("pipeline/state");
const TABLES = path.join(STATE, "tables");
export const QUEUE_PATH = path.join(STATE, "queue.json");
const LEDGER_PATH = path.join(STATE, "ledger.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

export const saveTable = (table) => writeJson(path.join(TABLES, `${table.id}.json`), table);
export const loadTable = (id) => readJson(path.join(TABLES, `${id}.json`), null);

export async function loadAllTables() {
  try {
    const files = await fs.readdir(TABLES);
    const tables = await Promise.all(
      files.filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(TABLES, f), null))
    );
    return tables.filter(Boolean);
  } catch {
    return [];
  }
}

export const loadQueue = () => readJson(QUEUE_PATH, []);
export const saveQueue = (queue) => writeJson(QUEUE_PATH, queue);

/**
 * Entity usage history. Without this the sampler happily ships the same six
 * famous animals twice in a fortnight, because they are exactly the rows that
 * pass every other filter.
 */
export const loadLedger = () => readJson(LEDGER_PATH, { entities: {} });

export async function recordUsage(entityKeys) {
  const ledger = await loadLedger();
  const now = Date.now();
  for (const key of entityKeys) {
    ledger.entities[key] = { lastUsedAt: now, uses: (ledger.entities[key]?.uses ?? 0) + 1 };
  }
  await writeJson(LEDGER_PATH, ledger);
  return ledger;
}
