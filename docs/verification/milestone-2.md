# Milestone 2: parent access

Implementation tracked in [issue #13](https://github.com/nurcahyopujo/daily-stars/issues/13). Design confirmed on 2026-11-09 in the [auth interview record](../auth-design.md).

**Milestone 2 accepted on 2026-11-09.** Local implementation and staged signed-out protection passed automated checks; the parent subsequently confirmed that all remaining manual acceptance tests passed.

## Local results

Node 24.22.2, Wrangler 4.158.0, jose 6.2.16, Cloudflare Vitest 1.6.0 / Vitest 5.1.0, Playwright 1.65.0; exact packages are in the lockfile.

The final `npm run check` passed:

```text
TypeScript: frontend, Worker/tests and tooling/browser tests passed
Vitest: 2 files, 12 tests passed
Production build: Worker and assets built
Playwright: 18 passed, Chromium + WebKit (8.7 seconds on the latest run)
```

Worker tests generate synthetic RSA keys and JWTs in memory and intercept the configured team's signing-key request; no parent identity or production key is used. They establish signature and claim validation, rejection of missing/expired/future/wrong-issuer/wrong-audience/non-human identities, forged/unsigned assertions, fail-closed signing-key fetch failures, distinct verified subjects/emails, and no trust in the auxiliary email header. All API routes require authentication, including health and unknown paths. `/api/me` returns the verified email and Jakarta date, including both sides of midnight. Mutation routing enforces same-origin and JSON content type. Existing migrated local D1, fixture, health, and foreign-key checks still pass.

Browser checks use the actual built Worker for anonymous API denial (401 when Access is configured locally, otherwise 503) and mocked `/api/me` responses for UI states. Both phone-sized browsers cover signed-in identity with a long email, sign-out navigation, 401/403 and HTML challenge recovery, a real local HTTP authentication redirect handled without following it, deliberate retry after a failed fetch, malformed identity denial, and identity clearing/rechecking during simulated page restoration. Signed-in, sign-in-required and unavailable screenshots from both browsers were visually inspected; text wraps, controls fit and focused controls remain visible. Restoration events are simulated, not proof of actual installed-app history or session behavior. The latest full check also passed with the setup wizard's real issuer/audience present in ignored local configuration; the missing-config Worker test explicitly supplies empty values.

The existing shell and empty-state styling were reused. `ParentAccess` owns the one auth screen; its request/state module owns session retrieval. No shared UI component abstraction was added. Family data and parent identity remain in memory, with no persistent browser cache or auth bypass.

`npm run build:staging` also passed. The generated configuration was checked for the staging Worker/database, separate placeholder database ID, disabled public/preview URLs, and disabled Worker observability. `wrangler deploy --dry-run --config dist/daily_stars_local/wrangler.json` passed without uploading. The final full check rebuilt the local configuration afterward; rebuild staging before an actual staging deployment.

The ephemeral account wizard passed `bash -n`. ShellCheck's only findings were the unchanged skill template's SC1087 and unused library helpers (SC2329); excluding those leaves no findings in authored stages. The wizard was not run end-to-end because browser sign-in and account/billing choices belong to the human.

## Private staging deployment

On 2026-11-09, after the parent reported completing account setup, Wrangler OAuth login was verified and the saved team issuer was loaded from ignored local configuration. The existing token permits Worker/D1 management but returned HTTP 403 for organization settings and creating an OTP provider. Access application and provider lists were empty at 07:15 UTC. The parent was given a separate dashboard wizard to finish these settings without exposing account credentials.

- Worker: `daily-stars-staging`, version `b4ad39f4-1134-4363-9f0b-e29751a5db43`.
- D1: `daily-stars-staging`, ID `b5cd4909-4557-4fd5-941e-b2bbaadbcb65`, APAC/SIN.
- Migration `0001_profiles_and_rules.sql` applied remotely: all seven statements succeeded. A subsequent read-only query confirmed zero children, templates, template versions and assignment versions; no fixtures or family records were loaded.
- Team issuer: `https://pujo-rizki-fam.cloudflareaccess.com`; application audience remains empty, so API access fails closed.
- Cloudflare's Worker subdomain API confirmed `enabled: false` and `previews_enabled: false`. The deployed settings confirmed the intended staging D1 binding. Upload completed with **No targets deployed**; no public hostname was enabled.
- Deployed Worker artifact SHA-256: `548b59aa70915571920264203aeac6c95984c362178f07ad3984cc6db7f29f7b`.

The source tree was uncommitted, based on `bf0388836513c3ecbb79061486051ab9e8385886`; that base commit alone does not identify all uploaded changes. The version ID and artifact hash above identify the private upload. The staging build and generated target/binding checks passed after replacing the placeholder database ID. No application logic changed during provisioning, so the prior local test results remain applicable.

## Enabled staging and Access checks

The parent subsequently reported **Access configured** and supplied the public audience through the guided dashboard procedure. The application audience is `23a30e92201a566cf5c3c454a934406c95c0079790bf2d822870bc376c5911f8`, deployed in Worker version `465d3901-0bc0-4052-801f-ed7a466abd42` at [the staging hostname](https://daily-stars-staging.spyd3rbuzz.workers.dev). Worker code and its artifact hash remain unchanged from the private upload; this deployment updates bindings and hostname configuration.

The current OAuth token lacks the documented Access read permissions. Its list endpoints continued reporting no apps/providers even though direct requests reached the actual Access application. Those list responses cannot establish absence or verify exact policy membership/session settings. The final dashboard settings are parent-reported; the following edge checks were independently observed.

At `2026-11-09T07:56:24Z`, all ten fresh, cookie-free probes returned **302** to `pujo-rizki-fam.cloudflareaccess.com`, with the redirect audience (`kid`) matching the configured application. Login redirect metadata and cookies were excluded from evidence.

| Request | Observed result |
| --- | --- |
| `GET /` | Matching Access challenge |
| `GET /children/synthetic-deep-link` | Matching Access challenge |
| `GET /assets/index-Cx2koduK.js` | Matching Access challenge |
| `GET /assets/index-V_pWFTD3.css` | Matching Access challenge |
| `GET /api` | Matching Access challenge |
| `GET /api/me` | Matching Access challenge |
| `GET /api/health` | Matching Access challenge |
| `GET /api/unknown` | Matching Access challenge |
| Same-origin JSON `POST /api/children` | Matching Access challenge |
| `GET /api/me` with a forged assertion header | Matching Access challenge |

The newly enabled hostname initially returned 404, triggering automatic disable. A guarded retry allowed only initial 404 propagation; after one five-second wait it returned the matching challenge. No unprotected 200 response was observed. The final management response confirmed `enabled: true`, `previews_enabled: false`. Prior/current version URLs using prefixes `b4ad39f4` and `465d3901`, and an unused `staging` alias, all returned 404 after redeployment. No additional domains or aliases were created in this work.

Fresh Pixel 7 Chromium and iPhone 13 WebKit sessions both followed the live challenge to the expected team, displayed an email field and a **Send login code** button, and were visually inspected. No identity or code was submitted by automation. The parent reported that only one approved parent has been tested so far. The second parent and an unapproved identity remain required checks.

## Final manual acceptance

At `2026-11-09T08:32Z`, following the checklist for both parents, rejection of an unapproved email, sign-out/session-expiry recovery, and existing-session removal/revocation within the 60-second target, the parent reported: **“all tested and success.”** Record those checks as passed by parent confirmation. These authenticated flows and revocation timing were not independently repeated by the agent; exact elapsed seconds and device/version details were not supplied. The earlier automated results above remain separate evidence.

## Completed staging checkpoint

The [setup and recovery guide](../staging-access.md) retains the provisioning and recovery procedure. The accepted deployment version is recorded above; credentials, approved email addresses, cookies, codes and family data are excluded from this record.

| Gate | Status |
| --- | --- |
| Account/Zero Trust setup and CLI authorization | CLI login verified; dashboard setup completed per parent |
| Separate staging D1 and private Worker deployment | Provisioned, migrated and empty; current protected hostname enabled |
| All traffic exact-email OTP protection and session settings | Dashboard configuration parent-reported; matching edge challenge and email-code screen independently observed; policy/session metadata not API-inspected |
| Two approved identities and rejected identity | Passed per final parent confirmation |
| Signed-out direct UI/assets/API denial and preview inventory | Ten matching Access challenges; previews disabled and tested URLs return 404 |
| Real sign-out, application renewal, and fresh-code recovery | Passed per final parent confirmation |
| Existing-session denial within 60 seconds after removal + revocation | Passed against the target per final parent confirmation; exact elapsed time not supplied |

Milestone 3 may now start: child profiles, templates, assignments and the scheduled-rule/mutation foundations. Its D1 clock and atomic rollback evidence gate remains independent. Full installed-phone acceptance remains in milestone 7 and production launch in milestone 8.
