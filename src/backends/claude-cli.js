import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Runs the screen through headless Claude Code (`claude -p`).
 *
 * Uses your existing Claude Code login — no ANTHROPIC_API_KEY, no API credits.
 * Same contract as the api backend: { report, sources, usage, refusal }.
 */
export async function research({ system, task, effort, onEvent = () => {} }) {
  // Critical: strip API credentials from the child's environment. `npm run pick`
  // loads .env, and a visible ANTHROPIC_API_KEY makes Claude Code bill API
  // credits instead of using your Claude Code login — silently defeating the
  // entire point of this backend.
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...env } = process.env;

  const child = spawn(
    "claude",
    [
      "-p", task,
      "--system-prompt", system,
      "--allowed-tools", "WebSearch", "WebFetch",
      "--effort", effort,
      "--output-format", "stream-json",
      "--verbose",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env },
  );

  const sources = new Map();
  const usage = { input: 0, output: 0, cost: null };
  let report = "";
  let stderr = "";

  let spawnError = null;
  child.on("error", (error) => (spawnError = error)); // e.g. `claude` not on PATH
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // non-JSON banner lines
    }

    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use") {
        if (block.name === "WebSearch") {
          onEvent({ type: "searching", query: block.input?.query ?? "" });
        } else if (block.name === "WebFetch") {
          onEvent({ type: "fetching", url: block.input?.url ?? "" });
        }
      } else if (block.type === "tool_result") {
        collectLinks(block.content, sources);
      } else if (block.type === "text" && event.type === "assistant") {
        // Reasoning between tool calls — progress, not the deliverable.
        onEvent({ type: "note", text: block.text });
      }
    }

    if (event.type === "result") {
      report = event.result ?? "";
      usage.input = event.usage?.input_tokens ?? 0;
      usage.output = event.usage?.output_tokens ?? 0;
      usage.cost = event.total_cost_usd ?? null;
      if (event.is_error) {
        // `subtype` is often "success" even on failures — the message is in `result`.
        throw new Error(report?.trim() || stderr.trim() || "claude -p reported an error");
      }
      onEvent({ type: "writing" });
      onEvent({ type: "text", text: report });
    }
  }

  const code = await new Promise((resolve) => child.on("close", resolve));
  if (spawnError) throw spawnError;
  if (code !== 0) throw new Error(`claude exited ${code}: ${stderr.trim() || "no output"}`);
  if (!report) throw new Error(`claude produced no report. ${stderr.trim()}`);

  return { report: report.trim(), sources: [...sources.values()], usage, refusal: null };
}

/**
 * WebSearch results arrive as a plain string containing
 * `Links: [{"title":"…","url":"…"}, …]` — pull the pairs back out.
 */
const LINK = /\{"title":"((?:[^"\\]|\\.)*)","url":"((?:[^"\\]|\\.)*)"\}/g;

function collectLinks(content, sources) {
  if (typeof content !== "string") return;
  for (const [, title, url] of content.matchAll(LINK)) {
    const clean = unescapeJson(url);
    if (clean && !sources.has(clean)) {
      sources.set(clean, { url: clean, title: unescapeJson(title) || clean, age: null });
    }
  }
}

function unescapeJson(s) {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
}
