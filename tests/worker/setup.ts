import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { beforeEach } from 'vitest';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      TEST_SEED_QUERIES: string[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mutation_receipts'),
    env.DB.prepare('DELETE FROM mutation_assertions'),
    env.DB.prepare('DELETE FROM child_profile_revisions'),
    env.DB.prepare('DELETE FROM assignment_versions'),
    env.DB.prepare('DELETE FROM template_versions'),
    env.DB.prepare('DELETE FROM templates'),
    env.DB.prepare('DELETE FROM children'),
  ]);
});
