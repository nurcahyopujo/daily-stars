# Parent access design

Complete design confirmed on 2026-11-09; implementation authorized. Runtime acceptance requires the checks below.

Tracked in [issue #13](https://github.com/nurcahyopujo/daily-stars/issues/13). See the [staging setup and recovery guide](staging-access.md) and [verification evidence](verification/milestone-2.md).

## Confirmed scope

On 2026-11-09, the parent confirmed retaining [F1 in the MVP specification](../mvp-spec.md#f1-parent-access): one private household, two approved parents with identical permissions, Cloudflare Access email codes, protection for all app traffic, and verified parent identity for audit history. Reconsider these decisions only if implementation reveals a conflict.

The [Access/PWA research](research/access-pwa.md) supplies the feasibility evidence and remaining staging and phone checks. Documentation research does not establish that those checks have passed.

## Confirmed session and recovery decisions

On 2026-11-09, the parent accepted the following:

- Use a seven-day global login and a 24-hour application session, with the policy inheriting the application duration. Aim for approximately weekly email-code entry on personal phones; verify the observed frequency in staging. This is not a strict seven-day reauthentication deadline: an unexpired application session can outlive the global login.
- Use administrator-managed recovery. Remove an approved email when necessary and revoke existing sessions; verify that an already signed-in device loses access. Removing an email alone does not revoke existing sessions. After a lost phone, secure the mailbox and device as well.
- Deliver milestone 2: separate protected staging, verified API identity, `/api/me`, and a minimal signed-in/sign-in-recovery screen. Verify approved identities, a rejected identity, and signed-out UI/assets/API access. Full installed-app acceptance remains in milestone 7; production launch remains in milestone 8.
- Show the verified parent email and an explicit **Sign out** action on the minimal signed-in screen. Use Cloudflare Access logout and clear the app's in-memory personalized state when signing out. Cloudflare logout can also end sessions for other Access applications; it is not limited to this app.
- Require an already signed-in device to be denied new protected requests within 60 seconds after the administrator completes both email removal and session revocation. Measure this in staging; it is a project acceptance target, not a documented Cloudflare propagation guarantee. If it fails, revisit recovery before passing milestone 2. This does not erase information already displayed on a phone.

[Cloudflare session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/) documents renewal and administrative revocation. Local JWT signature verification does not itself establish revocation state; Cloudflare Access protection at the edge remains essential. No instantaneous revocation guarantee has been accepted or demonstrated.

The existing spec and research already require deliberate top-level sign-in recovery, detection of authentication redirects/non-JSON API responses, no automatic mutation replay, and no persistent family data. Retain those behaviors.

## Implementation acceptance

Retain the security checks and evidence requirements from F1 and the research, including invalid/expired/wrong-issuer/wrong-audience JWT rejection, distinct verified parent identities, no authenticated API caching, protected direct UI/asset/API URLs, and disabled or equally protected previews. Verify sign-out and deliberate recovery from expired authentication, including non-JSON challenges and ambiguous network failures.

Record the actual session settings and revocation timing with sanitized evidence. Existing sessions must be exercised during removal testing; a fresh-browser denial alone does not pass the revocation check. Do not put email codes, cookies, JWTs, or real family data in evidence or fixtures.

Cloudflare account configuration and real staging checks are implementation prerequisites and evidence gates, not completed work.
