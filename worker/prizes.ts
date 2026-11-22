import type { Parent } from './auth.ts';
import { ApiError, json } from './http.ts';

export async function prizes(request: Request, db: D1Database, parent: Parent, today: string, match: RegExpMatchArray) {
  const [, child, id] = match;
  const balance = db.prepare('SELECT balance FROM child_balances WHERE child_id=?').bind(child);
  if (!id && request.method === 'GET') {
    const [account, history] = await db.batch<Record<string, unknown>>([
      balance,
      db.prepare('SELECT id,label,cost,recorded,voided FROM redemptions WHERE child_id=? ORDER BY recorded DESC, id').bind(child),
    ]);
    if (!account.results.length) throw new ApiError(404, 'NOT_FOUND', 'Child not found.');
    return json({ ...account.results[0], history: history.results });
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
  } else {
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    const cost = input.cost;
    if (!label || label.length > 160 || typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 1 || Object.keys(input).length !== 2)
      throw new ApiError(422, 'INVALID_INPUT', 'Enter a prize name and a positive whole number of stars.');
    // The balance check and debit share a write statement so concurrent spends cannot overdraw.
    const [, saved] = await db.batch<Record<string, unknown>>([
      db.prepare(`INSERT INTO redemptions(child_id,id,label,cost,actor,recorded)
        SELECT child_id,?,?,?,?,? FROM child_balances JOIN children ON children.id=child_id
        WHERE child_id=? AND balance>=? AND (archive_effective_date IS NULL OR archive_effective_date>?)
        ON CONFLICT(child_id,id) DO NOTHING`).bind(id,label,cost,parent.sub,now,child,cost,today),
      db.prepare('SELECT label,cost,actor FROM redemptions WHERE child_id=? AND id=?').bind(child,id),
    ]);
    const row = saved.results[0];
    if (!row) throw new ApiError(422, 'UNAVAILABLE_BALANCE', 'Check the current balance and that this child is active.');
    if (row.label !== label || row.cost !== cost || row.actor !== parent.sub) throw new ApiError(409, 'ACTION_REUSED', 'Redemption already exists.');
  }
  return json({ id });
}
