import type { Pause } from '../shared/pauses.ts';

// A child's assignment revision covers both assignment changes and pause saves
// (ADR 0006), so a write guarded on it conflicts with either. Binds the child ID twice.
export const assignmentRevisionSql = `max(
  coalesce((SELECT MAX(revision) FROM assignment_versions WHERE child_id = ?), 0),
  coalesce((SELECT MAX(revision) FROM assignment_pause_versions WHERE child_id = ?), 0))`;

/** The child's whole pause list (ended pauses included) and its assignment revision. */
export function readPausesStatement(db: D1Database, childId: string) {
  return db.prepare(`SELECT ${assignmentRevisionSql} AS revision,
      (SELECT pauses_json FROM assignment_pause_versions WHERE child_id = ? ORDER BY revision DESC LIMIT 1) AS pausesJson`)
    .bind(childId, childId, childId);
}

export function readPauses(row: Record<string, unknown> | undefined): { revision: number; pauses: Pause[] } {
  return {
    revision: Number(row?.revision ?? 0),
    pauses: typeof row?.pausesJson === 'string' ? JSON.parse(row.pausesJson) as Pause[] : [],
  };
}

/** Pauses a parent can still act on: running or upcoming, earliest first. */
export function listedPauses(pauses: Pause[], today: string): Pause[] {
  return pauses.filter(pause => pause.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
}

type Audit = [actorId: string, actorEmail: string, recordedAt: string];

/** Append a pause list at `revision`, only if the child's assignment revision is still `expected`. */
export function insertPausesGuarded(db: D1Database, childId: string, expected: number, revision: number, pauses: Pause[], audit: Audit) {
  return db.prepare(`INSERT INTO assignment_pause_versions SELECT ?, ?, ?, ?, ?, ? WHERE ${assignmentRevisionSql} = ?`)
    .bind(childId, revision, JSON.stringify(pauses), ...audit, childId, childId, expected);
}

/** Append a pause list only if the statement before it in the batch changed exactly one row. */
export function insertPausesAfter(db: D1Database, childId: string, revision: number, pauses: Pause[], audit: Audit) {
  return db.prepare('INSERT INTO assignment_pause_versions SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
    .bind(childId, revision, JSON.stringify(pauses), ...audit);
}
