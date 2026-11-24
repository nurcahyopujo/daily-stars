import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from '@tanstack/react-router';
import { BackLabel, backLinkClass } from './BackLink';
import { useEffect, useState } from 'react';
import type { Child } from '../../../shared/profiles';
import { requestJson } from './requests';
import { clear, retry, submit, usePendingSave, type Settled } from './pending-save';
import { Stars } from './ScoreDay';
import { StarBalance, GoldStar } from './StarBalance';

type Account = { balance: number; history: { id: string; label: string; cost: number; recorded: string; voided: string | null }[] };
type Action = { path: string; method: string; body: object };

// Redemptions are stamped in the household's Jakarta day; show the date and time
// without seconds so the receipt reads cleanly.
const recordedFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
});

export function Prizes({ child }: { child: Child }) {
  const path = '/api/children/' + encodeURIComponent(child.id) + '/prizes';
  const [data, setData] = useState<Account | null>(null);
  const [label, setLabel] = useState('');
  const [cost, setCost] = useState('');
  const [message, setMessage] = useState('');
  const [reload, refresh] = useState(0);
  const prizeKey = 'prize:' + child.id;
  const prizeSave = usePendingSave<Action, null, unknown>(prizeKey);
  const busy = prizeSave.status === 'saving';
  const pending = prizeSave.status === 'uncertain' ? prizeSave.intent : undefined;
  useEffect(() => {
    const controller = new AbortController();
    requestJson<Account>(path, { signal: controller.signal }).then(account => { if (!controller.signal.aborted) setData(account); }).catch(() => {
      if (!controller.signal.aborted) setMessage('Could not load prizes. Try reloading.');
    });
    return () => controller.abort();
  }, [path, reload]);
  // Redemptions carry their idempotency in the URL (a per-redeem UUID, or the
  // redemption id for a void), so the request repeats safely on retry without an
  // Idempotency-Key header. The engine tracks the pending save for recovery.
  function resolve(action: Action, outcome: Settled<Action, null, unknown>) {
    if (outcome.status === 'success') {
      clear(prizeKey);
      setLabel('');
      setCost('');
      setMessage(action.method === 'PATCH' ? 'Redemption voided. Stars returned.' : 'Prize redeemed.');
      setData(null);
      refresh(n => n + 1);
    } else if (outcome.status === 'rejected' || outcome.status === 'conflict') {
      clear(prizeKey);
      setMessage(outcome.status === 'rejected' ? outcome.message : 'Could not complete. Reload and try again.');
      refresh(n => n + 1);
    } else setMessage('Save not confirmed. Keep this page open and check / retry.');
  }
  async function send(action: Action) {
    setMessage('');
    const outcome = await submit<Action, null, unknown>(prizeKey, action, async () => {
      await requestJson(action.path, { method: action.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action.body) });
      return null;
    });
    if (outcome) resolve(action, outcome);
  }
  function recheck() {
    if (!pending) return;
    const result = retry<Action, null, unknown>(prizeKey);
    if (result) void result.then(outcome => { if (outcome) resolve(pending, outcome); });
  }
  const exceedsBalance = data !== null && Number(cost) > data.balance;
  return <section className="child-profiles score-day prizes-page">
    {!pending && <Link className={backLinkClass} to="/children/$childId" params={{ childId: child.id }}><BackLabel>{child.displayName}</BackLabel></Link>}
    <header className="scoring-day-head"><h1>{child.displayName} · Prizes</h1></header>
    {message && <p role="status" className="prizes-message">{message}</p>}
    {pending && <div role="alert" className="prizes-pending"><p>Check the submitted redemption before continuing.</p>
      <Button disabled={busy} onClick={() => recheck()}>Check / retry</Button></div>}
    {!data && <p role="status" className="prizes-loading">Loading balance…</p>}
    {data && <div className="prizes-hero">
      <StarBalance balance={data.balance}/>
      <Button className="prizes-reload" disabled={busy} onClick={() => refresh(n => n + 1)}>Reload</Button>
    </div>}
    {!data && <Button className="prizes-reload prizes-reload-standalone" disabled={busy} onClick={() => refresh(n => n + 1)}>Reload balance</Button>}
    {data && <>
      <form className="child-profiles-editor prizes-form" onSubmit={event => {
        event.preventDefault();
        if (!pending && !busy && !exceedsBalance) void send({ path: path + '/' + crypto.randomUUID(), method: 'PUT', body: { label: label.trim(), cost: Number(cost) } });
      }}>
        <fieldset disabled={busy || Boolean(pending)}>
          <h2 className="prizes-form-title">Redeem a prize</h2>
          {data.balance < 1
            ? <p className="prizes-note">No stars to spend yet. Earn stars on the day page, then come back to redeem a prize.</p>
            : <>
                <label htmlFor="prize-name">Prize name</label>
                <Input id="prize-name" required maxLength={160} placeholder="e.g. Extra screen time" value={label} onChange={event => setLabel(event.target.value)}/>
                <label htmlFor="prize-cost">Stars to spend</label>
                <Input id="prize-cost" aria-invalid={exceedsBalance} aria-describedby={exceedsBalance ? 'prize-cost-error' : undefined} type="number" required min={1} max={Math.max(0, data.balance)} step={1} value={cost} onChange={event => setCost(event.target.value)}/>
                {exceedsBalance && <p id="prize-cost-error" role="alert" className="prizes-form-error">Stars to spend exceed the available balance.</p>}
                {cost && !exceedsBalance && <p className="prizes-after">Balance after redemption <Stars value={data.balance - Number(cost)}/></p>}
                <Button type="submit" className="prizes-redeem" disabled={data.balance < 1 || !label.trim() || exceedsBalance}>Redeem</Button>
              </>}
        </fieldset>
      </form>
      <h2 className="prizes-history-title">Redemption history</h2>
      {!data.history.length
        ? <p className="prizes-empty"><GoldStar size={26} reduce animated={false}/>No prizes redeemed yet. Redeemed prizes appear here so both of you can see what was spent.</p>
        : <ul className="prizes-history">{data.history.map(row => <li className={`prizes-history-row${row.voided ? ' is-voided' : ''}`} key={row.id}>
          <div className="prizes-history-top">
            <h3>{row.label}</h3>
            <span className="prizes-cost" aria-label={`Costs ${row.cost} stars`}>
              <GoldStar size={15} reduce animated={false}/>
              <span className="prizes-cost-value" aria-hidden="true">{row.cost}</span>
            </span>
          </div>
          <p className="prizes-history-meta">{recordedFormat.format(new Date(row.recorded))} · Jakarta</p>
          <div className="prizes-history-foot">
            {row.voided
              ? <span className="prizes-voided-badge">Voided · Stars returned</span>
              : <Button className="prizes-void" disabled={busy || Boolean(pending)} onClick={() => void send({ path: path + '/' + row.id, method: 'PATCH', body: { void: true } })}>Void redemption</Button>}
          </div>
        </li>)}</ul>}
    </>}
  </section>;
}
