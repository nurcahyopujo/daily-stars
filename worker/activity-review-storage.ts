import type { DateRange, ReviewScore } from '../shared/activity-review.ts';
import { assignedTemplates, readScheduledTemplates } from './schedule-storage.ts';

export async function readActivityReview(db: D1Database, childId: string, current: DateRange, previous: DateRange) {
  const [child, templates, scores] = await db.batch([
    db.prepare('SELECT id FROM children WHERE id = ?').bind(childId),
    assignedTemplates(db, childId, previous.start, current.end),
    db.prepare(`
      SELECT day AS date, stream, outcome, points FROM effective_scores
      WHERE child_id = ? AND day BETWEEN ? AND ? AND (day >= ? OR stream LIKE 'activities/%')
    `).bind(childId, previous.start, current.end, current.start),
  ]);
  return child.results.length
    ? { templates: readScheduledTemplates(templates.results), scores: scores.results as ReviewScore[] }
    : null;
}
