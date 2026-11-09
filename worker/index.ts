import { authenticateParent } from './auth';

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const parent = await authenticateParent(request, env);
      if (parent instanceof Response) return parent;

      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        if (request.headers.get('Origin') !== new URL(request.url).origin) {
          return json({ error: { code: 'FORBIDDEN', message: 'A same-origin request is required.' } }, 403);
        }
        if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          return json({ error: { code: 'INVALID_REQUEST', message: 'A JSON body is required.' } }, 400);
        }
      }

      if (pathname === '/api/me' && request.method === 'GET') {
        const date = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
        return json({ email: parent.email, today: date, timezone: 'Asia/Jakarta' });
      }
    }

    if (pathname === '/api/health' && request.method === 'GET') {
      try {
        // Query the migrated schema without returning household data.
        await env.DB.prepare('SELECT id FROM children LIMIT 1').all();
        return json({ status: 'ok', database: 'ok' });
      } catch {
        return json(
          { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' } },
          503,
        );
      }
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }, 404);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
