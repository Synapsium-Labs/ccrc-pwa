// L1, context C3 (Session Conversation): the renewal act's decisions (Overlord spec §3.3.11 H12 and H13; W1a renewal act
// Task 4). Pure: every reading arrives as an argument. The lane (`generationsLane.ts`, L4) reads the rows and the fleet,
// asks these, feeds `generationStep` what they answer and runs the acts (`renewalActs.ts`, L4); it decides nothing itself.
//
// - `renewalPermit`: may a due generation's renewal start this pass? The host must be able to renew (`hibernate-fresh`),
//   a coordinator waits for the Overlord (`overlordFirst`, hard renewals included), and a soft trigger waits for
//   `softRenewalMay`. A hard trigger ignores the soft budget and the preconditions.
// - `renewalFeed`: the events one pass feeds a generation, in order. Each is stamped; an event stamped before the state's
//   stored deadline is fed before `deadline`, and one stamped at or after it is not fed at all, so a fact that arrived in
//   time is never lost to a deadline seen on the same pass (m6, slug events-before-the-deadline-first). `deadline` is last.
// - `renewAnswerEvent`: `SessionHost.renew`'s answer as the machine's event, on its side of the receipt's first half: an
//   unknown half (`unreachable`) and an unproven start (`unproven`, ccd's exit 7) count as after it for a retry, never as
//   before (sessionHost.ts's failure contract).
// - `renewOwed`: the try a `clearing` generation still owes a `renew` call for, from the calls the lane claimed: at most one
//   call per (generation, try), so a retry or a restart never starts a second fresh conversation for one try.
// - `actsOfStep`: which of a written step's machine actions the lane acts on, and the degraded item's reason. Holding and
//   releasing deliveries need no act (the mail gate reads `state`); the probe schedule opens rounds itself; a mint ends and
//   mints; and `renew` is owed by `renewOwed`, never run straight off a step, so a retry waits for the next pass and its
//   receipt read.
import { RENEWAL_LANE_PERIOD_MS, type GenerationState, type TriggerClass } from '../../../shared/continuity.js';
import type { GenAction, GenEvent } from './generationMachine.js';
import { overlordFirst, type OverlordGenerationReading } from './renewalOrder.js';
import type { SoftAnswer, SoftWait } from './softRenewal.js';
import type { RenewResult } from './sessionHost.js';

/** Why a due generation's renewal does not start this pass. */
export type PermitWait = 'capability-missing' | 'overlord-first' | SoftWait;
export type Permit = { readonly feed: true; readonly cls: TriggerClass } | { readonly feed: false; readonly waitFor: PermitWait };

export interface PermitInputs {
  readonly isCoordinator: boolean;
  /** The trigger's class, as the due record stored it. */
  readonly cls: TriggerClass;
  /** `capSupported(…, 'hibernate-fresh')` for the box (Table 11.1d: without it the renewal lane does not run). */
  readonly canRenew: boolean;
  readonly overlord: OverlordGenerationReading;
  /** `softRenewalMay`'s answer for this generation; read only for a soft trigger. */
  readonly soft: SoftAnswer;
}

/** May the renewal start? The host first, then the Overlord for a coordinator (hard included), then, for a soft trigger
 *  only, the soft answer. */
export function renewalPermit(i: PermitInputs): Permit {
  if (!i.canRenew) return { feed: false, waitFor: 'capability-missing' };
  if (i.isCoordinator && !overlordFirst(i.overlord)) return { feed: false, waitFor: 'overlord-first' };
  if (i.cls === 'soft' && !i.soft.start) return { feed: false, waitFor: i.soft.waitFor };
  return { feed: true, cls: i.cls };
}

/** One generation's facts at a pass, as the feed reads them. Every time is wall milliseconds. */
export interface FeedFacts {
  /** The effective state and its deadline (`effectiveGeneration`). */
  readonly state: GenerationState;
  readonly deadlineAt: number | null;
  readonly now: number;
  /** A due the permit answered `feed` for (active, or degraded when hard), or null. */
  readonly due: { readonly cls: TriggerClass } | null;
  /** The hold table and the turn marker say the session is drained (measured this pass). */
  readonly drained: boolean;
  /** When this generation's handover note arrived, or null. */
  readonly handoverAt: number | null;
  readonly renudged: boolean;
}

/** An event the feed stamped, before ordering. */
interface Stamped { readonly at: number; readonly event: GenEvent }

/** Is a fact stamped `at` in time for a state whose deadline is `deadlineAt`? A state with no deadline takes every fact. */
export function beforeDeadline(at: number, deadlineAt: number | null): boolean {
  return deadlineAt === null || at < deadlineAt;
}

/** The nudge point of `carded`: its deadline less the lane period (review 1912 F3), never a second stored fact. */
export function nudgeAtOf(deadlineAt: number): number {
  return deadlineAt - RENEWAL_LANE_PERIOD_MS;
}

/** The events of one pass for one generation, in the order they are fed: stamped facts that arrived before the deadline,
 *  oldest first, then `deadline` when it has passed. Facts the state does not take are not stamped at all. */
export function renewalFeed(f: FeedFacts): readonly GenEvent[] {
  const stamped: Stamped[] = [];
  if (f.due !== null && (f.state === 'active' || (f.state === 'degraded' && f.due.cls === 'hard'))) {
    stamped.push({ at: f.now, event: { kind: 'due', cls: f.due.cls } });
  }
  if (f.state === 'draining' && f.drained) stamped.push({ at: f.now, event: { kind: 'drained' } });
  if (f.state === 'checkpointed' && f.handoverAt !== null) stamped.push({ at: f.handoverAt, event: { kind: 'handover' } });
  if (f.state === 'carded' && !f.renudged && f.deadlineAt !== null && f.now >= nudgeAtOf(f.deadlineAt)) {
    stamped.push({ at: nudgeAtOf(f.deadlineAt), event: { kind: 'nudge-due' } });
  }
  const events = stamped.filter((s) => beforeDeadline(s.at, f.deadlineAt)).sort((a, b) => a.at - b.at).map((s) => s.event);
  if (f.deadlineAt !== null && f.now >= f.deadlineAt) events.push({ kind: 'deadline' });
  return events;
}

/** `renew`'s answer as the machine's event (the port's failure contract): `started` is the receipt's first half; an
 *  answer that touched nothing fails before it; every other answer fails after it, or leaves the half unknown, which a
 *  retry treats as after it. */
export function renewAnswerEvent(r: RenewResult): GenEvent {
  switch (r.kind) {
    case 'started': return { kind: 'host-ended' };
    case 'refused': case 'kill-failed': case 'capability-missing': return { kind: 'host-failed', afterEnd: false };
    case 'wake-failed': case 'wake-unrestored': case 'unproven': case 'unreachable': return { kind: 'host-failed', afterEnd: true };
    default: { const never: never = r; return never; }
  }
}

/** The try a generation owes a `renew` call for: its current try (`attempts`) while it is `clearing` and no call was
 *  claimed for that try; otherwise null. */
export function renewOwed(state: GenerationState, attempts: number, claimedTries: readonly number[]): number | null {
  if (state !== 'clearing' || attempts < 1) return null;
  return claimedTries.includes(attempts) ? null : attempts;
}

/** One act the lane takes for a generation: the port's calls, the system mail, the checkpoint, the item and the hold-off. */
export type RenewalAct =
  | { readonly kind: 'renew'; readonly try: number }
  | { readonly kind: 'first-prompt' }
  | { readonly kind: 'renudge-card' }
  | { readonly kind: 'ask-handover' }
  | { readonly kind: 'assemble-checkpoint' }
  | { readonly kind: 'raise-item'; readonly why: string }
  | { readonly kind: 'set-hold-off' }
  | { readonly kind: 'spot-probe' };

/** Why a step into `degraded` degraded, in plain words, from the state it left and the event that moved it. */
export function degradeWhy(from: GenerationState, event: GenEvent): string {
  if (event.kind === 'probes') return 'its second probe round failed';
  if (event.kind !== 'deadline') return `${event.kind} in ${from}`;
  switch (from) {
    case 'draining': return 'it did not drain before the deadline, and it was never proven';
    case 'checkpointed': return 'its checkpoint was not taken before the deadline';
    case 'clearing': return 'no fresh conversation was proven before the clearing deadline';
    case 'carded': return 'the fresh conversation did not read its card before the deadline';
    case 'probing': return 'its probes were not passed before the deadline';
    default: return `the ${from} deadline passed`;
  }
}

/** The acts a written step asks for (the header): its machine actions, less those the lane takes no act for. */
export function actsOfStep(actions: readonly GenAction[], from: GenerationState, event: GenEvent): readonly RenewalAct[] {
  const out: RenewalAct[] = [];
  for (const a of actions) {
    if (a === 'assemble-checkpoint' || a === 'ask-handover' || a === 'renudge-card' || a === 'set-hold-off') out.push({ kind: a });
    else if (a === 'raise-item') out.push({ kind: 'raise-item', why: degradeWhy(from, event) });
  }
  return out;
}

/** The one line that starts a fresh conversation's first turn, and the card re-nudge (slug first-prompt-by-deliver). */
export const RENEWAL_FIRST_PROMPT = 'Read your card with `ccrc-api card`, then answer your probes with `ccrc-api probe`.';
/** The handover ask's subject (the one mail the renewing gate lets through) and its body (notes review 2039 F11). */
export const RENEWAL_HANDOVER_SUBJECT = 'handover';
export const RENEWAL_HANDOVER_BODY = 'Your renewal is starting. Write your handover note now with `ccrc-api note handover`.';
/** The spot round's notice (ask 415): one system mail telling the session to answer its round. */
export const SPOT_PROBE_SUBJECT = 'probe';
export const SPOT_PROBE_BODY = 'A probe round is open for you. Answer it with `ccrc-api probe`.';

/** The states whose deliveries the mail gate holds (`renewing`): from `draining` to `probing` (A3). */
export const RENEWING_STATES: ReadonlySet<GenerationState> = new Set<GenerationState>(['draining', 'checkpointed', 'clearing', 'carded', 'probing']);

/** Does the renewal hold this delivery? Only while the recipient's generation's `state` column (never `shadowState`: shadow
 *  holds nothing, slug gate-reads-state-only) is renewing, and never the handover ask itself, the operator's mail with
 *  the subject `handover`. A delivery whose mail row could not be read is held: an unread origin is not the ask. */
export function renewalHoldsMail(state: GenerationState | undefined, origin: { readonly fromId: string; readonly subject: string } | null): boolean {
  if (state === undefined || !RENEWING_STATES.has(state)) return false;
  return !(origin !== null && origin.fromId === 'operator' && origin.subject === RENEWAL_HANDOVER_SUBJECT);
}
