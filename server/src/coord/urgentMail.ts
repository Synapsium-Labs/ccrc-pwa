/**
 * WHO MAY MARK A MAIL URGENT (mid-turn mail, spec `docs/superpowers/specs/2026-11-19-mid-turn-mail-design.md` §3.1;
 * plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md` Task 2.3, P1 to P3). L1, pure: no I/O, no store and no
 * clock; context C5 by the `coord/**` row. The mail ingress (`POST /api/mail`) reads the facts below and acts on what
 * this module decides.
 *
 * Version 1 admits two senders:
 *   - a run's coordinator, to a session that works on a non-terminal run (work or review) it claims;
 *   - the Overlord (the designated session), to a session that claims a non-terminal run.
 * Every other sender is `urgent-not-allowed`. A fact the ingress could not read is `urgent-unmeasured`, never folded
 * into `urgent-not-allowed`: the sender's remedy differs (retry later, versus send it as ordinary mail).
 *
 * The facts come from the binding's one view (`CoordStore.bindingsOf`), so the rule for which run is a session's, and
 * which runs are terminal, stays in `coord/runBinding.ts`; this module is handed the open answers and never re-derives
 * them. The role it answers is stored once at the insert (`mail.urgentAs`), so a later designation or a closed run
 * never changes what an old mail says (P1).
 */

/** The sender's role for an urgent delivery, stored in `mail.urgentAs` (P1). */
export const URGENT_ROLES = ['coordinator', 'overlord'] as const;
export type UrgentRole = (typeof URGENT_ROLES)[number];

/** The designation as this rule reads it: whether a session is designated, and which. */
export type UrgentDesignationFact =
  | { readonly kind: 'designated'; readonly sessionId: string }
  | { readonly kind: 'not-designated' }
  | { readonly kind: 'unmeasured' };

/** What the ingress reads for the rule, once, only for a send that asks for `urgent: true`. */
export interface UrgentFacts {
  readonly senderId: string;
  /** The resolved recipient: the session `mail_deliveries.toId` names. */
  readonly recipientId: string;
  /** The coordinators of the non-terminal runs the recipient works on (`bindingsOf(recipient).claimants()`), or
   *  `unmeasured` when that series could not be read. */
  readonly recipientClaimants: readonly string[] | 'unmeasured';
  /** Whether the recipient claims a non-terminal run (`bindingsOf(recipient).claimant()`), or `unmeasured`. */
  readonly recipientClaimsOpenRun: boolean | 'unmeasured';
  readonly designation: UrgentDesignationFact;
}

export type UrgentRefusal = 'urgent-not-allowed' | 'urgent-unmeasured';

export type UrgentVerdict =
  | { readonly kind: 'allowed'; readonly role: UrgentRole }
  | { readonly kind: 'refused'; readonly code: UrgentRefusal; readonly detail: string };

const refused = (code: UrgentRefusal, detail: string): UrgentVerdict => ({ kind: 'refused', code, detail });

/** The sender rule (spec §3.1, plan P2 and P3). The coordinator arm is asked first, so a sender that qualifies both ways
 *  is stored as `coordinator` when it claims the recipient's run. */
export function urgentSenderVerdict(f: UrgentFacts): UrgentVerdict {
  if (f.senderId === f.recipientId) {
    return refused('urgent-not-allowed', 'a session never marks its own mail urgent');
  }
  const claimants = f.recipientClaimants;
  if (claimants !== 'unmeasured' && claimants.includes(f.senderId)) return { kind: 'allowed', role: 'coordinator' };
  const d = f.designation;
  const asOverlord = d.kind === 'designated' && d.sessionId === f.senderId;
  if (asOverlord && f.recipientClaimsOpenRun === true) return { kind: 'allowed', role: 'overlord' };
  if (claimants === 'unmeasured') {
    return refused('urgent-unmeasured', `the runs ${f.recipientId} works on could not be read`);
  }
  if (d.kind === 'unmeasured') {
    return refused('urgent-unmeasured', 'the Overlord designation could not be read');
  }
  if (asOverlord && f.recipientClaimsOpenRun === 'unmeasured') {
    return refused('urgent-unmeasured', `the runs ${f.recipientId} claims could not be read`);
  }
  return refused('urgent-not-allowed',
    `${f.senderId} is neither the coordinator of a run ${f.recipientId} works on nor the Overlord writing to a coordinator`);
}
