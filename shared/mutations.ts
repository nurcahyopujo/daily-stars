// The parent-mutation status contract, shared by both ends of a Pending save.
//
// A worker Idempotent mutation throws these codes with these HTTP statuses; the
// client Save flow's classifier reads the same table to decide whether a failed
// save settled as a conflict, a plain rejection, or an uncertain outcome to
// recover. Keeping the mapping here is what stops the two ends drifting: the
// client's `uncertain` is *defined by* the worker's SAVE_UNCONFIRMED. See
// GLOSSARY.md › Save flow, Idempotent mutation, Pending save.

/** Canonical mutation error codes and their HTTP status. */
export const MUTATION_STATUS = {
  /** Optimistic-concurrency miss: the row changed under the edit. */
  STALE_EDIT: 409,
  /** The action id was reused with different input. */
  ACTION_REUSED: 409,
  /** The write could not be confirmed; retry with the same action id. */
  SAVE_UNCONFIRMED: 503,
  /** The parent session is no longer valid. */
  SIGN_IN_REQUIRED: 401,
} as const;

export type MutationCode = keyof typeof MUTATION_STATUS;

/** How the client settles a failed save, before it reaches a screen. */
export type SettleKind = 'conflict' | 'rejected' | 'uncertain';

/**
 * Classify an HTTP failure into the settle kind a Save flow acts on.
 *
 *  - STALE_EDIT            → conflict (the server has a newer revision)
 *  - 401                   → uncertain, sign-in required (session lapsed mid-save)
 *  - other 4xx            → rejected (the input was refused; no retry)
 *  - 5xx / network / else  → uncertain (SAVE_UNCONFIRMED or unreachable; retry)
 */
export function classifyFailure(status: number, code: string): { kind: SettleKind; signInRequired: boolean } {
  if (code === 'STALE_EDIT') return { kind: 'conflict', signInRequired: false };
  if (status === MUTATION_STATUS.SIGN_IN_REQUIRED) return { kind: 'uncertain', signInRequired: true };
  if (status >= 400 && status < 500) return { kind: 'rejected', signInRequired: false };
  return { kind: 'uncertain', signInRequired: false };
}
