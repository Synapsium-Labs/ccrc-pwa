// L1, context C3 (Session Conversation): the Overlord's renewal readings (Overlord spec §3.3.11, H13, Table 3.3.11b; W1,
// plan `w1-renewal-readings.md`). Pure mappers, one per reading, from a producer's answer to a `Reading<T>`, and the
// deciders this piece owns. Every time arrives as a number, and every producer's answer as an argument.
//
// MONOTONIC (the plan's Global Constraints): a reading is measured only from a measured answer, and every unmeasured arm
// stays unmeasured with its reason, so `renewalDue` names it in `blind` and it never makes a renewal due. A reading whose
// producer has not merged is not answered here at all, and keeps the lane's `W1` default (`renewalInputsOf`).
//
// PR A: `fittedCeilingOf` (the soft ceiling, from the probes' `fittedCeiling`) and the daily backstop
// (`backstopInstantBefore`, `backstopDueOf`). PR C: the designation's two readings (`termRaisedOf`, `classChangedOf`), the
// class a generation is minted under (`designatedClassAtMint`) and the `probes-failed-twice` latch's decider
// (`probesFailedTwiceOf`). PR B: `notLocalOf`, from the transcript resolver's answer on the host that runs the session, and
// `notLocalAskOf`, what that reading asks the resolver about. PR D: the account readings, `accountOutsideSetOf`,
// `classUnservableOf`, `accountLoadOf` with `accountLoadMoveOf`, over the candidates `overlordCandidatesOf` builds once a pass, or
// those `unboundCandidates` answers from the designation alone. PR H: the launch profile's two deciders, `holdOfStart` (whether a
// start holds its account out of the Overlord's ordered list) and `overlordInstallBehindOf` (the digest reading folded into the
// Overlord's `installBehind`), with its two mappers, `startDigestDiffersOf` and `buildsAgreeOf`. The holds reach the list through
// L0's `heldOutOfList` (designation A's `overlordAccounts`) and `accountOutsideSetOf` through `Holds`.
//
// IMPORTS ACROSS CONTEXTS (PR D, plan Task 7): L1 into L1 only, each a producer's own decider, never re-derived. C1's
// `server/src/poolrule.ts` (the pool answer's parsed type) and `server/src/accountLoad.ts` (serviceability B: the candidates, the
// load move and the twin's `classUnservable`), and C5's `server/src/coord/overlordDesignation.ts` (designation A's ordered list,
// `overlordAccounts`), with L0's `serviceability`.
import type { GenerationState, StartRow } from '../../../shared/continuity.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { AccountHoldsRead, BackstopRead } from '../../../shared/renewal-readings.js';
import type { BuildAgreement } from '../../../shared/api.js';
import type { SandboxVerdict } from './sandboxCheck.js';
import type { TurnMarkRead } from '../coord/stall.js';
import type { GenEvent } from './generationMachine.js';
import { fittedCeiling, type SpotProbe } from './probes.js';
import { modelDriftOf, readersRunning, type Read, type ReaderEventIn, type SidecarClass } from './hookReports.js';
import { familyClassOf } from '../../../shared/models.js';
import type { ModelSwitchHow } from '../../../shared/continuity-reports.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import { hardCapTokens, measuredCount, type Reading, type RenewalInputs } from './renewalDue.js';
import { serviceability, type LaneFacts } from '../../../shared/serviceability.js';
import type { PoolAnswerRead } from '../poolrule.js';
import { accountLoadMoveReading, classUnservableReading, overlordLoadCandidates, type Candidates } from '../accountLoad.js';
import { overlordAccounts, type AccountFacts } from '../coord/overlordDesignation.js';

/** The `RenewalInputs` fields the lane reads `W1` until their producers are wired (`renewalInputsOf`'s defaults). The
 *  wiring answers only the fields whose producer is wired, and the lane spreads them over the defaults. */
export type W1Inputs = Pick<RenewalInputs, 'fittedCeilingTokens' | 'turns' | 'backstopDue' | 'modelDrift' | 'termRaised'
  | 'accountOutsideSet' | 'classUnservable' | 'accountLoadMove' | 'classChanged' | 'notLocal'
  // PR H: the Overlord's `installBehind`, which the lane reads from the gather's `behind` for every other role.
  | 'installBehind'>;

/** The graded closed-book spot probes of one model class (`continuityStore.ts#closedSpotProbes`), or why they are unread. */
export type SpotsRead = { readonly ok: true; readonly spots: readonly SpotProbe[] } | { readonly ok: false; readonly detail: string };

const unmeasured = (why: string): Reading<never> => ({ kind: 'unmeasured', why });

/** The Overlord's fitted ceiling (C41, §3.3.5): the probes' own answer (`fittedCeiling`) over the class's closed-book spot
 *  probes, capped by the hard cap of the window. Fitted or not, a `ceiling` answer is measured: the hard cap until the probes
 *  fit one (slug fitted-ceiling-is-the-producers-answer). `no-depth-holds` reads unmeasured (question 3, slug
 *  no-depth-holds-reads-unmeasured): a 0-token ceiling would renew on every pass up to the soft budget, and a fresh generation
 *  of the same class holds no better. A class that is unknown, a window that is unmeasured or not a positive size, and spots
 *  that could not be read each read unmeasured with the reason. */
export function fittedCeilingOf(modelClass: string | null, window: Reading<number>, spots: SpotsRead): Reading<number> {
  if (modelClass === null) return unmeasured('model unknown');
  if (window.kind === 'unmeasured') return window;
  const w = measuredCount(window);
  if (w === null || w <= 0) return unmeasured('window not a positive size');
  if (!spots.ok) return unmeasured(`probes unread: ${spots.detail}`);
  const c = fittedCeiling(spots.spots, modelClass, hardCapTokens(w));
  return c.kind === 'ceiling' ? { kind: 'measured', value: c.tokens } : unmeasured('no depth holds');
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The wall clock of `zone` as a function of an instant: the zone's local date and time at `t`, read as if it were UTC
 *  (milliseconds kept), or null for a zone `Intl` cannot read. One formatter per call of the caller. */
function wallClockOf(zone: string): ((t: number) => number) | null {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  } catch {
    return null;
  }
  return (t) => {
    const p: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
    for (const x of f.formatToParts(t)) if (x.type !== 'literal') p[x.type] = Number(x.value);
    return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0) + (((t % 1000) + 1000) % 1000);
  };
}

/** The instant at which the wall clock (`wall`) first reads the local time `local`: in a fold, the first of the two; in a
 *  gap (the local time does not exist), the first instant after the gap. Null when it cannot be bracketed. */
function instantOfLocal(wall: (t: number) => number, local: number): number | null {
  const offsets = [local - DAY_MS, local, local + DAY_MS].map((t) => wall(t) - t);
  const exact = offsets.map((o) => local - o).filter((t) => wall(t) === local);
  if (exact.length > 0) return Math.min(...exact);
  // The gap: the wall clock jumps over `local`. Search the first instant whose wall clock reads at or after it, between
  // the instant the larger offset names (before the jump) and the one the smaller names (after it).
  let lo = local - Math.max(...offsets);
  let hi = local - Math.min(...offsets);
  if (wall(lo) >= local || wall(hi) < local) return null;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wall(mid) >= local) hi = mid; else lo = mid;
  }
  return hi;
}

/** The latest instant at or before `nowMs` at which the wall clock in `zone` reads `hour`:00, or null for a zone Intl
 *  cannot read. In a daylight-saving gap the hour does not exist that day, and the instant is the first one after the
 *  gap. In a fold the hour happens twice, and the instant is the first. Never after `nowMs`. */
export function backstopInstantBefore(nowMs: number, hour: number, zone: string): number | null {
  const wall = wallClockOf(zone);
  if (wall === null) return null;
  const today = Math.floor(wall(nowMs) / DAY_MS);
  for (let day = today; day >= today - 2; day--) {
    const at = instantOfLocal(wall, day * DAY_MS + hour * HOUR_MS);
    if (at !== null && at <= nowMs) return at;
  }
  return null;
}

/** The daily backstop row's reading (R19, Table 3.3.11b "daily backstop"): due when the generation started before the
 *  latest backstop instant, so it has lived through one. The setting unread, or a zone `Intl` cannot read, is unmeasured.
 *  One renewal clears it: the next generation starts after the instant. */
export function backstopDueOf(b: BackstopRead, startReportedAt: number, nowMs: number): Reading<boolean> {
  if (!b.ok) return unmeasured(`backstop unread: ${b.detail}`);
  const instant = backstopInstantBefore(nowMs, b.backstop.hour, b.backstop.zone);
  if (instant === null) return unmeasured('zone unreadable');
  return { kind: 'measured', value: startReportedAt < instant };
}

/** The generation the designation's two readings judge: its session, the term it was minted (or re-stamped) under, and the
 *  designated class it was minted under (`designatedClassAtMint`; null when not recorded). */
export interface DesignatedGeneration { readonly sessionId: string; readonly term: number; readonly designatedClass: string | null }

/** The designation's answer for one generation: unmeasured, not this session's (no designation, or one bound to another
 *  session, which a rebind ends), or this session's live binding. */
function boundTo(d: DesignationRead, sessionId: string):
  { readonly kind: 'unmeasured'; readonly why: string } | false | Extract<DesignationRead, { kind: 'designated' }> {
  if (d.kind === 'unmeasured') return { kind: 'unmeasured', why: 'designation unreadable' };
  return d.kind === 'designated' && d.sessionId === sessionId ? d : false;
}

/** Table 3.3.11b "The term was raised" (hard; Overlord): the designation's term is above the one this generation was minted
 *  under (a Confirm of the restore raises it). Not this session's designation: measured false (the row does not apply). */
export function termRaisedOf(d: DesignationRead, g: Pick<DesignatedGeneration, 'sessionId' | 'term'>): Reading<boolean> {
  const b = boundTo(d, g.sessionId);
  if (b === false) return { kind: 'measured', value: false };
  if (b.kind === 'unmeasured') return b;
  return { kind: 'measured', value: b.term > g.term };
}

/** Table 3.3.11b "The operator changed the designated class in Settings" (soft; Overlord): the designation's class differs from
 *  the one this generation was minted under, never from the class it runs, which a fallback generation records (slug
 *  designated-class-stamped-at-mint). A generation minted before the class was recorded reads unmeasured for its life
 *  (review 2183 F13): blind, never a default, and the next generation is stamped. */
export function classChangedOf(d: DesignationRead, g: Pick<DesignatedGeneration, 'sessionId' | 'designatedClass'>): Reading<boolean> {
  const b = boundTo(d, g.sessionId);
  if (b === false) return { kind: 'measured', value: false };
  if (b.kind === 'unmeasured') return b;
  if (g.designatedClass === null) return unmeasured('minted before the class was recorded');
  return { kind: 'measured', value: b.row.model !== g.designatedClass };
}

/** The class a mint stamps (`MintInput.designatedClass`): the designation row's model when the generation is minted as the
 *  Overlord (`identityOf` answers `overlord`: the live binding, or a pending `designate`), else null. An unmeasured designation
 *  stamps null, and that generation's `classChanged` stays unmeasured (review 2183 F13). */
export function designatedClassAtMint(d: DesignationRead, identity: string): string | null {
  if (identity !== 'overlord' || d.kind === 'unmeasured' || d.row === null) return null;
  return d.row.model;
}

// PR E (Task 8): the door process's two readings, `modelDrift` (hard) and the soft `readersRunning`, the Overlord's only. The
// deciders are door process B1's (`hookReports.ts#modelDriftOf`, `#readersRunning`), passed through unchanged: these mappers
// only shape their inputs and map their `Read<T>` to a `Reading<T>`, keeping every unmeasured reason.

/** The status line sidecar's read as the gather takes it (`usage.ts#UsageRead`), declared by this consumer. */
export type SidecarRead =
  | { readonly kind: 'reading'; readonly usage: { readonly class: string | null; readonly ts: number; readonly stale: boolean } }
  | { readonly kind: ReadFailure | 'malformed' };
/** One reported model switch as the hook report store reads it (`ModelSwitchRow`), narrowed to what drift reads. */
export interface SwitchRowIn { readonly how: ModelSwitchHow; readonly to: string | null }

/** The sidecar as `modelDriftOf` takes it (review 2183 F15: the freshness decision is L1's, not the wiring's), and why it is no
 *  evidence when it is not fresh. Only a sidecar written after the generation's start is this generation's: one written before
 *  it (the sidecar's `ts`, seconds, and the start's report, both on the fleet node's clock) is read as stale, so a renewal that
 *  changes the class is never judged drifted by the reading its predecessor left (slug drift-sidecar-must-postdate-the-start).
 *  An absent, unreadable or malformed sidecar is absent to the decider, and keeps its own word in `why`. */
export function modelDriftInputOf(usage: SidecarRead, startReportedAt: number): { readonly sidecar: SidecarClass; readonly why: string | null } {
  if (usage.kind !== 'reading') return { sidecar: { kind: 'absent' }, why: `usage ${usage.kind}` };
  if (usage.usage.stale) return { sidecar: { kind: 'stale' }, why: 'usage stale' };
  if (usage.usage.ts * 1000 <= startReportedAt) return { sidecar: { kind: 'stale' }, why: 'usage from before the start' };
  return { sidecar: { kind: 'fresh', class: usage.usage.class }, why: null };
}

/** Table 3.3.11b "The model drifted" (hard; Overlord): `modelDriftOf` over the start's class, the switches reported since the
 *  start (by the server's clock, `modelSwitchesSinceStart`) and the sidecar (`modelDriftInputOf`). Its measured answer passes
 *  through; its unmeasured answer keeps its detail, with the sidecar's own word beside it when the sidecar was no evidence. */
export function modelDriftReadingOf(i: {
  readonly startModel: string | null; readonly startReportedAt: number; readonly switches: Read<readonly SwitchRowIn[]>; readonly usage: SidecarRead;
}): Reading<boolean> {
  const switches = i.switches.ok
    ? { ok: true as const, value: i.switches.value.map((s) => ({ how: s.how, toClass: s.to === null ? null : familyClassOf(s.to) })) }
    : i.switches;
  const side = modelDriftInputOf(i.usage, i.startReportedAt);
  const a = modelDriftOf({ startClass: i.startModel === null ? null : familyClassOf(i.startModel), switches, sidecarClass: side.sidecar });
  if (a.ok) return { kind: 'measured', value: a.value };
  return unmeasured(side.why === null ? a.detail : `${a.detail} (${side.why})`);
}

/** The soft `readersRunning` (R19's break: no reader running): `readersRunning` over the reader events since the generation's
 *  start, which `since` names on the server's clock (the start row's receipt, the events' `receivedAt`'s). A failed read is
 *  unmeasured with its detail, never zero. */
export function readersRunningReadingOf(read: Read<{ readonly since: number; readonly events: readonly ReaderEventIn[] }>, nowMs: number): Reading<number> {
  if (!read.ok) return unmeasured(read.detail);
  const a = readersRunning({ events: { ok: true, value: read.value.events }, generationStartedAt: read.value.since, now: nowMs });
  return a.ok ? { kind: 'measured', value: a.value } : unmeasured(a.detail);
}

/** Table 7.5a "Probes failed twice after a renewal" (latch, cap `chat`): a live Overlord step from `probing` to `degraded` on
 *  a second failed round. `view` is the row BEFORE the step: `degrade` resets `probeRounds` to 0, so the row after it would
 *  never latch (review 2183 F8). A shadow walk (`shadowState`), a coordinator, a first failed round, a passed round and a
 *  `deadline` in `probing` never latch (slug latch-raised-on-a-live-step-only). */
export function probesFailedTwiceOf(i: {
  readonly role: FleetRole; readonly from: GenerationState; readonly event: GenEvent; readonly view: { readonly probeRounds: number };
  readonly next: GenerationState; readonly column: 'state' | 'shadowState';
}): boolean {
  return i.role === 'overlord' && i.column === 'state' && i.from === 'probing' && i.event.kind === 'probes' && !i.event.passed
    && i.view.probeRounds >= 1 && i.next === 'degraded';
}

/** The isolation word's carrier for this reading (`IsolationReader.wakingHostKey`), declared by the consumer: compared in
 *  memory, within one call of `notLocalOf`, and never stored, served or logged (isolation question 16). */
export type Carrier = { readonly digest: string; readonly keyEpoch: number } | 'unmeasured';
/** The part of the transcript resolver's answer (`TranscriptResolution`) this reading reads, declared by the consumer: the
 *  resolver's answer satisfies it structurally, and this module imports nothing from `server/src/transcript/resolve.ts`. */
export type TranscriptAnswer = { readonly kind: 'found' } | { readonly kind: 'fallback'; readonly complete: boolean };
/** The measured search of every place the resolver's own-account search looks (`resolve.ts#uuidGlobPlaces`), declared by the
 *  consumer (review 3718 F3): the listing of the account's projects root, then one answer per place it named, each from a read
 *  that tells a proven absence from an unreadable one. `present` is a file at that place. */
export type AbsenceProbe = { readonly listing: 'listed' | ReadFailure; readonly places: readonly ('present' | ReadFailure)[] };
/** The resolver's answer, or why it was not asked (`notLocalAskOf`'s reasons, or no config dir). `measured`: the measured search,
 *  taken in this pass when the resolver answered a complete absence, else null; `observedAt`: the wall clock when the last answer
 *  was in hand (fix round 1, F1; fix round 2, F3). */
export type TranscriptAsk =
  | { readonly kind: 'asked'; readonly answer: TranscriptAnswer; readonly measured: AbsenceProbe | null; readonly observedAt: number }
  | { readonly kind: 'unread'; readonly why: string };

/** What to ask the resolver about, or why not to ask (fix round 1, F2): the start's conversation under the generation's own account,
 *  and only when the registry row agrees with both. A registry row on another account (a swap between its flip and the swap's new
 *  start) or on another conversation (a successor the generation does not hold) would ask the wrong question, so the reading is
 *  unmeasured with its own reason, never true or false. */
export type NotLocalAsk = { readonly kind: 'ask'; readonly account: string; readonly uuid: string } | { readonly kind: 'unread'; readonly why: string };
export function notLocalAskOf(i: {
  readonly startUuid: string; readonly who: { readonly uuid: string; readonly account: string } | 'no-row' | 'unmeasured'; readonly lane: string | null;
}): NotLocalAsk {
  if (i.who === 'no-row') return { kind: 'unread', why: 'no registry row' };
  if (i.who === 'unmeasured') return { kind: 'unread', why: 'identity unmeasured' };
  if (i.lane === null) return { kind: 'unread', why: 'generation account unknown' };
  if (i.who.account !== i.lane) return { kind: 'unread', why: "registry account differs from the generation's" };
  if (i.who.uuid !== i.startUuid) return { kind: 'unread', why: "registry conversation differs from the start's" };
  return { kind: 'ask', account: i.lane, uuid: i.startUuid };
}

/** Table 3.3.11b "The conversation is not local" (hard; Overlord and coordinator, C50): the conversation of the generation's
 *  own start is absent on the host that runs the session. First match (plan Task 4):
 *  1. the start unread, or no row for the generation's `startId`: unmeasured (the uuid asked about is the start's);
 *  2. the ask not made: unmeasured with its reason;
 *  3. the carrier unmeasured on either side of the ask (`host unmeasured`), or changed between the two reads, digest or key
 *     epoch (`host changed during the read`): unmeasured, so an answer from another host is never read as this one's;
 *  4. found, at any rung: local (`false`). `foreign` is never asked, so a copy under another account is never "here";
 *  5. a search that could not look everywhere (`complete: false`): unmeasured, never absence;
 *  6. the absence not confirmed by the measured search: unmeasured. No search (`measured` null): the resolver's answer may be its
 *     memory, which can outlive the file appearing at another spelling (review 3696, F1), and its `complete` folds an unreadable
 *     read into absence (review 3718, F3). The projects listing unreadable: unmeasured. A file at any place: local (`false`). Any
 *     place unreadable: unmeasured. So an absence is believed only when every read of it was a proven absence;
 *  7. absent on the measured search, and the start `resume` or `compact`: not local (`true`) at once, since the conversation
 *     existed before this start (plan fix round 1, F3);
 *  8. absent and any other source, with the turn marker unread: unmeasured with the marker's reason;
 *  9. absent and no turn of this generation stopped yet (the last stop null or before the start): local when no turn is running,
 *     since a fresh conversation writes nothing before its first turn (question 4); unmeasured while the first turn runs, since its
 *     first append may not have landed (review 3696, F1's race);
 *  10. absent after a turn of its own stopped, observed no later than the marker's last event: unmeasured (F1);
 *  11. otherwise: not local. */
export function notLocalOf(i: {
  readonly ask: TranscriptAsk; readonly start: { readonly ok: true; readonly row: StartRow | null } | { readonly ok: false; readonly detail: string };
  readonly before: Carrier; readonly after: Carrier; readonly turn: TurnMarkRead; readonly startReportedAt: number;
}): Reading<boolean> {
  if (!i.start.ok) return unmeasured(`start unread: ${i.start.detail}`);
  if (i.start.row === null) return unmeasured('start row absent');
  if (i.ask.kind === 'unread') return unmeasured(i.ask.why);
  if (i.before === 'unmeasured' || i.after === 'unmeasured') return unmeasured('host unmeasured');
  if (i.before.digest !== i.after.digest || i.before.keyEpoch !== i.after.keyEpoch) return unmeasured('host changed during the read');
  const a = i.ask.answer;
  if (a.kind === 'found') return { kind: 'measured', value: false };
  if (!a.complete) return unmeasured('transcript search incomplete');
  const m = i.ask.measured;
  if (m === null) return unmeasured('absence not measured');
  if (m.listing === 'unreadable') return unmeasured('projects listing unreadable');
  if (m.places.includes('present')) return { kind: 'measured', value: false };
  if (m.places.includes('unreadable')) return unmeasured('a transcript place unreadable');
  if (i.start.row.source === 'resume' || i.start.row.source === 'compact') return { kind: 'measured', value: true };
  if (!i.turn.ok) return unmeasured(`turn marker ${i.turn.reason}`);
  if (i.turn.stopAt === null || i.turn.stopAt < i.startReportedAt) {
    return i.turn.state === 'working' ? unmeasured('first turn still running') : { kind: 'measured', value: false };
  }
  if (i.turn.at >= i.ask.observedAt) return unmeasured('absence older than the turn marker');
  return { kind: 'measured', value: true };
}

// PR D (Task 7): the account readings, the Overlord's only, each hard (Table 3.3.11b, C46, C57, Table 3.4b). Every one reads the
// candidates (serviceability B's `overlordLoadCandidates` over designation A's ordered list), read once a pass. No designation
// bound to this generation's session: the row does not apply, measured `false`. The designation unreadable: unmeasured. An
// unmeasured candidate never folds into a proven absence (fix round 1, F5).

/** The Overlord's candidates for one pass: designation A's ordered list (`overlordAccounts`, asked only of a live binding, which
 *  alone has a set) under serviceability B's `overlordLoadCandidates`. */
export function overlordCandidatesOf(d: DesignationRead, f: AccountFacts): Candidates {
  return overlordLoadCandidates(d, d.kind === 'designated' ? overlordAccounts(d.row.accountPools, d.row.model, f).list : [], f);
}

/** The candidates for one generation when the designation alone answers, or null when it is this session's live binding and the
 *  facts and the pool answer must be read (fix round 1, I: the designation is checked first, so no read is made for a generation
 *  the rows do not apply to). Not this session's (`boundTo`, the one reader of the binding that `termRaisedOf` reads too: no
 *  designation, a pending one, or a rebind): `not-designated`. Unreadable: unmeasured. */
export function unboundCandidates(d: DesignationRead, sessionId: string): Candidates | null {
  const b = boundTo(d, sessionId);
  if (b === false) return { kind: 'not-designated' };
  return b.kind === 'unmeasured' ? { kind: 'unmeasured', why: 'designation-unreadable' } : null;
}

/** The account holds (`overlord_account_holds`, PR H) as this reading takes them, or why they are unread: L0's one shape. */
export type Holds = AccountHoldsRead;

/** A set on the route record, read from the session's side word as `_session_pool_side` printed it (fix round 1, F1): a set, or
 *  one of the two bad-set words, which arrive as `verdict=undecidable`. Never the side the verdict was decided on, which
 *  `_pool_ok_set` sets to `account` for every decided answer under a well-formed set. */
const isSetSide = (side: string): boolean => side.startsWith('set:') || side === 'set-unreadable' || side === 'set-malformed';

/** Table 3.3.11b "The account is outside the set" (hard; Overlord, C46): the session's account is not one the designation's set
 *  admits, and a candidate can take the renewal. First match (plan Task 7):
 *  0. no designation bound to this session: measured false; the designation unreadable: unmeasured;
 *  1. the pool answer not run, refused or unparsed: unmeasured, naming which;
 *  2. no set on the route record (a project word): unmeasured;
 *  3. the answer's account held (`holds`): outside the set, to rule 8 (F7);
 *  4. `serve`, and 6. `mismatch` over a crossing that stands: measured false, unless the holds are unread, which might decide;
 *  5. `undecidable`: unmeasured with the pool state; 7. the crossing unreadable: unmeasured;
 *  8. outside the set (`mismatch` with crossing `none`, or held): the candidates other than the answer's own account decide (fix
 *     round 1, D: as the other two readings leave the session's account out; slug outside-set-leaves-its-own-account-out). Any
 *     unmeasured, unmeasured (F5); one serving, true; none serving, false (nothing to land on: `stranded`, slug
 *     account-triggers-need-a-servable-account). */
export function accountOutsideSetOf(a: PoolAnswerRead, c: Candidates, holds: Holds | 'not-wired'): Reading<boolean> {
  if (c.kind === 'not-designated') return { kind: 'measured', value: false };
  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');
  if (a.kind === 'not-run') return unmeasured('pool answer not run');
  if (a.kind === 'refused') return unmeasured(`pool answer refused (${a.code})`);
  if (a.kind === 'unparsed') return unmeasured(`pool answer unparsed: ${a.why}`);
  const hasSet = isSetSide(a.answer.side);
  if (!hasSet) return unmeasured('no set on the route record');
  const held = holds !== 'not-wired' && holds.ok && holds.lanes.includes(a.answer.account);
  if (!held) {
    const inside = a.answer.verdict === 'serve' || (a.answer.verdict === 'mismatch' && a.answer.crossing === 'valid');
    if (inside) {
      if (holds !== 'not-wired' && !holds.ok) return unmeasured(`holds unread: ${holds.detail}`);
      return { kind: 'measured', value: false };
    }
    if (a.answer.verdict === 'undecidable') return unmeasured(`undecidable: ${a.answer.poolState}`);
    if (a.answer.crossing === 'unreadable') return unmeasured('crossing unreadable');
  }
  const elsewhere = c.list.filter((x) => x.id !== a.answer.account);
  if (elsewhere.some((x) => x.serves === 'unmeasured')) return unmeasured('a candidate unmeasured');
  return { kind: 'measured', value: elsewhere.some((x) => x.serves === 'yes') };
}

/** The account the generation runs on, as `classUnservableOf` reads it: its id (the generation's lane), the model it runs (the
 *  class is `familyClassOf` of it) and its serviceability facts (`limits.ts#laneFactsOf`; absent, unread). */
export interface OnAccount { readonly account: string | null; readonly model: string | null; readonly own: LaneFacts | undefined }

/** Table 3.3.11b "The class cannot be served here" (hard; Overlord, Table 3.4b): the server's twin (`serviceability`, asked on the
 *  set side, mapped by serviceability B's `classUnservableReading`) answers unservable for the generation's class on its account,
 *  and another candidate serves. Not servable-here is decided first: a servable account is not due whatever the others say. Then
 *  another candidate unmeasured: unmeasured (F5); one serving: true; none: false (`stranded`). */
export function classUnservableOf(on: OnAccount, c: Candidates, nowS: number): Reading<boolean> {
  if (c.kind === 'not-designated') return { kind: 'measured', value: false };
  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');
  const cls = on.model === null ? null : familyClassOf(on.model);
  if (cls === null) return unmeasured('model unknown');
  if (on.account === null) return unmeasured('account unknown');
  if (on.own === undefined) return unmeasured('account facts unread');
  const own = classUnservableReading(serviceability(cls, on.own, 'set-side', nowS));
  if (own.kind === 'measured' && !own.value) return own;
  if (own.kind === 'unmeasured') return own;
  const others = c.list.filter((x) => x.id !== on.account);
  if (others.some((x) => x.serves === 'unmeasured')) return unmeasured('a candidate unmeasured');
  return { kind: 'measured', value: others.some((x) => x.serves === 'yes') };
}

/** Serviceability B's load reading for the account the generation runs on (`accountLoadMoveReading`, C57), with this account as
 *  the current candidate and the rest as the others. An account not among the candidates is unmeasured. THE F5 GUARD: the
 *  producer counts only serving others and so reads an unmeasured other as "no counted other", `false`; until it reads that as
 *  unmeasured itself (the plan's index change for serviceability B), a `false` beside an unmeasured other reads unmeasured here,
 *  so the fold never reaches `renewalDue` (slug load-move-guards-the-unmeasured-other). */
export function accountLoadOf(account: string | null, c: Candidates, nowS: number): Reading<boolean> {
  if (c.kind === 'not-designated') return { kind: 'measured', value: false };
  if (c.kind === 'unmeasured') return unmeasured('designation unreadable');
  if (account === null) return unmeasured('account unknown');
  const current = c.list.find((x) => x.id === account);
  if (current === undefined) return unmeasured('account not a candidate');
  const others = c.list.filter((x) => x !== current);
  const load = accountLoadMoveReading(current, others, nowS);
  if (load.kind === 'measured' && !load.value && others.some((x) => x.serves === 'unmeasured')) return unmeasured('a candidate unmeasured');
  return load;
}

/** Table 3.3.11b "The account load" (hard; Overlord, C57): the load reading (`accountLoadOf`) and "the session is idle" by
 *  Kleene's and, since idleness is the renewal lane's and not the load reading's (slug load-move-joins-idle-in-the-lane). Idle is
 *  the turn marker read and not `working`. A measured busy session is not due whatever the load says; a load that is not due is
 *  not due whatever the marker says; an unread marker beside a due load is unmeasured, naming the marker. */
export function accountLoadMoveOf(load: Reading<boolean>, turn: TurnMarkRead): Reading<boolean> {
  const idle: Reading<boolean> = turn.ok
    ? { kind: 'measured', value: turn.state !== 'working' }
    : unmeasured(`turn marker ${turn.reason}`);
  if (load.kind === 'measured' && !load.value) return load;
  if (idle.kind === 'measured' && !idle.value) return idle;
  if (load.kind === 'unmeasured') return load;
  return idle;
}

// PR H (Task 11): the launch profile (§3.6). A start that loaded something the profile does not list, from the account's own config
// directory, holds that account out of the Overlord's ordered list until the operator clears it; a held account reads as outside the
// set (`accountOutsideSetOf`, F7), so the hard row renews the Overlord off it. A digest that differs from the server's while the two
// boxes run one build is a new install for the Overlord (question 5, slug digest-mismatch-rides-new-install).

/** What one start's sandbox verdict does to its account: `hold` the account it ran on; `settled`, nothing, and the start is not
 *  asked again (a pass, or a failure that is not the account's); `unmeasured`, nothing yet, and the pass asks again (slug
 *  hold-of-start-answers-three-arms: a pass and an unread verdict are handled differently, so they are never one null). */
export type StartHold =
  | { readonly kind: 'hold'; readonly lane: string } | { readonly kind: 'settled' } | { readonly kind: 'unmeasured'; readonly why: string };

/** A start's hold (§3.6, plan question 6), first match:
 *  1. no verdict yet (no loads report, or one that is not this start's): unmeasured;
 *  2. a property failed with something loaded from the account's own config directory (`PropertyVerdict.fromAccount`, the sandbox
 *     check's own reading of the harness): hold the account the start ran on, or unmeasured when that account is unknown;
 *  3. any property unmeasured: unmeasured, since an unmeasured property never holds an account and may yet hide one;
 *  4. otherwise settled: a pass, or failures that a workspace, the launch's composition or a missing load explain, which another
 *     account would not cure. */
export function holdOfStart(verdict: SandboxVerdict | 'unmeasured', lane: string | null): StartHold {
  if (verdict === 'unmeasured') return { kind: 'unmeasured', why: 'no verdict for the start yet' };
  if (verdict.properties.some((p) => p.state === 'failed' && p.fromAccount)) {
    return lane === null ? { kind: 'unmeasured', why: 'the account the start ran on is unknown' } : { kind: 'hold', lane };
  }
  const open = verdict.properties.find((p) => p.state === 'unmeasured');
  if (open !== undefined) return { kind: 'unmeasured', why: `${open.property} unmeasured` };
  return { kind: 'settled' };
}

/** Whether the Overlord's newest start ran a launch profile whose digest differs from the server's (`launchDigestOf('overlord')`):
 *  read from that start's own loads report. A failed read, no start, no report or a report naming no digest: unmeasured. */
export function startDigestDiffersOf(read: { readonly ok: true; readonly newest: { readonly report: { readonly profileDigest: string | null } | null } | null }
  | { readonly ok: false; readonly detail: string }, serverDigest: string): Reading<boolean> {
  if (!read.ok) return unmeasured(`start loads unread: ${read.detail}`);
  const digest = read.newest?.report?.profileDigest ?? null;
  if (digest === null) return unmeasured(read.newest === null ? 'no start' : read.newest.report === null ? 'no loads report' : 'no digest reported');
  return { kind: 'measured', value: digest !== serverDigest };
}

/** The profile lane's build agreement as a reading: `agreed` true, `skewed` false, `unknown` unmeasured. */
export function buildsAgreeOf(b: BuildAgreement): Reading<boolean> {
  return b === 'unknown' ? unmeasured('builds unknown') : { kind: 'measured', value: b === 'agreed' };
}

/** The Overlord's `installBehind` (question 5): the roll's "behind" test, or the start's digest differing from the server's while
 *  the builds agree, by Kleene's or. Builds that differ or are unknown: unmeasured `build skew`, so a fresh start ccd would refuse
 *  is never asked for. */
export function overlordInstallBehindOf(behind: Reading<boolean>, digestDiffers: Reading<boolean>, buildsAgree: Reading<boolean>): Reading<boolean> {
  if (buildsAgree.kind === 'unmeasured' || !buildsAgree.value) return unmeasured('build skew');
  if ((behind.kind === 'measured' && behind.value) || (digestDiffers.kind === 'measured' && digestDiffers.value)) return { kind: 'measured', value: true };
  if (behind.kind === 'unmeasured') return behind;
  if (digestDiffers.kind === 'unmeasured') return digestDiffers;
  return { kind: 'measured', value: false };
}
