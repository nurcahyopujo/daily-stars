import { DatePicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { HistoryIcon } from "lucide-react";
import { BackLabel, backLinkClass } from './BackLink';
import { Link } from '@tanstack/react-router';
import { memo, useCallback, useRef, useState } from 'react';
import type { Child } from '../../../shared/profiles';
import type { Activity, Day, Score } from '../../../shared/scoring';
import { requestJson } from './requests';
import { useSaveFlow } from './save-flow';
import { useResource } from './use-resource';
import { sameEntries, withOutcome } from './score-day-model';
import { DayStars, Stars } from './StarBalance';
import { StreamHistory } from './StreamHistory';
import { OneOffEditor } from './OneOffEditor';

// One day-outcome save per child at a time, keyed so saves for different children
// coexist. The date rides along for recovery (which day the pending save belongs to).
type ScoreIntent = { method: string; path: string; body: Record<string, unknown>; date: string };

const NO_ENTRIES: Score[] = [];

type RowProps = {
  activity: Activity;
  score: Score | undefined;
  historyEntries: Score[];
  isToday: boolean;
  animate: boolean;
  starsKey: string;
  onRecord: (activity: Activity, outcome: string, revision: number) => void;
};

// One activity's row. Memoised so a tap on another activity — or any unrelated
// state change (busy, pending, flash on a sibling) — leaves this row untouched.
// The custom comparator leans on referentially stable props: `score` and the
// history entries keep the same object identities for rows that didn't change.
const ActivityRow = memo(function ActivityRow({
  activity: a,
  score: r,
  historyEntries,
  isToday,
  animate,
  starsKey,
  onRecord,
}: RowProps) {
  const recorded = r && r.outcome !== 'unrecorded';
  const statusTone = !recorded ? 'is-pending' : r!.outcome === 'done_correctly' ? 'is-done' : 'is-needs';
  return (
    <article className="scoring-day-entry">
      <div className="scoring-day-entry-head">
        <h3>{a.label}</h3>
        <span className="scoring-day-tag">{a.template}</span>
      </div>
      <p className={`scoring-day-status ${statusTone}`}>
        {!recorded ? (
          isToday ? 'Pending' : 'Unrecorded'
        ) : (
          <>
            <Stars small value={r!.points} animate={animate} key={starsKey} />{' '}
            ·{' '}
            {r!.outcome === 'done_correctly' ? 'Done correctly' : 'Needs improvement'}
          </>
        )}
      </p>
      <div className="score-actions scoring-day-outcomes">
        {(
          [
            ['done_correctly', 'Done correctly', a.reward],
            ['needs_improvement', 'Needs improvement', -(a.penalty ?? 0)],
          ] as const
        ).map(([outcome, label, amount]) => (
          <Button
            key={outcome}
            aria-pressed={r?.outcome === outcome}
            onClick={() => onRecord(a, outcome, r?.revision ?? 0)}
          >
            {label} ({Number(amount) > 0 ? '+' : ''}
            {amount})
          </Button>
        ))}
        {r && r.outcome !== 'unrecorded' && (
          <Button onClick={() => onRecord(a, 'unrecorded', r.revision)}>Reset</Button>
        )}
      </div>
      <StreamHistory entries={historyEntries} />
    </article>
  );
}, (prev, next) =>
  prev.activity === next.activity &&
  prev.score === next.score &&
  prev.isToday === next.isToday &&
  prev.animate === next.animate &&
  prev.starsKey === next.starsKey &&
  prev.onRecord === next.onRecord &&
  sameEntries(prev.historyEntries, next.historyEntries),
);

export function ScoreDay({ child, today, date: selectedDate, onDateChange }: {
  child: Child; today: string; date?: string; onDateChange: (date: string) => void;
}) {
  const last =
    child.archiveEffectiveDate && child.archiveEffectiveDate <= today
      ? new Date(Date.parse(child.archiveEffectiveDate + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
      : today;
  const flow = useSaveFlow<ScoreIntent, void, Score, Day>({
    key: 'score:' + child.id,
    request: async (intent, action) => {
      await requestJson(intent.path, {
        method: intent.method,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': action },
        body: JSON.stringify(intent.body),
      });
    },
    // Apply my change over a conflict: resubmit the entry at the server's revision.
    applyConflict: (intent, current) => ({ ...intent, body: { ...intent.body, expectedRevision: current.revision } }),
  });
  const resumedDate = flow.phase === 'saving' || flow.phase === 'recover' ? flow.intent?.date : undefined;
  const [date, setDate] = useState(
    resumedDate ?? (selectedDate && selectedDate >= child.startDate && selectedDate <= last ? selectedDate : last),
  );
  const path = '/api/children/' + encodeURIComponent(child.id) + '/days/' + date;
  const [error, setError] = useState(
    flow.phase === 'recover' ? 'Check the submitted score before continuing.' : '',
  );
  const day = useResource<Day>(path, { onError: () => setError('Could not load the day.') });
  const [busy, setBusy] = useState(false);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  // Pending recovery and conflict are read straight from the Save flow's phase.
  const pending = flow.phase === 'recover';
  const conflict = flow.phase === 'conflict' ? flow.intent ?? null : null;
  // Marks the activity whose stars just changed, so only its row replays the
  // award animation (a fresh `n` re-keys the stars to retrigger on each tap).
  const [flash, setFlash] = useState<{ stream: string; n: number } | null>(null);
  const flashSeq = useRef(0);

  // The Save flow owns the settle: success and conflict reconcile to the server's
  // truth (success returns the fresh day so the changed entry can flash), rejection
  // rolls back the optimistic guess, and recovery keeps the view with the retry key.
  // A conflict closes the one-off editor (via its `conflict` prop) so the prompt shows.
  const settleError = useCallback((outcome: Awaited<ReturnType<typeof flow.run>>) => {
    if (outcome.phase === 'success') flow.dismiss();
    else if (outcome.phase === 'rejected') setError(outcome.message);
    else if (outcome.phase === 'recover') setError('Save not confirmed. Keep this page open and retry.');
    // Uses only stable setState dispatchers and the stable flow.dismiss.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const send = useCallback(async (intent: ScoreIntent, optimistic?: (prev: Day) => Day): Promise<Day | null> => {
    setBusy(true);
    setError('');
    const outcome = await flow.run(intent, {
      optimistic: optimistic
        ? () => {
            let snapshot: Day | null = null;
            day.mutate((prev) => { snapshot = prev; return prev ? optimistic(prev) : prev; });
            return () => day.mutate(() => snapshot);
          }
        : undefined,
      reconcile: () => day.reconcile(),
    });
    setBusy(false);
    settleError(outcome);
    return outcome.phase === 'success' ? outcome.data : null;
  }, [flow.run, day.mutate, day.reconcile, settleError]);
  // Recover an uncertain save: replay it with its original idempotency key.
  const recheck = useCallback(() => {
    setBusy(true);
    setError('');
    void flow.retry({ reconcile: () => day.reconcile() }).then(settleError).finally(() => setBusy(false));
  }, [flow.retry, day.reconcile, settleError]);
  const save = useCallback((
    method: string,
    stream: string,
    body: Record<string, unknown>,
    optimistic?: (prev: Day) => Day,
  ): Promise<Day | null> => {
    return send({ method, path: path + '/' + stream, body, date }, optimistic);
  }, [send, path, date]);
  // Record an activity outcome: flash that row's stars, then save optimistically.
  const onRecord = useCallback((activity: Activity, outcome: string, revision: number) => {
    setFlash({ stream: activity.stream, n: ++flashSeq.current });
    void save('PUT', activity.stream, { expectedRevision: revision, outcome }, (prev) =>
      withOutcome(prev, activity, outcome),
    );
  }, [save]);

  const latest = new Map<string, Score>();
  const historyByStream = new Map<string, Score[]>();
  for (const row of day.data?.history ?? []) {
    if ((latest.get(row.stream)?.revision ?? 0) < row.revision) latest.set(row.stream, row);
    const entries = historyByStream.get(row.stream);
    if (entries) entries.push(row);
    else historyByStream.set(row.stream, [row]);
  }
  const current = conflict && latest.get(conflict.path.slice(path.length + 1));
  return (
    <section className="child-profiles score-day scoring-day">
      {!pending && <Link className={backLinkClass} to="/"><BackLabel>All children</BackLabel></Link>}
      <header className="scoring-day-head">
        <h1>{child.displayName}</h1>
        {!pending && (
          <nav className="scoring-day-links" aria-label="Child pages">
            <Link to="/children/$childId/prizes" params={{ childId: child.id }}>Prizes</Link>
            <Link to="/children/$childId/assignments" params={{ childId: child.id }}>Assignments</Link>
            {!oneOffOpen && !conflict && <Link to="/children/$childId/review" params={{ childId: child.id }} search={{ date }}>Activity review</Link>}
          </nav>
        )}
      </header>
      <div className="scoring-day-field">
        <span id="activity-date-label" className="scoring-day-field-label">Activity date</span>
        <DatePicker
          aria-labelledby="activity-date-label activity-date-value"
          valueId="activity-date-value"
          value={date}
          min={child.startDate}
          max={last}
          today={today}
          disabled={!!pending || oneOffOpen || !!conflict}
          onSelect={(next) => {
            setError('');
            onDateChange(next);
            setDate(next);
          }}
        />
      </div>
      {date !== today && (
        <p className="scoring-day-pastnote" role="note">
          <HistoryIcon aria-hidden="true" size={16} />
          <span><strong>Editing a past date.</strong> Changes apply to this day only.</span>
        </p>
      )}
      {conflict && current && (
        <article role="alert">
          <h2>This entry changed</h2>
          <p>
            Current: {current.outcome.replaceAll('_', ' ')} · {current.points} stars {current.reason}
          </p>
          <p>
            Your change:{' '}
            {conflict.body.void
              ? 'Void entry'
              : typeof conflict.body.outcome === 'string'
                ? conflict.body.outcome.replaceAll('_', ' ')
                : String(conflict.body.points) + ' stars · ' + conflict.body.reason}
          </p>
          <div className="score-actions">
            <Button
              onClick={() => {
                flow.dismiss();
                setError('');
              }}
            >
              Keep current
            </Button>
            {current.outcome !== 'void' && (
              <Button
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void flow.applyOverConflict().then(settleError).finally(() => setBusy(false));
                }}
              >
                Apply my change
              </Button>
            )}
          </div>
        </article>
      )}
      {error && !oneOffOpen && (!conflict || !current) && (
        <p role="alert">
          {error}{' '}
          {pending ? (
            <Button disabled={busy} onClick={() => recheck()}>
              Check / retry
            </Button>
          ) : (
            !day.data && (
              <Button
                onClick={() => {
                  setError('');
                  day.reload();
                }}
              >
                Reload
              </Button>
            )
          )}
        </p>
      )}
      {!day.data && pending && !error && !busy && (
        <Button onClick={() => recheck()}>Check / retry</Button>
      )}
      {!day.data && !error && <p role="status">Loading day…</p>}
      {day.data && (
        <>
          <DayStars today={day.data.net} total={day.data.balance ?? day.data.total} past={date !== today} />
          <fieldset className="scoring-day-entries" disabled={!!pending || oneOffOpen || !!conflict}>
            <h2>Activities</h2>
            {!day.data.activities.length && <p>No activities scheduled.</p>}
            {day.data.activities.map((a) => (
              <ActivityRow
                key={a.stream}
                activity={a}
                score={latest.get(a.stream)}
                historyEntries={historyByStream.get(a.stream) ?? NO_ENTRIES}
                isToday={date === today}
                animate={flash?.stream === a.stream}
                starsKey={flash?.stream === a.stream ? `award-${flash.n}` : 'stars'}
                onRecord={onRecord}
              />
            ))}
            <OneOffEditor
              childName={child.displayName}
              date={date}
              entries={[...latest.values()].filter((r) => r.stream.startsWith('one-offs/'))}
              historyOf={(stream) => historyByStream.get(stream) ?? NO_ENTRIES}
              pending={pending}
              busy={busy}
              error={error}
              conflict={!!conflict}
              onSave={save}
              onOpenChange={setOneOffOpen}
            />
          </fieldset>
          {busy && !oneOffOpen && <p role="status">Saving…</p>}
        </>
      )}
    </section>
  );
}
