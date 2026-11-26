import type { RoutineActivity } from './profiles.ts';

export type Activity = RoutineActivity & {
  template: string;
  templateId: string;
  stream: string;
};
export type Score = {
  stream: string;
  revision: number;
  points: number;
  reason: string;
  outcome: string;
  actor: string;
  recorded: string;
};
/** A pause covering the day, so the screen can say why a routine is missing. */
export type DayPause = { templateId: string; template: string; endDate: string; reason?: string };
export type Day = { today: string; activities: Activity[]; history: Score[]; pauses: DayPause[]; net: number; balance?: number; total: number };

export type ScheduledTemplate = {
  date: string;
  templateId: string;
  template: string;
  activities: RoutineActivity[];
};

export function scheduledActivities(row: ScheduledTemplate): Activity[] {
  const weekday = new Date(row.date + 'T00:00:00Z').getUTCDay() || 7;
  return row.activities
    .filter((activity) => !activity.weekdays || activity.weekdays.includes(weekday))
    .map((activity) => ({
      ...activity,
      template: row.template,
      templateId: row.templateId,
      stream: 'activities/' + row.templateId + '/' + activity.id,
    }));
}
