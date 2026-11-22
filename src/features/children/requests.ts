import { useSyncExternalStore } from 'react';
import type { AssignmentDetail, Child, ChildIntent, RuleSave, TemplateDetail } from '../../../shared/profiles';

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

type Submitted = { action: string; intent: ChildIntent };
type SaveState =
  | { status: 'idle' }
  | (Submitted & { status: 'saving' })
  | (Submitted & { status: 'uncertain'; signInRequired?: boolean })
  | (Submitted & { status: 'conflict'; current: Child })
  | (Submitted & { status: 'rejected'; message: string })
  | (Submitted & { status: 'success'; child: Child });

// Memory only: preserve uncertain intent across screen unmount/resume, never across a reload.
let state: SaveState = { status: 'idle' };
const listeners = new Set<() => void>();
function publish(next: SaveState) { state = next; listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useChildSave() { return useSyncExternalStore(subscribe, () => state); }
export function clearChildSave() { publish({ status: 'idle' }); }
export function resumeChildSave() {
  if (state.status === 'uncertain' && state.signInRequired) publish({ ...state, signInRequired: false });
}

async function send(submitted: Submitted) {
  publish({ ...submitted, status: 'saving' });
  const { intent } = submitted;
  const { kind: _kind, ...body } = intent;
  const path = intent.kind === 'create' ? '/api/children' : `/api/children/${encodeURIComponent(intent.childId)}`;
  const input = intent.kind === 'edit' ? {
    expectedRevision: intent.expectedRevision,
    ...(intent.displayName !== undefined ? { displayName: intent.displayName } : {}),
    ...(intent.archive ? { archive: true } : {}),
  } : body;
  try {
    const child = await requestJson<Child>(path, {
      method: intent.kind === 'create' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submitted.action },
      body: JSON.stringify(input),
    });
    if (!child?.id || !Number.isSafeInteger(child.revision)) throw new Error('Invalid save response.');
    if ('action' in state && state.action === submitted.action) publish({ ...submitted, status: 'success', child });
  } catch (error) {
    if (!('action' in state) || state.action !== submitted.action) return;
    if (error instanceof RequestError && error.code === 'STALE_EDIT' && error.current) {
      publish({ ...submitted, status: 'conflict', current: error.current });
    } else if (error instanceof RequestError && [400, 404, 409, 422].includes(error.status)) {
      publish({ ...submitted, status: 'rejected', message: error.message });
    } else publish({ ...submitted, status: 'uncertain', signInRequired: error instanceof RequestError && error.status === 401 });
  }
}

export function submitChild(intent: ChildIntent) {
  if (['saving', 'uncertain', 'conflict'].includes(state.status)) return;
  return send({ action: crypto.randomUUID(), intent });
}

export function retryChild() {
  if (state.status === 'uncertain') return send({ action: state.action, intent: state.intent });
}

export function applyChildChange() {
  if (state.status !== 'conflict' || state.intent.kind !== 'edit') return;
  return send({ action: crypto.randomUUID(), intent: { ...state.intent, expectedRevision: state.current.revision } });
}

type RuleIntent = { path: string; method: 'POST' | 'PUT'; body: object; label: string };
type SubmittedRule = { action: string; intent: RuleIntent };
type RuleState =
  | { status: 'idle' }
  | (SubmittedRule & { status: 'saving' })
  | (SubmittedRule & { status: 'uncertain'; signInRequired: boolean })
  | (SubmittedRule & { status: 'rejected'; message: string; current?: AssignmentDetail | TemplateDetail })
  | (SubmittedRule & { status: 'success'; result: RuleSave });

let ruleState: RuleState = { status: 'idle' };
const ruleListeners = new Set<() => void>();
function publishRule(next: RuleState) { ruleState = next; ruleListeners.forEach(listener => listener()); }
function subscribeRule(listener: () => void) {
  ruleListeners.add(listener);
  return () => { ruleListeners.delete(listener); };
}
export function useRuleSave() { return useSyncExternalStore(subscribeRule, () => ruleState); }
export function clearRuleSave() { publishRule({ status: 'idle' }); }
export function resumeRuleSave() {
  if (ruleState.status === 'uncertain' && ruleState.signInRequired) publishRule({ ...ruleState, signInRequired: false });
}

async function sendRule(submitted: SubmittedRule) {
  publishRule({ ...submitted, status: 'saving' });
  const { path, method, body } = submitted.intent;
  try {
    const result = await requestJson<RuleSave>(path, {
      method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submitted.action },
      body: JSON.stringify(body),
    });
    if (!result?.id || !result.effectiveDate || !Number.isSafeInteger(result.revision)) throw new Error('Invalid save response.');
    if ('action' in ruleState && ruleState.action === submitted.action) publishRule({ ...submitted, status: 'success', result });
  } catch (error) {
    if (!('action' in ruleState) || ruleState.action !== submitted.action) return;
    if (error instanceof RequestError && [400, 404, 409, 422].includes(error.status)) {
      publishRule({ ...submitted, status: 'rejected', message: error.message,
        current: error.code === 'STALE_EDIT' ? (error as RequestError<AssignmentDetail | TemplateDetail>).current : undefined });
    } else publishRule({ ...submitted, status: 'uncertain', signInRequired: error instanceof RequestError && error.status === 401 });
  }
}

export function submitRule(intent: RuleIntent) {
  if (ruleState.status === 'saving' || ruleState.status === 'uncertain') return;
  return sendRule({ action: crypto.randomUUID(), intent });
}

export function retryRule() {
  if (ruleState.status === 'uncertain') return sendRule({ action: ruleState.action, intent: ruleState.intent });
}
