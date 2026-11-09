const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

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
