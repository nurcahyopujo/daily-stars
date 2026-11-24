import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { fingerprintOf, findReceipt, saveUnconfirmed, staleEdit } from '../../worker/mutation';

const caught = (fn: () => unknown) => { try { fn(); } catch (error) { return error; } };

describe('idempotent mutation contract', () => {
  it('fingerprints equal intents identically and distinct intents differently', async () => {
    const a = await fingerprintOf(['edit', 'c1', { displayName: 'Sunny' }]);
    const b = await fingerprintOf(['edit', 'c1', { displayName: 'Sunny' }]);
    const c = await fingerprintOf(['edit', 'c1', { displayName: 'Robin' }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('replays a stored receipt, misses an unknown action, and guards a reused action id', async () => {
    const fingerprint = await fingerprintOf(['edit', 1]);
    await env.DB.prepare(`INSERT INTO mutation_receipts
      (actor_id, action_id, fingerprint, status, result_json, actor_email, created_at, success_guard, date_guard)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`)
      .bind('actor-x', 'action-x', fingerprint, 200, JSON.stringify({ id: 'c1', revision: 2 }),
        'p@example.test', '2026-11-09T00:00:00Z').run();

    expect(await findReceipt(env.DB, 'actor-x', 'action-missing', fingerprint)).toBeNull();
    expect(await findReceipt(env.DB, 'actor-x', 'action-x', fingerprint))
      .toEqual({ status: 200, result: { id: 'c1', revision: 2 } });
    await expect(findReceipt(env.DB, 'actor-x', 'action-x', 'other-fingerprint'))
      .rejects.toMatchObject({ status: 409, code: 'ACTION_REUSED' });
  });

  it('throws the shared stale-edit and save-unconfirmed outcomes', () => {
    expect(caught(() => staleEdit('Entry changed.', { revision: 3 })))
      .toMatchObject({ status: 409, code: 'STALE_EDIT', current: { revision: 3 } });
    expect(caught(() => saveUnconfirmed())).toMatchObject({ status: 503, code: 'SAVE_UNCONFIRMED' });
  });
});
