import type { ChildIntent } from '../shared/profiles';
import type { Parent } from './auth';
import { listChildren, listTemplates, saveChild } from './child-storage';
import { jakartaToday } from './calendar';
import { ApiError, json } from './http';

function invalid(message: string): never { throw new ApiError(422, 'INVALID_INPUT', message); }

function displayName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 60) {
    invalid('Enter a nickname of 1–60 trimmed characters.');
  }
  return value.trim();
}

export async function profileRoutes(request: Request, db: D1Database, parent: Parent): Promise<Response | null> {
  const url = new URL(request.url);
  const today = jakartaToday(new Date());
  if (request.method === 'GET' && url.pathname === '/api/children') {
    return json({ today, children: await listChildren(db, today, url.searchParams.get('includeArchived') === 'true') });
  }
  if (request.method === 'GET' && url.pathname === '/api/templates') {
    return json({ today, templates: await listTemplates(db, today) });
  }
  const edit = /^\/api\/children\/([^/]+)$/.exec(url.pathname);
  if (!(request.method === 'POST' && url.pathname === '/api/children') && !(request.method === 'PATCH' && edit)) return null;
  const action = request.headers.get('Idempotency-Key');
  if (!action || !/^[a-zA-Z0-9_-]{16,128}$/.test(action)) {
    throw new ApiError(400, 'INVALID_ACTION_ID', 'Supply an Idempotency-Key of 16–128 letters, digits, underscores or hyphens.');
  }
  let body: unknown;
  try { body = await request.json(); } catch { throw new ApiError(400, 'INVALID_JSON', 'A valid JSON body is required.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Supply a JSON object.');
  const input = body as Record<string, unknown>;
  let intent: ChildIntent;
  if (request.method === 'POST') {
    if (Object.keys(input).some((key) => !['displayName', 'initialTemplateIds'].includes(key))) invalid('Unknown child field.');
    const ids = input.initialTemplateIds === undefined ? [] : input.initialTemplateIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id || id.length > 128)
      || new Set(ids).size !== ids.length) invalid('Select each initial template at most once.');
    intent = { kind: 'create', displayName: displayName(input.displayName), initialTemplateIds: ids };
  } else {
    if (Object.keys(input).some((key) => !['expectedRevision', 'displayName', 'archive'].includes(key))) invalid('Unknown child field.');
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) invalid('Supply the current child revision.');
    if (input.archive !== undefined && input.archive !== true) invalid('Archive must be true.');
    if (input.displayName === undefined && input.archive !== true) invalid('Supply a nickname or archive this child.');
    intent = { kind: 'edit', childId: edit![1], expectedRevision: Number(input.expectedRevision),
      ...(input.displayName !== undefined ? { displayName: displayName(input.displayName) } : {}),
      ...(input.archive === true ? { archive: true as const } : {}),
    };
  }
  const result = await saveChild(db, parent, intent, action);
  return json(result.child, result.status);
}
