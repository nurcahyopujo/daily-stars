# D1 mutations, retries, and the Jakarta boundary

Research for [Establish D1 atomic writes, retries, and the Jakarta midnight guard](https://github.com/nurcahyopujo/daily-stars/issues/2), checked 2026-11-08 against the [baseline specification](https://github.com/nurcahyopujo/daily-stars/blob/23d1eef/mvp-spec.md). No application implementation or remote database experiment was performed. There are no existing ADRs in this checkout.

## Finding

D1 provides the transaction primitive needed for atomic data-plus-receipt writes. A constraint-backed assertion can convert a failed compare-and-swap (CAS) into batch failure. The concrete pattern below is a proposal requiring a small D1 runtime probe. The literal requirement that the Jakarta day remain unchanged **at physical commit time** cannot be established from the documented API; it needs a narrowly scoped specification decision before implementation.

## Source facts

- Cloudflare says `batch()` executes statements sequentially and treats the batch as a transaction: a failing statement aborts or rolls back the sequence. The page also documents session consistency, primary-first reads, and bookmarks. There is no application callback between batch statements. [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- D1 uses SQLite's query engine, with compatibility qualifications; SQLite behavior is a basis for candidates, not sufficient evidence of D1 runtime behavior by itself. [D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- A matching-row count of zero is a successful `UPDATE`, not an SQL error. Inspecting it after the batch cannot undo an already committed receipt. [SQLite UPDATE](https://www.sqlite.org/lang_update.html)
- SQLite `changes()` counts rows affected by the most recently completed insert/update/delete, excluding changes inside lower-level triggers. [SQLite scalar functions](https://www.sqlite.org/lang_corefunc.html#changes)
- A `CHECK` evaluating to zero fails; NULL passes, so an assertion column must also be `NOT NULL`. Constraints are evaluated on writes. [SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html#check_constraints)
- Default constraint handling is ABORT. SQLite ABORT alone backs out the statement, not preceding statements of its transaction; D1's batch rollback contract is therefore essential. Avoid IGNORE and REPLACE for concurrency/receipt keys. [SQLite conflict algorithms](https://www.sqlite.org/lang_conflict.html)
- SQLite readers normally see complete committed transactions, and writes are serialized. [SQLite isolation](https://www.sqlite.org/isolation.html)
- Without Sessions API, D1 queries use the primary. Replicas are asynchronous; sequential consistency within a session does not mean a fixed snapshot across separate queries. [D1 replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- SQLite obtains `now` from its VFS clock; repeated calls within one `sqlite3_step()` agree. This is not a documented commit timestamp. [SQLite time functions](https://www.sqlite.org/lang_datefunc.html)
- Cloudflare recommends retrying selected transient write errors with backoff and jitter; read-only queries can be retried automatically. This does not itself make application writes idempotent. [D1 retry guidance](https://developers.cloudflare.com/d1/best-practices/retry-queries/)

## Candidate write protocol — proposed, not runtime-proven

Use ordinary bound prepared statements in one `env.DB.batch([...])`; do not issue independent `.run()` calls as a transaction. Use plain primary binding reads initially. Authenticate and validate before looking up receipts, including route ownership and an immutable actor identity.

Canonicalize method, route identifiers, and validated client input, including `expectedRevision`, into the fingerprint. Exclude server-derived dates, generated IDs, and audit time: a retry after midnight must still find its original receipt. Keep receipts for the MVP's full retry lifetime; do not silently expire keys. Record the original status and complete JSON success result. Generate a new action ID only for a new user intent.

One possible receipt schema extension is an internal assertion column:

```sql
-- Alongside the specified receipt fields and NOT NULL composite key:
success_guard INTEGER NOT NULL CHECK (success_guard = 1)
```

Mutable child rename/archive example (named placeholders explain bindings; use the binding syntax supported by the chosen D1 client):

```sql
-- Statement 1
UPDATE children
SET display_name = :name,
    archive_effective_date = :archive_date,
    revision = revision + 1
WHERE id = :child AND revision = :expected;

-- Statement 2: immediately after statement 1; ALWAYS attempts one row.
INSERT INTO mutation_receipts
  (actor_id, action_id, fingerprint, status, result_json,
   created_at, success_guard)
VALUES
  (:actor, :action, :fingerprint, :status, :result_json,
   :audit_utc, CASE WHEN changes() = 1 THEN 1 ELSE 0 END);
```

On zero rows the receipt insert fails its constraint, forcing D1 to roll back the batch. Incrementing revision guarantees an actual change even for a rename to the current name. Construct the result from the same bound values (`expected + 1`, ID, effective date). Preserve existing archive/name values when a PATCH omits them. Include all eligibility predicates, not just revision, in the write or an assertion inside this transaction.

For an append-only stream, use its full stream key in both the primary key and the latest-revision predicate:

```sql
-- Schematic score insert; bind the remaining score/audit fields too.
INSERT INTO daily_score_revisions
  (child_id, activity_date, template_id, activity_id, revision,
   template_revision, outcome, points, actor_id, actor_email, recorded_at_utc)
SELECT :child, :date, :template, :activity, :expected + 1,
       :template_revision, :outcome, :points, :actor, :email, :audit_utc
WHERE :expected = COALESCE((
  SELECT MAX(revision) FROM daily_score_revisions
  WHERE child_id = :child AND activity_date = :date
    AND template_id = :template AND activity_id = :activity
), 0);
-- Follow immediately with the same changes() receipt assertion.
```

The unique next-revision key catches competing appends. The MAX predicate also rejects an expected revision ahead of the actual stream; uniqueness alone would permit gaps. Apply the pattern to template, assignment, and one-off revisions. One-off correction additionally checks that the latest revision is not voided and that the entry belongs to this child/date. Revalidate historical scoring rules and child eligibility inside the batch wherever concurrent changes can invalidate a pre-read.

For multi-row setup, assert each prerequisite immediately after its write, before another DML overwrites `changes()`. A separate small assertion table with `ok INTEGER NOT NULL CHECK(ok=1)`, followed by cleanup within the batch, is a candidate when more than the final receipt assertion is needed. No trigger-dependent counting. New-child creation, its initial assignment, and its receipt remain one batch.

### Recovery and conflicts

1. Read receipt by `(actor_id, action_id)` on the primary. Matching fingerprint returns original success, even if its revision is old. Different fingerprint returns 409.
2. If absent, attempt the guarded data-and-receipt batch. A competing identical retry may race this lookup; the unique receipt key must still fail the losing transaction.
3. On any ambiguous error or expected concurrency constraint failure, read the receipt again on the primary **before** returning stale-edit status. If it exists, apply the same fingerprint rule.
4. If no receipt, read current data. A changed revision is 409. A confirmed date guard failure with unchanged revision may rebuild server-derived values and retry the same action/fingerprint. A database/network failure is not automatically a stale revision: retry only classified transient failures with bounded jittered backoff; otherwise return a retryable failure and retain the client action ID.
5. If recovery reads themselves fail, keep the outcome uncertain. Never declare the save failed permanently, or allocate another one-off ID/action key. After any acknowledged save, refresh current data because replayed success may be older than another parent's edit.

## Jakarta midnight: three different instants

The Worker computes a request-attempt day `D` using `Asia/Jakarta`, with UTC start/end instants `[start(D), start(D+1))`. Bind tomorrow's effective date and these boundaries together. A bound Worker timestamp alone cannot detect time spent queued before D1 runs.

Candidate final receipt assertion for a scheduled change:

```sql
CASE WHEN changes() = 1
       AND unixepoch('now') >= :day_start_utc_seconds
       AND unixepoch('now') <  :next_day_start_utc_seconds
     THEN 1 ELSE 0 END
```

This checks **database statement evaluation time** and rolls back a stale attempt if the SQL clock has advanced beyond the bound day. Use integer-second boundaries; test the exact equality case. Derive boundaries from the named calendar rather than assuming SQL supports IANA zone names. D1's VFS clock freshness, relationship to the Worker clock, and whether time advances across statements of one batch remain runtime questions.

Even a final assertion can run just before midnight and commit just after it. No documented D1 commit hook or conditional commit clock closes that interval. A post-commit Worker clock check cannot roll back the write; compensating revisions change visible history and are not the same guarantee. A safety margin reduces likelihood but proves nothing without a documented upper bound on commit delay.

**Proposed amendment:** define a scheduled save's effective date relative to the Jakarta day checked by the final SQL assertion, rather than physical commit time. If its day differs from the Worker's attempt day, abort, recompute, and retry before success. Clearly describe the remaining clock assumption. Alternatively define acceptance at request receipt time and remove the SQL-clock requirement; this is a different product choice. If physical commit time is mandatory, block this invariant pending a database/platform guarantee; do not label it solved by a prototype. Activity dates chosen for scores stay explicit across retries.

## Consistent reads — proposed MVP default

Build each dashboard/day response with one SQL query (CTEs/window functions/JSON aggregation as convenient), or a read-only D1 batch containing all dependent selects. Bind one response `today` throughout. Resolve assignments, templates, latest score/one-off revisions, sums, and pending counts in that snapshot; separate awaited reads can mix states from competing saves. Do not derive dashboard totals from a cached response on the client.

Keep the MVP on the primary for receipt recovery and fresh page refreshes. If replication is later adopted, use a session/bookmark for read-your-writes across requests, primary-first for current conflict checks, and retain one-query/read-batch snapshots. Session sequential consistency alone does not make several queries a snapshot or force a second parent's device to have the latest bookmark.

## Verification still required

Cloudflare documents local D1 through Wrangler, using the same D1 version as its global service. Use a disposable local Worker binding harness and then repeat critical cases against isolated staging D1; a host SQLite script alone does not test D1 batch behavior. [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)

| Probe | Required observation |
| --- | --- |
| Zero-row child update then asserted receipt | Batch rejects; no child change and no receipt. Successful control commits both. |
| Failure after earlier successful setup writes | Every earlier write rolls back, including initial assignments and any guard rows. |
| `changes()` across batch statements | Counts the immediately preceding intended DML, including conditional insert zero/one cases; unrelated trigger work must not change the decision. |
| Two different actions at the same revision, repeated in parallel | Exactly one next revision and its receipt; loser gets current revision. Test missing stream (`expected=0`), old and future expected revisions. |
| Same action/body in parallel and response dropped after commit | Both recover the same stored response, one contribution; reuse with changed body returns 409 without another write. |
| Final assertion fails after revision insert | Neither revision nor receipt persists. Error handling distinguishes known guard failures from unrelated constraint failures. |
| Midnight boundaries | Injectable test clock: just before, exactly at, and after `2026-11-07T17:00:00Z`; hold request before batch until after boundary. Separate real staging SQL-clock probes from mocked logic. |
| Commit crosses boundary after final check | Record that this is outside the proposed statement-time guarantee; observing a few successes cannot prove impossibility of the race. |
| Concurrent writer during dashboard/day reads | Response components agree with one committed state; repeat for read batch versus one query. |
| Void and setup dependencies | Concurrent void/correction cannot resurrect a void; failing later setup step leaves no child or receipt. |

Capture Wrangler version, compatibility date, schema, exact binding calls, result/error objects, and persisted rows. Receipt constraints and SQL-clock behavior are implementation gates, not already observed results. Remaining decision: choose the midnight acceptance definition; remaining engineering evidence: the focused local/staging harness above.
