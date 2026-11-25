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
// (`probesFailedTwiceOf`). The later pull requests of the plan add the other mappers here.
import type { GenerationState } from '../../../shared/continuity.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { BackstopRead } from '../../../shared/renewal-readings.js';
import type { GenEvent } from './generationMachine.js';
import { fittedCeiling, type SpotProbe } from './probes.js';
import { modelDriftOf, readersRunning, type Read, type ReaderEventIn, type SidecarClass } from './hookReports.js';
import { familyClassOf } from '../../../shared/models.js';
import type { ModelSwitchHow } from '../../../shared/continuity-reports.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import { hardCapTokens, measuredCount, type Reading, type RenewalInputs } from './renewalDue.js';

/** The `RenewalInputs` fields the lane reads `W1` until their producers are wired (`renewalInputsOf`'s defaults). The
 *  wiring answers only the fields whose producer is wired, and the lane spreads them over the defaults. */
export type W1Inputs = Pick<RenewalInputs, 'fittedCeilingTokens' | 'turns' | 'backstopDue' | 'modelDrift' | 'termRaised'
  | 'accountOutsideSet' | 'classUnservable' | 'accountLoadMove' | 'classChanged' | 'notLocal'>;

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
