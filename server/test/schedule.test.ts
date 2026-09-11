// Task 1 — `shared/schedule.ts`, the recurrence math (spec §4).
//
// WHAT THIS PINS AND WHY:
//  - The DST answers are the whole reason this module exists. Two of them were
//    measured WRONG in a prototype before the plan was finalised: a forward
//    minute-scan from the nominal local value evaluates the zone offset at a
//    NAIVE number, which near a transition picks the pre-transition offset and
//    lands BEFORE the gap. It returned 01:31 for Warsaw's missing 02:30. The
//    gap answer is the TRANSITION INSTANT, found by bisection; (b) is that
//    measurement.
//  - The autumn fold must fire ONCE. Comparing epochs cannot do it — local
//    02:25 on 2026-10-25 in Europe/Warsaw exists at BOTH 00:25Z and 01:25Z, so
//    "next occurrence after lastFireAt" by epoch fires twice and the second
//    firing looks exactly like a correct one in the history. (c) is that.
//  - Minutes, not hours, throughout: Pacific/Chatham is +12:45/+13:45 and
//    Australia/Lord_Howe steps by 30, giving a HALF-HOUR gap. Working in
//    minutes makes both non-cases rather than special cases. (d) is that.
//  - L0 purity: this module is bundled by the PWA, so a single `import` would
//    be a broken browser bundle. vitest runs under node and cannot feel that
//    breakage, which is exactly why the assertion lives here. (j) is that —
//    the same argument `peers-claims-l0.test.ts:141` makes for `shared/api.ts`.
//  - `icuHasZones()` exists because a small-ICU node does not THROW on an IANA
//    zone, it silently answers UTC. Every fixture above would still pass while
//    every answer was wrong. (i) is the detector.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nextOccurrence, describeCadence, icuHasZones,
  type Cadence, type LocalTuple, type NextOccurrence,
} from '../../shared/schedule.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(here, '../../shared/schedule.ts');

const WARSAW = 'Europe/Warsaw';
const ALL_DAYS = 0b1111111;
const WEEKDAYS = 0b0111110; // bit 0 = Sunday, so Mon..Fri are bits 1..5

/** Render an instant as it reads IN the zone — the only honest way to assert a
 *  wall-clock answer. An epoch number in an expectation would be unreadable and
 *  would silently absorb an offset error. */
const show = (tz: string, t: number): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, dateStyle: 'short', timeStyle: 'short', hour12: false,
  }).format(t);

/** Narrow to the fired arm, failing loudly rather than returning undefined —
 *  an `unschedulable` answer reaching a `.at` read is the bug, not a skip. */
function fired(r: NextOccurrence): { at: number; localTuple: LocalTuple | null; dstShifted: boolean } {
  if ('unschedulable' in r) throw new Error(`expected an occurrence, got unschedulable:${r.unschedulable}`);
  return r;
}

describe('(a) a weekday cadence skips the weekend', () => {
  it('weekdays 09:00 Europe/Warsaw, asked on a Saturday, answers Monday 09:00', () => {
    const sat = Date.UTC(2026, 7, 29, 6, 0); // 2026-08-29 is a Saturday
    const c: Cadence = { kind: 'wall-clock', days: WEEKDAYS, minuteOfDay: 9 * 60, tz: WARSAW };
    expect(show(WARSAW, fired(nextOccurrence(c, sat, null)).at)).toBe('31/08/2026, 09:00');
  });
});

describe('(b) the spring-forward GAP — measurement 3', () => {
  // 2027-03-28 02:00 -> 03:00 in Europe/Warsaw. Local 02:30 does not exist.
  const c: Cadence = { kind: 'wall-clock', days: ALL_DAYS, minuteOfDay: 150, tz: WARSAW };
  const asked = Date.UTC(2027, 2, 27, 12, 0);

  it('answers the first valid instant AFTER the gap, which is the transition itself', () => {
    expect(show(WARSAW, fired(nextOccurrence(c, asked, null)).at)).toBe('28/03/2027, 03:00');
  });

  it('says it shifted — a caller that renders 03:00 for an 02:30 schedule must be able to explain it', () => {
    expect(fired(nextOccurrence(c, asked, null)).dstShifted).toBe(true);
  });
});

describe('(c) the autumn FOLD fires once — measurement 4', () => {
  // 2026-10-25 03:00 -> 02:00 in Europe/Warsaw. Local 02:25 happens TWICE:
  // 00:25Z and 01:25Z.
  const c: Cadence = { kind: 'wall-clock', days: ALL_DAYS, minuteOfDay: 145, tz: WARSAW };
  const firstFold = Date.UTC(2026, 9, 25, 0, 25);

  it('having fired at the FIRST 02:25, the next occurrence is the NEXT DAY, not the second 02:25', () => {
    const after: LocalTuple = { y: 2026, mo: 10, d: 25, h: 2, mi: 25 };
    expect(show(WARSAW, fired(nextOccurrence(c, firstFold, after)).at)).toBe('26/10/2026, 02:25');
  });

  it('never selects the second 02:25 even with no local anchor — a fold yields two instants and the EARLIER wins', () => {
    expect(show(WARSAW, fired(nextOccurrence(c, firstFold, null)).at)).toBe('26/10/2026, 02:25');
  });

  it('is anchored by the LOCAL TUPLE, not the epoch — the case where comparing epochs double-fires', () => {
    // This is the fixture that makes `afterLocal` load-bearing, and it took a
    // mutation run to find: with `hits[0]` and the `<= afterMs` skip, most fold
    // shapes come out right even comparing epochs, so a naive fold fixture
    // certifies a guarantee nobody holds.
    //
    // The discriminating case is an anchor one minute BEFORE the instant that
    // already fired — which is the normal shape whenever the caller anchors on
    // the occurrence's SCHEDULED time rather than the actual fire instant, the
    // standard way to stop a slow sweep drifting later every day.
    const anchorJustBefore = firstFold - 60000;               // 00:24Z
    const alreadyFired: LocalTuple = { y: 2026, mo: 10, d: 25, h: 2, mi: 25 };

    // By epoch alone, 00:25Z is still in the future — so it fires 02:25 twice.
    expect(show(WARSAW, fired(nextOccurrence(c, anchorJustBefore, null)).at))
      .toBe('25/10/2026, 02:25');

    // By local tuple, 02:25 on the 25th is spent, whichever instant it was.
    expect(show(WARSAW, fired(nextOccurrence(c, anchorJustBefore, alreadyFired)).at))
      .toBe('26/10/2026, 02:25');
  });
});

describe('(d) zones whose offsets are not whole hours', () => {
  it('Pacific/Chatham (+12:45) resolves the named wall clock', () => {
    const c: Cadence = { kind: 'wall-clock', days: ALL_DAYS, minuteOfDay: 9 * 60, tz: 'Pacific/Chatham' };
    const r = fired(nextOccurrence(c, Date.UTC(2026, 0, 10), null));
    expect(show('Pacific/Chatham', r.at)).toBe('11/01/2026, 09:00');
  });

  it('Australia/Lord_Howe steps 30 minutes, so its gap is HALF an hour — 02:00 answers 02:30', () => {
    const c: Cadence = { kind: 'wall-clock', days: ALL_DAYS, minuteOfDay: 2 * 60, tz: 'Australia/Lord_Howe' };
    const r = fired(nextOccurrence(c, Date.UTC(2026, 9, 3, 0, 0), null));
    expect(show('Australia/Lord_Howe', r.at)).toBe('04/10/2026, 02:30');
    expect(r.dstShifted).toBe(true);
  });
});

describe('(e)(f)(g) it says when it CANNOT schedule, as a typed refusal', () => {
  it('(e) an unknown zone is unknown-timezone, not a throw and not a null', () => {
    const c: Cadence = { kind: 'wall-clock', days: ALL_DAYS, minuteOfDay: 0, tz: 'Not/AZone' };
    expect(nextOccurrence(c, 0, null)).toEqual({ unschedulable: 'unknown-timezone' });
  });

  it('(f) an empty day mask can never fire — no-future-occurrence, which is not bad input', () => {
    const c: Cadence = { kind: 'wall-clock', days: 0, minuteOfDay: 0, tz: WARSAW };
    expect(nextOccurrence(c, 0, null)).toEqual({ unschedulable: 'no-future-occurrence' });
  });

  it('(g) a zero interval is bad-cadence, which is not the same fact as (f)', () => {
    expect(nextOccurrence({ kind: 'interval', everyMinutes: 0 }, 0, null))
      .toEqual({ unschedulable: 'bad-cadence' });
  });

  it('the three refusals are distinguishable — a caller renders a different sentence for each', () => {
    const codes = new Set([
      (nextOccurrence({ kind: 'wall-clock', days: ALL_DAYS, minuteOfDay: 0, tz: 'Not/AZone' }, 0, null) as { unschedulable: string }).unschedulable,
      (nextOccurrence({ kind: 'wall-clock', days: 0, minuteOfDay: 0, tz: WARSAW }, 0, null) as { unschedulable: string }).unschedulable,
      (nextOccurrence({ kind: 'interval', everyMinutes: 0 }, 0, null) as { unschedulable: string }).unschedulable,
    ]);
    expect(codes.size).toBe(3);
  });
});

describe('(h) an interval advances by ELAPSED minutes, never by a wall clock', () => {
  it('+240 minutes across the autumn fold is exactly four hours of elapsed time', () => {
    const before = Date.UTC(2026, 9, 25, 0, 0); // inside the Warsaw fold window
    const r = fired(nextOccurrence({ kind: 'interval', everyMinutes: 240 }, before, null));
    expect(r.at - before).toBe(240 * 60000);
  });

  it('carries no local tuple at all — an interval has no wall clock to carry', () => {
    const r = fired(nextOccurrence({ kind: 'interval', everyMinutes: 60 }, Date.UTC(2026, 5, 1), null));
    expect(r.localTuple).toBeNull();
    expect(r.dstShifted).toBe(false);
  });
});

describe('(i) the small-ICU detector', () => {
  it('reports true on this build — a false here means every zone answer above is UTC', () => {
    expect(icuHasZones()).toBe(true);
  });
});

describe('describeCadence says what it does in words', () => {
  it('names both kinds distinguishably and never returns an empty string', () => {
    const wall = describeCadence({ kind: 'wall-clock', days: WEEKDAYS, minuteOfDay: 9 * 60, tz: WARSAW });
    const every = describeCadence({ kind: 'interval', everyMinutes: 90 });
    expect(wall.length).toBeGreaterThan(0);
    expect(every.length).toBeGreaterThan(0);
    expect(wall).not.toBe(every);
  });
});

describe('(j) L0 purity: the PWA bundles this file', () => {
  it('shared/schedule.ts contains no import statement at all', () => {
    const lines = readFileSync(modPath, 'utf8').split('\n');
    expect(lines.filter((l) => /^\s*import\b/.test(l))).toEqual([]);
  });

  it('reaches Intl as a GLOBAL — that is the whole reason it needs no dependency', () => {
    expect(readFileSync(modPath, 'utf8')).toContain('Intl.DateTimeFormat');
  });
});
