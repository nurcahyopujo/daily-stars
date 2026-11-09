import { authenticateParent } from './auth';
import { jakartaToday } from './calendar';
import { ApiError, json, mutationBoundary } from './http';
import { profileRoutes } from './profiles';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const parent = await authenticateParent(request, env);
      if (parent instanceof Response) return parent;

      const rejected = mutationBoundary(request);
      if (rejected) return rejected;

      if (pathname === '/api/me' && request.method === 'GET') {
        const date = jakartaToday(new Date());
        return json({ email: parent.email, today: date, timezone: 'Asia/Jakarta' });
      }
      try {
        const response = await profileRoutes(request, env.DB, parent);
        if (response) return response;
      } catch (error) {
        if (error instanceof ApiError) return json({ error: {
          code: error.code, message: error.message, ...(error.current ? { current: error.current } : {}),
        } }, error.status);
        return json({ error: { code: 'UNAVAILABLE', message: 'Request unavailable. Check your connection and retry.' } }, 503);
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
