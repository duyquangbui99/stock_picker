/**
 * Turns a saved report into structured data.
 *
 * The PICK block arrives inside a code fence; everything before it is the
 * screen (shortlist + eliminations) and everything after it is sources.
 */

const PICK_LABELS = ["THESIS", "KEY NUMBERS", "MAIN RISK", "WHAT WOULD CHANGE MY MIND"];

/** The scorecard is a ```json fence; the PICK block is an untagged one. */
const JSON_FENCE = /```json\s*\n([\s\S]*?)```/;

export function parseReport(markdown, date) {
  const { before, fence, after } = splitOnFence(markdown);
  const pick = fence ? parsePick(fence) : null;
  // The scorecard can sit on either side of the pick block, so strip it from
  // both rather than rendering raw JSON into the screen or sources sections.
  const clean = (s) =>
    stripHeading(s).replace(JSON_FENCE, "").replace(/^\s*SCORECARD\s*$/m, "").trim();
  return {
    date,
    pick, // null when the block didn't parse — callers fall back to `raw`
    raw: fence,
    screen: clean(before),
    sources: clean(after),
    sourceCount: (clean(after).match(/\]\(https?:\/\//g) ?? []).length,
    scorecard: parseScorecard(markdown),
  };
}

/**
 * Structured scores for every candidate a run evaluated — the thing that makes
 * picks comparable across days. Returns an empty candidate list on any problem,
 * so a malformed block degrades the report rather than breaking it.
 */
export function parseScorecard(markdown) {
  const match = JSON_FENCE.exec(markdown);
  if (!match) return { as_of: null, universe: null, candidates: [] };
  try {
    const parsed = JSON.parse(match[1]);
    return {
      as_of: parsed.as_of ?? null,
      universe: parsed.universe ?? null,
      candidates: (Array.isArray(parsed.candidates) ? parsed.candidates : []).filter(
        (c) => c && typeof c.ticker === "string",
      ),
    };
  } catch {
    return { as_of: null, universe: null, candidates: [] };
  }
}

/**
 * Locates the PICK block. Real runs have produced three shapes, and assuming any
 * one of them silently turned a real pick into "no pick" on the dashboard:
 *   1. fenced, and the only fence
 *   2. fenced, but *after* the ```json scorecard  (so it isn't fence #1)
 *   3. not fenced at all, as plain prose
 */
function splitOnFence(text) {
  const fences = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)];

  const fenced = fences.find((f) => /^PICK:/m.test(f[1]));
  if (fenced) {
    return {
      before: text.slice(0, fenced.index),
      fence: fenced[1],
      after: text.slice(fenced.index + fenced[0].length),
    };
  }

  // Unfenced: run from the PICK line to whatever ends it — a fence, a SOURCES
  // heading, or the end of the report.
  const start = /^PICK:/m.exec(text);
  if (start) {
    const rest = text.slice(start.index);
    const end = /\n```|\n\s*SOURCES\s*$/m.exec(rest);
    const stop = end ? end.index : rest.length;
    return {
      before: text.slice(0, start.index),
      fence: rest.slice(0, stop),
      after: rest.slice(stop),
    };
  }

  return { before: text, fence: fences[0]?.[1] ?? null, after: "" };
}

function parsePick(text) {
  const head = /PICK:\s*(\S+)\s*[—-]\s*(.+)/.exec(text);
  if (!head) return null;

  const sections = {};
  const disclaimer = [];
  let current = null;
  let afterRule = false;

  for (const line of text.split("\n")) {
    if (/^-{3,}\s*$/.test(line)) {
      afterRule = true;
      current = null;
      continue;
    }
    if (afterRule) {
      disclaimer.push(line);
      continue;
    }
    const label = /^([A-Z][A-Z ]+?)(?:\s*\([^)]*\))?:\s*$/.exec(line.trim());
    if (label && PICK_LABELS.includes(label[1].trim())) {
      current = label[1].trim();
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }

  const join = (key) => (sections[key] ?? []).join("\n").trim();
  return {
    ticker: head[1].trim(),
    company: head[2].trim(),
    thesis: join("THESIS"),
    numbers: parseNumbers(sections["KEY NUMBERS"] ?? []),
    risk: join("MAIN RISK"),
    change: join("WHAT WOULD CHANGE MY MIND"),
    disclaimer: disclaimer.join("\n").trim(),
  };
}

/** "- Revenue trend: …" plus wrapped continuation lines -> {term, detail}. */
function parseNumbers(lines) {
  const items = [];
  for (const line of lines) {
    const start = /^\s*-\s+(.+)$/.exec(line);
    if (start) {
      const split = /^([^:]{2,40}):\s*(.*)$/.exec(start[1]);
      items.push(
        split
          ? { term: split[1].trim(), detail: split[2].trim() }
          : { term: "", detail: start[1].trim() },
      );
    } else if (items.length > 0 && line.trim()) {
      items[items.length - 1].detail += ` ${line.trim()}`;
    }
  }
  return items;
}

const stripHeading = (t) => t.replace(/^##\s+.*$/m, "").trim();

/* ---------------------------------------------------- markdown -> HTML
 * Only the subset these reports contain: headings, bullets, bold, italic,
 * links, code spans. Escaped first, so no raw HTML can slip through. */

export function md(text) {
  const out = [];
  let list = null;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    const heading = /^(#{2,4})\s+(.*)$/.exec(line);

    if (bullet || numbered) {
      const want = bullet ? "ul" : "ol";
      if (list !== want) {
        if (list) out.push(`</${list}>`);
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
      continue;
    }
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
    if (heading) out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join("\n");
}

export function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener" target="_blank">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
