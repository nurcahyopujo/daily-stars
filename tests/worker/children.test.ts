import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Child, ChildIntent } from '../../shared/profiles';
import { saveChild, listChildren } from '../../worker/child-storage';
import { dayBounds, jakartaToday, nextDate } from '../../worker/calendar';
import { authenticatedFetch, useSyntheticAccess } from './auth-fixture';

useSyntheticAccess();
const parent = { sub: 'synthetic-parent-a', email: 'parent-a@example.test' };
const templateId = '33333333-3333-4333-8333-333333333333';
const create = (name = 'Nova', ids: string[] = []): ChildIntent => ({ kind: 'create', displayName: name, initialTemplateIds: ids });
async function seed() { await env.DB.batch(env.TEST_SEED_QUERIES.map((sql) => env.DB.prepare(sql))); }
async function rows(table: string) {
  // Test-owned table names only.
  return (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
}
async function mutate(path: string, body: unknown, key = crypto.randomUUID()) {
  return authenticatedFetch(`https://daily-stars.test/api${path}`, {
    method: path === '/children' ? 'POST' : 'PATCH',
    headers: { Origin: 'https://daily-stars.test', 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}

describe('child profile operations on migrated D1', () => {
  it('creates a child with ordered initial assignments today and one audited receipt', async () => {
    await seed();
    await env.DB.prepare(`INSERT INTO templates VALUES ('second-template', '2026-01-01')`).run();
    await env.DB.prepare(`INSERT INTO template_versions VALUES
      ('second-template', 1, '2026-01-01', 'Evening', 0, '[]', 'parent', 'parent@example.test', '2026-01-01')`).run();
    const response = await mutate('/children', { displayName: '  Nova  ', initialTemplateIds: ['second-template', templateId] });
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const child = await response.json<Child>();
    expect(child).toMatchObject({ displayName: 'Nova', startDate: jakartaToday(new Date()), revision: 1, archiveEffectiveDate: null });
    const assignment = await env.DB.prepare('SELECT * FROM assignment_versions WHERE child_id = ?').bind(child.id).first();
    expect(assignment).toMatchObject({ effective_date: child.startDate, template_ids_json: JSON.stringify(['second-template', templateId]), actor_email: parent.email });
    expect(await rows('child_profile_revisions')).toEqual([expect.objectContaining({ child_id: child.id, revision: 1, actor_id: parent.sub })]);
    expect(await rows('mutation_receipts')).toHaveLength(1);
    expect(await rows('mutation_assertions')).toEqual([]);
  });

  it('supports empty initial assignments and duplicate nicknames as independent children', async () => {
    const first = await saveChild(env.DB, parent, create(), crypto.randomUUID());
    const second = await saveChild(env.DB, parent, create(), crypto.randomUUID());
    expect(first.child.id).not.toBe(second.child.id);
    expect(await rows('assignment_versions')).toEqual([
      expect.objectContaining({ template_ids_json: '[]' }), expect.objectContaining({ template_ids_json: '[]' }),
    ]);
  });

  it('rolls back earlier child setup when an initial template is absent, retired or future', async () => {
    await seed();
    await env.DB.prepare(`UPDATE template_versions SET retired = 1 WHERE template_id = ?`).bind(templateId).run();
    for (const id of ['missing-template', templateId]) {
      expect((await mutate('/children', { displayName: 'Nova', initialTemplateIds: [id] })).status).toBe(422);
    }
    await env.DB.prepare(`UPDATE template_versions SET retired = 0, effective_date = '9999-01-01'`).run();
    expect((await mutate('/children', { displayName: 'Nova', initialTemplateIds: [templateId] })).status).toBe(422);
    expect(await rows('children')).toHaveLength(2);
    expect(await rows('assignment_versions')).toHaveLength(2);
    expect(await rows('mutation_receipts')).toEqual([]);
    expect(await rows('child_profile_revisions')).toEqual([]);
    expect(await rows('mutation_assertions')).toEqual([]);
  });

  it('recovers identical concurrent retries and a lost response without creating another child', async () => {
    const action = crypto.randomUUID();
    const intent = create();
    const [first, second] = await Promise.all([
      saveChild(env.DB, parent, intent, action), saveChild(env.DB, parent, intent, action),
    ]);
    expect(second).toEqual(first);
    const replay = await saveChild(env.DB, parent, intent, action, () => new Date('2027-01-01T00:00:00Z'));
    expect(replay).toEqual(first);
    await expect(saveChild(env.DB, parent, create('Changed'), action)).rejects.toMatchObject({ status: 409, code: 'ACTION_REUSED' });
    expect(await rows('children')).toHaveLength(1);
    expect(await rows('assignment_versions')).toHaveLength(1);
    expect(await rows('mutation_receipts')).toHaveLength(1);
  });

  it('allows one competing edit, rejects stale/ahead revisions, and audits the verified acting parent', async () => {
    const created = await saveChild(env.DB, parent, create(), crypto.randomUUID());
    const edit = (displayName: string, expectedRevision = 1): ChildIntent => ({
      kind: 'edit', childId: created.child.id, expectedRevision, displayName,
    });
    const other = { sub: 'synthetic-parent-b', email: 'parent-b@example.test' };
    const actions = [crypto.randomUUID(), crypto.randomUUID()];
    const results = await Promise.allSettled([
      saveChild(env.DB, parent, edit('A'), actions[0]), saveChild(env.DB, other, edit('B'), actions[1]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'STALE_EDIT', current: expect.objectContaining({ revision: 2 }) }) }),
    ]);
    for (const revision of [1, 50]) {
      await expect(saveChild(env.DB, parent, edit('stale', revision), crypto.randomUUID()))
        .rejects.toMatchObject({ status: 409, code: 'STALE_EDIT' });
    }
    const winner = results[0].status === 'fulfilled' ? parent : other;
    expect(await rows('child_profile_revisions')).toEqual([
      expect.objectContaining({ revision: 1, actor_email: parent.email }),
      expect.objectContaining({ revision: 2, actor_email: winner.email }),
    ]);
    expect(await rows('mutation_receipts')).toHaveLength(2);
    expect(await rows('mutation_assertions')).toEqual([]);
  });

  it('archives tomorrow, preserves identity/assignments, and never shifts an existing archive date', async () => {
    const { child } = await saveChild(env.DB, parent, create(), crypto.randomUUID());
    const archived = await saveChild(env.DB, parent, {
      kind: 'edit', childId: child.id, expectedRevision: 1, archive: true,
    }, crypto.randomUUID());
    const date = nextDate(child.startDate);
    expect(archived.child.archiveEffectiveDate).toBe(date);
    expect(await listChildren(env.DB, child.startDate, false)).toHaveLength(1);
    expect(await listChildren(env.DB, date, false)).toHaveLength(0);
    expect(await listChildren(env.DB, date, true)).toHaveLength(1);
    const renamed = await saveChild(env.DB, parent, {
      kind: 'edit', childId: child.id, expectedRevision: 2, displayName: 'New nickname', archive: true,
    }, crypto.randomUUID());
    expect(renamed.child).toMatchObject({ id: child.id, displayName: 'New nickname', archiveEffectiveDate: date, revision: 3 });
    expect(await rows('assignment_versions')).toEqual([expect.objectContaining({ child_id: child.id, effective_date: child.startDate })]);
    expect(await rows('child_profile_revisions')).toHaveLength(3);
  });

  it('rolls back a stale-day create and retries once with recalculated dates and unchanged intent', async () => {
    let calls = 0;
    const current = new Date();
    const stale = new Date(current.getTime() - 86_400_000);
    const saved = await saveChild(env.DB, parent, create(), crypto.randomUUID(), () => ++calls === 1 ? stale : current);
    expect(calls).toBe(2);
    expect(saved.child.startDate).toBe(jakartaToday(current));
    expect(await rows('children')).toHaveLength(1);
    expect(await rows('assignment_versions')).toHaveLength(1);
    expect(await rows('child_profile_revisions')).toHaveLength(1);
    expect(await rows('mutation_receipts')).toHaveLength(1);
    expect(await rows('mutation_assertions')).toEqual([]);
  });

  it('retains an unconfirmed outcome when both date-guard attempts fail, without partial writes', async () => {
    let calls = 0;
    await expect(saveChild(env.DB, parent, create(), crypto.randomUUID(), () => {
      calls++; return new Date('2000-01-01T00:00:00Z');
    })).rejects.toMatchObject({ status: 503, code: 'SAVE_UNCONFIRMED' });
    expect(calls).toBe(2);
    for (const table of ['children', 'assignment_versions', 'mutation_receipts', 'child_profile_revisions', 'mutation_assertions']) {
      expect(await rows(table)).toEqual([]);
    }
  });

  it('returns list and dated template summaries without exposing audit identities', async () => {
    await seed();
    const children = await authenticatedFetch('https://daily-stars.test/api/children?includeArchived=true');
    expect(await children.json()).toMatchObject({ today: jakartaToday(new Date()), children: [expect.objectContaining({ displayName: 'Sunny' }), expect.objectContaining({ displayName: 'Robin' })] });
    const templates = await authenticatedFetch('https://daily-stars.test/api/templates');
    expect(await templates.json()).toMatchObject({ templates: [{ id: templateId, current: { name: 'Morning routine', revision: 1, retired: false }, pending: null }] });
  });

  it('validates malformed JSON, nickname bounds, assignment duplicates and patch fields', async () => {
    for (const displayName of ['', '   ', 'a'.repeat(61), 10, null]) {
      expect((await mutate('/children', { displayName })).status).toBe(422);
    }
    for (const initialTemplateIds of [[templateId, templateId], [2], {}, null]) {
      // Explicit null is invalid; omission alone defaults to an empty list.
      expect((await mutate('/children', { displayName: 'Nova', initialTemplateIds })).status).toBe(422);
    }
    expect((await mutate('/children', { displayName: 'Nova', other: 1 })).status).toBe(422);
    expect((await mutate('/children/missing', { expectedRevision: 1, archive: true })).status).toBe(404);
    for (const body of [{ expectedRevision: 0, archive: true }, { expectedRevision: 1 }, { expectedRevision: 1, archive: false }]) {
      expect((await mutate('/children/missing', body)).status).toBe(422);
    }
    expect((await mutate('/children', { displayName: 'Nova' }, 'short')).status).toBe(400);
    const malformed = await authenticatedFetch('https://daily-stars.test/api/children', {
      method: 'POST', headers: { Origin: 'https://daily-stars.test', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await rows('children')).toEqual([]);
  });

  it('uses half-open Jakarta day bounds, including year rollover', () => {
    expect(jakartaToday(new Date('2026-12-31T16:59:59Z'))).toBe('2026-12-31');
    expect(jakartaToday(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
    const [start, end] = dayBounds('2026-12-31');
    expect(new Date(start * 1000).toISOString()).toBe('2026-12-30T17:00:00.000Z');
    expect(new Date(end * 1000).toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
  });
});
