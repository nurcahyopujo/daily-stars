import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { authenticatedFetch, useSyntheticAccess } from './auth-fixture';
import { jakartaToday, nextDate } from '../../worker/calendar';
import type { AssignmentDetail, RuleSave, TemplateDetail } from '../../shared/profiles';

useSyntheticAccess();

const origin = 'https://daily-stars.test';
const child = '11111111-1111-4111-8111-111111111111';
const existing = '33333333-3333-4333-8333-333333333333';
const assignment = `/api/children/${child}/assignments`;
const template = (id: string) => `/api/templates/${id}`;
const read = async <T>(path: string) => (await authenticatedFetch(origin + path)).json<T>();
const write = (path: string, method: string, body: object, key = crypto.randomUUID()) =>
  authenticatedFetch(origin + path, {
    method, body: JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key },
  });

it('creates immediately, versions shared rules for tomorrow and restores a pending plan on cancellation', async () => {
  await env.DB.batch(env.TEST_SEED_QUERIES.map(query => env.DB.prepare(query)));
  const today = jakartaToday(new Date());
  const tomorrow = nextDate(today);
  const input = { name: 'Morning routine', activities: [{ label: 'Read', rewardPoints: 5 }] };
  const key = crypto.randomUUID();
  const response = await write('/api/templates', 'POST', input, key);
  expect(response.status).toBe(201);
  const created = await response.json<RuleSave>();
  expect(created.effectiveDate).toBe(today);
  expect(await (await write('/api/templates', 'POST', input, key)).json()).toEqual(created);

  expect((await write(assignment, 'PUT', { expectedRevision: 1, templateIds: [created.id, existing] })).status).toBe(200);
  expect(await read<AssignmentDetail>(assignment)).toMatchObject({
    current: { templateIds: [existing] }, pending: { templateIds: [created.id, existing], effectiveDate: tomorrow },
  });
  expect((await read<TemplateDetail>(template(created.id))).affectedChildren).toEqual(['Sunny']);

  const before = await read<TemplateDetail>(template(existing));
  const activity = before.current!.activities[0];
  const edit = { expectedRevision: 1, name: 'School morning',
    activities: [{ id: activity.id, label: activity.label, rewardPoints: 8, weekdays: [1, 2, 3, 4, 5] }] };
  expect((await write(template(existing), 'PUT', edit)).status).toBe(200);
  expect((await write(template(existing), 'PUT', edit)).status).toBe(409);
  expect((await write(template(existing), 'PUT', { expectedRevision: 2, operation: 'retire' })).status).toBe(200);
  expect((await write(assignment, 'PUT', { expectedRevision: 2, templateIds: [existing] })).status).toBe(422);
  expect((await write(template(existing), 'PUT', { expectedRevision: 3, operation: 'cancelRetirement' })).status).toBe(200);
  expect(await read(template(existing))).toMatchObject({
    current: before.current,
    pending: { retired: false, revision: 4, effectiveDate: tomorrow, name: 'School morning',
      activities: [{ id: activity.id, reward: 8, weekdays: [1, 2, 3, 4, 5] }] },
  });
  expect(await read(`/api/children/${child}/days/2026-11-09`)).toMatchObject({
    activities: [{ id: activity.id, reward: activity.reward }, { label: 'Pack the school bag' }],
  });
});

it('schedules a new assignment when an existing child has no assignment versions', async () => {
  await env.DB.batch(env.TEST_SEED_QUERIES.map(query => env.DB.prepare(query)));
  await env.DB.prepare('DELETE FROM assignment_versions WHERE child_id = ?').bind(child).run();

  const response = await authenticatedFetch(origin + assignment);
  expect(response.status).toBe(200);
  const before = await response.json<AssignmentDetail>();
  expect(before).toMatchObject({ current: { revision: 0, templateIds: [] }, pending: null });

  const input = { expectedRevision: before.current!.revision, templateIds: [existing] };
  const saved = await write(assignment, 'PUT', input);
  expect(saved.status).toBe(200);
  const tomorrow = nextDate(jakartaToday(new Date()));
  expect(await saved.json()).toMatchObject({ id: child, revision: 1, effectiveDate: tomorrow });
  expect(await read<AssignmentDetail>(assignment)).toMatchObject({
    current: { revision: 0, templateIds: [] },
    pending: { revision: 1, effectiveDate: tomorrow, templateIds: [existing] },
  });
  expect((await write(assignment, 'PUT', input)).status).toBe(409);
  expect((await authenticatedFetch(origin + '/api/children/missing/assignments')).status).toBe(404);
});

it('adds templates today and carries them into a pending plan without losing scheduled changes', async () => {
  await env.DB.batch(env.TEST_SEED_QUERIES.map(query => env.DB.prepare(query)));
  const today = jakartaToday(new Date());
  const tomorrow = nextDate(today);
  const created = await (await write('/api/templates', 'POST', {
    name: 'Reading', activities: [{ label: 'Read', rewardPoints: 2 }],
  })).json<RuleSave>();
  expect((await write(assignment, 'PUT', { expectedRevision: 1, templateIds: [] })).status).toBe(200);

  const key = crypto.randomUUID();
  const input = { expectedRevision: 2, templateIds: [created.id], startToday: true };
  const response = await write(assignment, 'PUT', input, key);
  expect(response.status).toBe(200);
  const saved = await response.json<RuleSave>();
  expect(saved).toMatchObject({ effectiveDate: today, revision: 4 });
  expect(await (await write(assignment, 'PUT', input, key)).json()).toEqual(saved);
  expect(await read<AssignmentDetail>(assignment)).toMatchObject({
    current: { templateIds: [existing, created.id], effectiveDate: today, revision: 3 },
    pending: { templateIds: [created.id], effectiveDate: tomorrow, revision: 4 },
  });
  expect(await read(`/api/children/${child}/days/${today}`)).toMatchObject({
    activities: expect.arrayContaining([{ id: expect.any(String), label: 'Read', templateId: created.id,
      template: 'Reading', reward: 2, weekdays: [1, 2, 3, 4, 5, 6, 7],
      stream: expect.stringContaining(created.id) }]),
  });
  expect(await read(`/api/children/${child}/days/2026-11-09`)).toMatchObject({
    activities: [{ label: 'Make the bed' }, { label: 'Pack the school bag' }],
  });
});
