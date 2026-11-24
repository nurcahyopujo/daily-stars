import { useSyncExternalStore } from 'react';
import { RequestError } from './requests';

// ─── Pending save ───────────────────────────────────────────────────────────
// One keyed engine for every parent mutation that must survive screen unmount
// and resume (never a reload — memory only). It owns the retry contract and
// nothing else: an idempotency action id, the status machine, the stale-response
// guard, and error classification. Optimistic updates and the nav-lock / recovery
// policy stay with the features as adapters over the observable state here.
//
// Key granularity is the caller's to choose; the engine never reads it. Child
// and template/assignment edits use a fixed key ("child", "rule"); day outcomes
// and redemptions key per child ("score:<id>", "prize:<id>") so saves for
// different children coexist. See GLOSSARY.md › Pending save.

export type SaveState<I = unknown, R = unknown, C = unknown> =
  | { status: 'idle' }
  | { status: 'saving'; intent: I }
  | { status: 'uncertain'; intent: I; signInRequired: boolean }
  | { status: 'rejected'; intent: I; message: string }
  | { status: 'conflict'; intent: I; current: C }
  | { status: 'success'; intent: I; result: R };

// The settled outcome a caller awaits from submit/retry: every state except the
// transient saving (and idle, which only means "nothing pending for this key").
export type Settled<I = unknown, R = unknown, C = unknown> =
  Extract<SaveState<I, R, C>, { status: 'uncertain' | 'rejected' | 'conflict' | 'success' }>;

const IDLE: SaveState = { status: 'idle' };
const store = new Map<string, SaveState>();
// The action id + request thunk for each key, kept beside the state so a retry
// replays the exact same request (same idempotency key, same body).
const runners = new Map<string, { action: string; run: (action: string) => Promise<unknown> }>();
const listeners = new Set<() => void>();

function emit() { listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function set(key: string, next: SaveState) {
  if (next.status === 'idle') store.delete(key); else store.set(key, next);
  emit();
}

/** Observe the pending save at `key`. Returns a stable idle value when none. */
export function usePendingSave<I = unknown, R = unknown, C = unknown>(key: string): SaveState<I, R, C> {
  return useSyncExternalStore(subscribe, () => (store.get(key) ?? IDLE) as SaveState<I, R, C>);
}

/** Read the pending save at `key` outside render (seeding, conflict resolution). */
export function peek<I = unknown, R = unknown, C = unknown>(key: string): SaveState<I, R, C> {
  return (store.get(key) ?? IDLE) as SaveState<I, R, C>;
}

async function track<I, R, C>(key: string, intent: I, action: string, run: (action: string) => Promise<R>): Promise<Settled<I, R, C>> {
  runners.set(key, { action, run });
  set(key, { status: 'saving', intent });
  let next: Settled<I, R, C>;
  try {
    const result = await run(action);
    next = { status: 'success', intent, result };
  } catch (error) {
    if (error instanceof RequestError && error.code === 'STALE_EDIT') {
      next = { status: 'conflict', intent, current: error.current as C };
    } else if (error instanceof RequestError && error.status >= 400 && error.status < 500 && error.status !== 401) {
      next = { status: 'rejected', intent, message: error.message };
    } else {
      next = { status: 'uncertain', intent, signInRequired: error instanceof RequestError && error.status === 401 };
    }
  }
  // A newer submit to this key has superseded us: drop this stale outcome.
  if (runners.get(key)?.action !== action) return (store.get(key) ?? IDLE) as Settled<I, R, C>;
  set(key, next);
  return next;
}

/**
 * Start a pending save at `key`. `run` performs the request and must set the
 * `Idempotency-Key` header to the action id it is given, and throw on an invalid
 * success response so it classifies as uncertain. Ignored (resolves undefined)
 * while this key is already saving or awaiting recovery.
 */
export function submit<I, R, C = unknown>(key: string, intent: I, run: (action: string) => Promise<R>): Promise<Settled<I, R, C> | undefined> {
  const current = store.get(key);
  if (current && (current.status === 'saving' || current.status === 'uncertain')) return Promise.resolve(undefined);
  return track<I, R, C>(key, intent, crypto.randomUUID(), run);
}

/** Replay an uncertain save with its original action id and request. */
export function retry<I = unknown, R = unknown, C = unknown>(key: string): Promise<Settled<I, R, C> | undefined> | undefined {
  const current = store.get(key);
  const runner = runners.get(key);
  if (!current || current.status !== 'uncertain' || !runner) return;
  return track<I, R, C>(key, current.intent as I, runner.action, runner.run as (action: string) => Promise<R>);
}

/** Dismiss the pending save at one key (e.g. "Keep current", modal close). */
export function clear(key: string) { runners.delete(key); set(key, IDLE); }

/** Drop every pending save — on sign-out and on an account switch. */
export function clearAll() {
  if (!store.size && !runners.size) return;
  store.clear(); runners.clear(); emit();
}

/** After a session re-check, let any sign-in-blocked save retry again. */
export function resume() {
  let changed = false;
  for (const [key, state] of store) {
    if (state.status === 'uncertain' && state.signInRequired) { store.set(key, { ...state, signInRequired: false }); changed = true; }
  }
  if (changed) emit();
}
