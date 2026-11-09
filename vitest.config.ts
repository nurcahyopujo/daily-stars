import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          // Reuse Cloudflare's SQL splitter for the exact fixture used by Wrangler.
          TEST_SEED_QUERIES: (await readD1Migrations('./fixtures')).flatMap((file) => file.queries),
        },
      },
    })),
  ],
  test: {
    include: ['tests/worker/**/*.test.ts'],
    setupFiles: ['tests/worker/setup.ts'],
  },
});
