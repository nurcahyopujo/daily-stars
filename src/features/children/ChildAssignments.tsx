import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarClock } from "lucide-react";
import { Link, useNavigate } from '@tanstack/react-router';
import { BackLabel, backLinkClass } from './BackLink';
import { useEffect, useRef, useState } from 'react';
import { nextDate } from '../../../worker/calendar';
import type { AssignmentDetail, RuleSave, TemplateSummary } from '../../../shared/profiles';
import { requestJson, RequestError, RULE_SAVE_KEY, ruleRequest, type RuleConflict, type RuleIntent } from './requests';
import { useSaveFlow } from './save-flow';
import { TemplatePicker } from './TemplatePicker';
import { ChildPauses, type PauseEdit } from './ChildPauses';
import { useHouseholdProfiles } from './useHouseholdProfiles';
import './child-profiles.css';

function versionFor(template: TemplateSummary, date: string) {
  return template.pending && template.pending.effectiveDate <= date ? template.pending : template.current;
}

// Household dates are plain Jakarta calendar strings; format them from UTC midnight
// so the weekday/day never shifts with the viewer's own time zone.
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
function dayLabel(iso: string) {
  return iso ? dayFormat.format(new Date(iso + 'T00:00:00Z')) : '';
}

// The routines scheduled for one day, as pills — or a quiet note when the day is clear.
function Chips({ names }: { names: string[] }) {
  if (!names.length) return <span className="assign-empty">No templates</span>;
  return <span className="assign-chips">{names.map(name => <span className="assign-chip" key={name}>{name}</span>)}</span>;
}

// A standalone, child-scoped version of the assignment editor that used to live in the modal on the
// templates page. Self-contained by childId so RootShell can force-render it while a save recovers.
export function ChildAssignments({ childId, onSessionExpired }: { childId: string; onSessionExpired: () => void }) {
  const { data, templates, loading, error, load: reload } = useHouseholdProfiles(onSessionExpired);
  const navigate = useNavigate();
  const child = data?.children.find(candidate => candidate.id === childId);
  const today = data?.today ?? '';
  const tomorrow = today ? nextDate(today) : '';
  const eligible = !child?.archiveEffectiveDate || child.archiveEffectiveDate > tomorrow;

  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [additions, setAdditions] = useState<string[]>([]);
  const [startToday, setStartToday] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const path = `/api/children/${encodeURIComponent(childId)}/assignments`;
  const pausePath = `/api/children/${encodeURIComponent(childId)}/pauses/`;
  // The rule key is shared with the templates page; `owns` masks the flow to this child's saves.
  const flow = useSaveFlow<RuleIntent, RuleSave, RuleConflict>({
    key: RULE_SAVE_KEY, request: ruleRequest, owns: (intent) => intent.path === path || intent.path.startsWith(pausePath),
  });
  const pauseIntent = !!flow.intent?.path.startsWith(pausePath);
  const frozen = flow.frozen;
  const conflict = flow.phase === 'conflict' && flow.conflict && !('affectedChildren' in flow.conflict)
    ? flow.conflict : undefined;
  const assignmentConflict = pauseIntent ? undefined : conflict;

  const selectedAssignments = startToday ? additions : ids;
  const effectiveDate = startToday ? today : tomorrow;
  const assignmentOptions = detail ? templates.flatMap(template => {
    if (startToday && detail.current?.templateIds.includes(template.id)) return [];
    const version = versionFor(template, effectiveDate);
    return version && !version.retired ? [{ id: template.id, version }] : [];
  }) : [];
  const nameList = (list: string[], date: string) => list.map(id => {
    const template = templates.find(item => item.id === id);
    const version = template && versionFor(template, date);
    return version && !version.retired ? version.name : '';
  }).filter(Boolean);
  const assignmentNames = (list: string[], date: string) => nameList(list, date).join(', ') || 'No templates';

  useEffect(() => {
    if (data && !child) void navigate({ to: '/' });
  }, [data, child, navigate]);

  // Load this child's current/pending assignments; default the picker to the latest planned templates.
  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    async function load() {
      try {
        const loaded = await requestJson<AssignmentDetail>(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setDetail(loaded);
        setIds((loaded.pending ?? loaded.current)?.templateIds ?? []);
        setAdditions([]);
        setStartToday(false);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof RequestError && failure.status === 401) onSessionExpired();
        else setLoadError('Couldn’t load these assignments. Try again.');
      }
    }
    void load();
    return () => controller.abort();
  }, [path, reloadKey, onSessionExpired]);

  // Pause intents carry their whole confirmation as the label; assignment saves name the effective date.
  function confirmation(intent: RuleIntent, result: RuleSave) {
    return intent.path.startsWith(pausePath) ? `Saved. ${intent.label}.` : `Saved ${intent.label}. Effective ${result.effectiveDate} · Jakarta.`;
  }

  function handle(outcome: Awaited<ReturnType<typeof flow.run>>, intent: RuleIntent | undefined) {
    if (outcome.phase === 'success') {
      if (intent) setSaved(confirmation(intent, outcome.result));
      void reload();
      setReloadKey(key => key + 1);
    } else if (outcome.phase === 'recover' && outcome.signInRequired) onSessionExpired();
  }

  function toggleStartToday(checked: boolean) {
    if (!detail) return;
    setStartToday(checked);
    if (checked && !additions.length) {
      const saved = (detail.pending ?? detail.current)?.templateIds ?? [];
      setAdditions(ids.filter(id => !saved.includes(id)
        && !detail.current?.templateIds.includes(id)
        && templates.some(template => template.id === id && template.current && !template.current.retired)));
    }
  }

  async function submit(reviewedRevision?: number) {
    if (!detail || frozen && reviewedRevision === undefined) return;
    const expectedRevision = reviewedRevision ?? detail.revision;
    const intent: RuleIntent = { path, method: 'PUT', label: `Assignments for ${child?.displayName ?? 'child'}`,
      body: { expectedRevision, templateIds: selectedAssignments, ...(startToday ? { startToday } : {}) } };
    setSaved(null);
    handle(await flow.run(intent), intent);
  }
  async function savePause(pauseId: string, edit: PauseEdit, label: string) {
    if (!detail || frozen) return;
    const intent: RuleIntent = { path: pausePath + encodeURIComponent(pauseId), method: 'PUT', label,
      body: { expectedRevision: detail.revision, ...edit } };
    setSaved(null);
    handle(await flow.run(intent), intent);
  }
  function recheck() {
    const intent = flow.intent;
    void flow.retry().then(outcome => handle(outcome, intent));
  }

  if (error) return <section className="child-profiles"><div role="alert">
    <p>Couldn’t load this child. Check your connection and try again.</p>
    <Button type="button" onClick={() => void reload()}>Try again</Button>
  </div></section>;
  if (!data || !child) return <section className="child-profiles"><p role="status" aria-busy={loading}>Loading…</p></section>;

  return <section className="child-profiles score-day scoring-day assignments-page" aria-busy={loading}>
    {!frozen && <Link className={backLinkClass} to="/children/$childId" params={{ childId }}><BackLabel>{child.displayName}</BackLabel></Link>}
    <header className="scoring-day-head">
      <h1 ref={heading} tabIndex={-1}>{child.displayName} · Assignments</h1>
    </header>
    <p className="assign-intro">A change takes effect from the next Jakarta day, so today’s checklist is never rewritten.</p>

    {loadError ? <div role="alert"><p>{loadError}</p>
        <Button type="button" onClick={() => void reload()}>Try again</Button></div>
      : !detail ? <p role="status">Loading assignments…</p>
      : <>
        <div className="assign-schedule">
          <div className="assign-node is-today">
            <span className="assign-node-rail" aria-hidden="true"><span className="assign-node-dot" /></span>
            <div className="assign-node-body">
              <div className="assign-node-head">
                <span className="assign-node-when">Active today</span>
                {today && <span className="assign-node-date">{dayLabel(today)}</span>}
              </div>
              <Chips names={nameList(detail.current?.templateIds ?? [], today)} />
            </div>
          </div>
          <div className="assign-node is-tomorrow">
            <span className="assign-node-rail" aria-hidden="true"><span className="assign-node-dot" /></span>
            <div className="assign-node-body">
              <div className="assign-node-head">
                <span className="assign-node-when">Effective tomorrow</span>
                {tomorrow && <span className="assign-node-date">{dayLabel(tomorrow)}</span>}
              </div>
              <Chips names={nameList((detail.pending ?? detail.current)?.templateIds ?? [], tomorrow)} />
              {!detail.pending && <span className="assign-node-note">No change scheduled</span>}
            </div>
          </div>
        </div>

        {!eligible
          ? <p role="note" className="assign-archived">This child is archived and can’t receive assignment changes.</p>
          : <form onSubmit={event => { event.preventDefault(); void submit(); }}>
              <fieldset disabled={frozen}>
                <h3 className="assign-editor-title">Change the schedule</h3>
                <label className="assign-toggle">
                  <Checkbox disabled={frozen} checked={startToday} onCheckedChange={toggleStartToday}/>
                  <span className="assign-toggle-text">
                    <span className="assign-toggle-title">Start new templates today</span>
                    <small>Add to today’s checklist and carry the additions into tomorrow’s plan.</small>
                  </span>
                </label>
                <TemplatePicker title={startToday ? 'Templates to add today' : 'Templates in checklist order'}
                  disabled={frozen} options={assignmentOptions} selected={selectedAssignments}
                  onChange={next => startToday ? setAdditions(next) : setIds(next)}/>
                <p className="assign-effective">
                  <CalendarClock size={16} aria-hidden="true" />
                  <span>Takes effect <time dateTime={effectiveDate}>{dayLabel(effectiveDate)}</time> · Jakarta</span>
                </p>
                <Button type="submit" className="assign-save" disabled={startToday && !selectedAssignments.length}>Save assignments</Button>
              </fieldset>
            </form>}

        {eligible && <ChildPauses childId={childId} pauses={detail.pauses} today={today} disabled={frozen}
          planned={((detail.pending ?? detail.current)?.templateIds ?? []).flatMap(id => {
            const name = nameList([id], tomorrow)[0];
            return name ? [{ id, name }] : [];
          })}
          templateName={(id, date) => nameList([id], date)[0] ?? 'Unavailable template'}
          onSave={(pauseId, edit, label) => void savePause(pauseId, edit, label)} />}
      </>}

    {flow.phase === 'saving' && flow.intent && <p role="status">Saving {flow.intent.label}…</p>}
    {flow.phase === 'rejected' && <div className="child-profiles-save"><p role="alert">{flow.error}</p>
      <Button type="button" className="modal-cancel" onClick={() => { flow.dismiss(); void reload(); setReloadKey(key => key + 1); }}>Reload latest assignments</Button>
    </div>}
    {conflict && pauseIntent && <div className="child-profiles-save" role="alert">
      <p>These assignments or pauses changed since you opened them. Review the latest before changing the pause again.</p>
      <Button type="button" className="modal-cancel" onClick={() => { flow.dismiss(); setReloadKey(key => key + 1); }}>Reload latest pauses</Button>
    </div>}
    {assignmentConflict && <div className="child-profiles-save">
      <div>
        <p><strong>Latest scheduled assignments</strong> · Revision {assignmentConflict.revision}</p>
        <p>{assignmentNames((assignmentConflict.pending ?? assignmentConflict.current)?.templateIds ?? [], tomorrow)}</p>
        <p><strong>Your change</strong></p>
        <p>{startToday ? 'Add today · ' : ''}{assignmentNames(selectedAssignments, effectiveDate)}</p>
        <Button type="button" onClick={() => void submit(assignmentConflict.revision)}>Apply my change</Button>
      </div>
      <Button type="button" className="modal-cancel" onClick={() => { flow.dismiss(); void reload(); }}>Keep current</Button>
    </div>}
    {flow.phase === 'recover' && flow.intent && <div role="alert">
      <p>Save not confirmed for {flow.intent.label}. Keep this page open to retain the retry key.</p>
      <Button type="button" onClick={() => recheck()}>Check / retry</Button>
    </div>}
    {saved && <p role="status">{saved}</p>}
  </section>;
}
