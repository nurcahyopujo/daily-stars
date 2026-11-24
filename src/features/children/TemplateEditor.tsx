import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarClock, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { BackLabel, backLinkClass } from './BackLink';
import { nextDate } from '../../../worker/calendar';
import type { TemplateDetail, TemplateVersion } from '../../../shared/profiles';
import { clearRuleSave, requestJson, RequestError, retryRule, submitRule, useRuleSave } from './requests';
import { moveItem } from './TemplatePicker';
import { useHouseholdProfiles } from './useHouseholdProfiles';
import './child-profiles.css';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const everyDay = [1, 2, 3, 4, 5, 6, 7];

type DraftActivity = { key: string; id?: string; label: string; reward: string; penalty: string; weekdays: number[] };
const blankActivity = (): DraftActivity => ({ key: crypto.randomUUID(), label: '', reward: '1', penalty: '', weekdays: [...everyDay] });

export type TemplateTarget = { kind: 'create' } | { kind: 'edit'; id: string };
type Draft = { detail: TemplateDetail | null; name: string; activities: DraftActivity[]; retire: boolean };

function pathFor(target: TemplateTarget) {
  return target.kind === 'edit' ? `/api/templates/${encodeURIComponent(target.id)}` : '/api/templates';
}

function weekdaySummary(days: number[] | undefined) {
  if (!days || days.length === 7) return 'Every day';
  if (days.length === 5 && [1, 2, 3, 4, 5].every(day => days.includes(day))) return 'Weekdays';
  if (days.length === 2 && days.includes(6) && days.includes(7)) return 'Weekends';
  return [...days].sort((a, b) => a - b).map(day => weekdays[day - 1]).join(', ');
}

// One scheduled stop (today or tomorrow) as a routine's activity pills, echoing the
// assignments-page timeline so templates read in the same dated-plan language.
function Stop({ version, placeholder }: { version: TemplateVersion | null; placeholder: string }) {
  if (!version || version.retired) return <span className="assign-empty">{placeholder}</span>;
  if (!version.activities.length) return <span className="assign-empty">No activities</span>;
  return <span className="assign-chips">{version.activities.map(activity =>
    <span className="assign-chip" key={activity.id}>{activity.label} · +{activity.reward}</span>)}</span>;
}

// Dated-rule date formatting matched to the assignments page (Jakarta calendar string,
// formatted from UTC midnight so the weekday never shifts with the viewer's time zone).
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLabel = (iso: string) => iso ? dayFormat.format(new Date(iso + 'T00:00:00Z')) : '';

// The template create/edit editor as a standalone page (it used to live in a modal on the
// templates list). Self-contained by `target` so RootShell can force-render it while a save
// recovers after navigation.
// `onSaved` returns the user to the list after a confirmed save. It's supplied only by the routed
// editor pages; the RootShell force-render (recovery on another route) omits it, so a save that
// confirms while the user is elsewhere simply releases the overlay and keeps their current page.
export function TemplateEditor({ target, onSessionExpired, onSaved }: { target: TemplateTarget; onSessionExpired: () => void; onSaved?: () => void }) {
  const { data, loading } = useHouseholdProfiles(onSessionExpired);
  const today = data?.today ?? '';
  const tomorrow = today ? nextDate(today) : '';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [validation, setValidation] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  // Only a save this editor instance submitted should navigate away on success — never a stale
  // success left in the shared store by an earlier edit of the same template.
  const submitted = useRef(false);
  const path = pathFor(target);
  const save = useRuleSave();
  // The rule-save store is shared with the assignments page; only react to this template's saves.
  const ownsSave = 'intent' in save && save.intent.path === path;
  const locked = ownsSave && (save.status === 'saving' || save.status === 'uncertain');
  const conflict = ownsSave && save.status === 'conflict' && 'affectedChildren' in save.current ? save.current : undefined;
  const frozen = locked || Boolean(conflict);
  const effectiveDate = target.kind === 'create' ? today : tomorrow;

  // A fresh open clears any stale terminal save state so the editor starts clean. Only an in-flight
  // save (RootShell force-render recovery) is preserved — those are the only states RootShell
  // force-renders for; a conflict/success/rejection in the store on mount is always stale.
  useEffect(() => {
    if (!(ownsSave && (save.status === 'saving' || save.status === 'uncertain'))) clearRuleSave();
    // Run once on mount for this target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Load the template detail (edit) or seed a single blank activity (create).
  useEffect(() => {
    const controller = new AbortController();
    setDraft(null);
    setExpanded(null);
    setLoadError('');
    setValidation('');
    async function load() {
      try {
        const detail = target.kind === 'edit'
          ? await requestJson<TemplateDetail>(path, { signal: controller.signal }) : null;
        const version = detail?.pending ?? detail?.current;
        const activities = version ? version.activities.map(activity => ({
          key: activity.id, id: activity.id, label: activity.label, reward: String(activity.reward),
          penalty: activity.penalty === undefined ? '' : String(activity.penalty),
          weekdays: activity.weekdays ?? [...everyDay],
        })) : [blankActivity()];
        if (!controller.signal.aborted) {
          setDraft({ detail, name: version?.name ?? '', activities, retire: false });
          if (target.kind === 'create') setExpanded(activities[0].key);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof RequestError && error.status === 401) onSessionExpired();
        else setLoadError('Couldn’t load this template. Try again.');
      }
    }
    void load();
    return () => controller.abort();
  }, [path, target.kind, reloadKey, onSessionExpired]);

  // On a confirmed save, return to the list — the saved confirmation surfaces there.
  useEffect(() => {
    if (!ownsSave) return;
    if (save.status === 'success' && submitted.current) onSaved?.();
    if (save.status === 'uncertain' && save.signInRequired) onSessionExpired();
  }, [save, ownsSave, onSaved, onSessionExpired]);

  function submit(reviewedRevision?: number) {
    if (!draft || locked || (conflict && reviewedRevision === undefined)) return;
    setValidation('');
    const latest = draft.detail?.pending ?? draft.detail?.current;
    const operation = latest?.retired ? 'cancelRetirement' : draft.retire ? 'retire' : 'save';
    const expectedRevision = reviewedRevision ?? latest?.revision;
    if (operation !== 'save') {
      submitted.current = true;
      void submitRule({ path, method: 'PUT', label: draft.name, body: { expectedRevision, operation } });
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
    submitted.current = true;
    void submitRule({ path, method: target.kind === 'create' ? 'POST' : 'PUT', label: draft.name,
      body: { expectedRevision, name: draft.name, activities: draft.activities.map(activity => ({
        id: activity.id, label: activity.label, rewardPoints: Number(activity.reward),
        penaltyPoints: activity.penalty === '' ? undefined : Number(activity.penalty), weekdays: activity.weekdays,
      })) },
    });
  }

  function editActivity(activity: DraftActivity, patch: Partial<DraftActivity>) {
    if (!draft) return;
    setDraft({ ...draft, activities: draft.activities.map(item => item.key === activity.key ? { ...item, ...patch } : item) });
  }

  function reload() { clearRuleSave(); setReloadKey(key => key + 1); }

  const pendingRetirement = draft?.detail?.pending?.retired;
  const retired = draft?.detail?.current?.retired;
  const editable = Boolean(draft) && !retired && !pendingRetirement && !draft?.retire;
  const title = target.kind === 'create' ? 'Create template' : (draft?.name || 'Template');

  return <section className="child-profiles score-day scoring-day templates-editor" aria-busy={loading}>
    {!frozen && <Link className={backLinkClass} to="/templates"><BackLabel>Activity templates</BackLabel></Link>}
    <header className="scoring-day-head">
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
    </header>
    <p className="tpl-intro">{target.kind === 'create'
      ? 'A new routine takes effect today and can be assigned to any child.'
      : 'A change takes effect from the next Jakarta day, so today’s routines are never rewritten.'}</p>

    {loadError ? <div role="alert" className="tpl-loaderror"><p>{loadError}</p>
        <Button type="button" onClick={reload}>Try again</Button></div>
      : !draft ? <p role="status" className="tpl-loading">Loading template…</p>
      : <>
        {target.kind === 'edit' && draft.detail && <div className="assign-schedule">
          <div className="assign-node is-today">
            <span className="assign-node-rail" aria-hidden="true"><span className="assign-node-dot" /></span>
            <div className="assign-node-body">
              <div className="assign-node-head">
                <span className="assign-node-when">Active today</span>
                {today && <span className="assign-node-date">{dayLabel(today)}</span>}
              </div>
              <Stop version={draft.detail.current} placeholder={draft.detail.current?.retired ? 'Retired' : 'No template today'} />
            </div>
          </div>
          <div className="assign-node is-tomorrow">
            <span className="assign-node-rail" aria-hidden="true"><span className="assign-node-dot" /></span>
            <div className="assign-node-body">
              <div className="assign-node-head">
                <span className="assign-node-when">Effective tomorrow</span>
                {tomorrow && <span className="assign-node-date">{dayLabel(tomorrow)}</span>}
              </div>
              <Stop version={draft.detail.pending ?? draft.detail.current}
                placeholder={(draft.detail.pending ?? draft.detail.current)?.retired ? 'Retiring' : 'No change scheduled'} />
              {!draft.detail.pending && !retired && <span className="assign-node-note">No change scheduled</span>}
            </div>
          </div>
          {!retired && <p className="tpl-affected">
            Affects on {effectiveDate}: <strong>{draft.detail.affectedChildren.join(', ') || 'No children'}</strong>
          </p>}
        </div>}

        {retired
          ? <p role="note" className="assign-archived">This template was retired from {draft.detail?.current?.effectiveDate}. Earlier dates keep their rules.</p>
          : <form onSubmit={event => { event.preventDefault(); submit(); }}>
          <fieldset disabled={frozen}>
            {editable && <>
              <label className="tpl-name">Template name
                <Input required maxLength={80} value={draft.name} placeholder="e.g. Morning routine"
                  onChange={event => setDraft({ ...draft, name: event.target.value })} />
              </label>

              <div className="tpl-activities-head">
                <h2 className="tpl-section-title">Activities</h2>
                <span className="tpl-activities-count">{draft.activities.length} of 30</span>
              </div>
              <ol className="tpl-activities">{draft.activities.map((activity, index) => {
                const open = expanded === activity.key;
                return <li key={activity.key} className="tpl-activity" data-open={open || undefined}>
                  <button type="button" className="tpl-activity-summary" aria-expanded={open}
                    aria-controls={`activity-${activity.key}`} onClick={() => setExpanded(open ? null : activity.key)}>
                    <span className="tpl-activity-index" aria-hidden="true">{index + 1}</span>
                    <span className="tpl-activity-head">
                      <span className="tpl-activity-name">{activity.label || 'New activity'}</span>
                      <span className="tpl-activity-meta">
                        <span className="tpl-reward">+{activity.reward || '0'}{Number(activity.penalty) > 0 ? ` · −${activity.penalty}` : ''}</span>
                        <span className="tpl-activity-dot" aria-hidden="true">·</span>
                        <span className="tpl-activity-days">{weekdaySummary(activity.weekdays)}</span>
                      </span>
                    </span>
                    <ChevronDown className="tpl-activity-caret" size={18} aria-hidden="true" />
                  </button>
                  <div id={`activity-${activity.key}`} className="tpl-activity-fields" hidden={!open}>
                    {open && <>
                      <label>Activity label
                        <Input required maxLength={80} value={activity.label} placeholder="e.g. Make the bed"
                          onChange={event => editActivity(activity, { label: event.target.value })} />
                      </label>
                      <div className="tpl-points">
                        <label>Reward (stars)
                          <Input type="number" inputMode="numeric" required min={1} max={999} value={activity.reward}
                            onChange={event => editActivity(activity, { reward: event.target.value })} />
                        </label>
                        <label>Penalty (optional)
                          <Input type="number" inputMode="numeric" min={0} max={999} value={activity.penalty}
                            onChange={event => editActivity(activity, { penalty: event.target.value })} />
                        </label>
                      </div>
                      <div className="tpl-weekdays" role="group" aria-label={`Weekdays for ${activity.label || `activity ${index + 1}`}`}>
                        {weekdays.map((day, dayIndex) => {
                          const on = activity.weekdays.includes(dayIndex + 1);
                          return <button type="button" key={day} className="tpl-day" aria-pressed={on} aria-label={weekdayNames[dayIndex]}
                            onClick={() => editActivity(activity, { weekdays: on
                              ? activity.weekdays.filter(value => value !== dayIndex + 1)
                              : [...activity.weekdays, dayIndex + 1].sort((a, b) => a - b) })}>{day}</button>;
                        })}
                      </div>
                      <div className="tpl-activity-controls">
                        <Button type="button" className="tpl-move" disabled={index === 0} aria-label={`Move activity ${index + 1} up`}
                          onClick={() => setDraft({ ...draft, activities: moveItem(draft.activities, index, -1) })}><ChevronUp size={16} aria-hidden="true" /></Button>
                        <Button type="button" className="tpl-move" disabled={index === draft.activities.length - 1} aria-label={`Move activity ${index + 1} down`}
                          onClick={() => setDraft({ ...draft, activities: moveItem(draft.activities, index, 1) })}><ChevronDown size={16} aria-hidden="true" /></Button>
                        <Button type="button" className="tpl-remove" onClick={() => {
                          setDraft({ ...draft, activities: draft.activities.filter(item => item.key !== activity.key) });
                          heading.current?.focus();
                        }}><Trash2 size={15} aria-hidden="true" /><span>Remove</span></Button>
                      </div>
                    </>}
                  </div>
                </li>;
              })}</ol>

              <div className="tpl-add-row">
                <Button type="button" className="tpl-add" disabled={draft.activities.length >= 30} onClick={() => {
                  const activity = blankActivity();
                  setDraft({ ...draft, activities: [...draft.activities, activity] });
                  setExpanded(activity.key);
                }}><Plus size={16} aria-hidden="true" /><span>Add activity</span></Button>
                {draft.detail && <Button type="button" className="tpl-retire" onClick={() => setDraft({ ...draft, retire: true })}>Retire template</Button>}
              </div>
            </>}

            {draft.retire && <p className="tpl-retire-note">From <time dateTime={effectiveDate}>{dayLabel(effectiveDate)}</time>, this template stops appearing on checklists. Earlier dates keep their rules.</p>}

            <p className="assign-effective tpl-effective">
              <CalendarClock size={16} aria-hidden="true" />
              <span>Takes effect <time dateTime={effectiveDate}>{dayLabel(effectiveDate)}</time> · Jakarta</span>
            </p>
            <div className="tpl-save-row">
              <Button type="submit" className="assign-save tpl-save" disabled={editable && !draft.activities.length}>
                {pendingRetirement ? 'Cancel scheduled retirement' : draft.retire ? 'Confirm retirement' : 'Save template'}
              </Button>
              {draft.retire && !frozen && <Button type="button" className="tpl-cancel" onClick={() => setDraft({ ...draft, retire: false })}>Keep editing</Button>}
            </div>
          </fieldset>
          {validation && <p role="alert" className="tpl-validation">{validation}</p>}
        </form>}

        {ownsSave && save.status === 'saving' && <p role="status" className="tpl-savestatus">Saving {save.intent.label}…</p>}
        {ownsSave && save.status === 'rejected' && <div className="child-profiles-save"><p role="alert">{save.message}</p>
          <Button type="button" className="tpl-cancel" onClick={reload}>Reload latest template</Button>
        </div>}
        {conflict && <div className="child-profiles-save">
          <div>
            <p><strong>Latest scheduled rules</strong> · Revision {(conflict.pending ?? conflict.current)?.revision}</p>
            <Stop version={conflict.pending ?? conflict.current} placeholder="Retired" />
            <p className="tpl-conflict-mine"><strong>Your change</strong></p>
            <p>{draft.name} · {draft.detail?.pending?.retired ? 'Cancel retirement'
              : draft.retire ? 'Retire template' : draft.activities.map(activity => `${activity.label} (+${activity.reward})`).join(', ')}</p>
            <Button type="button" onClick={() => submit((conflict.pending ?? conflict.current)?.revision)}>Apply my change</Button>
          </div>
          <Button type="button" className="tpl-cancel" onClick={reload}>Keep current</Button>
        </div>}
        {ownsSave && save.status === 'uncertain' && <div role="alert" className="child-profiles-save">
          <p>Save not confirmed for {save.intent.label}. Keep this page open to retain the retry key.</p>
          <Button type="button" onClick={() => void retryRule()}>Check / retry</Button>
        </div>}
      </>}
  </section>;
}
