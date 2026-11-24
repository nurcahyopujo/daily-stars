import type { Prize, PrizeFields } from '../../../shared/prizes';
import { usePendingSave, type SaveState } from '../children/pending-save';
import { requestJson } from '../children/requests';

// ─── Prize catalog saves ──────────────────────────────────────────────────────
// Prize create / edit / archive is one at a time, so it uses a single key. Kept
// apart from the per-child redemption keys ("prize:<childId>").
export const PRIZE_SAVE_KEY = 'prize-catalog';

export type PrizeIntent =
  | { kind: 'create'; fields: PrizeFields }
  | { kind: 'edit'; id: string; expectedRevision: number; fields: PrizeFields };
export type PrizeSaveState = SaveState<PrizeIntent, Prize, Prize>;

export function usePrizeSave(): PrizeSaveState { return usePendingSave<PrizeIntent, Prize, Prize>(PRIZE_SAVE_KEY); }

export async function prizeRequest(intent: PrizeIntent, action: string): Promise<Prize> {
  const prize = await requestJson<Prize>(intent.kind === 'create' ? '/api/prizes' : `/api/prizes/${encodeURIComponent(intent.id)}`, {
    method: intent.kind === 'create' ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': action },
    body: JSON.stringify(intent.kind === 'create' ? intent.fields : { ...intent.fields, expectedRevision: intent.expectedRevision }),
  });
  if (!prize?.id || !Number.isSafeInteger(prize.revision)) throw new Error('Invalid save response.');
  return prize;
}

export function applyPrizeConflict(intent: PrizeIntent, current: Prize): PrizeIntent {
  return intent.kind === 'edit' ? { ...intent, expectedRevision: current.revision } : intent;
}

/** The editor page a locked (saving / unconfirmed) prize save belongs to, for RootShell. */
export function prizeRecovery(state: PrizeSaveState): { target: PrizeTarget; editorPath: string } | null {
  if (!('intent' in state) || (state.status !== 'saving' && state.status !== 'uncertain')) return null;
  return state.intent.kind === 'create'
    ? { target: { kind: 'create' }, editorPath: '/prizes/new' }
    : { target: { kind: 'edit', id: state.intent.id }, editorPath: `/prizes/${encodeURIComponent(state.intent.id)}` };
}

export type PrizeTarget = { kind: 'create' } | { kind: 'edit'; id: string };
