import { MUTATION_STATUS } from '../shared/mutations.ts';
import { ApiError } from './http.ts';

// ─── Idempotent mutation ──────────────────────────────────────────────────────
// The shared contract every parent write route re-grew by hand: a SHA-256
// fingerprint of the normalized intent, the action-id receipt replay (including
// the reused-action guard), and the typed STALE_EDIT / SAVE_UNCONFIRMED outcomes
// a client Save flow interprets. Each route still owns its own write batch and
// retry loop — the receipt row is woven into that batch and its guard columns are
// route-specific — but the idempotency machinery lives here once.
//
// Statuses and codes come from the shared contract, so the worker and the client
// classifier can't drift. See shared/mutations.ts and GLOSSARY.md › Idempotent
// mutation, Pending save.

/** SHA-256 hex of a normalized intent. The caller decides the intent's shape. */
export async function fingerprintOf(intent: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(intent)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type Receipt = { status: number; result: unknown };

/**
 * Look up a prior receipt for this actor + action id. Returns the stored result
 * so a retry replays the original outcome, or null when the action is new. Throws
 * ACTION_REUSED when the action id was already used for different input.
 */
export async function findReceipt(
  db: D1Database, actorId: string, action: string, fingerprint: string,
): Promise<Receipt | null> {
  const row = await db.prepare('SELECT fingerprint, status, result_json FROM mutation_receipts WHERE actor_id = ? AND action_id = ?')
    .bind(actorId, action).first<{ fingerprint: string; status: number; result_json: string }>();
  if (!row) return null;
  if (row.fingerprint !== fingerprint) {
    throw new ApiError(MUTATION_STATUS.ACTION_REUSED, 'ACTION_REUSED', 'This action ID was already used for different input.');
  }
  return { status: row.status, result: JSON.parse(row.result_json) };
}

/** An optimistic-concurrency miss: the row changed under this edit. */
export function staleEdit(message: string, current?: unknown): never {
  throw new ApiError(MUTATION_STATUS.STALE_EDIT, 'STALE_EDIT', message, current);
}

/** The write could not be confirmed; the client should retry with the same action id. */
export function saveUnconfirmed(message = 'Save not confirmed. Check / retry with the same action ID.'): never {
  throw new ApiError(MUTATION_STATUS.SAVE_UNCONFIRMED, 'SAVE_UNCONFIRMED', message);
}
