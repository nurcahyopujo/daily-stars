import type { AssignmentDetail, RoutineActivity, RuleSave, TemplateDetail, TemplateVersion } from '../shared/profiles.ts';
import type { Parent } from './auth.ts';
import { dayBounds, jakartaToday, nextDate } from './calendar.ts';
import { eligibleTemplates } from './child-storage.ts';
import { ApiError, json } from './http.ts';
import { fingerprintOf, findReceipt, saveUnconfirmed, staleEdit } from './mutation.ts';

const allWeekdays = [1, 2, 3, 4, 5, 6, 7];
const invalid = (message: string): never => { throw new ApiError(422, 'INVALID_INPUT', message); };
const missing = (message: string): never => { throw new ApiError(404, 'NOT_FOUND', message); };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Supply a JSON object.');
  return value as Record<string, unknown>;
}

function name(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 80)
    return invalid(`Enter a ${field} of 1–80 characters.`);
  return value.trim();
}

function points(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > 999)
    return invalid(`Enter whole stars from ${minimum} to 999.`);
  return value;
}

function activities(value: unknown, editing: boolean) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return invalid('Use 1–30 activities.');
  const ids = new Set<string>();
  return value.map((item): Omit<RoutineActivity, 'id'> & { id?: string } => {
    const input = record(item);
    if (Object.keys(input).some(key => !['id', 'label', 'rewardPoints', 'penaltyPoints', 'weekdays'].includes(key)))
      invalid('Unknown activity field.');
    const { id, label, rewardPoints, penaltyPoints, weekdays = allWeekdays } = input;
    if (id !== undefined) {
      if (!editing || typeof id !== 'string' || !id || id.length > 128 || ids.has(id))
        return invalid('Supply a distinct ID for each retained activity.');
      ids.add(id);
    }
    if (!Array.isArray(weekdays) || !weekdays.length || new Set(weekdays).size !== weekdays.length
      || weekdays.some((day) => !allWeekdays.includes(day))) return invalid('Select at least one distinct weekday.');
    return { ...(id !== undefined ? { id } : {}), label: name(label, 'label'), reward: points(rewardPoints, 1),
      ...(penaltyPoints !== undefined ? { penalty: points(penaltyPoints, 0) } : {}), weekdays };
  });
}

const templateColumns = 'revision, name, retired, effective_date AS effectiveDate, activities_json AS activitiesJson';

async function templateDetail(db: D1Database, id: string, today: string): Promise<TemplateDetail> {
  const tomorrow = nextDate(today);
  const [versions, children] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${templateColumns} FROM template_versions WHERE template_id = ?
      AND revision IN (
        SELECT (SELECT revision FROM template_versions WHERE template_id = ? AND effective_date <= ?
          ORDER BY effective_date DESC, revision DESC LIMIT 1)
        UNION
        SELECT (SELECT revision FROM template_versions WHERE template_id = ? AND effective_date > ?
          ORDER BY effective_date DESC, revision DESC LIMIT 1)
      ) ORDER BY effective_date, revision`).bind(id, id, today, id, today),
    db.prepare(`SELECT display_name AS name FROM children c
      WHERE c.start_date <= ? AND (c.archive_effective_date IS NULL OR c.archive_effective_date > ?)
        AND ? IN (SELECT value FROM json_each((
          SELECT template_ids_json FROM assignment_versions WHERE child_id = c.id AND effective_date <= ?
          ORDER BY effective_date DESC, revision DESC LIMIT 1)))
      ORDER BY display_name, id`).bind(tomorrow, tomorrow, id, tomorrow),
  ]);
  const detail: TemplateDetail = { id, current: null, pending: null, affectedChildren: children.results.map(row => String(row.name)) };
  for (const raw of versions.results) {
    const { activitiesJson, retired, ...row } = raw as Omit<TemplateVersion, 'retired' | 'activities'> & {
      activitiesJson: string; retired: number;
    };
    detail[row.effectiveDate <= today ? 'current' : 'pending'] = { ...row, retired: Boolean(retired), activities: JSON.parse(activitiesJson) };
  }
  if (!detail.current && !detail.pending) missing('Template not found.');
  return detail;
}

async function assignmentDetail(db: D1Database, id: string, today: string): Promise<AssignmentDetail> {
  const rows = await db.prepare(`SELECT c.start_date AS startDate, a.revision,
      a.effective_date AS effectiveDate, a.template_ids_json AS ids
    FROM children c LEFT JOIN assignment_versions a ON a.child_id = c.id
    WHERE c.id = ? ORDER BY a.effective_date DESC, a.revision DESC`)
    .bind(id).all<{ startDate: string } & (
      { revision: number; effectiveDate: string; ids: string } |
      { revision: null; effectiveDate: null; ids: null }
    )>();
  const child = rows.results[0] ?? missing('Child not found.');
  const version = (pending: boolean) => {
    const row = rows.results.find(({ effectiveDate }) => effectiveDate !== null && (effectiveDate > today) === pending);
    return row?.revision != null
      ? { revision: row.revision, effectiveDate: row.effectiveDate, templateIds: JSON.parse(row.ids) as string[] }
      : null;
  };
  return {
    current: version(false) ?? { revision: 0, effectiveDate: child.startDate, templateIds: [] },
    pending: version(true),
  };
}

export async function ruleRoutes(request: Request, db: D1Database, parent: Parent, today: string, path: string) {
  const template = /^\/api\/templates\/([^/]+)$/.exec(path);
  const assignment = /^\/api\/children\/([^/]+)\/assignments$/.exec(path);
  const creating = request.method === 'POST' && path === '/api/templates';
  const route = template ?? assignment;
  if (!creating && (!route || !['GET', 'PUT'].includes(request.method))) return null;
  const id = route?.[1] ?? crypto.randomUUID();
  if (request.method === 'GET') {
    return json({ today, ...(assignment ? await assignmentDetail(db, id, today) : await templateDetail(db, id, today)) });
  }

  const action = request.headers.get('Idempotency-Key');
  if (!action || !/^[a-zA-Z0-9_-]{16,128}$/.test(action))
    throw new ApiError(400, 'INVALID_ACTION_ID', 'Supply a valid Idempotency-Key.');
  let body: unknown;
  try { body = await request.json(); } catch { throw new ApiError(400, 'INVALID_JSON', 'A valid JSON body is required.'); }
  const input = record(body);
  const expected = creating ? 0 : Number(input.expectedRevision);
  if (!creating && (!Number.isSafeInteger(input.expectedRevision) || expected < (assignment ? 0 : 1)))
    invalid('Supply the current revision.');
  const ids = input.templateIds;
  if (assignment && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.length > 128)
    || new Set(ids).size !== ids.length)) invalid('Select each template at most once.');
  const startToday = input.startToday === true;
  if (assignment && input.startToday !== undefined && typeof input.startToday !== 'boolean')
    invalid('Choose whether the new templates start today.');
  if (startToday && assignment && !(ids as string[]).length) invalid('Select at least one template to add today.');
  const operation = input.operation ?? 'save';
  const allowed = assignment ? ['expectedRevision', 'templateIds', 'startToday']
    : creating ? ['name', 'activities'] : operation === 'save'
      ? ['expectedRevision', 'name', 'activities', 'retired'] : ['expectedRevision', 'operation'];
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid('Unknown rule field.');
  if ((!template && operation !== 'save') || (operation !== 'save' && operation !== 'retire' && operation !== 'cancelRetirement'))
    invalid('Choose a valid template action.');
  const retired = operation === 'retire' || input.retired === true;
  if (input.retired !== undefined && (typeof input.retired !== 'boolean' || !template || operation !== 'save'))
    invalid('Supply a valid retirement status.');
  const definition = !assignment && operation === 'save' && !retired
    ? { name: name(input.name, 'template name'), activities: activities(input.activities, !creating) } : null;
  const fingerprint = await fingerprintOf([request.method, path, expected,
    assignment ? (startToday ? ['startToday', ids] : ids) : [operation, retired, definition]]);
  const replay = async () => {
    const row = await findReceipt(db, parent.sub, action, fingerprint);
    return row ? json(row.result, row.status) : null;
  };
  const saved = await replay();
  if (saved) return saved;

  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date();
    const date = jakartaToday(now);
    const effectiveDate = creating || startToday ? date : nextDate(date);
    const result: RuleSave = { id, revision: expected + 1, effectiveDate };
    const recorded = now.toISOString();
    const status = creating ? 201 : 200;
    const bindings = [id, result.revision, effectiveDate];
    const audit = [parent.sub, parent.email, recorded];
    const statements: D1PreparedStatement[] = [];
    const loadDetail = () => assignment ? assignmentDetail(db, id, date) : templateDetail(db, id, date);
    const conflict = async (detail: AssignmentDetail | TemplateDetail) => {
      if ((detail.pending ?? detail.current)?.revision !== expected) {
        const receipt = await replay();
        if (receipt) return receipt;
        staleEdit('These rules changed. Review the latest version before saving.', detail);
      }
    };
    const detail = creating ? null : await loadDetail();
    const recovered = detail && await conflict(detail);
    if (recovered) return recovered;
    if (assignment) {
      const additions = ids as string[];
      const plan = detail as AssignmentDetail;
      const child = await db.prepare('SELECT archive_effective_date AS archive FROM children WHERE id = ?')
        .bind(id).first<{ archive: string | null }>();
      if (child?.archive && child.archive <= effectiveDate) invalid('This child will be archived by the effective date.');

      const selected = startToday ? [...new Set([...plan.current!.templateIds, ...additions])] : additions;
      const validate = JSON.stringify(additions);
      statements.push(db.prepare(`INSERT INTO assignment_versions
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE
          coalesce((SELECT MAX(revision) FROM assignment_versions WHERE child_id = ?), 0) = ?
          AND EXISTS (SELECT 1 FROM children WHERE id = ? AND (archive_effective_date IS NULL OR archive_effective_date > ?))
          AND (SELECT COUNT(*) FROM json_each(?) WHERE value IN (${eligibleTemplates})) = ?`)
        .bind(...bindings, JSON.stringify(selected), ...audit, id, expected, id, effectiveDate,
          validate, effectiveDate, effectiveDate, additions.length));
      const pending = plan.pending;
      if (startToday && pending && (!child?.archive || child.archive > pending.effectiveDate)) {
        const future = [...new Set([...pending.templateIds, ...additions])];
        result.revision++;
        // A concurrent write can already own the first revision, so require this batch's first insert.
        statements.push(db.prepare(`INSERT INTO assignment_versions
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (
            SELECT 1 FROM children WHERE id = ? AND (archive_effective_date IS NULL OR archive_effective_date > ?)
          )`).bind(id, result.revision, pending.effectiveDate, JSON.stringify(future), ...audit, id, pending.effectiveDate));
      }
    } else {
      const templateDetail = detail && 'affectedChildren' in detail ? detail : null;
      if (templateDetail?.current?.retired) throw new ApiError(409, 'TEMPLATE_RETIRED', 'This template is retired.');
      const latest = templateDetail?.pending ?? templateDetail?.current;
      if (operation === 'cancelRetirement' && !templateDetail?.pending?.retired)
        throw new ApiError(409, 'RETIREMENT_NOT_PENDING', 'There is no scheduled retirement to cancel.');
      if (templateDetail?.pending?.retired && operation === 'save' && !retired)
        throw new ApiError(409, 'RETIREMENT_PENDING', 'Cancel the scheduled retirement before editing.');
      // Retirement carries the last saved definition so cancellation can restore it.
      const source = definition ?? latest!;
      const retained = new Set(latest?.activities.map(activity => activity.id));
      if (source.activities.some(activity => activity.id && !retained.has(activity.id)))
        invalid('An activity is no longer in this template. Review the latest version.');
      const definitions = source.activities.map(activity => ({ ...activity, id: activity.id ?? crypto.randomUUID() }));
      if (creating) statements.push(db.prepare('INSERT INTO templates VALUES (?, ?)').bind(id, recorded));
      statements.push(db.prepare(`INSERT INTO template_versions
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
        coalesce((SELECT MAX(revision) FROM template_versions WHERE template_id = ?), 0) = ?`)
        .bind(...bindings, source.name, Number(retired), JSON.stringify(definitions), ...audit, id, expected));
    }
    const [start, end] = dayBounds(date);
    statements.push(db.prepare(`INSERT INTO mutation_receipts VALUES (?, ?, ?, ?, ?, ?, ?,
      changes(), CASE WHEN unixepoch('now') >= ? AND unixepoch('now') < ? THEN 1 ELSE 0 END)`)
      .bind(parent.sub, action, fingerprint, status, JSON.stringify(result), parent.email, recorded, start, end));
    try {
      await db.batch(statements);
      return json(result, status);
    } catch (error) {
      const receipt = await replay() ?? (creating ? null : await conflict(await loadDetail()));
      if (receipt) return receipt;
      const message = error instanceof Error ? error.message : '';
      if (message.includes('mutation_date_guard') && attempt === 0) continue;
      if (message.includes('mutation_write_guard') && assignment)
        invalid('A selected template or child is unavailable on the effective date. Reload the assignments.');
      saveUnconfirmed();
    }
  }
  saveUnconfirmed('Save not confirmed. Check / retry.');
}
