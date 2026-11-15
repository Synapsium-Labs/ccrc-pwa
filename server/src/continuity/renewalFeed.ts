// L1, context C3 (Session Conversation): the renewal act's decisions (Overlord spec §3.3.11 H12 and H13; W1a renewal act
// Task 4). Pure: every reading arrives as an argument. The lane (`generationsLane.ts`, L4) reads the rows and the fleet,
// asks these, feeds `generationStep` what they answer and runs the acts (`renewalActs.ts`, L4); it decides nothing itself.
//
// - `renewalPermit`: may a due generation's renewal start this pass? The host must be able to renew (`hibernate-fresh`), a
//   coordinator must still read as one (the role re-read at the permit, review 2149 F12), a hold-off that stands holds hard
//   triggers too (review 2149 F1: a renewal ccd refused goes back, and its hard trigger waits out the hold-off instead of
//   draining again on the next pass), a coordinator waits for the Overlord (`overlordFirst`, hard renewals included), and a
//   soft trigger waits for `softRenewalMay`. A hard trigger ignores the soft budget and the preconditions.
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
import { RENEWAL_LANE_PERIOD_MS, STATE_DEADLINE_S, type GenerationState, type TriggerClass } from '../../../shared/continuity.js';
import type { GenAction, GenEvent } from './generationMachine.js';
import { overlordFirst, type OverlordGenerationReading } from './renewalOrder.js';
import type { SoftAnswer, SoftWait } from './softRenewal.js';
import type { RenewResult } from './sessionHost.js';

/** Why a due generation's renewal does not start this pass. */
export type PermitWait = 'capability-missing' | 'role-changed' | 'overlord-first' | SoftWait;
export type Permit = { readonly feed: true; readonly cls: TriggerClass } | { readonly feed: false; readonly waitFor: PermitWait };

export interface PermitInputs {
  readonly isCoordinator: boolean;
  /** The trigger's class, as the due record stored it. */
  readonly cls: TriggerClass;
  /** `capSupported(…, 'hibernate-fresh')` for the box (Table 11.1d: without it the renewal lane does not run). */
  readonly canRenew: boolean;
  /** The generation is a coordinator's and its role, re-read this pass, no longer reads as one (or could not be read). */
  readonly roleChanged: boolean;
  /** A hold-off stands on the generation's own age (`holdOffStands`): it holds a hard trigger as well as a soft one. */
  readonly holdOff: boolean;
  readonly overlord: OverlordGenerationReading;
  /** `softRenewalMay`'s answer for this generation; read only for a soft trigger. */
  readonly soft: SoftAnswer;
}

/** May the renewal start? The host first, the role, the hold-off, then the Overlord for a coordinator (hard included),
 *  then, for a soft trigger only, the soft answer. */
export function renewalPermit(i: PermitInputs): Permit {
  if (!i.canRenew) return { feed: false, waitFor: 'capability-missing' };
  if (i.roleChanged) return { feed: false, waitFor: 'role-changed' };
  if (i.holdOff) return { feed: false, waitFor: 'hold-off' };
  if (i.isCoordinator && !overlordFirst(i.overlord)) return { feed: false, waitFor: 'overlord-first' };
  if (i.cls === 'soft' && !i.soft.start) return { feed: false, waitFor: i.soft.waitFor };
  return { feed: true, cls: i.cls };
}

/** Does a hold-off stand? Its end and the generation's age on the same observed frame (`softTimesOf`), as
 *  `softRenewalMay` reads them. */
export function holdOffStands(t: { readonly generationAgeObservedMs: number; readonly holdOffUntilObservedMs: number | null }): boolean {
  return t.holdOffUntilObservedMs !== null && t.generationAgeObservedMs < t.holdOffUntilObservedMs;
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
  /** In `clearing`: when the current try's `renew` was claimed, if its answer was never recorded (a crash between the call
   *  and its answer), or null. */
  readonly unansweredClaimAt: number | null;
  /** The row was switched off while this generation's walk is a live one (review 2149 F13). */
  readonly disarmed: boolean;
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
  // A live walk whose row was switched off ends at once, whatever else this pass read (review 2149 F13).
  if (f.disarmed && RENEWING_STATES.has(f.state)) return [{ kind: 'disarmed' }];
  const stamped: Stamped[] = [];
  if (f.due !== null && (f.state === 'active' || (f.state === 'degraded' && f.due.cls === 'hard'))) {
    stamped.push({ at: f.now, event: { kind: 'due', cls: f.due.cls } });
  }
  if (f.state === 'draining' && f.drained) stamped.push({ at: f.now, event: { kind: 'drained' } });
  if (f.state === 'checkpointed' && f.handoverAt !== null) stamped.push({ at: f.handoverAt, event: { kind: 'handover' } });
  // No nudge at or after the deadline: the card is not asked of a generation that degrades on this pass (review 2149 F15).
  if (f.state === 'carded' && !f.renudged && f.deadlineAt !== null && f.now >= nudgeAtOf(f.deadlineAt) && f.now < f.deadlineAt) {
    stamped.push({ at: nudgeAtOf(f.deadlineAt), event: { kind: 'nudge-due' } });
  }
  // A try claimed and never answered is an unknown half, which counts as after the first half (the port's contract; review
  // 2149 F6): fed at the deadline, stamped when it was claimed, so the deadline then degrades rather than going back.
  if (f.state === 'clearing' && f.unansweredClaimAt !== null && f.deadlineAt !== null && f.now >= f.deadlineAt) {
    stamped.push({ at: f.unansweredClaimAt, event: { kind: 'host-failed', afterEnd: true } });
  }
  const events = stamped.filter((s) => beforeDeadline(s.at, f.deadlineAt)).sort((a, b) => a.at - b.at).map((s) => s.event);
  if (f.deadlineAt !== null && f.now >= f.deadlineAt) events.push({ kind: 'deadline' });
  return events;
}

/** `renew`'s answer as the machine's event (the port's failure contract): `started` is the receipt's first half; an
 *  answer that touched nothing fails before it; `wake-failed` gives up at once, since ccd put the old conversation back to
 *  sleep and a retry would find no pane (review 2149 F5); every other answer fails after it, or leaves the half unknown,
 *  which a retry treats as after it. */
export function renewAnswerEvent(r: RenewResult): GenEvent {
  switch (r.kind) {
    case 'started': return { kind: 'host-ended' };
    case 'refused': case 'kill-failed': case 'capability-missing': return { kind: 'host-failed', afterEnd: false };
    case 'wake-failed': return { kind: 'host-gave-up' };
    case 'wake-unrestored': case 'unproven': case 'unreachable': return { kind: 'host-failed', afterEnd: true };
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
  | { readonly kind: 'raise-item'; readonly why: string; readonly about?: ItemAbout }
  | { readonly kind: 'set-hold-off' }
  | { readonly kind: 'spot-probe' };

/** What an item says the session is doing now: the `renew` answer the renewal ended on, when it was one that left the
 *  session other than on its current conversation (review 2149 F5), or a stop that did not end it (exit 6, F4). */
export type ItemAbout = 'wake-failed' | 'wake-unrestored' | 'unproven' | 'unreachable' | 'kill-failed';

/** The item's sentence for where the session stands, by `about` (review 2149 F5): true for exits 4, 5, 6 and 7. */
export function itemStandsWords(about: ItemAbout | undefined): string {
  switch (about) {
    case 'wake-failed': return 'ccd could not start the fresh conversation and put the session back to sleep on its old one, so it sleeps until mail or an open screen wakes it.';
    case 'wake-unrestored': return 'ccd could not start the fresh conversation or bring the old one back, so the session may have no conversation running.';
    case 'unproven': return 'ccd could not prove the fresh start and put the old conversation back, so it keeps working on its old conversation.';
    case 'unreachable': return 'ccd\'s answer could not be read, so where the session stands is not known.';
    case 'kill-failed': return 'ccd stopped its unit and wrote its hibernated marker, but could not end the conversation (exit 6), so its pane may run unsupervised.';
    case undefined: return 'It keeps working on its current conversation and its card.';
    default: { const never: never = about; return never; }
  }
}

/** The `renew` answers an item names (`ItemAbout`), or undefined for one that leaves the session where it was. */
export function itemAboutOf(answer: string | null): ItemAbout | undefined {
  return answer === 'wake-failed' || answer === 'wake-unrestored' || answer === 'unproven' || answer === 'unreachable'
    || answer === 'kill-failed' ? answer : undefined;
}

/** The acts a `renew` answer asks for besides its event (review 2149 F4): exit 6 stopped the unit and wrote the marker
 *  without ending the conversation, so the operator is told, whatever the generation steps to. */
export function answerActs(answer: RenewResult): readonly RenewalAct[] {
  return answer.kind === 'kill-failed' ? [{ kind: 'raise-item', why: 'ccd could not end its conversation', about: 'kill-failed' }] : [];
}

/** Why a step into `degraded` degraded, in plain words, from the state it left and the event that moved it. */
export function degradeWhy(from: GenerationState, event: GenEvent): string {
  if (event.kind === 'probes') return 'its second probe round failed';
  if (event.kind === 'host-gave-up') return 'ccd could not wake the fresh conversation';
  if (event.kind === 'disarmed') return 'the continuity row was switched off during the renewal';
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

/** The acts a written step asks for (the header): its machine actions, less those the lane takes no act for. A step into
 *  `degraded` sets the hold-off too, so a hard trigger that still stands waits it out rather than draining again on the
 *  next pass: an unproven generation ccd refused, one whose wake failed, one that never drained (review 2149 F1, slug
 *  hold-off-bounds-a-failed-hard-renewal). `about` is the `renew` answer the step's renewal last had, which the item's
 *  words follow (F5). */
export function actsOfStep(actions: readonly GenAction[], from: GenerationState, event: GenEvent, about?: ItemAbout): readonly RenewalAct[] {
  const out: RenewalAct[] = [];
  for (const a of actions) {
    if (a === 'assemble-checkpoint' || a === 'ask-handover' || a === 'renudge-card' || a === 'set-hold-off') out.push({ kind: a });
    else if (a === 'raise-item') out.push(about === undefined ? { kind: 'raise-item', why: degradeWhy(from, event) } : { kind: 'raise-item', why: degradeWhy(from, event), about });
  }
  if (actions.includes('raise-item') && !actions.includes('set-hold-off')) out.push({ kind: 'set-hold-off' });
  return out;
}

/** The renewal item's title up to its reason, which also finds an open one already raised for the same generation; exit 6's
 *  item (review 2149 F4) has its own, so neither stands in for the other. */
export function renewalItemPrefix(sessionId: string, n: number, about?: ItemAbout): string {
  return `Renewal of ${sessionId} (generation ${n}) ${about === 'kill-failed' ? 'stopped its unit' : 'degraded'}`;
}

/** Where a degraded generation's item stands, as the lane read it: an open one, none on a programme it claims, or no
 *  programme to raise one on (another role, or none claimed or readable). */
export type ItemStanding = 'open' | 'none' | 'no-programme';

/** The acts a live generation's state asks for on every pass, whatever stepped (review 2149 F3): a `degraded` one's item,
 *  while it has a programme and no open item stands, so an item a crash or a throwing raise lost is raised on a later pass.
 *  With no programme there is nothing to raise: the step's own item act logged that once. */
export function standingActs(state: GenerationState, item: ItemStanding): readonly RenewalAct[] {
  return state === 'degraded' && item === 'none' ? [{ kind: 'raise-item', why: 'its renewal did not complete' }] : [];
}

/** The handover ask's subject (the one mail the renewing gate lets through) and its body (notes review 2039 F11). */
export const RENEWAL_HANDOVER_SUBJECT = 'handover';
export const RENEWAL_HANDOVER_BODY = 'Your renewal is starting. Write your handover note now with `ccrc-api note handover`.';
/** The spot round's notice (ask 415): one system mail telling the session to answer its round. */
export const SPOT_PROBE_SUBJECT = 'probe';
export const SPOT_PROBE_BODY = 'A probe round is open for you. Answer it with `ccrc-api probe`.';

/** The states whose deliveries the mail gate holds (`renewing`): from `draining` to `probing` (A3). */
export const RENEWING_STATES: ReadonlySet<GenerationState> = new Set<GenerationState>(['draining', 'checkpointed', 'clearing', 'carded', 'probing']);

/** The states the handover ask is let through in: the ones that ask for the note and wait for it (review 2149 F10), so an
 *  undelivered ask never reaches the fresh conversation. */
const HANDOVER_STATES: ReadonlySet<GenerationState> = new Set<GenerationState>(['draining', 'checkpointed']);

/** Does the renewal hold this delivery? Only while the recipient's generation's `state` column (never `shadowState`: shadow
 *  holds nothing, slug gate-reads-state-only) is renewing, and never the handover ask itself, the operator's mail with
 *  the subject `handover`, while the note is asked for. A delivery whose mail row could not be read is held: an unread
 *  origin is not the ask. */
export function renewalHoldsMail(state: GenerationState | undefined, origin: { readonly fromId: string; readonly subject: string } | null): boolean {
  if (state === undefined || !RENEWING_STATES.has(state)) return false;
  return !(HANDOVER_STATES.has(state) && origin !== null && origin.fromId === 'operator' && origin.subject === RENEWAL_HANDOVER_SUBJECT);
}

/** A handover note belongs to the renewal it was written in (slug handover-belongs-to-its-renewal): the notes door keeps one
 *  note per generation, so a generation that went back to `active` and renews again still holds its first renewal's note.
 *  The walk's `handover` event takes it only when it was written since the generation entered `checkpointed`. */
export function handoverSince(handoverAt: number | null, checkpointedSince: number): number | null {
  return handoverAt !== null && handoverAt >= checkpointedSince ? handoverAt : null;
}

/** The checkpoint an act seals takes the note only when it was written in this renewal: no earlier than `checkpointed`'s
 *  longest stay (its deadline and one lane period) before the act's episode began. A renewal that follows one that went
 *  back waits out a hold-off first, so an earlier renewal's note is always older than that. */
export function handoverInRenewal(handoverAt: number, episode: number): boolean {
  return handoverAt >= episode - (STATE_DEADLINE_S.checkpointed * 1_000 + RENEWAL_LANE_PERIOD_MS);
}
