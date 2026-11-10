// The "Keep the run" sheet of an end-request item (runs rebuild §10, Q4; D-8076): the operator's second control beside Abandon
// run. "Keep run 1009? The asker is told." Its confirm calls `POST /api/items/:id/decline`, which closes the item as declined and
// mails the asker in the same move. On `Sheet`, not `QuickConfirm`, for `AbandonSheet`'s reason: a decline can be refused (the
// item moved, or is gone), and the refusal is said in the sheet, which stays open. Mounted unconditionally at screen level;
// `target === null` is closed and renders nothing.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QC_ACTIONS, QC_CONSEQUENCE, Sheet, toast } from '@ccrc/ui';
import { api } from '../lib/api';
import { LEDGER_REFUSAL_TEXT, apiErrorText, refusalText } from '../lib/refusalWords';
import './fleet.css';

/** The sheet's words, once. */
export const KEEP_RUN_TEXT = {
  title: (runId: number): string => `Keep run ${runId}?`,
  consequence: 'The asker is told.',
  confirm: 'Keep the run',
  cancel: 'Back',
  kept: (runId: number): string => `Kept run ${runId}.`,
} as const;

/** The item and the run it asked to end. */
export interface KeepRunTarget { readonly itemId: number; readonly runId: number }

export interface KeepRunSheetProps {
  target: KeepRunTarget | null;
  onClose: () => void;
  /** After the decline landed. */
  onDone?: () => void;
  /** Injectable for tests; the real call's URL and method are pinned in `api.test.ts`. */
  decline?: (itemId: number) => Promise<unknown>;
}

export function KeepRunSheet({ target, onClose, onDone, decline = api.declineItem }: KeepRunSheetProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `AbandonSheet`'s generation guard: a close or a switch of target supersedes any answer still in flight.
  const gen = useRef(0);
  const itemId = target?.itemId ?? null;
  useEffect(() => {
    setBusy(false);
    setError(null);
    return () => { gen.current += 1; };
  }, [itemId]);

  if (target === null) return null;

  const confirm = (): void => {
    if (busy) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    void decline(target.itemId).then(
      () => {
        if (gen.current !== mine) return;
        setBusy(false);
        toast(KEEP_RUN_TEXT.kept(target.runId), 'info');
        onDone?.();
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;
        setBusy(false);
        setError(refusalText(err, LEDGER_REFUSAL_TEXT) ?? apiErrorText(err));
      },
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={KEEP_RUN_TEXT.title(target.runId)}
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="primary" disabled={busy} onClick={confirm}>{KEEP_RUN_TEXT.confirm}</Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>{KEEP_RUN_TEXT.cancel}</Button>
        </div>
      }
    >
      <div className="abandon-sheet">
        <p className={QC_CONSEQUENCE}>{KEEP_RUN_TEXT.consequence}</p>
        {error !== null && <p className="abandon-error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}
