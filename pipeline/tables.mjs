/**
 * The source registry — what to harvest.
 *
 * One entry = one ranked table = one metric. A puzzle is six rows sampled from
 * a single entry, which is the point: same units, same vintage, same source.
 * That makes the cross-source ordering mistakes that hand-authoring produces
 * impossible by construction.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VERIFY THESE BEFORE TRUSTING THEM. The queries below follow the conventional
 * Wikidata shape, but the property and class IDs were written without a
 * reachable endpoint to test against (see pipeline/README.md). Run
 * `npm run pipeline:harvest -- --only <id>` on each and check the row count and
 * a few values before the output reaches a player. A wrong property ID usually
 * shows up as zero rows or absurd values, not as silence.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Wikidata scaffolding: pull an entity class, a numeric property, and the enwiki article. */
const wikidata = (classQid, valueProp, { instanceOf = "wdt:P31", limit = 400, extra = "" } = {}) => ({
  kind: "wikidata",
  query: `SELECT ?item ?itemLabel ?value ?article WHERE {
  ?item ${instanceOf} wd:${classQid} .
  ?item wdt:${valueProp} ?value .
  ${extra}
  ?article schema:about ?item ;
           schema:isPartOf <https://en.wikipedia.org/> .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?value)
LIMIT ${limit}`,
});

/** Our World in Data grapher CSV: Entity, Code, Year, <value column>. */
const owid = (slug) => ({ kind: "owid", slug });

export const tables = [
  {
    id: "country-population",
    prompt: "Country population",
    hint: "most → least",
    unit: "people",
    category: "countries",
    volatility: "volatile",
    format: { kind: "compact" },
    source: wikidata("Q3624078", "P1082"),
    sourceNote: "Wikidata P1082 (population)",
  },
  {
    id: "country-area",
    prompt: "Land area",
    hint: "largest → smallest",
    unit: "km²",
    category: "countries",
    volatility: "evergreen",
    format: { kind: "compact", suffix: " km²" },
    source: wikidata("Q3624078", "P2046"),
    sourceNote: "Wikidata P2046 (area)",
  },
  {
    id: "mountain-elevation",
    prompt: "Height above sea level",
    hint: "tallest → shortest",
    unit: "metres",
    category: "geography",
    volatility: "evergreen",
    format: { kind: "number", suffix: " m" },
    source: wikidata("Q8502", "P2044"),
    sourceNote: "Wikidata P2044 (elevation above sea level)",
  },
  {
    id: "river-length",
    prompt: "Length of the river",
    hint: "longest → shortest",
    unit: "km",
    category: "geography",
    volatility: "evergreen",
    format: { kind: "number", suffix: " km" },
    source: wikidata("Q4022", "P2043"),
    sourceNote: "Wikidata P2043 (length)",
  },
  {
    id: "film-box-office",
    prompt: "Worldwide box office",
    hint: "most → least",
    unit: "US$",
    category: "film",
    volatility: "volatile",
    format: { kind: "compact", prefix: "$" },
    source: wikidata("Q11424", "P2142"),
    sourceNote: "Wikidata P2142 (box office)",
  },
  {
    id: "building-height",
    prompt: "Height of the building",
    hint: "tallest → shortest",
    unit: "metres",
    category: "buildings",
    volatility: "evergreen",
    format: { kind: "number", suffix: " m" },
    source: wikidata("Q41176", "P2048"),
    sourceNote: "Wikidata P2048 (height)",
  },
  {
    id: "co2-per-capita",
    prompt: "CO₂ emissions per person",
    hint: "most → least",
    unit: "tonnes per person / year",
    category: "countries",
    volatility: "volatile",
    format: { kind: "number", suffix: " t", decimals: 1 },
    source: owid("co-emissions-per-capita"),
    sourceNote: "Our World in Data, Global Carbon Project",
  },
  {
    id: "life-expectancy",
    prompt: "Life expectancy at birth",
    hint: "highest → lowest",
    unit: "years",
    category: "countries",
    volatility: "volatile",
    format: { kind: "number", suffix: " years", decimals: 1 },
    source: owid("life-expectancy"),
    sourceNote: "Our World in Data, UN World Population Prospects",
  },
];

export const tableById = (id) => tables.find((t) => t.id === id);
