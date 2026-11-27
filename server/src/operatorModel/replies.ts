// The Overlord's replies, decided (context C11, L1; Overlord W1 chat, PR B, plan `w1-chat.md` Task 5, operator item 327). Pure:
// no fs, no clock, no SQL. The report door's `reply` arm (`continuity/routes.ts`, L4) asks `replyTargetVerdict` before anything
// is masked or recorded; the private store's one reply writer (`store.ts#recordReply`, L3) asks `replyLinks`
// (`shared/operatorMessages.ts`, L0) for what a reply answers. A reply id is issued by the message ids' own rule
// (`messages.ts#nextMessageId`, above the store's highest and the privacy journal's highest), over the reply sequence (slug
// `reply-ids-share-the-id-rule`), so one decider says how an id survives a restore.
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import { NOT_THE_OVERLORD } from '../coord/overlordGate.js';

/** What the reply arm does with one session's reply: record it at the designation's current term, or refuse it by a word,
 *  recording nothing. `not-the-overlord` is the gate's step 1 word, spelled in the gate alone (`single-definition/core-vocab`). */
export type ReplyTargetVerdict =
  | { readonly kind: 'record'; readonly term: number }
  | { readonly kind: 'refuse'; readonly word: typeof NOT_THE_OVERLORD | 'unmeasured'; readonly detail: string };

/** Total over the designation's three arms: only the session bound now, at the current term, records. A pending body (a
 *  designate or a rebind not yet live), a session designated at an older term and any other session answer `not-the-overlord`;
 *  an unmeasured designation answers `unmeasured`. The detail never names the text. */
export function replyTargetVerdict(designation: DesignationRead, sessionId: string): ReplyTargetVerdict {
  if (designation.kind === 'unmeasured') return { kind: 'refuse', word: 'unmeasured', detail: 'the designation could not be read' };
  if (designation.kind === 'designated' && designation.sessionId === sessionId) return { kind: 'record', term: designation.term };
  return { kind: 'refuse', word: NOT_THE_OVERLORD, detail: 'only the designated session records a reply' };
}
