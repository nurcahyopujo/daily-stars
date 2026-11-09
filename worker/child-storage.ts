import type { Child, ChildIntent, TemplateSummary, TemplateVersion } from '../shared/profiles';
import type { Parent } from './auth';
import { dayBounds, jakartaToday, nextDate } from './calendar';
import { ApiError } from './http';

const childColumns = `id, display_name AS displayName, start_date AS startDate,
  archive_effective_date AS archiveEffectiveDate, revision`;

export async function listChildren(db: D1Database, today: string, includeArchived: boolean) {
  const rows = await db.prepare(`SELECT ${childColumns} FROM children
    WHERE ? = 1 OR archive_effective_date IS NULL OR archive_effective_date > ?
    ORDER BY created_at, id`).bind(Number(includeArchived), today).all<Child>();
  return rows.results;
}

async function getChild(db: D1Database, id: string) {
  return db.prepare(`SELECT ${childColumns} FROM children WHERE id = ?`).bind(id).first<Child>();
}

// Resolve eligible versions in SQL so creation rechecks eligibility inside its transaction.
const eligibleTemplates = `SELECT tv.template_id FROM template_versions tv
  WHERE tv.effective_date <= ? AND tv.retired = 0 AND tv.revision = (
    SELECT v.revision FROM template_versions v WHERE v.template_id = tv.template_id
      AND v.effective_date <= ? ORDER BY v.effective_date DESC, v.revision DESC LIMIT 1)`;

async function templatesEligible(db: D1Database, ids: string[], today: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM json_each(?) selected
    WHERE selected.value IN (${eligibleTemplates})`).bind(JSON.stringify(ids), today, today)
    .first<{ count: number }>();
  return row?.count === ids.length;
}

export async function listTemplates(db: D1Database, today: string): Promise<TemplateSummary[]> {
  const rows = await db.prepare(`SELECT template_id AS id, name, revision,
    effective_date AS effectiveDate, retired FROM template_versions
    ORDER BY template_id, effective_date, revision`).all<Omit<TemplateVersion, 'retired'> & { id: string; retired: number }>();
  const summaries = new Map<string, TemplateSummary>();
  for (const row of rows.results) {
    const summary = summaries.get(row.id) ?? { id: row.id, current: null, pending: null };
    const version = { name: row.name, revision: row.revision, effectiveDate: row.effectiveDate, retired: Boolean(row.retired) };
    if (row.effectiveDate <= today) summary.current = version;
    else summary.pending = version;
    summaries.set(row.id, summary);
  }
  return [...summaries.values()];
}

type Receipt = { fingerprint: string; status: number; result_json: string };
export type SavedChild = { status: number; child: Child };

async function receipt(db: D1Database, actor: string, action: string, fingerprint: string): Promise<SavedChild | null> {
  const row = await db.prepare(`SELECT fingerprint, status, result_json FROM mutation_receipts
    WHERE actor_id = ? AND action_id = ?`).bind(actor, action).first<Receipt>();
  if (!row) return null;
  if (row.fingerprint !== fingerprint) {
    throw new ApiError(409, 'ACTION_REUSED', 'This action ID was already used for different input.');
  }
  return { status: row.status, child: JSON.parse(row.result_json) };
}

async function fingerprintOf(intent: ChildIntent) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(intent)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function saveChild(
  db: D1Database, parent: Parent, intent: ChildIntent, action: string,
  clock: () => Date = () => new Date(),
): Promise<SavedChild> {
  const fingerprint = await fingerprintOf(intent);
  const replay = await receipt(db, parent.sub, action, fingerprint);
  if (replay) return replay;

  for (let attempt = 0; attempt < 2; attempt++) {
    const now = clock();
    const today = jakartaToday(now);
    const [start, end] = dayBounds(today);
    const previous = intent.kind === 'edit' ? await getChild(db, intent.childId) : null;
    if (intent.kind === 'edit' && !previous) throw new ApiError(404, 'NOT_FOUND', 'Child not found.');
    if (intent.kind === 'edit' && previous?.revision !== intent.expectedRevision) {
      // A parallel retry may have committed since our first receipt read.
      const saved = await receipt(db, parent.sub, action, fingerprint);
      if (saved) return saved;
      throw new ApiError(409, 'STALE_EDIT', 'This child was changed by another save. Review the current profile.', previous);
    }
    const child: Child = intent.kind === 'create' ? {
      id: crypto.randomUUID(), displayName: intent.displayName, startDate: today,
      archiveEffectiveDate: null, revision: 1,
    } : {
      ...previous!, displayName: intent.displayName ?? previous!.displayName,
      archiveEffectiveDate: previous!.archiveEffectiveDate ?? (intent.archive ? nextDate(today) : null),
      revision: intent.expectedRevision + 1,
    };
    const status = intent.kind === 'create' ? 201 : 200;
    const timestamp = now.toISOString();
    const assertionId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];
    if (intent.kind === 'create') {
      statements.push(
        db.prepare(`INSERT INTO children (id, display_name, start_date, revision, created_at)
          VALUES (?, ?, ?, 1, ?)`).bind(child.id, child.displayName, today, timestamp),
        db.prepare(`INSERT INTO assignment_versions
          (child_id, revision, effective_date, template_ids_json, actor_id, actor_email, recorded_at_utc)
          SELECT ?, 1, ?, ?, ?, ?, ? WHERE
          (SELECT COUNT(*) FROM json_each(?) selected WHERE selected.value IN (${eligibleTemplates})) = ?`)
          .bind(child.id, today, JSON.stringify(intent.initialTemplateIds), parent.sub, parent.email,
            timestamp, JSON.stringify(intent.initialTemplateIds), today, today, intent.initialTemplateIds.length),
      );
    } else {
      statements.push(db.prepare(`UPDATE children SET display_name = ?, archive_effective_date = ?,
        revision = revision + 1 WHERE id = ? AND revision = ?`)
        .bind(child.displayName, child.archiveEffectiveDate, child.id, intent.expectedRevision));
    }
    statements.push(
      db.prepare(`INSERT INTO mutation_assertions (id, ok) VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END)`)
        .bind(assertionId),
      db.prepare('DELETE FROM mutation_assertions WHERE id = ?').bind(assertionId),
      db.prepare(`INSERT INTO child_profile_revisions
        (child_id, revision, display_name, archive_effective_date, actor_id, actor_email, recorded_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(child.id, child.revision, child.displayName, child.archiveEffectiveDate, parent.sub, parent.email, timestamp),
      db.prepare(`INSERT INTO mutation_receipts
        (actor_id, action_id, fingerprint, status, result_json, actor_email, created_at, success_guard, date_guard)
        VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END,
          CASE WHEN ? = 0 OR (unixepoch('now') >= ? AND unixepoch('now') < ?) THEN 1 ELSE 0 END)`)
        .bind(parent.sub, action, fingerprint, status, JSON.stringify(child), parent.email, timestamp,
          Number(intent.kind === 'create' || intent.archive === true), start, end),
    );
    try {
      await db.batch(statements);
      return { status, child };
    } catch (error) {
      // Always recover from the primary before deciding whether an error means conflict or rollback.
      const saved = await receipt(db, parent.sub, action, fingerprint);
      if (saved) return saved;
      if (intent.kind === 'edit') {
        const current = await getChild(db, intent.childId);
        if (!current) throw new ApiError(404, 'NOT_FOUND', 'Child not found.');
        if (current.revision !== intent.expectedRevision) {
          throw new ApiError(409, 'STALE_EDIT', 'This child was changed by another save. Review the current profile.', current);
        }
      }
      const message = error instanceof Error ? error.message : '';
      if (/mutation_date_guard/.test(message)) {
        if (attempt === 0) continue;
      } else if (/mutation_write_guard/.test(message) && intent.kind === 'create'
        && !await templatesEligible(db, intent.initialTemplateIds, today)) {
        throw new ApiError(422, 'INVALID_TEMPLATES', 'A selected template is no longer available today. Review the templates.');
      }
      throw new ApiError(503, 'SAVE_UNCONFIRMED', 'Save not confirmed. Check / retry with the same action ID.');
    }
  }
  throw new ApiError(503, 'SAVE_UNCONFIRMED', 'Save not confirmed. Check / retry.');
}
