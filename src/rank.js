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
  const history = new Map();
  for (const entry of entries) {
    if (!history.has(entry.ticker)) history.set(entry.ticker, []);
    history.get(entry.ticker).push(entry);
    const seen = latest.get(entry.ticker);
    if (!seen || entry.as_of >= seen.as_of) latest.set(entry.ticker, entry);
  }

  const ranked = [...latest.values()]
    .map((entry) => {
      const ageDays = Math.max(0, Math.round((today - new Date(entry.as_of)) / 86400000));
      // Collapsing to the latest score hides how much it moves. A ±6 drift on
      // unchanged fundamentals matters when 2 points decide the top of the list.
      const runs = history.get(entry.ticker) ?? [];
      const prior = runs.filter((e) => e !== entry).at(-1);
      return {
        ...entry,
        ageDays,
        stale: ageDays > STALE_AFTER_DAYS,
        priorTotal: prior ? prior.total : null,
        delta: prior ? entry.total - prior.total : null,
        runCount: runs.length,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        Number(a.stale) - Number(b.stale) ||
        completeness(a) - completeness(b) ||
        b.total - a.total ||
        a.ticker.localeCompare(b.ticker),
    );

  // What the order would be on score alone. The tiers are deliberate, but they
  // move names a long way and the reason should be visible, not silent.
  const byScore = [...ranked].sort((a, b) => b.total - a.total || a.ticker.localeCompare(b.ticker));
  const scoreRank = new Map(byScore.map((r, i) => [r.ticker, i + 1]));
  return ranked.map((r, i) => ({ ...r, rank: i + 1, scoreRank: scoreRank.get(r.ticker) }));
}
