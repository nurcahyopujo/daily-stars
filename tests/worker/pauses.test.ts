import { describe, expect, it } from 'vitest';
import { addPauses, changePause, endUnassignedPauses, type Pause } from '../../shared/pauses';

const today = '2026-12-18';
const morning = 'morning';
const chores = 'chores';
let sequence = 0;
const context = (overrides: Partial<Parameters<typeof addPauses>[2]> = {}) => ({
  today, assignedTemplateIds: [morning, chores], archiveDate: null, newId: () => `pause-${++sequence}`, ...overrides,
});

describe('adding pauses', () => {
  it('pauses each selected template for a holiday that starts tomorrow', () => {
    sequence = 0;
    const result = addPauses([], { templateIds: [morning, chores], startDate: '2026-12-19', endDate: '2027-01-04', reason: 'Holiday' }, context());
    expect(result).toEqual({ pauses: [
      { id: 'pause-1', templateId: morning, startDate: '2026-12-19', endDate: '2027-01-04', reason: 'Holiday' },
      { id: 'pause-2', templateId: chores, startDate: '2026-12-19', endDate: '2027-01-04', reason: 'Holiday' },
    ] satisfies Pause[] });
  });

  it.each([
    ['starts today', '2026-12-18', '2026-12-20', 'A pause can start tomorrow at the earliest.'],
    ['starts in the past', '2026-12-01', '2026-12-20', 'A pause can start tomorrow at the earliest.'],
    ['ends before it starts', '2026-12-20', '2026-12-19', 'End the pause on or after its start date.'],
    ['is longer than 90 days', '2026-12-19', '2027-03-19', 'A pause can last at most 90 days.'],
    ['has an impossible date', '2026-12-19', '2027-02-30', 'Choose valid start and end dates.'],
  ])('rejects a pause that %s', (_case, startDate, endDate, error) => {
    expect(addPauses([], { templateIds: [morning], startDate, endDate }, context())).toEqual({ error });
  });

  it('lists every selected template that overlaps an existing pause or is no longer assigned', () => {
    const existing: Pause[] = [
      { id: 'winter', templateId: morning, startDate: '2026-12-20', endDate: '2026-12-31' },
      { id: 'later', templateId: chores, startDate: '2027-01-10', endDate: '2027-01-12' },
    ];
    const request = { templateIds: [morning, chores, 'retired-routine'], startDate: '2026-12-28', endDate: '2027-01-03' };
    expect(addPauses(existing, request, context())).toEqual({ conflicts: [
      { templateId: morning, reason: 'overlap' },
      { templateId: 'retired-routine', reason: 'unassigned' },
    ] });
  });

  it('allows back-to-back pauses that share no date', () => {
    const existing: Pause[] = [{ id: 'winter', templateId: morning, startDate: '2026-12-20', endDate: '2026-12-31' }];
    expect(addPauses(existing, { templateIds: [morning], startDate: '2027-01-01', endDate: '2027-01-03' }, context()))
      .toHaveProperty('pauses.length', 2);
  });

  it('rejects a pause that starts on or after the child is archived', () => {
    expect(addPauses([], { templateIds: [morning], startDate: '2026-12-20', endDate: '2026-12-21' },
      context({ archiveDate: '2026-12-20' }))).toEqual({ error: 'This child is archived before the pause starts.' });
  });

  it('accepts a pause of exactly 90 days', () => {
    expect(addPauses([], { templateIds: [morning], startDate: '2026-12-19', endDate: '2027-03-18' }, context()))
      .toHaveProperty('pauses');
  });
});

describe('changing a pause', () => {
  const running: Pause = { id: 'running', templateId: morning, startDate: '2026-12-15', endDate: '2026-12-31', reason: 'Holiday' };
  const upcoming: Pause = { id: 'upcoming', templateId: morning, startDate: '2027-01-10', endDate: '2027-01-12' };
  const ended: Pause = { id: 'ended', templateId: chores, startDate: '2026-12-01', endDate: '2026-12-05' };
  const pauses = [ended, running, upcoming];
  const change = (id: string, next: Parameters<typeof changePause>[2], assignedTemplateIds = [morning, chores]) =>
    changePause(pauses, id, next, { today, archiveDate: null, assignedTemplateIds });

  it('ends a running pause today, so the routine returns tomorrow', () => {
    expect(change('running', { startDate: running.startDate, endDate: today, reason: 'Holiday' })).toEqual({
      pauses: [ended, { ...running, endDate: today }, upcoming],
    });
  });

  it('extends a running pause and updates its reason', () => {
    expect(change('running', { startDate: running.startDate, endDate: '2027-01-05', reason: 'Long holiday' }))
      .toEqual({ pauses: [ended, { ...running, endDate: '2027-01-05', reason: 'Long holiday' }, upcoming] });
  });

  it('keeps a running pause from ending before today or moving its start', () => {
    expect(change('running', { startDate: running.startDate, endDate: '2026-12-17' })).toEqual({ error: 'End the pause today or later.' });
    expect(change('running', { startDate: '2026-12-16', endDate: '2026-12-31' })).toEqual({ error: 'A pause that has started keeps its start date.' });
  });

  it('cancels a pause that has not started, but not one that is running', () => {
    expect(change('upcoming', { cancel: true })).toEqual({ pauses: [ended, running] });
    expect(change('running', { cancel: true })).toEqual({ error: 'This pause has started. End it today instead.' });
  });

  it('reschedules an upcoming pause under the same rules as a new one', () => {
    expect(change('upcoming', { startDate: '2027-01-20', endDate: '2027-01-22' })).toEqual({
      pauses: [ended, running, { ...upcoming, startDate: '2027-01-20', endDate: '2027-01-22' }],
    });
    expect(change('upcoming', { startDate: today, endDate: '2027-01-12' })).toEqual({ error: 'A pause can start tomorrow at the earliest.' });
    expect(change('upcoming', { startDate: '2026-12-30', endDate: '2027-01-12' })).toEqual({ conflicts: [{ templateId: morning, reason: 'overlap' }] });
  });

  it('won’t extend a pause whose template was unassigned, so reassigning it later starts fresh', () => {
    expect(change('running', { startDate: running.startDate, endDate: '2027-01-05' }, [chores]))
      .toEqual({ conflicts: [{ templateId: morning, reason: 'unassigned' }] });
  });

  it('leaves ended and missing pauses alone', () => {
    expect(change('ended', { startDate: ended.startDate, endDate: '2026-12-20' })).toEqual({ error: 'This pause has ended.' });
    expect(change('missing', { cancel: true })).toEqual({ error: 'This pause no longer exists. Reload the pauses.' });
  });
});

describe('unassigning a paused template', () => {
  const running: Pause = { id: 'running', templateId: morning, startDate: '2026-12-15', endDate: '2026-12-31' };
  const upcoming: Pause = { id: 'upcoming', templateId: morning, startDate: '2027-01-10', endDate: '2027-01-12' };
  const ended: Pause = { id: 'ended', templateId: morning, startDate: '2026-12-01', endDate: '2026-12-05' };
  const kept: Pause = { id: 'kept', templateId: chores, startDate: '2026-12-20', endDate: '2026-12-24' };

  it('ends the running pause the day before the change and drops pauses scheduled after it', () => {
    expect(endUnassignedPauses([ended, running, upcoming, kept], [chores], '2026-12-19'))
      .toEqual([ended, { ...running, endDate: '2026-12-18' }, kept]);
  });

  it('changes nothing while the template stays assigned', () => {
    const pauses = [ended, running, upcoming, kept];
    expect(endUnassignedPauses(pauses, [chores, morning], '2026-12-19')).toBe(pauses);
  });
});
