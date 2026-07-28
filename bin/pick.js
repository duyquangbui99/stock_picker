#!/usr/bin/env node
import { mkdir, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { research as viaApi } from "../src/backends/api.js";
import { research as viaClaudeCli } from "../src/backends/claude-cli.js";
import {
  BACKENDS,
  DEFAULT_BACKEND,
  DEFAULT_EFFORT,
  EFFORTS,
  MAX_SEARCHES,
} from "../src/config.js";
import { bold, createReporter, dim, renderFooter, renderSources } from "../src/render.js";
import { buildTask, loadSystemPrompt } from "../src/prompt.js";
import { buildCoverage } from "../src/coverage.js";

const BACKEND_IMPLS = { "claude-cli": viaClaudeCli, api: viaApi };

const USAGE = `
${bold("pick")} — one stock, researched live and argued on fundamentals.

  npm run pick -- [options]

  -f, --focus <text>    extra constraint (e.g. "biotech only", "avoid pre-revenue")
  -e, --effort <level>  ${EFFORTS.join(" | ")}  (default: ${DEFAULT_EFFORT})
  -b, --backend <name>  ${BACKENDS.join(" | ")}  (default: ${DEFAULT_BACKEND})
                        claude-cli uses your Claude Code login — no API credits
                        api uses ANTHROPIC_API_KEY and bills API usage
  -s, --save            also write the report to reports/<date>.md
  -v, --verbose         show the analyst's running commentary
  -h, --help            show this

Report goes to stdout, progress to stderr:  npm run -s pick > today.md
`;

const { values: flags } = parseArgs({
  options: {
    focus: { type: "string", short: "f" },
    effort: { type: "string", short: "e", default: DEFAULT_EFFORT },
    backend: { type: "string", short: "b", default: DEFAULT_BACKEND },
    save: { type: "boolean", short: "s", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (flags.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (!EFFORTS.includes(flags.effort)) {
  fail(`unknown effort "${flags.effort}" — expected one of: ${EFFORTS.join(", ")}`);
}

const research = BACKEND_IMPLS[flags.backend];
if (!research) {
  fail(`unknown backend "${flags.backend}" — expected one of: ${BACKENDS.join(", ")}`);
}

const date = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const startedAt = Date.now();

process.stderr.write(
  dim(
    `\n  ${flags.backend} · effort ${flags.effort} · ~${MAX_SEARCHES} searches · ${date}` +
      `${flags.focus ? ` · focus: ${flags.focus}` : ""}\n\n`,
  ),
);

// What earlier runs settled — stops this one re-deriving it. Empty on a fresh
// clone, which is fine: the task reads normally without it.
const coverage = await buildCoverage();
if (coverage) {
  process.stderr.write(dim(`  carrying forward ${coverage.split("\n### ").length - 1} sections of prior work\n\n`));
}

let result;
try {
  result = await research({
    system: await loadSystemPrompt(),
    task: buildTask({ date, focus: flags.focus, coverage }),
    effort: flags.effort,
    onEvent: createReporter({ verbose: flags.verbose }),
  });
} catch (error) {
  // The api backend resolves credentials via the SDK (env var or `ant` profile);
  // don't pre-judge them, just explain once it actually fails.
  if (flags.backend === "api" && isAuthProblem(error)) {
    fail(
      `no usable Anthropic credentials — ${error.message}\n` +
        "  Either:  echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env\n" +
        "  Or:      switch to the free path:  npm run pick",
    );
  }
  if (flags.backend === "claude-cli" && /ENOENT/.test(error.message)) {
    fail("`claude` CLI not found on PATH — install Claude Code, or use --backend api");
  }
  fail(error.message);
}

const { report, sources, usage, refusal } = result;

if (refusal) fail(`the model declined this request: ${refusal.explanation ?? refusal.category}`);

// Search returns far more links than the analysis uses — a typical run saw 179
// results back 15 cited claims. List what the report actually leans on.
const cited = sources.filter((s) => report.includes(s.url));
const sourceList = renderSources(cited.length > 0 ? cited : sources);

process.stdout.write(`${sourceList}\n`);
process.stderr.write(
  renderFooter({
    usage,
    sources: `${cited.length} cited / ${sources.length} seen`,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  }),
);

if (flags.save) {
  const dir = new URL("../reports/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const name = await freeReportName(dir, date);
  await writeFile(new URL(name, dir), `${report}${sourceList}`, "utf8");
  process.stderr.write(dim(`  saved reports/${name}\n`));
}

/**
 * Never overwrite an existing report. A second run on the same day is a second
 * run — its scores are already kept separately, and silently replacing the first
 * run's prose destroys the only record of why those scores were given.
 */
async function freeReportName(dir, date) {
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? `${date}.md` : `${date}-${n}.md`;
    try {
      await stat(new URL(name, dir));
    } catch {
      return name; // doesn't exist — take it
    }
  }
  return `${date}-${Date.now()}.md`; // absurd fallback, still never overwrites
}

function isAuthProblem(error) {
  return error?.status === 401 || /api[_ ]?key|authentication|credential/i.test(error?.message ?? "");
}

function fail(message) {
  process.stderr.write(`\n  error: ${message}\n\n`);
  process.exit(1);
}
