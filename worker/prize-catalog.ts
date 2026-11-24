import { validatePrizeFields, type Prize, type PrizeFields } from '../shared/prizes.ts';
import type { Parent } from './auth.ts';
import { ApiError, json } from './http.ts';
import { fingerprintOf, findReceipt, saveUnconfirmed, staleEdit } from './mutation.ts';

// The household prize catalog (GLOSSARY.md › Prize, ADR 0005). Prizes are
// archived, never deleted, so redemptions can keep pointing at them.

const columns = `id, name, cost, one_time AS oneTime, link, image_url AS imageUrl,
  archived IS NOT NULL AS archived, revision, created_at AS createdAt`;

type PrizeRow = Omit<Prize, 'oneTime' | 'archived'> & { oneTime: number; archived: number };
const toPrize = (row: PrizeRow): Prize => ({ ...row, oneTime: Boolean(row.oneTime), archived: Boolean(row.archived) });

async function getPrize(db: D1Database, id: string): Promise<Prize | null> {
  const row = await db.prepare(`SELECT ${columns} FROM prizes WHERE id = ?`).bind(id).first<PrizeRow>();
  return row ? toPrize(row) : null;
}

async function nameTaken(db: D1Database, name: string, exceptId: string | null): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM prizes WHERE archived IS NULL AND name = ? COLLATE NOCASE AND id IS NOT ?')
    .bind(name, exceptId).first();
  return row !== null;
}

const duplicateName = (): never => {
  throw new ApiError(422, 'DUPLICATE_NAME', 'Another active prize already has this name. Choose a different name.');
};

type PrizeIntent = { kind: 'create'; fields: PrizeFields } | { kind: 'edit'; id: string; expectedRevision: number; fields: PrizeFields };

async function savePrize(db: D1Database, parent: Parent, intent: PrizeIntent, action: string): Promise<{ status: number; prize: Prize }> {
  const fingerprint = await fingerprintOf(intent);
  const recall = async () => {
    const receipt = await findReceipt(db, parent.sub, action, fingerprint);
    return receipt ? { status: receipt.status, prize: receipt.result as Prize } : null;
  };
  const replay = await recall();
  if (replay) return replay;

  const previous = intent.kind === 'edit' ? await getPrize(db, intent.id) : null;
  if (intent.kind === 'edit') {
    if (!previous) throw new ApiError(404, 'NOT_FOUND', 'Prize not found.');
    if (previous.revision !== intent.expectedRevision) {
      const saved = await recall();
      if (saved) return saved;
      staleEdit('This prize was changed by another save. Review the current prize.', previous);
    }
  }
  const { fields } = intent;
  const now = new Date().toISOString();
  const prize: Prize = {
    id: intent.kind === 'create' ? crypto.randomUUID() : intent.id,
    name: fields.name, cost: fields.cost, oneTime: fields.oneTime, link: fields.link, imageUrl: fields.imageUrl,
    archived: fields.archived,
    revision: intent.kind === 'create' ? 1 : intent.expectedRevision + 1,
    createdAt: previous?.createdAt ?? now,
  };
  if (!prize.archived && await nameTaken(db, prize.name, intent.kind === 'edit' ? intent.id : null)) duplicateName();
  const status = intent.kind === 'create' ? 201 : 200;
  const write = intent.kind === 'create'
    ? db.prepare(`INSERT INTO prizes (id, name, cost, one_time, link, image_url, archived, revision, created_at, updated_at, actor_id, actor_email)
        VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? THEN ? END, 1, ?, ?, ?, ?)`)
      .bind(prize.id, prize.name, prize.cost, Number(prize.oneTime), prize.link, prize.imageUrl,
        Number(prize.archived), now, now, now, parent.sub, parent.email)
    : db.prepare(`UPDATE prizes SET name = ?, cost = ?, one_time = ?, link = ?, image_url = ?,
        archived = CASE WHEN ? THEN coalesce(archived, ?) END, revision = revision + 1,
        updated_at = ?, actor_id = ?, actor_email = ? WHERE id = ? AND revision = ?`)
      .bind(prize.name, prize.cost, Number(prize.oneTime), prize.link, prize.imageUrl,
        Number(prize.archived), now, now, parent.sub, parent.email, prize.id, intent.expectedRevision);
  try {
    await db.batch([
      write,
      db.prepare(`INSERT INTO mutation_receipts
        (actor_id, action_id, fingerprint, status, result_json, actor_email, created_at, success_guard, date_guard)
        VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END, 1)`)
        .bind(parent.sub, action, fingerprint, status, JSON.stringify(prize), parent.email, now),
    ]);
    return { status, prize };
  } catch {
    // Recover from the primary before deciding what the failure meant.
    const saved = await recall();
    if (saved) return saved;
    if (intent.kind === 'edit') {
      const current = await getPrize(db, intent.id);
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Prize not found.');
      if (current.revision !== intent.expectedRevision) {
        staleEdit('This prize was changed by another save. Review the current prize.', current);
      }
    }
    if (!prize.archived && await nameTaken(db, prize.name, intent.kind === 'edit' ? intent.id : null)) duplicateName();
    saveUnconfirmed();
  }
}

function invalid(message: string): never { throw new ApiError(422, 'INVALID_INPUT', message); }

export async function prizeCatalogRoutes(request: Request, db: D1Database, parent: Parent, pathname: string): Promise<Response | null> {
  const match = /^\/api\/prizes(?:\/([\w-]{1,128}))?$/.exec(pathname);
  if (!match) return null;
  const id = match[1];
  if (request.method === 'GET') {
    if (!id) {
      const rows = await db.prepare(`SELECT ${columns} FROM prizes ORDER BY created_at, id`).all<PrizeRow>();
      return json({ prizes: rows.results.map(toPrize) });
    }
    const prize = await getPrize(db, id);
    if (!prize) throw new ApiError(404, 'NOT_FOUND', 'Prize not found.');
    return json(prize);
  }
  if (!(request.method === 'POST' && !id) && !(request.method === 'PUT' && id)) {
    throw new ApiError(405, 'METHOD', 'Unsupported request.');
  }
  const action = request.headers.get('Idempotency-Key');
  if (!action || !/^[a-zA-Z0-9_-]{16,128}$/.test(action)) {
    throw new ApiError(400, 'INVALID_ACTION_ID', 'Supply an Idempotency-Key of 16–128 letters, digits, underscores or hyphens.');
  }
  const body = await request.json<unknown>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Supply a JSON object.');
  const input = body as Record<string, unknown>;
  const allowed = ['name', 'cost', 'oneTime', 'link', 'imageUrl', 'archived', ...(id ? ['expectedRevision'] : [])];
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid('Unknown prize field.');
  const checked = validatePrizeFields(input);
  if ('error' in checked) invalid(checked.error);
  let intent: PrizeIntent;
  if (id) {
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) invalid('Supply the current prize revision.');
    intent = { kind: 'edit', id, expectedRevision: Number(input.expectedRevision), fields: checked.fields };
  } else {
    if (checked.fields.archived) invalid('A new prize cannot start archived.');
    intent = { kind: 'create', fields: checked.fields };
  }
  const result = await savePrize(db, parent, intent, action);
  return json(result.prize, result.status);
}
