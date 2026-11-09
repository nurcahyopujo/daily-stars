import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { authenticatedFetch, useSyntheticAccess } from './auth-fixture';

useSyntheticAccess();

describe('local Worker and migrated D1', () => {
  it('checks D1 after migrations, including an empty household', async () => {
    const response = await authenticatedFetch('https://daily-stars.test/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('returns JSON 404 for API navigation and unsupported methods', async () => {
    for (const path of ['/api', '/api/missing', '/api/health/nested']) {
      const response = await authenticatedFetch(`https://daily-stars.test${path}`, {
        headers: { Accept: 'text/html' },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    const response = await authenticatedFetch('https://daily-stars.test/api/health', {
      method: 'POST', headers: { Origin: 'https://daily-stars.test', 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(404);
  });

  it('returns a non-cached JSON 503 when the migrated schema is unavailable', async () => {
    await env.DB.prepare('ALTER TABLE children RENAME TO unavailable_children').run();
    try {
      const response = await authenticatedFetch('https://daily-stars.test/api/health');
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' },
      });
    } finally {
      await env.DB.prepare('ALTER TABLE unavailable_children RENAME TO children').run();
    }
  });

  it('seeds two children sharing a routine with a weekday-only activity, twice safely', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await env.DB.batch(env.TEST_SEED_QUERIES.map((query) => env.DB.prepare(query)));
    }
    const children = await env.DB.prepare('SELECT display_name FROM children ORDER BY display_name').all();
    expect(children.results).toEqual([{ display_name: 'Robin' }, { display_name: 'Sunny' }]);

    const assignments = await env.DB.prepare(
      'SELECT template_ids_json FROM assignment_versions',
    ).all<{ template_ids_json: string }>();
    expect(assignments.results).toHaveLength(2);
    const template = await env.DB.prepare(
      'SELECT template_id, activities_json FROM template_versions',
    ).first<{ template_id: string; activities_json: string }>();
    expect(template).not.toBeNull();
    if (!template) throw new Error('Synthetic template missing.');
    for (const assignment of assignments.results) {
      expect(JSON.parse(assignment.template_ids_json)).toEqual([template.template_id]);
    }
    expect(JSON.parse(template.activities_json)).toEqual(expect.arrayContaining([
      expect.objectContaining({ weekdays: [1, 2, 3, 4, 5] }),
    ]));
  });

  it('rejects dangling assignments using the checked-in foreign key constraint', async () => {
    await expect(env.DB.prepare(
      `INSERT INTO assignment_versions VALUES (?, 1, '2026-11-09', '[]', ?, ?, ?)`,
    ).bind('missing-child', 'synthetic-parent', 'parent@example.test', '2026-11-09T00:00:00Z').run())
      .rejects.toThrow(/FOREIGN KEY/);
  });
});
