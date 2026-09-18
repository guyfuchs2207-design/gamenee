# Orders

A daily ranking puzzle. **Six things, one order, one attempt.**

Drag six things into what you think is the right order and lock it in. Every
item is either in its exact place or it isn't — there's no partial credit and no
second guess. Then you get the real order and the actual numbers behind it.

```
Orders #47 — 4/6 in place

🟩🟩⬜🟩⬜🟩
```

The last seven days stay open, so missing a day doesn't mean missing a puzzle.

---

## The design, and why

**One attempt.** The game is a judgement call you commit to, not a search you
narrow down. Removing the guess loop removes the feedback ladder with it: there
is no "close" colour, because a hint tier only means something when you get
another go.

**Exact placement or nothing.** An item is home or it isn't. Simple to state,
brutal to score, and it makes 4/6 genuinely worth something.

**The numbers are the reward.** The reveal is the product — the true order,
the real figures, where you went wrong, and the one fact that makes you go
*huh*. Everything before it exists to make you care about it.

**The share card spoils nothing.** One line, a score, no labels or values.
There's a test that enforces it.

### A quirk worth knowing

**5/6 is impossible.** One item out of place necessarily displaces another, so
real scores are 0, 1, 2, 3, 4 or 6. `tests/engine.test.mjs` pins this by
brute-forcing all 720 permutations, because the copy and the stats both assume
it.

## Running it

```bash
npm run dev      # http://localhost:5173
npm test         # validates the puzzle library, then runs the unit tests
npm run build    # regenerates public/pack.js from data/puzzles.mjs
```

No dependencies. The front end is plain ES modules — no build step, no
framework, no external requests, which is why it loads instantly.

`npm run dev` deliberately returns 503 for `/api/*`. That's the offline path the
game is built to survive; use `npx wrangler dev` in `worker/` for the real
backend.

## Layout

```
public/            the deployed site
  index.html
  styles.css
  pack.js          GENERATED — base64 puzzle pack, do not edit
  src/
    engine.js      pure rules: scoring, daily selection, dates, archive range
    main.js        app controller, rendering, one-shot flow, archive routing
    dragList.js    pointer-events reordering (mouse, touch, keyboard)
    storage.js     per-puzzle plays, drafts, derived record
    share.js       the share card
    api.js         backend client — every call degrades to null
    pack.js        decoder for the bundled fallback pack
    config.js      name, tagline, share URL, API origin
data/puzzles.mjs   the puzzle library — the source of truth
worker/            Cloudflare Worker + D1 stats backend
scripts/           build, validation, dev server
tests/             node:test suites, no test framework needed
```

## The archive

`?d=N` loads puzzle N. The archive sheet lists the last seven days, newest
first, bounded at puzzle #1 so a freshly launched game never offers a day that
did not happen. Navigation uses `pushState`, so browser back works and a link to
a specific day is shareable.

Two rules hold across the archive:

- **A puzzle can only be played once**, ever. `recordPlay` ignores a repeat
  submission, so going back for an old day cannot rewrite a result or inflate
  an average.
- **Only released puzzles are reachable.** The client clamps `?d=`, and the
  Worker independently refuses anything past its own clock — so a device with
  its date set forward cannot pull tomorrow's answers.

Change the window with `ARCHIVE_DAYS` in `public/src/engine.js`.

## Adding puzzles

Append to `data/puzzles.mjs`, then run `npm run build`.

```js
{
  id: 61,
  prompt: "Hours slept per day",   // shown large; keep under ~60 chars
  hint: "most → least",            // what rank #1 means
  unit: "hours",
  items: [                         // IN CORRECT ORDER — index 0 is rank #1
    { label: "Koala", value: "22 hours" },
    // ...exactly six
  ],
  source: "Comparative sleep studies, NIH",
  fact: "Giraffes sleep in five-minute bursts, usually standing up.",
}
```

`npm run validate` (which `npm test` runs first) catches duplicate ids, wrong
item counts, missing sources, labels too long to lay out, and **ties** — two
items with the same value would leave the puzzle with no single correct answer.

What it cannot check is whether your ordering is *right*, because `value` is a
display string by design (it has to hold both `"1 in 292,201,338"` and
`"243 Earth days"`). Ordering is on the author.

A good puzzle is **surprising but arguable**. The fun is "wait, hippos kill more
people than sharks?"; the frustration is two items nobody could separate. Spread
the magnitudes out — with one attempt and exact-only scoring, a puzzle with two
near-identical values is just a coin flip.

### Growing the library

Hand-authoring does not scale past a launch — 365 puzzles a year is 2,190
verified facts. `pipeline/` harvests ranked tables from structured sources
(Wikidata, Our World in Data), scores candidate six-item sets for
recognisability, separation and surprise, and hands a human a ranked review
queue instead of a blank page.

```bash
npm run pipeline:harvest && npm run pipeline:enrich
npm run pipeline:build && npm run pipeline:review
```

Because a puzzle is six rows from **one** table, every item shares a unit, a
vintage and a citation — which makes the cross-source ordering mistakes
described below impossible by construction. See `pipeline/README.md`.

### On the numbers

The 60 shipped puzzles were authored from the sources cited on each one and are
rounded approximations, mostly 2024–25 vintage. Five ordering errors and one tie
were caught and corrected during authoring, which is a decent argument for a
second pair of eyes. **Fact-check the library before you publish**, and re-check
the ones that drift — populations, box office, user counts, prices and emissions
all move. The evergreen ones (planetary data, melting points, letter
frequencies) don't.

## Deploying

### Static only (no global stats)

`public/` is a plain static directory — push it to GitHub Pages, Netlify, Vercel
or anything else. The game is fully playable: API calls fail, return null, and
it falls back to the bundled pack. You lose only the "average today is 3.1/6"
line.

### With the stats backend

One Cloudflare Worker serves both the static site and the API, so there's no
CORS setup and no second host.

```bash
cd worker
npx wrangler d1 create orders            # copy the database_id into wrangler.toml
npx wrangler d1 execute orders --remote --file=./schema.sql
npx wrangler secret put HASH_SALT        # any long random string
npx wrangler deploy
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/puzzle?n=N` | One released puzzle. Preferred over the bundled pack, which necessarily ships every future answer to every visitor. |
| `POST /api/result` | Records a score, returns the puzzle's average and your percentile. |
| `GET /api/stats?n=N` | Reads the aggregate without contributing to it. |

**On privacy:** the database holds aggregate counts plus a salted, truncated
SHA-256 of the caller's IP, used only to stop one client submitting the same
puzzle twice. Raw addresses are never written, dedup rows are pruned after 60
days, and there is no cookie, account or cross-day identifier.

**On trust:** scoring happens client-side, so submitted results are
self-reported and the global numbers are a fun statistic, not a leaderboard. If
you want them authoritative, move scoring into the Worker and keep the answers
server-side — the engine is already pure and shared by both.

## Renaming it

`public/src/config.js` holds the name, tagline and share URL. Also update the
`<title>` and Open Graph tags in `public/index.html`, and the URL in
`public/sitemap.xml`.

## Before you launch

- [ ] Fact-check the puzzle library (see above).
- [ ] Set `EPOCH` in `public/src/engine.js` to your launch date — it decides
      which puzzle is #1. It currently sits a week in the past so the archive
      has something in it from day one; with a same-day epoch the archive
      correctly shows a single entry.
- [ ] Set `SHARE_URL` in `config.js` to your real domain.
- [ ] Add a real Open Graph image. The link preview does a lot of the work when
      someone drops the URL into a group chat, and right now there isn't one.
- [ ] Keep authoring. The library cycles and re-shuffles each lap so it never
      runs dry, but returning players will eventually see a repeat.
