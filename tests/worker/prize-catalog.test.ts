import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { authenticatedFetch, useSyntheticAccess } from './auth-fixture';
useSyntheticAccess();

const origin = 'https://daily-stars.test';
const sunny = '11111111-1111-4111-8111-111111111111';
const robin = '22222222-2222-4222-8222-222222222222';

function send(path: string, method: string, body: object, action: string | null = crypto.randomUUID()) {
  return authenticatedFetch(origin + path, {
    method, body: JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(action ? { 'Idempotency-Key': action } : {}) },
  });
}
const fields = { name: 'Lego set', cost: 50, oneTime: true, link: 'https://shopee.co.id/Lego-i.1.2', imageUrl: null };
const create = async (body: object = fields) => {
  const response = await send('/api/prizes', 'POST', body);
  expect(response.status).toBe(201);
  return response.json<{ id: string; revision: number }>();
};
const award = (child: string, points: number) => env.DB.prepare(
  "INSERT INTO score_revisions VALUES (?,'2026-11-09',?,1,?,'one-off','Award','parent','now')",
).bind(child, 'one-offs/' + crypto.randomUUID(), points).run();
const redeem = (child: string, body: object, id = crypto.randomUUID()) =>
  send(`/api/children/${child}/prizes/${id}`, 'PUT', body, null);
const account = async (child: string) => (await authenticatedFetch(`${origin}/api/children/${child}/prizes`)).json<{
  balance: number; catalog: { id: string; redeemed: boolean }[]; history: { label: string; cost: number; prizeId: string | null }[];
}>();

describe('prize catalog', () => {
  it('creates, lists, edits and archives prizes with idempotent retries', async () => {
    const action = crypto.randomUUID();
    const first = await send('/api/prizes', 'POST', fields, action);
    const replay = await send('/api/prizes', 'POST', fields, action);
    expect(first.status).toBe(201);
    const prize = await first.json<{ id: string; revision: number }>();
    expect(await replay.json()).toEqual(prize);
    expect(prize).toMatchObject({ name: 'Lego set', cost: 50, oneTime: true, archived: false, revision: 1, imageUrl: null });
    expect((await send('/api/prizes', 'POST', { ...fields, cost: 1 }, action)).status).toBe(409);

    const list = await (await authenticatedFetch(origin + '/api/prizes')).json<{ prizes: unknown[] }>();
    expect(list.prizes).toHaveLength(1);

    const edited = await send('/api/prizes/' + prize.id, 'PUT', { ...fields, cost: 60, expectedRevision: 1 });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ cost: 60, revision: 2 });
    const stale = await send('/api/prizes/' + prize.id, 'PUT', { ...fields, expectedRevision: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'STALE_EDIT', current: { revision: 2 } } });

    const archived = await send('/api/prizes/' + prize.id, 'PUT', { ...fields, archived: true, expectedRevision: 2 });
    expect(await archived.json()).toMatchObject({ archived: true, revision: 3 });
    expect(await (await authenticatedFetch(origin + '/api/prizes/' + prize.id)).json()).toMatchObject({ archived: true });
  });

  it('validates fields and keeps active names unique ignoring case', async () => {
    for (const body of [
      { ...fields, name: ' ' }, { ...fields, cost: 0 }, { ...fields, cost: 1.5 }, { ...fields, oneTime: 'yes' },
      { ...fields, link: 'http://shopee.co.id/x' }, { ...fields, imageUrl: 'javascript:alert(1)' }, { ...fields, extra: 1 },
      { ...fields, archived: true },
    ]) expect((await send('/api/prizes', 'POST', body)).status).toBe(422);
    expect((await send('/api/prizes', 'POST', fields, null)).status).toBe(400);

    const prize = await create();
    const duplicate = await send('/api/prizes', 'POST', { ...fields, name: 'LEGO SET' });
    expect(await duplicate.json()).toMatchObject({ error: { code: 'DUPLICATE_NAME' } });
    // An archived prize frees its name; restoring it while the name is taken is refused.
    await send('/api/prizes/' + prize.id, 'PUT', { ...fields, archived: true, expectedRevision: 1 });
    const replacement = await create({ ...fields, name: 'lego set' });
    expect(replacement.id).not.toBe(prize.id);
    const restore = await send('/api/prizes/' + prize.id, 'PUT', { ...fields, archived: false, expectedRevision: 2 });
    expect(await restore.json()).toMatchObject({ error: { code: 'DUPLICATE_NAME' } });
  });
});

describe('redeeming a catalog prize', () => {
  it('copies name and cost, allows a one-time prize once per child, and frees it again on void', async () => {
    await env.DB.batch(env.TEST_SEED_QUERIES.map(q => env.DB.prepare(q)));
    await award(sunny, 120);
    await award(robin, 120);
    const prize = await create();

    const id = crypto.randomUUID();
    expect((await redeem(sunny, { prizeId: prize.id }, id)).status).toBe(200);
    expect((await redeem(sunny, { prizeId: prize.id }, id)).status).toBe(200);
    let sunnyAccount = await account(sunny);
    expect(sunnyAccount.balance).toBe(70);
    expect(sunnyAccount.history).toEqual([expect.objectContaining({ label: 'Lego set', cost: 50, prizeId: prize.id })]);
    expect(sunnyAccount.catalog).toEqual([expect.objectContaining({ id: prize.id, redeemed: true })]);

    const again = await redeem(sunny, { prizeId: prize.id });
    expect(await again.json()).toMatchObject({ error: { code: 'ALREADY_REDEEMED' } });
    expect((await redeem(robin, { prizeId: prize.id })).status).toBe(200);

    // Editing the prize never rewrites the copied redemption.
    await send('/api/prizes/' + prize.id, 'PUT', { ...fields, name: 'Big Lego', cost: 10, expectedRevision: 1 });
    expect((await account(sunny)).history[0]).toMatchObject({ label: 'Lego set', cost: 50 });

    await send(`/api/children/${sunny}/prizes/${id}`, 'PATCH', { void: true }, null);
    sunnyAccount = await account(sunny);
    expect(sunnyAccount.balance).toBe(120);
    expect(sunnyAccount.catalog[0].redeemed).toBe(false);
    expect((await redeem(sunny, { prizeId: prize.id })).status).toBe(200);
    expect((await account(sunny)).balance).toBe(110);
  });

  it('lets only one of two concurrent one-time redemptions through', async () => {
    await env.DB.batch(env.TEST_SEED_QUERIES.map(q => env.DB.prepare(q)));
    await award(sunny, 200);
    const prize = await create();
    const results = await Promise.all([redeem(sunny, { prizeId: prize.id }), redeem(sunny, { prizeId: prize.id })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 422]);
    expect((await account(sunny)).balance).toBe(150);
  });

  it('refuses archived, unknown and unaffordable prizes, and counts redemptions made before switching to one-time', async () => {
    await env.DB.batch(env.TEST_SEED_QUERIES.map(q => env.DB.prepare(q)));
    await award(sunny, 30);
    const repeatable = await create({ ...fields, name: 'Ice cream', cost: 10, oneTime: false });
    expect((await redeem(sunny, { prizeId: repeatable.id })).status).toBe(200);
    expect((await redeem(sunny, { prizeId: repeatable.id })).status).toBe(200);
    await send('/api/prizes/' + repeatable.id, 'PUT', { ...fields, name: 'Ice cream', cost: 10, oneTime: true, expectedRevision: 1 });
    expect(await (await redeem(sunny, { prizeId: repeatable.id })).json()).toMatchObject({ error: { code: 'ALREADY_REDEEMED' } });

    const pricey = await create({ ...fields, name: 'Bike', cost: 500 });
    expect(await (await redeem(sunny, { prizeId: pricey.id })).json()).toMatchObject({ error: { code: 'INSUFFICIENT_BALANCE' } });
    await send('/api/prizes/' + pricey.id, 'PUT', { ...fields, name: 'Bike', cost: 1, archived: true, expectedRevision: 1 });
    expect(await (await redeem(sunny, { prizeId: pricey.id })).json()).toMatchObject({ error: { code: 'PRIZE_UNAVAILABLE' } });
    expect(await (await redeem(sunny, { prizeId: 'missing' })).json()).toMatchObject({ error: { code: 'PRIZE_UNAVAILABLE' } });
    expect((await redeem(sunny, { prizeId: repeatable.id, cost: 1 })).status).toBe(422);
    expect((await account(sunny)).catalog.map(c => c.id)).toEqual([repeatable.id]);
  });
});
