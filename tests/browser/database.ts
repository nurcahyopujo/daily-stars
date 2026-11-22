import { join } from 'node:path';

export const browserDatabasePath = '.wrangler/browser-tests';

export async function seedBrowserDatabase(seed: (db: D1Database) => Promise<unknown>) {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: './wrangler.jsonc',
    remoteBindings: false,
    persist: { path: join(browserDatabasePath, 'v3') },
  });
  try {
    await seed(proxy.env.DB);
  } finally {
    await proxy.dispose();
  }
}
