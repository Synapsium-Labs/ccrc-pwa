// The Overlord gate order (Overlord W1, gates B; spec 2026-11-09 §11.2, §3.1, §3.3.11 H12, §7.4 C27, Table 11.6; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md` Task 4). Ring L1, context C5: pure decisions over facts the
// runner (`overlordGateRun.ts`, L4) gathered. Runtime imports: the ladder's two step deciders, and `roleOf.ts`'s pure
// designation-fact deciders (L1), the one owner of a session's place in the designation (slug
// gate-reads-the-designation-fact); every other import is a type. No `fs`, no Fastify, no clock: every fact arrives as an
// argument, each with its unmeasured arm, and no step reads an unmeasured fact as a pass (slug
// `unmeasured-refuses-at-its-step`).
//
// THE DECIDERS:
//   - `callerStandingOf` (step 1): who the caller is to the designation, the incarnation checked against the binding at
//     every door (slug `incarnation-checked-at-step-one`).
//   - `fenceVerdict` (steps 5 and 7): the live generation row's term against the designation's (no term is presented,
//     slug `fence-term-is-the-generation-rows`), then the generation, the act key and the counter.
//   - `counterVerdict`: the guarded compare-and-set's answer, mapped (slug `act-counter-is-door-process-as`).
//   - `overlordGate`: the order, first refusal wins, composing the ladder's `offStep` (step 4), its `readBy` (step 6) and
//     `rungStep` (step 10). The witness is step 7a, right after the fence (slug `witness-after-the-fence`). W2's operation
//     key lookup is an arm of its own between them, added by the act rows piece (the runner's `@op-key-slot`).
//
// This is the one `server/src` file that spells the Overlord-only gate words (`not-the-overlord`, `stale-designation`,
// `card-unread`), held there by `single-definition/core-vocab.test.ts`. Every word is typed as a `RouteRefusal`, so a word
// `shared/refusal.ts` does not hold is a compile error, never a second spelling.
import { offStep, rungStep } from './overlordLadder.js';
import { designationFactFrom, designationFactOf } from '../roleOf.js';
import type { DoorClass, EffectiveRung } from './overlordLadder.js';
import type { AuthorityState } from './overlordAuthorityCoherence.js';
import type { OverlordDoorRow } from './overlordDoors.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { GenerationState } from '../../../shared/continuity.js';
import type { RouteRefusal } from '../../../shared/refusal.js';
import type { IncarnationRead } from '../continuity/timerLane.js';
import { OVERLORD_PROFILE, type CallerProfileRead } from './otherLanes.js';

/** Step 1's answer: who the caller is to the designation. */
export type CallerStanding =
  | { readonly kind: 'designated' }                    // the live binding, incarnation agreeing
  | { readonly kind: 'designated-pending' }            // a designate attempt's body, incarnation agreeing
  | { readonly kind: 'pending-unrecorded' }            // that body before its incarnation is recorded (question 5)
  | { readonly kind: 'other-incarnation' }             // the bound or recorded pending id, another incarnation (F1)
  | { readonly kind: 'other' }                         // any other session, a rebind's pending body included
  | { readonly kind: 'unmeasured'; readonly word: 'unavailable' | 'registry-unmeasurable'; readonly why: string };

/** The caller's place in the designation row: its binding (with the incarnation recorded for it), a pending `designate`
 *  attempt's body (its incarnation `null` until the create answers), or neither. A rebind's pending body is neither. */
function placeOf(sessionId: string, designation: Exclude<DesignationRead, { kind: 'unmeasured' }>):
  { readonly kind: 'bound' | 'pending'; readonly incarnation: string | null } | null {
  // The session's place is the designation fact's one owner's (`roleOf.ts#designationFactOf`); the row adds its incarnation.
  // The binding is read FIRST, as `identityOf` reads it (review 2803 F1): asked with the pending attempt set aside, so a row
  // whose pending attempt names the bound id leaves that id the binding, its incarnation checked. `designationFactOf` itself
  // reads the pending id first, which its other callers keep (slug gate-reads-the-binding-first).
  const fact = designationFactFrom(designation);
  if (fact === 'unmeasured' || fact.kind === 'none') return null;
  const bound = designationFactOf(sessionId, { ...fact, pending: null, pendingKind: null }) === 'live';
  if (bound && designation.kind === 'designated' && designation.row.bound !== null) {
    return { kind: 'bound', incarnation: designation.row.bound.generation };
  }
  const pending = designation.row?.pending ?? null;
  if (designationFactOf(sessionId, fact) === 'pending' && fact.pendingKind === 'designate' && pending !== null) {
    return { kind: 'pending', incarnation: pending.generation };
  }
  return null;
}

/** Whether step 1 needs the caller's incarnation: only for the bound id or a pending `designate` attempt's id, so a
 *  coordinator at a start door costs no extra registry read. An unmeasured designation needs none (it refuses first). */
export function incarnationNeeded(sessionId: string, designation: DesignationRead): boolean {
  return designation.kind !== 'unmeasured' && placeOf(sessionId, designation) !== null;
}

/** Step 1 (§11.2; questions 4 and 5), first match: an unmeasured designation, which at a `by-profile` door (the timer doors,
 *  Overlord W1) is `other` for a caller whose launch profile is measured and not the Overlord's, or absent, and unmeasured
 *  for the Overlord's profile, an unreadable one or one not read; at a `refuse` door it is unmeasured whatever the profile.
 *  Then, for the bound id or a pending `designate` attempt's id, the incarnation (not asked, not recorded, equal, different
 *  or absent, unreadable); otherwise `other`. */
export function callerStandingOf(
  caller: { readonly sessionId: string; readonly incarnation: IncarnationRead | 'not-asked'; readonly profile?: CallerProfileRead },
  designation: DesignationRead, unmeasuredDesignation: OverlordDoorRow['unmeasuredDesignation'] = 'refuse',
): CallerStanding {
  if (designation.kind === 'unmeasured') {
    const p = caller.profile ?? 'not-read';
    if (unmeasuredDesignation === 'by-profile' && p !== 'not-read' && (p.kind === 'absent' || (p.kind === 'measured' && p.word !== OVERLORD_PROFILE))) {
      return { kind: 'other' };
    }
    return { kind: 'unmeasured', word: 'unavailable', why: `the designation row could not be read: ${designation.why}` };
  }
  const place = placeOf(caller.sessionId, designation);
  if (place === null) return { kind: 'other' };
  if (caller.incarnation === 'not-asked') return { kind: 'unmeasured', word: 'unavailable', why: 'the incarnation was not read' };
  if (place.incarnation === null) return { kind: 'pending-unrecorded' };
  if (caller.incarnation.kind === 'measured') {
    if (caller.incarnation.incarnation !== place.incarnation) return { kind: 'other-incarnation' };
    return place.kind === 'bound' ? { kind: 'designated' } : { kind: 'designated-pending' };
  }
  if (caller.incarnation.reason === 'absent') return { kind: 'other-incarnation' };
  return { kind: 'unmeasured', word: 'registry-unmeasurable', why: `the incarnation could not be read: ${caller.incarnation.reason}` };
}

/** Why a fence refused, as `overlord_fence_refusals.why` records it. */
const FENCE_WHY_MAP = {
  'no-live-generation': true, 'generation-mismatch': true, 'key-unissued': true, 'key-mismatch': true, 'no-key': true, fork: true, ended: true,
} as const;
export type FenceWhy = keyof typeof FENCE_WHY_MAP;

/** What the server holds for a write: the identity's live generation and its act key (door process A's row), the key
 *  already compared by digest in the runner. `unmeasured`: the rows or the act key could not be read (ruled, F12). */
export type FenceFacts =
  | { readonly kind: 'read';
      readonly live: { readonly id: number; readonly n: number; readonly term: number | null;
                       readonly key: 'match' | 'mismatch' | 'unissued'; readonly counter: number } | null }
  | { readonly kind: 'unmeasured'; readonly why: string };
/** What the call presents: the generation and the counter (door process A's headers), and whether a key came at all. No
 *  term is presented (ruled, F2), and the key itself never reaches a decider. */
export interface FencePresented { readonly generation: number | null; readonly counter: number | null; readonly key: boolean }
export type FenceVerdict =
  | { readonly kind: 'pass' }
  | { readonly kind: 'refuse'; readonly word: 'stale-designation' | 'stale-generation' | 'unavailable';
      readonly detail: string; readonly why: FenceWhy | null };

const fenceRefuse = (word: 'stale-designation' | 'stale-generation' | 'unavailable', detail: string, why: FenceWhy | null = null): FenceVerdict =>
  ({ kind: 'refuse', word, detail, why });

/** Step 5 (`term`) and step 7 (`generation`), as two ordered halves; the gate calls each at its step. A missing side refuses,
 *  the detail naming which. */
export function fenceVerdict(step: 'term' | 'generation', presented: FencePresented, designationTerm: number | null,
  facts: FenceFacts): FenceVerdict {
  if (facts.kind === 'unmeasured') return fenceRefuse('unavailable', `the generations or the act key could not be read: ${facts.why}`);
  const live = facts.live;
  if (step === 'term') {
    if (live === null) return fenceRefuse('stale-designation', 'no live generation for this identity');
    if (designationTerm === null) return fenceRefuse('stale-designation', 'the designation read has no term');
    if (live.term === null) return fenceRefuse('stale-designation', "the live generation row's term does not read");
    if (live.term !== designationTerm) return fenceRefuse('stale-designation', `the live generation's term ${live.term} is not the designation's ${designationTerm}`);
    return { kind: 'pass' };
  }
  if (live === null) return fenceRefuse('stale-generation', 'no live generation for this identity', 'no-live-generation');
  if (!presented.key) return fenceRefuse('stale-generation', 'no act key presented', 'no-key');
  if (presented.generation !== live.n) return fenceRefuse('stale-generation', 'the presented generation is not the live one', 'generation-mismatch');
  if (live.key === 'unissued') return fenceRefuse('stale-generation', 'no act key was issued for the live generation', 'key-unissued');
  if (live.key === 'mismatch') return fenceRefuse('stale-generation', "the act key is not the live generation's", 'key-mismatch');
  if (presented.counter === null || presented.counter <= live.counter) return fenceRefuse('stale-generation', 'the act counter is not above the last one: a fork', 'fork');
  return { kind: 'pass' };
}

/** The guarded compare-and-set's answer, mapped (ruled, F4): `not-above` is a fork that arrived late, `ended` a generation
 *  a renewal ended between the read and the write, `unmeasured` a statement that threw. */
export function counterVerdict(answer: 'advanced' | 'not-above' | 'ended' | 'unmeasured'): FenceVerdict {
  if (answer === 'advanced') return { kind: 'pass' };
  if (answer === 'not-above') return fenceRefuse('stale-generation', 'the act counter is not above the last one: a fork', 'fork');
  if (answer === 'ended') return fenceRefuse('stale-generation', 'the generation ended', 'ended');
  return fenceRefuse('unavailable', 'the act counter could not be advanced');
}

/** Why a witness did not stand (door process B's reasons). */
const WITNESS_WHY_MAP = { none: true, stale: true, used: true, 'reader-scope': true, 'before-generation': true } as const;
/** Door process B's witness verdict (ruled, F5). Declared here until door process B lands, which then imports it from here.
 *  `witnessed` carries the witness row; a missing witness key reads `none`; an unreadable witness store is `unmeasured`. */
export type WitnessVerdict =
  | { readonly kind: 'witnessed'; readonly witnessId: number }
  | { readonly kind: 'unwitnessed'; readonly why: keyof typeof WITNESS_WHY_MAP }
  | { readonly kind: 'unmeasured'; readonly why: string };

/** What the runner records for the witness (question 10, door process B's `recordWitnessCheck`): `used` with its witness when
 *  a write passed with a witness, `unwitnessed` with its reason when step 7a refused, nothing otherwise (an unmeasured
 *  witness is never recorded). */
export type WitnessRecord = { readonly outcome: 'used' | 'unwitnessed'; readonly witnessId: number | null; readonly why: string | null };
export function witnessRecordOf(verdict: GateVerdict, witness: WitnessVerdict | 'read-door'): WitnessRecord | null {
  if (witness === 'read-door') return null;
  if (verdict.kind === 'pass' && witness.kind === 'witnessed') return { outcome: 'used', witnessId: witness.witnessId, why: null };
  if (verdict.kind === 'refuse' && verdict.record === 'witness-unwitnessed' && witness.kind === 'unwitnessed') {
    return { outcome: 'unwitnessed', witnessId: null, why: witness.why };
  }
  return null;
}

/** Every fact the order reads, each with its unmeasured arm (question 9). */
export interface GateFacts {
  readonly door: OverlordDoorRow;
  readonly standing: CallerStanding;
  /** `SERVER_CAPS`, or the unmeasured arm when it could not be read (step 2 refuses `unavailable`). */
  readonly serverWords: readonly string[] | { readonly kind: 'unmeasured'; readonly why: string };
  /** The authority guard's state; `start-door` for a start door, which skips step 3 and never reads it. */
  readonly authority: AuthorityState | 'start-door';
  /** The ladder's composed read; `start-door` for a start door, whose steps 4, 6 and 10 are skipped and never read. */
  readonly ladder: { readonly kind: 'read'; readonly rung: EffectiveRung } | { readonly kind: 'unmeasured'; readonly why: string } | 'start-door';
  /** `designationRead()`'s term, when standing is designated or designated-pending; null when it has none. */
  readonly term: number | null;
  readonly fence: { readonly presented: FencePresented; readonly facts: FenceFacts } | 'read-door';
  readonly witness: WitnessVerdict | 'read-door';
  readonly card: 'read-current' | 'read-stale' | 'none' | { readonly kind: 'unmeasured'; readonly why: string };
  readonly generation: { readonly kind: 'state'; readonly state: GenerationState } | { readonly kind: 'none' }
    | { readonly kind: 'unmeasured'; readonly why: string };
}

/** The words the order answers, every one a `RouteRefusal` (so `shared/refusal.ts` holds each). */
export type GateWord = Extract<RouteRefusal,
  | 'not-the-overlord' | 'unavailable' | 'registry-unmeasurable' | 'renewing' | 'capability-missing' | 'authority-rolled-back'
  | 'overlord-off' | 'stale-designation' | 'launch-profile-unmet' | 'stale-generation' | 'unwitnessed' | 'unmeasured'
  | 'card-unread' | 'rung-below'>;
export type GateStep = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '7a' | '8' | '9' | '10';
export type GateRecord = 'fence-refusal' | 'witness-unwitnessed' | null;
export type GateVerdict =
  | { readonly kind: 'pass' }
  | { readonly kind: 'hook' }   // a start door, and the caller is another session: served as before
  | { readonly kind: 'refuse'; readonly word: GateWord; readonly detail: string; readonly step: GateStep;
      readonly record: GateRecord; readonly why: FenceWhy | null };

/** The gate's own words that are not refusal words, each map checked against the union it spells, so the coordination kebab
 *  census (`mail-routes.test.ts`) admits them through `isOverlordGateKebab`, never by an allowlist pin. */
const STANDING_KIND_MAP = {
  designated: true, 'designated-pending': true, 'pending-unrecorded': true, 'other-incarnation': true, other: true, unmeasured: true,
} as const satisfies Record<CallerStanding['kind'], true>;
const GATE_RECORD_MAP = { 'fence-refusal': true, 'witness-unwitnessed': true } as const satisfies Record<NonNullable<GateRecord>, true>;
const COUNTER_ANSWER_MAP = {
  advanced: true, 'not-above': true, ended: true, unmeasured: true,
} as const satisfies Record<Parameters<typeof counterVerdict>[0], true>;
const FACT_ARM_MAP = {
  'not-asked': true, 'read-door': true, 'start-door': true, 'read-current': true, 'read-stale': true,
} as const satisfies Record<'not-asked' | Extract<GateFacts['fence'] | GateFacts['ladder'], string>
  | Exclude<Extract<GateFacts['card'], string>, 'none'>, true>;
/** A door row's `unmeasuredDesignation` column (the timer doors, Overlord W1). */
const UNMEASURED_DESIGNATION_MAP = { refuse: true, 'by-profile': true } as const satisfies Record<OverlordDoorRow['unmeasuredDesignation'], true>;
export const isOverlordGateKebab = (word: string): boolean =>
  [STANDING_KIND_MAP, FENCE_WHY_MAP, WITNESS_WHY_MAP, GATE_RECORD_MAP, COUNTER_ANSWER_MAP, FACT_ARM_MAP, UNMEASURED_DESIGNATION_MAP]
    .some((m) => Object.prototype.hasOwnProperty.call(m, word));

const refuse = (word: GateWord, step: GateStep, detail: string, record: GateRecord = null, why: FenceWhy | null = null): GateVerdict =>
  ({ kind: 'refuse', word, detail, step, record, why });

/** The card fact (step 8's, and the timer line's hold, Overlord W1): the live generation's card read, mapped once. No live
 *  generation is `none`; a read that failed is unmeasured with its detail. */
export function cardFactFrom(read: { readonly ok: true; readonly read: { readonly current: boolean } | null } | { readonly ok: false; readonly detail: string }):
  GateFacts['card'] {
  return !read.ok ? { kind: 'unmeasured', why: read.detail } : read.read === null ? 'none' : read.read.current ? 'read-current' : 'read-stale';
}

/** The generation states in which a renewal is under way (step 9): the generation is not serving. */
const RENEWING_STATES: Readonly<Record<GenerationState, boolean>> = {
  active: false, degraded: false,
  draining: true, checkpointed: true, clearing: true, carded: true, probing: true, ended: true,
};
const START: DoorClass = 'card-probe-note';

/** Which facts a door's order reads past step 1: a start door reads no ladder, card or generation state; a read door no
 *  fence or witness. The runner reads exactly these, so an unreadable ladder never stops a generation from starting. */
export function gateReads(door: OverlordDoorRow):
  { readonly ladder: boolean; readonly authority: boolean; readonly card: boolean; readonly fence: boolean } {
  const start = door.ladderClass === START;
  return { ladder: !start, authority: !start, card: !start, fence: door.write };
}

/** A passing write's witness spend, after the counter advanced (review 2803 F2): the spend that could not be recorded refuses
 *  the write, so one hook report never backs two writes. The counter goes first, so a counter that could not advance leaves
 *  the witness unspent for a retry. */
export function spendVerdict(spent: boolean): GateVerdict {
  return spent ? { kind: 'pass' } : refuse('unavailable', '7a', 'the witness could not be marked used');
}

/** Step 1 alone: the verdict when who calls decides it (another session, another incarnation, an unmeasured standing, a body
 *  not recorded yet), or `null` to go on. The runner asks it before reading any other fact. */
export function standingVerdict(door: OverlordDoorRow, s: CallerStanding): GateVerdict | null {
  if (s.kind === 'other') return door.others === 'hook' ? { kind: 'hook' } : refuse('not-the-overlord', '1', 'the caller is not the designated session');
  if (s.kind === 'other-incarnation') return refuse('not-the-overlord', '1', "the caller's incarnation is not the designation's");
  if (s.kind === 'unmeasured') return refuse(s.word, '1', s.why);
  if (s.kind === 'pending-unrecorded') return refuse('renewing', '1', "the designated body's incarnation is not recorded yet");
  return null;
}

/** §11.2's order, first refusal wins (plan Task 4). A start door (`card-probe-note`) skips steps 3, 4, 6, 8, 9 and 10; a
 *  read door skips 5, 7 and 7a. Then `pass`: the counter and the door's own checks (step 11) follow in the runner. */
export function overlordGate(f: GateFacts): GateVerdict {
  const door = f.door;
  // Step 1: who calls.
  const s = f.standing;
  const first = standingVerdict(door, s);
  if (first !== null) return first;
  // Step 2: the door's capability word.
  const words = f.serverWords;
  if (!Array.isArray(words)) return refuse('unavailable', '2', `the server's words could not be read: ${(words as { why: string }).why}`);
  if (!words.includes(door.word)) return refuse('capability-missing', '2', `this server does not hold ${door.word}`);
  const start = door.ladderClass === START;
  // Step 3: the authority guard.
  const authority = f.authority;
  if (!start && authority === 'start-door') return refuse('authority-rolled-back', '3', 'the authority guard was not read');
  if (!start && authority !== 'start-door' && authority.kind !== 'coherent') {
    return refuse('authority-rolled-back', '3', authority.kind === 'rolled-back' ? `the authority journal rolled back: ${authority.cause}`
      : `the authority journal reads unmeasured: ${authority.why}`);
  }
  // Step 4: the operator's rung (offStep).
  const ladder = f.ladder;
  if (!start) {
    if (ladder === 'start-door' || ladder.kind === 'unmeasured') return refuse('unavailable', '4', `the ladder could not be read${ladder === 'start-door' ? '' : `: ${ladder.why}`}`);
    const off = offStep(ladder.rung.operatorRung, door.ladderClass);
    if (!off.pass) return refuse(off.word, '4', "the operator's rung is off");
  }
  // Step 5: the term, at a write.
  const fence = f.fence;
  if (door.write) {
    if (fence === 'read-door') return refuse('unavailable', '5', 'the fence facts were not read');
    const term = fenceVerdict('term', fence.presented, f.term, fence.facts);
    if (term.kind === 'refuse') return refuse(term.word, '5', term.detail);
  }
  // Step 6: the ladder's readers (the launch profile).
  if (!start && ladder !== 'start-door' && ladder.kind === 'read') {
    const unmet = ladder.rung.readBy.find((e) => e.reader === 'launch-profile-unmet');
    if (unmet !== undefined) return refuse('launch-profile-unmet', '6', `${unmet.cause} reads ${unmet.reading}`);
  }
  if (door.write && fence !== 'read-door') {
    // Step 7: the generation, the key and the counter.
    const gen = fenceVerdict('generation', fence.presented, f.term, fence.facts);
    if (gen.kind === 'refuse') return refuse(gen.word, '7', gen.detail, gen.word === 'stale-generation' ? 'fence-refusal' : null, gen.why);
    // Step 7a: the witness (ruled, F5).
    const w = f.witness;
    if (w === 'read-door') return refuse('unmeasured', '7a', 'the witness was not read');
    if (w.kind === 'unwitnessed') return refuse('unwitnessed', '7a', `no matching hook report: ${w.why}`, 'witness-unwitnessed');
    if (w.kind === 'unmeasured') return refuse('unmeasured', '7a', `the witness could not be read: ${w.why}`);
  }
  // Step 9's one arm at a start door (the coordinator's ruling on the card door): a recorded read (a write whose act is
  // `read`, the card's recording page) by a pending body while its term is renewing writes nothing; the new term reads afresh.
  if (start && door.write && door.act === 'read' && s.kind === 'designated-pending') return refuse('renewing', '9', 'the designation is pending: the card is read afresh under the new term');
  if (!start) {
    // Step 8: the card read.
    const card = f.card;
    if (typeof card === 'object') return refuse('unavailable', '8', `the card read could not be read: ${card.why}`);
    if (card !== 'read-current') return refuse('card-unread', '8', card === 'none' ? 'this generation has not read its card' : 'this generation read an older card');
    // Step 9: the generation starting, or the designation pending.
    if (s.kind === 'designated-pending') return refuse('renewing', '9', 'the designation is pending');
    const g = f.generation;
    if (g.kind === 'unmeasured') return refuse('unavailable', '9', `the generations could not be read: ${g.why}`);
    if (g.kind === 'none') return refuse('renewing', '9', 'no live generation');
    if (RENEWING_STATES[g.state]) return refuse('renewing', '9', `the generation is ${g.state}`);
    // Step 10: the rung by act kind (rungStep). A door that names no act kind skips it, and only it (the timer doors, §11.2).
    if (door.act !== null && ladder !== 'start-door' && ladder.kind === 'read') {
      const rung = rungStep(ladder.rung.rung, door.ladderClass, door.act);
      if (!rung.pass) return refuse(rung.word, '10', `the act needs the rung ${rung.needs}`);
    }
  }
  return { kind: 'pass' };
}
