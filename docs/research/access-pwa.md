# Access-protected mobile PWA feasibility

Research for [Verify Access-protected installation and sign-in on both phones](https://github.com/nurcahyopujo/daily-stars/issues/3), checked 2026-11-08 against [baseline specification 23d1eef](https://github.com/nurcahyopujo/daily-stars/blob/23d1eef/mvp-spec.md), especially F1, F8 and milestones 2/7/8.

## Recommendation and evidence boundary

The documented components support trying the proposed `workers.dev` + Workers Static Assets + Access architecture in staging. This is a research recommendation, not platform acceptance or a launch decision. Documentation does **not** prove that protected installation resources and the full Access redirect flow work in the two target phones' installed apps. Those remain release gates below. No service was provisioned, application implemented, parent email used, or phone test performed for this research.

## Hosting and identity: documented facts

Cloudflare's current Worker-level Access **All traffic** option protects every associated domain, including `workers.dev`, routes, Custom Domains and previews. Static Assets remain protected, but their internal router does not forward `ctx.access` to user code. Hostname/path applications take precedence over Worker-level protection; review overlapping policies. Worker-level Access currently does not support WebSockets, which this MVP does not require. [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

`workers.dev` requires no owned domain. Cloudflare recommends routes or a custom domain for production and describes `workers.dev` as intended for personal/hobby projects. This household app fits that stated category; a custom domain is an alternative, not an Access/PWA prerequisite. Browser Integrity Check cannot be disabled on `workers.dev`; automation should use a descriptive User-Agent. [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

Version URLs are public when enabled. Set `preview_urls: false` explicitly to disable Version URLs and aliases; omitting the setting preserves an existing value. Protect any enabled URLs and inventory other preview deployments separately. [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)

Static Assets defaults to asset-first routing; `run_worker_first` supports route patterns. Use it for `/api` and `/api/*`, so unknown API requests reach the JSON router rather than the SPA fallback. [Assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/#run_worker_first)

At every API entry, validate `Cf-Access-Jwt-Assertion` with remote signing keys at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, the exact configured issuer and the staging/production application's audience. Cloudflare's Worker example uses `jose`'s `createRemoteJWKSet` and `jwtVerify`; decoding alone does not verify identity. [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

Access application tokens document `sub`, email, issuer, audience and expiration; service-token subjects can be empty. For this parent-only API, require a verified, nonempty human subject and email before writing audit fields. [Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/) Reject expired tokens; the JWT standard forbids accepting an `exp` token at or after its expiration, subject to small clock-skew allowance. [RFC 7519 §4.1.4](https://www.rfc-editor.org/rfc/rfc7519.html#section-4.1.4)

## Account and policy prerequisites

An administrator needs a Cloudflare account and Zero Trust organization, a team name, subscription selection and payment details even for the Free plan according to current onboarding documentation. Add One-time PIN explicitly: new organizations initially have Cloudflare identity as their default login method. [Zero Trust setup](https://developers.cloudflare.com/cloudflare-one/setup/)

Configure one Allow policy with the **Emails** selector containing exactly the two approved parent addresses. Avoid **Emails ending in**, Everyone, broad account membership, and Bypass rules. Emails is a login-time identity check, not a continuously checked selector. [Policies and selectors](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)

Enable OTP as the application's selected login method. Allowed emails receive a single-use code expiring ten minutes after request; a new code invalidates the previous code. Blocked emails receive no code although the screen reports that one was emailed. Test denial by inability to access the app, not that message. Check mailbox delivery and security scanners if a code appears already consumed. [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

## Installation resources and phone behavior

The HTML manifest-fetch algorithm derives credentials mode from the link's `crossorigin` attribute. [HTML manifest processing](https://html.spec.whatwg.org/multipage/links.html#link-type-manifest) Mozilla's browser documentation explicitly specifies `crossorigin="use-credentials"` even for a same-origin manifest that requires credentials. Use:

```html
<link rel="manifest" href="/app.webmanifest" crossorigin="use-credentials">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

[Manifest credentials](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/crossorigin#web_manifest_with_credentials)

Keep manifest and icons same-origin. Preserve F8's metadata, `display: standalone`, stable `id`, `scope: /`, `start_url: /`, 192/512 icons and maskable icon; include no parent or child information in these files. The manifest standard describes icon fetching separately, in an associated document context, and remains a Working Draft. Setting manifest credentials does **not** establish that every browser/platform installer fetches every icon successfully behind Access. [Manifest image resources](https://www.w3.org/TR/appmanifest/#manifest-image-resources)

The baseline's network-only approach does not inherently prevent installation: a service worker is not an installability requirement according to the linked browser guide. HTTPS remains required for deployment. [PWA installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

On iPhone, use Safari's Share → Add to Home Screen flow, keeping Open as Web App enabled where offered. [Apple's installation instructions](https://support.apple.com/en-eg/guide/iphone/iphea86e5236/ios) WebKit documents copying login cookies at installation starting with iOS 17.2, followed by separate website data stores. Thus signing into Safari later must not be assumed to refresh an already installed app's login. [WebKit Safari 17.2](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/#web-apps)

On Android, use Chrome's menu → Install and create shortcut → Install, following the offered UI. [Chrome Android installation](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en) Google's WebAPK documentation says an installed app uses its installing Chrome version/profile and shares cookies and storage; scope affects which links open the app. Keep the manifest stable and user-independent. This older architectural documentation is context, not a guarantee of current protected installation behavior. [WebAPKs](https://web.dev/articles/webapks)

**Inference:** cookie-based Access is compatible in principle with both models. The team-domain authentication page is outside the app origin, so cross-origin navigation and return to standalone mode are specific risks to measure. A correct manifest alone does not verify initial login, icon selection, or reauthentication.

## Session expiry and network-only proposal

Access can renew an expired application token while the global token is valid and the identity passes policy. When the global token also expires, reauthentication is required. Policy/application/global durations differ; merely waiting for the application expiry is insufficient to test a fresh OTP flow. Record all chosen durations and test both cases. [Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)

**Implementation proposal:** keep API calls same-origin with credentials and `cache: "no-store"`. Check status, redirect/final URL and JSON content type before parsing; handle 401/403, HTML challenge responses and fetch failures. A failed redirected fetch may expose no response due to CORS, so it cannot always be distinguished from loss of connectivity. Offer a deliberate top-level same-origin navigation to sign in; never fetch the Access login page as an API or replay a mutation automatically. Fetch's redirect and CORS algorithms explain why redirect failure need not arrive as application JSON. [Fetch standard](https://fetch.spec.whatwg.org/#http-redirect-fetch)

Send `Cache-Control: no-store` on authenticated API successes and errors, including any personalized HTML. This prohibits compliant HTTP caches from storing responses; `private` or `no-cache` alone does not. [RFC 9111 §5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5) Put API headers on Worker responses: Static Assets `_headers` rules do not apply to Worker-generated responses. [Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)

Use no service worker in v1, no Cache Storage writes, no persistent query cache, local/session storage, IndexedDB, background sync or persisted mutation queue for family records. HTTP headers alone do not prevent script-managed Cache API storage. [Cache API behavior](https://developer.mozilla.org/en-US/docs/Web/API/Cache) Access's authentication cookies are a necessary session mechanism, distinct from persisting family data. Keep unsent form input/action IDs in memory, surface connection failure, and refetch after resume/reconnection. Preserve the spec's mutation receipt/revision checks for uncertain writes.

## Proposed staging configuration

Use separate staging and production Workers, D1 bindings and Access application audiences. Set `workers_dev: true`, `preview_urls: false`, an assets directory/binding, SPA fallback and `run_worker_first: ["/api", "/api/*"]`. Configure each Worker with All traffic protection and the exact-email OTP policy above; verify the selected app login methods and overlapping hostname rules. Store `TEAM_DOMAIN` as the exact HTTPS issuer and `POLICY_AUD` from that environment's Access application. This is a reviewable configuration proposal, not provisioned configuration.

## Staging and on-device acceptance checklist (all unexecuted)

Record deployment SHA, hostnames, Access application IDs/audiences, relevant policy/session settings, phone models, OS/browser versions, observed outcomes and sanitized evidence. Use synthetic child data and two approved test identities. Do not record JWTs, codes, cookies or real family data.

1. In a signed-out browser, request `/`, a deep SPA link, JS/CSS, manifest, every icon, `/api/me`, an unknown API URL and a mutation directly. Confirm challenge/denial and no family data. Enumerate every enabled preview/version/alias and repeat; verify disabled URLs fail to serve the app after redeployment.
2. Sign in with both approved identities and verify distinct `sub`/email audit fields; try an unapproved email. Validate missing, forged, expired, wrong-issuer and wrong-environment-audience tokens at the API boundary. Confirm an unknown authenticated API path is JSON 404.
3. On each actual phone, first sign into the normal browser; inspect manifest/icon requests for successful JSON/images rather than login HTML. Install, confirm name/icon and standalone launch, read a checklist, save a score, then confirm the second parent sees the same committed result.
4. Test installed-app login with no usable session as well as the copied/shared-session case. Close/relaunch, switch to mail to retrieve OTP and return, follow a protected deep link, and verify return from the team-domain page to the usable app. Record whether browser UI opens and how the parent returns.
5. Expire the application session while global login remains valid; then expire/revoke the global login too. Test idle launch, resume, GET and mutation. Confirm usable sign-in recovery, no HTML-as-JSON errors, no duplicate write and correct identity afterward. On iPhone test a Safari login independently from the installed app.
6. Disconnect during an open form and during save; keep drafts only in memory, communicate uncertainty, reconnect and reconcile through the existing action key/receipt while the page survives. After full relaunch refetch committed state. Cold offline launch may show the browser offline page. Inspect storage/caches and HTTP headers; no family records persist there.

## Conflicts and remaining gates

No documented hard conflict requires changing the baseline stack or adding a domain. Its JWT validation and authenticated-manifest requirements agree with the reviewed docs. Current Worker-level All traffic protection provides a concrete way to meet its broad protection requirement.

Two clarifications should guide implementation: application-token expiry alone may renew without OTP, and an installed iPhone app must not depend on later Safari logins. The unresolved feasibility gate is protected manifest/icon installation plus the complete standalone Access sign-in/expiry flow on both actual phones. If that gate fails, capture the precise request/navigation failure before changing architecture. Publicly bypassing installation assets would change F1's all-traffic boundary and needs an explicit product/security decision; a custom domain by itself does not prove the browser problem is solved.
