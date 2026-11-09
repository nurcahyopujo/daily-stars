# Kids’ Points Tracker — MVP build specification

## 1. Goal and scope

A parent opens the app from their phone’s home screen, chooses a child, and logs a daily activity or one-off point change. Each child has a running total and a daily breakdown. Two parents can use the same family data on separate devices. A change to a routine takes effect on the correct date and leaves prior dates intact.

**Stack.** One TypeScript Cloudflare Worker serves a React/TypeScript SPA built with Vite and the same-origin JSON API. One D1 database stores the family’s data. Cloudflare Access protects the app on `workers.dev`. Keep domain rules independent of the UI. The parent approved the implementation structure and verification approach in [issue #5](https://github.com/nurcahyopujo/daily-stars/issues/5); section 9 records the handoff.

**MVP boundary.** One private household, parent-only access, and internet required. Rewards, redemption, child accounts, public registration, push notifications, and offline data entry are outside this release.

**Accepted defaults.** The parent accepted integer point limits, nickname-only profiles, archive timing, final voiding, and optimistic concurrency in [map #1](https://github.com/nurcahyopujo/daily-stars/issues/1). The numeric limits below are the accepted defaults. Reopen a settled rule only for a concrete conflict.

## 2. Rules shared by every feature

| Rule | Expected behavior |
|---|---|
| Family calendar | The Worker determines today in `Asia/Jakarta`. Represent activity dates as `YYYY-MM-DD` and audit times as UTC ISO timestamps. Use calendar arithmetic for tomorrow and previous/next day. |
| Dates that accept scores | Today or an earlier valid date on or after the child’s start date. For an archived child, dates before the effective archive date remain editable. Future dates return a validation error. |
| Date at save time | Each request attempt has one server-calculated `today`. Scheduled rule saves use the acceptance boundary defined in section 4; a midnight retry recalculates server-derived dates. A score keeps the explicitly selected activity date even if midnight passes while the form is open. Refresh the dashboard’s today label and date when the app resumes. |
| Point precision | Use signed integers throughout. Suggested bounds are 1–999 for a reward, 0–999 for a penalty magnitude, and −999 to +999 excluding zero for a new one-off. |
| Historical accuracy | A checklist uses the template and assignment effective on the activity date. A correction changes the score for that date using that date’s rules. |
| Running total | Start at zero. Sum each entry’s latest effective contribution across all days. Negative totals are valid. |

Example day boundary. `2026-11-07T16:59:59Z` belongs to November 7 in Jakarta. `2026-11-07T17:00:00Z` belongs to November 8. A scheduled rule save accepted immediately before that boundary applies November 8. One accepted at or after the boundary applies November 9. Pressing Save alone does not determine acceptance.

## 3. Feature specifications

### F1. Parent access

- An approved parent enters their email address and a one-time code through Cloudflare Access. Both parents get identical application permissions. A Cloudflare administrator adds or removes exact email addresses in the Access policy.
- Protect all traffic for this Worker. Use an allow policy for the exact parent emails and configure One-time PIN as the app’s login method. Disable unused preview URLs or confirm they receive the same protection.
- At the API boundary, verify the Access application JWT in `Cf-Access-Jwt-Assertion` using the configured Cloudflare team issuer, application audience, remote signing keys, and token expiry. Use the verified `sub` and email as audit fields. With Workers Static Assets, Cloudflare documents that the router does not pass `ctx.access` to the user Worker, so use JWT validation for this architecture.
- Require a same-origin request and JSON body for mutations. Keep personal data out of request logs, disable caching on authenticated API responses, and return a sign-in prompt if the session has expired. Test auth using real Access in staging. Use synthetic identities with local test fixtures only.
- Use a seven-day global login and a 24-hour application session, with the policy inheriting the application duration. Aim for approximately weekly email-code entry and verify actual renewal behavior in staging; this is not a strict seven-day reauthentication deadline. Show the verified parent email and an explicit Sign out action, clearing in-memory personalized state when signing out through Cloudflare Access.
- A Cloudflare administrator handles lost-phone recovery and parent removal by removing an approved email when necessary and revoking existing sessions; email removal alone is insufficient. Secure the mailbox/device after a loss. For removal acceptance, an already signed-in device must be denied new protected requests within 60 seconds after both administrator actions complete. Measure this in staging and revisit recovery if it fails; this target is not a Cloudflare guarantee and does not erase already displayed information. See the [auth design](docs/auth-design.md) for the interview decisions and delivery boundary.
- **Accept when** both approved parents can use the same child’s data, an unapproved email cannot enter, unauthenticated direct links to UI/assets/API are challenged or denied, and the edit history distinguishes the two parents.

### F2. Child profiles

- Settings can create a profile with a display name or nickname and an optional list of initial templates. Suggested nickname limit is 1–60 trimmed characters. Create the child and initial assignments together so the first routine is available immediately. An empty list is valid and still permits one-off points. Choose all templates needed for day one in this form. Subsequent assignment edits begin tomorrow.
- Settings can rename the display name. The ID remains stable. The current name labels both current and historical screens.
- Recommended archive behavior is effective tomorrow. Starting on that date, remove the child from the default dashboard and stop new dates. Keep an **Archived children** list with access to prior dates, scores, and corrections.
- **Accept when** a new child has a zero total, initial assignments appear today, and renaming or archiving preserves prior entries.

### F3. Activity templates and scheduling

A template contains a name and an ordered list of activity definitions. Each activity has a label, a reward, an optional penalty magnitude, and scheduled weekdays. Default to all seven days. Use ISO weekdays `1` through `7` for Monday through Sunday. Omitting weekdays on creation defaults to all seven. A provided list must contain one or more distinct weekdays. Suggested limits are 80 characters per template or activity name and 30 activities per template.

- A new template’s first revision is effective today. It can be selected in a new child’s setup today. Assignment edits on an existing child are effective tomorrow.
- Save a complete immutable template revision when an existing template is edited. It is effective tomorrow. Preserve the activity ID when renaming, reordering, or changing points or weekdays. Allocate a new ID for a genuinely new activity.
- Use a stable template ID and a dated assignment set for each child. Assigning the same template twice is invalid. Reject assignment edits whose effective date is on or after the child’s archive date. Different templates may contain identically named activities. Display the template name next to those rows and score them separately.
- Removing an activity, unassigning a template, or retiring a template takes effect tomorrow. Retiring hides it from eligible assignments after its effective date. Existing assignments to a retired template produce no checklist rows from that date. A retired template remains available to resolve earlier dates.
- Show **Active today** and **Effective tomorrow** in the editor. If parents save several times on the same date, append revisions for the same effective date and use the highest revision number. When editing again, load the already-scheduled version so the editor preserves earlier changes to tomorrow’s rules.
- Name the exact effective date beside Save and report the actual date on success, including when midnight recovery changes it.
- **Accept when** two children can share a morning routine, a weekday-only chore disappears on Saturday, and revisions to name, penalty, weekday, or assignment leave an unopened past date reconstructible.

### F4. Daily checklist and scoring

1. Open a child and choose an activity date. The backend resolves the child’s assignment set on that date, then each assigned template revision on that date. Filter by weekday and sort by template order then activity order.
2. A scheduled item has one score stream identified by `child_id + activity_date + template_id + activity_id`. Join each item to the latest recorded revision of that stream.
3. Choose an outcome. Calculate the contribution on the server from the historical template revision. The UI can preview the amount.

| Selected outcome | Effective points | UI |
|---|---:|---|
| `done_correctly` | Historical reward | **Done correctly** |
| `needs_improvement` | Negative historical penalty, or zero if no penalty | **Needs improvement** |
| `unrecorded` or no entry | 0 | **Pending** today, **Unrecorded** on past dates |

- Allow resetting a recorded outcome to unrecorded to correct a mistaken tap. Append a revision with zero points. Future or unscheduled occurrences cannot be scored.
- Two labelled outcome buttons display their points and save on tap without confirmation. Show selected and saving states; recorded scores stay directly editable, with reset and history in expanded controls.
- Return the saved revision and refresh the day and dashboard from the server. Use the same action key when retrying an uncertain save. If another parent already changed the row, show the new outcome and let the parent choose again.
- **Accept when** each activity has one effective outcome, a retry produces one score, and changing `+5` to `−2` changes the day by `−7` while retaining both revisions.

### F5. One-off awards and deductions

- On the child’s day screen, choose **Add points** or **Deduct points**, enter a positive magnitude and a required reason, and confirm an explicit child, activity date, and signed amount summary. Suggested reason limit is 160 trimmed characters.
- Each entry has its own ID and contributes independently. Two intentional awards with identical text can both count. A retry of a single award counts once.
- A parent can correct the reason or signed amount of an active entry. To remove an accidental entry, choose **Void entry** and confirm. Voiding is final for that entry. The voided revision contributes zero and remains visible in history. To fix the wrong child or date, void the original and create an entry for the correct child and date.
- **Accept when** `+5` and `−2` appear as two rows with a net of `+3`, and voiding the deduction changes the net to `+5` while preserving the original reason and amount in history.

### F6. Daily history and audit trail

- The day screen opens on today. Previous/next arrows and a date picker support navigation from the child’s start date through today or the last active date, whichever is earlier.
- Show a prominent past-date editing label. Crossing midnight preserves the selected activity date and offers **Go to today**. An archived child opened from Settings starts on its last active date.
- Include the resolved checklist, one-off entries, net points, and status counts. Allow expanding a recorded item to view its revisions with outcome or amount, reason where applicable, acting parent, and change time displayed in Jakarta time.
- Keep activity date and time recorded distinct. A Tuesday correction of Monday’s entry affects Monday only and shows Tuesday as the audit timestamp. Voided one-offs are labelled and excluded from the net.
- **Accept when** two parents can see who changed an entry, a past day that had never been opened shows the right checklist, and the screen distinguishes zero-point recorded outcomes from unrecorded rows.

### F7. Mobile dashboard

| Screen | Contents and primary action |
|---|---|
| **Home** | Jakarta date and one card per active child. Each card shows running total, today’s net points, and pending activity count. Tap to open today. |
| **Child day** | Compact native child dropdown, date picker, net points, activity list grouped by template, one-off entries, and an obvious **Add entry** action. Recorded items expose corrections and history. |
| **Settings** | Children, templates, assignments, and archived children. Distinguish today’s rules from scheduled changes. |

- For an empty household, show **Add child** and a path to **Create template**. For a day without scheduled activities, show the empty state and keep one-off entry available. Show saving, success, retry, and stale-edit states beside the relevant control.
- Use English labels. Child switching preserves the selected activity date, clamped to the destination child's eligible dates. Archived children remain accessible through Settings and identified while viewing history, outside the active-child list. Support checklists longer than three activities; the prototype's eight activities and four active children are demonstration sizes, not product limits.
- An uncertain write shows **Save not confirmed** and **Check / retry**, retains the original action ID and submitted intent, and blocks another edit to that entry until reconciliation. A stale edit compares the current and attempted results, offering **Keep current** or explicit **Apply my change** against the freshly loaded revision; never overwrite automatically. A confirmed stale edit followed by Apply my change is a new intent, whereas an uncertain retry keeps its original action ID.
- These interactions follow the [approved #4 resolution](https://github.com/nurcahyopujo/daily-stars/issues/4#issuecomment-6729949930) and [Review v5 reference](https://github.com/nurcahyopujo/daily-stars/blob/8c6456a85fdcc220db99d0deb9b9c4be43d64801/prototypes/phone-flow.html). Implement them in production modules; do not merge the disposable prototype. Application launch remains Home.
- Today’s net is the sum of latest effective entries with today’s date. The running total sums all dates. Pending count is today’s scheduled items whose effective outcome is unrecorded. Display signed values and labels as text as well as color.
- **Accept when** a backdated change updates the running total and its own date without changing today’s net, and two children’s points remain separate even with shared templates.

### F8. PWA and phone experience

- Serve the manifest, 192×192 and 512×512 icons, a maskable icon, and an Apple touch icon. Include `id`, `name`, `short_name`, `start_url`, `scope`, `display: standalone`, and theme/background colors. Use a same-origin manifest request with credentials if Access protects the manifest. Confirm the installed icon and label on-device.
- Use HTTPS in staging and production. Provide install instructions for iPhone Safari and Android Chrome. Test the installed app’s initial Access sign-in and sign-in after session expiry.
- Use a network-only v1 without a service worker or persistent query cache. An app already open when the connection drops shows a connection message and keeps drafts and action IDs only in memory. A failed launch while offline may show the browser’s offline screen. Keep authenticated responses and children’s records out of browser storage. On resume/reconnect, reconcile surviving uncertain actions and refetch current data; after a full relaunch, refetch committed state rather than recreating a lost intent automatically.
- **Accept when** the installed app can open, authenticate, display a checklist, and save a score on both phones. Reopening after a network failure preserves correctness even if a write reached the server just before the disconnect.

## 4. Data model and invariants

Use UUIDs for application IDs, integer revisions starting at 1, and foreign keys for durable references. In a single-family deployment, the D1 database is the household boundary. Store small versioned configuration lists as validated JSON within immutable SQL rows. Keep point events relational so dashboard queries can group and sum them directly.

| Table | Main fields and constraints |
|---|---|
| `children` | `id` PK, `display_name`, `start_date`, nullable `archive_effective_date`, `revision`, `created_at`. Archive must be after start. |
| `templates` | `id` PK, `created_at`. |
| `template_versions` | `template_id` FK, `revision`, `effective_date`, `name`, `retired`, `activities_json`, audit fields. PK on template and revision. Index on template, effective date, revision. |
| `assignment_versions` | `child_id` FK, `revision`, `effective_date`, ordered `template_ids_json`, audit fields. PK on child and revision. Index on child, effective date, revision. Create version 1 even if assignments are empty. Validate template IDs before storing the list. |
| `daily_score_revisions` | `child_id`, `activity_date`, `template_id`, `activity_id`, `revision`, `template_revision`, `outcome`, `points`, audit fields. PK on child, date, template, activity, revision. Reference the exact template revision. |
| `one_off_entries` | `id` PK, `child_id` FK, `activity_date`. Child and activity date stay fixed. Index on child and date. |
| `one_off_revisions` | `entry_id` FK, `revision`, `reason`, `points`, `voided`, audit fields. PK on entry and revision. |
| `mutation_receipts` | `actor_id` and `action_id` as composite PK, fingerprint of method, route and validated input, original success status and result, created time. A receipt and its write commit together. |

Audit fields are `actor_id`, `actor_email`, and `recorded_at_utc`. Store the signed contribution alongside the daily outcome, with zero on reset. Store zero on a voided one-off and retain the previous revision’s amount. Enforce enum and integer bounds with D1 constraints where practical and validate input at the Worker boundary.

**Resolve a checklist.** Pick the row with greatest `effective_date <= activity_date`, breaking ties with greatest `revision`. Apply this once for the child’s assignments and once per template. Skip a retired template. Join the result to the latest scoring revision per occurrence. Use a single query or a D1 read batch for data that must agree within one dashboard or day response.

**Calculate totals.** Select the highest revision for each scheduled score stream and each one-off entry before summing points. In SQL, this can be a view using `ROW_NUMBER()` partitioned by stream key and ordered by revision descending. Combine current contributions with `UNION ALL`, group by child and date, and use zero for an empty sum. No nightly job or stored running balance is needed.

**Handle concurrent writes and retries.**

1. Generate one client action ID per user intent. Reuse it after a timeout or an ambiguous network error.
2. On receipt of a mutation, verify identity and validate the request. If the receipt already exists and the fingerprint matches, return the original success response. If the action ID was reused with different input, return a conflict.
3. Compare the submitted `expectedRevision` to the latest committed revision. Zero denotes a daily occurrence with no previous score. A new one-off gets a new ID. Build the proposed revision as current + 1.
4. Commit the new data and receipt in one D1 batch. Enforce the expected revision inside the write. For append-only streams, use the unique next revision key to make a concurrent append fail. For guarded updates to a mutable row, a zero-row update must abort the batch before the receipt can commit. Do not rely on a check performed before the batch alone. For scheduled rule saves, enforce the date guard and retry rules below inside the same transaction.
5. If the write conflicts, check for a matching receipt again to distinguish an exact retry from a competing action. For a genuine stale edit, return `409` with the current revision and let the parent review it. Replays can return an older success receipt, so refresh current data after every acknowledged save.

**Scheduled rule acceptance at midnight.** Approved in [issue #6](https://github.com/nurcahyopujo/daily-stars/issues/6); rationale is in [ADR 0001](docs/adr/0001-scheduled-rule-acceptance.md). This explicitly replaces the original physical commit-time midnight requirement.

- Acceptance occurs at the final database date-guard evaluation, conditional on the transaction committing successfully. The effective date is the following Jakarta calendar day. A guard that passes just before midnight may commit afterward with that same effective date.
- Bind the attempt's Jakarta day boundaries and effective date together. The final guard must check database time against the half-open interval from that day's start up to, but excluding, the next day's start. Exact midnight belongs to the new day. A stale attempt must roll back both the edit and its receipt.
- Following an ambiguous outcome or conflict, check for a matching success receipt before deciding whether to retry or report a stale edit. A matching receipt returns the original result and effective date, including after midnight. Server-derived dates, generated IDs, and audit timestamps must not change the fingerprint of the submitted intent.
- With no matching success receipt, a confirmed date-guard rollback, and an unchanged expected revision, recompute server-derived dates and allow one automatic midnight retry per request. Preserve the action ID and submitted input. Enforce revision and date guards again on that retry. If it still cannot complete, retain the action ID and offer Retry. A changed revision returns `409` and requires the parent to review the latest rules.
- An uncertain outcome retains the action ID for receipt recovery; it must not be treated as a confirmed rollback or assigned a new action ID. A manual retry uses the same action ID and first checks for the original result.
- Success displays the actual effective date explicitly, such as **Starts November 11**. A retry that shifts the date requires no additional confirmation. Scores retain their explicitly selected activity date.

**Clock verification gate.** D1 SQL clock freshness, advancement between batch statements, and alignment with the Worker's Jakarta boundaries remain unverified assumptions. Before passing milestone 3, focused local and isolated staging checks must establish the guard's behavior, including before/exactly at/after midnight, a request delayed before database execution, and rollback of both edit and receipt on guard failure. Mocked clock tests alone do not establish staging SQL-clock behavior. If the clock cannot support this guarantee, stop at that checkpoint and reopen the decision. Guard implementation and runtime proof are separate from the product decision in #6.

## 5. API contract

All paths below begin with `/api`. Use JSON, same-origin credentials, and `Cache-Control: no-store` on authenticated API responses. Require an `Idempotency-Key` header on mutations. IDs in request paths are stable IDs, and `date` is always the selected Jakarta activity date.

| Method and path | Request | Successful response |
|---|---|---|
| `GET /me` | — | Parent email, Jakarta date, timezone |
| `GET /dashboard` | — | `today` and active child cards containing ID, name, total points, today’s net and pending count |
| `GET /children` | Optional `includeArchived=true` | Child list with start date, archive date, and revision |
| `POST /children` | `displayName, initialTemplateIds[]` | `201` with child ID, start date, and child revision |
| `PATCH /children/:childId` | `expectedRevision` and `displayName` and/or `archive: true` | Child ID, revision, and effective archive date if set |
| `GET /templates` | — | Template summaries, today’s version, pending version metadata |
| `GET /templates/:templateId` | — | Full today and next scheduled definitions with latest revision |
| `POST /templates` | `name, activities[]` | `201` with template ID, revision, effective date |
| `PUT /templates/:templateId` | `expectedRevision, name, activities[], retired` | Template ID, revision, effective date |
| `GET /children/:childId/assignments` | — | Today’s and next scheduled template IDs, latest revision |
| `PUT /children/:childId/assignments` | `expectedRevision, templateIds[]` | Child ID, assignment revision, effective date |
| `GET /children/:childId/days/:date` | — | Day summary, checklist and one-offs |
| `PUT /children/:childId/days/:date/activities/:templateId/:activityId` | `expectedRevision, outcome` | Occurrence identifiers, revision, outcome, points |
| `GET /children/:childId/days/:date/activities/:templateId/:activityId/history` | — | Score revisions newest first |
| `POST /children/:childId/days/:date/one-offs` | `reason, points` | `201` with entry ID, child/date, revision, reason, points |
| `PATCH /children/:childId/days/:date/one-offs/:entryId` | `expectedRevision` and either revised `reason, points` or `void: true` | Entry ID, revision, reason, points, voided flag |
| `GET /children/:childId/days/:date/one-offs/:entryId/history` | — | One-off revisions newest first |

- An activity input contains `id` for a retained activity, `label`, `rewardPoints`, optional `penaltyPoints`, and `weekdays[]`. Array order is display order. The server generates IDs for new activities and rejects unknown or duplicate IDs within the edited template.
- The day response contains `childId, date, today, netPoints, pendingCount, activities[], oneOffs[]`. Use `pendingCount: 0` on past days and show any unrecorded items individually. Each activity returns template and activity IDs and labels, historical reward and penalty, outcome, points, and score revision. Each one-off returns ID, reason, points, void status, and revision.
- History rows contain revision, outcome or reason and void status, points, parent identity, and recorded timestamp. All item routes verify that the item belongs to the supplied child and date.
- The API calculates points for scheduled outcomes. A client-supplied point value on a scheduled score request is invalid.

Example daily-score request body for the first recorded outcome:

```json
{
  "expectedRevision": 0,
  "outcome": "done_correctly"
}
```

Example error shape:

```json
{
  "error": {
    "code": "STALE_REVISION",
    "message": "This entry changed. Reload it before saving.",
    "currentRevision": 2
  }
}
```

Use `400` for malformed JSON, `401` for missing or invalid authentication in the Worker, `403` for disallowed requests, `404` for missing resources or unscheduled occurrences, `409` for stale revisions or mismatched idempotency keys, and `422` for invalid fields or dates. A Cloudflare Access challenge may precede the API. The frontend should detect unexpected authentication redirects or non-JSON responses and offer to reopen the app to sign in.

## 6. Build order with stopping points

Work one milestone at a time. Start the next one when its predecessor’s checkpoint passes. Use synthetic child names and dates until launch.

| Milestone | Build in this order | Checkpoint |
|---|---|---|
| **1. Local skeleton** | Initialize a TypeScript Worker and mobile frontend. Serve built assets and register the `/api/*` Worker routes with `run_worker_first`. Add local D1, the first migration, a synthetic fixture, and a local health endpoint or smoke test. | A phone-sized browser view loads the shell. An API request reaches Worker code, and a local database query succeeds. An unknown API route returns JSON 404. |
| **2. Staging access** | Create a separate staging Worker and D1 database. Configure Cloudflare Access, One-time PIN, and the F1 session durations. Implement JWT checks, `GET /me`, and a minimal signed-in screen with sign-out and deliberate sign-in recovery. Configure `TEAM_DOMAIN` and `POLICY_AUD` for that Access application. | Both approved identities can sign in. An unapproved identity cannot. Direct URLs to UI, assets, and API are challenged or denied when signed out. Sign-out and expired-session recovery work. An existing session is denied within the F1 removal/revocation target. |
| **3. Profiles and rules** | Add children, template revisions, and assignment revisions. Implement the Jakarta clock and a date-based checklist resolver. Add the mutation receipt mechanism and minimal Settings forms. Build a read-only child day screen. | A shared routine appears for both children. An existing template change applies tomorrow. A past day that was never opened still resolves correctly. Local/staging clock and atomic rollback evidence passes the section 4 gate. |
| **4. Scheduled scoring** | Add score revisions and outcome controls. Reuse the mutation receipt mechanism. Implement point calculation, reset, stale-edit handling, and day totals. | Correcting a `+5` score to `−2` gives a `−2` net for that row and keeps both revisions. A repeated request and competing edits pass the concurrency tests below. |
| **5. One-offs and history** | Add one-off creation, correction and voiding. Add date navigation and history views. | Add `+4`, retry once, and see one entry. Void it and see zero contribution with the prior entry in history. |
| **6. Dashboard** | Add running totals and pending counts. Wire up refresh after saves, return to Home, app resume, and Jakarta date rollover. Add empty, loading, and connection states. | Both children’s totals agree with their individual day screens. A backdated correction changes the running total and the selected day only. |
| **7. PWA** | Add manifest, icons, install help, and mobile layout polish. Test the staged home-screen app on iPhone Safari and Android Chrome. | From the installed icon, sign in, open a child, save an outcome, lose and regain connectivity, and reauthenticate when the Access session ends. |
| **8. Production launch** | Create production D1, apply migrations, deploy the Worker and assets, enable Access, and repeat the signed-out checks. Open the installed production app on both phones before entering family data. | Both parents can record points from the home screen. A fresh browser cannot read any family data. Record the production database name and recovery steps. |

For D1 migrations, first apply them locally with `wrangler d1 migrations apply DB --local`. For staging and production, select the intended Wrangler environment and use `--remote`. Keep staging and production bindings separate. Verify the database name before every remote migration. Before a later production schema change, record a recovery bookmark or export and check the recovery procedure in staging.

## 7. End-to-end verification

Use a fixture with two children, one shared template, and a weekday-only activity. Fix the clock in automated tests so date behavior is repeatable.

| Case | Scenario | Expected result |
|---|---|---|
| Same-day setup | Create a child on Monday with an existing morning template. | The checklist appears on Monday and starts at zero points. |
| Historical rule | Monday’s reward is `+5`. Edit the reward on Tuesday to `+10`. Open Monday for the first time and score it on Tuesday. | Monday gets `+5`. Tuesday still uses `+5`. Wednesday uses `+10`. |
| Pending revision | Two edits are saved on Tuesday, first changing the reward and then the activity label. | Wednesday shows both edits. Tuesday’s definition stays the same. |
| Weekday filter | A Monday–Friday activity is assigned all week. | It appears on Friday and is absent on Saturday. |
| Unassignment | Remove a template assignment on Friday. | Friday stays editable. The following Monday omits the unassigned template. |
| No penalty | Score an activity with no penalty as needs improvement. | Zero points, a recorded outcome, and one fewer pending activity today. |
| Late correction | Monday initially earned `+5`. Change it to needs improvement with a `−2` penalty on Tuesday. | Monday’s contribution becomes `−2`. Tuesday’s net stays the same. The running total drops by seven. |
| Retry | Submit a `+4` one-off twice with the same action key and body. | Same entry ID, one contribution of `+4`. Reusing the key with a different amount returns `409`. |
| Concurrent edits | Parents A and B submit different outcomes for the same occurrence using revision 1. | One creates revision 2. The other gets `409` and sees the updated row after reload. |
| Void | Void a `−4` one-off. | Its contribution becomes zero. The original amount and reason remain in history. |
| Negative balance | A child has total `1`. Deduct `3`. | The balance is `−2`. |
| Archive | Archive a child on Tuesday. | The child leaves the default dashboard Wednesday. Parents can still correct Tuesday and earlier eligible dates. |
| Rule save at midnight | A schedule edit starts just before Jakarta midnight and its first write attempt happens after midnight. | The stale write aborts. Recompute and report the effective date from the new Jakarta day. |
| Commit after midnight | A routine reward changes from `+5` to `+10`; the final date guard passes just before November 10 midnight in Jakarta, and commit finishes on November 11. | The save is accepted on November 10 and reports **Starts November 11**. November 10 retains `+5`; November 11 uses `+10`. |
| Exact-midnight guard | An attempt calculated on November 10 reaches the final guard exactly at November 11 midnight in Jakarta. | Both edit and receipt roll back. With unchanged revision and no success receipt, retry once with the same action ID and input; successful acceptance on November 11 reports **Starts November 12**. |
| Scheduled save response lost | A scheduled save succeeds, but its response is lost; the same action is retried after midnight. | Return the original receipt and effective date without another revision, then refresh current data. |
| Midnight recovery conflict | A date-guard attempt rolls back; before recovery, another parent changes the same rules. No matching success receipt exists. | Return `409` for the changed revision and require review; the midnight retry must not overwrite it. |
| Midnight retry exhausted or uncertain | The one automatic midnight retry cannot complete, or receipt recovery cannot establish the outcome. | Retain the action ID and offer Retry; do not claim success, assume rollback for an uncertain outcome, or create another intent. |
| Day rollover | Keep the app open across midnight in Jakarta and resume it. | Home loads the new date. An already open form retains its explicit activity date. |
| Mobile install | Sign in, install, then reopen after the Access session expires. | Each phone can authenticate again and save a score. The two parents see the same persisted result. |

### Launch exit criteria

- All verification cases pass locally or in staging, as appropriate.
- The production deployment challenges signed-out requests to the app shell, protected assets, direct API URLs, and any enabled preview URLs.
- Both parents complete the install → sign in → score → see updated total flow.
- The production recovery process is documented and has been rehearsed against staging data.

## 8. Implementation references

- [Cloudflare Workers Static Assets and routing configuration](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare Access for Workers and the Static Assets identity limitation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#ctxaccess-limitations)
- [Cloudflare Access one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [D1 binding and setup](https://developers.cloudflare.com/d1/get-started/)
- [D1 batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Wrangler D1 migrations](https://developers.cloudflare.com/workers/wrangler/commands/d1/#d1-migrations-apply)
- [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/)
- [MDN guide to PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

## 9. Implementation handoff approved in issue #5

The parent accepted all sixteen recommendations and confirmed shared understanding before this handoff was recorded. This section settles design and verification; it does not claim application code, runtime probes, deployment, or device checks have been completed. Preserve the eight milestones and [ADR 0001](docs/adr/0001-scheduled-rule-acceptance.md). These reversible tooling and module choices do not warrant another ADR; no new domain term is needed in the glossary.

### Toolchain and module responsibilities

Use React, TypeScript and Vite for the small SPA, npm with a committed lockfile, project-local Wrangler for Worker/D1 development and deployment, Vitest for rules and Workers tests, and Playwright for browser flows. Use the current Cloudflare Vitest integration (`@cloudflare/vitest-plugin`); select and lock compatible stable versions and a supported Node release when scaffolding, rather than copying unverified version pins into this design. GitHub Actions runs checks on pull requests.

| Module | Interface and responsibility | Verification |
|---|---|---|
| Domain rules | Plain TypeScript functions accept dated assignment/template definitions, outcomes and explicit date/clock inputs, and return checklist rows or calculated point contributions. No UI, HTTP or D1 dependency. | Deterministic tests of the same functions used by the application: historical revisions, weekday filtering, ordering, zero/reset outcomes and Jakarta calendar boundaries. |
| Application operations | A small interface such as get child day or record outcome owns orchestration, historical rule resolution and mutation coordination. Return calculated checklist rows/totals or explicit success/conflict/uncertain results. | Exercise operations through their interface using the real D1 implementation for storage-dependent behavior. |
| D1 storage and mutation implementation | Prepared SQL owns queries, migrations, transaction batches, eligibility/revision/date guards and atomic data-plus-receipt writes. Application operations delegate the atomic mutation protocol here; handlers never assemble transaction steps. | Real local D1 initialized from checked-in migrations; critical behavior repeated in isolated staging. |
| HTTP handlers | Verify identity and request origin, validate input and route ownership, call application operations, and format the section 5 responses. | Worker HTTP checks, including authentication rejection, validation, JSON errors and production-build smoke checks. |
| Frontend requests and save state | One module owns requests, memory-only action IDs, submitted intent and save/recovery states. Screens render server-confirmed results and the F7 recovery controls. Refetch after acknowledged saves, including receipt replays. | Browser flows with injected response loss, stale results, reconnect and resume. |

Keep the pure rule seam and the real variation in clocks/authentication/transport explicit. Start without an ORM or generic repository abstraction. Use direct prepared SQL inside storage and keep transaction details hidden from callers. A mutation's time, revision and receipt checks must remain in the atomic protocol; pre-read validation alone is insufficient. Bind one response's today consistently and use one query or a read batch for dashboard/day data that must agree. Receipt recovery uses primary reads, fingerprints omit server-generated values, and receipts must not silently expire during the MVP retry lifetime. See the [D1 findings and candidate protocol](docs/research/d1-mutations.md); candidate guard SQL still requires runtime proof.

The storage implementation owns one checked-in directory of numbered D1 migrations. Production and tests apply those same migrations; tests must not maintain a parallel schema. Keep synthetic fixtures in a separate repeatable seed operation for local/staging only, outside production migrations. The baseline has two children, a shared template and a weekday-only activity; additional synthetic cases can demonstrate longer checklists and child switching. Reset data between cases. Never seed family or real parent data into tests.

### Verification matrix and evidence

| Surface | Required checks | Gate |
|---|---|---|
| Pure rules | Historical unopened dates, highest same-effective-date revision, assignment/template retirement, weekdays, rewards/penalties, recorded zero versus unrecorded, reset and date arithmetic. | Automated tests with fixed explicit clocks as each behavior is added. |
| Real local D1 | Two different actions competing on one revision; missing stream with expected revision zero; stale and ahead-of-current revisions; simultaneous identical action retries; changed input with reused key; response loss after commit; zero-row guarded update; rollback after earlier setup writes; void-versus-correction; consistent day/dashboard reads. | Relevant milestone checkpoint; inspect both responses and persisted revisions/receipts, including absence after rollback. |
| Isolated staging D1 | Repeat critical atomicity/retry/concurrency cases. Establish SQL clock freshness, advancement between statements, alignment with Jakarta, before/exactly-at/after-midnight guards, delayed database execution and edit-plus-receipt rollback. | Clock and guard proof before passing milestone 3; later scoring/one-off checks at their milestones. Stop and reopen the decision if the guarantee is disproved or cannot be established. |
| Production build and HTTP | Built frontend loads; actual Worker routes reach application code; unknown API routes return JSON; deployed compatibility settings do not depend on test-only Node support. | Automated build/HTTP smoke gate alongside relevant tests. |
| Playwright Chromium and WebKit | Home/child switching, scoring/reset/history, one-offs/correction/void, historical dates, recorded zero, stale current/attempted comparison, uncertain saves, rollover, reconnect and server refresh. | Pull-request browser checks for implemented journeys, using synthetic local identities/data. |
| Protected staging and actual phones | Real Access policy/JWT checks, signed-out shell/assets/API/preview denial, both parent identities, rejected identity, protected manifest/icons, installation, standalone sign-in, session expiry and uncertain-save recovery. | Milestones 2 and 7, repeated in production at milestone 8. Both parents complete the installed-app flow. |
| Recovery | Verify selected environment/database, record recovery point, rehearse recovery using synthetic staging data and document observations. | Production launch; check the recovery procedure before later production schema changes. |

Concurrency tests must launch competing operations inside one controlled test against the same D1 database; separate isolated test files do not establish contention. Cloudflare's Vitest integration isolates storage per file, so reset data between test cases explicitly. Use controllable clocks and transport failure injection in tests without adding public production bypasses. Mocked time proves decision logic only; staging SQL-clock evidence must establish actual runtime behavior. Browser WebKit does not replace the installed iPhone test, and local synthetic identities do not establish real Access behavior.

For local/staging database probes, record Wrangler version, compatibility date/flags, schema/migration version, exact binding calls, timing method, results/errors and persisted rows. Distinguish simulated boundaries from observed runtime clock evidence; a few successful writes cannot prove the clock guarantee. Keep evidence with the milestone checks, using synthetic data. The [D1 research](docs/research/d1-mutations.md) and [Access/PWA research](docs/research/access-pwa.md) specify the underlying evidence limits; neither research document records completed runtime acceptance.

### Environments, delivery and recovery

Local development, staging and production each use their own D1 database. Staging and production use explicit Worker/Access configuration and environment-specific bindings; keep credentials out of source control. Synthetic seeds are restricted to local/staging. Before every remote migration, verify the actual target database identity and select the intended environment explicitly. Apply migrations locally first.

GitHub Actions uses the lockfile to install dependencies and runs TypeScript checks, relevant rule/database tests, a production build/HTTP smoke check and browser checks on pull requests. Add checks as their milestone behavior becomes available; do not invent passing placeholders for unimplemented launch gates. Staging/production deployments and remote migrations remain explicitly triggered. Advance milestones only after their checkpoints pass; automated checks do not substitute for staging or phone acceptance.

Keep a deployment/recovery runbook in the repository, completed and rehearsed before production launch. Record environment/database identifiers, migration procedure, deployment checks, recovery bookmark/export procedure, restoration steps and staging rehearsal evidence. Before later production schema changes, record a recovery point and check the recovery procedure. Routine schema evolution uses forward migrations. A failed deployment requires a reviewed corrective migration or the rehearsed database recovery procedure; never roll back the production database automatically. Make the potential loss of entries newer than a recovery point explicit before an operator restores it.

### Supporting tooling documentation

- [Vite React/TypeScript starter](https://vite.dev/guide/) and [Cloudflare Vite integration](https://developers.cloudflare.com/workers/vite-plugin/).
- [Project-local Wrangler and supported Node versions](https://developers.cloudflare.com/workers/wrangler/install-and-update/).
- [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/), [migration configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/), and [storage isolation/concurrency](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/).
- [Workers production-build/HTTP testing](https://developers.cloudflare.com/workers/testing/).
- [Playwright browser support](https://playwright.dev/docs/browsers) and [GitHub Actions setup](https://playwright.dev/docs/ci).
