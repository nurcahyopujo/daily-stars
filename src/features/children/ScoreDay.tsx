import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoryIcon } from "lucide-react";
import { Link } from '@tanstack/react-router';
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Child } from '../../../shared/profiles';
import type { Activity, Day, Score } from '../../../shared/scoring';
import { requestJson, RequestError } from './requests';
import { DayStars } from './StarBalance';

type Action = { method: string; path: string; body: Record<string, unknown>; key: string };
const outstanding = new Map<string, Action>();
export function clearScoreSaves() {
  outstanding.clear();
}

function latestOf(history: Score[], stream: string): Score | undefined {
  let best: Score | undefined;
  for (const row of history)
    if (row.stream === stream && (best?.revision ?? -1) < row.revision) best = row;
  return best;
}

// Build the day as it will look once an outcome lands, so the UI can show it
// immediately. `net`, `balance`, and `total` all shift by the points delta; the
// quiet background reconcile replaces this guess with the server's truth.
function withOutcome(prev: Day, a: Activity, outcome: string): Day {
  const r = latestOf(prev.history, a.stream);
  const oldPoints = r && r.outcome !== 'unrecorded' ? r.points : 0;
  const newPoints =
    outcome === 'done_correctly' ? a.reward : outcome === 'needs_improvement' ? -(a.penalty ?? 0) : 0;
  const delta = newPoints - oldPoints;
  const entry: Score = {
    stream: a.stream,
    revision: (r?.revision ?? 0) + 1,
    points: newPoints,
    reason: '',
    outcome,
    actor: 'You',
    recorded: new Date().toISOString(),
  };
  return {
    ...prev,
    history: [...prev.history, entry],
    net: prev.net + delta,
    total: prev.total + delta,
    balance: prev.balance === undefined ? undefined : prev.balance + delta,
  };
}

const ENTRY_TYPES = [
  { value: 1, label: 'Award' },
  { value: -1, label: 'Deduction' },
] as const;

type Draft = { stream?: string; revision?: number; sign: number; amount: string; reason: string };
export function Stars({
  value,
  small = false,
  signed = small,
  animate = false,
}: {
  value: number;
  small?: boolean;
  signed?: boolean;
  animate?: boolean;
}) {
  const count = small && value > 0 && value <= 5 ? value : 1;
  return (
    <span className="score-stars" aria-label={value + ' stars'}>
      <span className={`score-stars-glyphs${animate ? ' is-awarded' : ''}`} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <i key={i} style={{ '--i': i } as CSSProperties}>★</i>
        ))}
      </span>{' '}
      {signed && value > 0 ? '+' : ''}
      {value}
    </span>
  );
}

const NO_ENTRIES: Score[] = [];

function StreamHistory({ entries }: { entries: Score[] }) {
  if (!entries.length) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger>History</CollapsibleTrigger>
      <CollapsibleContent><ol>
        {entries.map((r) => (
          <li key={r.revision}>
            {r.outcome.replaceAll('_', ' ')} · {r.points} stars {r.reason} · {r.actor} ·{' '}
            {new Date(r.recorded).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })} Jakarta
          </li>
        ))}
      </ol></CollapsibleContent>
    </Collapsible>
  );
}

type RowProps = {
  activity: Activity;
  score: Score | undefined;
  historyEntries: Score[];
  isToday: boolean;
  animate: boolean;
  starsKey: string;
  onRecord: (activity: Activity, outcome: string, revision: number) => void;
};

function sameEntries(a: Score[], b: Score[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

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
  const [date, setDate] = useState(
    outstanding.get(child.id)?.path.split('/days/')[1]?.slice(0, 10) ??
      (selectedDate && selectedDate >= child.startDate && selectedDate <= last ? selectedDate : last),
  );
  const [data, setData] = useState<Day | null>(null);
  const [reload, refresh] = useState(0);
  const [error, setError] = useState(
    outstanding.has(child.id) ? 'Check the submitted score before continuing.' : '',
  );
  const [pending, setPending] = useState<Action | null>(outstanding.get(child.id) ?? null);
  const [conflict, setConflict] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Score | null>(null);
  // Marks the activity whose stars just changed, so only its row replays the
  // award animation (a fresh `n` re-keys the stars to retrigger on each tap).
  const [flash, setFlash] = useState<{ stream: string; n: number } | null>(null);
  const flashSeq = useRef(0);
  const path = '/api/children/' + encodeURIComponent(child.id) + '/days/' + date;
  const pathRef = useRef(path);
  pathRef.current = path;
  // Latest data without re-binding the stable handlers below on every render.
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    requestJson<Day>(path, { signal: controller.signal })
      .then((day) => {
        if (!controller.signal.aborted) setData(day);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load the day.');
      });
    return () => controller.abort();
  }, [path, reload]);
  // Pull the authoritative day back in without blanking the view, ignoring the
  // response if the visible date has since changed.
  const reconcile = useCallback(async (atPath: string): Promise<Day | null> => {
    try {
      const fresh = await requestJson<Day>(atPath);
      if (pathRef.current === atPath) {
        setData(fresh);
        return fresh;
      }
    } catch {
      // Offline or server error: keep what's on screen. The next action or a
      // manual reload will resync.
    }
    return null;
  }, []);
  // Resolves to the reconciled day on success (used to flash the changed entry),
  // or null on failure/conflict.
  const send = useCallback(async (action: Action, optimistic?: (prev: Day) => Day): Promise<Day | null> => {
    outstanding.set(child.id, action);
    const snapshot = optimistic ? dataRef.current : null;
    if (optimistic) setData((prev) => (prev ? optimistic(prev) : prev));
    const atPath = pathRef.current;
    setBusy(true);
    setError('');
    try {
      await requestJson(action.path, {
        method: action.method,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': action.key },
        body: JSON.stringify(action.body),
      });
      outstanding.delete(child.id);
      setPending(null);
      return await reconcile(atPath);
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500 && e.status !== 401) {
        outstanding.delete(child.id);
        setPending(null);
        setError(e.message);
        if (e.code === 'STALE_EDIT') {
          setConflict(action);
          setDraft(null);
          setConfirm(false);
          await reconcile(atPath); // load the server's current value; drops the optimistic guess
        } else if (snapshot) {
          setData(snapshot); // rejected outright: undo the optimistic change
        }
      } else {
        // Uncertain outcome (offline / 5xx). Now the save needs resolution, so
        // mark it pending — this is what locks the nav and shows Check / retry.
        setPending(action);
        setError('Save not confirmed. Keep this page open and retry.');
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [child.id, reconcile]);
  const save = useCallback((
    method: string,
    stream: string,
    body: Record<string, unknown>,
    optimistic?: (prev: Day) => Day,
  ): Promise<Day | null> =>
    send({ method, path: pathRef.current + '/' + stream, body, key: crypto.randomUUID() }, optimistic),
  [send]);
  // Record an activity outcome: flash that row's stars, then save optimistically.
  const onRecord = useCallback((activity: Activity, outcome: string, revision: number) => {
    setFlash({ stream: activity.stream, n: ++flashSeq.current });
    void save('PUT', activity.stream, { expectedRevision: revision, outcome }, (prev) =>
      withOutcome(prev, activity, outcome),
    );
  }, [save]);
  const latest = new Map<string, Score>();
  const historyByStream = new Map<string, Score[]>();
  for (const row of data?.history ?? []) {
    if ((latest.get(row.stream)?.revision ?? 0) < row.revision) latest.set(row.stream, row);
    const entries = historyByStream.get(row.stream);
    if (entries) entries.push(row);
    else historyByStream.set(row.stream, [row]);
  }
  const current = conflict && latest.get(conflict.path.slice(path.length + 1));
  return (
    <section className="child-profiles score-day scoring-day">
      {!pending && <Link className="scoring-day-back" to="/children">← Manage children</Link>}
      <header className="scoring-day-head">
        <h1>{child.displayName}</h1>
        {!pending && (
          <nav className="scoring-day-links" aria-label="Child pages">
            <Link to="/children/$childId/prizes" params={{ childId: child.id }}>Prizes</Link>
            <Link to="/children/$childId/assignments" params={{ childId: child.id }}>Assignments</Link>
            {!draft && !conflict && <Link to="/children/$childId/review" params={{ childId: child.id }} search={{ date }}>Activity review</Link>}
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
          disabled={!!pending || !!draft || !!conflict}
          onSelect={(next) => {
            setError('');
            setData(null);
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
                setConflict(null);
                setError('');
              }}
            >
              Keep current
            </Button>
            {current.outcome !== 'void' && (
              <Button
                onClick={() => {
                  setConflict(null);
                  void send({
                    ...conflict,
                    key: crypto.randomUUID(),
                    body: { ...conflict.body, expectedRevision: current.revision },
                  });
                }}
              >
                Apply my change
              </Button>
            )}
          </div>
        </article>
      )}
      {error && !draft && (!conflict || !current) && (
        <p role="alert">
          {error}{' '}
          {pending ? (
            <Button disabled={busy} onClick={() => void send(pending)}>
              Check / retry
            </Button>
          ) : (
            !data && (
              <Button
                onClick={() => {
                  setError('');
                  refresh((n) => n + 1);
                }}
              >
                Reload
              </Button>
            )
          )}
        </p>
      )}
      {!data && pending && !error && !busy && (
        <Button onClick={() => void send(pending)}>Check / retry</Button>
      )}
      {!data && !error && <p role="status">Loading day…</p>}
      {data && (
        <>
          <DayStars today={data.net} total={data.balance ?? data.total} past={date !== today} />
          <fieldset className="scoring-day-entries" disabled={!!pending || !!draft || !!conflict}>
            <h2>Activities</h2>
            {!data.activities.length && <p>No activities scheduled.</p>}
            {data.activities.map((a) => (
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
            <h2>One-off entries</h2>
            <div className="score-actions">
              {[1, -1].map((sign) => (
                <Button key={sign} onClick={() => setDraft({ sign, amount: '', reason: '' })}>
                  {sign === 1 ? 'Add stars' : 'Deduct stars'}
                </Button>
              ))}
            </div>
            {[...latest.values()]
              .filter((r) => r.stream.startsWith('one-offs/'))
              .map((r) => (
                <article key={r.stream} className="scoring-day-entry">
                  <div className="scoring-day-entry-head">
                    <h3>{r.reason}</h3>
                  </div>
                  <p className={`scoring-day-status ${r.outcome === 'void' ? 'is-void' : r.points > 0 ? 'is-done' : 'is-needs'}`}>
                    <Stars
                      small
                      value={r.points}
                      animate={flash?.stream === r.stream}
                      key={flash?.stream === r.stream ? `award-${flash.n}` : 'stars'}
                    />{' '}
                    ·{' '}
                    {r.outcome === 'void' ? 'Voided' : r.points > 0 ? 'Award' : 'Deduction'}
                  </p>
                  {r.outcome !== 'void' && (
                    <div className="score-actions">
                      <Button
                        onClick={() =>
                          setDraft({
                            stream: r.stream,
                            revision: r.revision,
                            sign: Math.sign(r.points),
                            amount: String(Math.abs(r.points)),
                            reason: r.reason,
                          })
                        }
                      >
                        Edit entry
                      </Button>
                      <Button onClick={() => setVoidTarget(r)}>
                        Void entry
                      </Button>
                    </div>
                  )}
                  <StreamHistory entries={historyByStream.get(r.stream) ?? NO_ENTRIES} />
                </article>
              ))}
          </fieldset>
          <AlertDialog open={voidTarget !== null} onOpenChange={(open) => { if (!open) setVoidTarget(null); }}>
            <AlertDialogContent className="child-profiles child-profiles-modal modal-standard void-confirmation">
              <AlertDialogHeader className="modal-head">
                <AlertDialogTitle className="modal-title">Void entry?</AlertDialogTitle>
                <AlertDialogDescription className="modal-sub">Void “{voidTarget?.reason}” for {child.displayName} on {date}? This is final.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="modal-footer">
                <AlertDialogCancel className="modal-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  if (voidTarget) void save('PATCH', voidTarget.stream, { expectedRevision: voidTarget.revision, void: true });
                  setVoidTarget(null);
                }}>Void entry</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog
            open={!!draft}
            onOpenChange={(open) => {
              if (!open && !pending && !busy) {
                setDraft(null);
                setConfirm(false);
              }
            }}
          >
            <DialogContent
              showCloseButton={false}
              className="child-profiles child-profiles-modal modal-standard oneoff-modal"
            >
              {draft && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!confirm) {
                      setConfirm(true);
                      return;
                    }
                    const editStream = draft.stream;
                    const before = new Set(
                      (dataRef.current?.history ?? [])
                        .map((h) => h.stream)
                        .filter((s) => s.startsWith('one-offs/')),
                    );
                    void save(draft.stream ? 'PATCH' : 'POST', draft.stream ?? 'one-offs', {
                      points: draft.sign * Number(draft.amount),
                      reason: draft.reason.trim(),
                      ...(draft.stream ? { expectedRevision: draft.revision } : {}),
                    }).then((fresh) => {
                      if (!fresh) return;
                      // This submit owns the modal, so close it only on its own
                      // success — not from send(), which also runs for outcome taps.
                      setDraft(null);
                      setConfirm(false);
                      // Edit knows its stream; a new entry is the one-off stream
                      // the server added that wasn't present before.
                      const stream =
                        editStream ??
                        fresh.history
                          .map((h) => h.stream)
                          .find((s) => s.startsWith('one-offs/') && !before.has(s));
                      if (stream) setFlash({ stream, n: ++flashSeq.current });
                    });
                  }}
                >
                  <fieldset disabled={!!pending}>
                    <DialogHeader className="modal-head">
                      <DialogTitle className="modal-title">
                        {draft.stream ? 'Correct entry' : draft.sign === 1 ? 'Add stars' : 'Deduct stars'}
                      </DialogTitle>
                      <DialogDescription className="modal-sub">
                        {confirm
                          ? 'Check the details before saving.'
                          : `For ${child.displayName} on ${date}.`}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="modal-body">
                      {confirm ? (
                        <p className="oneoff-review">
                          <span className="oneoff-review-amount">
                            <Stars small value={draft.sign * Number(draft.amount || 0)} />
                          </span>
                          {draft.sign === 1 ? 'Award' : 'Deduct'} {draft.amount} stars{' '}
                          {draft.sign === 1 ? 'to' : 'from'} {child.displayName} for {date}.
                          <span className="oneoff-review-reason">{draft.reason}</span>
                        </p>
                      ) : (
                        <>
                          <label>
                            Entry type{' '}
                            <Select
                              items={ENTRY_TYPES}
                              value={draft.sign}
                              onValueChange={(sign) => { if (sign != null) setDraft({ ...draft, sign }); }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ENTRY_TYPES.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <label>
                            Stars{' '}
                            <Input
                              autoFocus
                              required
                              type="number"
                              min="1"
                              max="999"
                              value={draft.amount}
                              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                            />
                          </label>
                          <label>
                            Reason{' '}
                            <Input
                              required
                              maxLength={160}
                              value={draft.reason}
                              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                            />
                          </label>
                        </>
                      )}
                      {error && <p role="alert" className="modal-error">{error}</p>}
                      {busy && <p role="status" className="modal-saving">Saving…</p>}
                    </div>
                    <footer className="modal-footer">
                      <Button
                        type="button"
                        className="modal-cancel"
                        disabled={busy}
                        onClick={() => {
                          if (confirm) setConfirm(false);
                          else setDraft(null);
                        }}
                      >
                        {confirm ? 'Back' : 'Cancel'}
                      </Button>
                      <Button type="submit" disabled={!draft.reason.trim() || busy}>
                        {confirm ? 'Confirm' : 'Review entry'}
                      </Button>
                    </footer>
                  </fieldset>
                </form>
              )}
            </DialogContent>
          </Dialog>
          {busy && !draft && <p role="status">Saving…</p>}
        </>
      )}
    </section>
  );
}
