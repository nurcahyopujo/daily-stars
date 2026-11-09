# Daily Stars

A private household’s daily activities and points tracker. The [MVP specification](mvp-spec.md) defines the build order and the [glossary](GLOSSARY.md) defines domain terms.

The app has a local React shell, D1 foundations, and parent authentication. Milestone 2 is accepted: [staging](https://daily-stars-staging.spyd3rbuzz.workers.dev) passed automated signed-out protection checks, and the parent confirmed the remaining identity, recovery and revocation tests. Child profiles, templates and assignments are next in milestone 3. See the [verification record](docs/verification/milestone-2.md), [auth design](docs/auth-design.md) and [staging setup/recovery guide](docs/staging-access.md).

## Local setup

Use Node 24 (`nvm install && nvm use` with nvm), then:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open the loopback URL printed by Vite. `npm run dev` automatically shows `local-parent@example.test` with the current Jakarta date; no email code is needed. `npm run dev:mock` remains an alias for the same command.

The Vite dev middleware mocks only `GET /api/me` for loopback requests; other API routes still require valid authentication. It does not simulate real sign-out or session expiry: the mock always returns the synthetic parent. Use staging for actual Access login, logout and expiry tests. Production preview, builds and deployments retain JWT authentication; no Worker authentication code changes. Vite's [dev-server hook](https://vite.dev/guide/api-plugin#configureserver) does not run in builds or production preview. Without Access configuration, Worker API requests return JSON 503; with configuration, missing/invalid identity returns 401. Tests supply synthetic signed assertions and mock provider keys or UI responses.

Authenticated `GET /api/me` returns `{ email, today, timezone }`, with the Jakarta date and `Asia/Jakarta` timezone. Authenticated `GET /api/health` queries migrated D1 and returns `{ "status": "ok", "database": "ok" }`; an unavailable database produces JSON 503. Authenticated unknown API paths return JSON 404. All API responses use `Cache-Control: no-store`. Mutation requests require same-origin `Origin` and JSON content type before routing; no mutation endpoints exist yet.

The local binding is `DB`, named `daily-stars-local`. Its UUID in `wrangler.jsonc` is a local placeholder, not a provisioned remote database. Wrangler and Vite share `.wrangler/state` for local persistence. The numbered `migrations/` directory is the sole schema source. `fixtures/local.sql` contains synthetic children Sunny and Robin, a shared morning routine and a weekday-only activity. Seeding again leaves existing IDs/revisions alone. Fixtures do not authenticate a parent or expose records through an API.

Local development uses loopback only. `wrangler.jsonc` includes the separate staging database, team issuer and audience, an enabled staging hostname protected by Access, and disabled preview URLs. `npm run build:staging` selects it at build time. Follow the staging guide when provisioning another environment; Access must be configured before enabling its hostname. There is no production environment yet.

## Verification

```sh
npx playwright install chromium webkit
npm run check
```

`check` generates Worker types from the configured compatibility date/bindings, type-checks the frontend/Worker/tooling, runs Cloudflare Vitest checks in workerd with migrated D1, builds production assets and Worker code, and runs phone-sized Chromium/WebKit checks against production preview and the default dev server. The browser runner applies local migrations and synthetic seeds before starting preview on port 4173 and development on port 4174. Preview is deliberately started with the mock flag present to verify that it still requires authentication. Tests use local synthetic data; do not point them at a remote or family database.

Useful individual commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the local UI with a synthetic parent session; other API routes remain protected |
| `npm test` | Synthetic signed JWT security cases, Jakarta `/me`, real local D1, seed repeatability, foreign keys, authenticated health and JSON errors |
| `npm run typecheck` | Generate bindings/runtime types and check TypeScript |
| `npm run build` | Build static assets and the Worker |
| `npm run build:staging` | Build with the separate staging Worker/D1/Access configuration |
| `npm run preview` | Serve the existing production build locally (migrate first) |
| `npm run test:browser` | Test auth UI, failure/recovery, sign-out and built API denial at phone width in Chromium and WebKit |

GitHub Actions runs these checks for pull requests and pushes to main. It performs no deployment. Browser emulation does not establish installed-phone or real Access behavior. The D1 SQL-clock/atomic mutation proof, phone installation and recovery rehearsal remain gates in the specification.

Tooling follows the official [Cloudflare Vite setup](https://developers.cloudflare.com/workers/vite-plugin/get-started/), [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/), and [Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) documentation.
