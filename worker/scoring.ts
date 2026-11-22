import type { Activity, Score } from '../shared/scoring';
import type { Parent } from './auth';
import { ApiError, json } from './http';

function invalid(message: string): never {
  throw new ApiError(422, 'INVALID_INPUT', message);
}

export async function scoring(
  request: Request,
  db: D1Database,
  parent: Parent,
  today: string,
  match: RegExpMatchArray,
) {
  const [, child, date, suffix = ''] = match;
  const instant = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(+instant) || instant.toISOString().slice(0, 10) !== date)
    invalid('Choose a valid date.');
  const profile = await db
    .prepare('SELECT start_date,archive_effective_date FROM children WHERE id=?')
    .bind(child)
    .first<{ start_date: string; archive_effective_date: string | null }>();
  if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Child not found.');
  if (
    date < profile.start_date ||
    date > today ||
    (profile.archive_effective_date && date >= profile.archive_effective_date)
  )
    invalid('Choose a date when this child was active.');
  const routines = db
    .prepare(
      `SELECT v.template_id,v.name,v.activities_json FROM json_each((
    SELECT template_ids_json FROM assignment_versions WHERE child_id=? AND effective_date<=?
    ORDER BY effective_date DESC,revision DESC LIMIT 1)) a JOIN template_versions v ON v.template_id=a.value
    WHERE v.retired=0 AND v.revision=(SELECT revision FROM template_versions WHERE template_id=a.value
    AND effective_date<=? ORDER BY effective_date DESC,revision DESC LIMIT 1) ORDER BY a.key`,
    )
    .bind(child, date, date);
  const [templates, revisions, sums] = await db.batch<Record<string, unknown>>([
    routines,
    db
      .prepare(
        'SELECT stream,revision,points,outcome,reason,actor,recorded FROM score_revisions WHERE child_id=? AND day=? ORDER BY recorded DESC,revision DESC',
      )
      .bind(child, date),
    db
      .prepare(
        'SELECT coalesce(sum(points),0) total,coalesce(sum(CASE WHEN day=? THEN points END),0) net FROM effective_scores WHERE child_id=?',
      )
      .bind(date, child),
  ]);
  const activities: Activity[] = templates.results.flatMap((row) =>
    (JSON.parse(String(row.activities_json)) as Activity[])
      .filter((a) => !a.weekdays || a.weekdays.includes(instant.getUTCDay() || 7))
      .map((a) => ({
        ...a,
        template: String(row.name),
        templateId: String(row.template_id),
        stream: 'activities/' + row.template_id + '/' + a.id,
      })),
  );
  const history = revisions.results as unknown as Score[];
  if (!suffix && request.method === 'GET') return json({ today, activities, history, ...sums.results[0] });
  const activity = activities.find((a) => a.stream === suffix);
  const create = suffix === 'one-offs' && request.method === 'POST';
  const edit = /^one-offs\/[\w-]+$/.test(suffix) && request.method === 'PATCH';
  if (!(activity && request.method === 'PUT') && !create && !edit)
    throw new ApiError(404, 'NOT_FOUND', 'Entry unavailable.');
  const key = request.headers.get('Idempotency-Key');
  if (!key || !/^[\w-]{16,128}$/.test(key)) invalid('Missing or invalid action ID.');
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Expected an entry.');
  const input = raw as Record<string, unknown>;
  const allowed = activity
    ? ['expectedRevision', 'outcome']
    : create
      ? ['points', 'reason']
      : input.void === true
        ? ['expectedRevision', 'void']
        : ['expectedRevision', 'points', 'reason'];
  if (Object.keys(input).some((k) => !allowed.includes(k))) invalid('Unexpected entry field.');
  const fingerprint = JSON.stringify([child, date, suffix, request.method, Object.entries(input).sort()]);
  async function replay() {
    const receipt = await db
      .prepare(
        'SELECT fingerprint,status,result_json FROM mutation_receipts WHERE actor_id=? AND action_id=?',
      )
      .bind(parent.sub, key)
      .first<{ fingerprint: string; status: number; result_json: string }>();
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint)
      throw new ApiError(409, 'ACTION_REUSED', 'Action ID already used.');
    return json(JSON.parse(receipt.result_json), receipt.status);
  }
  const previous = await replay();
  if (previous) return previous;
  const stream = create ? 'one-offs/' + crypto.randomUUID() : suffix;
  const current = history.filter((s) => s.stream === stream).sort((a, b) => b.revision - a.revision)[0];
  if (edit && !current) throw new ApiError(404, 'NOT_FOUND', 'Entry not found.');
  const expected = create ? 0 : input.expectedRevision;
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0)
    invalid('Invalid revision.');
  if (expected !== (current?.revision ?? 0))
    throw new ApiError(409, 'STALE_EDIT', 'Entry changed. Review the latest score.', current);
  if (current?.outcome === 'void') invalid('This entry has been voided.');
  let points: number,
    outcome: string,
    reason = '';
  if (activity) {
    outcome = typeof input.outcome === 'string' ? input.outcome : '';
    if (!['done_correctly', 'needs_improvement', 'unrecorded'].includes(outcome)) invalid('Invalid outcome.');
    points =
      outcome === 'done_correctly'
        ? activity.reward
        : outcome === 'needs_improvement'
          ? -(activity.penalty ?? 0)
          : 0;
  } else if (edit && input.void === true) {
    points = 0;
    outcome = 'void';
    reason = current!.reason;
  } else {
    points = typeof input.points === 'number' ? input.points : NaN;
    reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!Number.isInteger(points) || !points || Math.abs(points) > 999 || !reason || [...reason].length > 160)
      invalid('Enter 1–999 stars and a reason of up to 160 characters.');
    outcome = 'one-off';
  }
  const revision = expected + 1,
    recorded = new Date().toISOString(),
    status = create ? 201 : 200;
  const result = { stream, revision, points, outcome, reason, actor: parent.email, recorded };
  try {
    await db.batch([
      db
        .prepare('INSERT INTO score_revisions VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(child, date, stream, revision, points, outcome, reason, parent.email, recorded),
      db
        .prepare('INSERT INTO mutation_receipts VALUES (?,?,?,?,?,?,?,1,1)')
        .bind(parent.sub, key, fingerprint, status, JSON.stringify(result), parent.email, recorded),
    ]);
  } catch (error) {
    const receipt = await replay();
    if (receipt) return receipt;
    const latest = await db
      .prepare('SELECT revision FROM effective_scores WHERE child_id=? AND day=? AND stream=?')
      .bind(child, date, stream)
      .first<{ revision: number }>();
    if (latest && latest.revision > expected)
      throw new ApiError(409, 'STALE_EDIT', 'Entry changed. Review the latest score.');
    throw error;
  }
  return json(result, status);
}
