import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { nextDate } from '../../../worker/calendar';
import type { AssignmentDetail, TemplateSummary } from '../../../shared/profiles';
import { clearRuleSave, requestJson, RequestError, retryRule, submitRule, useRuleSave } from './requests';
import { TemplatePicker } from './TemplatePicker';
import { useHouseholdProfiles } from './useHouseholdProfiles';
import './child-profiles.css';

function versionFor(template: TemplateSummary, date: string) {
  return template.pending && template.pending.effectiveDate <= date ? template.pending : template.current;
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
  const heading = useRef<HTMLHeadingElement>(null);
  const save = useRuleSave();
  const path = `/api/children/${encodeURIComponent(childId)}/assignments`;
  // The rule-save store is shared with the templates page; only react to saves for this child.
  const ownsSave = 'intent' in save && save.intent.path === path;
  const locked = ownsSave && (save.status === 'saving' || save.status === 'uncertain');
  const conflict = ownsSave && save.status === 'rejected' && save.current && !('affectedChildren' in save.current)
    ? save.current : undefined;
  const frozen = locked || Boolean(conflict);

  const selectedAssignments = startToday ? additions : ids;
  const effectiveDate = startToday ? today : tomorrow;
  const assignmentOptions = detail ? templates.flatMap(template => {
    if (startToday && detail.current?.templateIds.includes(template.id)) return [];
    const version = versionFor(template, effectiveDate);
    return version && !version.retired ? [{ id: template.id, version }] : [];
  }) : [];
  const assignmentNames = (list: string[], date: string) => list.map(id => {
    const template = templates.find(item => item.id === id);
    const version = template && versionFor(template, date);
    return version && !version.retired ? version.name : '';
  }).filter(Boolean).join(', ') || 'No templates';

  useEffect(() => {
    if (data && !child) void navigate({ to: '/children' });
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

  useEffect(() => {
    if (!ownsSave) return;
    if (save.status === 'success') { void reload(); setReloadKey(key => key + 1); }
    if (save.status === 'uncertain' && save.signInRequired) onSessionExpired();
  }, [save, ownsSave, reload, onSessionExpired]);

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

  function submit(reviewedRevision?: number) {
    if (!detail || frozen && reviewedRevision === undefined) return;
    const expectedRevision = reviewedRevision ?? (detail.pending ?? detail.current)?.revision;
    void submitRule({ path, method: 'PUT', label: `Assignments for ${child?.displayName ?? 'child'}`,
      body: { expectedRevision, templateIds: selectedAssignments, ...(startToday ? { startToday } : {}) } });
  }

  const nav = child && <nav className="scoring-day-links" aria-label="Child pages">
    <Link to="/children/$childId/day" params={{ childId }}>Daily scoring</Link>
    <Link to="/children/$childId/prizes" params={{ childId }}>Prizes</Link>
    <Link to="/children/$childId/review" params={{ childId }}>Activity review</Link>
  </nav>;

  if (error) return <section className="child-profiles"><div role="alert">
    <p>Couldn’t load this child. Check your connection and try again.</p>
    <Button type="button" onClick={() => void reload()}>Try again</Button>
  </div></section>;
  if (!data || !child) return <section className="child-profiles"><p role="status" aria-busy={loading}>Loading…</p></section>;

  return <section className="child-profiles score-day scoring-day" aria-busy={loading}>
    {!frozen && <Link className="scoring-day-back" to="/children">← Manage children</Link>}
    <header className="scoring-day-head">
      <h1 ref={heading} tabIndex={-1}>{child.displayName}</h1>
      {!frozen && nav}
    </header>
    <h2>Assignments</h2>

    {loadError ? <div role="alert"><p>{loadError}</p>
        <Button type="button" onClick={() => void reload()}>Try again</Button></div>
      : !detail ? <p role="status">Loading assignments…</p>
      : !eligible ? <>
        <p role="note">This child is archived and can’t receive assignment changes.</p>
        <p><strong>Active today</strong> · {assignmentNames(detail.current?.templateIds ?? [], today)}</p>
        <p><strong>Effective tomorrow</strong> · {assignmentNames(detail.pending?.templateIds ?? detail.current?.templateIds ?? [], tomorrow)}</p>
      </> : <form onSubmit={event => { event.preventDefault(); submit(); }}>
        <fieldset disabled={frozen}>
          <p><strong>Active today</strong> · {assignmentNames(detail.current?.templateIds ?? [], today)}</p>
          <p><strong>Effective tomorrow</strong> · {assignmentNames(detail.pending?.templateIds ?? detail.current?.templateIds ?? [], tomorrow)}</p>
          <label className="child-profiles-template">
            <Checkbox disabled={frozen} checked={startToday} onCheckedChange={toggleStartToday}/>
            <span>Start new templates today<small>Add to today’s checklist and carry the additions into tomorrow’s plan.</small></span>
          </label>
          <TemplatePicker title={startToday ? 'Templates to add today' : 'Templates in checklist order'}
            disabled={frozen} options={assignmentOptions} selected={selectedAssignments}
            onChange={next => startToday ? setAdditions(next) : setIds(next)}/>
          <p>Effective <time dateTime={effectiveDate}>{effectiveDate}</time> · Jakarta</p>
          <Button type="submit" disabled={startToday && !selectedAssignments.length}>Save assignments</Button>
        </fieldset>
      </form>}

    {ownsSave && save.status === 'saving' && <p role="status">Saving {save.intent.label}…</p>}
    {ownsSave && save.status === 'rejected' && <div className="child-profiles-save"><p role="alert">{save.message}</p>
      {conflict && <div>
        <p><strong>Latest scheduled assignments</strong> · Revision {(conflict.pending ?? conflict.current)?.revision}</p>
        <p>{assignmentNames((conflict.pending ?? conflict.current)?.templateIds ?? [], tomorrow)}</p>
        <p><strong>Your change</strong></p>
        <p>{startToday ? 'Add today · ' : ''}{assignmentNames(selectedAssignments, effectiveDate)}</p>
        <Button type="button" onClick={() => submit((conflict.pending ?? conflict.current)?.revision)}>Apply my change</Button>
      </div>}
      <Button type="button" className="modal-cancel" onClick={() => { clearRuleSave(); void reload(); }}>
        {conflict ? 'Keep current' : 'Reload latest assignments'}
      </Button>
    </div>}
    {ownsSave && save.status === 'uncertain' && <div role="alert">
      <p>Save not confirmed for {save.intent.label}. Keep this page open to retain the retry key.</p>
      <Button type="button" onClick={() => void retryRule()}>Check / retry</Button>
    </div>}
    {ownsSave && save.status === 'success' && <p role="status">Saved {save.intent.label}. Effective {save.result.effectiveDate} · Jakarta.</p>}
  </section>;
}
