#!/usr/bin/env node
// Ingests every report's scorecard into scoreboard.json and prints the ranking.
//   npm run scoreboard
import { readdir, readFile, writeFile } from "node:fs/promises";

import { parseScorecard } from "../src/report-model.js";
import { rank } from "../src/rank.js";
import { REPORT_FILE, byRun, stem } from "../src/coverage.js";
import { MAX_POSITIONS } from "../src/config.js";

const REPORTS = new URL("../reports/", import.meta.url);
const STORE = new URL("../scoreboard.json", import.meta.url);

/* ------------------------------------------------------------------ read */

let files = [];
try {
  // Only real runs, oldest first — a same-day re-run must ingest *after* the
  // original so its scores win the as_of tie in rank().
  files = (await readdir(REPORTS))
    .filter((f) => REPORT_FILE.test(f))
    .sort(byRun);
} catch {
  // no reports/ yet
}

const existing = JSON.parse(await readFile(STORE, "utf8").catch(() => `{"entries":[]}`));
const entries = Array.isArray(existing.entries) ? existing.entries : [];

// Append-only: score history is the record of how a view changed over time, so
// nothing is ever rewritten. Re-ingesting is idempotent *by content*, not by
// identity — a report re-run on the same date (same filename) produces genuinely
// new scores, and keying on `report:ticker` alone would silently discard them.
const latestFor = new Map(); // `report:ticker` -> most recent stored entry
for (const entry of entries) latestFor.set(`${entry.report}:${entry.ticker}`, entry);

/** The fields that make a score a score — ignore cosmetic drift. */
const fingerprint = (e) =>
  JSON.stringify([
    e.total,
    e.market_cap_musd ?? null,
    e.price ?? null,
    e.eligible,
    e.disqualifier ?? null,
    e.data_completeness ?? null,
    e.sector ?? null,
    e.scores ?? {},
  ]);

let added = 0;

for (const file of files) {
  const report = stem(file);
  const { as_of, universe, candidates } = parseScorecard(await readFile(new URL(file, REPORTS), "utf8"));

  for (const c of candidates) {
    const key = `${report}:${c.ticker}`;
    const entry = {
      report,
      as_of: as_of ?? report,
      // Pre-dates the $300M-$10B retarget, so not comparable with later scores.
      universe: universe ?? "legacy-50M-2B",
      ticker: c.ticker,
      company: c.company ?? "",
      price: c.price ?? null,
      market_cap_musd: c.market_cap_musd ?? null,
      eligible: c.eligible !== false,
      disqualifier: c.disqualifier ?? null,
      // Entries scored before these fields existed default conservatively:
      // unknown completeness is "unverified", unknown sector is unconstrained.
      data_completeness: c.data_completeness ?? "unverified",
      sector: c.sector ?? null,
      scores: c.scores ?? {},
      total: Number(c.total ?? 0),
      confidence: c.confidence ?? "unknown",
      one_line: c.one_line ?? "",
      key_risk: c.key_risk ?? "",
    };

    // Identical to what's already stored for this report+ticker → nothing new.
    const prior = latestFor.get(key);
    if (prior && fingerprint(prior) === fingerprint(entry)) continue;

    entries.push(entry);
    latestFor.set(key, entry);
    added += 1;
  }
}

await writeFile(STORE, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");

/* --------------------------------------------------------------- ranking */

const ranked = rank(entries);
const eligible = ranked.filter((r) => r.eligible && !r.stale);

const pad = (s, n) => String(s).padEnd(n);
process.stderr.write(
  `\n  ${files.length} report(s) · ${entries.length} score(s) · ${added} new · ${ranked.length} ticker(s)\n\n`,
);
for (const [i, r] of ranked.slice(0, MAX_POSITIONS).entries()) {
  const flag = !r.eligible ? `✗ ${r.disqualifier ?? "ineligible"}` : r.stale ? `stale ${r.ageDays}d` : "";
  process.stderr.write(
    `  ${pad(i + 1, 3)}${pad(r.ticker, 8)}${pad(r.total, 5)}${pad(r.confidence, 8)}${flag}\n`,
  );
}
process.stderr.write(
  `\n  ${eligible.length} eligible & fresh — target portfolio is ${MAX_POSITIONS}\n` +
    `  wrote scoreboard.json\n\n`,
);
