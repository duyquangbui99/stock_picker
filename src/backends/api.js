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
    tools: [WEB_SEARCH],
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
  // The query may arrive whole on the start event, or streamed as JSON deltas —
  // keep both and prefer whichever we actually got.
  const pendingQueries = new Map(); // block index -> { seed, json }

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const kind = event.content_block.type;
      if (kind === "server_tool_use") {
        pendingQueries.set(event.index, {
          seed: event.content_block.input?.query ?? "",
          json: "",
        });
      } else if (kind === "thinking") onEvent({ type: "thinking" });
      else if (kind === "text") onEvent({ type: "writing" });
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta.type === "input_json_delta" && pendingQueries.has(event.index)) {
        pendingQueries.get(event.index).json += delta.partial_json;
      } else if (delta.type === "thinking_delta") {
        onEvent({ type: "thinking", text: delta.thinking });
      } else if (delta.type === "text_delta") {
        onEvent({ type: "text", text: delta.text });
      }
    } else if (event.type === "content_block_stop" && pendingQueries.has(event.index)) {
      const { seed, json } = pendingQueries.get(event.index);
      onEvent({ type: "searching", query: readQuery(json) || seed });
      pendingQueries.delete(event.index);
    }
  }

  return stream.finalMessage();
}

/** Pulls the answer text and the cited pages out of a finished message. */
function collect(content, { sources, onText }) {
  for (const block of content) {
    if (block.type === "text") onText(block.text);
    else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.url && !sources.has(result.url)) {
          sources.set(result.url, {
            url: result.url,
            title: result.title ?? result.url,
            age: result.page_age ?? null,
          });
        }
      }
    }
  }
}

function readQuery(partialJson) {
  try {
    return JSON.parse(partialJson).query ?? "";
  } catch {
    return "";
  }
}

function isBetaUnavailable(error) {
  return error?.status === 400 && /fallback|beta/i.test(error?.message ?? "");
}
