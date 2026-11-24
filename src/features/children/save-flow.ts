import { useCallback, useRef } from 'react';
import { clear, peek, retry as retrySave, submit, usePendingSave } from './pending-save';

// ─── Save flow ────────────────────────────────────────────────────────────────
// The single owner of a parent mutation's lifecycle over a Pending save:
// optimistic update, settle (success / rejected / conflict / recover), reconcile
// to server truth, retry, and apply-over-conflict. It wraps the pending-save
// engine (the deep retry contract) and absorbs the orchestration every screen
// used to re-implement, presenting one derived `phase` plus imperative actions.
//
// Keys stay the caller's choice (fixed `child`/`rule`, or per-child `score:`/
// `prize:`). For a shared key, pass `owns` so the flow only surfaces the pending
// save this instance started — the disambiguation screens used to hand-code.
// See GLOSSARY.md › Save flow, Pending save.

export type Phase = 'idle' | 'saving' | 'recover' | 'conflict' | 'rejected' | 'success';

/** The resolved outcome a caller awaits from run / retry / applyOverConflict. */
export type SaveOutcome<R, C, T> =
  | { phase: 'success'; result: R; data: T | null }
  | { phase: 'conflict'; current: C; data: T | null }
  | { phase: 'rejected'; message: string }
  | { phase: 'recover'; signInRequired: boolean }
  | { phase: 'ignored' };

export type RunOptions<T> = {
  /** Apply the optimistic guess now and return a rollback the flow runs on rejection. */
  optimistic?: () => () => void;
  /** Pull the authoritative server state after a settled save; its value is returned to the caller. */
  reconcile?: () => Promise<T | null>;
};

export type SaveFlowConfig<I, R, C> = {
  key: string;
  /** The domain write. Must set the Idempotency-Key header to `action` where the route expects it. */
  request: (intent: I, action: string) => Promise<R>;
  /** For a shared key: does the in-flight pending save belong to this instance? Defaults to true. */
  owns?: (intent: I) => boolean;
  /** Build the resubmit intent for "apply my change" over a conflict, at the server's revision. */
  applyConflict?: (intent: I, current: C) => I;
};

export type SaveFlow<I, R, C, T> = {
  /** Derived view-state. Screens render on this instead of reading a raw SaveState. */
  phase: Phase;
  intent: I | undefined;
  error: string | undefined;
  conflict: C | undefined;
  result: R | undefined;
  signInRequired: boolean;
  /** A save is in flight. */
  busy: boolean;
  /** The flow holds the UI: saving, recovering, or in conflict. */
  frozen: boolean;
  run: (intent: I, options?: RunOptions<T>) => Promise<SaveOutcome<R, C, T>>;
  /** Replay a recovering save. Pass `reconcile` when recovering on a fresh mount (no prior run). */
  retry: (options?: { reconcile?: () => Promise<T | null> }) => Promise<SaveOutcome<R, C, T>>;
  applyOverConflict: () => Promise<SaveOutcome<R, C, T>>;
  dismiss: () => void;
};

const RECOVER_MESSAGE = 'Save not confirmed. Keep this page open and retry.';

const PHASE: Record<string, Phase> = {
  idle: 'idle', saving: 'saving', uncertain: 'recover',
  rejected: 'rejected', conflict: 'conflict', success: 'success',
};

export function useSaveFlow<I, R, C = unknown, T = unknown>(config: SaveFlowConfig<I, R, C>): SaveFlow<I, R, C, T> {
  const { key } = config;
  const cfg = useRef(config);
  cfg.current = config;
  const reconcileRef = useRef<(() => Promise<T | null>) | null>(null);
  const rollbackRef = useRef<(() => void) | null>(null);

  const state = usePendingSave<I, R, C>(key);
  // Mask the shared-key store to this instance's pending save.
  const mine = state.status !== 'idle' && (!cfg.current.owns || cfg.current.owns(state.intent));
  const view = mine ? state : null;

  const settle = useCallback(async (
    outcome: ReturnType<typeof peek> | Awaited<ReturnType<typeof submit>>,
    rollback: (() => void) | null,
  ): Promise<SaveOutcome<R, C, T>> => {
    if (!outcome || outcome.status === 'idle' || outcome.status === 'saving') return { phase: 'ignored' };
    if (outcome.status === 'success') {
      // Leave the success in the store: a settled success is a cross-screen handoff
      // (e.g. the templates list reads it after the editor navigates there). Callers
      // dismiss() when they're done with it, or the next save supersedes it.
      const data = reconcileRef.current ? await reconcileRef.current() : null;
      return { phase: 'success', result: outcome.result as R, data };
    }
    if (outcome.status === 'conflict') {
      const data = reconcileRef.current ? await reconcileRef.current() : null;
      return { phase: 'conflict', current: outcome.current as C, data };
    }
    if (outcome.status === 'rejected') {
      rollback?.();
      return { phase: 'rejected', message: outcome.message };
    }
    return { phase: 'recover', signInRequired: outcome.signInRequired };
  }, [key]);

  const run = useCallback(async (intent: I, options?: RunOptions<T>): Promise<SaveOutcome<R, C, T>> => {
    // Don't apply the optimistic guess if the engine would ignore this submit.
    const current = peek(key);
    if (current.status === 'saving' || current.status === 'uncertain') return { phase: 'ignored' };
    reconcileRef.current = options?.reconcile ?? null;
    rollbackRef.current = options?.optimistic ? options.optimistic() : null;
    const outcome = await submit<I, R, C>(key, intent, (action) => cfg.current.request(intent, action));
    return settle(outcome, rollbackRef.current);
  }, [key, settle]);

  const retry = useCallback(async (options?: { reconcile?: () => Promise<T | null> }): Promise<SaveOutcome<R, C, T>> => {
    if (options?.reconcile) reconcileRef.current = options.reconcile;
    const result = retrySave<I, R, C>(key);
    if (!result) return { phase: 'ignored' };
    return settle(await result, rollbackRef.current);
  }, [key, settle]);

  const applyOverConflict = useCallback(async (): Promise<SaveOutcome<R, C, T>> => {
    const s = peek<I, R, C>(key);
    if (s.status !== 'conflict' || !cfg.current.applyConflict) return { phase: 'ignored' };
    const next = cfg.current.applyConflict(s.intent, s.current);
    const outcome = await submit<I, R, C>(key, next, (action) => cfg.current.request(next, action));
    return settle(outcome, null);
  }, [key, settle]);

  const dismiss = useCallback(() => clear(key), [key]);

  const status = view?.status ?? 'idle';
  return {
    phase: PHASE[status],
    intent: view && 'intent' in view ? view.intent : undefined,
    error: view?.status === 'rejected' ? view.message : view?.status === 'uncertain' ? RECOVER_MESSAGE : undefined,
    conflict: view?.status === 'conflict' ? view.current : undefined,
    result: view?.status === 'success' ? view.result : undefined,
    signInRequired: view?.status === 'uncertain' ? view.signInRequired : false,
    busy: status === 'saving',
    frozen: status === 'saving' || status === 'uncertain' || status === 'conflict',
    run, retry, applyOverConflict, dismiss,
  };
}
