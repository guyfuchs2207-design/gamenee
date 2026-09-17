# Rankle

A daily ranking puzzle. **Six things, one hidden order, four tries.**

Drag the rows into what you think is the right order and submit. Each row tells
you how close that item is to its true position — 🟩 exactly right, 🟨 one place
off, ⬜ two or more places off. Get all six green to win. New puzzle every day.

```
Rankle #47 3/4

🟩⬜🟨🟨⬜🟩
🟩🟨🟩⬜🟩🟨
🟩🟩🟩🟩🟩🟩
```

---

## Why this shape

Everything here is in service of the share card. The daily games that spread do
it because a spoiler-free result grid is something people *want* to post, and
the game exists to produce one:

- **One puzzle a day, same for everyone** — gives people a reason to talk.
- **Under two minutes** — the cost of playing has to stay near zero.
- **The grid spoils nothing** — there's a test that enforces this. A friend who
  hasn't played yet learns only how hard you found it.
- **No signup, no backend required to play** — page opens, game starts.
- **A streak to protect** — the reason day 2 happens.
- **The reveal teaches you something** — the true order with real numbers and a
  fact is the part people screenshot.

## Running it

```bash
npm run dev      # http://localhost:5173
npm test         # validates the puzzle library, then runs the unit tests
npm run build    # regenerates public/pack.js from data/puzzles.mjs
```

There are no dependencies. The front end is plain ES modules — no build step,
no framework, no external requests, which is why it loads instantly.

`npm run dev` deliberately returns 503 for `/api/*`. That's the offline path
the game is designed to survive; to exercise the real backend, use
`npx wrangler dev` inside `worker/`.

## Layout

```
public/            the deployed site
  index.html
  styles.css
  pack.js          GENERATED — base64 puzzle pack, do not edit
  src/
    engine.js      pure game rules: grading, daily selection, dates
    main.js        app controller, rendering, round flow
    dragList.js    pointer-events reordering (mouse, touch, keyboard)
    storage.js     localStorage stats and in-progress board
    share.js       the emoji grid and share/copy handling
    api.js         backend client — every call degrades to null
    pack.js        decoder for the bundled fallback pack
    config.js      name, share URL, API origin
data/puzzles.mjs   the puzzle library — the source of truth
worker/            Cloudflare Worker + D1 stats backend
scripts/           build and validation
tests/             node:test suites, no test framework needed
```

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

A good puzzle is **surprising but arguable**: the fun is in "wait, hippos kill
more people than sharks?", and the frustration is in two items nobody could
separate. Spread the magnitudes out.

### On the numbers

The 60 shipped puzzles were authored from the sources cited on each one and are
rounded approximations, mostly 2024–25 vintage. Five ordering errors and one tie
were caught and corrected during authoring, which is a decent argument for a
second pair of eyes before launch. **Fact-check the library before you publish**,
and re-check the ones that drift — populations, box office, user counts, market
prices and emissions all move. The evergreen ones (planetary data, melting
points, letter frequencies) don't.

## Deploying

### Static only (no global stats)

`public/` is a plain static directory. Push it to GitHub Pages, Netlify, Vercel
or anything else. The game is fully playable — the API calls fail, return null,
and the game falls back to the bundled pack. You lose only the "you beat 73% of
players" line.

### With the stats backend

One Cloudflare Worker serves both the static site and the API, so there's no
CORS setup and no second host.

```bash
cd worker
npx wrangler d1 create rankle            # copy the database_id into wrangler.toml
npx wrangler d1 execute rankle --remote --file=./schema.sql
npx wrangler secret put HASH_SALT        # any long random string
npx wrangler deploy
```

The Worker exposes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/daily?n=N` | That day's puzzle. Preferred over the bundled pack because the pack necessarily ships every future answer to every visitor. |
| `POST /api/result` | Records a finished round, returns the day's distribution and your percentile. |
| `GET /api/stats?n=N` | Reads the distribution without contributing to it. |

**On privacy:** the database stores aggregate counts plus a salted, truncated
SHA-256 of the caller's IP, used only to stop one client submitting the same
puzzle twice. Raw addresses are never written, dedup rows are pruned after 30
days, and there is no cookie, account or cross-day identifier.

**On trust:** grading happens client-side, so submitted results are
self-reported and the global numbers are a fun statistic, not a leaderboard. If
you ever want them to be authoritative, move grading into the Worker and keep
the answers server-side — the engine is already pure and shared by both.

## Renaming it

`Rankle` is a placeholder you can change in one place: `public/src/config.js`
holds the name, tagline and share URL. Also update the `<title>` and Open Graph
tags in `public/index.html`, and the URL in `public/sitemap.xml`.

## Before you launch

- [ ] Fact-check the puzzle library (see above).
- [ ] Set `SHARE_URL` in `config.js` to your real domain.
- [ ] Set `EPOCH` in `public/src/engine.js` to your launch date — it decides
      which puzzle is #1.
- [ ] Add a real Open Graph image. The link preview does a lot of the work when
      someone drops the URL into a group chat, and right now there isn't one.
- [ ] Decide what happens after 60 days. The library cycles and re-shuffles each
      lap, so it never runs dry, but returning players will eventually see a
      repeat. Keep authoring.
