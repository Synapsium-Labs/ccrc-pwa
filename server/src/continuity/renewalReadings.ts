// L1, context C3 (Session Conversation): the Overlord's renewal readings (Overlord spec §3.3.11, H13, Table 3.3.11b; W1,
// plan `w1-renewal-readings.md`). Pure mappers, one per reading, from a producer's answer to a `Reading<T>`, and the
// deciders this piece owns. Every time arrives as a number, and every producer's answer as an argument.
//
// MONOTONIC (the plan's Global Constraints): a reading is measured only from a measured answer, and every unmeasured arm
// stays unmeasured with its reason, so `renewalDue` names it in `blind` and it never makes a renewal due. A reading whose
// producer has not merged is not answered here at all, and keeps the lane's `W1` default (`renewalInputsOf`).
//
// PR A: `fittedCeilingOf` (the soft ceiling, from the probes' `fittedCeiling`) and the daily backstop
// (`backstopInstantBefore`, `backstopDueOf`). The later pull requests of the plan add the other mappers here.
import type { BackstopRead } from '../../../shared/renewal-readings.js';
import { fittedCeiling, type SpotProbe } from './probes.js';
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
