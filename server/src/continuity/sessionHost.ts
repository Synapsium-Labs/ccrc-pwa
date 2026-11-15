// L2 port, context C3 (Session Conversation): `SessionHost`, the renewal lane's view of a session's host (Overlord spec
// §3.6 H2, Table 11.1c row `SessionHost`; W1a renewal act Task 1). Declared by its consumer, the generations lane's acts
// (`renewalActs.ts`); adapter one is ccd (`ccdSessionHost.ts`). Every top-level statement is a type.
//
// THE FAILURE CONTRACT. No method throws: every failure is an answer, and every answer keeps the distinction its
// adapter received. `renew`'s answers sit on one side or the other of the receipt's first half (§3.3.11, "The receipt has
// two halves"): `refused`, `kill-failed` and `capability-missing` touched nothing and are BEFORE it (the old conversation
// still runs); `wake-failed` and `wake-unrestored` are AFTER it (the old conversation ended and no fresh one is proven);
// `unproven` (ccd's exit 7, `roll-fresh-unproven`) means the fresh start could not be proven and the old uuid is back, so
// a fresh start can be asked for again: try again later, never a failure (review 1919); `unreachable` is no answer at all,
// so the half is UNKNOWN, and the lane treats it as after the first half for a retry (it reads the receipt before trying
// again), never as before. `started` is the act answered: both halves are proven only when the start report lands, which
// `receipt` reads.
//
// `compact` (C39's act) is not declared: no consumer asks for it in W1a, so it stays ccd's auto-compact until one does
// (slug port-declares-what-w1a-consumes).
import type { Reading } from './renewalDue.js';

/** The renewal lane's view of a session's host (§3.6 H2). Declared by its consumer; adapter one is ccd. */
export interface SessionHost {
  /** End the conversation and start a fresh one under the same session id, with the role's launch profile. `n` is the
   *  renewal's generation number, carried for the record: the caller keeps the call idempotent on `(n, try)` by reading
   *  the receipt before any retry, and never asks twice for one try. */
  renew(sessionId: string, n: number): Promise<RenewResult>;
  /** Type the one line that starts the fresh conversation's first turn. */
  deliver(sessionId: string, text: string): Promise<DeliverResult>;
  /** The session's context, from a fresh usage sidecar; a stale or missing one is unmeasured. */
  contextUsage(sessionId: string): Promise<Reading<{ readonly tokens: number; readonly window: number }>>;
  /** The second half of the receipt: the newest reported start since a start id, if any. */
  receipt(sessionId: string, sinceStartId: number): Promise<ReceiptRead>;
}

/** `renew`'s answers, each on its side of the receipt's first half (the header). */
export type RenewResult =
  | { readonly kind: 'started' }                                   // both halves pending the start report
  | { readonly kind: 'refused'; readonly reason: string }          // nothing touched: before the first half
  | { readonly kind: 'kill-failed' }                               // before the first half
  | { readonly kind: 'wake-failed' } | { readonly kind: 'wake-unrestored' }   // after the first half
  | { readonly kind: 'unproven' }                                  // exit 7: the old uuid is back; try again later
  | { readonly kind: 'unreachable'; readonly detail: string }      // no answer: the half is unknown
  | { readonly kind: 'capability-missing' };                       // the host cannot renew: nothing sent

/** The words of `RenewResult`, for a reader that must name each. */
export type RenewKind = RenewResult['kind'];

/** `deliver`'s answers: typed, refused by the pane (a dialog, a draft, a session not alive), or no answer. */
export type DeliverResult =
  | { readonly kind: 'sent' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unreachable'; readonly detail: string };

/** `receipt`'s answers: a start reported since the id (the newest one), none yet, or the starts could not be read. */
export type ReceiptRead =
  | { readonly kind: 'started'; readonly startId: number; readonly uuid: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly detail: string };
