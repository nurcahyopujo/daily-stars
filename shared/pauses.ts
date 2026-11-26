// Pause rules: plain functions over a child's pauses. See GLOSSARY.md › Pause and
// docs/adr/0006-pause-as-separate-concept.md. No storage, HTTP or clock access:
// callers pass `today` and the child's latest planned templates.

export type Pause = { id: string; templateId: string; startDate: string; endDate: string; reason?: string };

export type PauseRequest = { templateIds: string[]; startDate: string; endDate: string; reason?: string };

export type PauseContext = {
  today: string;
  /** Templates in the child's latest plan (scheduled change, else today's). */
  assignedTemplateIds: string[];
  archiveDate: string | null;
  newId: () => string;
};

export const MAX_PAUSE_DAYS = 90;

const DAY_MS = 86_400_000;

function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time / DAY_MS : null;
}

/** The number of days a pause covers, counting both its start and end date. */
export function pauseLength(startDate: string, endDate: string): number {
  return (dayNumber(endDate) ?? 0) - (dayNumber(startDate) ?? 0) + 1;
}

export type PauseConflict = { templateId: string; reason: 'overlap' | 'unassigned' };

export type PauseResult = { pauses: Pause[] } | { error: string } | { conflicts: PauseConflict[] };

const overlaps = (a: Pick<Pause, 'startDate' | 'endDate'>, b: Pick<Pause, 'startDate' | 'endDate'>) =>
  a.startDate <= b.endDate && b.startDate <= a.endDate;

// The date rules shared by a new pause and a change to one. A pause that hasn't
// started must start tomorrow or later; a running pause must end today or later.
function datesError(startDate: string, endDate: string, earliestEnd: string, archiveDate: string | null): string | null {
  if (dayNumber(startDate) === null || dayNumber(endDate) === null) return 'Choose valid start and end dates.';
  if (endDate < startDate) return 'End the pause on or after its start date.';
  if (endDate < earliestEnd) return 'End the pause today or later.';
  if (pauseLength(startDate, endDate) > MAX_PAUSE_DAYS) return `A pause can last at most ${MAX_PAUSE_DAYS} days.`;
  if (archiveDate && archiveDate <= startDate) return 'This child is archived before the pause starts.';
  return null;
}

export function addPauses(existing: Pause[], request: PauseRequest, context: PauseContext): PauseResult {
  const { startDate, endDate } = request;
  if (dayNumber(startDate) !== null && startDate <= context.today) return { error: 'A pause can start tomorrow at the earliest.' };
  const error = datesError(startDate, endDate, startDate, context.archiveDate);
  if (error) return { error };
  const conflicts = request.templateIds.flatMap((templateId): PauseConflict[] =>
    !context.assignedTemplateIds.includes(templateId) ? [{ templateId, reason: 'unassigned' }]
      : existing.some(pause => pause.templateId === templateId && overlaps(pause, request)) ? [{ templateId, reason: 'overlap' }]
        : []);
  if (conflicts.length) return { conflicts };
  const created = request.templateIds.map((templateId): Pause => ({
    id: context.newId(), templateId, startDate, endDate, ...(request.reason ? { reason: request.reason } : {}),
  }));
  return { pauses: [...existing, ...created] };
}

export type PauseChange = { startDate: string; endDate: string; reason?: string } | { cancel: true };

/**
 * Change one pause. A pause that hasn't started can be rescheduled or cancelled
 * under the same rules as a new one. A running pause keeps its start date and can
 * end today at the earliest, so dates already paused stay paused. An ended pause
 * is history and never changes.
 */
export function changePause(
  existing: Pause[], pauseId: string, change: PauseChange, context: Pick<PauseContext, 'today' | 'archiveDate' | 'assignedTemplateIds'>,
): PauseResult {
  const pause = existing.find(item => item.id === pauseId);
  if (!pause) return { error: 'This pause no longer exists. Reload the pauses.' };
  const { today } = context;
  if (pause.endDate < today) return { error: 'This pause has ended.' };
  const started = pause.startDate <= today;
  if ('cancel' in change) {
    return started ? { error: 'This pause has started. End it today instead.' }
      : { pauses: existing.filter(item => item !== pause) };
  }
  // Unassigning cut this pause short; reviving it would carry over to a later reassignment.
  if (!context.assignedTemplateIds.includes(pause.templateId)) return { conflicts: [{ templateId: pause.templateId, reason: 'unassigned' }] };
  const { startDate, endDate } = change;
  if (started && startDate !== pause.startDate) return { error: 'A pause that has started keeps its start date.' };
  if (!started && dayNumber(startDate) !== null && startDate <= today) return { error: 'A pause can start tomorrow at the earliest.' };
  const error = datesError(startDate, endDate, started ? today : startDate, started ? null : context.archiveDate);
  if (error) return { error };
  if (existing.some(item => item !== pause && item.templateId === pause.templateId && overlaps(item, change)))
    return { conflicts: [{ templateId: pause.templateId, reason: 'overlap' }] };
  const { reason: _previous, ...kept } = pause;
  const next: Pause = { ...kept, startDate, endDate, ...(change.reason ? { reason: change.reason } : {}) };
  return { pauses: existing.map(item => item === pause ? next : item) };
}

const previousDay = (date: string) => new Date(((dayNumber(date) ?? 0) - 1) * DAY_MS).toISOString().slice(0, 10);

/**
 * Apply an assignment change effective on `effectiveDate` to the child's pauses.
 * Unassigning a template ends its running pause the day before and cancels pauses
 * scheduled from then on, so assigning it again later starts with no pause.
 * Returns the same array when nothing changes.
 */
export function endUnassignedPauses(pauses: Pause[], keptTemplateIds: string[], effectiveDate: string): Pause[] {
  let changed = false;
  const next = pauses.flatMap((pause): Pause[] => {
    if (keptTemplateIds.includes(pause.templateId) || pause.endDate < effectiveDate) return [pause];
    changed = true;
    return pause.startDate >= effectiveDate ? [] : [{ ...pause, endDate: previousDay(effectiveDate) }];
  });
  return changed ? next : pauses;
}
