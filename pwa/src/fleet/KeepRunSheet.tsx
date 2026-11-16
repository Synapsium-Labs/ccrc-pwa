// The "Keep the run" sheet of an end-request item (runs rebuild §10, Q4; D-8076): the operator's second control beside Abandon
// run. "Keep run 1009? The asker is told." Its confirm calls `POST /api/items/:id/decline`, which closes the item as declined and
// mails the asker in the same move. It is `ItemActSheet` with these words: a refused decline is said in the sheet, which stays
// open. Mounted unconditionally at screen level; `target === null` is closed and renders nothing.
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { ItemActSheet } from './ItemActSheet';

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
  const runId = target?.runId ?? 0;
  return (
    <ItemActSheet itemId={target?.itemId ?? null} title={KEEP_RUN_TEXT.title(runId)} consequence={KEEP_RUN_TEXT.consequence}
                  confirm={KEEP_RUN_TEXT.confirm} cancel={KEEP_RUN_TEXT.cancel} done={KEEP_RUN_TEXT.kept(runId)}
                  call={decline} onClose={onClose} onDone={onDone} />
  );
}
