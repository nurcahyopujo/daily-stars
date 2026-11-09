import { getPlatformProxy } from 'wrangler';
import type { Plugin } from 'vite';
import { jakartaToday } from '../worker/calendar';
import { ApiError, json, mutationBoundary } from '../worker/http';
import { profileRoutes } from '../worker/profiles';

export function localParent(): Plugin {
  return {
    name: 'local-parent-session',
    apply: 'serve',
    configureServer(server) {
      if (process.env.MOCK_PARENT !== '1') return;
      let platform: ReturnType<typeof getPlatformProxy<{ DB: D1Database }>> | undefined;
      server.httpServer?.once('close', () => { void platform?.then((proxy) => proxy.dispose()); });
      server.middlewares.use(async (incoming, outgoing, next) => {
        const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(incoming.socket.remoteAddress ?? '');
        const host = incoming.headers.host ?? '';
        const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
        const path = incoming.url?.split('?')[0] ?? '';
        const session = path === '/api/me' && incoming.method === 'GET';
        const profiles = (path === '/api/children' && ['GET', 'POST'].includes(incoming.method ?? ''))
          || (path === '/api/templates' && incoming.method === 'GET')
          || (/^\/api\/children\/[^/]+$/.test(path) && incoming.method === 'PATCH');
        if (!loopback || !localHost || (!session && !profiles)) { next(); return; }
        const parent = { sub: 'local-synthetic-parent', email: 'local-parent@example.test' };
        let result: Response;
        try {
          if (session) result = json({ email: parent.email, today: jakartaToday(new Date()), timezone: 'Asia/Jakarta' });
          else {
            const chunks: Buffer[] = [];
            for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            const request = new Request(`http://${host}${incoming.url}`, {
              method: incoming.method, headers,
              ...(!['GET', 'HEAD'].includes(incoming.method ?? '') ? { body: Buffer.concat(chunks).toString() } : {}),
            });
            const rejected = mutationBoundary(request);
            if (rejected) result = rejected;
            else {
              // Explicitly local bindings; never select a remote or staging database for this mock.
              platform ??= getPlatformProxy<{ DB: D1Database }>({ configPath: './wrangler.jsonc', remoteBindings: false });
              const proxy = await platform;
              result = await profileRoutes(request, proxy.env.DB, parent) ?? json({ error: { code: 'NOT_FOUND' } }, 404);
            }
          }
        } catch (error) {
          result = error instanceof ApiError ? json({ error: {
            code: error.code, message: error.message, ...(error.current ? { current: error.current } : {}),
          } }, error.status) : json({ error: { code: 'UNAVAILABLE', message: 'Local database unavailable. Run npm run db:migrate.' } }, 503);
        }
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        outgoing.end(await result.text());
      });
    },
  };
}
