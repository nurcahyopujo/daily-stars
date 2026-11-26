import { Button } from "@/components/ui/button";
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { Pause } from '../../../shared/pauses';
import { draftProblem, pauseDay, PauseDates, type PauseDraft } from './PauseDates';

export type PauseEdit = { startDate: string; endDate: string; reason?: string } | { cancel: true };

// A child's running and upcoming pauses, with a "Pause…" entry point for each
// planned template. Edits go through the assignments page's Save flow.
export function ChildPauses({ childId, pauses, planned, templateName, today, disabled, onSave }: {
  childId: string;
  pauses: Pause[];
  /** Templates in the child's latest plan, in checklist order. */
  planned: { id: string; name: string }[];
  templateName: (templateId: string, date: string) => string;
  today: string;
  disabled: boolean;
  onSave: (pauseId: string, edit: PauseEdit, label: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; draft: PauseDraft } | null>(null);

  return <section className="pause-section" aria-labelledby="pauses-title">
    <div className="pause-section-head">
      <h3 id="pauses-title" className="assign-editor-title">Pauses</h3>
      <Link className="pause-section-link" to="/pauses" search={{ childId }}>Pause several…</Link>
    </div>
    <p className="pause-section-intro">Stop a routine for a holiday or a busy week. It comes back by itself after the last paused day.</p>

    {!pauses.length && <p className="assign-empty">No pauses scheduled.</p>}
    {pauses.length > 0 && <ul className="pause-list" aria-label="Scheduled pauses">
      {pauses.map(pause => {
        const name = templateName(pause.templateId, pause.startDate);
        const running = pause.startDate <= today;
        const draft = editing?.id === pause.id ? editing.draft : null;
        const problem = draft && draftProblem(draft, running ? today : draft.startDate);
        return <li className="pause-item" key={pause.id}>
          <div className="pause-item-body">
            <span className="pause-item-name">{name}</span>
            <span className="pause-item-when">
              {running ? `Paused until ${pauseDay(pause.endDate)}` : `${pauseDay(pause.startDate)} – ${pauseDay(pause.endDate)}`}
              {pause.reason && <> · {pause.reason}</>}
            </span>
          </div>
          {!draft && planned.some(template => template.id === pause.templateId) && <div className="pause-item-actions">
            <Button type="button" className="pause-secondary" disabled={disabled} aria-label={`Change ${name} pause`}
              onClick={() => setEditing({ id: pause.id, draft: { startDate: pause.startDate, endDate: pause.endDate, reason: pause.reason ?? '' } })}>
              Change
            </Button>
            {running
              ? pause.endDate > today && <Button type="button" className="pause-secondary" disabled={disabled} aria-label={`End ${name} pause today`}
                  onClick={() => onSave(pause.id, { startDate: pause.startDate, endDate: today, ...(pause.reason ? { reason: pause.reason } : {}) },
                    `${name} returns tomorrow`)}>End today</Button>
              : <Button type="button" className="pause-secondary" disabled={disabled} aria-label={`Cancel ${name} pause`}
                  onClick={() => onSave(pause.id, { cancel: true }, `${name} pause cancelled`)}>Cancel pause</Button>}
          </div>}
          {draft && <form className="pause-item-editor" onSubmit={event => {
            event.preventDefault();
            if (problem) return;
            const reason = draft.reason.trim();
            onSave(pause.id, { startDate: draft.startDate, endDate: draft.endDate, ...(reason ? { reason } : {}) },
              `${name} paused ${pauseDay(draft.startDate)} – ${pauseDay(draft.endDate)}`);
            setEditing(null);
          }}>
            <PauseDates draft={draft} today={today} startLocked={running} disabled={disabled}
              onChange={next => setEditing({ id: pause.id, draft: next })} />
            <div className="pause-item-actions">
              <Button type="button" className="pause-secondary" onClick={() => setEditing(null)}>Close</Button>
              <Button type="submit" disabled={disabled || !!problem}>Save pause</Button>
            </div>
          </form>}
        </li>;
      })}
    </ul>}

    {planned.length > 0 && <div className="pause-planned">
      <span className="pause-dates-label" id="pause-planned-label">Pause one routine</span>
      <ul className="pause-planned-list" aria-labelledby="pause-planned-label">
        {planned.map(template => <li key={template.id}>
          <Link className="pause-planned-link" to="/pauses" search={{ childId, templateId: template.id }}
            aria-label={`Pause ${template.name}`}>Pause {template.name}…</Link>
        </li>)}
      </ul>
    </div>}
  </section>;
}
