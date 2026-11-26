import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { AssignmentDetail, RuleSave, TemplateSummary } from '../../../shared/profiles';
import { nextDate, shiftDate } from '../../../worker/calendar';
import { BackLabel, backLinkClass } from './BackLink';
import { draftProblem, pauseDay, PauseDates, type PauseDraft } from './PauseDates';
import { requestJson, RequestError, RULE_SAVE_KEY, ruleRequest, type RuleConflict, type RuleIntent } from './requests';
import { useSaveFlow } from './save-flow';
import { useHouseholdProfiles } from './useHouseholdProfiles';
import './child-profiles.css';

export const PAUSES_PATH = '/api/pauses';

function nameAt(templates: TemplateSummary[], id: string, date: string) {
  const template = templates.find(item => item.id === id);
  const version = template?.pending && template.pending.effectiveDate <= date ? template.pending : template?.current;
  return version && !version.retired ? version.name : '';
}

// Pause routines for one or more children in a single all-or-nothing save, for
// example a family holiday. Reached from Templates, or from a child's assignments
// with that child (and optionally one template) preselected.
export function PauseRoutines({ childId, templateId, onSessionExpired }: {
  childId?: string;
  templateId?: string;
  onSessionExpired: () => void;
}) {
  const { data, templates, loading, error, load: reloadProfiles } = useHouseholdProfiles(onSessionExpired);
  const today = data?.today ?? '';
  const tomorrow = today ? nextDate(today) : '';
  const active = (data?.children ?? []).filter(child => !child.archiveEffectiveDate || child.archiveEffectiveDate > nextDate(today))
    .sort((a, b) => Number(b.id === childId) - Number(a.id === childId));

  const [details, setDetails] = useState<Record<string, AssignmentDetail> | null>(null);
  const [detailsError, setDetailsError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<PauseDraft>({ startDate: '', endDate: '', reason: '' });
  const [selected, setSelected] = useState<Record<string, string[]>>(childId && templateId ? { [childId]: [templateId] } : {});
  const [saved, setSaved] = useState('');

  const flow = useSaveFlow<RuleIntent, RuleSave, RuleConflict>({
    key: RULE_SAVE_KEY, request: ruleRequest, owns: intent => intent.path === PAUSES_PATH,
  });
  const frozen = flow.frozen;
  const activeIds = active.map(child => child.id).join(',');

  useEffect(() => {
    if (today && !draft.startDate) setDraft(current => ({ ...current, startDate: nextDate(today), endDate: shiftDate(today, 7) }));
  }, [today, draft.startDate]);

  // Each child's latest plan and pauses; the revision guards the save.
  useEffect(() => {
    if (!activeIds) { setDetails({}); return; }
    const controller = new AbortController();
    setDetailsError(false);
    Promise.all(activeIds.split(',').map(id =>
      requestJson<AssignmentDetail>(`/api/children/${encodeURIComponent(id)}/assignments`, { signal: controller.signal })
        .then(detail => [id, detail] as const)))
      .then(entries => { if (!controller.signal.aborted) setDetails(Object.fromEntries(entries)); })
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure instanceof RequestError && failure.status === 401) onSessionExpired();
        else setDetailsError(true);
      });
    return () => controller.abort();
  }, [activeIds, reloadKey, onSessionExpired]);

  const choices = Object.entries(selected).filter(([, ids]) => ids.length);
  const count = choices.reduce((total, [, ids]) => total + ids.length, 0);
  const problem = draftProblem(draft, draft.startDate || tomorrow);

  async function submit(intent?: RuleIntent) {
    if (!details || frozen) return;
    const reason = draft.reason.trim();
    const next = intent ?? { path: PAUSES_PATH, method: 'POST' as const,
      label: `${count} ${count === 1 ? 'routine' : 'routines'} paused ${pauseDay(draft.startDate)} – ${pauseDay(draft.endDate)}`,
      body: { startDate: draft.startDate, endDate: draft.endDate, ...(reason ? { reason } : {}),
        children: choices.map(([id, templateIds]) => ({ childId: id, expectedRevision: details[id]?.revision ?? 0, templateIds })) } };
    setSaved('');
    const outcome = intent ? await flow.retry() : await flow.run(next);
    if (outcome.phase === 'success') {
      setSaved(`Saved. ${next.label}.`);
      setSelected({});
      setReloadKey(key => key + 1);
      flow.dismiss();
    } else if (outcome.phase === 'recover' && outcome.signInRequired) onSessionExpired();
  }

  function reloadAll() {
    flow.dismiss();
    void reloadProfiles();
    setReloadKey(key => key + 1);
  }

  const back = childId
    ? <Link className={backLinkClass} to="/children/$childId/assignments" params={{ childId }}><BackLabel>Assignments</BackLabel></Link>
    : <Link className={backLinkClass} to="/templates"><BackLabel>Activity templates</BackLabel></Link>;

  if (error) return <section className="child-profiles"><div role="alert">
    <p>Couldn’t load the household. Check your connection and try again.</p>
    <Button type="button" onClick={() => void reloadProfiles()}>Try again</Button>
  </div></section>;

  return <section className="child-profiles score-day scoring-day assignments-page pause-page" aria-labelledby="pause-title" aria-busy={loading}>
    {!frozen && back}
    <header className="scoring-day-head"><h1 id="pause-title">Pause routines</h1></header>
    <p className="assign-intro">Pick the dates and the routines to stop. Each one comes back by itself after the last paused day. Pauses start tomorrow at the earliest.</p>

    {(!data || (!details && !detailsError)) && <p role="status">Loading…</p>}
    {detailsError && <div role="alert"><p>Couldn’t load the children’s assignments. Try again.</p>
      <Button type="button" onClick={() => setReloadKey(key => key + 1)}>Try again</Button></div>}

    {data && details && <form onSubmit={event => { event.preventDefault(); if (!problem && count) void submit(); }}>
      <fieldset disabled={frozen}>
        <PauseDates draft={draft} today={today} disabled={frozen} onChange={setDraft} />
        {!active.length && <p className="assign-empty">No active children.</p>}
        {active.map(child => {
          const detail = details[child.id];
          const planned = (detail?.pending ?? detail?.current)?.templateIds ?? [];
          const chosen = selected[child.id] ?? [];
          return <fieldset className="child-profiles-templates pause-child" key={child.id}>
            <legend>{child.displayName}</legend>
            {!planned.length && <p className="assign-empty">No templates assigned.</p>}
            {planned.map(id => {
              const name = nameAt(templates, id, tomorrow) || 'Unavailable template';
              const existing = detail?.pauses.filter(pause => pause.templateId === id) ?? [];
              return <label className="child-profiles-template" key={id}>
                <Checkbox disabled={frozen} aria-label={`${child.displayName} · ${name}`} checked={chosen.includes(id)}
                  onCheckedChange={checked => setSelected(current => ({ ...current,
                    [child.id]: checked ? [...chosen, id] : chosen.filter(item => item !== id) }))} />
                <span>{name}{existing.length > 0 && <small>{existing.map(pause =>
                  `Paused ${pauseDay(pause.startDate)} – ${pauseDay(pause.endDate)}`).join(' · ')}</small>}</span>
              </label>;
            })}
          </fieldset>;
        })}
        <Button type="submit" className="assign-save" disabled={!count || !!problem}>
          {count ? `Pause ${count} ${count === 1 ? 'routine' : 'routines'}` : 'Choose routines to pause'}
        </Button>
      </fieldset>
    </form>}

    {flow.phase === 'saving' && <p role="status">Saving pauses…</p>}
    {flow.phase === 'rejected' && <div className="child-profiles-save" role="alert"><p>{flow.error}</p>
      <Button type="button" className="modal-cancel" onClick={() => flow.dismiss()}>Adjust the pause</Button>
    </div>}
    {flow.phase === 'conflict' && <div className="child-profiles-save" role="alert">
      <p>A child’s assignments or pauses changed since you opened this page. Nothing was paused. Reload, then review your choices.</p>
      <Button type="button" className="modal-cancel" onClick={reloadAll}>Reload latest</Button>
    </div>}
    {flow.phase === 'recover' && flow.intent && <div role="alert">
      <p>Save not confirmed for {flow.intent.label}. Keep this page open to retain the retry key.</p>
      <Button type="button" onClick={() => void submit(flow.intent)}>Check / retry</Button>
    </div>}
    {saved && <p role="status">{saved}</p>}
  </section>;
}

