import { env } from 'cloudflare:workers';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { afterAll, beforeAll, vi } from 'vitest';
import worker from '../../worker';

export const authEnv = {
  ...env,
  TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com',
  POLICY_AUD: 'synthetic-staging-audience',
};

const keys = generateKeyPair('RS256', { extractable: true });

export function useSyntheticAccess() {
  beforeAll(async () => {
    const publicKey = await exportJWK((await keys).publicKey);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) !== `${authEnv.TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        throw new Error('Unexpected outbound request in auth test.');
      }
      return Response.json({ keys: [{ ...publicKey, kid: 'synthetic-key', alg: 'RS256', use: 'sig' }] });
    });
  });
  afterAll(() => vi.restoreAllMocks());
}

export async function signParent(claims: JWTPayload = {}) {
  return new SignJWT({
    iss: authEnv.TEAM_DOMAIN,
    aud: authEnv.POLICY_AUD,
    sub: 'synthetic-parent-a',
    email: 'parent-a@example.test',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).sign((await keys).privateKey);
}

export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cf-Access-Jwt-Assertion', await signParent());
  return worker.fetch(new Request(url, { ...init, headers }), authEnv);
}
