import type { ScheduledTemplate } from '../shared/scoring.ts';

export function assignedTemplates(db: D1Database, childId: string, start: string, end: string) {
  return db.prepare(`
    WITH RECURSIVE dates(day) AS (
      VALUES (?)
      UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < ?
    )
    SELECT d.day AS date, v.template_id AS templateId, v.name AS template,
      v.activities_json AS activitiesJson
    FROM dates d
    JOIN children c ON c.id = ? AND c.start_date <= d.day
      AND (c.archive_effective_date IS NULL OR d.day < c.archive_effective_date)
    JOIN json_each((
      SELECT template_ids_json FROM assignment_versions
      WHERE child_id = c.id AND effective_date <= d.day
      ORDER BY effective_date DESC, revision DESC LIMIT 1
    )) a
    JOIN template_versions v ON v.template_id = a.value AND v.revision = (
      SELECT revision FROM template_versions WHERE template_id = a.value AND effective_date <= d.day
      ORDER BY effective_date DESC, revision DESC LIMIT 1
    )
    WHERE v.retired = 0
    ORDER BY d.day, a.key
  `).bind(start, end, childId);
}

type ScheduledTemplateRow = Omit<ScheduledTemplate, 'activities'> & { activitiesJson: string };

export function readScheduledTemplates(rows: unknown[]): ScheduledTemplate[] {
  return (rows as ScheduledTemplateRow[]).map(({ activitiesJson, ...template }) => ({
    ...template,
    activities: JSON.parse(activitiesJson) as ScheduledTemplate['activities'],
  }));
}
