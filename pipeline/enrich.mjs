/**
 * Stage 2 — attach a recognisability score to every row.
 *
 * This is the highest-value filter in the pipeline. A puzzle is only as
 * playable as its most obscure item, and structured sources are full of
 * entities that are real, correctly valued and completely unknown. Wikipedia
 * pageviews are a decent proxy for "would a general audience recognise this".
 */
import { get } from "./lib/http.mjs";
import { loadAllTables, saveTable } from "./lib/store.mjs";

const PAGEVIEWS = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";
const CONCURRENCY = 5;

function monthRange(months = 12) {
  const end = new Date();
  end.setUTCDate(1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - months);
  const fmt = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}0100`;
  return { start: fmt(start), end: fmt(end) };
}

/** Mean monthly enwiki pageviews over the last year. 0 when unknown. */
export async function fameFor(title, range) {
  if (!title) return 0;
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `${PAGEVIEWS}/en.wikipedia/all-access/all-agents/${encoded}/monthly/${range.start}/${range.end}`;
  // A redirect or a since-renamed article 404s here. That is information, not
  // an error: an article nobody can resolve is not one to build a puzzle on.
  const res = await get(url, { minIntervalMs: 60, maxAgeMs: 30 * 86400000 });
  if (!res.ok) return 0;
  const items = res.body?.items;
  if (!Array.isArray(items) || items.length === 0) return 0;
  return items.reduce((sum, item) => sum + (item.views ?? 0), 0) / items.length;
}

/** Run an async mapper over a list with a bounded number in flight. */
async function pool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export async function enrich({ onProgress } = {}) {
  const range = monthRange(12);
  const tables = await loadAllTables();
  const report = [];

  for (const table of tables) {
    let done = 0;
    await pool(table.rows, CONCURRENCY, async (row) => {
      row.fame = Math.round(await fameFor(row.article, range));
      done++;
      onProgress?.(table.id, done, table.rows.length);
    });

    const known = table.rows.filter((r) => r.fame > 0).length;
    table.enrichedAt = new Date().toISOString();
    await saveTable(table);
    report.push({ id: table.id, rows: table.rows.length, withFame: known });
    console.log(`  ${table.id} … ${known}/${table.rows.length} rows have pageview data`);
  }
  return report;
}
