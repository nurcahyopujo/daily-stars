import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

export type Parent = { sub: string; email: string };

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const failure = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function authenticateParent(request: Request, env: Env): Promise<Parent | Response> {
  // Trust only the configured team, never a token-supplied issuer or key URL.
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.TEAM_DOMAIN)
    || !env.POLICY_AUD.trim()) {
    return failure(503, 'AUTH_UNAVAILABLE', 'Parent access is unavailable.');
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return failure(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');

  let keys = keySets.get(env.TEAM_DOMAIN);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));
    keySets.set(env.TEAM_DOMAIN, keys);
  }

  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
      requiredClaims: ['exp', 'sub', 'email'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub.trim()
      || typeof payload.email !== 'string' || !payload.email.trim()) {
      return failure(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
    }
    return { sub: payload.sub, email: payload.email };
  } catch (error) {
    if (!(error instanceof errors.JOSEError)
      || error instanceof errors.JWKSTimeout
      || error instanceof errors.JWKSInvalid
      || error instanceof errors.JWKInvalid) {
      return failure(503, 'AUTH_UNAVAILABLE', 'Parent access is unavailable.');
    }
    return failure(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
  }
}
