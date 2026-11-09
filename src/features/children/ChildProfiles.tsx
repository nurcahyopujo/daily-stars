import { useCallback, useEffect, useRef, useState } from 'react';
import type { Child, TemplateSummary } from '../../../shared/profiles';
import { applyChildChange, clearChildSave, requestJson, RequestError, retryChild, submitChild, useChildSave } from './requests';
import './child-profiles.css';

type Profiles = { today: string; children: Child[] };
type Editor = { child: Child | null; name: string; templates: string[]; archive: boolean };

export function ChildProfiles({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<Profiles | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const save = useChildSave();
  const controller = useRef<AbortController | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const nickname = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const locked = ['saving', 'uncertain', 'conflict'].includes(save.status);

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError('');
    try {
      const [profiles, routines] = await Promise.all([
        requestJson<Profiles>('/api/children?includeArchived=true', { signal: current.signal }),
        requestJson<{ templates: TemplateSummary[] }>('/api/templates', { signal: current.signal }),
      ]);
      if (!current.signal.aborted) { setData(profiles); setTemplates(routines.templates); }
    } catch (failure) {
      if (!current.signal.aborted) {
        if (failure instanceof RequestError && failure.status === 401) onSessionExpired();
        else setError('Couldn’t load child profiles. Check your connection and try again.');
      }
    } finally { if (!current.signal.aborted) setLoading(false); }
  }, [onSessionExpired]);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  useEffect(() => {
    if (save.status === 'success') {
      setEditor(null);
      if (save.intent.kind === 'create') setTab('active');
      restoreFocus.current = true;
      void load();
    }
  }, [save, load]);

  useEffect(() => {
    if (!loading && restoreFocus.current) {
      restoreFocus.current = false;
      (opener.current?.isConnected ? opener.current : addButton.current)?.focus();
    }
  }, [loading]);

  useEffect(() => {
    if (save.status === 'uncertain' && save.signInRequired) onSessionExpired();
  }, [save, onSessionExpired]);

  useEffect(() => { if (editor && !locked && !loading) nickname.current?.focus(); }, [editor?.child?.id, editor === null, locked, loading]);

  const modalOpen = editor !== null || locked;
  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    if (modalOpen && !modal.open) modal.showModal();
    else if (!modalOpen && modal.open) {
      modal.close();
      if (!loading) (opener.current?.isConnected ? opener.current : addButton.current)?.focus();
    }
  }, [modalOpen, loading]);

  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [modalOpen]);

  useEffect(() => {
    const modal = dialog.current;
    return () => { modal?.close(); };
  }, []);

  function open(child: Child | null, trigger: HTMLButtonElement) {
    opener.current = trigger;
    clearChildSave();
    setEditor({ child, name: child?.displayName ?? '', templates: [], archive: false });
  }

  function moveTemplate(id: string, direction: number) {
    if (!editor) return;
    const ordered = [...editor.templates];
    const index = ordered.indexOf(id);
    [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
    setEditor({ ...editor, templates: ordered });
  }

  const available = templates.filter((template) => template.current && !template.current.retired);
  const active = data?.children.filter((child) => !child.archiveEffectiveDate || child.archiveEffectiveDate > data.today) ?? [];
  const archived = data?.children.filter((child) => child.archiveEffectiveDate && child.archiveEffectiveDate <= data.today) ?? [];
  const tomorrow = data ? new Date(`${data.today}T00:00:00Z`) : null;
  tomorrow?.setUTCDate(tomorrow.getUTCDate() + 1);
  const archiveDate = tomorrow?.toISOString().slice(0, 10);

  function childRow(child: Child) {
    const isArchived = Boolean(child.archiveEffectiveDate && data && child.archiveEffectiveDate <= data.today);
    return <li className="child-profiles-card" key={child.id}>
      <div><h3>{child.displayName}</h3><p>Started {child.startDate}</p>
        {child.archiveEffectiveDate && <p>{isArchived ? 'Archived from' : 'Archives on'} {child.archiveEffectiveDate} · History preserved</p>}
      </div>
      <button type="button" disabled={locked || loading} onClick={(event) => open(child, event.currentTarget)} aria-label={`Manage ${child.displayName}`}>Manage</button>
    </li>;
  }

  return <section className="child-profiles" aria-labelledby="profiles-title" aria-busy={loading}>
    <div className="child-profiles-heading"><h2 id="profiles-title">Manage children</h2>
      <button ref={addButton} type="button" disabled={locked || loading} onClick={(event) => open(null, event.currentTarget)}>Add child</button>
    </div>
    {loading && <p role="status">Loading child profiles…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Reload profiles</button></div>}
    {data && <>
      <p className="child-profiles-date">{data.today} · Jakarta</p>
      <div className="child-profiles-tabs" role="tablist" aria-label="Child status" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'active' : event.key === 'End' ? 'archived' : tab === 'active' ? 'archived' : 'active';
        setTab(next);
        event.currentTarget.querySelector<HTMLButtonElement>(`#children-${next}-tab`)?.focus();
      }}>
        {(['active', 'archived'] as const).map((status) => <button key={status} type="button"
          role="tab" id={`children-${status}-tab`} aria-controls={`children-${status}-panel`}
          aria-selected={tab === status} tabIndex={tab === status ? 0 : -1} disabled={locked}
          onClick={() => setTab(status)}>
          {status === 'active' ? `Active (${active.length})` : `Archived (${archived.length})`}
        </button>)}
      </div>
      <div role="tabpanel" id="children-active-panel" aria-labelledby="children-active-tab" hidden={tab !== 'active'} tabIndex={0}>
        {!active.length && <p>No active children. Add a child to get started.</p>}
        <ul className="child-profiles-list" aria-label="Active children">{active.map(childRow)}</ul>
      </div>
      <div role="tabpanel" id="children-archived-panel" aria-labelledby="children-archived-tab" hidden={tab !== 'archived'} tabIndex={0}>
        {!archived.length && <p>No archived children.</p>}
        <ul className="child-profiles-list" aria-label="Archived children">{archived.map(childRow)}</ul>
      </div>
    </>}

    <dialog ref={dialog} className="child-profiles-modal" aria-labelledby="child-editor-title" onCancel={(event) => {
      event.preventDefault();
      if (!locked) { setEditor(null); clearChildSave(); }
    }}>
    <h3 id="child-editor-title">{editor ? (editor.child ? `Manage ${editor.child.displayName}` : 'Add child') : 'Recover child save'}</h3>
    {editor && <form className="child-profiles-editor" onSubmit={(event) => {
      event.preventDefault();
      if (locked) return;
      if (editor.child) void submitChild({ kind: 'edit', childId: editor.child.id,
        expectedRevision: editor.child.revision,
        ...(editor.name.trim() !== editor.child.displayName ? { displayName: editor.name.trim() } : {}),
        ...(editor.archive ? { archive: true } : {}),
      });
      else void submitChild({ kind: 'create', displayName: editor.name.trim(), initialTemplateIds: editor.templates });
    }}>
      <fieldset disabled={locked || loading}>
        <label htmlFor="child-nickname">Nickname</label>
        <input ref={nickname} id="child-nickname" value={editor.name} required
          onChange={(event) => setEditor({ ...editor, name: event.target.value })}
          aria-describedby={`nickname-help${save.status === 'rejected' ? ' child-profile-save-error' : ''}`} />
        <p id="nickname-help">1–60 characters. The current nickname also labels history.</p>
        {!editor.child && <>
          <fieldset className="child-profiles-templates" aria-describedby={save.status === 'rejected' ? 'child-profile-save-error' : undefined}><legend>Initial templates (optional)</legend>
            <p>Available immediately. Choose every template needed for day one, in display order.</p>
            {!available.length && <p>No templates available yet. You can create a child without a routine.</p>}
            {available.map((template) => <label className="child-profiles-template" key={template.id}>
              <input type="checkbox" checked={editor.templates.includes(template.id)} onChange={(event) => setEditor({
                ...editor, templates: event.target.checked ? [...editor.templates, template.id] : editor.templates.filter((id) => id !== template.id),
              })} />
              <span>{template.current!.name}{template.pending && <small>Scheduled change: {template.pending.effectiveDate}</small>}</span>
            </label>)}
            {editor.templates.length > 0 && <ol className="child-profiles-order" aria-label="Initial template order">
              {editor.templates.map((id, index) => <li key={id}>
                <span>{available.find((template) => template.id === id)?.current?.name ?? 'Unavailable template'}</span>
                <button type="button" disabled={index === 0} onClick={() => moveTemplate(id, -1)} aria-label={`Move template ${index + 1} up`}>↑</button>
                <button type="button" disabled={index === editor.templates.length - 1} onClick={() => moveTemplate(id, 1)} aria-label={`Move template ${index + 1} down`}>↓</button>
                <button type="button" onClick={() => setEditor({ ...editor, templates: editor.templates.filter((item) => item !== id) })} aria-label={`Remove template ${index + 1}`}>Remove</button>
              </li>)}
            </ol>}
          </fieldset>
          <p>New profiles start at 0 points. An empty routine still permits one-off points.</p>
        </>}
        {editor.child && !editor.child.archiveEffectiveDate && <label className="child-profiles-template">
          <input type="checkbox" checked={editor.archive} onChange={(event) => setEditor({ ...editor, archive: event.target.checked })} />
          <span>Archive from {archiveDate} (tomorrow). Keep all history and earlier corrections.</span>
        </label>}
        {editor.child?.archiveEffectiveDate && <p>Archive date: {editor.child.archiveEffectiveDate}. Earlier entries remain preserved.</p>}
        <div className="child-profiles-actions">
          <button type="submit" disabled={Boolean(editor.child && editor.name.trim() === editor.child.displayName && !editor.archive)}>{editor.child ? 'Save changes' : 'Create child'}</button>
          <button type="button" onClick={() => { setEditor(null); clearChildSave(); }}>Cancel</button>
        </div>
      </fieldset>
    </form>}

    <div className="child-profiles-save" aria-live="polite">
      {save.status === 'saving' && <p role="status">Saving child profile…</p>}
      {save.status === 'rejected' && <div role="alert"><p id="child-profile-save-error">{save.message}</p><button type="button" onClick={() => void load()}>Reload profiles</button></div>}
      {save.status === 'uncertain' && <div role="alert">
        <h3>Save not confirmed</h3><p>Submitted: {save.intent.displayName ?? 'Archive child'}{save.intent.kind === 'edit' && save.intent.archive ? ' · Archive from tomorrow' : ''}.</p>
        <p>Check / retry to recover the original result. Keep this page open; reloading discards the retry key.</p>
        <button type="button" onClick={() => void retryChild()}>Check / retry</button>
        <a href={window.location.pathname + window.location.search} className="child-profiles-signin">Reopen app to sign in</a>
      </div>}
      {save.status === 'conflict' && <div role="alert">
        <h3>This profile changed</h3>
        <p>Current: {save.current.displayName} · revision {save.current.revision}{save.current.archiveEffectiveDate ? ` · archives from ${save.current.archiveEffectiveDate}` : ' · not archived'}.</p>
        <p>Your change: {save.intent.displayName ?? save.current.displayName}{save.intent.kind === 'edit' && save.intent.archive ? ' · archive from tomorrow' : ''}.</p>
        <div className="child-profiles-actions">
          <button type="button" onClick={() => {
            setEditor({ child: save.current, name: save.current.displayName, templates: [], archive: false });
            clearChildSave(); void load(); nickname.current?.focus();
          }}>Keep current</button>
          <button type="button" onClick={() => void applyChildChange()}>Apply my change</button>
        </div>
      </div>}
    </div>
    </dialog>
    {save.status === 'success' && <p className="child-profiles-save" role="status">Saved {save.child.displayName}.
      {save.intent.kind === 'create' && ` Starts at 0 points. Initial templates are available from ${save.child.startDate}.`}
      {save.child.archiveEffectiveDate && ` Archives from ${save.child.archiveEffectiveDate}. History preserved.`}</p>}
  </section>;
}
