// The confirm sheet of an item's one-tap control (runs rebuild §10; D-8076, D-8293): a title, one consequence line, a confirm
// and Back. `KeepRunSheet` (an end request's Keep the run) and `ReleaseReviewSheet` (a review child's Release) are this sheet with
// their own words and their own call. On `Sheet`, not `QuickConfirm`, for `AbandonSheet`'s reason: the call can be refused (the
// item moved, or is gone), and the refusal is said in the sheet, which stays open. `open === false` renders nothing.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QC_ACTIONS, QC_CONSEQUENCE, Sheet, toast } from '@ccrc/ui';
import { LEDGER_REFUSAL_TEXT, apiErrorText, refusalText } from '../lib/refusalWords';
import './fleet.css';

export interface ItemActSheetProps {
  /** The item the sheet acts on, or `null` when closed. A change of item resets the sheet. */
  itemId: number | null;
  title: string;
  consequence: string;
  confirm: string;
  cancel: string;
  /** The toast said once the call landed. */
  done: string;
  call: (itemId: number) => Promise<unknown>;
  onClose: () => void;
  /** After the call landed. */
  onDone?: (() => void) | undefined;
}

export function ItemActSheet({ itemId, title, consequence, confirm, cancel, done, call, onClose, onDone }: ItemActSheetProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `AbandonSheet`'s generation guard: a close or a switch of item supersedes any answer still in flight.
  const gen = useRef(0);
  useEffect(() => {
    setBusy(false);
    setError(null);
    return () => { gen.current += 1; };
  }, [itemId]);

  if (itemId === null) return null;

  const go = (): void => {
    if (busy) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    void call(itemId).then(
      () => {
        if (gen.current !== mine) return;
        setBusy(false);
        toast(done, 'info');
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
      title={title}
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="primary" disabled={busy} onClick={go}>{confirm}</Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>{cancel}</Button>
        </div>
      }
    >
      <div className="abandon-sheet">
        <p className={QC_CONSEQUENCE}>{consequence}</p>
        {error !== null && <p className="abandon-error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}
