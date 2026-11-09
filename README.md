# Daily Stars

A private household’s daily activities and points tracker. The [MVP specification](mvp-spec.md) defines the build order and the [glossary](GLOSSARY.md) defines domain terms.

Milestone 1 provides a local React shell, a Worker API and D1 foundations. Profile editing, scoring and authentication arrive in later milestones.

## Local setup

Use Node 24 (`nvm install && nvm use` with nvm), then:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open the loopback URL printed by Vite. `GET /api/health` queries the migrated local D1 database and returns `{ "status": "ok", "database": "ok" }`; an unavailable schema/database produces JSON 503. Unknown API routes, including browser navigation, return JSON 404. All API responses use `Cache-Control: no-store`.

The local binding is `DB`, named `daily-stars-local`. Its UUID in `wrangler.jsonc` is a local placeholder, not a provisioned remote database. Wrangler and Vite share `.wrangler/state` for local persistence. The numbered `migrations/` directory is the sole schema source. `fixtures/local.sql` contains synthetic children Sunny and Robin, a shared morning routine and a weekday-only activity. Seeding again leaves existing IDs/revisions alone. Fixtures do not authenticate a parent or expose records through an API.

Local development uses loopback only. This milestone has no deployment command or staging/production configuration. Access/JWT protection belongs to milestone 2 and must be established before private data is introduced or the app is exposed remotely.

## Verification

```sh
npx playwright install chromium webkit
npm run check
```

`check` generates Worker types from the configured compatibility date/bindings, type-checks the frontend/Worker/tooling, runs Cloudflare Vitest checks in workerd with migrated D1, builds production assets and Worker code, and runs phone-sized Chromium/WebKit checks against the local production preview. The browser runner applies local migrations and synthetic seeds before starting preview on port 4173. Tests use local synthetic data; do not point them at a remote or family database.

Useful individual commands:

| Command | Purpose |
| --- | --- |
| `npm test` | Real local D1, seed repeatability, foreign keys, Worker health and JSON API errors |
| `npm run typecheck` | Generate bindings/runtime types and check TypeScript |
| `npm run build` | Build static assets and the Worker |
| `npm run preview` | Serve the existing production build locally (migrate first) |
| `npm run test:browser` | Test the existing build at phone width in Chromium and WebKit |

GitHub Actions runs these checks for pull requests and pushes to main. It performs no deployment. Browser emulation does not establish installed-phone or real Access behavior. The D1 SQL-clock/atomic mutation proof, phone installation and recovery rehearsal remain gates in the specification.

Tooling follows the official [Cloudflare Vite setup](https://developers.cloudflare.com/workers/vite-plugin/get-started/), [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/), and [Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) documentation.
