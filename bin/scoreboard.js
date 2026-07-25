#!/usr/bin/env node
// Ingests every report's scorecard into scoreboard.json and prints the ranking.
//   npm run scoreboard
import { readdir, readFile, writeFile } from "node:fs/promises";

import { parseScorecard } from "../src/report-model.js";
import { rank } from "../src/rank.js";
import { MAX_POSITIONS } from "../src/config.js";

const REPORTS = new URL("../reports/", import.meta.url);
const STORE = new URL("../scoreboard.json", import.meta.url);

/* ------------------------------------------------------------------ read */

let files = [];
try {
  files = (await readdir(REPORTS)).filter((f) => f.endsWith(".md")).sort();
} catch {
  // no reports/ yet
}

const existing = JSON.parse(await readFile(STORE, "utf8").catch(() => `{"entries":[]}`));
const entries = Array.isArray(existing.entries) ? existing.entries : [];

// Append-only: score history is the record of how a view changed over time, so
// a report already ingested is skipped rather than re-written.
const ingested = new Set(entries.map((e) => `${e.report}:${e.ticker}`));
let added = 0;

for (const file of files) {
  const report = file.replace(/\.md$/, "");
  const { as_of, universe, candidates } = parseScorecard(await readFile(new URL(file, REPORTS), "utf8"));

  for (const c of candidates) {
    const key = `${report}:${c.ticker}`;
    if (ingested.has(key)) continue;
    ingested.add(key);
    entries.push({
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
      scores: c.scores ?? {},
      total: Number(c.total ?? 0),
      confidence: c.confidence ?? "unknown",
      one_line: c.one_line ?? "",
      key_risk: c.key_risk ?? "",
    });
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
