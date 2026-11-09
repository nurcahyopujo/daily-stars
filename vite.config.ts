import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'local-parent-session',
      apply: 'serve',
      configureServer(server) {
        if (process.env.MOCK_PARENT !== '1') return;
        server.middlewares.use((request, response, next) => {
          const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
          const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host ?? '');
          if (!loopback || !localHost || request.method !== 'GET' || request.url?.split('?')[0] !== '/api/me') {
            next();
            return;
          }
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({
            email: 'local-parent@example.test',
            today: new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(new Date()),
            timezone: 'Asia/Jakarta',
          }));
        });
      },
    },
    react(),
    cloudflare(),
  ],
});
