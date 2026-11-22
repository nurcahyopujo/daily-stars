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
  return <details><summary>{version.name}</summary>
    <ol>{version.activities.map(activity => <li key={activity.id}>
      {activity.label} · +{activity.reward} stars
      {activity.penalty ? ` · −${activity.penalty} stars` : ''}
      {' · '}{activity.weekdays?.map(day => weekdays[day - 1]).join(', ') ?? 'Every day'}
    </li>)}</ol>
  </details>;
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
      opener.current?.focus();
    }
    if (save.status === 'uncertain' && save.signInRequired) onSessionExpired();
  }, [save, reload, onSessionExpired]);

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
      <button type="button" disabled={locked || loading || !data} onClick={event => open({ kind: 'create' }, event.currentTarget)}>Create template</button>
    </div>
    {loading && <p role="status">Loading templates and assignments…</p>}
    {error && <div role="alert"><p>Couldn’t load templates and assignments.</p>
      <button type="button" onClick={() => void reload()}>Try again</button>
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
          <button type="button" disabled={locked} onClick={event => open({ kind: 'edit', id: template.id }, event.currentTarget)}
            aria-label={`${version.retired ? 'View' : 'Edit'} ${version.name}${version.activities?.[0] ? `, ${version.activities[0].label}` : ''}`}>
            {version.retired ? 'View' : 'Edit'}
          </button>
        </li>;
      })}
    </ul>
    <h2>Assignments</h2>
    {!children.length && <p>No children available for assignment changes.</p>}
    <ul className="child-profiles-list">{children.map(child => <li className="child-profiles-card" key={child.id}>
      <div><p>{child.displayName}</p></div>
      <button type="button" disabled={locked} onClick={event => open({ kind: 'assignment', child }, event.currentTarget)}
        aria-label={`Edit assignments for ${child.displayName}`}>Edit assignments</button>
    </li>)}</ul>
    </>}

    {target && <section className="rule-editor" aria-labelledby="rule-editor-title">
      <h3 ref={heading} tabIndex={-1} id="rule-editor-title">
        {target.kind === 'create' ? 'Create template' : target.kind === 'assignment' ? `Assignments for ${target.child.displayName}` : 'Template details'}
      </h3>
      {loadError ? <div role="alert"><p>{loadError}</p><button type="button" onClick={() => open(target)}>Try again</button></div>
        : !draft && <p role="status">Loading rules…</p>}
      {draft && <form onSubmit={event => { event.preventDefault(); submit(); }}>
        <fieldset disabled={locked || Boolean(conflict)}>
          {draft.kind === 'assignment' ? <>
            <p><strong>Active today</strong> · {assignmentNames(draft.detail.current?.templateIds ?? [], today)}</p>
            <p><strong>Effective tomorrow</strong> · {assignmentNames(draft.detail.pending?.templateIds ?? draft.detail.current?.templateIds ?? [], tomorrow)}</p>
            <label className="child-profiles-template">
              <input type="checkbox" checked={startToday} onChange={event => {
                const saved = (draft.detail.pending ?? draft.detail.current)?.templateIds ?? [];
                setDraft({ ...draft, startToday: event.target.checked,
                  additions: draft.additions ?? draft.ids.filter(id => !saved.includes(id)
                    && !draft.detail.current?.templateIds.includes(id)
                    && templates.some(template => template.id === id && template.current && !template.current.retired)) });
              }}/>
              <span>Start new templates today<small>Add to today’s checklist and carry the additions into tomorrow’s plan.</small></span>
            </label>
            <TemplatePicker title={startToday ? 'Templates to add today' : 'Templates in checklist order'} options={assignmentOptions} selected={selectedAssignments}
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
              <label>Template name<input required maxLength={80} value={draft.name}
                onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
              <ol className="rule-activities">{draft.activities.map((activity, index) => {
                const open = expanded === activity.key;
                return <li key={activity.key}>
                  <button type="button" className="rule-activity-toggle" aria-expanded={open}
                    aria-controls={`activity-${activity.key}`} onClick={() => setExpanded(open ? null : activity.key)}>
                    {activity.label || 'New activity'}
                  </button>
                  <div id={`activity-${activity.key}`} hidden={!open}>
                    {open && <>
                      <label>Activity label<input required maxLength={80} value={activity.label}
                        onChange={event => editActivity(activity, { label: event.target.value })}/></label>
                      <label>Reward (stars)<input type="number" required min={1} max={999} value={activity.reward}
                        onChange={event => editActivity(activity, { reward: event.target.value })}/></label>
                      <label>Penalty (optional)<input type="number" min={0} max={999} value={activity.penalty}
                        onChange={event => editActivity(activity, { penalty: event.target.value })}/></label>
                      <fieldset className="rule-weekdays"><legend>Weekdays</legend>
                        {weekdays.map((day, dayIndex) => <label key={day} className="child-profiles-template">
                          <input type="checkbox" checked={activity.weekdays.includes(dayIndex + 1)}
                            onChange={event => editActivity(activity, { weekdays: event.target.checked
                              ? [...activity.weekdays, dayIndex + 1].sort() : activity.weekdays.filter(value => value !== dayIndex + 1) })}/>{day}
                        </label>)}
                      </fieldset>
                      <div className="child-profiles-actions">
                        <button type="button" disabled={index === 0} onClick={() => setDraft({ ...draft, activities: moveItem(draft.activities, index, -1) })}>Move up</button>
                        <button type="button" disabled={index === draft.activities.length - 1} onClick={() => setDraft({ ...draft, activities: moveItem(draft.activities, index, 1) })}>Move down</button>
                        <button type="button" onClick={() => {
                          setDraft({ ...draft, activities: draft.activities.filter(item => item.key !== activity.key) });
                          heading.current?.focus();
                        }}>Remove activity</button>
                      </div>
                    </>}
                  </div>
                </li>;
              })}</ol>
              <div className="child-profiles-actions">
                <button type="button" disabled={draft.activities.length >= 30} onClick={() => {
                  const activity = blankActivity();
                  setDraft({ ...draft, activities: [...draft.activities, activity] });
                  setExpanded(activity.key);
                }}>Add activity</button>
                {draft.detail && <button type="button" onClick={() => setDraft({ ...draft, retire: true })}>Retire template</button>}
              </div>
            </>}
            {draft.retire && <p>From {effectiveDate}, this template will stop appearing on checklists. Earlier dates will keep their rules.</p>}
          </>}
          {!retired && <>
            <p>Effective <time dateTime={effectiveDate}>{effectiveDate}</time> · Jakarta</p>
            <button type="submit" disabled={draft.kind === 'assignment' ? startToday && !selectedAssignments.length : editable && !draft.activities.length}>
              {draft.kind === 'assignment' ? 'Save assignments' : pendingRetirement ? 'Cancel scheduled retirement'
                : draft.retire ? 'Confirm retirement' : 'Save template'}
            </button>
          </>}
        </fieldset>
        {validation && <p role="alert">{validation}</p>}
      </form>}
      <div className="child-profiles-actions">
        {draft?.kind === 'template' && draft.retire && !locked && !conflict && <button type="button" onClick={() => setDraft({ ...draft, retire: false })}>Keep editing</button>}
        <button type="button" disabled={locked} onClick={() => {
          setTarget(null); clearRuleSave(); opener.current?.focus();
        }}>{retired ? 'Close' : 'Cancel'}</button>
      </div>
    </section>}
    {save.status === 'saving' && <p role="status">Saving {save.intent.label}…</p>}
    {save.status === 'success' && <p role="status">Saved {save.intent.label}. Effective {save.result.effectiveDate} · Jakarta.</p>}
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
        <button type="button" onClick={() => submit((conflict.pending ?? conflict.current)?.revision)}>Apply my change</button>
      </div>}
      {target && <button type="button" onClick={() => { void reload(); open(target); }}>{conflict ? 'Keep current' : 'Reload latest rules'}</button>}
    </div>}
    {save.status === 'uncertain' && <div role="alert">
      <p>Save not confirmed for {save.intent.label}. Keep this page open to retain the retry key.</p>
      <button type="button" onClick={() => void retryRule()}>Check / retry</button>
    </div>}
  </section>;
}
