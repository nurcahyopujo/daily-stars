import { scheduledActivities, type ScheduledTemplate, type Score } from './scoring';

export type DateRange = { start: string; end: string };

export type DailyStars = { date: string; routine: number; oneOff: number; net: number };

export type ActivityReviewData = {
  current: DateRange;
  previous: DateRange;
  dailyStars: DailyStars[];
  activities: ReviewedActivity[];
};

export type OutcomeCounts = {
  scheduled: number;
  recorded: number;
  doneCorrectly: number;
  needsImprovement: number;
  unrecorded: number;
};

type ReviewedActivity = {
  stream: string;
  label: string;
  template: string;
  current: OutcomeCounts;
  previous: OutcomeCounts;
};

export type ReviewScore = Pick<Score, 'stream' | 'outcome' | 'points'> & { date: string };

function emptyCounts(): OutcomeCounts {
  return { scheduled: 0, recorded: 0, doneCorrectly: 0, needsImprovement: 0, unrecorded: 0 };
}

export function reviewActivities(
  templates: ScheduledTemplate[],
  scores: ReviewScore[],
  currentStart: string,
): ReviewedActivity[] {
  const outcomes = new Map(scores.map((score) => [score.date + '/' + score.stream, score.outcome]));
  const activities = new Map<string, ReviewedActivity>();
  for (const template of templates) {
    for (const { stream, label } of scheduledActivities(template)) {
      let activity = activities.get(stream);
      if (!activity) {
        activity = { stream, label, template: template.template, current: emptyCounts(), previous: emptyCounts() };
        activities.set(stream, activity);
      }
      // Rows are ordered by date, so labels reflect the last scheduled occurrence in the review.
      activity.label = label;
      activity.template = template.template;
      const counts = template.date >= currentStart ? activity.current : activity.previous;
      const outcome = outcomes.get(template.date + '/' + stream);
      counts.scheduled++;
      if (outcome === 'done_correctly') {
        counts.doneCorrectly++;
        counts.recorded++;
      } else if (outcome === 'needs_improvement') {
        counts.needsImprovement++;
        counts.recorded++;
      } else {
        counts.unrecorded++;
      }
    }
  }
  return [...activities.values()];
}

export function reviewDailyStars(dates: string[], scores: ReviewScore[]): DailyStars[] {
  const daily = new Map(dates.map((date) => [date, { date, routine: 0, oneOff: 0, net: 0 }]));
  for (const score of scores) {
    const stars = daily.get(score.date);
    if (!stars || score.outcome === 'void') continue;
    if (score.stream.startsWith('activities/')) stars.routine += score.points;
    if (score.stream.startsWith('one-offs/')) stars.oneOff += score.points;
    stars.net = stars.routine + stars.oneOff;
  }
  return [...daily.values()];
}
