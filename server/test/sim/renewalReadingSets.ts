// The renewal readings' oracles and mutant sets (Overlord W1, plan `w1-renewal-readings.md`, PR A: Tasks 1 and 2). Each
// decider's cases are written ONCE here, as suite cases over a module: `continuity-renewal-readings.test.ts` runs them
// against the real module, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
// A later pull request of the plan adds its mappers' cases and sets here (PR C: the designation's readings, the class a mint
// stamps, and the probes-failed-twice decider; PR B: `notLocalOf`).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { FIT_WINDOW, SPOT_PROBE_EVERY_TOKENS, type StartSource } from '../../../shared/continuity.js';
import type { BackstopRead } from '../../../shared/renewal-readings.js';
import type { DesignationRead, DesignationView } from '../../../shared/overlord-designation.js';
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

// ------------------------------------------------------------------------------------------ the designation's readings (PR C)

/** A designation row bound to `lane-a-project-a` (the session the fixtures name), at term 3, class `fable`. */
const SID = 'lane-a-project-a';
const VIEW = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: { sessionId: SID, generation: 'g1' }, pending: null, term: 3, designatedTerm: 3, model: 'fable',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'device:console-a', lastAttempt: null, stopsOwed: [], ...over,
});
const BOUND = (over: Partial<DesignationView> = {}): DesignationRead => {
  const row = VIEW(over);
  return { kind: 'designated', sessionId: row.bound?.sessionId ?? SID, term: row.term, row };
};
const OTHER = 'lane-b-project-a';
const NONE: DesignationRead = { kind: 'not-designated', row: null };
const UNREAD: DesignationRead = { kind: 'unmeasured', why: 'a term is not a count' };
const PENDING_DESIGNATE: DesignationRead = {
  kind: 'not-designated',
  row: VIEW({ bound: null, pending: { sessionId: SID, kind: 'designate', deadlineAt: AT + 60_000, since: AT, actor: 'device:console-a', generation: null } }),
};

export function termRaisedCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'an unmeasured designation reads unmeasured `designation unreadable`': () => {
      expect(m.termRaisedOf(UNREAD, { sessionId: SID, term: 3 })).toEqual(unmeasured('designation unreadable'));
    },
    'no designation, or a pending one: measured false (the row does not apply)': () => {
      expect(m.termRaisedOf(NONE, { sessionId: SID, term: 1 })).toEqual(measured(false));
      expect(m.termRaisedOf(PENDING_DESIGNATE, { sessionId: SID, term: 1 })).toEqual(measured(false));
    },
    'a designation bound to another session (a rebind ended this one) reads false, whatever the terms': () => {
      expect(m.termRaisedOf(BOUND({ bound: { sessionId: OTHER, generation: 'g2' }, term: 9 }), { sessionId: SID, term: 3 }))
        .toEqual(measured(false));
    },
    'bound to this session at the same term: false': () => {
      expect(m.termRaisedOf(BOUND(), { sessionId: SID, term: 3 })).toEqual(measured(false));
    },
    'a restore that raised the term above the one the generation was minted under: due': () => {
      expect(m.termRaisedOf(BOUND({ term: 4 }), { sessionId: SID, term: 3 })).toEqual(measured(true));
    },
    'a generation stamped with a later term than the row reads: false': () => {
      expect(m.termRaisedOf(BOUND({ term: 3 }), { sessionId: SID, term: 5 })).toEqual(measured(false));
    },
  };
}

const TERM_RAISED_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'T1', old: 'value: b.term > g.term }', new: 'value: b.term >= g.term }' },
    { id: 'T2', old: "  if (b === false) return { kind: 'measured', value: false };\n  if (b.kind === 'unmeasured') return b;\n  return { kind: 'measured', value: b.term",
      new: "  if (b === false) return { kind: 'measured', value: true };\n  if (b.kind === 'unmeasured') return b;\n  return { kind: 'measured', value: b.term" },
    { id: 'T3', old: "return d.kind === 'designated' && d.sessionId === sessionId ? d : false;", new: "return d.kind === 'designated' ? d : false;" },
    { id: 'T4', old: "if (d.kind === 'unmeasured') return { kind: 'unmeasured', why: 'designation unreadable' };", new: "if (d.kind === 'unmeasured') return false;" },
  ],
  suite: termRaisedCases,
};

export function classChangedCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'an unmeasured designation reads unmeasured `designation unreadable`': () => {
      expect(m.classChangedOf(UNREAD, { sessionId: SID, designatedClass: 'fable' })).toEqual(unmeasured('designation unreadable'));
    },
    'no designation, or one bound to another session: measured false': () => {
      expect(m.classChangedOf(NONE, { sessionId: SID, designatedClass: null })).toEqual(measured(false));
      expect(m.classChangedOf(BOUND({ bound: { sessionId: OTHER, generation: 'g2' }, model: 'opus' }), { sessionId: SID, designatedClass: 'fable' }))
        .toEqual(measured(false));
    },
    'a generation minted before the class was recorded reads unmeasured, never a default': () => {
      expect(m.classChangedOf(BOUND(), { sessionId: SID, designatedClass: null })).toEqual(unmeasured('minted before the class was recorded'));
    },
    'the class unchanged since the mint: false': () => {
      expect(m.classChangedOf(BOUND({ model: 'fable' }), { sessionId: SID, designatedClass: 'fable' })).toEqual(measured(false));
    },
    'the operator changed the class after the mint: due': () => {
      expect(m.classChangedOf(BOUND({ model: 'opus' }), { sessionId: SID, designatedClass: 'fable' })).toEqual(measured(true));
    },
    'a fallback generation (running opus, designated fable, unchanged) reads false: the running class is no input': () => {
      const fallback = { sessionId: SID, designatedClass: 'fable', model: 'claude-opus-5-5' };
      expect(m.classChangedOf(BOUND({ model: 'fable' }), fallback)).toEqual(measured(false));
    },
  };
}

const CLASS_CHANGED_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'K1', old: "  if (g.designatedClass === null) return unmeasured('minted before the class was recorded');\n", new: '' },
    { id: 'K2', old: "if (g.designatedClass === null) return unmeasured('minted before the class was recorded');", new: "if (g.designatedClass === null) return { kind: 'measured', value: false };" },
    { id: 'K3', old: 'value: b.row.model !== g.designatedClass }', new: 'value: b.row.model === g.designatedClass }' },
    { id: 'K4', old: "  if (b === false) return { kind: 'measured', value: false };\n  if (b.kind === 'unmeasured') return b;\n  if (g.designatedClass",
      new: "  if (b === false) return { kind: 'measured', value: true };\n  if (b.kind === 'unmeasured') return b;\n  if (g.designatedClass" },
    // Only the fallback fixture supplies a running model; keep the other cases' inputs as given.
    { id: 'K5', old: 'value: b.row.model !== g.designatedClass };\n}',
      new: "value: b.row.model !== ('model' in g && typeof g.model === 'string' ? familyClassOf(g.model) : g.designatedClass) };\n}\nimport { familyClassOf } from '../../../shared/models.js';" },
  ],
  suite: classChangedCases,
};

export function designatedClassCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'the Overlord minted under a live binding stamps the row class': () => {
      expect(m.designatedClassAtMint(BOUND({ model: 'opus' }), 'overlord')).toBe('opus');
    },
    'the Overlord minted under a pending designate stamps the row class': () => {
      expect(m.designatedClassAtMint(PENDING_DESIGNATE, 'overlord')).toBe('fable');
    },
    'any other identity (a coordinator, a rebind body under its own id) stamps null': () => {
      expect(m.designatedClassAtMint(BOUND(), SID)).toBeNull();
      expect(m.designatedClassAtMint(BOUND(), OTHER)).toBeNull();
    },
    'an unmeasured designation, or none, stamps null': () => {
      expect(m.designatedClassAtMint(UNREAD, 'overlord')).toBeNull();
      expect(m.designatedClassAtMint(NONE, 'overlord')).toBeNull();
    },
  };
}

const DESIGNATED_CLASS_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'M1', old: "if (identity !== 'overlord' || d.kind === 'unmeasured' || d.row === null) return null;", new: "if (d.kind === 'unmeasured' || d.row === null) return null;" },
    { id: 'M2', old: '  return d.row.model;\n}', new: '  return null;\n}' },
  ],
  suite: designatedClassCases,
};

/** The step `probing` to `degraded` on a second failed round, live, for the Overlord: the one case that latches. */
const TWICE = {
  role: 'overlord' as const, from: 'probing' as const, event: { kind: 'probes', passed: false } as const, view: { probeRounds: 1 },
  next: 'degraded' as const, column: 'state' as const,
};

export function probesFailedTwiceCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'a live Overlord step from probing to degraded on a second failed round latches': () => {
      expect(m.probesFailedTwiceOf(TWICE)).toBe(true);
    },
    'a shadow walk never latches': () => {
      expect(m.probesFailedTwiceOf({ ...TWICE, column: 'shadowState' })).toBe(false);
    },
    'a coordinator never latches': () => {
      expect(m.probesFailedTwiceOf({ ...TWICE, role: 'coordinator' })).toBe(false);
    },
    'a first failed round does not latch, nor the post-step row that degrade left at 0': () => {
      expect(m.probesFailedTwiceOf({ ...TWICE, view: { probeRounds: 0 }, next: 'probing' })).toBe(false);
      expect(m.probesFailedTwiceOf({ ...TWICE, view: { probeRounds: 0 } })).toBe(false);
    },
    'a deadline in probing is not two failed probes': () => {
      expect(m.probesFailedTwiceOf({ ...TWICE, event: { kind: 'deadline' } })).toBe(false);
    },
    'even if the step lands on degraded, a passed round does not latch': () => {
      expect(m.probesFailedTwiceOf({ ...TWICE, event: { kind: 'probes', passed: true } })).toBe(false);
    },
    'a step from another state, or to another state, does not latch': () => {
      expect(m.probesFailedTwiceOf({ ...TWICE, from: 'carded' })).toBe(false);
      expect(m.probesFailedTwiceOf({ ...TWICE, next: 'probing' })).toBe(false);
    },
  };
}

const PROBES_FAILED_TWICE_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'P1', old: " && i.column === 'state'", new: '' },
    { id: 'P2', old: "i.event.kind === 'probes' && !i.event.passed", new: "(i.event.kind === 'probes' ? !i.event.passed : i.event.kind === 'deadline')" },
    { id: 'P3', old: 'i.view.probeRounds >= 1', new: 'i.view.probeRounds > 1' },
    { id: 'P4', old: "i.role === 'overlord' && ", new: '' },
    { id: 'P5', old: 'i.view.probeRounds >= 1', new: 'i.view.probeRounds >= 0' },
    { id: 'P6', old: " && i.next === 'degraded'", new: '' },
    { id: 'P7', old: ' && !i.event.passed', new: '' },
  ],
  suite: probesFailedTwiceCases,
};

// ---------------------------------------------------------------------------------------------------- notLocalOf (PR B)

type NotLocalIn = Parameters<RenewalReadingsModule['notLocalOf']>[0];
type TurnRead = NotLocalIn['turn'];
const START_AT = AT - H;
const START_UUID = '11111111-2222-3333-4444-555555555555';
const startRead = (source: StartSource): NotLocalIn['start'] => ({ ok: true, row: {
  id: 7, sessionId: SID, reportId: 'r-7', uuid: START_UUID, source, model: 'claude-opus-5-5',
  rowIncarnation: null, reportedAt: START_AT, receivedAt: START_AT,
} });
const KEY = { digest: 'a'.repeat(64), keyEpoch: 3 };
/** An asked answer: from a fresh walk unless `fresh` is false (served from the resolver's memory), observed at `AT`. */
const asked = (answer: Extract<NotLocalIn['ask'], { kind: 'asked' }>['answer'], fresh = true, observedAt = AT): NotLocalIn['ask'] =>
  ({ kind: 'asked', answer, fresh, observedAt });
const FOUND = asked({ kind: 'found' });
const ABSENT = asked({ kind: 'fallback', complete: true });
const INCOMPLETE = asked({ kind: 'fallback', complete: false });
/** A turn marker whose last event (`at`) is its stop, or the start when it has none. */
const mark = (state: 'working' | 'done' | 'failed', stopAt: number | null, at = stopAt ?? START_AT): TurnRead => ({
  ok: true, sessionId: SID, state, event: 'Stop', at, turnAt: null, stopAt, bg: 0, bgKinds: [], bgIds: [], err: null,
  restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: null, graceUntil: null,
});
/** No turn in this generation: the last stop was before its start. */
const QUIET = mark('done', START_AT - 1);
const TURNED = mark('done', START_AT + 60_000);
const NL = (over: Partial<NotLocalIn> = {}): NotLocalIn =>
  ({ ask: ABSENT, start: startRead('startup'), before: KEY, after: KEY, turn: QUIET, startReportedAt: START_AT, ...over });

export function notLocalCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'the start unread, or no row for the start id, reads unmeasured, whatever the transcript says': () => {
      expect(m.notLocalOf(NL({ start: { ok: false, detail: 'locked' }, ask: FOUND }))).toEqual(unmeasured('start unread: locked'));
      expect(m.notLocalOf(NL({ start: { ok: true, row: null }, ask: ABSENT, turn: TURNED }))).toEqual(unmeasured('start row absent'));
    },
    'an ask that was never made reads unmeasured with its own reason': () => {
      expect(m.notLocalOf(NL({ ask: { kind: 'unread', why: 'identity unmeasured' }, turn: TURNED }))).toEqual(unmeasured('identity unmeasured'));
    },
    'a carrier that could not be read on either side of the ask reads unmeasured `host unmeasured`': () => {
      expect(m.notLocalOf(NL({ before: 'unmeasured', ask: FOUND }))).toEqual(unmeasured('host unmeasured'));
      expect(m.notLocalOf(NL({ after: 'unmeasured', start: startRead('resume') }))).toEqual(unmeasured('host unmeasured'));
    },
    'a carrier that changed during the read, digest or key epoch, reads unmeasured': () => {
      expect(m.notLocalOf(NL({ after: { ...KEY, digest: 'b'.repeat(64) }, start: startRead('resume') })))
        .toEqual(unmeasured('host changed during the read'));
      expect(m.notLocalOf(NL({ after: { ...KEY, keyEpoch: 4 }, start: startRead('resume') })))
        .toEqual(unmeasured('host changed during the read'));
    },
    'a found transcript is local, for any source and after any turn, from the memory or a fresh walk': () => {
      for (const source of ['startup', 'resume', 'compact', 'clear', 'other'] as const) {
        expect(m.notLocalOf(NL({ ask: FOUND, start: startRead(source), turn: TURNED })), source).toEqual(measured(false));
        expect(m.notLocalOf(NL({ ask: asked({ kind: 'found' }, false), start: startRead(source), turn: TURNED })), source).toEqual(measured(false));
      }
    },
    'a search that could not look everywhere reads unmeasured, never not local, even after a turn': () => {
      expect(m.notLocalOf(NL({ ask: INCOMPLETE, turn: TURNED }))).toEqual(unmeasured('transcript search incomplete'));
      expect(m.notLocalOf(NL({ ask: INCOMPLETE, start: startRead('resume') }))).toEqual(unmeasured('transcript search incomplete'));
    },
    'an absence served from the resolver\'s memory is never believed, for any source and after any turn (F1)': () => {
      const held = asked({ kind: 'fallback', complete: true }, false);
      for (const source of ['startup', 'resume', 'compact', 'clear'] as const) {
        expect(m.notLocalOf(NL({ ask: held, start: startRead(source), turn: TURNED })), source)
          .toEqual(unmeasured('absence not confirmed by a fresh walk'));
      }
    },
    'a resumed or compacted conversation that is absent on a fresh walk is not local at once, before any turn and with no marker': () => {
      for (const source of ['resume', 'compact'] as const) {
        expect(m.notLocalOf(NL({ start: startRead(source) })), source).toEqual(measured(true));
        expect(m.notLocalOf(NL({ start: startRead(source), turn: { ok: false, reason: 'absent' } })), source).toEqual(measured(true));
      }
    },
    'a fresh start that is absent reads its turn marker: unread is unmeasured with the reason': () => {
      expect(m.notLocalOf(NL({ turn: { ok: false, reason: 'absent' } }))).toEqual(unmeasured('turn marker absent'));
      expect(m.notLocalOf(NL({ start: startRead('clear'), turn: { ok: false, reason: 'malformed' } }))).toEqual(unmeasured('turn marker malformed'));
    },
    'a fresh start that is absent with no turn of its own stopped is still local (nothing written yet)': () => {
      for (const source of ['startup', 'clear', 'other', 'fork'] as const) {
        expect(m.notLocalOf(NL({ start: startRead(source) })), source).toEqual(measured(false));
        expect(m.notLocalOf(NL({ start: startRead(source), turn: mark('done', null) })), source).toEqual(measured(false));
      }
    },
    'a first turn still running reads unmeasured: its first append may not have landed yet (F1, the race)': () => {
      expect(m.notLocalOf(NL({ turn: mark('working', null) }))).toEqual(unmeasured('first turn still running'));
      expect(m.notLocalOf(NL({ turn: mark('working', START_AT - 1) }))).toEqual(unmeasured('first turn still running'));
    },
    'a fresh start that is absent after a turn of its own stopped is not local, a later turn running too, and a stop at the start is after it': () => {
      expect(m.notLocalOf(NL({ turn: TURNED }))).toEqual(measured(true));
      expect(m.notLocalOf(NL({ turn: mark('working', START_AT + 60_000, START_AT + 120_000) }))).toEqual(measured(true));
      expect(m.notLocalOf(NL({ turn: mark('failed', START_AT) }))).toEqual(measured(true));
    },
    'an absence observed no later than the turn marker\'s last event is not believed (F1)': () => {
      expect(m.notLocalOf(NL({ turn: mark('done', START_AT + 60_000, AT) }))).toEqual(unmeasured('absence older than the turn marker'));
      expect(m.notLocalOf(NL({ turn: mark('done', START_AT + 60_000, AT + 1) }))).toEqual(unmeasured('absence older than the turn marker'));
      expect(m.notLocalOf(NL({ turn: mark('done', START_AT + 60_000, AT - 1) }))).toEqual(measured(true));
    },
  };
}

const NOT_LOCAL_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'L1', old: "if (!a.complete) return unmeasured('transcript search incomplete');", new: "if (!a.complete) return { kind: 'measured', value: true };" },
    { id: 'L2', old: "if (a.kind === 'found') return { kind: 'measured', value: false };", new: '' },
    { id: 'L3', old: "  if (!i.turn.ok) return unmeasured(`turn marker ${i.turn.reason}`);\n", new: "  if (!i.turn.ok) return { kind: 'measured', value: true };\n" },
    { id: 'L4', old: "i.start.row.source === 'resume' || i.start.row.source === 'compact'", new: 'false' },
    { id: 'L5', old: "i.start.row.source === 'resume' || i.start.row.source === 'compact'", new: 'true' },
    { id: 'L6', old: ' || i.before.keyEpoch !== i.after.keyEpoch', new: '' },
    { id: 'L7', old: "if (i.before === 'unmeasured' || i.after === 'unmeasured') return unmeasured('host unmeasured');", new: "if (i.before === 'unmeasured' && i.after === 'unmeasured') return unmeasured('host unmeasured');" },
    { id: 'L8', old: 'i.turn.stopAt < i.startReportedAt', new: 'i.turn.stopAt <= i.startReportedAt' },
    { id: 'L9', old: "return i.turn.state === 'working' ? unmeasured('first turn still running') : { kind: 'measured', value: false };", new: "return { kind: 'measured', value: i.turn.state === 'working' };" },
    { id: 'L10', old: "  if (i.ask.kind === 'unread') return unmeasured(i.ask.why);\n", new: "  if (i.ask.kind === 'unread') return { kind: 'measured', value: false };\n" },
    { id: 'L11', old: "  if (i.start.row === null) return unmeasured('start row absent');\n", new: '  if (i.start.row === null) return { kind: \'measured\', value: false };\n' },
    { id: 'L12', old: 'if (i.turn.stopAt === null || i.turn.stopAt < i.startReportedAt) {', new: 'if (false) {' },
    { id: 'L13', old: "  if (!i.ask.fresh) return unmeasured('absence not confirmed by a fresh walk');\n", new: '' },
    { id: 'L14', old: "  if (i.turn.at >= i.ask.observedAt) return unmeasured('absence older than the turn marker');\n", new: '' },
    { id: 'L15', old: 'i.turn.at >= i.ask.observedAt', new: 'i.turn.at > i.ask.observedAt' },
  ],
  suite: notLocalCases,
};

// ------------------------------------------------------------------------------------------------ notLocalAskOf (PR B, F2)

type AskIn = Parameters<RenewalReadingsModule['notLocalAskOf']>[0];
const ASK = (over: Partial<AskIn> = {}): AskIn => ({ startUuid: START_UUID, who: { uuid: START_UUID, account: 'lane-a' }, lane: 'lane-a', ...over });
const notAsked = (why: string) => ({ kind: 'unread' as const, why });

export function notLocalAskCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'a registry row that agrees with the generation asks the generation\'s account for the start\'s conversation': () => {
      expect(m.notLocalAskOf(ASK())).toEqual({ kind: 'ask', account: 'lane-a', uuid: START_UUID });
    },
    'no registry row, or an unmeasured identity, is not asked': () => {
      expect(m.notLocalAskOf(ASK({ who: 'no-row' }))).toEqual(notAsked('no registry row'));
      expect(m.notLocalAskOf(ASK({ who: 'unmeasured' }))).toEqual(notAsked('identity unmeasured'));
    },
    'a generation whose account is unknown is not asked': () => {
      expect(m.notLocalAskOf(ASK({ lane: null }))).toEqual(notAsked('generation account unknown'));
    },
    'a registry row on another account than the generation\'s is not asked (a swap in flight, F2)': () => {
      expect(m.notLocalAskOf(ASK({ who: { uuid: START_UUID, account: 'lane-b' } }))).toEqual(notAsked("registry account differs from the generation's"));
    },
    'a registry row on another conversation than the start\'s is not asked (F2)': () => {
      expect(m.notLocalAskOf(ASK({ who: { uuid: '99999999-2222-3333-4444-555555555555', account: 'lane-a' } })))
        .toEqual(notAsked("registry conversation differs from the start's"));
    },
  };
}

const NOT_LOCAL_ASK_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'A1', old: "  if (i.who.account !== i.lane) return { kind: 'unread', why: \"registry account differs from the generation's\" };\n", new: '' },
    { id: 'A2', old: "  if (i.who.uuid !== i.startUuid) return { kind: 'unread', why: \"registry conversation differs from the start's\" };\n", new: '' },
    { id: 'A3', old: "  if (i.lane === null) return { kind: 'unread', why: 'generation account unknown' };\n", new: '' },
    { id: 'A4', old: "  if (i.who === 'unmeasured') return { kind: 'unread', why: 'identity unmeasured' };\n", new: '' },
  ],
  suite: notLocalAskCases,
};

export const RENEWAL_READING_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/renewalReadings.ts#notLocalOf': NOT_LOCAL_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#notLocalAskOf': NOT_LOCAL_ASK_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#fittedCeilingOf': FITTED_CEILING_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#backstopInstantBefore': BACKSTOP_INSTANT_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#backstopDueOf': BACKSTOP_DUE_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#termRaisedOf': TERM_RAISED_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#classChangedOf': CLASS_CHANGED_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#designatedClassAtMint': DESIGNATED_CLASS_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#probesFailedTwiceOf': PROBES_FAILED_TWICE_SET as MutantSet<never>,
};
