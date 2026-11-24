import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

// Each browser project runs as its own Playwright invocation with its own DB path
// (set via DAILY_STARS_BROWSER_DB), so projects never share a server/DB and one
// project's mutations can't drift another's assertions. Defaults to a shared path
// for a direct `npx playwright test` of a single project.
export const browserDatabasePath = process.env.DAILY_STARS_BROWSER_DB ?? '.wrangler/browser-tests';

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
