import type { AssignmentDetail, Child, ChildIntent, RuleSave, TemplateDetail } from '../../../shared/profiles';
import { usePendingSave, type SaveState } from './pending-save';

export class RequestError<T = Child> extends Error {
  constructor(public status: number, public code: string, message: string, public current?: T) {
    super(message);
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (response.type === 'opaqueredirect' || response.redirected || [401, 403].includes(response.status)
    || !response.headers.get('Content-Type')?.includes('application/json')) {
    throw new RequestError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
  }
  const body = await response.json();
  if (!response.ok) throw new RequestError(response.status, body.error?.code ?? 'UNAVAILABLE',
    body.error?.message ?? 'Request unavailable. Try again.', body.error?.current);
  return body;
}

// ─── Child saves ────────────────────────────────────────────────────────────
// Child create/edit is a single at-a-time save, so it uses one fixed key.
const CHILD_KEY = 'child';
export type ChildSave = SaveState<ChildIntent, Child, Child>;

export function useChildSave(): ChildSave { return usePendingSave<ChildIntent, Child, Child>(CHILD_KEY); }

function runChild(intent: ChildIntent) {
  const { kind: _kind, ...body } = intent;
  const path = intent.kind === 'create' ? '/api/children' : `/api/children/${encodeURIComponent(intent.childId)}`;
  const input = intent.kind === 'edit' ? {
    expectedRevision: intent.expectedRevision,
    ...(intent.displayName !== undefined ? { displayName: intent.displayName } : {}),
    ...(intent.archive ? { archive: true } : {}),
  } : body;
  return async (action: string) => {
    const child = await requestJson<Child>(path, {
      method: intent.kind === 'create' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': action },
      body: JSON.stringify(input),
    });
    if (!child?.id || !Number.isSafeInteger(child.revision)) throw new Error('Invalid save response.');
    return child;
  };
}

export const CHILD_SAVE_KEY = CHILD_KEY;
// The domain write + conflict-resubmit builder a Save flow injects for the child key.
export function childRequest(intent: ChildIntent, action: string) { return runChild(intent)(action); }
export function applyChildConflict(intent: ChildIntent, current: Child): ChildIntent {
  return intent.kind === 'edit' ? { ...intent, expectedRevision: current.revision } : intent;
}

// ─── Template / assignment saves ──────────────────────────────────────────────
// Rule edits (templates on the templates page, a child's assignment plan) are
// likewise one at a time, so they share a single key; callers tell them apart by
// the intent path.
const RULE_KEY = 'rule';
export type RuleIntent = { path: string; method: 'POST' | 'PUT'; body: object; label: string };
export type RuleConflict = AssignmentDetail | TemplateDetail;
export type RuleSaveState = SaveState<RuleIntent, RuleSave, RuleConflict>;

export function useRuleSave(): RuleSaveState { return usePendingSave<RuleIntent, RuleSave, RuleConflict>(RULE_KEY); }

function runRule(intent: RuleIntent) {
  return async (action: string) => {
    const result = await requestJson<RuleSave>(intent.path, {
      method: intent.method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': action },
      body: JSON.stringify(intent.body),
    });
    if (!result?.id || !result.effectiveDate || !Number.isSafeInteger(result.revision)) throw new Error('Invalid save response.');
    return result;
  };
}

export const RULE_SAVE_KEY = RULE_KEY;
// The domain write a Save flow injects for the shared rule key.
export function ruleRequest(intent: RuleIntent, action: string) { return runRule(intent)(action); }

// Which editor an in-flight rule save belongs to, so RootShell can force-render it
// after the user navigates away. Only a save still saving/recovering locks a page;
// a settled conflict/success/rejection stays on its own screen. The id segment is
// URL-encoded in both the save path and the route, so editorPath compares directly.
export type RuleRecovery =
  | { kind: 'assignment'; childId: string }
  | { kind: 'template'; target: { kind: 'create' } | { kind: 'edit'; id: string }; editorPath: string };

export function ruleRecovery(state: RuleSaveState): RuleRecovery | null {
  if (!('intent' in state) || (state.status !== 'saving' && state.status !== 'uncertain')) return null;
  const seg = state.intent.path.split('/');
  if (state.intent.path.startsWith('/api/children/')) {
    return { kind: 'assignment', childId: decodeURIComponent(seg[3] ?? '') };
  }
  if (state.intent.path.startsWith('/api/templates')) {
    return seg.length > 3 && seg[3]
      ? { kind: 'template', target: { kind: 'edit', id: decodeURIComponent(seg[3]) }, editorPath: `/templates/${seg[3]}` }
      : { kind: 'template', target: { kind: 'create' }, editorPath: '/templates/new' };
  }
  return null;
}
