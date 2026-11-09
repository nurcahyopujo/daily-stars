# Staging parent access

The [confirmed design](auth-design.md) delivers milestone 2, accepted on 2026-11-09 after automated staged protection checks and parent-confirmed manual acceptance. Continue using synthetic data through the remaining build milestones; production launch remains milestone 8.

Current state (2026-11-09): staging D1 is created and migrated, dashboard Access configuration is complete per parent, and the saved audience is deployed. [The staging hostname](https://daily-stars-staging.spyd3rbuzz.workers.dev) passed signed-out UI/assets/API checks against that audience; previews remain disabled. The parent confirmed both approved identities, an unapproved identity, sign-out/expiry recovery and the revocation target all passed. The CLI OAuth token cannot independently inspect Access policies or session settings; its empty Access lists are not proof that those resources are absent. See [verification evidence](verification/milestone-2.md) for the distinction between automated observations and parent-confirmed results. The steps below describe fresh provisioning and recovery, not work that needs repeating for this environment.

## Account setup

Create a Cloudflare account, enable two-factor authentication, and open Zero Trust. Choose a team name and the Free subscription; onboarding currently requests payment details even for Free. The team issuer is `https://TEAM.cloudflareaccess.com`. Existing teams can find their name in Zero Trust settings. [Official onboarding](https://developers.cloudflare.com/cloudflare-one/setup/)

Add One-time PIN under Zero Trust → Integrations → Identity providers. The app will select this login method explicitly. [Official OTP setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

Authorize the CLI from the repo using Node 24:

```sh
npx wrangler login
npx wrangler whoami
```

Keep account credentials and email codes in Cloudflare's pages. No API token needs to be pasted into chat. The one-run guided setup script provided during development captures only the public team issuer in ignored `.dev.vars`; it does not deploy anything.

## Prepare a private staging deployment

For a fresh staging environment, create the separate staging database (already completed for the configured staging ID):

```sh
npx wrangler d1 create daily-stars-staging --config wrangler.jsonc
```

Replace only the staging placeholder database ID in `wrangler.jsonc` with the returned ID. Confirm the name is `daily-stars-staging`, then apply the existing schema:

```sh
npx wrangler d1 migrations apply DB --config wrangler.jsonc --env staging --remote
npm run build:staging
npx wrangler deploy --config dist/daily_stars_local/wrangler.json
```

This first upload keeps `workers_dev: false` and `preview_urls: false`; do not add a route or custom domain. Vite selects the staging environment at build time and retains the top-level Vite environment directory name. Inspect the generated config: Worker name `daily-stars-staging`, the new staging database ID, disabled public endpoints, and disabled Worker observability. Passing an environment only at deploy time does not select another Vite build. [Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)

## Apply Access before enabling the hostname

In Workers & Pages, choose `daily-stars-staging` → Access → Protect this Worker behind Access, choose **All traffic**, configure the policy and apply it. Check overlapping hostname/path policies, which can take precedence. Keep preview/version URLs disabled. [Worker protection](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

Configure one Allow policy using **Emails** for exactly the two approved parent addresses; enter those addresses directly in Cloudflare, not fixtures or checked-in configuration. Select One-time PIN as the application's login method. Set the global login to seven days and application duration to 24 hours; the policy inherits the application duration. The global setting can affect other Access applications in the organization, so review any existing usage before changing it. [Session settings](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)

Find the application's audience (AUD) under Zero Trust → Access controls → Applications → edit the staging app → Additional settings. Fill in `env.staging.vars.TEAM_DOMAIN` with the exact HTTPS issuer (no trailing slash) and `env.staging.vars.POLICY_AUD` with that staging application's audience. These are public configuration, not credentials. `.dev.vars` supplies local development values only. Verify the final policy is the exact-email Allow policy, OTP is the selected login method, and All traffic protection applies. Then change only staging `workers_dev` to `true`, rebuild with `npm run build:staging`, inspect the generated config, and deploy that artifact. Immediately run the signed-out checks below. If any fail, disable the staging hostname and investigate before continuing. [Finding the AUD tag](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag)

The one-run Access wizard provided in this session opens the relevant dashboards and saves only the public audience in ignored `.dev.vars`. If the Worker setup initially creates a Cloudflare-account policy, replace it with the two-parent policy before enabling any public endpoint. The reusable policy can be created under Zero Trust → Access controls → Policies, with Action **Allow**, session duration **Same as application**, and Include **Emails** containing exactly the approved parents. Attach it to the staging app and remove the initial policy. [Policy management](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/)

## Real staging checkpoint

Record sanitized evidence in [milestone 2 verification](verification/milestone-2.md): deployment SHA, hostname, staging database/application identifiers, session settings, dates, outcomes and revocation timing. Exclude tokens, codes, cookies, approved email addresses, and real family data.

- In a fresh signed-out browser, directly request `/`, a deep link, built JS/CSS, `/api/me`, `/api/health`, and an unknown API path. All must challenge or deny before serving the app/API. Inventory any other domains or previews; disabled URLs must remain unavailable after redeploying.
- Sign in as each approved parent. `/api/me` must return the correct email, Jakarta date and timezone with `Cache-Control: no-store`. An authenticated unknown API route must be JSON 404. Try a third, unapproved identity and prove it cannot enter; a message saying a code was sent is not proof that it was allowed.
- Exercise expired application sessions with a valid global login, and expired global/application sessions requiring a fresh code. Verify deliberate top-level recovery, sign-out, and correct identity afterward. Local tests do not establish real cookie renewal or provider behavior.
- Verify the existing-session revocation target using the procedure below. No other milestone starts until this checkpoint passes.

## Lost phone or parent removal

Secure the lost device and mailbox. If access must end, remove the affected email from the application's Allow policy and revoke the affected user's existing sessions through the Zero Trust administrator controls. Revocation alone does not prevent a still-approved identity from signing in again; email removal alone does not terminate existing sessions. [Revocation and logout](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#revoke-user-sessions)

For the staging test, keep the affected parent signed in on another browser/device before both administrator actions. Record the UTC completion time of the second action. Without clearing cookies or logging out on the affected device, issue a new protected `/api/me` request at least every five seconds with caching disabled. Stop after denial, recording the first denial time/status without response secrets. Pass only if denial occurs within 60 seconds; otherwise keep milestone 2 open and revisit the design. Confirm both direct assets and API remain protected and the other approved parent still works. Restore an email only when recovery is intended, then test a fresh login.

Cloudflare describes administrative revocation without a precise propagation bound; 60 seconds is our measured project target. Local JWT signature validation cannot establish revocation by itself. Already displayed information cannot be remotely erased. User Sign out navigates to `/cdn-cgi/access/logout`, clears in-memory app identity first, and can end sessions for other Access applications too.
