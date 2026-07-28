#!/usr/bin/env node
// The whole cycle in one command:  npm start
//   research → ingest scores → rebuild the reports page → serve the portfolio
//
//   npm start                     full run (takes a few minutes)
//   npm start -- --no-pick        skip the research, just rebuild and serve
//   npm start -- --focus "banks"  any other flag is forwarded to `pick`
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const skipPick = argv.includes("--no-pick");
const pickArgs = argv.filter((a) => a !== "--no-pick");

// fileURLToPath, not .pathname — the latter percent-encodes, so any space in the
// project path ("Claude stock picker") becomes %20 and the spawn can't find it.
const bin = (name) => fileURLToPath(new URL(`${name}.js`, import.meta.url));
const step = (n, total, label) =>
  process.stderr.write(`\n\x1b[1m[${n}/${total}]\x1b[0m ${label}\n`);

/** Runs a step to completion; resolves with the exit code rather than throwing. */
function run(script, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin(script), ...args], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

const total = skipPick ? 3 : 4;
let n = 0;

if (!skipPick) {
  step(++n, total, "Researching a new candidate — this takes a few minutes");
  const code = await run("pick", ["--save", ...pickArgs]);
  if (code !== 0) {
    // A failed screen shouldn't cost you the portfolio; the rest still works on
    // the reports you already have.
    process.stderr.write(
      "\n  \x1b[33mResearch step failed — continuing with existing reports.\x1b[0m\n",
    );
  }
}

step(++n, total, "Ingesting scores");
await run("scoreboard");

step(++n, total, "Rebuilding the reports page");
await run("dashboard");

step(++n, total, "Starting the portfolio dashboard");
const server = spawn(process.execPath, [bin("portfolio")], { stdio: "inherit" });

// Give the listener a moment, then open a browser (best effort — never fatal).
setTimeout(() => {
  const port = process.env.PORT ?? 4321;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [`http://localhost:${port}`], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}, 700);

const stop = () => server.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("close", (code) => process.exit(code ?? 0));
