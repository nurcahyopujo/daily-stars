import type { Activity, Day, Score } from '../../../shared/scoring';

// ─── Score day model ──────────────────────────────────────────────────────────
// The pure optimistic-outcome math behind the day view: the latest revision of a
// stream, the day as it will look once an outcome lands, and reference-identity
// comparison of a stream's history. Kept out of the component so the day view
// stays a render, and so this math has its own test surface.

/** The highest-revision score for a stream in a history, or undefined. */
export function latestOf(history: Score[], stream: string): Score | undefined {
  let best: Score | undefined;
  for (const row of history)
    if (row.stream === stream && (best?.revision ?? -1) < row.revision) best = row;
  return best;
}

// Build the day as it will look once an outcome lands, so the UI can show it
// immediately. `net`, `balance`, and `total` all shift by the points delta; the
// quiet background reconcile replaces this guess with the server's truth.
export function withOutcome(prev: Day, a: Activity, outcome: string): Day {
  const r = latestOf(prev.history, a.stream);
  const oldPoints = r && r.outcome !== 'unrecorded' ? r.points : 0;
  const newPoints =
    outcome === 'done_correctly' ? a.reward : outcome === 'needs_improvement' ? -(a.penalty ?? 0) : 0;
  const delta = newPoints - oldPoints;
  const entry: Score = {
    stream: a.stream,
    revision: (r?.revision ?? 0) + 1,
    points: newPoints,
    reason: '',
    outcome,
    actor: 'You',
    recorded: new Date().toISOString(),
  };
  return {
    ...prev,
    history: [...prev.history, entry],
    net: prev.net + delta,
    total: prev.total + delta,
    balance: prev.balance === undefined ? undefined : prev.balance + delta,
  };
}

/** True when two history slices hold the same score objects by reference and order. */
export function sameEntries(a: Score[], b: Score[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
