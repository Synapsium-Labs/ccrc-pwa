/**
 * THE PEER BOUND'S DECISION (#2726; plan `docs/superpowers/plans/2026-11-10-overlord/w1a-invited-replies.md`).
 * L1, pure: no I/O and no clock (the route reads `Date.now()` once and passes it), context C5 by the `coord/**` row.
 *
 * Mail between two sessions outside a run (`runId` null) is bounded at the door so that no session floods another
 * (`PEER_MAIL_MAX_OUTSTANDING` per pair, `PEER_MAIL_HOURLY` per sender, one outstanding per subject; "bound the
 * producer, never the record"). The route (`routes.ts`, check 9 of `POST /api/mail`) reads the facts below from the
 * store and acts on what this module decides.
 */
import { PEER_MAIL_HOURLY, PEER_MAIL_MAX_OUTSTANDING } from '../../../shared/api.js';

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
  /** An outstanding peer mail from `fromId` to `toId` has this subject (`hasOutstandingPeerDuplicate`). */
  readonly duplicate: boolean;
  /** Outstanding peer mails from `fromId` to `toId` (`outstandingPeerCount`). */
  readonly outstanding: number;
  /** `at` of each peer mail `fromId` had accepted in the hour before `now`, ascending (`peerMailAtsInLastHour`). */
  readonly hourAts: readonly number[];
  readonly now: number;
}

/** `bounded`: admitted, inside the bound. Otherwise the refusal, its code being the verdict word. */
export type PeerVerdict =
  | { readonly verdict: 'bounded' }
  | { readonly verdict: 'duplicate'; readonly detail: string }
  | { readonly verdict: 'peer-quota'; readonly detail: string };

/**
 * THE one decision of the peer bound. The order is the door's: `duplicate` first, the most specific refusal ("your
 * message is already queued" tells the sender not to resend at all, where `peer-quota` invites a retry later), then
 * the pair (standing pressure on one recipient), then the sender's hour.
 */
export function peerMailVerdict(f: PeerFacts): PeerVerdict {
  if (f.duplicate) {
    return { verdict: 'duplicate',
      detail: `an outstanding peer mail from ${f.fromId} to ${f.toId} with this subject is already queued` };
  }
  if (f.outstanding >= PEER_MAIL_MAX_OUTSTANDING) {
    return { verdict: 'peer-quota',
      detail: `${PEER_MAIL_MAX_OUTSTANDING} peer mails from ${f.fromId} to ${f.toId} are already outstanding` };
  }
  if (f.hourAts.length >= PEER_MAIL_HOURLY) {
    return { verdict: 'peer-quota', detail: `${f.fromId} has sent ${PEER_MAIL_HOURLY} peer mails in the last hour` };
  }
  return { verdict: 'bounded' };
}
