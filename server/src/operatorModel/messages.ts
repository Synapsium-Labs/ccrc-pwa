// The Operator Model's deciders (context C11, L1; Overlord W1 private store plan, Task 2). Pure: no fs, no clock, no SQL.
// `OperatorModelStore` (`./store.ts`, L3) asks these before every write, and acts on what they answer.
import { createHash } from 'node:crypto';
import {
  MESSAGE_EVENT_ACTORS, MESSAGE_EVENT_STAMP, MESSAGE_MOVES, MESSAGE_TEXT_MAX_BYTES, SETTLED_BY_ACTOR,
  type MessageActor, type MessageEvent, type MessageStamp, type MessageState, type OperatorMessageRow, type SettledBy,
} from '../../../shared/operatorMessages.js';
import { utf8Bytes } from '../../../shared/utf8.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';

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

/** The settlement mark (open question 8, slug `settlement-mark-is-a-whole-message`): `mark` only when the WHOLE text, trimmed,
 *  is exactly `/icommand`, or `I command` in any letter case with exactly one space. A message that merely contains the
 *  words is an ordinary message. Decided on the masked text, which masking does not change for these words. */
export function settlementMarkOf(text: string): 'mark' | 'none' {
  const t = text.trim();
  return t === '/icommand' || /^i command$/i.test(t) ? 'mark' : 'none';
}

/** What the prompt route does with a prompt to one session (open questions 16 and 18): `record` it for the designated
 *  session at its term, `type` it as today, or `refuse` it by a word, with nothing typed and nothing recorded. */
export type PromptTargetVerdict =
  | { readonly kind: 'record'; readonly term: number }
  | { readonly kind: 'type' }
  | { readonly kind: 'refuse'; readonly word: 'unmeasured' | 'stale-designation' | 'bad-request'; readonly detail: string };

/** Total over the designation's three arms and the body's `overlordTerm`. An unmeasured designation refuses every prompt,
 *  before any typing (X7). An `overlordTerm` that is present but not a non-negative safe integer is `bad-request`; one that
 *  does not name THIS session at THIS term is `stale-designation`. Without one, the designated session records and any other
 *  session is typed to. */
export function promptTargetVerdict(
  designation: DesignationRead, sessionId: string, body: { readonly overlordTerm?: unknown },
): PromptTargetVerdict {
  if (designation.kind === 'unmeasured') return { kind: 'refuse', word: 'unmeasured', detail: designation.why };
  const term = body.overlordTerm;
  if (term !== undefined && !(typeof term === 'number' && Number.isSafeInteger(term) && term >= 0)) {
    return { kind: 'refuse', word: 'bad-request', detail: 'overlordTerm: not a non-negative safe integer' };
  }
  const bound = designation.kind === 'designated' && designation.sessionId === sessionId;
  if (term !== undefined && !(bound && designation.term === term)) {
    return { kind: 'refuse', word: 'stale-designation', detail: 'the designation moved since this message was composed' };
  }
  return bound ? { kind: 'record', term: designation.term } : { kind: 'type' };
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

/** What the boot pass could read of the rows that cite a message: the ids cited, a read this build has no table for, or a
 *  read that failed. */
export type CitationRead = { readonly kind: 'measured'; readonly cited: ReadonlySet<number> }
  | { readonly kind: 'not-applicable' } | { readonly kind: 'unmeasured'; readonly why: string };

/** I8, per row: `keep`, or `unsettle` (the move back to its delivery stage), or `unjudged` (citations this build cannot
 *  read, counted). Only a `cite` settlement is judged by the citations; `acknowledge` and `mark` are recorded on the row.
 *  An unreadable citation is never "no row cites it" (open question 9). */
export function bootSettlement(row: Pick<OperatorMessageRow, 'id' | 'state' | 'settledBy'>, cites: CitationRead):
  'keep' | 'unsettle' | 'unjudged' {
  if (row.state !== 'settled') return 'keep';
  if (row.settledBy === 'acknowledge' || row.settledBy === 'mark') return 'keep';
  if (row.settledBy !== 'cite') return 'unjudged';
  if (cites.kind !== 'measured') return 'unjudged';
  return cites.cited.has(row.id) ? 'keep' : 'unsettle';
}

/** For a row `unnudged()` answers: `link` (a nudge mail with its subject exists, so move it to `queued`), `queue` (none,
 *  and the row's own session is the one designated now), `wait` (none, and another session or none is designated, so the
 *  inbox and the card carry it), or `unjudged` (the designation could not be read). The session is compared whatever the
 *  term: the nudge names only the id, and the inbox reads by id. */
export function nudgeRecovery(row: { readonly sessionId: string }, found: boolean, designation: DesignationRead):
  'link' | 'queue' | 'wait' | 'unjudged' {
  if (designation.kind === 'unmeasured') return 'unjudged';
  if (found) return 'link';
  return designation.kind === 'designated' && designation.sessionId === row.sessionId ? 'queue' : 'wait';
}
