import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useRef, useState } from 'react';
import type { Day, Score } from '../../../shared/scoring';
import { Stars } from './StarBalance';
import { StreamHistory } from './StreamHistory';

const ENTRY_TYPES = [
  { value: 1, label: 'Award' },
  { value: -1, label: 'Deduction' },
] as const;

type Draft = { stream?: string; revision?: number; sign: number; amount: string; reason: string };

// The one-off entries section of the day: add/deduct triggers, the entry list, and
// the add/edit and void dialogs with their draft/confirm state. ScoreDay owns the
// save (via `onSave`) and the day data; this module owns the one-off interaction and
// its own award-flash. It tells ScoreDay when its editor opens so the surrounding
// day view can freeze.
export function OneOffEditor({
  childName, date, entries, historyOf, pending, busy, error, conflict, onSave, onOpenChange,
}: {
  childName: string;
  date: string;
  entries: Score[];
  historyOf: (stream: string) => Score[];
  pending: boolean;
  busy: boolean;
  error: string;
  /** A save landed in conflict: close this editor so the day's conflict prompt can show. */
  conflict: boolean;
  onSave: (method: 'POST' | 'PATCH', stream: string, body: Record<string, unknown>) => Promise<Day | null>;
  onOpenChange?: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Score | null>(null);
  // Marks the entry whose stars just changed, so only its row replays the award
  // animation (a fresh `n` re-keys the stars to retrigger on each save).
  const [flash, setFlash] = useState<{ stream: string; n: number } | null>(null);
  const flashSeq = useRef(0);
  const doFlash = (stream: string) => setFlash({ stream, n: ++flashSeq.current });

  useEffect(() => { onOpenChange?.(draft !== null); }, [draft, onOpenChange]);
  useEffect(() => { if (conflict) { setDraft(null); setConfirm(false); } }, [conflict]);

  return (
    <>
      <h2>One-off entries</h2>
      <div className="score-actions">
        {[1, -1].map((sign) => (
          <Button key={sign} onClick={() => setDraft({ sign, amount: '', reason: '' })}>
            {sign === 1 ? 'Add stars' : 'Deduct stars'}
          </Button>
        ))}
      </div>
      {entries.map((r) => (
        <article key={r.stream} className="scoring-day-entry">
          <div className="scoring-day-entry-head">
            <h3>{r.reason}</h3>
          </div>
          <p className={`scoring-day-status ${r.outcome === 'void' ? 'is-void' : r.points > 0 ? 'is-done' : 'is-needs'}`}>
            <Stars
              small
              value={r.points}
              animate={flash?.stream === r.stream}
              key={flash?.stream === r.stream ? `award-${flash.n}` : 'stars'}
            />{' '}
            ·{' '}
            {r.outcome === 'void' ? 'Voided' : r.points > 0 ? 'Award' : 'Deduction'}
          </p>
          {r.outcome !== 'void' && (
            <div className="score-actions">
              <Button
                onClick={() =>
                  setDraft({
                    stream: r.stream,
                    revision: r.revision,
                    sign: Math.sign(r.points),
                    amount: String(Math.abs(r.points)),
                    reason: r.reason,
                  })
                }
              >
                Edit entry
              </Button>
              <Button onClick={() => setVoidTarget(r)}>
                Void entry
              </Button>
            </div>
          )}
          <StreamHistory entries={historyOf(r.stream)} />
        </article>
      ))}
      <AlertDialog open={voidTarget !== null} onOpenChange={(open) => { if (!open) setVoidTarget(null); }}>
        <AlertDialogContent className="child-profiles child-profiles-modal modal-standard void-confirmation">
          <AlertDialogHeader className="modal-head">
            <AlertDialogTitle className="modal-title">Void entry?</AlertDialogTitle>
            <AlertDialogDescription className="modal-sub">Void “{voidTarget?.reason}” for {childName} on {date}? This is final.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="modal-footer">
            <AlertDialogCancel className="modal-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (voidTarget) void onSave('PATCH', voidTarget.stream, { expectedRevision: voidTarget.revision, void: true });
              setVoidTarget(null);
            }}>Void entry</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !pending && !busy) {
            setDraft(null);
            setConfirm(false);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="child-profiles child-profiles-modal modal-standard oneoff-modal"
        >
          {draft && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                const editStream = draft.stream;
                const before = new Set(entries.map((entry) => entry.stream));
                void onSave(draft.stream ? 'PATCH' : 'POST', draft.stream ?? 'one-offs', {
                  points: draft.sign * Number(draft.amount),
                  reason: draft.reason.trim(),
                  ...(draft.stream ? { expectedRevision: draft.revision } : {}),
                }).then((fresh) => {
                  if (!fresh) return;
                  // Close only on this submit's own success — never from an outcome
                  // tap elsewhere. Edit knows its stream; a new entry is the one-off
                  // stream the server added that wasn't present before.
                  setDraft(null);
                  setConfirm(false);
                  const stream =
                    editStream ??
                    fresh.history
                      .map((h) => h.stream)
                      .find((s) => s.startsWith('one-offs/') && !before.has(s));
                  if (stream) doFlash(stream);
                });
              }}
            >
              <fieldset disabled={pending}>
                <DialogHeader className="modal-head">
                  <DialogTitle className="modal-title">
                    {draft.stream ? 'Correct entry' : draft.sign === 1 ? 'Add stars' : 'Deduct stars'}
                  </DialogTitle>
                  <DialogDescription className="modal-sub">
                    {confirm
                      ? 'Check the details before saving.'
                      : `For ${childName} on ${date}.`}
                  </DialogDescription>
                </DialogHeader>
                <div className="modal-body">
                  {confirm ? (
                    <p className="oneoff-review">
                      <span className="oneoff-review-amount">
                        <Stars small value={draft.sign * Number(draft.amount || 0)} />
                      </span>
                      {draft.sign === 1 ? 'Award' : 'Deduct'} {draft.amount} stars{' '}
                      {draft.sign === 1 ? 'to' : 'from'} {childName} for {date}.
                      <span className="oneoff-review-reason">{draft.reason}</span>
                    </p>
                  ) : (
                    <>
                      <label>
                        Entry type{' '}
                        <Select
                          items={ENTRY_TYPES}
                          value={draft.sign}
                          onValueChange={(sign) => { if (sign != null) setDraft({ ...draft, sign }); }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ENTRY_TYPES.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label>
                        Stars{' '}
                        <Input
                          autoFocus
                          required
                          type="number"
                          min="1"
                          max="999"
                          value={draft.amount}
                          onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                        />
                      </label>
                      <label>
                        Reason{' '}
                        <Input
                          required
                          maxLength={160}
                          value={draft.reason}
                          onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                        />
                      </label>
                    </>
                  )}
                  {error && <p role="alert" className="modal-error">{error}</p>}
                  {busy && <p role="status" className="modal-saving">Saving…</p>}
                </div>
                <footer className="modal-footer">
                  <Button
                    type="button"
                    className="modal-cancel"
                    disabled={busy}
                    onClick={() => {
                      if (confirm) setConfirm(false);
                      else setDraft(null);
                    }}
                  >
                    {confirm ? 'Back' : 'Cancel'}
                  </Button>
                  <Button type="submit" disabled={!draft.reason.trim() || busy}>
                    {confirm ? 'Confirm' : 'Review entry'}
                  </Button>
                </footer>
              </fieldset>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
