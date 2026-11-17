// The renewal readings' oracles and mutant sets (Overlord W1, plan `w1-renewal-readings.md`, PR A: Tasks 1 and 2). Each
// decider's cases are written ONCE here, as suite cases over a module: `continuity-renewal-readings.test.ts` runs them
// against the real module, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
// A later pull request of the plan adds its mappers' cases and sets here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { FIT_WINDOW, SPOT_PROBE_EVERY_TOKENS } from '../../../shared/continuity.js';
import type { BackstopRead } from '../../../shared/renewal-readings.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/continuity/renewalReadings.ts');

export type RenewalReadingsModule = typeof import('../../src/continuity/renewalReadings.js');
type Spot = import('../../src/continuity/probes.js').SpotProbe;

const CLS = 'opus';
const AT = Date.UTC(2026, 5, 10, 12, 0, 0);
const measured = <T>(value: T) => ({ kind: 'measured' as const, value });
const unmeasured = (why: string) => ({ kind: 'unmeasured' as const, why });
const spots = (depthTokens: number, grade: Spot['grade'], n: number, over: Partial<Spot> = {}): Spot[] =>
  Array.from({ length: n }, (_, i) => ({ depthTokens, grade, closed: true, modelClass: CLS, at: AT + i, ...over }));
const read = (s: readonly Spot[]) => ({ ok: true as const, spots: s });

// ---------------------------------------------------------------------------------------------------------- fittedCeilingOf

export function fittedCeilingCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  const W200K = measured(200_000);
  return {
    'a class that is unknown reads unmeasured `model unknown`': () => {
      expect(m.fittedCeilingOf(null, W200K, read([]))).toEqual(unmeasured('model unknown'));
    },
    'an unmeasured window reads unmeasured with its own reason': () => {
      expect(m.fittedCeilingOf(CLS, unmeasured('usage stale'), read([]))).toEqual(unmeasured('usage stale'));
    },
    'a window that is not a positive size reads unmeasured': () => {
      expect(m.fittedCeilingOf(CLS, measured(0), read([]))).toEqual(unmeasured('window not a positive size'));
      expect(m.fittedCeilingOf(CLS, measured(-5), read([]))).toEqual(unmeasured('window not a positive size'));
    },
    'spots that could not be read read unmeasured with the detail': () => {
      expect(m.fittedCeilingOf(CLS, W200K, { ok: false, detail: 'locked' })).toEqual(unmeasured('probes unread: locked'));
    },
    'no closed spots: the hard cap of the window, measured though not fitted': () => {
      expect(m.fittedCeilingOf(CLS, W200K, read([]))).toEqual(measured(100_000));
      expect(m.fittedCeilingOf(CLS, measured(1_000_000), read([]))).toEqual(measured(250_000));
    },
    'a bad first depth bucket reads unmeasured `no depth holds`, never 0': () => {
      expect(m.fittedCeilingOf(CLS, measured(1_000_000), read(spots(SPOT_PROBE_EVERY_TOKENS, 'fail', FIT_WINDOW))))
        .toEqual(unmeasured('no depth holds'));
    },
    'a bad second bucket caps the ceiling below it': () => {
      const s = [...spots(SPOT_PROBE_EVERY_TOKENS, 'pass', FIT_WINDOW), ...spots(2 * SPOT_PROBE_EVERY_TOKENS, 'fail', FIT_WINDOW)];
      expect(m.fittedCeilingOf(CLS, measured(1_000_000), read(s))).toEqual(measured(SPOT_PROBE_EVERY_TOKENS));
    },
    'open-book and other-class spots are not counted (through fittedCeiling)': () => {
      const failing = spots(SPOT_PROBE_EVERY_TOKENS, 'fail', FIT_WINDOW);
      expect(m.fittedCeilingOf(CLS, measured(1_000_000), read(failing.map((s) => ({ ...s, closed: false }))))).toEqual(measured(250_000));
      expect(m.fittedCeilingOf(CLS, measured(1_000_000), read(failing.map((s) => ({ ...s, modelClass: 'sonnet' }))))).toEqual(measured(250_000));
    },
  };
}

const FITTED_CEILING_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'C1', old: ": unmeasured('no depth holds');", new: ": { kind: 'measured', value: 0 };" },
    { id: 'C2', old: "  if (w === null || w <= 0) return unmeasured('window not a positive size');\n", new: '' },
    { id: 'C3', old: "return c.kind === 'ceiling' ? {", new: "return c.kind === 'ceiling' && c.fitted ? {" },
    { id: 'C4', old: "if (modelClass === null) return unmeasured('model unknown');", new: "if (modelClass === null) return { kind: 'measured', value: 0 };" },
    { id: 'C5', old: "if (window.kind === 'unmeasured') return window;", new: "if (window.kind === 'unmeasured') return unmeasured('window');" },
    { id: 'C6', old: 'hardCapTokens(w)', new: 'w' },
  ],
  suite: fittedCeilingCases,
};

// ---------------------------------------------------------------------------------------------------------- the backstop

/** Fixed instants, each named by its UTC wall clock. 2026's last Sundays: March 29 and October 25 (Europe/Berlin's gap at
 *  02:00 CET and fold at 03:00 CEST). */
const utc = (mo: number, d: number, h: number, mi = 0, s = 0, ms = 0): number => Date.UTC(2026, mo - 1, d, h, mi, s, ms);
const H = 3_600_000;

export function backstopInstantCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'UTC 04:00: before the hour it is yesterday\'s, at and after the hour today\'s': () => {
      expect(m.backstopInstantBefore(utc(6, 10, 3, 59), 4, 'UTC')).toBe(utc(6, 9, 4));
      expect(m.backstopInstantBefore(utc(6, 10, 4), 4, 'UTC')).toBe(utc(6, 10, 4));
      expect(m.backstopInstantBefore(utc(6, 10, 4, 1), 4, 'UTC')).toBe(utc(6, 10, 4));
    },
    'a zone east of UTC (Asia/Tokyo, +9): 04:00 there is 19:00 UTC the day before': () => {
      expect(m.backstopInstantBefore(utc(6, 10, 0), 4, 'Asia/Tokyo')).toBe(utc(6, 9, 19));
      expect(m.backstopInstantBefore(utc(6, 9, 18, 59), 4, 'Asia/Tokyo')).toBe(utc(6, 8, 19));
    },
    'a zone west of UTC (America/New_York in June, -4): 04:00 there is 08:00 UTC': () => {
      expect(m.backstopInstantBefore(utc(6, 10, 7), 4, 'America/New_York')).toBe(utc(6, 9, 8));
      expect(m.backstopInstantBefore(utc(6, 10, 9), 4, 'America/New_York')).toBe(utc(6, 10, 8));
    },
    'the spring gap: 02:00 does not exist in Europe/Berlin on 2026-03-29, so the instant is the first after the gap': () => {
      expect(m.backstopInstantBefore(utc(3, 29, 12), 2, 'Europe/Berlin')).toBe(utc(3, 29, 1));
      // The hour after the gap reads the same instant (03:00 CEST is 01:00 UTC), and the day before reads 02:00 CET.
      expect(m.backstopInstantBefore(utc(3, 29, 12), 3, 'Europe/Berlin')).toBe(utc(3, 29, 1));
      expect(m.backstopInstantBefore(utc(3, 29, 0, 30), 2, 'Europe/Berlin')).toBe(utc(3, 28, 1));
    },
    'the autumn fold: 02:00 happens twice in Europe/Berlin on 2026-10-25, and the instant is the first': () => {
      expect(m.backstopInstantBefore(utc(10, 25, 12), 2, 'Europe/Berlin')).toBe(utc(10, 25, 0));
      expect(m.backstopInstantBefore(utc(10, 25, 0, 30), 2, 'Europe/Berlin')).toBe(utc(10, 25, 0));
      expect(m.backstopInstantBefore(utc(10, 24, 23, 59), 2, 'Europe/Berlin')).toBe(utc(10, 24, 0));
    },
    'a zone Intl cannot read answers null': () => {
      expect(m.backstopInstantBefore(utc(6, 10, 4), 4, 'Not/AZone')).toBeNull();
    },
    'the answer is never after now, and never more than a day and a gap before it': () => {
      for (const zone of ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Tokyo']) {
        for (let now = utc(1, 1, 0, 17, 3, 7); now < utc(12, 31, 0); now += 61 * H + 1_234) {
          for (const hour of [0, 2, 3, 4, 23]) {
            const at = m.backstopInstantBefore(now, hour, zone);
            expect(at, `${zone} ${hour} ${new Date(now).toISOString()}`).not.toBeNull();
            expect(at!, `${zone} ${hour} ${new Date(now).toISOString()}`).toBeLessThanOrEqual(now);
            expect(now - at!, `${zone} ${hour} ${new Date(now).toISOString()}`).toBeLessThan(26 * H);
          }
        }
      }
    },
  };
}

const BACKSTOP_INSTANT_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'B1', old: 'if (exact.length > 0) return Math.min(...exact);', new: 'if (exact.length > 0) return Math.max(...exact);' },
    { id: 'B2', old: '  return hi;\n}', new: '  return lo;\n}' },
    { id: 'B3', old: 'const today = Math.floor(wall(nowMs) / DAY_MS);', new: 'const today = Math.floor(wall(nowMs) / DAY_MS) - 1;' },
    { id: 'B4', old: 'if (at !== null && at <= nowMs) return at;', new: 'if (at !== null) return at;' },
    { id: 'B5', old: 'if (at !== null && at <= nowMs) return at;', new: 'if (at !== null && at < nowMs) return at;' },
    { id: 'B6', old: "timeZone: zone, hourCycle: 'h23',", new: "timeZone: 'UTC', hourCycle: 'h23'," },
    { id: 'B7', old: 'let lo = local - Math.max(...offsets);', new: 'let lo = local - Math.min(...offsets);' },
  ],
  suite: backstopInstantCases,
};

const ROW = (over: Partial<Extract<BackstopRead, { ok: true }>['backstop']> = {}): BackstopRead =>
  ({ ok: true, backstop: { hour: 4, zone: 'UTC', isDefault: true, setAt: 0, ...over } });

export function backstopDueCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  const now = utc(6, 10, 12);
  const instant = utc(6, 10, 4);
  return {
    'the row unread reads unmeasured with the detail': () => {
      expect(m.backstopDueOf({ ok: false, detail: 'no row' }, instant - H, now)).toEqual(unmeasured('backstop unread: no row'));
    },
    'a zone Intl cannot read reads unmeasured `zone unreadable`': () => {
      expect(m.backstopDueOf(ROW({ zone: 'Not/AZone' }), instant - H, now)).toEqual(unmeasured('zone unreadable'));
    },
    'a generation started before the latest instant is due': () => {
      expect(m.backstopDueOf(ROW(), instant - 1, now)).toEqual(measured(true));
    },
    'a generation started at or after the instant is not due': () => {
      expect(m.backstopDueOf(ROW(), instant, now)).toEqual(measured(false));
      expect(m.backstopDueOf(ROW(), instant + 1, now)).toEqual(measured(false));
    },
    'the hour and the zone are the row\'s: 13:00 UTC has not come at noon, so yesterday\'s is the instant': () => {
      expect(m.backstopDueOf(ROW({ hour: 13 }), utc(6, 9, 14), now)).toEqual(measured(false));
      expect(m.backstopDueOf(ROW({ hour: 13 }), utc(6, 9, 12), now)).toEqual(measured(true));
      expect(m.backstopDueOf(ROW({ zone: 'America/New_York' }), utc(6, 10, 7), now)).toEqual(measured(true));
    },
  };
}

const BACKSTOP_DUE_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'D1', old: "value: startReportedAt < instant }", new: "value: startReportedAt <= instant }" },
    { id: 'D2', old: "if (instant === null) return unmeasured('zone unreadable');", new: "if (instant === null) return { kind: 'measured', value: false };" },
    { id: 'D3', old: 'if (!b.ok) return unmeasured(`backstop unread: ${b.detail}`);', new: "if (!b.ok) return { kind: 'measured', value: false };" },
    { id: 'D4', old: 'backstopInstantBefore(nowMs, b.backstop.hour, b.backstop.zone)', new: 'backstopInstantBefore(nowMs, 4, b.backstop.zone)' },
  ],
  suite: backstopDueCases,
};

export const RENEWAL_READING_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/renewalReadings.ts#fittedCeilingOf': FITTED_CEILING_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#backstopInstantBefore': BACKSTOP_INSTANT_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#backstopDueOf': BACKSTOP_DUE_SET as MutantSet<never>,
};
