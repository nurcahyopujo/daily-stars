import type { CatalogChoice } from '../shared/prizes.ts';
import type { Parent } from './auth.ts';
import { ApiError, json } from './http.ts';

// A child's prize account: balance, redemption history, and the active catalog
// prizes this child can pick from (GLOSSARY.md › Redemption, ADR 0002 and 0005).
export async function prizes(request: Request, db: D1Database, parent: Parent, today: string, match: RegExpMatchArray) {
  const [, child, id] = match;
  const balance = db.prepare('SELECT balance FROM child_balances WHERE child_id=?').bind(child);
  if (!id && request.method === 'GET') {
    const [account, history, catalog] = await db.batch<Record<string, unknown>>([
      balance,
      db.prepare('SELECT id,label,cost,recorded,voided,prize_id AS prizeId FROM redemptions WHERE child_id=? ORDER BY recorded DESC, id').bind(child),
      db.prepare(`SELECT id,name,cost,one_time AS oneTime,image_url AS imageUrl,
          EXISTS(SELECT 1 FROM redemptions r WHERE r.child_id=? AND r.prize_id=prizes.id AND r.voided IS NULL) AS redeemed
        FROM prizes WHERE archived IS NULL ORDER BY cost, name COLLATE NOCASE, id`).bind(child),
    ]);
    if (!account.results.length) throw new ApiError(404, 'NOT_FOUND', 'Child not found.');
    const choices: CatalogChoice[] = catalog.results.map(row => ({
      id: String(row.id), name: String(row.name), cost: Number(row.cost), oneTime: Boolean(row.oneTime),
      imageUrl: row.imageUrl === null ? null : String(row.imageUrl), redeemed: Boolean(row.redeemed),
    }));
    return json({ ...account.results[0], history: history.results, catalog: choices });
  }
  if (!id || !['PUT', 'PATCH'].includes(request.method)) throw new ApiError(405, 'METHOD', 'Unsupported request.');
  const input = await request.json<Record<string, unknown>>().catch(() => null);
  if (!input || typeof input !== 'object') throw new ApiError(422, 'INVALID_INPUT', 'Enter a prize.');
  const now = new Date().toISOString();
  if (request.method === 'PATCH') {
    if (input.void !== true || Object.keys(input).length !== 1) throw new ApiError(422, 'INVALID_INPUT', 'Choose a redemption to void.');
    const row = await db.prepare('UPDATE redemptions SET voided=coalesce(voided,?), voided_by=coalesce(voided_by,?) WHERE child_id=? AND id=? RETURNING id')
      .bind(now, parent.email, child, id).first();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Redemption not found.');
    return json({ id });
  }
  return 'prizeId' in input ? redeemCatalogPrize(db, parent, today, child, id, input, now) : redeemNamedPrize(db, parent, today, child, id, input, now);
}

const activeChild = '(archive_effective_date IS NULL OR archive_effective_date>?)';

async function balanceFailure(db: D1Database, child: string, cost: number): Promise<never> {
  const account = await db.prepare('SELECT balance FROM child_balances WHERE child_id=?').bind(child).first<{ balance: number }>();
  if (account && cost > account.balance)
    throw new ApiError(422, 'INSUFFICIENT_BALANCE', 'Redemption rejected. Stars to spend exceed the available balance.');
  throw new ApiError(422, 'UNAVAILABLE_BALANCE', 'Check that this child is active.');
}

async function redeemNamedPrize(db: D1Database, parent: Parent, today: string, child: string, id: string, input: Record<string, unknown>, now: string) {
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const cost = input.cost;
  if (!label || label.length > 160 || typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 1 || Object.keys(input).length !== 2)
    throw new ApiError(422, 'INVALID_INPUT', 'Enter a prize name and a positive whole number of stars.');
  // The balance check and debit share a write statement so concurrent spends cannot overdraw.
  const [, saved] = await db.batch<Record<string, unknown>>([
    db.prepare(`INSERT INTO redemptions(child_id,id,label,cost,actor,recorded)
      SELECT child_id,?,?,?,?,? FROM child_balances JOIN children ON children.id=child_id
      WHERE child_id=? AND balance>=? AND ${activeChild}
      ON CONFLICT(child_id,id) DO NOTHING`).bind(id,label,cost,parent.sub,now,child,cost,today),
    db.prepare('SELECT label,cost,actor,prize_id FROM redemptions WHERE child_id=? AND id=?').bind(child,id),
  ]);
  const row = saved.results[0];
  if (!row) return balanceFailure(db, child, cost);
  if (row.label !== label || row.cost !== cost || row.actor !== parent.sub || row.prize_id !== null) throw new ApiError(409, 'ACTION_REUSED', 'Redemption already exists.');
  return json({ id });
}

async function redeemCatalogPrize(db: D1Database, parent: Parent, today: string, child: string, id: string, input: Record<string, unknown>, now: string) {
  const prizeId = input.prizeId;
  if (typeof prizeId !== 'string' || !prizeId || prizeId.length > 128 || Object.keys(input).length !== 1)
    throw new ApiError(422, 'INVALID_INPUT', 'Choose a prize from the list.');
  // The copied name and cost come from the catalog row read inside the same write,
  // and a one-time prize is guarded by the child's redemptions still in effect.
  const [, saved] = await db.batch<Record<string, unknown>>([
    db.prepare(`INSERT INTO redemptions(child_id,id,label,cost,actor,recorded,prize_id)
      SELECT child_id,?,prizes.name,prizes.cost,?,?,prizes.id
      FROM child_balances JOIN children ON children.id=child_id JOIN prizes ON prizes.id=?
      WHERE child_id=? AND ${activeChild} AND prizes.archived IS NULL AND balance>=prizes.cost
        AND (prizes.one_time=0 OR NOT EXISTS (
          SELECT 1 FROM redemptions r WHERE r.child_id=child_balances.child_id AND r.prize_id=prizes.id AND r.voided IS NULL))
      ON CONFLICT(child_id,id) DO NOTHING`).bind(id,parent.sub,now,prizeId,child,today),
    db.prepare('SELECT actor,prize_id FROM redemptions WHERE child_id=? AND id=?').bind(child,id),
  ]);
  const row = saved.results[0];
  if (row) {
    if (row.actor !== parent.sub || row.prize_id !== prizeId) throw new ApiError(409, 'ACTION_REUSED', 'Redemption already exists.');
    return json({ id });
  }
  const prize = await db.prepare(`SELECT cost,one_time AS oneTime,archived IS NOT NULL AS archived,
      EXISTS(SELECT 1 FROM redemptions r WHERE r.child_id=? AND r.prize_id=prizes.id AND r.voided IS NULL) AS redeemed
    FROM prizes WHERE id=?`).bind(child, prizeId).first<{ cost: number; oneTime: number; archived: number; redeemed: number }>();
  if (!prize || prize.archived) throw new ApiError(422, 'PRIZE_UNAVAILABLE', 'This prize is no longer in the prize list. Reload and choose again.');
  if (prize.oneTime && prize.redeemed) throw new ApiError(422, 'ALREADY_REDEEMED', 'This one-time prize was already redeemed for this child.');
  return balanceFailure(db, child, prize.cost);
}
