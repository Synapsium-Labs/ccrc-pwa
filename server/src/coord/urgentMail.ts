/**
 * WHO MAY MARK A MAIL URGENT (mid-turn mail, spec `docs/superpowers/specs/2026-11-19-mid-turn-mail-design.md` §3.1;
 * plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md` Task 2.3, P1 to P4). L1, pure: no I/O, no store and no
 * clock; context C5 by the `coord/**` row. `CoordStore.urgentVerdict` reads the facts below, and the mail ingress acts
 * on what this module decides.
 *
 * Version 1 admits two senders, and each must name the run its mail is about (`mail.runId`):
 *   - a run's coordinator, to the worker or reviewer of that run: the named run is open, the sender claims it, and it
 *     binds the recipient's incarnation, so a reused worker name never lets an earlier occupant's coordinator through;
 *   - the Overlord (the designated session), to a coordinator: the named run is open and the recipient claims it.
 * The named run is what a run's close releases (`cancelOutstandingDeliveries` matches `mail.runId`, spec §3.2), so an
 * urgent mail never outlives the run that granted it. A sender that may mark mail to this recipient but named no run,
 * or another one, is `urgent-wrong-run`; every other sender is `urgent-not-allowed`. A fact the store could not read is
 * `urgent-unmeasured`, never folded into either: the sender's remedy differs (retry later, name the run, or send it as
 * ordinary mail). One urgent mail per sender and recipient may be outstanding (`urgent-outstanding`, P4).
 *
 * The facts come from the binding's one view (`CoordStore.bindingsOf`) as run ids, so the rule for which run binds a
 * session, and which runs are terminal, stays in `coord/runBinding.ts`; this module only compares the ids it is handed.
 * The role it answers is stored once at the insert (`mail.urgentAs`), so a later designation or a closed run never
 * changes what an old mail says (P1).
 */

import type { MailHoldRole } from '../../../shared/mailHold.js';

/** The sender's role for an urgent delivery, stored in `mail.urgentAs` (P1). The words have one home, the hold's
 *  `shared/mailHold.ts#MAILHOLD_ROLES` (ruling `urgent-role-words-two-homes`). */
export type UrgentRole = MailHoldRole;

/** The designation as this rule reads it: whether a session is designated, and which. */
export type UrgentDesignationFact =
  | { readonly kind: 'designated'; readonly sessionId: string }
  | { readonly kind: 'not-designated' }
  | { readonly kind: 'unmeasured' };

/** The ids of a set of open runs, or `unmeasured` when the store could not read it (never an empty list). */
export type UrgentRunIds = readonly number[] | 'unmeasured';

/** What the store reads for the rule, once, only for a send that asks for `urgent: true`. */
export interface UrgentFacts {
  readonly senderId: string;
  /** The resolved recipient: the session `mail_deliveries.toId` names. */
  readonly recipientId: string;
  /** The run the mail names (`mail.runId`), or null when it names none. */
  readonly runId: number | null;
  /** The open runs that bind the recipient's incarnation as their worker or reviewer
   *  (`bindingsOf(recipient).worker({ incarnation })`). */
  readonly recipientWorksOn: UrgentRunIds;
  /** The open runs the sender claims (`bindingsOf(sender).claimant()`). */
  readonly senderClaims: UrgentRunIds;
  /** The open runs the recipient claims (`bindingsOf(recipient).claimant()`), which only the Overlord arm reads. */
  readonly recipientClaims: UrgentRunIds;
  readonly designation: UrgentDesignationFact;
  /** Whether an urgent mail from the sender to the recipient is still outstanding (`CoordStore.urgentOutstanding`,
   *  plan P4): one per sender and recipient. */
  readonly outstanding: boolean;
}

export type UrgentRefusal = 'urgent-not-allowed' | 'urgent-unmeasured' | 'urgent-outstanding' | 'urgent-wrong-run';

export type UrgentVerdict =
  | { readonly kind: 'allowed'; readonly role: UrgentRole }
  | { readonly kind: 'refused'; readonly code: UrgentRefusal; readonly detail: string };

const refused = (code: UrgentRefusal, detail: string): UrgentVerdict => ({ kind: 'refused', code, detail });

/** The sender rule (spec §3.1, plan P2 to P4). Who may send is asked first, so a sender the rule refuses hears why, not
 *  that a mail is outstanding; an allowed sender with an urgent mail to the same recipient still unread is
 *  `urgent-outstanding`. */
export function urgentSenderVerdict(f: UrgentFacts): UrgentVerdict {
  const v = senderVerdict(f);
  if (v.kind === 'allowed' && f.outstanding) {
    return refused('urgent-outstanding',
      `an urgent mail from ${f.senderId} to ${f.recipientId} is still unread; send this one without urgent`);
  }
  return v;
}

/** Who may mark it (spec §3.1, plan P2 and P3). The coordinator arm is asked first, so a sender that qualifies both ways
 *  for the named run is stored as `coordinator`. An arm that allows needs only its own facts, so a fact that cannot
 *  change the answer does not make it unmeasured. */
function senderVerdict(f: UrgentFacts): UrgentVerdict {
  if (f.senderId === f.recipientId) {
    return refused('urgent-not-allowed', 'a session never marks its own mail urgent');
  }
  const names = (ids: UrgentRunIds): boolean => ids !== 'unmeasured' && f.runId !== null && ids.includes(f.runId);
  if (names(f.recipientWorksOn) && names(f.senderClaims)) return { kind: 'allowed', role: 'coordinator' };
  const d = f.designation;
  const asOverlord = d.kind === 'designated' && d.sessionId === f.senderId;
  if (asOverlord && names(f.recipientClaims)) return { kind: 'allowed', role: 'overlord' };
  const worksOn = f.recipientWorksOn;
  const claims = f.senderClaims;
  if (worksOn === 'unmeasured' || claims === 'unmeasured') {
    return refused('urgent-unmeasured', `the runs ${f.recipientId} works on, or the runs ${f.senderId} claims, could not be read`);
  }
  if (d.kind === 'unmeasured') {
    return refused('urgent-unmeasured', 'the Overlord designation could not be read');
  }
  const recipientClaims = f.recipientClaims;
  if (asOverlord && recipientClaims === 'unmeasured') {
    return refused('urgent-unmeasured', `the runs ${f.recipientId} claims could not be read`);
  }
  const shared = worksOn.filter((id) => claims.includes(id));
  const runs = asOverlord && recipientClaims !== 'unmeasured' ? [...shared, ...recipientClaims] : shared;
  if (runs.length > 0) {
    return refused('urgent-wrong-run', `an urgent mail to ${f.recipientId} names the run it is about: run ${runs.join(' or ')}`);
  }
  return refused('urgent-not-allowed',
    `${f.senderId} is neither the coordinator of a run ${f.recipientId} works on nor the Overlord writing to a coordinator`);
}
