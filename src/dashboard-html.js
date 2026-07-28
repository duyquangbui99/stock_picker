import { esc, inline, md } from "./report-model.js";
import { MAX_POSITIONS, STALE_AFTER_DAYS } from "./config.js";

const DIMENSIONS = [
  ["survival", 25],
  ["growth_quality", 25],
  ["profitability", 20],
  ["insider_conviction", 15],
  ["valuation_gap", 15],
];

/**
 * One self-contained page indexing every saved report.
 *
 * Everything is embedded rather than fetched: the page is opened over file://,
 * where fetch() of sibling files is blocked by CORS.
 */
export function dashboard(reports, ranked = []) {
  const sorted = [...reports].sort((a, b) => b.date.localeCompare(a.date));
  const picks = sorted.filter((r) => r.pick);
  const investable = ranked.filter((r) => r.eligible && !r.stale);

  return page({
    stats: [
      tile(String(sorted.length), sorted.length === 1 ? "screen run" : "screens run"),
      tile(picks[0]?.pick.ticker ?? "—", "latest pick"),
      tile(`${investable.length}/${MAX_POSITIONS}`, "eligible & fresh"),
      tile(String(new Set(investable.map((r) => r.sector).filter(Boolean)).size || "—"), "sectors covered"),
    ].join(""),
    ranking: ranking(ranked),
    nav: sorted.map(navItem).join("") || `<p class="empty">No reports yet.</p>`,
    panels: sorted.map(panel).join("") || emptyState(),
  });
}

/** Cross-run ranking — the view that turns daily picks into a portfolio. */
function ranking(ranked) {
  if (ranked.length === 0) {
    return `<section class="card"><h2>Ranking</h2><p class="empty">
      No scores yet. Reports saved before the scorecard was added carry no scores —
      run <code>npm run pick -- --save</code> then <code>npm run scoreboard</code>.</p></section>`;
  }

  const rows = ranked
    .map((r, i) => {
      const bars = DIMENSIONS.map(([key, max]) => {
        const got = Number(r.scores?.[key] ?? 0);
        return `<span class="bar" title="${key.replace(/_/g, " ")}: ${got}/${max}">
          <span style="width:${Math.round((got / max) * 100)}%"></span></span>`;
      }).join("");

      // The badge stays short and fixed-width; the full reason wraps below it.
      // Putting a 170-character disqualifier inside a nowrap badge was setting
      // the width of the whole table.
      // A data gap is "needs another look", not a rejection — it must not wear
      // the same red badge as a going-concern finding.
      const gap = r.data_completeness && r.data_completeness !== "verified";
      const flag = !r.eligible
        ? `<span class="tag bad">✗ ineligible</span>`
        : r.stale
          ? `<span class="tag warn">stale ${r.ageDays}d</span>`
          : gap
            ? `<span class="tag info">${esc(r.data_completeness)}</span>`
            : "";
      const why =
        !r.eligible && r.disqualifier ? `<div class="why">${esc(r.disqualifier)}</div>` : "";
      const sector = r.sector ? `<div class="why">${esc(r.sector)}</div>` : "";

      return `<tr class="${r.eligible ? "" : "out"}">
        <td class="rk">${i + 1}</td>
        <td class="tkcell"><span class="tkr">${esc(r.ticker)}</span> ${flag}
            <div class="sub">${esc(r.company)}</div>${sector}${why}</td>
        <td class="tot">${r.total}</td>
        <td class="bars">${bars}</td>
        <td class="sub read">${esc(r.one_line)}</td>
        <td class="sub scored">${esc(r.as_of)}<div>${esc(r.confidence)}</div></td>
      </tr>`;
    })
    .join("");

  return `<section class="card"><h2>Ranking — all scored candidates</h2>
    <div class="rank-wrap"><table class="rank"><thead><tr>
      <th></th><th>Ticker</th><th>Total</th><th>Scores</th><th>Read</th><th>Scored</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <p class="sub note"><strong>Scores</strong> bars read left to right:
    survival · growth · profitability · insider conviction · valuation gap (hover for values).
    Ineligible names sort last whatever they scored; scores older than ${STALE_AFTER_DAYS} days
    rank below fresh ones. Scores are model judgements, not audited data.</p>
  </section>`;
}

const tile = (value, label) =>
  `<div class="tile"><div class="tile-v">${esc(value)}</div><div class="tile-l">${esc(label)}</div></div>`;

function navItem(r, i) {
  return `<button class="nav-item" role="tab" data-target="${esc(r.date)}"
    aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">
    <span class="nav-date">${esc(r.date)}</span>
    <span class="nav-ticker">${esc(r.pick?.ticker ?? "no pick")}</span>
    <span class="nav-company">${esc(r.pick?.company ?? "no candidate survived")}</span>
  </button>`;
}

function panel(r, i) {
  const p = r.pick;
  const numbers = (p?.numbers ?? [])
    .map((n) => `<div class="num"><dt>${esc(n.term || "—")}</dt><dd>${inline(n.detail)}</dd></div>`)
    .join("");

  return `<section class="panel" id="r-${esc(r.date)}" role="tabpanel" ${i === 0 ? "" : "hidden"}>
  ${
    p
      ? `<header class="pick-head">
           <div class="ticker">${esc(p.ticker)}</div>
           <div class="company">${esc(p.company)}</div>
           <div class="stamp">${esc(r.date)}</div>
         </header>
         ${p.thesis ? `<p class="thesis">${inline(p.thesis)}</p>` : ""}
         ${numbers ? `<h2>Key numbers</h2><dl class="numbers">${numbers}</dl>` : ""}
         ${callout("risk", "Main risk", p.risk)}
         ${callout("change", "What would change my mind", p.change)}
         ${p.disclaimer ? `<p class="disclaimer">${inline(p.disclaimer)}</p>` : ""}`
      : `<header class="pick-head"><div class="ticker">No pick</div>
           <div class="company">No candidate survived the fundamentals check</div>
           <div class="stamp">${esc(r.date)}</div></header>
         ${r.raw ? `<pre class="raw">${esc(r.raw)}</pre>` : ""}`
  }
  ${r.screen ? `<details class="fold"><summary>The screen — shortlist &amp; eliminations</summary>${md(r.screen)}</details>` : ""}
  ${r.sources ? `<details class="fold"><summary>Sources (${r.sourceCount})</summary>${md(r.sources)}</details>` : ""}
</section>`;
}

const callout = (kind, title, text) =>
  text ? `<aside class="callout ${kind}"><h3>${title}</h3>${md(text)}</aside>` : "";

const emptyState = () => `<section class="panel"><div class="empty">
  <p><strong>No reports yet.</strong></p>
  <p>Generate one with <code>npm run pick -- --save</code>, then rebuild this page
  with <code>npm run dashboard</code>.</p></div></section>`;

function page({ stats, ranking, nav, panels }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quality Screen — all reports</title>
<style>
:root {
  color-scheme: light dark;
  --bg:#fbfaf8; --panel:#fff; --ink:#1a1a1a; --muted:#6b6b6b;
  --line:#e6e3dd; --accent:#0f6b5c; --risk:#b4530a; --change:#2f5fa8; --hover:#f2f0ec;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#14161a; --panel:#1b1e23; --ink:#e8e6e3; --muted:#9aa0a6;
          --line:#2b2f36; --accent:#4ecab0; --risk:#e0913f; --change:#7aa7e8; --hover:#22262c; }
}
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:16px/1.65 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
.wrap { max-width:78rem; margin:0 auto; padding:2rem 1.25rem 4rem; }
h1 { font:600 1.15rem/1.2 ui-sans-serif,sans-serif; margin:0; }
.sub { color:var(--muted); font-size:.9rem; margin:.3rem 0 1.5rem; }
/* Links are absolute, so they resolve when served by bin/portfolio.js. Opened
   straight off disk the pages still read fine, but the tabs won't navigate. */
.tabs { display:flex; gap:.35rem; margin-bottom:1.5rem; border-bottom:1px solid var(--line); }
.tab { display:block; padding:.5rem .9rem; color:var(--muted); text-decoration:none;
  font-size:.9rem; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tab:hover { color:var(--ink); }
.tab.active { color:var(--ink); font-weight:600; border-bottom-color:var(--accent); }

.tiles { display:flex; flex-wrap:wrap; gap:.75rem; margin-bottom:2rem; }
.tile { background:var(--panel); border:1px solid var(--line); border-radius:12px;
  padding:.9rem 1.25rem; min-width:9rem; }
.tile-v { font:700 1.7rem/1.1 ui-serif,Georgia,serif; color:var(--accent); }
.tile-l { color:var(--muted); font-size:.75rem; letter-spacing:.08em; text-transform:uppercase; margin-top:.25rem; }

.cols { display:grid; grid-template-columns:16rem 1fr; gap:1.75rem; align-items:start; }
.nav { display:flex; flex-direction:column; gap:.4rem; position:sticky; top:1rem; }
.nav-item { text-align:left; background:var(--panel); border:1px solid var(--line);
  border-radius:10px; padding:.7rem .85rem; cursor:pointer; color:inherit; font:inherit; display:grid; }
.nav-item:hover { background:var(--hover); }
.nav-item[aria-selected="true"] { border-color:var(--accent); box-shadow:inset 3px 0 0 var(--accent); }
.nav-date { color:var(--muted); font-size:.72rem; letter-spacing:.06em; }
.nav-ticker { font-weight:700; font-size:1.05rem; }
.nav-company { color:var(--muted); font-size:.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.panel { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:1.75rem; }
.pick-head { border-bottom:1px solid var(--line); padding-bottom:1rem; margin-bottom:1.25rem; }
.ticker { font:700 2.5rem/1 ui-serif,Georgia,serif; letter-spacing:-.02em; color:var(--accent); }
.company { color:var(--muted); margin-top:.3rem; }
.stamp { color:var(--muted); font-size:.75rem; letter-spacing:.08em; text-transform:uppercase; margin-top:.5rem; }
.thesis { font-size:1.05rem; }
h2 { font-size:.78rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted);
  margin:1.75rem 0 .75rem; font-weight:600; }
.numbers { margin:0; display:grid; gap:.6rem; }
.num { display:grid; grid-template-columns:11rem 1fr; gap:1rem; padding-bottom:.6rem;
  border-bottom:1px dashed var(--line); }
.num dt { font-weight:600; } .num dd { margin:0; }
.callout { border-left:3px solid var(--line); padding:.1rem 0 .1rem 1rem; margin:1.5rem 0; }
.callout h3 { font-size:.78rem; letter-spacing:.1em; text-transform:uppercase; margin:0 0 .4rem; font-weight:600; }
.callout.risk { border-color:var(--risk); } .callout.risk h3 { color:var(--risk); }
.callout.change { border-color:var(--change); } .callout.change h3 { color:var(--change); }
.disclaimer { color:var(--muted); font-size:.84rem; border-top:1px solid var(--line);
  padding-top:1rem; margin-top:1.75rem; }
.fold { border-top:1px solid var(--line); padding-top:1rem; margin-top:1.5rem; }
.fold > summary { cursor:pointer; font-size:.78rem; letter-spacing:.1em; text-transform:uppercase;
  color:var(--muted); font-weight:600; }
.fold[open] > summary { margin-bottom:.75rem; }
.fold li { margin-bottom:.45rem; font-size:.95rem; }
.empty { color:var(--muted); }
.card { background:var(--panel); border:1px solid var(--line); border-radius:14px;
  padding:1.5rem; margin-bottom:1.75rem; }
table.rank { width:100%; border-collapse:collapse; font-size:.9rem; }
table.rank th { text-align:left; font-size:.68rem; letter-spacing:.07em; text-transform:uppercase;
  color:var(--muted); font-weight:600; padding:0 .6rem .5rem; border-bottom:1px solid var(--line); }
table.rank td { padding:.55rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
table.rank tr.out { opacity:.55; }
.rk { color:var(--muted); font-size:.8rem; }
.tkr { font-weight:700; }
.tot { font:700 1.05rem/1 ui-serif,Georgia,serif; color:var(--accent); }
/* Wide content scrolls inside its own box — the page must never scroll sideways. */
.rank-wrap { overflow-x:auto; }
table.rank { min-width:44rem; }
.bars { white-space:nowrap; width:9rem; }
/* Free text: give it the slack, but cap it so it can't force the table wider. */
.read { max-width:22rem; min-width:11rem; }
.tkcell { max-width:15rem; min-width:9rem; }
.why { color:var(--muted); font-size:.72rem; line-height:1.45; margin-top:.3rem; }
.scored { white-space:nowrap; width:6rem; }
.bar { display:inline-block; width:1.5rem; height:.4rem; margin-right:2px; border-radius:2px;
  background:color-mix(in srgb,var(--line) 70%,transparent); overflow:hidden; vertical-align:middle; }
.bar > span { display:block; height:100%; background:var(--accent); border-radius:2px; }
.tag { font-size:.66rem; letter-spacing:.05em; text-transform:uppercase; padding:.1rem .4rem;
  border-radius:4px; white-space:nowrap; }
.tag.bad { background:color-mix(in srgb,var(--risk) 18%,transparent); color:var(--risk); }
.tag.warn { background:color-mix(in srgb,var(--change) 16%,transparent); color:var(--change); }
.tag.info { background:color-mix(in srgb,var(--muted) 18%,transparent); color:var(--muted); }
.nowrap { white-space:nowrap; }
.note { margin-top:1rem; }
a { color:var(--change); }
code { background:color-mix(in srgb,var(--line) 55%,transparent); padding:.1em .35em; border-radius:4px; font-size:.9em; }
.raw { white-space:pre-wrap; overflow-x:auto; }
@media (max-width:60rem) { .cols { grid-template-columns:1fr; } .nav { position:static; } }
@media (max-width:34rem) { .num { grid-template-columns:1fr; gap:.15rem; } }
@media print { .nav,.tiles{display:none} .panel{border:none;padding:0} [hidden]{display:block!important} }
</style>
</head>
<body>
<div class="wrap">
  <nav class="tabs">
    <a class="tab" href="/">Portfolio</a>
    <a class="tab active" href="/reports">Reports &amp; ranking</a>
  </nav>
  <h1>Quality Screen</h1>
  <p class="sub">Every saved report, newest first. Not financial advice.</p>
  <div class="tiles">${stats}</div>
  ${ranking}
  <div class="cols">
    <nav class="nav" role="tablist" aria-label="Reports">${nav}</nav>
    <div class="detail">${panels}</div>
  </div>
</div>
<script>
(() => {
  const tabs = [...document.querySelectorAll('.nav-item')];
  const show = (date) => {
    const target = document.getElementById('r-' + date);
    if (!target) return;
    document.querySelectorAll('.panel').forEach((p) => (p.hidden = p !== target));
    tabs.forEach((t) => {
      const on = t.dataset.target === date;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    });
    history.replaceState(null, '', '#' + date);
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.target)));
  document.querySelector('.nav')?.addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -1;
    if (next < 0 || next >= tabs.length) return;
    e.preventDefault();
    tabs[next].focus();
    show(tabs[next].dataset.target);
  });
  if (location.hash) show(location.hash.slice(1));
})();
</script>
</body>
</html>
`;
}
