import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

export const browserDatabasePath = '.wrangler/browser-tests';

export async function seedBrowserDatabase(prepare: (db: D1Database) => D1PreparedStatement[]) {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: './wrangler.jsonc',
    remoteBindings: false,
    persist: { path: join(browserDatabasePath, 'v3') },
  });
  try {
    const batch = prepare(proxy.env.DB);
    // Parallel browser workers share a local SQLite file across Wrangler instances.
    for (let attempt = 0; ; attempt++) {
      try {
        await proxy.env.DB.batch(batch);
        return;
      } catch (error) {
        if (attempt === 3 || !(error instanceof Error) || !error.message.includes('SQLITE_BUSY')) throw error;
        await setTimeout(50 * (attempt + 1));
      }
    }
  } finally {
    await proxy.dispose();
  }
}
