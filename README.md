# Quality Stock Picker

A research tool for building a **20-position portfolio of small-to-mid-cap stocks
($300M–$10B)**, accumulated slowly with small regular buys.

It is not a stock screener. A screener tells you what moved today. This runs a
skeptical fundamentals analyst over a handful of candidates, scores every one of
them, and ranks them against picks from previous days — so the money goes to the
best name you have found *so far*, not the most interesting name of the moment.

> **Not financial advice.** Every report is an automated summary of public
> information, and the scores are model judgements rather than audited data.
> Verify the figures before acting on any of them.

---

## The idea

A single day's pick is not a portfolio. Run a "best stock today" tool for a year
and you get 365 unrelated names, which is the opposite of a considered portfolio.
Three things bridge that gap:

1. **Score every candidate, not just the winner.** Each run evaluates 5–8 names
   and rejects most of them. Those rejects are scored too, which is what makes a
   pick from March comparable to one from July.
2. **Hard eligibility gates.** Going-concern language, cash runway under ~2
   quarters, or a *verified* market cap outside the range make a name ineligible
   **whatever it scored** — a 90 with a going-concern note ranks below an
   eligible 60. A figure you simply could not verify is different: that is
   tracked as `data_completeness`, ranked below verified names but above
   rejected ones. A research gap is not a finding.
3. **Accumulate, then deploy.** Save ~$5/day and deploy ~$35 weekly into the
   top-ranked eligible name. 52 decisions a year instead of 365, larger
   increments, and the screen only needs to run 2–3×/week.

Target is **20 positions** — roughly $90/position/year at that savings rate, most
of the diversification benefit, and few enough names that every holding can
realistically be re-checked.

---

## Setup

```sh
npm install
```

That is all. The default backend runs through your existing **Claude Code login**,
so no API key is required.

Requires Node 20.12+ and the `claude` CLI on your PATH.

---

## The workflow

**One command does everything:**

```sh
npm start
```

That researches a new candidate, ingests the scores, rebuilds the ranking, then
serves the dashboard at `http://localhost:4321` and opens a browser. Two tabs:
**Portfolio** (what you hold) and **Reports & ranking** (what to buy next).
Ctrl-C stops it. Takes a few minutes, mostly the research.

```sh
npm start -- --no-pick            # skip the research, just rebuild and serve
npm start -- --focus "no biotech" # any other flag is forwarded to `pick`
```

Run it 2–3× a week. **Weekly**, take the top eligible name off the ranking, buy
~$35 of it, and record the buy on the Portfolio tab.

If a research step fails (rate limit, credit), the rest still runs — you keep the
dashboard on the reports you already have.

**Whenever prices move** — update the Current price cells in the portfolio to keep
the value chart current.

> Allocation is still a manual read of the ranking. A `bin/allocate.js` that
> applies the rule automatically (new position only if it beats your median
> holding, else top up the best existing one) is designed but deliberately not
> built until the scores have been sanity-checked against real reports.

---

## Commands

| Command | What it does |
|---|---|
| `npm start` | The whole cycle: research → scores → ranking → serve both dashboards |
| `npm start -- --no-pick` | Same, minus the research step |
| `npm run pick` | Run one screen. Add `-- --save` to write `reports/<date>.md` |
| `npm run scoreboard` | Ingest scorecards into `scoreboard.json`, print the ranking |
| `npm run dashboard` | Rebuild `reports/index.html` (reports + ranking table) |
| `npm run portfolio` | Start the portfolio tracker on `http://localhost:4321` |

Flags for `pick` go **after `--`** — `npm run pick --save` silently drops the flag.

| Flag | |
|---|---|
| `-f, --focus <text>` | extra constraint for this run, e.g. `"no biotech"` |
| `-e, --effort <level>` | `low · medium · high · xhigh · max` (default `medium`) |
| `-b, --backend <name>` | `claude-cli` (default) or `api` |
| `-s, --save` | also write `reports/<date>.md` |
| `-v, --verbose` | show the analyst's running commentary |
| `-h, --help` | list the flags |

Progress goes to stderr and the report to stdout, so `npm run -s pick > today.md`
gives a clean file. The `-s` matters — without it npm prepends two banner lines.

---

## How scoring works

Each run emits a `SCORECARD` json block covering every candidate it researched.
Scores total 100:

| Dimension | Max | Measures |
|---|---|---|
| `survival` | 25 | Cash vs burn, debt due within 12 months, runway, dilution risk |
| `growth_quality` | 25 | Revenue trend and its durability — organic vs acquired, recurring vs one-time |
| `profitability` | 20 | Margin trend and cash generation |
| `insider_conviction` | 15 | Pattern and size of insider buying, price paid vs today |
| `valuation_gap` | 15 | Valuation vs peers, and whether the news is already priced in |

Every dimension is something the analyst already assessed in prose — the
scorecard only records it in comparable form.

**Ranking order:** eligible → fresh → fully sourced → by total. Concretely:
eligible-verified, then partial, then unverified, then stale (>30 days), then
ineligible. `scoreboard.json` is **append-only**, so re-running never overwrites or
duplicates and you keep the history of how a view of a company changed.

A run typically scores 6–9 names, most of them eligible, so the ranking fills
faster than the portfolio does. Every run also receives a summary of what earlier
runs settled, so it stops re-researching names already decided.

---

## Portfolio tracker

```sh
npm run portfolio
```

Add a position (ticker, shares, buy price, buy date) and edit the **Current** price
cell as prices move. Data lives in `portfolio.json` — no database, gitignored.

- **Multiple buys of one ticker roll up into a single position** with a
  share-weighted average cost. Expand the row to see each individual buy.
- The chart plots market value against cost basis over time, built from one
  snapshot per day whenever you update prices — so **the line appears on your
  second day** of updates. There is no back-fill; the app has no source of
  historical prices.
- Prices are entered by hand. Nothing here fetches live quotes.
- Gain/loss always carries a ▲/▼ and a signed number, never colour alone.

---

## Backends

| | `claude-cli` (default) | `api` |
|---|---|---|
| Auth | your Claude Code login | `ANTHROPIC_API_KEY` |
| Cost | your Claude Code plan | billed API usage |
| Tools | WebSearch + WebFetch | web_search + web_fetch |
| Caching | automatic | `cache_control` on the request |

`claude-cli` is the default because in a head-to-head it was faster, cheaper, and
produced a complete report where the API path was still grinding: 14 searches and
145s versus 36 and climbing.

The CLI backend **strips `ANTHROPIC_API_KEY` from the subprocess environment**.
Without that, `npm run pick` loads `.env`, the child `claude` process inherits the
key, and Claude Code bills API credits instead of using your login — silently
defeating the point of the backend.

For the API backend, put a key in `.env` (gitignored):

```sh
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
npm run pick -- --backend api
```

---

## Layout

```
bin/daily.js                one command: research → scores → ranking → serve
bin/pick.js                 CLI: flags in, report out
bin/scoreboard.js           ingests scorecards, ranks candidates
bin/dashboard.js            builds reports/index.html
bin/portfolio.js            local server + portfolio.json persistence
dashboard.html              portfolio UI (served by bin/portfolio.js)

src/config.js               backends, effort, search budget, position target
src/prompt.js               loads the system prompt, builds the per-run task
src/backends/claude-cli.js  headless `claude -p`, parses its event stream
src/backends/api.js         Messages API, streaming + pause_turn resume
src/render.js               progress → stderr, report → stdout
src/report-model.js         parses a saved report and its scorecard
src/rank.js                 collapses score history into the current ranking
src/coverage.js             what earlier runs settled, as a prompt block
src/dashboard-html.js       page + styles for the reports dashboard
```

The analyst persona, process, and scoring rubric live in
[`stock_picker_system_prompt.md`](stock_picker_system_prompt.md) — edit that file
to change how the analyst thinks; no code changes needed.

Both backends return the same `{ report, sources, usage, refusal }`, so nothing
downstream knows which one ran.

---

## Design decisions worth knowing

- **stdout is the report, stderr is progress**, so redirection gives a clean file.
- **Every number must come from a search in that session.** The prompt forbids
  recalling prices or financials from memory.
- **Search budget is 15** (`MAX_SEARCHES`), stated in the prompt rather than
  enforced. It was 40 once; that run cost real money and finished no better than
  a 14-search one.
- **Sources are filtered to URLs the report actually cites** — a run sees ~190
  links and leans on ~15.
- **The dashboard embeds everything** in one file, because a page opened over
  `file://` cannot `fetch()` sibling files.
- **The markdown converter handles only what these reports contain** — headings,
  bullets, bold, italic, links, code spans. Tables and images pass through as
  plain text.
- `reports/`, `portfolio.json`, `scoreboard.json`, and `.env` are all gitignored.

---

## Limitations

- **This cannot be backtested.** There is no historical price source, so the
  scoring rubric starts as an unvalidated hypothesis. The only honest validation
  is forward tracking: every score is kept, so after some months the picks can be
  compared against real outcomes in the portfolio tracker.
- **$300M–$10B reduces failure risk but does not remove it.** The eligibility
  gates do more work here than either the cap range or the position count.
- **Candidates are sometimes marked ineligible for missing data** rather than for
  failing a test — a name eliminated early on fundamentals may never have had its
  market cap verified. That is conservative, and self-corrects when a later run
  scores it properly.
- **Nothing here re-checks a holding after you buy it yet.** Periodic re-review
  with exit flags is designed but not built.
- Whether any of this beats an index fund is unknown and untested.
