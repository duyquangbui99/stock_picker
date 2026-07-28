import Anthropic from "@anthropic-ai/sdk";
import {
  MAX_RESUMES,
  MAX_SEARCHES,
  MAX_TOKENS,
  MODEL,
} from "../config.js";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const WEB_SEARCH = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: MAX_SEARCHES,
};
// Without this the model can only read search snippets, never a filing — which
// makes the prompt's Tier 1 sourcing rules impossible to follow on this backend.
// Fetches don't consume the search budget; only URLs already in the conversation
// can be fetched, so search still finds the document first.
const WEB_FETCH = {
  type: "web_fetch_20260209",
  name: "web_fetch",
  max_uses: MAX_SEARCHES,
};

/**
 * Runs one research pass and returns the finished report.
 *
 * `onEvent` receives progress while the model works:
 *   { type: "thinking" | "searching" | "writing" | "text" | "notice", ... }
 */
export async function research({ system, task, effort, onEvent = () => {} }) {
  const client = new Anthropic();
  const messages = [{ role: "user", content: task }];
  const request = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort },
    tools: [WEB_SEARCH, WEB_FETCH],
    // Essential, not an optimization: every `pause_turn` resume resends the
    // whole accumulated history (all search results so far). Uncached, the
    // input bill compounds with each resume.
    cache_control: { type: "ephemeral" },
  };

  const sources = new Map();
  const usage = { input: 0, output: 0 };
  let report = "";
  let refusal = null;
  let useFallbacks = true;

  for (let resumes = 0; resumes <= MAX_RESUMES; ) {
    let message;
    try {
      message = await consume(
        open(client, { ...request, messages }, useFallbacks),
        onEvent,
      );
    } catch (error) {
      // Server-side fallbacks are a beta an account may not have. Degrade
      // rather than fail the whole run.
      if (useFallbacks && isBetaUnavailable(error)) {
        useFallbacks = false;
        onEvent({
          type: "notice",
          text: "server-side fallbacks unavailable — continuing without them",
        });
        continue;
      }
      throw error;
    }

    usage.input += message.usage.input_tokens ?? 0;
    usage.output += message.usage.output_tokens ?? 0;
    collect(message.content, { sources, onText: (t) => (report += t) });
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "refusal") {
      refusal = message.stop_details ?? { explanation: "request declined" };
      break;
    }
    // The web-search loop hit its per-turn ceiling — resend to let it continue.
    if (message.stop_reason !== "pause_turn") break;
    resumes++;
  }

  return { report: report.trim(), sources: [...sources.values()], usage, refusal };
}

function open(client, params, useFallbacks) {
  return useFallbacks
    ? client.beta.messages.stream({
        ...params,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      })
    : client.messages.stream(params);
}

/** Drains the event stream for progress, then returns the assembled message. */
async function consume(stream, onEvent) {
  // Both web_search and web_fetch arrive as `server_tool_use`, so track the tool
  // name to tell a query apart from a URL. The input may arrive whole on the
  // start event or streamed as JSON deltas — keep both, prefer what we got.
  const pending = new Map(); // block index -> { tool, seed, json }

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "server_tool_use") {
        pending.set(event.index, {
          tool: block.name,
          seed: block.input?.query ?? block.input?.url ?? "",
          json: "",
        });
      } else if (block.type === "thinking") onEvent({ type: "thinking" });
      else if (block.type === "text") onEvent({ type: "writing" });
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta.type === "input_json_delta" && pending.has(event.index)) {
        pending.get(event.index).json += delta.partial_json;
      } else if (delta.type === "thinking_delta") {
        onEvent({ type: "thinking", text: delta.thinking });
      } else if (delta.type === "text_delta") {
        onEvent({ type: "text", text: delta.text });
      }
    } else if (event.type === "content_block_stop" && pending.has(event.index)) {
      const { tool, seed, json } = pending.get(event.index);
      const input = readInput(json);
      if (tool === "web_fetch") {
        onEvent({ type: "fetching", url: input.url || seed });
      } else {
        onEvent({ type: "searching", query: input.query || seed });
      }
      pending.delete(event.index);
    }
  }

  return stream.finalMessage();
}

/** Pulls the answer text and the cited pages out of a finished message. */
function collect(content, { sources, onText }) {
  const add = (url, title, age) => {
    if (url && !sources.has(url)) sources.set(url, { url, title: title ?? url, age: age ?? null });
  };

  for (const block of content) {
    if (block.type === "text") onText(block.text);
    else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) add(result.url, result.title, result.page_age);
    } else if (block.type === "web_fetch_tool_result") {
      // A fetched primary document is the most valuable kind of source here, so
      // make sure it reaches the citation list too.
      const fetched = block.content;
      add(fetched?.url, fetched?.document?.title ?? fetched?.url, fetched?.retrieved_at);
    }
  }
}

function readInput(partialJson) {
  try {
    return JSON.parse(partialJson) ?? {};
  } catch {
    return {};
  }
}

function isBetaUnavailable(error) {
  return error?.status === 400 && /fallback|beta/i.test(error?.message ?? "");
}
