# Daily Stars

A private household’s daily activities and points tracker. The [MVP specification](mvp-spec.md) defines the build order and the [glossary](GLOSSARY.md) defines domain terms.

The top-bar hamburger menu contains **Home** (welcome hero), **Manage children**, and **Profile** (the parent sign-in/session screen). Menu links use `/`, `/children`, and `/profile`; `/home` also opens Home. Direct links, refreshes and browser Back/Forward preserve the selected page. Child management supports create with optional ordered initial templates, rename, list active/archived children, and archive from tomorrow. Add and edit forms open in a modal. Profile saves include atomic initial assignments, revision checks, audit records and retry receipts. See the [child-profile verification record](docs/verification/child-profiles.md) for scope and remaining gates. Template editing, later assignment edits, checklist/history screens and points entry follow in their respective milestones; milestone 3 is not yet accepted.

Milestone 2 is accepted: [staging](https://daily-stars-staging.spyd3rbuzz.workers.dev) passed automated signed-out protection checks, and the parent confirmed the remaining identity, recovery and revocation tests. See the [verification record](docs/verification/milestone-2.md), [auth design](docs/auth-design.md) and [staging setup/recovery guide](docs/staging-access.md).

## Local setup

Use Node 24 (`nvm install && nvm use` with nvm), then:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open the loopback URL printed by Vite. `npm run dev` automatically shows `local-parent@example.test` with the current Jakarta date; no email code is needed. `npm run dev:mock` remains an alias for the same command.

The Vite dev middleware supplies a synthetic parent for `GET /api/me` and the child-profile routes (`GET/POST /api/children`, `PATCH /api/children/:id`, `GET /api/templates`) on loopback requests only. Profile routes use the application's validation and operations against real local D1 through Wrangler's platform proxy. Mutation requests still require same-origin JSON and an idempotency key. Other API routes require valid authentication. The mock does not simulate real sign-out or session expiry; use staging for those checks. Production preview, builds and deployments retain JWT authentication. Vite's [dev-server hook](https://vite.dev/guide/api-plugin#configureserver) does not run in builds or production preview. Without Access configuration, Worker API requests return JSON 503; with configuration, missing/invalid identity returns 401. Tests supply synthetic signed assertions and mock provider keys or UI responses.

Authenticated `GET /api/me` returns `{ email, today, timezone }`, with the Jakarta date and `Asia/Jakarta` timezone. Authenticated `GET /api/health` queries migrated D1 and returns `{ "status": "ok", "database": "ok" }`; an unavailable database produces JSON 503. Child-profile routes follow [F2 and the API contract](mvp-spec.md#5-api-contract); list responses wrap `children` or `templates` with the response's `today`. Authenticated unknown API paths return JSON 404. All API responses use `Cache-Control: no-store`. Mutations require same-origin `Origin`, JSON content type and an `Idempotency-Key`. Keep the page open after **Save not confirmed**, then use **Check / retry** to recover the same action. Reloading discards its memory-only retry key.

The local binding is `DB`, named `daily-stars-local`. Its UUID in `wrangler.jsonc` is a local placeholder, not a provisioned remote database. Wrangler and Vite share `.wrangler/state` for local persistence. The numbered `migrations/` directory is the sole schema source. Apply migrations before opening the profile UI, including `0002_child_mutations.sql` on an existing checkout. `fixtures/local.sql` contains synthetic children Sunny and Robin, a shared morning routine and a weekday-only activity. Seeding again leaves existing IDs/revisions alone. Fixtures do not authenticate a parent.

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
| `npm run dev` | Run the local UI and profile operations with a synthetic parent and real local D1 |
| `npm test` | Synthetic JWT security cases, real D1 profile creation/rename/archive, retry/concurrency/rollback, calendar boundaries, seeds and HTTP validation |
| `npm run typecheck` | Generate bindings/runtime types and check TypeScript |
| `npm run build` | Build static assets and the Worker |
| `npm run build:staging` | Build with the separate staging Worker/D1/Access configuration |
| `npm run preview` | Serve the existing production build locally (migrate first) |
| `npm run test:browser` | Test auth and profile UI, uncertain/stale recovery, local D1 persistence and built API denial at phone width in Chromium and WebKit |

GitHub Actions runs these checks for pull requests and pushes to main. It performs no deployment. Browser emulation does not establish installed-phone or real Access behavior. The D1 SQL-clock/atomic mutation proof, phone installation and recovery rehearsal remain gates in the specification.

Tooling follows the official [Cloudflare Vite setup](https://developers.cloudflare.com/workers/vite-plugin/get-started/), [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/), and [Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) documentation.
