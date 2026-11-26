import type { DayPause, ScheduledTemplate } from '../shared/scoring.ts';

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
    WHERE v.retired = 0 AND NOT EXISTS (${pausedOn('c.id', 'a.value', 'd.day')})
    ORDER BY d.day, a.key
  `).bind(start, end, childId);
}

// A pause on `template` covering `day`, from the child's latest pause list (ADR 0006).
// The latest list still holds ended pauses, and saves never change past dates.
function pausedOn(child: string, template: string, day: string) {
  return `SELECT 1 FROM json_each((
      SELECT pauses_json FROM assignment_pause_versions WHERE child_id = ${child} ORDER BY revision DESC LIMIT 1
    )) p WHERE json_extract(p.value, '$.templateId') = ${template}
      AND ${day} BETWEEN json_extract(p.value, '$.startDate') AND json_extract(p.value, '$.endDate')`;
}

/** The pauses covering one of a child's activity dates, named as that day's template versions. */
export function pausesOn(db: D1Database, childId: string, date: string) {
  return db.prepare(`
    SELECT json_extract(p.value, '$.templateId') AS templateId, v.name AS template,
      json_extract(p.value, '$.endDate') AS endDate, json_extract(p.value, '$.reason') AS reason
    FROM json_each((
      SELECT pauses_json FROM assignment_pause_versions WHERE child_id = ? ORDER BY revision DESC LIMIT 1
    )) p
    JOIN template_versions v ON v.template_id = json_extract(p.value, '$.templateId') AND v.revision = (
      SELECT revision FROM template_versions WHERE template_id = v.template_id AND effective_date <= ?
      ORDER BY effective_date DESC, revision DESC LIMIT 1
    )
    WHERE ? BETWEEN json_extract(p.value, '$.startDate') AND json_extract(p.value, '$.endDate') AND v.retired = 0
    ORDER BY json_extract(p.value, '$.startDate'), v.name
  `).bind(childId, date, date);
}

export function readDayPauses(rows: unknown[]): DayPause[] {
  return (rows as (DayPause & { reason: string | null })[])
    .map(({ reason, ...pause }) => (reason ? { ...pause, reason } : pause));
}

type ScheduledTemplateRow = Omit<ScheduledTemplate, 'activities'> & { activitiesJson: string };

export function readScheduledTemplates(rows: unknown[]): ScheduledTemplate[] {
  return (rows as ScheduledTemplateRow[]).map(({ activitiesJson, ...template }) => ({
    ...template,
    activities: JSON.parse(activitiesJson) as ScheduledTemplate['activities'],
  }));
}
