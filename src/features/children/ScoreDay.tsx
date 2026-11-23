import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DatePicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoryIcon } from "lucide-react";
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { Child } from '../../../shared/profiles';
import type { Day, Score } from '../../../shared/scoring';
import { requestJson, RequestError } from './requests';

type Action = { method: string; path: string; body: Record<string, unknown>; key: string };
const outstanding = new Map<string, Action>();
export function clearScoreSaves() {
  outstanding.clear();
}

type Draft = { stream?: string; revision?: number; sign: number; amount: string; reason: string };
export function Stars({
  value,
  small = false,
  signed = small,
}: {
  value: number;
  small?: boolean;
  signed?: boolean;
}) {
  const count = small && value > 0 && value <= 5 ? value : 1;
  return (
    <span className="score-stars" aria-label={value + ' stars'}>
      <span aria-hidden="true">{'★'.repeat(count)}</span> {signed && value > 0 ? '+' : ''}
      {value}
    </span>
  );
}

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
  const path = '/api/children/' + encodeURIComponent(child.id) + '/days/' + date;
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
  async function send(action: Action) {
    outstanding.set(child.id, action);
    setBusy(true);
    setPending(action);
    setError('');
    try {
      await requestJson(action.path, {
        method: action.method,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': action.key },
        body: JSON.stringify(action.body),
      });
      outstanding.delete(child.id);
      setPending(null);
      setDraft(null);
      setConfirm(false);
      refresh((n) => n + 1);
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500 && e.status !== 401) {
        outstanding.delete(child.id);
        setPending(null);
        setError(e.message);
        if (e.code === 'STALE_EDIT') {
          setConflict(action);
          setDraft(null);
          setConfirm(false);
          refresh((n) => n + 1);
        }
      } else setError('Save not confirmed. Keep this page open and retry.');
    } finally {
      setBusy(false);
    }
  }
  function save(method: string, stream: string, body: Record<string, unknown>) {
    void send({ method, path: path + '/' + stream, body, key: crypto.randomUUID() });
  }
  function history(stream: string) {
    const entries = data!.history.filter((row) => row.stream === stream);
    return (
      entries.length > 0 && (
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
      )
    );
  }
  const latest = new Map<string, Score>();
  for (const row of data?.history ?? [])
    if ((latest.get(row.stream)?.revision ?? 0) < row.revision) latest.set(row.stream, row);
  const current = conflict && latest.get(conflict.path.slice(path.length + 1));
  return (
    <section className="child-profiles score-day scoring-day">
      {!pending && <Link className="scoring-day-back" to="/children">← Manage children</Link>}
      <header className="scoring-day-head">
        <h1>{child.displayName}</h1>
        {!pending && (
          <nav className="scoring-day-links" aria-label="Child pages">
            <Link to="/children/$childId/prizes" params={{ childId: child.id }}>Prizes</Link>
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
          <p className="score-summary">
            <span>
              <Stars signed value={data.net} /> {date === today ? 'today' : 'on this date'}
            </span>
            <span>
              <Stars value={data.balance ?? data.total} /> balance
            </span>
          </p>
          <fieldset className="scoring-day-entries" disabled={!!pending || !!draft || !!conflict}>
            <h2>Activities</h2>
            {!data.activities.length && <p>No activities scheduled.</p>}
            {data.activities.map((a) => {
              const r = latest.get(a.stream);
              const recorded = r && r.outcome !== 'unrecorded';
              const statusTone = !recorded
                ? 'is-pending'
                : r!.outcome === 'done_correctly'
                  ? 'is-done'
                  : 'is-needs';
              return (
                <article key={a.stream} className="scoring-day-entry">
                  <div className="scoring-day-entry-head">
                    <h3>{a.label}</h3>
                    <span className="scoring-day-tag">{a.template}</span>
                  </div>
                  <p className={`scoring-day-status ${statusTone}`}>
                    {!recorded ? (
                      date === today ? (
                        'Pending'
                      ) : (
                        'Unrecorded'
                      )
                    ) : (
                      <>
                        <Stars small value={r!.points} /> ·{' '}
                        {r!.outcome === 'done_correctly' ? 'Done correctly' : 'Needs improvement'}
                      </>
                    )}
                  </p>
                  <div className="score-actions scoring-day-outcomes">
                    {[
                      ['done_correctly', 'Done correctly', a.reward],
                      ['needs_improvement', 'Needs improvement', -(a.penalty ?? 0)],
                    ].map(([outcome, label, amount]) => (
                      <Button
                        key={outcome}
                        aria-pressed={r?.outcome === outcome}
                        onClick={() => save('PUT', a.stream, { expectedRevision: r?.revision ?? 0, outcome })}
                      >
                        {label} ({Number(amount) > 0 ? '+' : ''}
                        {amount})
                      </Button>
                    ))}
                    {r && r.outcome !== 'unrecorded' && (
                      <Button
                        onClick={() =>
                          save('PUT', a.stream, { expectedRevision: r.revision, outcome: 'unrecorded' })
                        }
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                  {history(a.stream)}
                </article>
              );
            })}
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
                    <Stars small value={r.points} /> ·{' '}
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
                  {history(r.stream)}
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
                  if (voidTarget) save('PATCH', voidTarget.stream, { expectedRevision: voidTarget.revision, void: true });
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
                    save(draft.stream ? 'PATCH' : 'POST', draft.stream ?? 'one-offs', {
                      points: draft.sign * Number(draft.amount),
                      reason: draft.reason.trim(),
                      ...(draft.stream ? { expectedRevision: draft.revision } : {}),
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
                            <NativeSelect
                              className="w-full"
                              value={draft.sign}
                              onChange={(e) => setDraft({ ...draft, sign: Number(e.target.value) })}
                            >
                              <NativeSelectOption value={1}>Award</NativeSelectOption>
                              <NativeSelectOption value={-1}>Deduction</NativeSelectOption>
                            </NativeSelect>
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
