import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { TemplatePicker } from './TemplatePicker';
import { useHouseholdProfiles } from './useHouseholdProfiles';
import { StarBalance } from './StarBalance';
import { useEffect, useRef, useState } from 'react';
import type { Child } from '../../../shared/profiles';
import { applyChildChange, clearChildSave, retryChild, submitChild, useChildSave } from './requests';
import './child-profiles.css';

type Editor = { child: Child | null; name: string; templates: string[]; archive: boolean };

export function ChildProfiles({ onSessionExpired }: { onSessionExpired: () => void }) {
  const { data, templates, loading, error, load } = useHouseholdProfiles(onSessionExpired);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const save = useChildSave();
  const addButton = useRef<HTMLButtonElement>(null);
  const nickname = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const locked = ['saving', 'uncertain', 'conflict'].includes(save.status);

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
    if (!modalOpen && !loading) (opener.current?.isConnected ? opener.current : addButton.current)?.focus();
  }, [modalOpen, loading]);

  function open(child: Child | null, trigger: HTMLButtonElement) {
    opener.current = trigger;
    clearChildSave();
    setEditor({ child, name: child?.displayName ?? '', templates: [], archive: false });
  }

  const available = templates.filter((template) => template.current && !template.current.retired);
  const active = data?.children.filter((child) => !child.archiveEffectiveDate || child.archiveEffectiveDate > data.today) ?? [];
  const archived = data?.children.filter((child) => child.archiveEffectiveDate && child.archiveEffectiveDate <= data.today) ?? [];
  const tomorrow = data ? new Date(`${data.today}T00:00:00Z`) : null;
  tomorrow?.setUTCDate(tomorrow.getUTCDate() + 1);
  const archiveDate = tomorrow?.toISOString().slice(0, 10);

  function childRow(child: Child & { total?: number; balance?: number; todayPoints?: number }) {
    const isArchived = Boolean(child.archiveEffectiveDate && data && child.archiveEffectiveDate <= data.today);
    return <li className="child-profile-card" key={child.id}>
      <div><h2><Link className="child-profile-day" to="/children/$childId/day" params={{ childId: child.id }} aria-describedby={`child-day-${child.id}`}>{child.displayName}</Link></h2>{child.total !== undefined && <StarBalance balance={child.balance ?? child.total} today={child.todayPoints}/>}<p className="child-profile-meta">Started {child.startDate}</p>
        {child.archiveEffectiveDate && <p className="child-profile-meta">{isArchived ? 'Archived from' : 'Archives on'} {child.archiveEffectiveDate} · History preserved</p>}
        <p className="child-profile-hint" id={`child-day-${child.id}`}>{isArchived ? 'View last day' : 'View today'} →</p>
      </div>
      <Button className="child-profile-manage" type="button" disabled={locked || loading} onClick={(event) => open(child, event.currentTarget)} aria-label={`Manage ${child.displayName}`}><Pencil aria-hidden="true" size={18}/></Button>
    </li>;
  }

  return <section className="child-profiles" aria-labelledby="profiles-title" aria-busy={loading}>
    <div className="child-profiles-heading"><div><h1 id="profiles-title">Manage children</h1>
      <p>Keep your children’s profiles and history in one place.</p></div>
      <Button ref={addButton} type="button" disabled={locked || loading} onClick={(event) => open(null, event.currentTarget)}>Add child</Button>
    </div>
    {loading && <p role="status">Loading child profiles…</p>}
    {error && <div role="alert"><p>Couldn’t load child profiles. Check your connection and try again.</p><Button type="button" onClick={() => void load()}>Reload profiles</Button></div>}
    {data && <>
      <p className="child-profiles-date">As of {data.today} · Jakarta</p>
      <Tabs value={tab} onValueChange={(value) => { if (value === 'active' || value === 'archived') setTab(value); }}>
        <TabsList activateOnFocus className="child-profiles-tabs my-3 min-h-11" aria-label="Child status">
          {(['active', 'archived'] as const).map((status) => <TabsTrigger key={status} value={status} className="min-h-11"
            aria-label={`${status === 'active' ? 'Active' : 'Archived'} (${status === 'active' ? active.length : archived.length})`}
            disabled={locked}>
            <span>{status === 'active' ? 'Active' : 'Archived'}</span><strong>{status === 'active' ? active.length : archived.length}</strong>
          </TabsTrigger>)}
        </TabsList>
        <TabsContent value="active" tabIndex={0}>
          {!active.length && <p className="child-profiles-empty">No active children. Add a child to get started.</p>}
          <ul className="child-profiles-list child-profiles-children" aria-label="Active children">{active.map(childRow)}</ul>
        </TabsContent>
        <TabsContent value="archived" tabIndex={0}>
          {!archived.length && <p className="child-profiles-empty">No archived children.</p>}
          <ul className="child-profiles-list child-profiles-children" aria-label="Archived children">{archived.map(childRow)}</ul>
        </TabsContent>
      </Tabs>
    </>}

    <Dialog open={modalOpen} onOpenChange={(open) => {
      if (!open && !locked) { setEditor(null); clearChildSave(); }
    }}>
    <DialogContent showCloseButton={false} className="child-profiles child-profiles-modal" aria-labelledby="child-editor-title" aria-describedby={undefined}>
    <h3 className="modal-title" id="child-editor-title">{editor ? (editor.child ? `Manage ${editor.child.displayName}` : 'Add child') : 'Recover child save'}</h3>
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
        <Input ref={nickname} id="child-nickname" value={editor.name} required
          onChange={(event) => setEditor({ ...editor, name: event.target.value })}
          aria-describedby={`nickname-help${save.status === 'rejected' ? ' child-profile-save-error' : ''}`} />
        <p id="nickname-help">1–60 characters. The current nickname also labels history.</p>
        {!editor.child && <>
          <p>Available immediately. Choose every template needed for day one, in display order.</p>
          <TemplatePicker title="Initial templates (optional)" disabled={locked || loading} selected={editor.templates}
            onChange={(templates) => setEditor({ ...editor, templates })}
            options={available.map(template => ({ id: template.id, version: template.current!, pendingDate: template.pending?.effectiveDate }))}/>
          <p>New profiles start at 0 points. An empty routine still permits one-off points.</p>
        </>}
        {editor.child && !editor.child.archiveEffectiveDate && <label className="child-profiles-template">
          <Checkbox disabled={locked || loading} checked={editor.archive} onCheckedChange={(checked) => setEditor({ ...editor, archive: checked })} />
          <span>Archive from {archiveDate} (tomorrow). Keep all history and earlier corrections.</span>
        </label>}
        {editor.child?.archiveEffectiveDate && <p>Archive date: {editor.child.archiveEffectiveDate}. Earlier entries remain preserved.</p>}
        <div className="child-profiles-actions modal-footer">
          <Button type="button" className="modal-cancel" onClick={() => { setEditor(null); clearChildSave(); }}>Cancel</Button>
          <Button type="submit" disabled={Boolean(editor.child && editor.name.trim() === editor.child.displayName && !editor.archive)}>{editor.child ? 'Save changes' : 'Create child'}</Button>
        </div>
      </fieldset>
    </form>}

    <div className="child-profiles-save" aria-live="polite">
      {save.status === 'saving' && <p role="status">Saving child profile…</p>}
      {save.status === 'rejected' && <div role="alert"><p id="child-profile-save-error">{save.message}</p><Button type="button" onClick={() => void load()}>Reload profiles</Button></div>}
      {save.status === 'uncertain' && <div role="alert">
        <h3>Save not confirmed</h3><p>Submitted: {save.intent.displayName ?? 'Archive child'}{save.intent.kind === 'edit' && save.intent.archive ? ' · Archive from tomorrow' : ''}.</p>
        <p>Check / retry to recover the original result. Keep this page open; reloading discards the retry key.</p>
        <Button type="button" onClick={() => void retryChild()}>Check / retry</Button>
        <a href={window.location.pathname + window.location.search} className="child-profiles-signin">Reopen app to sign in</a>
      </div>}
      {save.status === 'conflict' && <div role="alert">
        <h3>This profile changed</h3>
        <p>Current: {save.current.displayName} · revision {save.current.revision}{save.current.archiveEffectiveDate ? ` · archives from ${save.current.archiveEffectiveDate}` : ' · not archived'}.</p>
        <p>Your change: {save.intent.displayName ?? save.current.displayName}{save.intent.kind === 'edit' && save.intent.archive ? ' · archive from tomorrow' : ''}.</p>
        <div className="child-profiles-actions modal-footer">
          <Button type="button" className="modal-cancel" onClick={() => {
            setEditor({ child: save.current, name: save.current.displayName, templates: [], archive: false });
            clearChildSave(); void load(); nickname.current?.focus();
          }}>Keep current</Button>
          <Button type="button" onClick={() => void applyChildChange()}>Apply my change</Button>
        </div>
      </div>}
    </div>
    </DialogContent>
    </Dialog>
    {save.status === 'success' && <p className="child-profiles-save" role="status">Saved {save.child.displayName}.
      {save.intent.kind === 'create' && ` Starts at 0 points. Initial templates are available from ${save.child.startDate}.`}
      {save.child.archiveEffectiveDate && ` Archives from ${save.child.archiveEffectiveDate}. History preserved.`}</p>}
  </section>;
}
