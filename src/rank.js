import { STALE_AFTER_DAYS } from "./config.js";

/** Fully-sourced names outrank ones with gaps, but a gap is not a rejection. */
const COMPLETENESS_ORDER = { verified: 0, partial: 1, unverified: 2 };
const completeness = (entry) => COMPLETENESS_ORDER[entry.data_completeness] ?? 2;

/**
 * Collapses the append-only score history into one current view per ticker,
 * ordered the way money should be allocated:
 *
 *   eligible+verified → eligible+partial → eligible+unverified → stale → ineligible
 *
 * Ineligible sinks below everything regardless of score — a high total on a
 * company with going-concern language is the trap this guards against. But an
 * unverified name is only "needs another look", so it ranks above rejections
 * rather than beside them. Stale scores rank under fresh ones because they are
 * not comparable.
 */
export function rank(entries, today = new Date()) {
  const latest = new Map();
  for (const entry of entries) {
    const seen = latest.get(entry.ticker);
    if (!seen || entry.as_of >= seen.as_of) latest.set(entry.ticker, entry);
  }

  return [...latest.values()]
    .map((entry) => {
      const ageDays = Math.max(0, Math.round((today - new Date(entry.as_of)) / 86400000));
      return { ...entry, ageDays, stale: ageDays > STALE_AFTER_DAYS };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        Number(a.stale) - Number(b.stale) ||
        completeness(a) - completeness(b) ||
        b.total - a.total ||
        a.ticker.localeCompare(b.ticker),
    );
}
