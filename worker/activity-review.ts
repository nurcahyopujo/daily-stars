import { reviewActivities, reviewDailyStars, type ActivityReviewData } from '../shared/activity-review.ts';
import { readActivityReview } from './activity-review-storage.ts';
import { shiftDate } from './calendar.ts';

export async function getActivityReview(
  db: D1Database,
  childId: string,
  today: string,
  days: 7 | 28,
): Promise<ActivityReviewData | null> {
  const current = { start: shiftDate(today, -days), end: shiftDate(today, -1) };
  const previous = { start: shiftDate(today, -days * 2), end: shiftDate(current.start, -1) };
  const history = await readActivityReview(db, childId, current, previous);
  if (!history) return null;
  const activities = reviewActivities(history.templates, history.scores, current.start);
  const dates = Array.from({ length: days }, (_, index) => shiftDate(current.end, -index));
  const dailyStars = reviewDailyStars(dates, history.scores);
  return { current, previous, dailyStars, activities };
}
