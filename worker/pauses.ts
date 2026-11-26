import { addPauses, changePause, type Pause, type PauseChange, type PauseConflict, type PauseResult } from '../shared/pauses.ts';
import type { PauseSave } from '../shared/profiles.ts';
import type { Parent } from './auth.ts';
import { dayBounds, jakartaToday, nextDate } from './calendar.ts';
import { ApiError, json } from './http.ts';
import { fingerprintOf, findReceipt, saveUnconfirmed, staleEdit } from './mutation.ts';
import { insertPausesGuarded } from './pause-storage.ts';
import { assignmentDetail, publicDetail } from './rules.ts';

// ─── Pause routes ─────────────────────────────────────────────────────────────
// POST /api/pauses                          pause templates for one or more children
// PUT  /api/children/:childId/pauses/:id    reschedule, end, or cancel one pause
//
// Each save appends the child's whole pause list at the next assignment revision
// (ADR 0006). A multi-child save is one batch: every child's revision must still
// match, or nothing is saved.

const invalid = (message: string): never => { throw new ApiError(422, 'INVALID_INPUT', message); };
const isId = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 128;
const MAX_CHILDREN = 20;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Supply a JSON object.');
  return value as Record<string, unknown>;
}

function only(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some(key => !keys.includes(key))) invalid('Unknown pause field.');
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid('Supply the current assignment revision.');
  return Number(value);
}

function dates(input: Record<string, unknown>) {
  const { startDate, endDate, reason } = input;
  if (typeof startDate !== 'string' || typeof endDate !== 'string') invalid('Choose start and end dates.');
  if (reason !== undefined && typeof reason !== 'string') invalid('Enter a reason as text.');
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if ([...trimmed].length > 60) invalid('Keep the reason to 60 characters or fewer.');
  return { startDate: startDate as string, endDate: endDate as string, ...(trimmed ? { reason: trimmed } : {}) };
}

type ChildPauses = { childId: string; expectedRevision: number; templateIds: string[] };
type Intent =
  | { kind: 'add'; startDate: string; endDate: string; reason?: string; children: ChildPauses[] }
  | { kind: 'change'; childId: string; pauseId: string; expectedRevision: number; change: PauseChange };

function parse(path: string, method: string, body: unknown): Intent | null {
  const single = /^\/api\/children\/([^/]+)\/pauses\/([\w-]{1,128})$/.exec(path);
  if (path === '/api/pauses' && method === 'POST') {
    const input = record(body);
    only(input, ['startDate', 'endDate', 'reason', 'children']);
    const { children } = input;
    if (!Array.isArray(children) || !children.length || children.length > MAX_CHILDREN)
      invalid('Choose at least one child.');
    const parsed = (children as unknown[]).map((item): ChildPauses => {
      const child = record(item);
      only(child, ['childId', 'expectedRevision', 'templateIds']);
      const { childId, templateIds } = child;
      if (!isId(childId)) invalid('Choose a valid child.');
      if (!Array.isArray(templateIds) || !templateIds.length || !templateIds.every(isId) || new Set(templateIds).size !== templateIds.length)
        invalid('Choose each template to pause at most once.');
      return { childId: childId as string, expectedRevision: revision(child.expectedRevision), templateIds: templateIds as string[] };
    });
    if (new Set(parsed.map(child => child.childId)).size !== parsed.length) invalid('Choose each child at most once.');
    return { kind: 'add', ...dates(input), children: parsed };
  }
  if (single && method === 'PUT') {
    const input = record(body);
    const cancel = input.cancel === true;
    if (input.cancel !== undefined && !cancel) invalid('Cancel must be true.');
    only(input, cancel ? ['expectedRevision', 'cancel'] : ['expectedRevision', 'startDate', 'endDate', 'reason']);
    return { kind: 'change', childId: decodeURIComponent(single[1]), pauseId: single[2],
      expectedRevision: revision(input.expectedRevision), change: cancel ? { cancel: true } : dates(input) };
  }
  return null;
}

type Loaded = Awaited<ReturnType<typeof assignmentDetail>> & { childId: string; name: string; archive: string | null };

async function loadChild(db: D1Database, childId: string, today: string): Promise<Loaded> {
  const child = await db.prepare('SELECT display_name AS name, archive_effective_date AS archive FROM children WHERE id = ?')
    .bind(childId).first<{ name: string; archive: string | null }>();
  if (!child) throw new ApiError(404, 'NOT_FOUND', 'Child not found.');
  return { ...await assignmentDetail(db, childId, today), childId, ...child };
}

async function templateNames(db: D1Database): Promise<Map<string, string>> {
  const rows = await db.prepare(`SELECT template_id AS id, name FROM template_versions t
    WHERE revision = (SELECT MAX(revision) FROM template_versions WHERE template_id = t.template_id)`)
    .all<{ id: string; name: string }>();
  return new Map(rows.results.map(row => [row.id, row.name]));
}

function conflictMessage(conflicts: (PauseConflict & { child: string; template: string })[]) {
  return 'Nothing was paused. ' + conflicts.map(({ child, template, reason }) => reason === 'overlap'
    ? `${child} · ${template} already has a pause on some of these dates.`
    : `${child} · ${template} is no longer assigned.`).join(' ');
}

export async function pauseRoutes(request: Request, db: D1Database, parent: Parent, path: string): Promise<Response | null> {
  if (!(path === '/api/pauses' || /^\/api\/children\/[^/]+\/pauses\//.test(path))) return null;
  const action = request.headers.get('Idempotency-Key');
  if (!action || !/^[a-zA-Z0-9_-]{16,128}$/.test(action))
    throw new ApiError(400, 'INVALID_ACTION_ID', 'Supply a valid Idempotency-Key.');
  let body: unknown;
  try { body = await request.json(); } catch { throw new ApiError(400, 'INVALID_JSON', 'A valid JSON body is required.'); }
  const intent = parse(path, request.method, body);
  if (!intent) return null;

  const fingerprint = await fingerprintOf([request.method, path, intent]);
  const replay = async () => {
    const receipt = await findReceipt(db, parent.sub, action, fingerprint);
    return receipt ? json(receipt.result, receipt.status) : null;
  };
  const saved = await replay();
  if (saved) return saved;

  const targets = intent.kind === 'add'
    ? intent.children.map(({ childId, expectedRevision }) => ({ childId, expectedRevision }))
    : [{ childId: intent.childId, expectedRevision: intent.expectedRevision }];
  // A changed revision on any child is a stale edit, unless this exact action already committed.
  const checkRevisions = async (children: Loaded[]) => {
    const stale = children.find((child, index) => child.revision !== targets[index].expectedRevision);
    if (!stale) return null;
    const receipt = await replay();
    if (receipt) return receipt;
    return staleEdit(`${stale.name}’s assignments changed. Review the latest pauses before saving.`,
      intent.kind === 'change' ? publicDetail(stale) : { childId: stale.childId });
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date();
    const today = jakartaToday(now);
    const children = await Promise.all(targets.map(({ childId }) => loadChild(db, childId, today)));
    const recovered = await checkRevisions(children);
    if (recovered) return recovered;

    const outcomes: PauseResult[] = intent.kind === 'add'
      ? intent.children.map(({ templateIds }, index) => addPauses(children[index].allPauses, {
        templateIds, startDate: intent.startDate, endDate: intent.endDate, reason: intent.reason,
      }, {
        today, archiveDate: children[index].archive, newId: () => crypto.randomUUID(),
        assignedTemplateIds: (children[index].pending ?? children[index].current)?.templateIds ?? [],
      }))
      : [changePause(children[0].allPauses, intent.pauseId, intent.change, { today, archiveDate: children[0].archive,
        assignedTemplateIds: (children[0].pending ?? children[0].current)?.templateIds ?? [] })];
    const error = outcomes.find((outcome): outcome is { error: string } => 'error' in outcome);
    if (error) invalid(error.error);
    if (outcomes.some(outcome => 'conflicts' in outcome)) {
      const names = await templateNames(db);
      const conflicts = outcomes.flatMap((outcome, index) => 'conflicts' in outcome
        ? outcome.conflicts.map(conflict => ({ ...conflict, childId: children[index].childId, child: children[index].name,
          template: names.get(conflict.templateId) ?? 'A template' }))
        : []);
      throw new ApiError(422, 'PAUSE_CONFLICT', conflictMessage(conflicts), { conflicts });
    }

    const recorded = now.toISOString();
    const audit: [string, string, string] = [parent.sub, parent.email, recorded];
    const statements: D1PreparedStatement[] = [];
    const saves = children.map((child, index) => {
      const pauses = (outcomes[index] as { pauses: Pause[] }).pauses;
      const assertion = crypto.randomUUID();
      statements.push(
        insertPausesGuarded(db, child.childId, child.revision, child.revision + 1, pauses, audit),
        db.prepare('INSERT INTO mutation_assertions (id, ok) VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END)').bind(assertion),
        db.prepare('DELETE FROM mutation_assertions WHERE id = ?').bind(assertion),
      );
      return { id: child.childId, revision: child.revision + 1, pauses };
    });
    const first = saves[0];
    const result: PauseSave = intent.kind === 'add'
      ? { id: first.id, revision: first.revision, effectiveDate: intent.startDate,
        children: saves.map(({ id, revision }) => ({ id, revision })) }
      : { id: intent.pauseId, revision: first.revision, effectiveDate: nextDate(today),
        children: [{ id: first.id, revision: first.revision }] };
    const [start, end] = dayBounds(today);
    statements.push(db.prepare(`INSERT INTO mutation_receipts VALUES (?, ?, ?, 200, ?, ?, ?,
      changes(), CASE WHEN unixepoch('now') >= ? AND unixepoch('now') < ? THEN 1 ELSE 0 END)`)
      .bind(parent.sub, action, fingerprint, JSON.stringify(result), parent.email, recorded, start, end));
    try {
      await db.batch(statements);
      return json(result);
    } catch (failure) {
      const receipt = await replay();
      if (receipt) return receipt;
      const latest = await Promise.all(targets.map(({ childId }) => loadChild(db, childId, today)));
      const stale = await checkRevisions(latest);
      if (stale) return stale;
      const message = failure instanceof Error ? failure.message : '';
      if (message.includes('mutation_date_guard') && attempt === 0) continue;
      saveUnconfirmed();
    }
  }
  saveUnconfirmed('Save not confirmed. Check / retry.');
}
