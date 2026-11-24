import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { isHttpsUrl, PRIZE_COST_MAX, PRIZE_NAME_MAX, PRIZE_URL_MAX, validatePrizeFields, type Prize, type PrizeFields } from '../../../shared/prizes';
import { BackLabel, backLinkClass } from '../children/BackLink';
import { requestJson, RequestError } from '../children/requests';
import { useSaveFlow } from '../children/save-flow';
import { PrizeImage } from './PrizeImage';
import { PrizeCost } from './PrizeList';
import { lastPrizeQuery } from './prize-query';
import { applyPrizeConflict, PRIZE_SAVE_KEY, prizeRequest, type PrizeIntent, type PrizeTarget } from './prize-requests';
import '../children/child-profiles.css';
import './prize-catalog.css';

type Draft = { name: string; cost: string; oneTime: boolean; link: string; imageUrl: string };
const blank: Draft = { name: '', cost: '', oneTime: false, link: '', imageUrl: '' };
const toDraft = (prize: Prize): Draft => ({
  name: prize.name, cost: String(prize.cost), oneTime: prize.oneTime, link: prize.link ?? '', imageUrl: prize.imageUrl ?? '',
});

// The prize create / edit page. Self-contained by `target` so RootShell can force-render
// it while a save recovers after navigation; `onSaved` is supplied only by the routed pages.
export function PrizeEditor({ target, onSessionExpired, onSaved }: { target: PrizeTarget; onSessionExpired: () => void; onSaved?: () => void }) {
  const [prize, setPrize] = useState<Prize | null>(null);
  const [draft, setDraft] = useState<Draft | null>(target.kind === 'create' ? blank : null);
  const [loadError, setLoadError] = useState('');
  const [validation, setValidation] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const flow = useSaveFlow<PrizeIntent, Prize, Prize>({
    key: PRIZE_SAVE_KEY, request: prizeRequest, applyConflict: applyPrizeConflict,
    owns: (intent) => target.kind === 'create' ? intent.kind === 'create' : intent.kind === 'edit' && intent.id === target.id,
  });
  const locked = flow.phase === 'saving' || flow.phase === 'recover';
  const editId = target.kind === 'edit' ? target.id : null;

  // A fresh open clears a stale settled save; an in-flight one (RootShell recovery) is kept.
  useEffect(() => {
    if (!locked) flow.dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  useEffect(() => {
    if (!editId) return;
    const controller = new AbortController();
    setDraft(null);
    setLoadError('');
    requestJson<Prize>(`/api/prizes/${encodeURIComponent(editId)}`, { signal: controller.signal })
      .then(loaded => { if (!controller.signal.aborted) { setPrize(loaded); setDraft(toDraft(loaded)); } })
      .catch(error => {
        if (controller.signal.aborted) return;
        if (error instanceof RequestError && error.status === 401) onSessionExpired();
        else setLoadError(error instanceof RequestError && error.status === 404 ? 'This prize doesn’t exist.' : 'Couldn’t load this prize. Try again.');
      });
    return () => controller.abort();
  }, [editId, reloadKey, onSessionExpired]);

  function afterSave(outcome: Awaited<ReturnType<typeof flow.run>>) {
    if (outcome.phase === 'success') onSaved?.();
    else if (outcome.phase === 'recover' && outcome.signInRequired) onSessionExpired();
  }

  function submit(archived: boolean) {
    if (!draft || locked) return;
    setValidation('');
    const checked = validatePrizeFields({
      name: draft.name, cost: draft.cost === '' ? NaN : Number(draft.cost), oneTime: draft.oneTime,
      link: draft.link, imageUrl: draft.imageUrl, archived,
    });
    if ('error' in checked) { setValidation(checked.error); return; }
    const fields: PrizeFields = checked.fields;
    const intent: PrizeIntent = target.kind === 'create'
      ? { kind: 'create', fields }
      : { kind: 'edit', id: target.id, expectedRevision: prize!.revision, fields };
    void flow.run(intent).then(afterSave);
  }

  function reload() { flow.dismiss(); setReloadKey(key => key + 1); }

  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });
  const imageReady = draft && draft.imageUrl.trim() && isHttpsUrl(draft.imageUrl.trim()) ? draft.imageUrl.trim() : null;
  const archived = prize?.archived ?? false;
  const conflict = flow.phase === 'conflict' ? flow.conflict : undefined;
  const title = target.kind === 'create' ? 'Add prize' : (prize?.name ?? 'Prize');

  return <section className="child-profiles score-day scoring-day templates-editor catalog-editor">
    {!flow.frozen && <Link className={backLinkClass} to="/prizes" search={lastPrizeQuery()}><BackLabel>Prizes</BackLabel></Link>}
    <header className="scoring-day-head"><h1>{title}</h1></header>
    <p className="tpl-intro">Changes apply to future redemptions only. Past redemptions keep the name and cost they had.</p>
    {archived && <p role="note" className="tpl-retire-note">This prize is archived. It can’t be redeemed until you restore it.</p>}

    {loadError ? <div role="alert" className="tpl-loaderror"><p>{loadError}</p>
        <Button type="button" onClick={reload}>Try again</Button></div>
      : !draft ? <p role="status" className="tpl-loading">Loading prize…</p>
      : <form noValidate onSubmit={event => { event.preventDefault(); submit(false); }}>
          <fieldset disabled={flow.frozen}>
            <label htmlFor="prize-name">Name</label>
            <Input id="prize-name" required maxLength={PRIZE_NAME_MAX} placeholder="e.g. Lego set" value={draft.name}
              onChange={event => set({ name: event.target.value })} />

            <label htmlFor="prize-cost">Cost in stars</label>
            <Input id="prize-cost" type="number" inputMode="numeric" required min={1} max={PRIZE_COST_MAX} step={1} value={draft.cost}
              onChange={event => set({ cost: event.target.value })} />

            <fieldset className="catalog-kind">
              <legend>How often can a child redeem it?</legend>
              <label><input type="radio" name="prize-kind" checked={!draft.oneTime} onChange={() => set({ oneTime: false })} />
                <span><strong>Repeatable</strong><small>Any number of times, like ice cream or screen time.</small></span></label>
              <label><input type="radio" name="prize-kind" checked={draft.oneTime} onChange={() => set({ oneTime: true })} />
                <span><strong>One-time</strong><small>Once per child, like a toy. Voiding the redemption allows it again.</small></span></label>
            </fieldset>

            <label htmlFor="prize-link">Store link <span className="catalog-optional">(optional)</span></label>
            <Input id="prize-link" type="url" inputMode="url" maxLength={PRIZE_URL_MAX} placeholder="https://shopee.co.id/…" value={draft.link}
              onChange={event => set({ link: event.target.value })} />

            <label htmlFor="prize-image">Image address <span className="catalog-optional">(optional)</span></label>
            <Input id="prize-image" type="url" inputMode="url" maxLength={PRIZE_URL_MAX} placeholder="https://…" value={draft.imageUrl}
              aria-describedby="prize-image-help" onChange={event => set({ imageUrl: event.target.value })} />
            <p id="prize-image-help" className="catalog-help">On the product page, right-click (or long-press) the main photo and choose <strong>Copy image address</strong>. The image stays on the store’s site.</p>
            <div className="catalog-preview" aria-label="Preview">
              <PrizeImage src={imageReady} size="preview" />
              <span className="catalog-preview-body">
                <span className="catalog-card-name">{draft.name.trim() || 'Prize name'}</span>
                {Number(draft.cost) >= 1 && <PrizeCost cost={Math.floor(Number(draft.cost))} />}
              </span>
            </div>

            {validation && <p role="alert" className="tpl-validation">{validation}</p>}
            <div className="tpl-save-row">
              <Button type="submit" className="assign-save tpl-save">{target.kind === 'create' ? 'Add prize' : archived ? 'Save and restore' : 'Save prize'}</Button>
              {target.kind === 'edit' && !archived && <Button type="button" className="tpl-retire catalog-archive" onClick={() => submit(true)}>Archive prize</Button>}
            </div>
          </fieldset>
        </form>}

    {flow.phase === 'saving' && <p role="status" className="tpl-savestatus">Saving…</p>}
    {flow.phase === 'rejected' && <p role="alert" className="tpl-validation">{flow.error}</p>}
    {conflict && <div className="child-profiles-save">
      <div>
        <p><strong>Someone else changed this prize</strong> · now {conflict.name}, {conflict.cost} stars{conflict.archived ? ', archived' : ''}.</p>
        <Button type="button" onClick={() => void flow.applyOverConflict().then(afterSave)}>Apply my change</Button>
      </div>
      <Button type="button" className="tpl-cancel" onClick={reload}>Keep current</Button>
    </div>}
    {flow.phase === 'recover' && <div role="alert" className="child-profiles-save">
      <p>Save not confirmed. Keep this page open to retain the retry key.</p>
      <Button type="button" onClick={() => void flow.retry().then(afterSave)}>Check / retry</Button>
    </div>}
  </section>;
}
