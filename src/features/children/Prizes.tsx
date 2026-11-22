import { useEffect, useState } from 'react';
import type { Child } from '../../../shared/profiles';
import { requestJson, RequestError } from './requests';
import { Stars } from './ScoreDay';

type Account = { balance: number; history: { id: string; label: string; cost: number; recorded: string; voided: string | null }[] };
type Action = { path: string; method: string; body: object };
const outstanding = new Map<string, Action>();
export function clearPrizeSaves() { outstanding.clear(); }

export function Prizes({ child }: { child: Child }) {
  const path = '/api/children/' + encodeURIComponent(child.id) + '/prizes';
  const [data, setData] = useState<Account | null>(null);
  const [label, setLabel] = useState('');
  const [cost, setCost] = useState('');
  const [pending, setPending] = useState(outstanding.get(child.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    requestJson<Account>(path, { signal: controller.signal }).then(account => { if (!controller.signal.aborted) setData(account); }).catch(() => {
      if (!controller.signal.aborted) setMessage('Could not load prizes. Try reloading.');
    });
    return () => controller.abort();
  }, [path, reload]);
  async function send(action: Action) {
    outstanding.set(child.id, action);
    setPending(action);
    setBusy(true);
    setMessage('');
    try {
      await requestJson(action.path, { method: action.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action.body) });
      outstanding.delete(child.id);
      setPending(undefined);
      setLabel('');
      setCost('');
      setMessage(action.method === 'PATCH' ? 'Redemption voided. Stars returned.' : 'Prize redeemed.');
      setData(null);
      refresh(n => n + 1);
    } catch (error) {
      if (error instanceof RequestError && error.status >= 400 && error.status < 500 && error.status !== 401) {
        outstanding.delete(child.id);
        setPending(undefined);
        setMessage(error.message);
        refresh(n => n + 1);
      } else setMessage('Save not confirmed. Keep this page open and check / retry.');
    } finally { setBusy(false); }
  }
  return <section className="child-profiles score-day">
    {!pending && <a href="/children">← Manage children</a>}
    <h1>{child.displayName} · Prizes</h1>
    {message && <p role="status">{message}</p>}
    {pending && <div role="alert"><p>Check the submitted redemption before continuing.</p>
      <button disabled={busy} onClick={() => void send(pending)}>Check / retry</button></div>}
    {!data && <p role="status">Loading balance…</p>}
    <button disabled={busy} onClick={() => refresh(n => n + 1)}>Reload balance</button>
    {data && <>
      <p>Available balance <Stars value={data.balance}/></p>
      <form className="child-profiles-editor" onSubmit={event => {
        event.preventDefault();
        if (!pending && !busy) void send({ path: path + '/' + crypto.randomUUID(), method: 'PUT', body: { label: label.trim(), cost: Number(cost) } });
      }}>
        <fieldset disabled={busy || Boolean(pending)}>
          <label htmlFor="prize-name">Prize name</label>
          <input id="prize-name" required maxLength={160} value={label} onChange={event => setLabel(event.target.value)}/>
          <label htmlFor="prize-cost">Stars to spend</label>
          <input id="prize-cost" type="number" required min={1} max={Math.max(0, data.balance)} step={1} value={cost} onChange={event => setCost(event.target.value)}/>
          {cost && <p>Balance after redemption <Stars value={data.balance - Number(cost)}/></p>}
          <button type="submit" disabled={data.balance < 1 || !label.trim()}>Redeem</button>
        </fieldset>
      </form>
      <h2>Redemption history</h2>
      {!data.history.length && <p>No prizes redeemed yet.</p>}
      <ul className="child-profiles-list">{data.history.map(row => <li className="child-profiles-card" key={row.id}>
        <div><h3>{row.label}</h3><p>{row.cost} stars · {new Date(row.recorded).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })} Jakarta</p>
          {row.voided && <p>Voided · Stars returned</p>}</div>
        {!row.voided && <button disabled={busy || Boolean(pending)} onClick={() => void send({ path: path + '/' + row.id, method: 'PATCH', body: { void: true } })}>Void redemption</button>}
      </li>)}</ul>
    </>}
  </section>;
}
