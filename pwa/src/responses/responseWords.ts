// The console's "I handled this elsewhere" (Overlord W1, C69), L1: the control's words and its state from the read.
// Pure: no React, no api. The read's wire types are `shared/responses.ts`'s.
import type { ResponseRef, ResponseRowBrief } from '../../../shared/responses';

export const HANDLED_WORDS = { button: 'I handled this elsewhere', handled: 'Marked handled elsewhere', refused: 'Could not mark this. Try again.' } as const;

/** The control's state: nothing to show, an offer naming the unhandled rows' ids, or every row already handled. */
export type HandledState =
  | { readonly kind: 'none' }
  | { readonly kind: 'offer'; readonly ids: readonly number[] }
  | { readonly kind: 'handled' };

export function handledState(rows: readonly ResponseRowBrief[]): HandledState {
  if (rows.length === 0) return { kind: 'none' };
  const ids = rows.filter((r) => r.handledAt === null).map((r) => r.id);
  return ids.length === 0 ? { kind: 'handled' } : { kind: 'offer', ids };
}

/** A ref as the read's query string: `item:<id>` or `digest:<key>`. */
export const refParam = (ref: Extract<ResponseRef, { kind: 'item' | 'digest' }>): string =>
  ref.kind === 'item' ? `item:${ref.id}` : `digest:${ref.key}`;
