import { env } from 'cloudflare:workers';
import { beforeEach, expect, it } from 'vitest';
import { authenticatedFetch, useSyntheticAccess } from './auth-fixture';
import { jakartaToday, shiftDate } from '../../worker/calendar';
import type { AssignmentDetail } from '../../shared/profiles';

useSyntheticAccess();

const origin = 'https://daily-stars.test';
const sunny = '11111111-1111-4111-8111-111111111111';
const robin = '22222222-2222-4222-8222-222222222222';
const morning = '33333333-3333-4333-8333-333333333333';
const assignments = (child: string) => `/api/children/${child}/assignments`;
const read = async <T>(path: string) => (await authenticatedFetch(origin + path)).json<T>();
const write = (path: string, method: string, body: object, key = crypto.randomUUID()) =>
  authenticatedFetch(origin + path, {
    method, body: JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key },
  });

let today: string;
beforeEach(async () => {
  await env.DB.batch(env.TEST_SEED_QUERIES.map(query => env.DB.prepare(query)));
  today = jakartaToday(new Date());
});

it('pauses a template for several children in one save and lists the pause with the assignments', async () => {
  const holiday = { startDate: shiftDate(today, 1), endDate: shiftDate(today, 10), reason: 'Holiday' };
  const key = crypto.randomUUID();
  const body = { ...holiday, children: [
    { childId: sunny, expectedRevision: 1, templateIds: [morning] },
    { childId: robin, expectedRevision: 1, templateIds: [morning] },
  ] };
  const response = await write('/api/pauses', 'POST', body, key);
  const saved = await response.json();
  expect(saved).toMatchObject({ effectiveDate: holiday.startDate, children: [{ id: sunny, revision: 2 }, { id: robin, revision: 2 }] });
  expect(await (await write('/api/pauses', 'POST', body, key)).json()).toEqual(saved);

  for (const child of [sunny, robin]) {
    expect(await read<AssignmentDetail>(assignments(child))).toMatchObject({
      revision: 2,
      pauses: [{ id: expect.any(String), templateId: morning, ...holiday }],
    });
  }
});

it('makes pause saves and assignment changes conflict, because they share the child’s assignment revision', async () => {
  const pause = { startDate: shiftDate(today, 1), endDate: shiftDate(today, 3) };
  expect((await write('/api/pauses', 'POST', { ...pause, children: [{ childId: sunny, expectedRevision: 1, templateIds: [morning] }] })).status).toBe(200);

  const stale = await write(assignments(sunny), 'PUT', { expectedRevision: 1, templateIds: [morning] });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: 'STALE_EDIT', current: { revision: 2, pauses: [{ templateId: morning }] } } });
  const saved = await write(assignments(sunny), 'PUT', { expectedRevision: 2, templateIds: [morning] });
  expect(await saved.json()).toMatchObject({ revision: 3 });

  const later = { startDate: shiftDate(today, 5), endDate: shiftDate(today, 6), children: [{ childId: sunny, expectedRevision: 2, templateIds: [morning] }] };
  expect((await write('/api/pauses', 'POST', later)).status).toBe(409);
});

it('saves nothing when any child’s template would overlap a pause, and names each conflict', async () => {
  const first = { startDate: shiftDate(today, 2), endDate: shiftDate(today, 4) };
  expect((await write('/api/pauses', 'POST', { ...first, children: [{ childId: robin, expectedRevision: 1, templateIds: [morning] }] })).status).toBe(200);

  const response = await write('/api/pauses', 'POST', { startDate: shiftDate(today, 1), endDate: shiftDate(today, 2), children: [
    { childId: sunny, expectedRevision: 1, templateIds: [morning] },
    { childId: robin, expectedRevision: 2, templateIds: [morning] },
  ] });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: {
    code: 'PAUSE_CONFLICT',
    message: 'Nothing was paused. Robin · Morning routine already has a pause on some of these dates.',
  } });
  expect(await read<AssignmentDetail>(assignments(sunny))).toMatchObject({ revision: 1, pauses: [] });
});

it('leaves a paused template off the checklist on paused dates and notes the pause on that day', async () => {
  // Pauses never start in the past through the API, so seed one that already ran.
  const pause = { id: 'past-holiday', templateId: morning, startDate: shiftDate(today, -3), endDate: shiftDate(today, -1), reason: 'Holiday' };
  await env.DB.prepare(`INSERT INTO assignment_pause_versions VALUES (?, 2, ?, 'actor', 'parent@example.test', '2026-01-01T00:00:00Z')`)
    .bind(sunny, JSON.stringify([pause])).run();
  const day = (child: string, date: string) => read<{ activities: unknown[]; pauses: unknown[] }>(`/api/children/${child}/days/${date}`);

  expect(await day(sunny, shiftDate(today, -2))).toMatchObject({
    activities: [],
    pauses: [{ templateId: morning, template: 'Morning routine', endDate: pause.endDate, reason: 'Holiday' }],
  });
  expect((await day(robin, shiftDate(today, -2))).activities.length).toBeGreaterThan(0);
  expect(await day(sunny, today)).toMatchObject({ activities: expect.arrayContaining([expect.objectContaining({ templateId: morning })]), pauses: [] });
});

it('cancels a scheduled pause when its template is unassigned, so reassigning starts with no pause', async () => {
  const pause = { startDate: shiftDate(today, 1), endDate: shiftDate(today, 5) };
  expect((await write('/api/pauses', 'POST', { ...pause, children: [{ childId: sunny, expectedRevision: 1, templateIds: [morning] }] })).status).toBe(200);

  const unassigned = await write(assignments(sunny), 'PUT', { expectedRevision: 2, templateIds: [] });
  expect(await unassigned.json()).toMatchObject({ revision: 4 });
  expect(await read<AssignmentDetail>(assignments(sunny))).toMatchObject({ revision: 4, pauses: [] });

  expect((await write(assignments(sunny), 'PUT', { expectedRevision: 4, templateIds: [morning] })).status).toBe(200);
  expect(await read<AssignmentDetail>(assignments(sunny))).toMatchObject({ revision: 5, pauses: [] });
});

it('reschedules or cancels one pause, guarded by the child’s assignment revision', async () => {
  const pause = { startDate: shiftDate(today, 1), endDate: shiftDate(today, 5), reason: 'Exams' };
  await write('/api/pauses', 'POST', { ...pause, children: [{ childId: sunny, expectedRevision: 1, templateIds: [morning] }] });
  const [{ id }] = (await read<AssignmentDetail>(assignments(sunny))).pauses;
  const path = `/api/children/${sunny}/pauses/${id}`;

  expect((await write(path, 'PUT', { expectedRevision: 1, cancel: true })).status).toBe(409);
  const moved = await write(path, 'PUT', { expectedRevision: 2, startDate: shiftDate(today, 2), endDate: shiftDate(today, 3) });
  expect(await moved.json()).toMatchObject({ id, revision: 3 });
  expect((await read<AssignmentDetail>(assignments(sunny))).pauses)
    .toEqual([{ id, templateId: morning, startDate: shiftDate(today, 2), endDate: shiftDate(today, 3) }]);

  const tooEarly = await write(path, 'PUT', { expectedRevision: 3, startDate: today, endDate: shiftDate(today, 3) });
  expect(await tooEarly.json()).toMatchObject({ error: { code: 'INVALID_INPUT', message: 'A pause can start tomorrow at the earliest.' } });
  expect((await write(path, 'PUT', { expectedRevision: 3, cancel: true })).status).toBe(200);
  expect(await read<AssignmentDetail>(assignments(sunny))).toMatchObject({ revision: 4, pauses: [] });
});
