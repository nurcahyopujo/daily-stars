import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { authenticatedFetch, useSyntheticAccess } from './auth-fixture';
import type { Day, Score } from '../../shared/scoring';
useSyntheticAccess();
it('retains revisions, replays exact saves and keeps a correction on its activity date', async () => {
  await env.DB.batch(env.TEST_SEED_QUERIES.map((q) => env.DB.prepare(q)));
  const url = 'https://daily-stars.test/api/children/11111111-1111-4111-8111-111111111111/days/';
  const monday = url + '2026-11-09';
  const read = async (path: string) => (await authenticatedFetch(path)).json<Day>();
  const write = (stream: string, method: string, body: object, key = crypto.randomUUID()) =>
    authenticatedFetch(monday + '/' + stream, {
      method,
      headers: {
        Origin: 'https://daily-stars.test',
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(body),
    });
  const activity = (await read(monday)).activities[1];
  expect(
    (await write(activity.stream, 'PUT', { outcome: 'done_correctly', expectedRevision: 0 })).status,
  ).toBe(200);
  const key = crypto.randomUUID(),
    award = { points: 4, reason: 'Helped tidy up' };
  const first = await (await write('one-offs', 'POST', award, key)).json<Score>();
  expect(await (await write('one-offs', 'POST', award, key)).json()).toEqual(first);
  expect((await read(monday)).net).toBe(7);
  expect(
    (await write(activity.stream, 'PUT', { outcome: 'needs_improvement', expectedRevision: 0 })).status,
  ).toBe(409);
  await write(activity.stream, 'PUT', { outcome: 'needs_improvement', expectedRevision: 1 });
  await write(first.stream, 'PATCH', { expectedRevision: 1, points: -2, reason: 'Correction' });
  expect((await read(monday)).net).toBe(-3);
  await write(first.stream, 'PATCH', { expectedRevision: 2, void: true });
  expect(await read(url + '2026-11-10')).toMatchObject({ net: 0, total: -1 });
  expect((await read(monday)).history).toHaveLength(5);
});
