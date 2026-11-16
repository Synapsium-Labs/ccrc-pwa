// The Operator Model's deciders (context C11, L1; Overlord W1 private store plan, Task 2). Pure: no fs, no clock, no SQL.
// `OperatorModelStore` (`./store.ts`, L3) asks these before every write, and acts on what they answer.
import { createHash } from 'node:crypto';
import {
  MESSAGE_EVENT_ACTORS, MESSAGE_EVENT_STAMP, MESSAGE_MOVES, MESSAGE_TEXT_MAX_BYTES, SETTLED_BY_ACTOR,
  type MessageActor, type MessageEvent, type MessageStamp, type MessageState, type SettledBy,
} from '../../../shared/operatorMessages.js';
import { utf8Bytes } from '../../../shared/utf8.js';

/** The four delivery stamps a row carries, the furthest of which `deliveryStageOf` reads. */
export interface DeliveryStamps {
  readonly queuedAt: number | null;
  readonly deliveredAt: number | null;
  readonly pickedUpAt: number | null;
}

/** The furthest of `recorded`, `queued`, `delivered` and `picked-up` whose stamp is set. */
export function deliveryStageOf(s: DeliveryStamps): 'recorded' | 'queued' | 'delivered' | 'picked-up' {
  if (s.pickedUpAt !== null) return 'picked-up';
  if (s.deliveredAt !== null) return 'delivered';
  if (s.queuedAt !== null) return 'queued';
  return 'recorded';
}

/** What a move writes: the next state, the stamp it sets when that stamp is null, and the settlement pair it writes or
 *  clears. A refusal names why, in one word. */
export type MessageMoveVerdict =
  | {
    readonly ok: true;
    readonly next: MessageState;
    readonly stamp: MessageStamp | null;
    /** `settle`'s `settledBy`; null for every other event. */
    readonly settledBy: SettledBy | null;
    /** `unsettle` clears `settledAt` and `settledBy` in the same statement. */
    readonly clearSettlement: boolean;
  }
  | { readonly ok: false; readonly why: 'unknown-state' | 'actor' | 'move' };

/** Total over state, event and actor: the message moves table (`MESSAGE_MOVES`) and who may send each event
 *  (`MESSAGE_EVENT_ACTORS`). A row whose state this build does not know (`unknown`) is never moved. */
export function messageMove(
  row: { readonly state: MessageState | 'unknown' } & DeliveryStamps, event: MessageEvent, actor: MessageActor,
): MessageMoveVerdict {
  if (row.state === 'unknown') return { ok: false, why: 'unknown-state' };
  if (!MESSAGE_EVENT_ACTORS[event].includes(actor)) return { ok: false, why: 'actor' };
  const target = MESSAGE_MOVES[row.state][event];
  if (target === undefined) return { ok: false, why: 'move' };
  const next = target === 'delivery-stage' ? deliveryStageOf(row) : target;
  const settledBy = event === 'settle' ? SETTLED_BY_ACTOR[actor as keyof typeof SETTLED_BY_ACTOR] : null;
  return { ok: true, next, stamp: MESSAGE_EVENT_STAMP[event], settledBy, clearSettlement: event === 'unsettle' };
}

/** The cut mark, appended after a single space. Its bytes count inside the cap. */
export const cutMark = (dropped: number): string => ` [cut: ${dropped} more bytes]`;

/** The stored text: `text` as it is when it fits `MESSAGE_TEXT_MAX_BYTES`, else cut at the last whole code point that
 *  fits with the mark, and the mark naming how many bytes were dropped. `sha256` is of the stored text, which is what a
 *  request cites (§5.1). Masking is the route's act (Task 5), before this. */
export function capMessageText(text: string, maxBytes: number = MESSAGE_TEXT_MAX_BYTES):
  { readonly text: string; readonly cut: boolean; readonly sha256: string } {
  const total = utf8Bytes(text);
  if (total <= maxBytes) return { text, cut: false, sha256: sha256Of(text) };
  // The mark is sized for the whole text's byte count, the widest count it can name, so whatever is kept fits with it.
  const budget = maxBytes - utf8Bytes(cutMark(total));
  let kept = '';
  let keptBytes = 0;
  for (const ch of text) {
    const b = utf8Bytes(ch);
    if (keptBytes + b > budget) break;
    kept += ch;
    keptBytes += b;
  }
  const stored = kept + cutMark(total - keptBytes);
  return { text: stored, cut: true, sha256: sha256Of(stored) };
}

const sha256Of = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The next message id: one above the larger of the store's highest and the privacy journal's highest, so neither a
 *  store restored alone nor a crash between the journal's append and the row's commit reissues an id (H27). */
export function nextMessageId(storeHighest: number | null, journalHighest: number | null): number {
  return Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1;
}
