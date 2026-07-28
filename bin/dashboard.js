#!/usr/bin/env node
// Builds one page indexing every saved report:  npm run dashboard
import { readdir, readFile, writeFile } from "node:fs/promises";

import { dashboard } from "../src/dashboard-html.js";
import { parseReport } from "../src/report-model.js";
import { rank } from "../src/rank.js";
import { REPORT_FILE, byRun, stem } from "../src/coverage.js";

const REPORTS = new URL("../reports/", import.meta.url);
const SCOREBOARD = new URL("../scoreboard.json", import.meta.url);

let files = [];
try {
  files = (await readdir(REPORTS))
    .filter((f) => REPORT_FILE.test(f))
    .sort(byRun);
} catch {
  // no reports/ directory yet — render the empty state
}

const reports = await Promise.all(
  files.map(async (file) =>
    parseReport(await readFile(new URL(file, REPORTS), "utf8"), stem(file)),
  ),
);

// Scores live in scoreboard.json (built by `npm run scoreboard`); the dashboard
// renders whatever is there and shows an explainer when it is empty.
const store = JSON.parse(await readFile(SCOREBOARD, "utf8").catch(() => `{"entries":[]}`));
const ranked = rank(Array.isArray(store.entries) ? store.entries : []);

await writeFile(new URL("index.html", REPORTS), dashboard(reports, ranked), "utf8");

const picks = reports.filter((r) => r.pick).length;
process.stderr.write(
  `\n  wrote reports/index.html — ${reports.length} report(s), ${picks} with a pick` +
    `\n  open it with:  open reports/index.html\n\n`,
);
