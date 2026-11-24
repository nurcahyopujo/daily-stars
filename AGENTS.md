## Development

Node 24 is required (`.nvmrc`, `package.json` `engines`/`volta`); `wrangler`
fails on older Node. If your shell defaults to another version, run `nvm use`
(or install Volta, which auto-switches) before any npm command.

Inner loop: `npm run check:fast` (typecheck + lint + unit, seconds). Run the full
`npm run check` (adds build + both browser projects, minutes) before finishing.

Browser tests run each project in its own invocation with its own auto-reset local
D1 (`npm run test:browser`), so the suite is isolated and repeatable — don't run
`npx playwright test` across both projects on one DB. For a faster single-browser
loop use `npm run test:browser:chromium` (or `:webkit`).

## Agent skills

### Issue tracker

Track issues and specs in GitHub Issues. Before tracker operations,
read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before assigning triage labels,
read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. Before exploring the codebase,
read `docs/agents/domain.md`.

### Frontend

Before implementing or reviewing frontend components, styles, or interactions,
read `docs/agents/frontend.md`.
