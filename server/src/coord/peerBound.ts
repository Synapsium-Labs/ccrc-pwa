/**
 * THE PEER BOUND'S DECISION (#2726; plan `docs/superpowers/plans/2026-11-10-overlord/w1a-invited-replies.md`).
 * L1, pure: no I/O and no clock (the route reads `Date.now()` once and passes it), context C5 by the `coord/**` row.
 *
 * Mail between two sessions outside a run (`runId` null) is bounded at the door so that no session floods another
 * (`PEER_MAIL_MAX_OUTSTANDING` per pair, `PEER_MAIL_HOURLY` per sender, one outstanding per subject; "bound the
 * producer, never the record"). The route (`routes.ts`, check 9 of `POST /api/mail`) reads the facts below from the
 * store and acts on what this module decides.
 */
import { PEER_MAIL_HOURLY, PEER_MAIL_MAX_OUTSTANDING, PEER_MAIL_WINDOW_MS, type MailKind, type PeerRetry } from '../../../shared/api.js';

/** A delivery read as an invitation to reply (`CoordStore.invitation`). `mailId` is the invited MAIL row's id, the
 *  key of the one-reply-per-mail rule and of `mail.answersMail`, never the delivery id the wire names: a parked
 *  delivery revived by `reviveParkedDeliveries` carries a new delivery id for the same mail. */
export interface Invitation {
  readonly mailId: number;
  /** The invited mail's sender (`mail.fromId`). */
  readonly inviter: string;
  /** The session the delivery went to (`mail_deliveries.toId`). */
  readonly invitee: string;
  /** A mail is already recorded as this mail's invited reply. */
  readonly answered: boolean;
}

/** What the route read for one peer mail (`runId` null), after its sender was proven and its recipient resolved. */
export interface PeerFacts {
  readonly fromId: string;
  /** The RESOLVED recipient: the id `mail_deliveries.toId` carries, never a role word. */
  readonly toId: string;
  readonly kind: MailKind;
  /** The body's `inReplyTo`: the DELIVERY id of the mail this one answers, the number on the sender's own `id:` line;
   *  null when the body named none. */
  readonly inReplyTo: number | null;
  /** `CoordStore.invitation(inReplyTo)`; null when `inReplyTo` is null or names no delivery. */
  readonly invitation: Invitation | null;
  /** An outstanding peer mail from `fromId` to `toId` has this subject (`hasOutstandingPeerDuplicate`). */
  readonly duplicate: boolean;
  /** Outstanding peer mails from `fromId` to `toId` (`outstandingPeerCount`). */
  readonly outstanding: number;
  /** `at` of each peer mail `fromId` had accepted in the hour before `now`, ascending (`peerMailAtsInLastHour`). */
  readonly hourAts: readonly number[];
  readonly now: number;
}

/** `invited`: admitted outside the bound as the one reply to mail `answersMail`, which the insert records.
 *  `bounded`: admitted, inside the bound. Otherwise the refusal, its code being the verdict word. */
export type PeerVerdict =
  | { readonly verdict: 'invited'; readonly answersMail: number }
  | { readonly verdict: 'bounded' }
  | { readonly verdict: 'duplicate'; readonly detail: string }
  | { readonly verdict: 'peer-quota'; readonly detail: string; readonly retry: PeerRetry };

/**
 * Whether the mail is the one invited reply to the mail its `inReplyTo` delivered (#2726 (a)), and if not, why not.
 * Invited iff all five hold: the delivery exists; the mail is kind `answer`; the delivery went to this mail's sender;
 * the delivered mail came from this mail's recipient; and no mail is recorded as its invited reply yet. `why` is null
 * when the body named no `inReplyTo`, so there is nothing to explain.
 *
 * WHY THIS IS SAFE TO LEAVE OUTSIDE THE BOUND: an invited reply cannot run away. Each one spends an invitation, a mail
 * the recipient itself chose to send, and each invitation buys one reply (`mail_answers_once`). A session can only
 * answer as often as it is asked, so the bound on unasked mail is untouched.
 */
export function invitedReply(f: PeerFacts): { readonly invited: true; readonly mailId: number }
  | { readonly invited: false; readonly why: string | null } {
  if (f.inReplyTo === null) return { invited: false, why: null };
  const inv = f.invitation;
  if (inv === null) return { invited: false, why: `inReplyTo ${f.inReplyTo} names no delivery` };
  if (f.kind !== 'answer') return { invited: false, why: `an invited reply is kind answer, not ${f.kind}` };
  if (inv.invitee !== f.fromId) return { invited: false, why: `delivery ${f.inReplyTo} was not delivered to ${f.fromId}` };
  if (inv.inviter !== f.toId) return { invited: false, why: `delivery ${f.inReplyTo} is not a mail from ${f.toId}` };
  if (inv.answered) return { invited: false, why: `the mail delivery ${f.inReplyTo} carries is already answered` };
  return { invited: true, mailId: inv.mailId };
}

/**
 * THE one decision of the peer bound. An invited reply is admitted first, before every arm (#2726 (a)). Otherwise the
 * order is the door's: `duplicate` first, the most specific refusal ("your message is already queued" tells the
 * sender not to resend at all, where `peer-quota` invites a retry later), then the pair (standing pressure on one
 * recipient), then the sender's hour. A refusal of a mail that named an `inReplyTo` says why it was not invited.
 *
 * A `peer-quota` refusal says when the mail can go (#2726 (c)): `retry` for a client, the same in its `detail` for a
 * reader, and, for a mail that did not try `inReplyTo`, the route round the bound when it is a reply. `duplicate`
 * carries no `retry`: the mail is already queued, so there is nothing to wait out.
 */
export function peerMailVerdict(f: PeerFacts): PeerVerdict {
  const inv = invitedReply(f);
  if (inv.invited) return { verdict: 'invited', answersMail: inv.mailId };
  const notInvited = inv.why === null ? '' : `; not an invited reply: ${inv.why}`;
  const hint = inv.why !== null ? notInvited
    : `. A reply to a mail of ${f.toId}'s is outside this bound: send it as kind answer with inReplyTo set to that ` +
      "mail's delivery id";
  if (f.duplicate) {
    return { verdict: 'duplicate',
      detail: `an outstanding peer mail from ${f.fromId} to ${f.toId} with this subject is already queued${notInvited}` };
  }
  if (f.outstanding >= PEER_MAIL_MAX_OUTSTANDING) {
    return { verdict: 'peer-quota', retry: { on: 'ack', toId: f.toId },
      detail: `${PEER_MAIL_MAX_OUTSTANDING} peer mails from ${f.fromId} to ${f.toId} are already outstanding; ` +
        `it can go when ${f.toId} acks one, which it does when it next reads its mail${hint}` };
  }
  if (f.hourAts.length >= PEER_MAIL_HOURLY) {
    // The mail whose leaving brings the count under the bound: the oldest when the count is exactly the bound.
    const at = f.hourAts[f.hourAts.length - PEER_MAIL_HOURLY]! + PEER_MAIL_WINDOW_MS;
    const inS = Math.max(0, Math.ceil((at - f.now) / 1000));
    return { verdict: 'peer-quota', retry: { on: 'time', at },
      detail: `${f.fromId} has sent ${PEER_MAIL_HOURLY} peer mails in the last hour; it can go at ` +
        `${new Date(at).toISOString()} (in ${inS} s), when the oldest leaves the hour${hint}` };
  }
  return { verdict: 'bounded' };
}
