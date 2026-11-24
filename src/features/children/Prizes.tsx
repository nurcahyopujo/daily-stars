import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from '@tanstack/react-router';
import { BackLabel, backLinkClass } from './BackLink';
import { useState } from 'react';
import type { Child } from '../../../shared/profiles';
import { requestJson } from './requests';
import { useResource } from './use-resource';
import { useSaveFlow } from './save-flow';
import { StarBalance, GoldStar, Stars } from './StarBalance';
import type { CatalogChoice } from '../../../shared/prizes';
import { PrizeImage } from '../prizes/PrizeImage';
import { PrizeCost } from '../prizes/PrizeList';
import '../prizes/prize-catalog.css';

type Account = {
  balance: number;
  history: { id: string; label: string; cost: number; recorded: string; voided: string | null }[];
  catalog: CatalogChoice[];
};

/** Why a catalog prize can't be redeemed for this child right now, if anything. */
function blockedReason(choice: CatalogChoice, balance: number): string | null {
  if (choice.oneTime && choice.redeemed) return 'Already redeemed';
  if (choice.cost > balance) return `Needs ${choice.cost - Math.max(0, balance)} more ${choice.cost - Math.max(0, balance) === 1 ? 'star' : 'stars'}`;
  return null;
}
type Action = { path: string; method: string; body: object };

// Redemptions are stamped in the household's Jakarta day; show the date and time
// without seconds so the receipt reads cleanly.
const recordedFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
});

export function Prizes({ child }: { child: Child }) {
  const path = '/api/children/' + encodeURIComponent(child.id) + '/prizes';
  const [label, setLabel] = useState('');
  const [cost, setCost] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'catalog' | 'custom' | null>(null);
  const [prizeId, setPrizeId] = useState('');
  const account = useResource<Account>(path, { onError: () => setMessage('Could not load prizes. Try reloading.') });
  // Redemptions carry their idempotency in the URL (a per-redeem UUID, or the
  // redemption id for a void), so the request repeats safely on retry without an
  // Idempotency-Key header. The Save flow tracks the pending save for recovery.
  const flow = useSaveFlow<Action, null, unknown>({
    key: 'prize:' + child.id,
    request: (action) => requestJson(action.path, {
      method: action.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action.body),
    }).then(() => null),
  });
  const busy = flow.busy;
  const pending = flow.phase === 'recover';
  function resolve(outcome: Awaited<ReturnType<typeof flow.run>>, method: string) {
    if (outcome.phase === 'success') {
      flow.dismiss();
      setLabel('');
      setCost('');
      setPrizeId('');
      setMessage(method === 'PATCH' ? 'Redemption voided. Stars returned.' : 'Prize redeemed.');
      account.reload();
    } else if (outcome.phase === 'rejected' || outcome.phase === 'conflict') {
      flow.dismiss();
      setMessage(outcome.phase === 'rejected' ? outcome.message : 'Could not complete. Reload and try again.');
      account.reload();
    } else if (outcome.phase === 'recover') setMessage('Save not confirmed. Keep this page open and check / retry.');
  }
  async function send(action: Action) {
    setMessage('');
    resolve(await flow.run(action), action.method);
  }
  function recheck() {
    const method = flow.intent?.method ?? 'PUT';
    void flow.retry().then(outcome => resolve(outcome, method));
  }
  const exceedsBalance = account.data !== null && Number(cost) > account.data.balance;
  const catalog = account.data?.catalog ?? [];
  // Default to the catalog when it has prizes; the parent can switch to naming one.
  const activeMode = catalog.length === 0 ? 'custom' : mode ?? 'catalog';
  const chosen = catalog.find(choice => choice.id === prizeId && !blockedReason(choice, account.data?.balance ?? 0));
  return <section className="child-profiles score-day prizes-page">
    {!pending && <Link className={backLinkClass} to="/children/$childId" params={{ childId: child.id }}><BackLabel>{child.displayName}</BackLabel></Link>}
    <header className="scoring-day-head"><h1>{child.displayName} · Prizes</h1></header>
    {message && <p role="status" className="prizes-message">{message}</p>}
    {pending && <div role="alert" className="prizes-pending"><p>Check the submitted redemption before continuing.</p>
      <Button disabled={busy} onClick={() => recheck()}>Check / retry</Button></div>}
    {!account.data && <p role="status" className="prizes-loading">Loading balance…</p>}
    {account.data && <div className="prizes-hero">
      <StarBalance balance={account.data.balance}/>
      <Button className="prizes-reload" disabled={busy} onClick={() => account.reload()}>Reload</Button>
    </div>}
    {!account.data && <Button className="prizes-reload prizes-reload-standalone" disabled={busy} onClick={() => account.reload()}>Reload balance</Button>}
    {account.data && <>
      <form className="child-profiles-editor prizes-form" onSubmit={event => {
        event.preventDefault();
        if (pending || busy) return;
        if (activeMode === 'catalog') { if (chosen) void send({ path: path + '/' + crypto.randomUUID(), method: 'PUT', body: { prizeId: chosen.id } }); }
        else if (!exceedsBalance) void send({ path: path + '/' + crypto.randomUUID(), method: 'PUT', body: { label: label.trim(), cost: Number(cost) } });
      }}>
        <fieldset disabled={busy || Boolean(pending)}>
          <h2 className="prizes-form-title">Redeem a prize</h2>
          {account.data.balance < 1
            ? <p className="prizes-note">No stars to spend yet. Earn stars on the day page, then come back to redeem a prize.</p>
            : <>
                {catalog.length > 0 && <div className="redeem-mode" role="group" aria-label="Choose how to redeem">
                  <Button type="button" aria-pressed={activeMode === 'catalog'} onClick={() => setMode('catalog')}>From prize list</Button>
                  <Button type="button" aria-pressed={activeMode === 'custom'} onClick={() => setMode('custom')}>Something else</Button>
                </div>}
                {activeMode === 'catalog' ? <>
                  <fieldset className="redeem-choices">
                    <legend className="sr-only">Prize</legend>
                    {catalog.map(choice => {
                      const reason = blockedReason(choice, account.data!.balance);
                      return <label key={choice.id}>
                        <input type="radio" name="redeem-prize" value={choice.id} disabled={Boolean(reason)}
                          checked={prizeId === choice.id && !reason} onChange={() => setPrizeId(choice.id)} />
                        <PrizeImage src={choice.imageUrl} size="thumb" />
                        <span className="redeem-choice-body">
                          <span className="redeem-choice-name">{choice.name}</span>
                          <span className={`redeem-choice-note${reason ? ' is-blocked' : ''}`}>{reason ?? (choice.oneTime ? 'One-time' : 'Repeatable')}</span>
                        </span>
                        <PrizeCost cost={choice.cost} />
                      </label>;
                    })}
                  </fieldset>
                  {chosen && <p className="prizes-after">Balance after redemption <Stars value={account.data.balance - chosen.cost}/></p>}
                  <Button type="submit" className="prizes-redeem" disabled={!chosen}>Redeem</Button>
                </> : <>
                <label htmlFor="prize-name">Prize name</label>
                <Input id="prize-name" required maxLength={160} placeholder="e.g. Extra screen time" value={label} onChange={event => setLabel(event.target.value)}/>
                <label htmlFor="prize-cost">Stars to spend</label>
                <Input id="prize-cost" aria-invalid={exceedsBalance} aria-describedby={exceedsBalance ? 'prize-cost-error' : undefined} type="number" required min={1} max={Math.max(0, account.data.balance)} step={1} value={cost} onChange={event => setCost(event.target.value)}/>
                {exceedsBalance && <p id="prize-cost-error" role="alert" className="prizes-form-error">Stars to spend exceed the available balance.</p>}
                {cost && !exceedsBalance && <p className="prizes-after">Balance after redemption <Stars value={account.data.balance - Number(cost)}/></p>}
                <Button type="submit" className="prizes-redeem" disabled={account.data.balance < 1 || !label.trim() || exceedsBalance}>Redeem</Button>
                </>}
              </>}
          <p className="prizes-note"><Link to="/prizes">Manage the prize list</Link></p>
        </fieldset>
      </form>
      <h2 className="prizes-history-title">Redemption history</h2>
      {!account.data.history.length
        ? <p className="prizes-empty"><GoldStar size={26} reduce animated={false}/>No prizes redeemed yet. Redeemed prizes appear here so both of you can see what was spent.</p>
        : <ul className="prizes-history">{account.data.history.map(row => <li className={`prizes-history-row${row.voided ? ' is-voided' : ''}`} key={row.id}>
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
