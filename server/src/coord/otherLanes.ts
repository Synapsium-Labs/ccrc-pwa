// The other write lanes (Overlord W1, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md` Task 2;
// spec §3.5 C48, §3.8 H10, §8.1, §15 A5). Ring L1, context C5: one table of the write lanes that are not the Overlord's
// own doors, and the one decision of whether a caller may use one. Pure: no `fs`, store, clock or Fastify.
// `decideOtherLane` awaits only the reads it is handed (`OtherLaneReads`, declared here by its one consumer), as
// `openRunPreconditions` does. The designation is matched the way `roleOf` matches it (`designationFactFrom`, then
// `designationFactOf`), plus an id still on the row's `stopsOwed` (slug `refused-set-is-roleofs-and-owed-stops`), which
// differs on purpose from the Overlord doors' `callerStandingOf`: failing closed on a lane that is not an Overlord door
// means refusing more, so a pending body is refused here and no incarnation is read.
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { OverlordRefusal } from '../../../shared/refusal.js';
import { designationFactFrom, designationFactOf } from '../roleOf.js';

/** How a lane reaches the check. The census (`overlord-other-lanes-census.test.ts`) reads this column. */
export type OtherLaneVia =
  | 'attribution' | 'ingress' | 'landing-write' | 'linear-proxy' | 'plan-door' | 'open-run-gate' | 'reclaim-heir';

const DOORS = 'overlord-uses-its-doors' as const;
const CLAIMANT = 'overlord-not-a-coordinator' as const;

/** The write lanes that refuse the Overlord's body (§3.5, H10, C48; the plan's Table 1). A new lane is a row. */
export const OTHER_LANES = {
  peerMail: { route: 'POST /api/mail', word: DOORS, via: 'ingress' },
  itemRaise: { route: 'POST /api/programmes/:slug/items', word: DOORS, via: 'attribution' },
  claimTake: { route: 'POST /api/claims', word: DOORS, via: 'attribution' },
  claimRelease: { route: 'POST /api/claims/:id/release', word: DOORS, via: 'attribution' },
  questionRule: { route: 'POST /api/questions/:id/rule', word: DOORS, via: 'attribution' },
  questionRelease: { route: 'POST /api/questions/:id/release', word: DOORS, via: 'attribution' },
  coordinatorIntent: { route: 'POST /api/coordinators/:session/intent', word: DOORS, via: 'attribution' },
  landingEntries: { route: 'POST /api/landing/entries', word: DOORS, via: 'landing-write' },
  landingOrder: { route: 'POST /api/landing/order', word: DOORS, via: 'landing-write' },
  linearCreate: { route: 'POST /api/linear/proxy/issues', word: DOORS, via: 'linear-proxy' },
  linearUpdate: { route: 'POST /api/linear/proxy/issues/:id', word: DOORS, via: 'linear-proxy' },
  linearComment: { route: 'POST /api/linear/proxy/issues/:id/comments', word: DOORS, via: 'linear-proxy' },
  linearLink: { route: 'POST /api/linear/proxy/issues/:id/links', word: DOORS, via: 'linear-proxy' },
  planDeclare: { route: 'POST /api/programmes/:slug/plan', word: DOORS, via: 'plan-door' },
  planMet: { route: 'POST /api/programmes/:slug/plan/met', word: DOORS, via: 'plan-door' },
  planTickets: { route: 'POST /api/programmes/:slug/plan/tickets', word: DOORS, via: 'plan-door' },
  planTicketsMove: { route: 'POST /api/programmes/:slug/plan/tickets/move', word: DOORS, via: 'plan-door' },
  planEpicsDrop: { route: 'POST /api/programmes/:slug/plan/epics/drop', word: DOORS, via: 'plan-door' },
  planPhaseRefs: { route: 'POST /api/programmes/:slug/plan/phases/refs', word: DOORS, via: 'plan-door' },
  planTicketsDone: { route: 'POST /api/programmes/:slug/plan/tickets/done', word: DOORS, via: 'plan-door' },
  planClose: { route: 'POST /api/programmes/:slug/plan/close', word: DOORS, via: 'plan-door' },
  planTake: { route: 'POST /api/programmes/:slug/plan/take', word: DOORS, via: 'plan-door' },
  planTriage: { route: 'POST /api/teams/:team/plan/triage', word: DOORS, via: 'plan-door' },
  runOpen: { route: 'POST /api/runs', word: CLAIMANT, via: 'open-run-gate' },
  runReclaim: { route: 'POST /api/runs/:id/reclaim', word: CLAIMANT, via: 'reclaim-heir' },
} as const satisfies Record<string, { route: string; word: OverlordRefusal; via: OtherLaneVia }>;
export type OtherLane = keyof typeof OTHER_LANES;
export const OTHER_LANE_KEYS = Object.keys(OTHER_LANES) as OtherLane[];

/** The caller's `profile` route field, as `fieldMeasured` gave it; `not-read` when the designation was measured. */
export type CallerProfileRead =
  | { readonly kind: 'measured'; readonly word: string } | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly why: string } | 'not-read';

/** What the decider is handed: its consumer's port (L2 by declaration, here beside its one consumer). */
export interface OtherLaneReads {
  readonly designation: () => DesignationRead;
  readonly profile: (sessionId: string) => Promise<Exclude<CallerProfileRead, 'not-read'>>;
}

export type OtherLaneVerdict<L extends OtherLane = OtherLane> =
  | { readonly kind: 'pass' }
  /** The designation was unreadable, and the caller's profile shows it is not the Overlord's body (question 4). */
  | { readonly kind: 'pass-unmeasured'; readonly why: string }
  | { readonly kind: 'refuse'; readonly word: (typeof OTHER_LANES)[L]['word'] | 'unmeasured';
      readonly detail: string };

/** The profile word the designate and rebind doors write on the Overlord's body (designation A). Typed as the role, so
 *  a rename of the role is a compile error here; the census holds the designate door's route literal to this word. */
export const OVERLORD_PROFILE: FleetRole = 'overlord';

/** The kebab words this file spells that are no wire refusal: the `via` column, the verdict's and the profile read's
 *  own kinds. The mail-routes kebab census admits them through `isOtherLaneKebab`; the refusal words are
 *  `OVERLORD_REFUSALS`' and admitted there. */
export const OTHER_LANE_KEBABS = ['landing-write', 'linear-proxy', 'plan-door', 'open-run-gate', 'reclaim-heir',
  'pass-unmeasured', 'not-read'] as const;
export const isOtherLaneKebab = (w: string): boolean => (OTHER_LANE_KEBABS as readonly string[]).includes(w);

const profileText = (p: CallerProfileRead): string =>
  p === 'not-read' ? 'not read' : p.kind === 'measured' ? p.word : p.kind === 'absent' ? 'nothing (absent)' : p.why;

/** The one decision, pure: may this caller use this lane? The plan's order: an unmeasured designation asks the profile;
 *  then the bound or pending body; then an id still owed its stop; otherwise pass. No arm passes by default. */
export function otherLaneVerdict<L extends OtherLane>(lane: L, callerId: string,
  facts: { readonly designation: DesignationRead; readonly profile: CallerProfileRead }): OtherLaneVerdict<L> {
  const { route } = OTHER_LANES[lane];
  const word: (typeof OTHER_LANES)[L]['word'] = OTHER_LANES[lane].word;
  const d = facts.designation;
  const who = lane === 'runReclaim' ? `the heir ${callerId}` : callerId;
  if (d.kind === 'unmeasured') {
    const p = facts.profile;
    const couldBeOverlord = p === 'not-read' || p.kind === 'unreadable'
      || (p.kind === 'measured' && p.word === OVERLORD_PROFILE);
    if (couldBeOverlord) {
      return { kind: 'refuse', word: 'unmeasured', detail: `the Overlord's designation could not be read (${d.why}), and `
        + `${lane === 'runReclaim' ? `${who}'s` : "this caller's"} launch profile reads ${profileText(p)}, so ${route} cannot rule out that it is the Overlord; `
        + 'transient, retry' };
    }
    return { kind: 'pass-unmeasured', why: d.why };
  }
  const refuse: OtherLaneVerdict<L> = { kind: 'refuse', word, detail: `${who} is the Overlord's body, which acts only `
    + `through its own doors (spec §3.5, H10); ${route} is not one of them` };
  const fact = designationFactFrom(d);
  if (fact !== 'unmeasured' && designationFactOf(callerId, fact) !== 'none') return refuse;
  if (d.row !== null && d.row.stopsOwed.includes(callerId)) return refuse;
  return { kind: 'pass' };
}

/** Reads the designation; reads the caller's profile only when the designation is unmeasured; decides. */
export async function decideOtherLane<L extends OtherLane>(lane: L, callerId: string, reads: OtherLaneReads): Promise<OtherLaneVerdict<L>> {
  const designation = reads.designation();
  const profile: CallerProfileRead = designation.kind === 'unmeasured' ? await reads.profile(callerId) : 'not-read';
  return otherLaneVerdict(lane, callerId, { designation, profile });
}

/** The Linear proxy's write verbs and their lanes (`LINEAR_OPS`' class `write`). */
const LINEAR_WRITE_LANES: Readonly<Record<string, OtherLane>> = {
  create: 'linearCreate', update: 'linearUpdate', comment: 'linearComment', link: 'linearLink',
};

/** The lane of a Linear proxy verb, or null for a read (`search` included). */
export function linearLaneOf(verb: string): OtherLane | null {
  return Object.hasOwn(LINEAR_WRITE_LANES, verb) ? LINEAR_WRITE_LANES[verb]! : null;
}
