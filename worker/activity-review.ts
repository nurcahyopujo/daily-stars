import { reviewActivities, reviewDailyStars, type ActivityReviewData, type ReviewScore } from '../shared/activity-review';
import { assignedTemplates, readScheduledTemplates } from './schedule-storage';
import { shiftDate } from './calendar';
import { ApiError } from './http';

export async function getActivityReview(
  db: D1Database,
  childId: string,
  today: string,
  period: string | null,
): Promise<ActivityReviewData> {
  if (period !== null && period !== '7' && period !== '28') {
    throw new ApiError(422, 'INVALID_INPUT', 'Choose seven days or four weeks.');
  }
  const days = period === '28' ? 28 : 7;
  const current = { start: shiftDate(today, -days), end: shiftDate(today, -1) };
  const previous = { start: shiftDate(today, -days * 2), end: shiftDate(current.start, -1) };
  const [child, templates, scores] = await db.batch([
    db.prepare('SELECT id FROM children WHERE id = ?').bind(childId),
    assignedTemplates(db, childId, previous.start, current.end),
    db.prepare(`
      SELECT day AS date, stream, outcome, points FROM effective_scores
      WHERE child_id = ? AND day BETWEEN ? AND ? AND (day >= ? OR stream LIKE 'activities/%')
    `).bind(childId, previous.start, current.end, current.start),
  ]);
  if (!child.results.length) throw new ApiError(404, 'NOT_FOUND', 'Child not found.');

  const effective = scores.results as ReviewScore[];
  const activities = reviewActivities(readScheduledTemplates(templates.results), effective, current.start);
  const dates = Array.from({ length: days }, (_, index) => shiftDate(current.end, -index));
  const dailyStars = reviewDailyStars(dates, effective);
  return { current, previous, dailyStars, activities };
}
