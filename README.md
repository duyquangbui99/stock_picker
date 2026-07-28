# Quality Stock Picker

A research tool for building a **20-position portfolio of small-to-mid-cap stocks
($300M–$10B)**, accumulated slowly with small regular buys.

It is not a stock screener. A screener tells you what moved today. This runs a
skeptical fundamentals analyst over a handful of candidates, scores every one of
them against a fixed rubric, and ranks them against picks from previous days — so
the money goes to the best name you have found *so far*, not the most interesting
name of the moment.

> **Not financial advice.** Every report is an automated summary of public
> information, and the scores are model judgements rather than audited data.
> Verify the figures before acting on any of them.

---

## The idea

A single day's pick is not a portfolio. Run a "best stock today" tool for a year
and you get 365 unrelated names. Four things bridge that gap:

1. **Score every candidate, not just the winner.** Each run evaluates several
   names and rejects most. The rejects are scored too, which is what makes a pick
   from March comparable to one from July.
2. **Gate on business facts, never on research gaps.** Going-concern language,
   runway under ~2 quarters, negative organic growth, or a *verified* market cap
   outside the range make a name ineligible whatever it scored. A figure you
   simply could not confirm is different — that is `data_completeness`, ranked
   below verified names but above rejected ones.
3. **Carry knowledge between runs.** Each run is told what earlier runs settled,
   which names remain unresolved, where its own record contradicts itself, and
   what it recently picked. Without this it re-researched the same names daily.
4. **Accumulate, then deploy.** Save ~$5/day and deploy ~$35 weekly into the
   top-ranked eligible name. 52 decisions a year instead of 365.

Target is **20 positions** — roughly $90/position/year at that savings rate, most
of the diversification benefit, and few enough to re-check.

---

## Setup

```sh
npm install
```

That is all. The default backend runs through your existing **Claude Code login**,
so no API key is required. Needs Node 20.12+ and the `claude` CLI on your PATH.

---

## Daily use

```sh
npm start
```

Researches a candidate, ingests the scores, rebuilds the ranking, serves both
dashboards at `http://localhost:4321`, and opens a browser. Ctrl-C stops it.
Takes a few minutes, almost all of it research.

Two tabs: **Portfolio** (what you hold) and **Reports & ranking** (what to buy
next).

```sh
npm start -- --no-pick             # skip research, just rebuild and serve
npm start -- --focus "no biotech"  # any other flag forwards to `pick`
```

Run it 2–3× a week. **Weekly**, take the top eligible name off the ranking, buy
~$35, and record it on the Portfolio tab. If the research step fails (rate limit,
credit), the rest still runs on the reports you already have.

| Command | What it does |
|---|---|
| `npm start` | The whole cycle: research → scores → ranking → serve |
| `npm start -- --no-pick` | Same, minus the research |
| `npm run pick` | One screen. `-- --save` writes `reports/<date>.md` |
| `npm run scoreboard` | Ingest scorecards, print the ranking |
| `npm run dashboard` | Rebuild `reports/index.html` |
| `npm run portfolio` | Serve the portfolio tracker only |

Flags for `pick` go **after `--`** — `npm run pick --save` silently drops the flag.

| Flag | |
|---|---|
| `-f, --focus <text>` | extra constraint, e.g. `"re-verify ISTR"` |
| `-e, --effort <level>` | `low · medium · high · xhigh · max` (default `medium`) |
| `-b, --backend <name>` | `claude-cli` (default) or `api` |
| `-s, --save` | also write `reports/<date>.md` |
| `-v, --verbose` | show the analyst's running commentary |

---

## How a name is judged

**Sources are tiered.** SEC filings and IR releases are unrestricted; screeners
and aggregators (simplywall.st, stocktitan, stockanalysis…) are **lead generation
only and may never be the sole source for a scorecard figure**. Market cap must be
*reconciled* — share count from the latest 10-Q cover page × a verified price —
not copied. Insider claims need a Form 4; a buyback is not insider buying. Every
aggregator earnings figure gets a GAAP-vs-adjusted check, and analyst price
targets only count if they are dated and current.

Each rule exists because the tool got it wrong once: an aggregator reported
+$1.7M net income for a company whose GAAP result was a **-$20.1M loss**, and a
"high insider confidence" name turned out to be doing buybacks.

**Scores total 100**, with explicit bands per dimension so a 67 in July means what
a 67 meant in March:

| Dimension | Max | Measures |
|---|---|---|
| `survival` | 25 | Cash vs burn, debt due within 12 months, runway, dilution |
| `growth_quality` | 25 | Revenue trend and durability — organic vs acquired |
| `profitability` | 20 | Margin trend and cash generation |
| `insider_conviction` | 15 | Pattern and size of insider buying, price paid vs today |
| `valuation_gap` | 15 | Valuation vs peers, and whether the news is already priced |

On acquisitions: acquisition-driven growth is a **score penalty**, not a gate —
"did they break out organic growth" is a disclosure choice, and gating on it would
reward silence. **Negative organic growth is the gate**, because a shrinking
underlying business is a fact you can check every run.

**Ranking order:** eligible → fresh → fully sourced → by total. Concretely:
eligible-verified, then partial, then unverified, then stale (>30 days), then
ineligible. `scoreboard.json` is **append-only** — nothing is overwritten, so you
keep the history of how a view of a company changed.

Hover a score for its breakdown, how much it has drifted between runs, and where
it would rank on score alone. A `▾N` marker means the tiers held a name back.

---

## Portfolio tracker

Add a position (ticker, shares, buy price, buy date) and edit the **Current** price
cell as prices move. Data lives in `portfolio.json` — no database, gitignored.

- **Multiple buys of one ticker roll up into one position** with a share-weighted
  average cost. Expand the row to see each buy.
- The chart plots market value against cost basis, built from one snapshot per day
  when you update prices — so **the line appears on your second day**. There is no
  back-fill; the app has no source of historical prices.
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

The CLI backend **strips `ANTHROPIC_API_KEY` from the subprocess environment**.
Without that, `npm start` loads `.env`, the child `claude` process inherits the
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
bin/portfolio.js            local server, portfolio.json, serves both pages
dashboard.html              portfolio UI

src/config.js               backends, effort, budgets, position target
src/prompt.js               loads the system prompt, builds the per-run task
src/coverage.js             what earlier runs settled, as a prompt block
src/backends/claude-cli.js  headless `claude -p`, parses its event stream
src/backends/api.js         Messages API, streaming + pause_turn resume
src/render.js               progress → stderr, report → stdout
src/report-model.js         parses a saved report and its scorecard
src/rank.js                 collapses score history into the current ranking
src/dashboard-html.js       page + styles for the reports dashboard
```

The analyst persona, sourcing rules, and scoring rubric live in
[`stock_picker_system_prompt.md`](stock_picker_system_prompt.md) — edit that file
to change how the analyst thinks; no code changes needed.

Both backends return the same `{ report, sources, usage, refusal }`, so nothing
downstream knows which one ran.

---

## Things that will bite you otherwise

- **Reports are never overwritten.** A second run on the same day saves as
  `2026-07-27-2.md`. Each run keeps its own prose and its own scoreboard id.
- **Anything matching `YYYY-MM-DD[-N].md` in `reports/` is ingested as a run.**
  Keep backups elsewhere — a copy named `-phaseA.md` was once read as a real screen.
- **Deleting a report never cleans the scoreboard.** Scores are already extracted
  and stay; you would only lose the reasoning behind them.
- **New rules only bind on re-score.** Gates live in the prompt, so a name scored
  before a rule existed keeps its old verdict until a run re-examines it. Force it
  with `npm start -- --focus "re-verify TICKER"`.
- **`npm run -s pick`** when redirecting to a file — without `-s`, npm prepends
  two banner lines to stdout.
- The search budget (`MAX_SEARCHES`, default 15) is stated in the prompt, not
  enforced. It was 40 once; that run cost real money and finished no better.
- `reports/`, `portfolio.json`, `scoreboard.json` and `.env` are gitignored.

---

## Limitations

- **This cannot be backtested.** No historical price source, so the rubric starts
  as an unvalidated hypothesis. The only honest validation is forward tracking:
  every score is kept, so picks can eventually be compared against outcomes.
- **Scores drift.** The same company has scored 67 and then 36 across runs on
  unchanged fundamentals. The tooltip shows the delta — treat gaps of a few points
  as noise, not a ranking.
- **The tiers can outrank the score.** A well-sourced 56 sits above an unverified
  69 by design. That buys the best-*researched* name, not necessarily the best one;
  the `▾N` marker shows when it is happening.
- **Sector concentration is visible, not enforced.** Two regional banks have sat in
  the top four. Check it at deploy time.
- **Nothing re-checks a holding after you buy it.** Periodic re-review against the
  stated exit conditions is designed but not built.
- **Allocation is manual.** You read the ranking and decide. `bin/allocate.js` is
  specified but deliberately unbuilt until the scores prove themselves.
- Whether any of this beats an index fund is unknown and untested.
