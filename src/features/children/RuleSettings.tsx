import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nextDate } from '../../../worker/calendar';
import { useHouseholdProfiles } from './useHouseholdProfiles';
import { useEffect, useRef, useState } from 'react';
import type { AssignmentDetail, Child, TemplateDetail, TemplateSummary, TemplateVersion } from '../../../shared/profiles';
import { clearRuleSave, requestJson, RequestError, retryRule, submitRule, useRuleSave } from './requests';
import { moveItem, TemplatePicker } from './TemplatePicker';
import './rule-settings.css';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type DraftActivity = { key: string; id?: string; label: string; reward: string; penalty: string; weekdays: number[] };
const blankActivity = (): DraftActivity => ({
  key: crypto.randomUUID(), label: '', reward: '1', penalty: '', weekdays: [1, 2, 3, 4, 5, 6, 7],
});
type Target = { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'assignment'; child: Child };
type Draft =
  | { kind: 'template'; detail: TemplateDetail | null; name: string; activities: DraftActivity[]; retire: boolean }
  | { kind: 'assignment'; detail: AssignmentDetail; ids: string[]; additions?: string[]; startToday?: boolean };

function pathFor(target: Target) {
  if (target.kind === 'assignment') return `/api/children/${encodeURIComponent(target.child.id)}/assignments`;
  return target.kind === 'edit' ? `/api/templates/${encodeURIComponent(target.id)}` : '/api/templates';
}

function versionFor(template: TemplateSummary, date: string) {
  return template.pending && template.pending.effectiveDate <= date ? template.pending : template.current;
}

function Definition({ version }: { version: TemplateVersion | null }) {
  if (!version) return <p>No template effective today.</p>;
  if (version.retired) return <p>Retired from {version.effectiveDate}.</p>;
  return <Collapsible><CollapsibleTrigger>{version.name}</CollapsibleTrigger>
    <CollapsibleContent><ol>{version.activities.map(activity => <li key={activity.id}>
      {activity.label} · +{activity.reward} stars
      {activity.penalty ? ` · −${activity.penalty} stars` : ''}
      {' · '}{activity.weekdays?.map(day => weekdays[day - 1]).join(', ') ?? 'Every day'}
    </li>)}</ol></CollapsibleContent>
  </Collapsible>;
}

export function RuleSettings({ onSessionExpired }: { onSessionExpired: () => void }) {
  const { data, templates, loading, error, load: reload } = useHouseholdProfiles(onSessionExpired);
  const today = data?.today ?? '';
  const tomorrow = today ? nextDate(today) : '';
  const children = data?.children.filter(child => !child.archiveEffectiveDate || child.archiveEffectiveDate > tomorrow) ?? [];
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [validation, setValidation] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const save = useRuleSave();
  const locked = save.status === 'saving' || save.status === 'uncertain';
  const modalOpen = Boolean(target) || locked;
  const conflict = save.status === 'rejected' ? save.current : undefined;
  const startToday = draft?.kind === 'assignment' && draft.startToday === true;
  const selectedAssignments = draft?.kind === 'assignment' ? (startToday ? draft.additions ?? [] : draft.ids) : [];
  const effectiveDate = target?.kind === 'create' || startToday ? today : tomorrow;
  const assignmentOptions = templates.flatMap(template => {
    const version = versionFor(template, effectiveDate);
    if (startToday && draft.detail.current?.templateIds.includes(template.id)) return [];
    return version && !version.retired ? [{ id: template.id, version }] : [];
  });

  useEffect(() => {
    if (save.status === 'success') {
      setTarget(null);
      setDraft(null);
      void reload();
    }
    if (save.status === 'uncertain' && save.signInRequired) onSessionExpired();
  }, [save, reload, onSessionExpired]);

  useEffect(() => {
    if (!modalOpen) opener.current?.focus();
  }, [modalOpen]);

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    setDraft(null);
    setExpanded(null);
    setLoadError('');
    setValidation('');
    heading.current?.focus();
    async function load(selected: Target) {
      try {
        if (selected.kind === 'assignment') {
          const detail = await requestJson<AssignmentDetail>(pathFor(selected), { signal: controller.signal });
          if (!controller.signal.aborted) setDraft({ kind: 'assignment', detail, ids: (detail.pending ?? detail.current)?.templateIds ?? [] });
        } else {
          const detail = selected.kind === 'edit'
            ? await requestJson<TemplateDetail>(pathFor(selected), { signal: controller.signal }) : null;
          const version = detail?.pending ?? detail?.current;
          const activities = version ? version.activities.map(activity => ({
            key: activity.id, id: activity.id, label: activity.label, reward: String(activity.reward),
            penalty: activity.penalty === undefined ? '' : String(activity.penalty),
            weekdays: activity.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
          })) : [blankActivity()];
          if (!controller.signal.aborted) {
            setDraft({ kind: 'template', detail, name: version?.name ?? '', activities, retire: false });
            if (selected.kind === 'create') setExpanded(activities[0].key);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof RequestError && error.status === 401) onSessionExpired();
        else setLoadError('Couldn’t load these rules. Try again.');
      }
    }
    void load(target);
    return () => controller.abort();
  }, [target, onSessionExpired]);

  function open(selected: Target, trigger?: HTMLElement) {
    if (trigger) opener.current = trigger;
    clearRuleSave();
    setDraft(null);
    setExpanded(null);
    setTarget({ ...selected });
  }

  function submit(reviewedRevision?: number) {
    if (!target || !draft || locked || (conflict && reviewedRevision === undefined)) return;
    setValidation('');
    if (draft.kind === 'assignment') {
      const expectedRevision = reviewedRevision ?? (draft.detail.pending ?? draft.detail.current)?.revision;
      void submitRule({ path: pathFor(target), method: 'PUT',
        label: target.kind === 'assignment' ? `Assignments for ${target.child.displayName}` : 'Assignments',
        body: { expectedRevision, templateIds: selectedAssignments, ...(startToday ? { startToday } : {}) } });
      return;
    }
    const latest = draft.detail?.pending ?? draft.detail?.current;
    const operation = latest?.retired ? 'cancelRetirement' : draft.retire ? 'retire' : 'save';
    const expectedRevision = reviewedRevision ?? latest?.revision;
    if (operation !== 'save') {
      void submitRule({ path: pathFor(target), method: 'PUT', label: draft.name, body: { expectedRevision, operation } });
      return;
    }
    if (!draft.activities.length) { setValidation('Add at least one activity to save.'); return; }
    const invalid = draft.activities.find(activity => !activity.label.trim() || !activity.weekdays.length
      || !Number.isInteger(Number(activity.reward)) || Number(activity.reward) < 1 || Number(activity.reward) > 999
      || !Number.isInteger(Number(activity.penalty)) || Number(activity.penalty) < 0 || Number(activity.penalty) > 999);
    if (invalid) {
      setExpanded(invalid.key);
      setValidation(`Check activity ${draft.activities.indexOf(invalid) + 1}. Enter a label, a reward of 1–999 whole stars, an optional penalty of 0–999 whole stars, and at least one weekday.`);
      return;
    }
    void submitRule({ path: pathFor(target), method: target.kind === 'create' ? 'POST' : 'PUT', label: draft.name,
      body: { expectedRevision, name: draft.name, activities: draft.activities.map(activity => ({
        id: activity.id, label: activity.label, rewardPoints: Number(activity.reward),
        penaltyPoints: activity.penalty === '' ? undefined : Number(activity.penalty), weekdays: activity.weekdays,
      })) },
    });
  }

  function editActivity(activity: DraftActivity, patch: Partial<DraftActivity>) {
    if (draft?.kind !== 'template') return;
    setDraft({ ...draft, activities: draft.activities.map(item => item.key === activity.key ? { ...item, ...patch } : item) });
  }

  const pendingRetirement = draft?.kind === 'template' && draft.detail?.pending?.retired;
  const retired = draft?.kind === 'template' && draft.detail?.current?.retired;
  const editable = !retired && !pendingRetirement && !(draft?.kind === 'template' && draft.retire);
  const assignmentNames = (ids: string[], date: string) => ids.map(id => {
    const template = templates.find(item => item.id === id);
    const version = template && versionFor(template, date);
    return version && !version.retired ? version.name : '';
  }).filter(Boolean).join(', ') || 'No templates';

  return <section className="child-profiles rule-settings" aria-labelledby="rules-title" aria-busy={loading}>
    <div className="child-profiles-heading">
      <h1 id="rules-title">Templates &amp; assignments</h1>
      <Button type="button" disabled={locked || loading || !data} onClick={event => open({ kind: 'create' }, event.currentTarget)}>Create template</Button>
    </div>
    {loading && <p role="status">Loading templates and assignments…</p>}
    {error && <div role="alert"><p>Couldn’t load templates and assignments.</p>
      <Button type="button" onClick={() => void reload()}>Try again</Button>
    </div>}
    {data && <>
    <h2>Activity templates</h2>
    {!templates.length && <p>No templates yet.</p>}
    <ul className="child-profiles-list">
      {templates.map(template => {
        const version = template.current ?? template.pending!;
        return <li key={template.id} className="child-profiles-card">
          <div><h3>{version.name}</h3>
            <p>{version.activities?.slice(0, 3).map(activity => activity.label).join(' · ')}</p>
            {version.retired && <p>Retired from {version.effectiveDate}</p>}
            {template.pending && <p>{template.pending.retired ? 'Retirement' : 'Scheduled change'} · {template.pending.effectiveDate}</p>}
          </div>
          <Button type="button" disabled={locked} onClick={event => open({ kind: 'edit', id: template.id }, event.currentTarget)}
            aria-label={`${version.retired ? 'View' : 'Edit'} ${version.name}${version.activities?.[0] ? `, ${version.activities[0].label}` : ''}`}>
            {version.retired ? 'View' : 'Edit'}
          </Button>
        </li>;
      })}
    </ul>
    <h2>Assignments</h2>
    {!children.length && <p>No children available for assignment changes.</p>}
    <ul className="child-profiles-list">{children.map(child => <li className="child-profiles-card" key={child.id}>
      <div><p>{child.displayName}</p></div>
      <Button type="button" disabled={locked} onClick={event => open({ kind: 'assignment', child }, event.currentTarget)}
        aria-label={`Edit assignments for ${child.displayName}`}>Edit assignments</Button>
    </li>)}</ul>
    </>}

    <Dialog open={modalOpen} onOpenChange={(open) => {
      if (!open && !locked) { setTarget(null); clearRuleSave(); }
    }}>
    <DialogContent showCloseButton={false} className="child-profiles rule-settings child-profiles-modal rule-editor" aria-labelledby="rule-editor-title" aria-describedby={undefined}>
    {!target && <h3 className="modal-title" id="rule-editor-title">Recover rule save</h3>}
    {target && <>
      <h3 className="modal-title" ref={heading} tabIndex={-1} id="rule-editor-title">
        {target.kind === 'create' ? 'Create template' : target.kind === 'assignment' ? `Assignments for ${target.child.displayName}` : 'Template details'}
      </h3>
      {loadError ? <div role="alert"><p>{loadError}</p><Button type="button" onClick={() => open(target)}>Try again</Button></div>
        : !draft && <p role="status">Loading rules…</p>}
      {draft && <form onSubmit={event => { event.preventDefault(); submit(); }}>
        <fieldset disabled={locked || Boolean(conflict)}>
          {draft.kind === 'assignment' ? <>
            <p><strong>Active today</strong> · {assignmentNames(draft.detail.current?.templateIds ?? [], today)}</p>
            <p><strong>Effective tomorrow</strong> · {assignmentNames(draft.detail.pending?.templateIds ?? draft.detail.current?.templateIds ?? [], tomorrow)}</p>
            <label className="child-profiles-template">
              <Checkbox disabled={locked || Boolean(conflict)} checked={startToday} onCheckedChange={checked => {
                const saved = (draft.detail.pending ?? draft.detail.current)?.templateIds ?? [];
                setDraft({ ...draft, startToday: checked,
                  additions: draft.additions ?? draft.ids.filter(id => !saved.includes(id)
                    && !draft.detail.current?.templateIds.includes(id)
                    && templates.some(template => template.id === id && template.current && !template.current.retired)) });
              }}/>
              <span>Start new templates today<small>Add to today’s checklist and carry the additions into tomorrow’s plan.</small></span>
            </label>
            <TemplatePicker title={startToday ? 'Templates to add today' : 'Templates in checklist order'} disabled={locked || Boolean(conflict)} options={assignmentOptions} selected={selectedAssignments}
              onChange={ids => setDraft(startToday ? { ...draft, additions: ids } : { ...draft, ids })}/>
          </> : <>
            {draft.detail && <>
              <p><strong>Active today</strong></p>
              <Definition version={draft.detail.current}/>
              {!retired && <>
                <p><strong>Effective tomorrow</strong></p>
                <Definition version={draft.detail.pending ?? draft.detail.current}/>
                <p>Affected children on {effectiveDate}: {draft.detail.affectedChildren.join(', ') || 'None'}</p>
              </>}
            </>}
            {editable && <>
              <label>Template name<Input required maxLength={80} value={draft.name}
                onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
              <ol className="rule-activities">{draft.activities.map((activity, index) => {
                const open = expanded === activity.key;
                return <li key={activity.key}>
                  <Button type="button" className="rule-activity-toggle" aria-expanded={open}
                    aria-controls={`activity-${activity.key}`} onClick={() => setExpanded(open ? null : activity.key)}>
                    {activity.label || 'New activity'}
                  </Button>
                  <div id={`activity-${activity.key}`} hidden={!open}>
                    {open && <>
                      <label>Activity label<Input required maxLength={80} value={activity.label}
                        onChange={event => editActivity(activity, { label: event.target.value })}/></label>
                      <label>Reward (stars)<Input type="number" required min={1} max={999} value={activity.reward}
                        onChange={event => editActivity(activity, { reward: event.target.value })}/></label>
                      <label>Penalty (optional)<Input type="number" min={0} max={999} value={activity.penalty}
                        onChange={event => editActivity(activity, { penalty: event.target.value })}/></label>
                      <fieldset className="rule-weekdays"><legend>Weekdays</legend>
                        {weekdays.map((day, dayIndex) => <label key={day} className="child-profiles-template">
                          <Checkbox disabled={locked || Boolean(conflict)} checked={activity.weekdays.includes(dayIndex + 1)}
                            onCheckedChange={checked => editActivity(activity, { weekdays: checked
                              ? [...activity.weekdays, dayIndex + 1].sort() : activity.weekdays.filter(value => value !== dayIndex + 1) })}/>{day}
                        </label>)}
                      </fieldset>
                      <div className="child-profiles-actions">
                        <Button type="button" disabled={index === 0} onClick={() => setDraft({ ...draft, activities: moveItem(draft.activities, index, -1) })}>Move up</Button>
                        <Button type="button" disabled={index === draft.activities.length - 1} onClick={() => setDraft({ ...draft, activities: moveItem(draft.activities, index, 1) })}>Move down</Button>
                        <Button type="button" onClick={() => {
                          setDraft({ ...draft, activities: draft.activities.filter(item => item.key !== activity.key) });
                          heading.current?.focus();
                        }}>Remove activity</Button>
                      </div>
                    </>}
                  </div>
                </li>;
              })}</ol>
              <div className="child-profiles-actions">
                <Button type="button" disabled={draft.activities.length >= 30} onClick={() => {
                  const activity = blankActivity();
                  setDraft({ ...draft, activities: [...draft.activities, activity] });
                  setExpanded(activity.key);
                }}>Add activity</Button>
                {draft.detail && <Button type="button" onClick={() => setDraft({ ...draft, retire: true })}>Retire template</Button>}
              </div>
            </>}
            {draft.retire && <p>From {effectiveDate}, this template will stop appearing on checklists. Earlier dates will keep their rules.</p>}
          </>}
          {!retired && <>
            <p>Effective <time dateTime={effectiveDate}>{effectiveDate}</time> · Jakarta</p>
            <Button type="submit" disabled={draft.kind === 'assignment' ? startToday && !selectedAssignments.length : editable && !draft.activities.length}>
              {draft.kind === 'assignment' ? 'Save assignments' : pendingRetirement ? 'Cancel scheduled retirement'
                : draft.retire ? 'Confirm retirement' : 'Save template'}
            </Button>
          </>}
        </fieldset>
        {validation && <p role="alert">{validation}</p>}
      </form>}
      <div className="child-profiles-actions modal-footer">
        {draft?.kind === 'template' && draft.retire && !locked && !conflict && <Button type="button" className="modal-cancel" onClick={() => setDraft({ ...draft, retire: false })}>Keep editing</Button>}
        <Button type="button" className="modal-cancel" disabled={locked} onClick={() => {
          setTarget(null); clearRuleSave();
        }}>{retired ? 'Close' : 'Cancel'}</Button>
      </div>
    </>}
    {save.status === 'saving' && <p role="status">Saving {save.intent.label}…</p>}
    {save.status === 'rejected' && <div className="child-profiles-save"><p role="alert">{save.message}</p>
      {conflict && <div>
        <p><strong>Latest scheduled rules</strong> · Revision {(conflict.pending ?? conflict.current)?.revision}</p>
        {'affectedChildren' in conflict
          ? <Definition version={conflict.pending ?? conflict.current}/>
          : <p>{assignmentNames((conflict.pending ?? conflict.current)?.templateIds ?? [], tomorrow)}</p>}
        <p><strong>Your change</strong></p>
        {draft?.kind === 'assignment' && <p>{startToday ? 'Add today · ' : ''}{assignmentNames(selectedAssignments, effectiveDate)}</p>}
        {draft?.kind === 'template' && <p>{draft.name} · {draft.detail?.pending?.retired ? 'Cancel retirement'
          : draft.retire ? 'Retire template' : draft.activities.map(activity => `${activity.label} (+${activity.reward})`).join(', ')}</p>}
        <Button type="button" onClick={() => submit((conflict.pending ?? conflict.current)?.revision)}>Apply my change</Button>
      </div>}
      {target && <Button type="button" className="modal-cancel" onClick={() => { void reload(); open(target); }}>{conflict ? 'Keep current' : 'Reload latest rules'}</Button>}
    </div>}
    {save.status === 'uncertain' && <div role="alert">
      <p>Save not confirmed for {save.intent.label}. Keep this page open to retain the retry key.</p>
      <Button type="button" onClick={() => void retryRule()}>Check / retry</Button>
    </div>}
    </DialogContent>
    </Dialog>
    {save.status === 'success' && <p role="status">Saved {save.intent.label}. Effective {save.result.effectiveDate} · Jakarta.</p>}
  </section>;
}
