import { STALE_AFTER_DAYS } from "./config.js";

/**
 * Collapses the append-only score history into one current view per ticker,
 * ordered the way money should be allocated.
 *
 * Ineligible names sink below everything regardless of score — a high total on
 * a company with going-concern language is exactly the trap this guards against.
 * Stale scores rank under fresh ones because they are not comparable.
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
        b.total - a.total ||
        a.ticker.localeCompare(b.ticker),
    );
}
