import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { authenticatedFetch, useSyntheticAccess } from './auth-fixture';
useSyntheticAccess();
it('spends existing points once, blocks concurrent overspending, and restores voided prizes once', async () => {
  await env.DB.batch(env.TEST_SEED_QUERIES.map(q => env.DB.prepare(q)));
  const child = '11111111-1111-4111-8111-111111111111';
  await env.DB.prepare("INSERT INTO score_revisions VALUES (?,'2026-11-09','one-offs/test',1,10,'one-off','Award','parent','now')").bind(child).run();
  expect(await env.DB.prepare("SELECT type FROM sqlite_master WHERE name='child_balances'").first()).toEqual({ type: 'table' });
  expect(await env.DB.prepare('SELECT total,balance FROM child_balances WHERE child_id=?').bind(child).first()).toEqual({ total: 10, balance: 10 });
  const path = 'https://daily-stars.test/api/children/' + child + '/prizes';
  const write = (id: string, method: string, body: object) => authenticatedFetch(path + '/' + id, {
    method, headers: { Origin: 'https://daily-stars.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const id = crypto.randomUUID();
  const prize = { label: 'Movie', cost: 7 };
  expect((await write(id, 'PUT', prize)).status).toBe(200);
  expect((await write(id, 'PUT', prize)).status).toBe(200);
  expect((await write(id, 'PUT', { ...prize, cost: 1 })).status).toBe(409);
  const results = await Promise.all([write(crypto.randomUUID(), 'PUT', { label: 'A', cost: 3 }), write(crypto.randomUUID(), 'PUT', { label: 'B', cost: 3 })]);
  expect(results.map(r => r.status).sort()).toEqual([200,422]);
  await env.DB.prepare("INSERT INTO score_revisions VALUES (?,'2026-11-09','one-offs/test',2,8,'one-off','Correction','parent','later')").bind(child).run();
  expect(await (await authenticatedFetch(path)).json()).toMatchObject({ balance: -2 });
  expect((await write(id, 'PATCH', { void: true })).status).toBe(200);
  expect((await write(id, 'PATCH', { void: true })).status).toBe(200);
  expect(await (await authenticatedFetch(path)).json()).toMatchObject({ balance: 5 });
  expect((await write(crypto.randomUUID(), 'PUT', { label: 'Free', cost: 0 })).status).toBe(422);
  expect(await env.DB.prepare('SELECT total,balance FROM child_balances WHERE child_id=?').bind(child).first()).toEqual({ total: 8, balance: 5 });
});
