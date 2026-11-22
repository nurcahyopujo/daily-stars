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

export function ScoreDay({ child, today }: { child: Child; today: string }) {
  const last =
    child.archiveEffectiveDate && child.archiveEffectiveDate <= today
      ? new Date(Date.parse(child.archiveEffectiveDate + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
      : today;
  const selectedDate = new URLSearchParams(location.search).get('date');
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
        <details>
          <summary>History</summary>
          <ol>
            {entries.map((r) => (
              <li key={r.revision}>
                {r.outcome.replaceAll('_', ' ')} · {r.points} stars {r.reason} · {r.actor} ·{' '}
                {new Date(r.recorded).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })} Jakarta
              </li>
            ))}
          </ol>
        </details>
      )
    );
  }
  const latest = new Map<string, Score>();
  for (const row of data?.history ?? [])
    if ((latest.get(row.stream)?.revision ?? 0) < row.revision) latest.set(row.stream, row);
  const current = conflict && latest.get(conflict.path.slice(path.length + 1));
  return (
    <section className="child-profiles score-day">
      {!pending && <a href="/children">← Manage children</a>}
      <h1>{child.displayName}</h1>
      {!pending && <a href={'/children?prizes=' + encodeURIComponent(child.id)}>Prizes</a>}
      {!pending && !draft && !conflict && (
        <a href={'/children?' + new URLSearchParams({ review: child.id, date })}>Activity review</a>
      )}
      <label>
        Activity date{' '}
        <input
          type="date"
          value={date}
          min={child.startDate}
          max={last}
          disabled={!!pending || !!draft || !!conflict}
          onChange={(e) => {
            if (e.target.validity.valid && e.target.value) {
              setError('');
              setData(null);
              const url = new URL(location.href);
              url.searchParams.set('date', e.target.value);
              window.history.replaceState(null, '', url);
              setDate(e.target.value);
            }
          }}
        />
      </label>
      {date !== today && (
        <p>
          <strong>Editing a past date</strong>
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
            <button
              onClick={() => {
                setConflict(null);
                setError('');
              }}
            >
              Keep current
            </button>
            {current.outcome !== 'void' && (
              <button
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
              </button>
            )}
          </div>
        </article>
      )}
      {error && (!conflict || !current) && (
        <p role="alert">
          {error}{' '}
          {pending ? (
            <button disabled={busy} onClick={() => void send(pending)}>
              Check / retry
            </button>
          ) : (
            !data && (
              <button
                onClick={() => {
                  setError('');
                  refresh((n) => n + 1);
                }}
              >
                Reload
              </button>
            )
          )}
        </p>
      )}
      {!data && pending && !error && !busy && (
        <button onClick={() => void send(pending)}>Check / retry</button>
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
          <fieldset disabled={!!pending || !!draft || !!conflict}>
            <h2>Activities</h2>
            {!data.activities.length && <p>No activities scheduled.</p>}
            {data.activities.map((a) => {
              const r = latest.get(a.stream);
              return (
                <article key={a.stream}>
                  <small>{a.template}</small>
                  <h3>{a.label}</h3>
                  <p>
                    {!r || r.outcome === 'unrecorded' ? (
                      date === today ? (
                        'Pending'
                      ) : (
                        'Unrecorded'
                      )
                    ) : (
                      <>
                        <Stars small value={r.points} /> ·{' '}
                        {r.outcome === 'done_correctly' ? 'Done correctly' : 'Needs improvement'}
                      </>
                    )}
                  </p>
                  <div className="score-actions">
                    {[
                      ['done_correctly', 'Done correctly', a.reward],
                      ['needs_improvement', 'Needs improvement', -(a.penalty ?? 0)],
                    ].map(([outcome, label, amount]) => (
                      <button
                        key={outcome}
                        aria-pressed={r?.outcome === outcome}
                        onClick={() => save('PUT', a.stream, { expectedRevision: r?.revision ?? 0, outcome })}
                      >
                        {label} ({Number(amount) > 0 ? '+' : ''}
                        {amount})
                      </button>
                    ))}
                    {r && r.outcome !== 'unrecorded' && (
                      <button
                        onClick={() =>
                          save('PUT', a.stream, { expectedRevision: r.revision, outcome: 'unrecorded' })
                        }
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {history(a.stream)}
                </article>
              );
            })}
            <h2>One-off entries</h2>
            <div className="score-actions">
              {[1, -1].map((sign) => (
                <button key={sign} onClick={() => setDraft({ sign, amount: '', reason: '' })}>
                  {sign === 1 ? 'Add stars' : 'Deduct stars'}
                </button>
              ))}
            </div>
            {[...latest.values()]
              .filter((r) => r.stream.startsWith('one-offs/'))
              .map((r) => (
                <article key={r.stream}>
                  <h3>{r.reason}</h3>
                  <p>
                    <Stars small value={r.points} /> ·{' '}
                    {r.outcome === 'void' ? 'Voided' : r.points > 0 ? 'Award' : 'Deduction'}
                  </p>
                  {r.outcome !== 'void' && (
                    <div className="score-actions">
                      <button
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
                      </button>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              'Void “' +
                                r.reason +
                                '” for ' +
                                child.displayName +
                                ' on ' +
                                date +
                                '? This is final.',
                            )
                          )
                            save('PATCH', r.stream, { expectedRevision: r.revision, void: true });
                        }}
                      >
                        Void entry
                      </button>
                    </div>
                  )}
                  {history(r.stream)}
                </article>
              ))}
          </fieldset>
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
                <h2>{draft.stream ? 'Correct entry' : 'One-off entry'}</h2>
                {confirm ? (
                  <p>
                    {draft.sign === 1 ? 'Award' : 'Deduct'} {draft.amount} stars{' '}
                    {draft.sign === 1 ? 'to' : 'from'} {child.displayName} for {date}?<br />
                    {draft.reason}
                  </p>
                ) : (
                  <>
                    <label>
                      Entry type{' '}
                      <select
                        value={draft.sign}
                        onChange={(e) => setDraft({ ...draft, sign: Number(e.target.value) })}
                      >
                        <option value={1}>Award</option>
                        <option value={-1}>Deduction</option>
                      </select>
                    </label>
                    <label>
                      Stars{' '}
                      <input
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
                      <input
                        required
                        maxLength={160}
                        value={draft.reason}
                        onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                      />
                    </label>
                  </>
                )}
                <div className="score-actions">
                  <button disabled={!draft.reason.trim()}>{confirm ? 'Confirm' : 'Review entry'}</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm) setConfirm(false);
                      else setDraft(null);
                    }}
                  >
                    {confirm ? 'Back' : 'Cancel'}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          {busy && <p role="status">Saving…</p>}
        </>
      )}
    </section>
  );
}
