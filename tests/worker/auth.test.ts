import { env } from 'cloudflare:workers';
import { generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import worker from '../../worker';
import { authenticateParent } from '../../worker/auth';
import { authenticatedFetch, authEnv, signParent, useSyntheticAccess } from './auth-fixture';

useSyntheticAccess();

const request = (token?: string) => new Request('https://daily-stars.test/api/me', {
  headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
});

describe('parent authentication', () => {
  it('requires configuration and a signed identity on every API route', async () => {
    const unavailable = await worker.fetch(request(), { ...env, TEAM_DOMAIN: '', POLICY_AUD: '' });
    expect(unavailable.status).toBe(503);
    for (const path of ['/api', '/api/me', '/api/health', '/api/missing']) {
      const response = await worker.fetch(new Request(`https://daily-stars.test${path}`), authEnv);
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ error: { code: 'SIGN_IN_REQUIRED' } });
    }
    const invalidConfig = await authenticateParent(request('anything'), {
      ...authEnv, TEAM_DOMAIN: 'https://attacker.test',
    });
    expect(invalidConfig).toBeInstanceOf(Response);
    if (!(invalidConfig instanceof Response)) throw new Error('Invalid config accepted.');
    expect(invalidConfig.status).toBe(503);
  });

  it('verifies distinct parent identities without trusting auxiliary headers', async () => {
    for (const suffix of ['a', 'b']) {
      const token = await signParent({ sub: `synthetic-parent-${suffix}`, email: `parent-${suffix}@example.test` });
      const incoming = request(token);
      incoming.headers.set('Cf-Access-Authenticated-User-Email', 'attacker@example.test');
      expect(await authenticateParent(incoming, authEnv)).toEqual({
        sub: `synthetic-parent-${suffix}`, email: `parent-${suffix}@example.test`,
      });
    }
  });

  it('rejects missing, expired, future, wrong-environment, and non-human claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [
      { exp: now }, { exp: undefined }, { nbf: now + 300 },
      { iss: 'https://other-team.cloudflareaccess.com' }, { aud: 'production-audience' },
      { sub: undefined }, { sub: '' }, { sub: '   ' },
      { email: undefined }, { email: '' }, { email: '   ' }, { email: 123 },
    ]) {
      const response = await worker.fetch(request(await signParent(claims)), authEnv);
      expect(response.status, JSON.stringify(claims)).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('rejects malformed, unsigned and forged assertions', async () => {
    const attacker = await generateKeyPair('RS256');
    const forged = await new SignJWT({
      iss: authEnv.TEAM_DOMAIN, aud: authEnv.POLICY_AUD,
      sub: 'forged-parent', email: 'forged@example.test', exp: Math.floor(Date.now() / 1000) + 300,
    }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).sign(attacker.privateKey);
    for (const token of ['not-a-jwt', 'eyJhbGciOiJub25lIn0.e30.', forged]) {
      expect((await worker.fetch(request(token), authEnv)).status).toBe(401);
    }
  });

  it('fails closed when signing keys cannot be fetched', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('synthetic network failure'));
    const response = await worker.fetch(request(await signParent()), {
      ...authEnv, TEAM_DOMAIN: 'https://unavailable-team.cloudflareaccess.com',
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toContain('synthetic network failure');
  });

  it('returns verified email and the Jakarta date across midnight', async () => {
    const token = await signParent({ exp: 2_000_000_000 });
    try {
      for (const [instant, today] of [
        ['2026-11-09T16:59:59Z', '2026-11-09'],
        ['2026-11-09T17:00:00Z', '2026-11-10'],
      ]) {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(instant));
        const response = await worker.fetch(request(token), authEnv);
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({ email: 'parent-a@example.test', today, timezone: 'Asia/Jakarta' });
      }
    } finally { vi.useRealTimers(); }
  });

  it('requires same-origin JSON for mutation requests', async () => {
    const url = 'https://daily-stars.test/api/missing';
    expect((await authenticatedFetch(url, { method: 'POST' })).status).toBe(403);
    expect((await authenticatedFetch(url, {
      method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(403);
    expect((await authenticatedFetch(url, {
      method: 'POST', headers: { Origin: 'https://daily-stars.test', 'Content-Type': 'text/plain' }, body: '{}',
    })).status).toBe(400);
    expect((await authenticatedFetch(url, {
      method: 'POST', headers: { Origin: 'https://daily-stars.test', 'Content-Type': 'application/json; charset=utf-8' }, body: '{}',
    })).status).toBe(404);
  });
});
