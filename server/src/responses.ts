import {
  RECEIPTS_PER_PUSH_MAX,
  type ReceiptIn, type ResponseKind, type ResponseRowState,
} from '../../shared/responses.js';

/**
 * THE RESPONSE RECORD'S RECEIPT RULE (Overlord spec §4.3, C67; plan
 * `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, Task 1).
 *
 * L1, pure, C6: decides over facts and does no I/O; its only imports are L0 values and types from `shared/`. PR B adds
 * the window, outcome, seal, read and retention deciders here.
 */

export interface ReceiptFacts {
  readonly row: { readonly kind: ResponseKind; readonly state: ResponseRowState;
    readonly acceptedSubs: readonly string[] } | null;    // null: no row names the ref
  readonly workerReceipts: number;                       // this row's stored worker receipts of the same kind
}
export type ReceiptVerdict =
  | { readonly keep: true }
  | { readonly keep: false; readonly why: 'no-row' | 'sealed' | 'wrong-source' | 'not-accepted' | 'full' };

const refuse = (why: Extract<ReceiptVerdict, { keep: false }>['why']): ReceiptVerdict => ({ keep: false, why });

/** Whether the door stores a receipt, first match: no row, a sealed row, a source the row's kind never has, a worker's
 *  subscription the push service did not accept (once its verdict landed: a `pending` push's receipt is kept, question
 *  7), and a row already holding `RECEIPTS_PER_PUSH_MAX` worker receipts of that kind (question 19). */
export function receiptVerdict(r: ReceiptIn, f: ReceiptFacts): ReceiptVerdict {
  const row = f.row;
  if (row === null) return refuse('no-row');
  if (row.state === 'sealed') return refuse('sealed');
  const fromWorker = r.from.source === 'worker';
  if (fromWorker !== (row.kind === 'push')) return refuse('wrong-source');
  if (!fromWorker && r.receipt === 'shown') return refuse('wrong-source');
  if (r.from.source === 'worker') {
    if (row.state === 'delivered' && !row.acceptedSubs.includes(r.from.endpointHash)) return refuse('not-accepted');
    if (f.workerReceipts >= RECEIPTS_PER_PUSH_MAX) return refuse('full');
  }
  return { keep: true };
}
