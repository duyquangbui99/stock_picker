import { readFile } from "node:fs/promises";

import { MAX_SEARCHES } from "./config.js";

const SYSTEM_PROMPT_FILE = new URL(
  "../stock_picker_system_prompt.md",
  import.meta.url,
);

/** The analyst persona and process live in the markdown file, not in code. */
export function loadSystemPrompt() {
  return readFile(SYSTEM_PROMPT_FILE, "utf8");
}

/** The per-run task. Everything volatile (date, operator hint) lives here. */
export function buildTask({ date, focus, coverage = "" }) {
  return [
    `Run today's screen. Today's date is ${date}.`,
    // Prices move daily; share counts and filing figures do not. Carrying the
    // stable half forward is what stops every run re-deriving the same numbers.
    "Prices must come from a search you ran in this session — never carry a price forward. Figures from filings (share count, revenue, cash, debt) may be reused from the record below if you state the date they came from; anything else you did not verify is unknown.",
    // The CLI backend has no hard search cap, so the budget has to be stated.
    `Search budget: aim for about ${MAX_SEARCHES} searches, then commit. Do not exceed ${MAX_SEARCHES + 5}. Reusing an established figure instead of re-deriving it is how you afford depth on the names that matter.`,
    focus && `Additional constraint from the operator: ${focus}`,
    coverage,
    `End with exactly the PICK block from your instructions, using ${date} as [DATE]. If no candidate survives the fundamentals check, say so instead of forcing a pick.`,
    // Without the rejects, picks from different days cannot be ranked against
    // each other — which is the whole point of scoring.
    "Then emit the SCORECARD json block covering EVERY candidate you researched this session, including the ones you eliminated and the ones ruled out on market cap. Score your own pick as honestly as the rejects.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
