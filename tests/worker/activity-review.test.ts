import { expect, it } from 'vitest';
import { reviewActivities, reviewDailyStars, type ReviewScore } from '../../shared/activity-review';
import type { ScheduledTemplate } from '../../shared/scoring';

it('reviews dated schedules and effective scores across a month boundary', () => {
  const activities = [{ id: 'bed', label: 'Straighten the bed', reward: 2, weekdays: [7] }];
  const template = { templateId: 'morning', template: 'Morning routine', activities };
  const schedules: ScheduledTemplate[] = [
    { ...template, date: '2026-11-29' },
    { ...template, date: '2026-11-30' },
    { ...template, date: '2026-12-01', activities: [{ ...activities[0], label: 'Make the bed', reward: 5, weekdays: [2, 3] }] },
    { ...template, date: '2026-12-02', activities: [{ ...activities[0], label: 'Make the bed', reward: 5, weekdays: [2, 3] }] },
  ];
  const stream = 'activities/morning/bed';
  const scores: ReviewScore[] = [
    { date: '2026-11-29', stream, outcome: 'done_correctly', points: 2 },
    { date: '2026-12-01', stream, outcome: 'needs_improvement', points: 0 },
    { date: '2026-12-02', stream, outcome: 'unrecorded', points: 0 },
    { date: '2026-12-01', stream: 'one-offs/award', outcome: 'one-off', points: 5 },
    { date: '2026-12-02', stream: 'one-offs/voided', outcome: 'void', points: 0 },
  ];

  expect(reviewActivities(schedules, scores, '2026-12-01')).toEqual([{
    stream, label: 'Make the bed', template: 'Morning routine',
    previous: { scheduled: 1, recorded: 1, doneCorrectly: 1, needsImprovement: 0, unrecorded: 0 },
    current: { scheduled: 2, recorded: 1, doneCorrectly: 0, needsImprovement: 1, unrecorded: 1 },
  }]);
  expect(reviewDailyStars(['2026-12-02', '2026-12-01', '2026-11-29'], scores)).toEqual([
    { date: '2026-12-02', routine: 0, oneOff: 0, net: 0 },
    { date: '2026-12-01', routine: 0, oneOff: 5, net: 5 },
    { date: '2026-11-29', routine: 2, oneOff: 0, net: 2 },
  ]);
});
