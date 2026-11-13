/**
 * THE PEER BOUND'S DECISION (#2726; plan `docs/superpowers/plans/2026-11-10-overlord/w1a-invited-replies.md`).
 * L1, pure: no I/O and no clock (the route reads `Date.now()` once and passes it), context C5 by the `coord/**` row.
 *
 * Mail between two sessions outside a run (`runId` null) is bounded at the door so that no session floods another
 * (`PEER_MAIL_MAX_OUTSTANDING` per pair, `PEER_MAIL_HOURLY` per sender, one outstanding per subject; "bound the
 * producer, never the record"). The route (`routes.ts`, check 9 of `POST /api/mail`) reads the facts below from the
 * store and acts on what this module decides.
 */

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
