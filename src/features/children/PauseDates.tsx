import { DatePicker } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { useId } from 'react';
import { MAX_PAUSE_DAYS, pauseLength } from '../../../shared/pauses';
import { nextDate, shiftDate } from '../../../worker/calendar';

export type PauseDraft = { startDate: string; endDate: string; reason: string };

// Household dates are plain Jakarta calendar strings; format them from UTC midnight
// so the weekday/day never shifts with the viewer's own time zone.
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export function pauseDay(iso: string) {
  return iso ? dayFormat.format(new Date(iso + 'T00:00:00Z')) : '';
}

/** A short client-side check; the server applies the same rules. */
export function draftProblem(draft: PauseDraft, earliestEnd: string): string | null {
  if (!draft.startDate || !draft.endDate) return 'Choose start and end dates.';
  if (draft.endDate < draft.startDate) return 'End the pause on or after its start date.';
  if (draft.endDate < earliestEnd) return 'End the pause today or later.';
  if (pauseLength(draft.startDate, draft.endDate) > MAX_PAUSE_DAYS) return `A pause can last at most ${MAX_PAUSE_DAYS} days.`;
  if ([...draft.reason.trim()].length > 60) return 'Keep the reason to 60 characters or fewer.';
  return null;
}

// Start date, end date and optional reason for a pause. A running pause keeps its
// start date, so `startLocked` shows it read-only and lets the end move back to today.
export function PauseDates({ draft, today, startLocked, disabled, onChange }: {
  draft: PauseDraft;
  today: string;
  startLocked?: boolean;
  disabled?: boolean;
  onChange: (draft: PauseDraft) => void;
}) {
  const id = useId();
  const tomorrow = nextDate(today);
  const earliestEnd = startLocked ? today : draft.startDate || tomorrow;
  const problem = draftProblem(draft, earliestEnd);
  const days = draft.startDate && draft.endDate && draft.endDate >= draft.startDate ? pauseLength(draft.startDate, draft.endDate) : 0;
  return <div className="pause-dates">
    <div className="pause-dates-row">
      <div className="pause-dates-field">
        <span id={`${id}-start`} className="pause-dates-label">First paused day</span>
        {startLocked
          ? <p className="pause-dates-locked" aria-labelledby={`${id}-start`}>{pauseDay(draft.startDate)} · started</p>
          : <DatePicker aria-labelledby={`${id}-start ${id}-start-value`} valueId={`${id}-start-value`} value={draft.startDate}
              min={tomorrow} today={today} disabled={disabled}
              onSelect={startDate => onChange({ ...draft, startDate,
                endDate: draft.endDate && draft.endDate >= startDate ? draft.endDate : startDate })} />}
      </div>
      <div className="pause-dates-field">
        <span id={`${id}-end`} className="pause-dates-label">Last paused day</span>
        <DatePicker aria-labelledby={`${id}-end ${id}-end-value`} valueId={`${id}-end-value`} value={draft.endDate}
          min={earliestEnd} max={draft.startDate ? shiftDate(draft.startDate, MAX_PAUSE_DAYS - 1) : undefined}
          today={today} disabled={disabled} onSelect={endDate => onChange({ ...draft, endDate })} />
      </div>
    </div>
    <label className="pause-dates-label" htmlFor={`${id}-reason`}>Reason (optional)</label>
    <Input id={`${id}-reason`} value={draft.reason} maxLength={60} placeholder="Holiday, exam week…" disabled={disabled}
      onChange={event => onChange({ ...draft, reason: event.target.value })} />
    <p className="pause-dates-summary" aria-live="polite" data-problem={problem ? '' : undefined}>
      {problem ?? `${days} ${days === 1 ? 'day' : 'days'}. Routines come back on ${pauseDay(nextDate(draft.endDate))}.`}
    </p>
  </div>;
}
