import { readFile } from "node:fs/promises";

import { MAX_POSITIONS, STALE_AFTER_DAYS } from "./config.js";
import { rank } from "./rank.js";

const SCOREBOARD = new URL("../scoreboard.json", import.meta.url);
const PORTFOLIO = new URL("../portfolio.json", import.meta.url);
const REPORTS = new URL("../reports/", import.meta.url);

// A cap that moves more than this between runs is a contradiction to resolve,
// not drift. Observed range on real runs: 66% (TYGO 156 -> 260).
const CAP_DIVERGENCE = 0.2;
const RECENT_PICKS = 5;

/** A saved run: `2026-07-27.md`, or `2026-07-27-2.md` for a same-day re-run. */
export const REPORT_FILE = /^\d{4}-\d{2}-\d{2}(-\d+)?\.md$/;
export const stem = (file) => file.replace(/\.md$/, "");

/**
 * Oldest run first. Plain string sort gets this wrong twice: "-2" sorts before
 * "." (so a re-run looks older than the original), and "-10" sorts before "-2".
 * Ingest order decides same-date ties in rank(), so this has to be right.
 */
export function byRun(a, b) {
  const key = (file) => {
    const m = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/.exec(file);
    return m ? [m[1], Number(m[2] ?? 1)] : [file, 0];
  };
  const [dateA, runA] = key(a);
  const [dateB, runB] = key(b);
  return dateA.localeCompare(dateB) || runA - runB;
}

/**
 * What previous runs already established, as a prompt block.
 *
 * Without this each run starts cold: 7 of 13 tickers were re-researched across
 * three runs, ERII's market cap was reconciled at $439M and then dropped back to
 * null two days later, and the same name was picked twice in a row with no
 * awareness. Every section below exists because of one of those.
 *
 * Returns "" when there is nothing to say — a fresh clone has no scoreboard and
 * no portfolio, and both are gitignored.
 */
export async function buildCoverage({ today = new Date() } = {}) {
  const [entries, holdings, picks] = await Promise.all([
    readJson(SCOREBOARD).then((d) => (Array.isArray(d?.entries) ? d.entries : [])),
    readJson(PORTFOLIO).then((d) => (Array.isArray(d?.holdings) ? d.holdings : [])),
    recentPicks(),
  ]);

  if (entries.length === 0 && holdings.length === 0 && picks.length === 0) return "";

  const ranked = rank(entries, today);
  const sections = [
    settledRejects(ranked),
    needsVerification(ranked),
    alreadyRanked(ranked),
    staleNames(ranked),
    contradictions(entries),
    recentPickBlock(picks),
    portfolioBlock(holdings, ranked),
  ].filter(Boolean);

  if (sections.length === 0) return "";

  return [
    "## What previous runs already established",
    "",
    "This is your own prior work. Use it: do not re-derive a figure that is",
    "already reconciled here, and do not re-litigate a name that is already",
    "settled unless you can name something material that changed.",
    "",
    ...sections,
  ].join("\n");
}

/* ------------------------------------------------------------- sections */

/**
 * A name rejected for a *data gap* is not settled — it was never judged. Entries
 * scored before data_completeness existed carry disqualifiers like "market cap
 * not verified this session"; telling a later run to skip them would make a
 * temporary research failure permanent.
 */
const DATA_GAP = /not verified|unverified|unreconcil|could not (be )?(verify|verified|reconcile|reconciled)/i;

function settledRejects(ranked) {
  const out = ranked
    .filter((r) => !r.eligible && !r.stale && !DATA_GAP.test(r.disqualifier ?? ""))
    .slice(0, 12);
  if (out.length === 0) return "";
  return block(
    "Settled — ruled out on the business, do not spend searches here",
    out.map((r) => `- ${r.ticker} (${r.as_of}): ${r.disqualifier || "ineligible"}`),
  );
}

/** Rejected only because a figure was missing — open, not closed. */
function needsVerification(ranked) {
  const out = ranked
    .filter((r) => !r.stale && DATA_GAP.test(r.disqualifier ?? ""))
    .slice(0, 10);
  if (out.length === 0) return "";
  return block(
    "Unresolved — previously dropped only for a missing figure, not on merit",
    out.map(
      (r) =>
        `- ${r.ticker} (${r.as_of}): ${r.disqualifier}. Establish the figure or leave it unverified — do not treat it as rejected.`,
    ),
  );
}

function alreadyRanked(ranked) {
  const live = ranked.filter((r) => r.eligible && !r.stale).slice(0, MAX_POSITIONS);
  if (live.length === 0) return "";
  return block(
    "Already scored and live — these are the bar a new name must clear",
    live.map(
      (r) =>
        `- ${r.ticker} ${r.total}/100 (${r.data_completeness ?? "unverified"}, ${r.sector ?? "sector unknown"}) — ${trim(r.one_line)}`,
    ),
  );
}

function staleNames(ranked) {
  const old = ranked.filter((r) => r.stale).slice(0, 10);
  if (old.length === 0) return "";
  return block(
    `Stale (>${STALE_AFTER_DAYS} days) — worth refreshing if one looks promising`,
    old.map((r) => `- ${r.ticker} ${r.total}/100, last scored ${r.as_of}`),
  );
}

/**
 * Tickers whose stored market cap disagrees with itself. Named explicitly so the
 * run resolves the conflict instead of silently adding a third figure.
 */
function contradictions(entries) {
  const byTicker = new Map();
  for (const e of entries) {
    if (e.market_cap_musd == null) continue;
    if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, []);
    byTicker.get(e.ticker).push(e);
  }

  const lines = [];
  for (const [ticker, list] of byTicker) {
    const caps = list.map((e) => e.market_cap_musd);
    const [lo, hi] = [Math.min(...caps), Math.max(...caps)];
    if (lo > 0 && (hi - lo) / lo > CAP_DIVERGENCE) {
      const seen = [...new Map(list.map((e) => [e.market_cap_musd, e])).values()]
        .map((e) => `$${e.market_cap_musd}M on ${e.as_of}`)
        .join(" vs ");
      lines.push(`- ${ticker}: ${seen} — reconcile before using either figure`);
    }
  }
  if (lines.length === 0) return "";
  return block("Contradictions in your own record — resolve these", lines);
}

function recentPickBlock(picks) {
  if (picks.length === 0) return "";
  return block(
    "Recently picked — re-picking is allowed, but say why rather than by accident",
    picks.map((p) => `- ${p.date}: ${p.ticker}`),
  );
}

function portfolioBlock(holdings, ranked) {
  if (holdings.length === 0) return "";

  const shares = new Map();
  for (const lot of holdings) shares.set(lot.ticker, (shares.get(lot.ticker) ?? 0) + lot.shares);

  const sectorOf = new Map(ranked.map((r) => [r.ticker, r.sector]));
  const mix = new Map();
  for (const ticker of shares.keys()) {
    const sector = sectorOf.get(ticker) ?? "unknown";
    mix.set(sector, (mix.get(sector) ?? 0) + 1);
  }
  // Top-ranked names count toward concentration too — they are what gets bought next.
  for (const r of ranked.filter((x) => x.eligible && !x.stale).slice(0, 5)) {
    const sector = r.sector ?? "unknown";
    mix.set(sector, (mix.get(sector) ?? 0) + 1);
  }

  const heavy = [...mix.entries()].filter(([s, n]) => n > 1 && s !== "unknown");
  return block(
    `Portfolio — ${shares.size} of ${MAX_POSITIONS} positions held`,
    [
      ...[...shares].map(([t, n]) => `- ${t}: ${n} shares (${sectorOf.get(t) ?? "sector unknown"})`),
      ...(heavy.length
        ? [
            `- Concentration across holdings and top-ranked names: ${heavy
              .map(([s, n]) => `${s} ×${n}`)
              .join(", ")}. Justify adding to an already-heavy sector.`,
          ]
        : []),
    ],
  );
}

/* --------------------------------------------------------------- helpers */

const block = (title, lines) => `### ${title}\n${lines.join("\n")}\n`;

/** Keep the block scannable — it competes with the task for attention. */
const trim = (s, max = 130) => {
  const text = (s || "no summary").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return null; // missing or malformed — coverage is best-effort, never fatal
  }
}

/** The last few picks, newest first, read straight from the saved reports. */
async function recentPicks() {
  try {
    const { readdir } = await import("node:fs/promises");
    // `2026-07-27.md` and `2026-07-27-2.md` are runs; `2026-07-27-phaseA.md`
    // (a hand-made backup) is not and must not read as one.
    const files = (await readdir(REPORTS))
      .filter((f) => REPORT_FILE.test(f))
      // Sort on the name without ".md" — otherwise "-2" sorts before "." and a
      // same-day second run looks older than the first.
      .sort(byRun)
      .reverse()
      .slice(0, RECENT_PICKS);

    const picks = [];
    for (const file of files) {
      const text = await readFile(new URL(file, REPORTS), "utf8");
      const match = /^PICK:\s*(\S+)\s*[—-]/m.exec(text);
      if (match) picks.push({ date: stem(file), ticker: match[1] });
    }
    return picks;
  } catch {
    return [];
  }
}
