/** L0 — the recurrence math (spec §4). Imports NOTHING: the PWA bundles this
 *  file, so a `node:*` import would be a broken browser bundle, and a cron
 *  library would be a dependency in the one path that decides whether a
 *  workspace is created unattended. `Intl` is a GLOBAL, not an import — that is
 *  the whole reason this needs no dependency, and it is what lets the server
 *  and the PWA share ONE implementation rather than agreeing to match.
 *
 *  `CadenceKind` and `ScheduleError` are deliberately NOT declared here — they
 *  belong to `shared/api.ts`. Two exported types of one name in two bundled
 *  `shared/` files is the second-copy shape `single-definition.test.ts` exists
 *  to fail on. This module names its own narrower return union instead. */

const MIN = 60000;

/** Bit 0 is Sunday, matching `Date.prototype.getUTCDay()`. A 7-bit mask, so
 *  "weekdays" is `0b0111110` and "never" is `0`. */
export type DayMask = number;

export type Cadence =
  | { kind: 'wall-clock'; days: DayMask; minuteOfDay: number; tz: string }
  | { kind: 'interval'; everyMinutes: number };

/** Why a cadence yields no next instant. Three CONDITIONS, not one null: a
 *  caller renders a different sentence for each, and an operator fixes each a
 *  different way — retype the zone, tick a day, raise the interval.
 *  `failure-ceiling` is deliberately absent: that is §8's repeated-failure
 *  rule, written by the sweep, not by arithmetic. */
export type CadenceUnschedulable = 'unknown-timezone' | 'bad-cadence' | 'no-future-occurrence';

export interface LocalTuple { y: number; mo: number; d: number; h: number; mi: number }

export type NextOccurrence =
  | { at: number; localTuple: LocalTuple | null; dstShifted: boolean }
  | { unschedulable: CadenceUnschedulable };

/** Wall-clock fields of `t` in `tz`. Throws `RangeError` on a zone ICU does not
 *  know — the ONE place this module can learn that, since constructing the
 *  formatter is the only operation that validates the name. */
function partsIn(tz: string, t: number): LocalTuple {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(t)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  // `hour % 24` because en-GB renders midnight as 24 under `hour12: false`.
  return { y: o['year']!, mo: o['month']!, d: o['day']!, h: o['hour']! % 24, mi: o['minute']! };
}

/** The offset in MINUTES (east positive) that `tz` is at instant `t`. Minutes,
 *  not hours: Pacific/Chatham is +12:45 / +13:45 and Australia/Lord_Howe steps
 *  by 30. Everything downstream works in minutes, which is what makes both
 *  non-cases rather than special cases. */
function offsetMinutes(tz: string, t: number): number {
  const p = partsIn(tz, t);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0) - Math.floor(t / MIN) * MIN) / MIN;
}

/** `a <= b` comparing LOCAL tuples, never epochs. */
const tupleLE = (a: LocalTuple, b: LocalTuple): boolean =>
  a.y !== b.y ? a.y < b.y : a.mo !== b.mo ? a.mo < b.mo : a.d !== b.d ? a.d < b.d
  : a.h !== b.h ? a.h < b.h : a.mi <= b.mi;

/** Invert a LOCAL wall-clock tuple to the epoch instants that render AS it.
 *  Probes the offset a day either side, so it never assumes a transition is a
 *  whole hour and never assumes a gap is 60 minutes; every candidate is
 *  round-tripped back through `formatToParts` and kept only if it renders as
 *  the tuple asked for.
 *
 *  Returns 1 instant on a normal day, TWO across an autumn fold (sorted, so
 *  `[0]` is the earlier), and ZERO inside a spring-forward gap. Those three
 *  cases are the whole of the DST question. */
function invert(tz: string, want: LocalTuple): number[] {
  const naive = Date.UTC(want.y, want.mo - 1, want.d, want.h, want.mi, 0);
  const out: number[] = [];
  for (const probeAt of [naive - 86400000, naive, naive + 86400000]) {
    const cand = naive - offsetMinutes(tz, probeAt) * MIN;
    if (out.includes(cand)) continue;
    const back = partsIn(tz, cand);
    if (back.y === want.y && back.mo === want.mo && back.d === want.d
        && back.h === want.h && back.mi === want.mi) out.push(cand);
  }
  return out.sort((a, b) => a - b);
}

/** The first valid instant strictly after a spring-forward GAP, found by
 *  bisecting the offset change across the local day.
 *
 *  This was measured WRONG first and the warning is worth the lines: a forward
 *  minute-scan from the nominal value evaluates the zone offset at a NAIVE
 *  number, which near a transition picks the PRE-transition offset and lands
 *  BEFORE the gap — a prototype returned 01:31 for Warsaw's missing 02:30.
 *  Local time jumps straight over the requested wall clock, so the first valid
 *  instant after the gap IS the transition. Returns `null` when the day holds
 *  no transition (the tuple was unrepresentable for some other reason). */
function transitionInstant(tz: string, cal: { y: number; mo: number; d: number }): number | null {
  const lo0 = Date.UTC(cal.y, cal.mo - 1, cal.d) - 86400000;
  const hi0 = lo0 + 3 * 86400000;
  const offLo = offsetMinutes(tz, lo0);
  if (offsetMinutes(tz, hi0) === offLo) return null;
  let lo = lo0, hi = hi0;
  while (hi - lo > MIN) {
    const mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN;
    if (mid === lo) break;
    if (offsetMinutes(tz, mid) === offLo) lo = mid; else hi = mid;
  }
  return hi;
}

/** 400 local days bounds any cadence this vocabulary can express (the sparsest
 *  is one weekday, at 7). A bound rather than a `while` so a cadence that can
 *  never fire refuses instead of hanging the sweep. */
const DAY_WALK_LIMIT = 400;

/**
 * The next instant `c` fires strictly after `afterMs`, or a typed refusal.
 *
 * `afterLocal` is the LOCAL tuple this automation last fired at, and it is read
 * ONLY by the `wall-clock` arm — the `interval` arm has no wall clock and never
 * looks at it. Within that arm `null` carries exactly one meaning: no previous
 * local firing (a new or never-fired automation). It is not an
 * "unknown"/"unmeasured" marker and no caller may use it as one.
 *
 * Why a LOCAL anchor and not the epoch: across an autumn fold a wall clock
 * happens twice. Europe/Warsaw local 02:25 on 2026-10-25 exists at both 00:25Z
 * and 01:25Z, so "the next occurrence after `lastFireAt`" computed by epoch
 * fires TWICE — and the second firing is indistinguishable from a correct one
 * in the run history. Comparing tuples fires it once.
 */
export function nextOccurrence(c: Cadence, afterMs: number, afterLocal: LocalTuple | null): NextOccurrence {
  if (c.kind === 'interval') {
    if (!Number.isInteger(c.everyMinutes) || c.everyMinutes <= 0) return { unschedulable: 'bad-cadence' };
    // Elapsed minutes, never a wall clock: an interval crossing a DST boundary
    // advances by what it says, which is the point of choosing it over a time.
    return { at: afterMs + c.everyMinutes * MIN, localTuple: null, dstShifted: false };
  }

  if (!Number.isInteger(c.minuteOfDay) || c.minuteOfDay < 0 || c.minuteOfDay > 1439) {
    return { unschedulable: 'bad-cadence' };
  }
  // An empty mask is not bad input — it is a well-formed cadence with no
  // occurrence, and an operator fixes it by ticking a day, not by retyping.
  if (!c.days) return { unschedulable: 'no-future-occurrence' };
  try { partsIn(c.tz, afterMs); } catch { return { unschedulable: 'unknown-timezone' }; }

  const want = { h: Math.floor(c.minuteOfDay / 60), mi: c.minuteOfDay % 60 };
  const start = partsIn(c.tz, afterMs);

  // Walk LOCAL DAYS, not minutes. A minute walk is 1440x the work and gets the
  // gap wrong for the reason `transitionInstant` documents.
  for (let i = 0; i <= DAY_WALK_LIMIT; i++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d) + i * 86400000);
    if (!(c.days & (1 << day.getUTCDay()))) continue;
    const target: LocalTuple = {
      y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate(), ...want,
    };
    if (afterLocal && tupleLE(target, afterLocal)) continue;

    const hits = invert(c.tz, target);
    if (hits.length > 0) {
      const at = hits[0]!; // the EARLIER of a fold's two instants
      if (at <= afterMs) continue;
      return { at, localTuple: target, dstShifted: false };
    }

    // Zero hits: the named wall clock does not exist that day — a gap.
    const at = transitionInstant(c.tz, target);
    if (at !== null && at > afterMs) {
      return { at, localTuple: partsIn(c.tz, at), dstShifted: true };
    }
  }
  return { unschedulable: 'no-future-occurrence' };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** A cadence in words, for a surface that must say what it will do before it
 *  does it. Deliberately not localised: it is one sentence, and the zone name
 *  it carries is the part that matters. */
export function describeCadence(c: Cadence): string {
  if (c.kind === 'interval') return `every ${c.everyMinutes} min`;
  const hh = String(Math.floor(c.minuteOfDay / 60)).padStart(2, '0');
  const mm = String(c.minuteOfDay % 60).padStart(2, '0');
  const days = DAY_NAMES.filter((_, i) => c.days & (1 << i));
  const when = days.length === 7 ? 'daily'
    : days.length === 0 ? 'never'
    : days.join(' ');
  return `${when} at ${hh}:${mm} ${c.tz}`;
}

/** Whether this build's ICU actually carries the timezone database.
 *
 *  A small-ICU node does NOT throw on an IANA zone — it silently answers UTC,
 *  so every calculation above would return a plausible, wrong instant and no
 *  test of the arithmetic would notice. Comparing a January against a July
 *  offset for a DST zone is the cheapest total detector: on a full build they
 *  differ, on a small build both are 0. A boot assertion calls this so the
 *  failure lands in CI rather than in the operator's morning. */
export function icuHasZones(): boolean {
  try {
    return offsetMinutes('Europe/Warsaw', Date.UTC(2026, 0, 15))
        !== offsetMinutes('Europe/Warsaw', Date.UTC(2026, 6, 15));
  } catch { return false; }
}
