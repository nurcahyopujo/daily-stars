# Milestone 1: local skeleton

Verified locally on 2026-11-09 for [issue #10](https://github.com/nurcahyopujo/daily-stars/issues/10).

## Runtime and schema

- macOS arm64; Node `24.22.2`; npm `10.8.2`.
- Wrangler `4.158.0`; Cloudflare Vite plugin `1.67.0`; Cloudflare Vitest plugin `1.6.0`; Vitest `5.1.0`; Playwright `1.65.0`. Exact dependencies are in `package-lock.json`.
- Compatibility date `2026-11-08`; no application compatibility flags. The production-preview binary rejected `2026-11-09` as newer than its supported maximum; the committed date passes both runtime paths.
- Binding `DB`, local database `daily-stars-local`, placeholder UUID `00000000-0000-0000-0000-000000000001`. No remote database was accessed.
- Schema `migrations/0001_profiles_and_rules.sql`: children, templates, template versions and assignment versions. Wrangler applied all seven schema statements locally. Vitest applies the same file using `readD1Migrations()` / `applyD1Migrations()`.
- Fixtures come from `fixtures/local.sql`, outside migrations. Tests parse that exact file with Cloudflare’s SQL splitter and execute prepared statements with `DB.batch()`; local browser setup uses Wrangler’s `d1 execute --local --file` path.

## Checkpoint results

`npm run check` exited successfully:

```text
TypeScript: frontend, Worker/tests, tooling/browser tests passed
Vitest: 1 test file passed; 5 tests passed
Production build: Worker and client assets built
Playwright: 4 passed (15.2s), Chromium + WebKit
```

Worker/D1 checks establish:

- `GET /api/health` calls `DB.prepare('SELECT id FROM children LIMIT 1').all()` and succeeds against the migrated, empty database. It returns status only, without child data, and `Cache-Control: no-store`.
- Temporarily renaming the children table makes the same endpoint return JSON 503 without leaking the database error; the test restores the table afterward.
- Unknown API paths, including `/api` and HTML navigation requests, return JSON 404. Unsupported methods do not invoke health reads.
- Seeding twice preserves exactly two synthetic children and two assignment revisions referencing the same template. The persisted template includes the Monday–Friday activity.
- An assignment for a missing child fails the actual D1 foreign-key constraint.

Playwright starts the built app with `vite preview` after applying local migrations and the synthetic seed. Pixel 7 Chromium and iPhone 13 WebKit emulation both render the React shell without page errors or horizontal overflow. Both browser projects also verify the health response and actual Worker-first routing: browser navigation to unknown API paths returns JSON 404 instead of `index.html`. Screenshots are generated under `test-results/*/shell.png`; both were visually inspected.

## Remaining gates

This is local skeleton evidence only. The tests do not establish mutation atomicity, SQL-clock freshness or midnight guards. Those local/staging probes remain required before passing milestone 3. Real Access, approved and rejected identities, installed-phone behavior, and staging recovery remain their specified gates. No staging or production resources, remote migrations, authentication bypasses or deployments were added.
