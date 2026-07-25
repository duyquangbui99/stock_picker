// `claude-cli` runs through your Claude Code login (no API key, no credits).
// `api` uses ANTHROPIC_API_KEY and bills API usage.
export const BACKENDS = ["claude-cli", "api"];
export const DEFAULT_BACKEND = "claude-cli";

export const MODEL = "claude-opus-5"; // api backend only; the CLI uses its own default

// Streaming, so we can afford real headroom: deep research + adaptive thinking.
export const MAX_TOKENS = 64_000;

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const DEFAULT_EFFORT = "medium";

// A screen this size covers 5-8 candidates with verification passes. Kept
// deliberately tight: an early 40-search run cost real money and finished
// no better than a 14-search one.
export const MAX_SEARCHES = 15;

// Server-side tool loops stop with `pause_turn`; each resume is one more turn.
export const MAX_RESUMES = 8;

// Target portfolio size. 20 is what the re-review cadence can actually keep
// current: at ~3 holdings re-verified per run, every name is revisited roughly
// every two weeks.
export const MAX_POSITIONS = 20;

// A score older than this is not comparable with a fresh one, so it ranks below.
export const STALE_AFTER_DAYS = 30;
