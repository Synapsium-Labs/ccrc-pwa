// The Release sheet of a release-review item (D-8293): a review child kept past its ceiling, because the run it reviewed is
// still open. "Release workspace <id>?" Its confirm calls `POST /api/items/:id/act`, which closes the item and records the
// release; the child reclaim sweep takes the workspace on its next passes and pins its work first. It is `ItemActSheet` with
// these words: a refused act (the item moved, or is still held) is said in the sheet, which stays open. Mounted
// unconditionally at screen level; `target === null` is closed and renders nothing.
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { ItemActSheet } from './ItemActSheet';

/** The sheet's words, once. */
export const RELEASE_REVIEW_TEXT = {
  title: (sessionId: string): string => `Release workspace ${sessionId}?`,
  consequence: (reviewedRunId: number): string =>
    `ccrc stops keeping it for run ${reviewedRunId} and reclaims it on its next passes. Its work is pinned under attic refs first.`,
  confirm: 'Release workspace',
  cancel: 'Back',
  released: (sessionId: string): string => `Released ${sessionId}.`,
} as const;

/** The item, the review child it names and the run that keeps it. */
export interface ReleaseReviewTarget { readonly itemId: number; readonly sessionId: string; readonly reviewedRunId: number }

export interface ReleaseReviewSheetProps {
  target: ReleaseReviewTarget | null;
  onClose: () => void;
  /** After the release landed. */
  onDone?: () => void;
  /** Injectable for tests; the real call's URL and method are pinned in `api.test.ts`. */
  release?: (itemId: number) => Promise<unknown>;
}

export function ReleaseReviewSheet({ target, onClose, onDone, release = api.releaseReviewItem }: ReleaseReviewSheetProps): ReactNode {
  const sessionId = target?.sessionId ?? '';
  return (
    <ItemActSheet itemId={target?.itemId ?? null} title={RELEASE_REVIEW_TEXT.title(sessionId)}
                  consequence={RELEASE_REVIEW_TEXT.consequence(target?.reviewedRunId ?? 0)} confirm={RELEASE_REVIEW_TEXT.confirm}
                  cancel={RELEASE_REVIEW_TEXT.cancel} done={RELEASE_REVIEW_TEXT.released(sessionId)}
                  call={release} onClose={onClose} onDone={onDone} />
  );
}
