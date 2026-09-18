/**
 * Stage 1 — harvest ranked tables from structured sources.
 *
 * Output per table: { id, prompt, ..., rows: [{entity, key, value, article}] }
 * sorted descending by value. Nothing here judges quality; that is stages 3-4.
 */
import { get } from "./lib/http.mjs";
import { cleanLabel } from "./lib/format.mjs";
import { saveTable } from "./lib/store.mjs";
import { tables, tableById } from "./tables.mjs";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const OWID_BASE = "https://ourworldindata.org/grapher";

/** enwiki article URL → page title, which is what the pageviews API keys on. */
function articleTitle(url) {
  if (!url) return null;
  const last = String(url).split("/wiki/")[1];
  return last ? decodeURIComponent(last) : null;
}

async function harvestWikidata(spec) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(spec.query)}&format=json`;
  const res = await get(url, { accept: "application/sparql-results+json" });
  if (!res.ok) return { ok: false, error: res.error };

  const bindings = res.body?.results?.bindings;
  if (!Array.isArray(bindings)) return { ok: false, error: "unexpected SPARQL response shape" };

  // One entity can carry several values for a property (different sources or
  // years). Keep the largest — for these metrics it is the most recent or the
  // most inclusive figure, and mixing two within one table would be worse.
  const byQid = new Map();
  for (const b of bindings) {
    const value = Number(b.value?.value);
    if (!Number.isFinite(value)) continue;
    const qid = b.item?.value?.split("/").pop();
    const label = cleanLabel(b.itemLabel?.value ?? "");
    // An unresolved label comes back as the raw Q-id, which is useless on a board.
    if (!qid || !label || /^Q\d+$/.test(label)) continue;

    const existing = byQid.get(qid);
    if (!existing || value > existing.value) {
      byQid.set(qid, { entity: label, key: qid, value, article: articleTitle(b.article?.value) });
    }
  }
  return { ok: true, rows: [...byQid.values()] };
}

async function harvestOwid(spec) {
  const url = `${OWID_BASE}/${spec.slug}.csv`;
  const res = await get(url, { accept: "text/csv", parse: "text" });
  if (!res.ok) return { ok: false, error: res.error };

  const lines = String(res.body).trim().split("\n");
  if (lines.length < 2) return { ok: false, error: "empty CSV" };

  const header = lines[0].split(",").map((h) => h.trim());
  const iEntity = header.indexOf("Entity");
  const iCode = header.indexOf("Code");
  const iYear = header.indexOf("Year");
  if (iEntity < 0 || iYear < 0) return { ok: false, error: "CSV missing Entity/Year columns" };

  // The value is whichever column is not one of the three fixed ones.
  const iValue = header.findIndex((_, i) => i !== iEntity && i !== iCode && i !== iYear);
  if (iValue < 0) return { ok: false, error: "CSV has no value column" };

  // Keep the most recent year per entity, so one table is one vintage.
  const latest = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const entity = cells[iEntity]?.trim();
    const year = Number(cells[iYear]);
    const value = Number(cells[iValue]);
    if (!entity || !Number.isFinite(value) || !Number.isFinite(year)) continue;

    // OWID mixes aggregates ("World", "Africa", "High-income countries") into
    // the same file. They have no ISO code, which is the cheapest way to drop them.
    const code = iCode >= 0 ? cells[iCode]?.trim() : "";
    if (iCode >= 0 && (!code || code.length !== 3)) continue;

    const prev = latest.get(entity);
    if (!prev || year > prev.year) {
      latest.set(entity, { entity, key: code || entity, value, year, article: entity.replace(/ /g, "_") });
    }
  }
  return { ok: true, rows: [...latest.values()] };
}

export async function harvestOne(def) {
  const result =
    def.source.kind === "wikidata" ? await harvestWikidata(def.source)
    : def.source.kind === "owid" ? await harvestOwid(def.source)
    : { ok: false, error: `unknown source kind "${def.source.kind}"` };

  if (!result.ok) return result;

  const rows = result.rows.sort((a, b) => b.value - a.value);
  const table = { ...def, source: undefined, harvestedAt: new Date().toISOString(), rows };
  delete table.source;
  return { ok: true, table };
}

export async function harvest({ only = null } = {}) {
  const targets = only ? [tableById(only)].filter(Boolean) : tables;
  if (only && targets.length === 0) throw new Error(`no table with id "${only}"`);

  const report = [];
  for (const def of targets) {
    process.stdout.write(`  ${def.id} … `);
    const result = await harvestOne(def);
    if (!result.ok) {
      console.log(`FAILED (${result.error})`);
      report.push({ id: def.id, ok: false, error: result.error });
      continue;
    }
    await saveTable(result.table);
    const n = result.table.rows.length;
    console.log(`${n} rows${n < 20 ? "  ⚠ suspiciously few — check the query" : ""}`);
    report.push({ id: def.id, ok: true, rows: n });
  }
  return report;
}
