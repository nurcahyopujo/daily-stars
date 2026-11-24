import type { AssignmentDetail, Child, ChildIntent, RuleSave, TemplateDetail } from '../../../shared/profiles';
import { clear, peek, retry, submit, usePendingSave, type SaveState } from './pending-save';

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
export function clearChildSave() { clear(CHILD_KEY); }

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

export function submitChild(intent: ChildIntent) { return submit<ChildIntent, Child, Child>(CHILD_KEY, intent, runChild(intent)); }
export function retryChild() { return retry<ChildIntent, Child, Child>(CHILD_KEY); }
// Apply my change over a stale edit: resubmit the edit at the server's revision.
export function applyChildChange() {
  const state = peek<ChildIntent, Child, Child>(CHILD_KEY);
  if (state.status !== 'conflict' || state.intent.kind !== 'edit') return;
  const intent: ChildIntent = { ...state.intent, expectedRevision: state.current.revision };
  return submit<ChildIntent, Child, Child>(CHILD_KEY, intent, runChild(intent));
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
export function clearRuleSave() { clear(RULE_KEY); }

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

export function submitRule(intent: RuleIntent) { return submit<RuleIntent, RuleSave, RuleConflict>(RULE_KEY, intent, runRule(intent)); }
export function retryRule() { return retry<RuleIntent, RuleSave, RuleConflict>(RULE_KEY); }
