# Puzzle pipeline

Finds things worth ranking, so the library can grow past what one person can
hand-author.

Hand-authoring the first 60 puzzles produced **five ordering errors and one
tie** — all from assembling six items out of six different mental sources with
different units and vintages. This pipeline's central idea removes that whole
error class: **a puzzle is six rows sampled from one ranked table**, so every
item shares a unit, a vintage and a citation by construction.

The second idea is leverage. One table ("countries by X") yields dozens of
puzzles, so the unit of work becomes the table, not the puzzle.

## Run it

```bash
npm run pipeline:harvest     # 1. fetch ranked tables from structured sources
npm run pipeline:enrich      # 2. attach Wikipedia pageview "fame" scores
npm run pipeline:build       # 3-4. sample candidates, score, write the queue
npm run pipeline:review      # print the queue for a human
#    …edit pipeline/state/queue.json…
npm run pipeline:approve     # 6. append approved entries to data/puzzles.mjs
npm run build && npm test    # rebuild the pack, run the validator
```

Set a contact address first — Wikimedia throttles anonymous clients:

```bash
export PIPELINE_CONTACT="you@example.com"
```

Everything is cached to `pipeline/state/` (gitignored), so re-running is cheap
and each stage can be re-run alone.

## ⚠ Verify the queries on first run

**The Wikidata property and class IDs in `tables.mjs` are unverified.** They
were written without a reachable endpoint to test against, so treat the first
harvest as a smoke test:

```bash
npm run pipeline:harvest -- --only country-population
```

A wrong property ID shows up as zero rows or absurd values, not as a silent
error — the harvester warns when a table returns suspiciously few rows. Fix the
query and re-run before anything reaches a player.

## The stages

**1. Harvest** — `harvest.mjs`, sources declared in `tables.mjs`. Two adapters:
Wikidata SPARQL and Our World in Data CSV. Output is normalised to
`{entity, key, value, article}` sorted descending. Adding a metric is a few
lines in `tables.mjs`.

**2. Enrich** — `enrich.mjs`. Attaches mean monthly English Wikipedia pageviews
per entity. This is the highest-value filter in the pipeline: structured
sources are full of entities that are real, correctly valued, and completely
unknown. **A puzzle is only as playable as its most obscure item.**

**3. Sample** — `sample.mjs`. Builds candidate six-item sets under three
constraints:

| Constraint | Default | Why |
|---|---|---|
| fame floor | 20,000 views/mo | every item must be recognisable |
| separation | ≥1.35× between neighbours | see below — this one is load-bearing |
| size | 6 | the board |

**Separation matters more here than it would in a forgiving game.** Under
exact-placement scoring, two items a few percent apart are a coin flip nobody
can win, and losing the flip costs **two** points because swapping displaces
both. Hand-authoring, this was eyeballed; here it's a hard gate.

**4. Score** — `score.mjs`. Ranks candidates on four signals:

- **surprise** (40%) — Spearman correlation between fame-rank and value-rank,
  inverted. If fame predicts the ranking, everyone guesses right and the puzzle
  is dull. The famous item being the *smallest* is the whole "sharks kill
  almost nobody" effect.
- **separation** (25%) — how knowable the gaps are
- **fame** (20%) — driven by the *weakest* item
- **spread** (15%) — orders of magnitude covered

Then a greedy **diversity pass**, because sampling one table produces many
near-identical sets and a queue containing the same puzzle five times wastes
the only scarce resource here: reviewer attention.

**4b. Judge (optional)** — `judge.mjs`, `--judge`. Shows Claude *only the
labels and the metric*, never the values, and asks it to order them. Several
trials give a predicted player score, which is used to reject puzzles that are
trivially easy or pure guesswork. Trials vary by **shuffling how the labels are
presented** rather than by temperature — sampling parameters are rejected on
current models, and shuffling also cancels positional bias.

> **The model never supplies a number.** It is a stand-in player, nothing else.
> Every value comes from the harvested table. Model-recalled figures are
> confidently wrong often enough to quietly poison a library, and a wrong value
> is invisible — it just makes the "correct" order incorrect.

Needs `ANTHROPIC_API_KEY` or `ant auth login`; without either, the pipeline
ranks on the arithmetic signals alone and says so.

**5. Review — human, not automated.** `npm run pipeline:review` prints the
queue; approving is editing `pipeline/state/queue.json`: set `approved: true`
and write the `fact`. No UI to learn, and the diff is reviewable.

At a 1-in-3 approval rate this is roughly **30 minutes a week for a year of
puzzles**.

**6. Approve** — `approve.mjs`. Refuses anything with no `fact`, no source,
duplicate values (no single correct order), or rows out of descending order,
then appends to `data/puzzles.mjs` with fresh ids and records the entities in
the ledger.

## Drift and repetition

Each table is tagged `evergreen` (melting points, elevations) or `volatile`
(populations, box office, emissions). Re-harvest periodically and diff: a
volatile puzzle whose *ordering* changed needs pulling.

The **ledger** (`pipeline/state/ledger.json`) records which entities have
shipped and when. Candidates reusing an entity from the last 45 days are damped
so the same six famous animals don't recur.

## Limits worth knowing

- **Ratio-based separation assumes positive values.** A signed metric
  (temperature, latitude) needs a different rule; the sampler filters those out
  rather than scoring them wrongly.
- **Pageviews measure English-language fame.** A globally significant entity
  with a thin English article scores low.
- **The best puzzles are often cultural** — most-streamed songs, most-followed
  accounts — and aren't in clean structured data. Keep authoring those by hand.
  The pipeline is for bulk, not for gems.
- **Nothing here checks that a value is true**, only that it is internally
  consistent and well-sourced. The human review step is not optional.

## Testing

`tests/pipeline.test.mjs` covers every stage after HTTP against fixtures in
`tests/fixtures/`, including a full end-to-end run: harvested table → queue →
approved puzzle in the library. The network is the only part the fixtures
cannot stand in for.
