// The renewal deciders' oracles and mutant sets (Overlord W1a, renewal deciders plan). Each decider's exhaustive cases
// are written ONCE here, as suite cases over a module: its own test file runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors). A new decider of this
// plan adds its cases and its set here, and nothing else in the floors file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { RUN_KINDS, type ChildMark } from '../../../shared/api.js';
import { FLEET_ROLE_NAMES } from '../../../shared/fleetRoles.js';
import type { RoleFactInputs, RoleReading } from '../../src/roleOf.js';
import type { MutantSet, SuiteCase } from './mutate.js';
import { mulberry32 } from '../fakeTime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------------------------------------------------------------------------------------------------------- roleFactsOf

export type RoleOfModule = typeof import('../../src/roleOf.js');

const ROLE_ID = 'project-a-lane-a';
const CHILD7: ChildMark = { kind: 'child', runId: 7 };

/** Every combination of the inputs: three child marks, four run kinds, three open sets, three intents (108). */
export function roleFactInputCases(): RoleFactInputs[] {
  const opens = [new Set([ROLE_ID, 'other']), new Set(['other']), 'unmeasured'] as const;
  const out: RoleFactInputs[] = [];
  for (const child of [{ kind: 'none' }, CHILD7, { kind: 'unreadable' }] as ChildMark[])
    for (const childRunKind of [...RUN_KINDS, 'unmeasured'] as const)
      for (const openCoordinators of opens)
        for (const intentDeclared of [true, false, 'unmeasured'] as const) out.push({ child, childRunKind, openCoordinators, intentDeclared });
  return out;
}

const roleIs = (role: Extract<RoleReading, { kind: 'role' }>['role']): RoleReading => ({ kind: 'role', role });
const undecided = (between: Extract<RoleReading, { kind: 'undecided' }>['between']): RoleReading => ({ kind: 'undecided', between });

/** Table 3.3.9a and the undecided rules, written out from the spec's words rather than from `roleOf`'s code. */
export function expectedRole(i: RoleFactInputs): RoleReading {
  const claims = i.openCoordinators === 'unmeasured' ? 'unmeasured' : i.openCoordinators.has(ROLE_ID);
  if (i.child.kind === 'unreadable') return undecided('worker-or-reviewer');
  if (i.child.kind === 'child') {
    return i.childRunKind === 'work' ? roleIs('worker') : i.childRunKind === 'review' ? roleIs('reviewer') : undecided('worker-or-reviewer');
  }
  if (claims === true || i.intentDeclared === true) return roleIs('coordinator');
  if (claims === false && i.intentDeclared === false) return roleIs('plain');
  return undecided('coordinator-or-plain');
}

const show = (i: RoleFactInputs): string =>
  JSON.stringify({ ...i, openCoordinators: i.openCoordinators === 'unmeasured' ? 'unmeasured' : [...i.openCoordinators] });

export function roleFactsOfCases(m: RoleOfModule): Record<string, SuiteCase> {
  const cases = roleFactInputCases();
  return {
    'enumerates 108 cases': () => { expect(cases.length).toBe(108); },
    'roleOf(roleFactsOf(...)) answers Table 3.3.9a and the undecided rules for every case': () => {
      for (const i of cases) expect(m.roleOf(m.roleFactsOf(ROLE_ID, i)), show(i)).toEqual(expectedRole(i));
    },
    'the facts whose readers come later are fixed, and the run kind is read only for a child': () => {
      for (const i of cases) {
        const f = m.roleFactsOf(ROLE_ID, i);
        expect([f.designation, f.auditBody, f.replayBody], show(i)).toEqual(['none', false, false]);
        expect(f.child, show(i)).toBe(i.child);
        expect(f.childRunKind, show(i)).toBe(i.child.kind === 'child' ? i.childRunKind : 'unmeasured');
      }
    },
    'membership and intent map to the three words, and an unmeasured fact never reads no': () => {
      const base: RoleFactInputs = { child: { kind: 'none' }, childRunKind: 'unmeasured', openCoordinators: 'unmeasured', intentDeclared: 'unmeasured' };
      expect(m.roleFactsOf(ROLE_ID, base)).toMatchObject({ claimsOpenRun: 'unmeasured', declaredIntent: 'unmeasured' });
      expect(m.roleFactsOf(ROLE_ID, { ...base, openCoordinators: new Set([ROLE_ID]), intentDeclared: true }))
        .toMatchObject({ claimsOpenRun: 'yes', declaredIntent: 'yes' });
      expect(m.roleFactsOf(ROLE_ID, { ...base, openCoordinators: new Set(['other']), intentDeclared: false }))
        .toMatchObject({ claimsOpenRun: 'no', declaredIntent: 'no' });
    },
  };
}

const ROLE_FACTS_SET: MutantSet<RoleOfModule> = {
  modulePath: path.join(ROOT, 'server/src/roleOf.ts'),
  mutants: [
    { id: 'R1', old: "childRunKind: i.child.kind === 'child' ? i.childRunKind : 'unmeasured',", new: 'childRunKind: i.childRunKind,' },
    { id: 'R2', old: "i.openCoordinators === 'unmeasured' ? 'unmeasured' : word(", new: "i.openCoordinators === 'unmeasured' ? 'no' : word(" },
    { id: 'R3', old: "v ? 'yes' : 'no'", new: "v ? 'yes' : 'unmeasured'" },
    { id: 'R4', old: 'declaredIntent: word(i.intentDeclared),', new: "declaredIntent: 'unmeasured'," },
    { id: 'R5', old: 'word(i.openCoordinators.has(sessionId))', new: 'word(i.openCoordinators.size > 0)' },
  ],
  suite: roleFactsOfCases,
};

// ---------------------------------------------------------------------------------------------------------- observeTime

export type ObservedModule = typeof import('../../src/time/observed.js');

export function observeTimeCases(m: ObservedModule): Record<string, SuiteCase> {
  const CAP = 60_000;   // twice a 30 s lane's period: observedStepCapMs(30_000)
  const step = (prev: import('../../src/time/observed.js').Observed | null, mono: number, proc: string): unknown =>
    m.observeTime(prev, mono, proc, CAP);
  return {
    'null starts at 0, anchored at the mono reading and the process, with no gap': () => {
      expect(step(null, 5_000, 'p1')).toEqual({ at: { ms: 0, mono: 5_000, proc: 'p1' }, gap: null });
    },
    'the same process, forward: advances by the monotonic delta': () => {
      expect(step({ ms: 0, mono: 1_000, proc: 'p1' }, 4_500, 'p1')).toEqual({ at: { ms: 3_500, mono: 4_500, proc: 'p1' }, gap: null });
      expect(step({ ms: 3_500, mono: 4_500, proc: 'p1' }, 4_500, 'p1')).toEqual({ at: { ms: 3_500, mono: 4_500, proc: 'p1' }, gap: null });
      expect(step({ ms: 0, mono: 0, proc: 'p1' }, CAP, 'p1')).toEqual({ at: { ms: CAP, mono: CAP, proc: 'p1' }, gap: null });
    },
    'observedStepCapMs: two periods of the lane, so a 30 s lane\'s cap is 60 s': () => {
      expect([m.observedStepCapMs(30_000), m.observedStepCapMs(45_000)]).toEqual([CAP, 90_000]);
    },
    'a frozen process: a 10-minute delta advances by the cap only, and is a step gap carrying its delta (F1)': () => {
      expect(step({ ms: 100, mono: 1_000, proc: 'p1' }, 1_000 + 600_000, 'p1'))
        .toEqual({ at: { ms: 100 + CAP, mono: 601_000, proc: 'p1' }, gap: { kind: 'step', deltaMs: 600_000 } });
      expect(step({ ms: 0, mono: 0, proc: 'p1' }, CAP + 1, 'p1'))
        .toEqual({ at: { ms: CAP, mono: CAP + 1, proc: 'p1' }, gap: { kind: 'step', deltaMs: CAP + 1 } });
    },
    'a cap that is not a finite positive number advances nothing, and answers a step gap (F5)': () => {
      for (const cap of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -5]) {
        expect(m.observeTime({ ms: 40, mono: 1_000, proc: 'p1' }, 11_000, 'p1', cap), String(cap))
          .toEqual({ at: { ms: 40, mono: 11_000, proc: 'p1' }, gap: { kind: 'step', deltaMs: 10_000 } });
      }
      expect(m.observeTime({ ms: 40, mono: 1_000, proc: 'p1' }, 1_000, 'p1', Number.NaN).at.ms).toBe(40);
    },
    'a new process: no advance, re-anchored on the new reading, a gap': () => {
      const a = { ms: 10_000, mono: 90_000, proc: 'p1' };
      expect(step(a, 95_000, 'p2')).toEqual({ at: { ms: 10_000, mono: 95_000, proc: 'p2' }, gap: { kind: 'process', deltaMs: 5_000 } });
      expect(step(a, 200, 'p2')).toEqual({ at: { ms: 10_000, mono: 200, proc: 'p2' }, gap: { kind: 'process', deltaMs: -89_800 } });
    },
    'mono backwards in one process: no advance, re-anchored, a gap': () => {
      expect(step({ ms: 7, mono: 50, proc: 'p1' }, 40, 'p1')).toEqual({ at: { ms: 7, mono: 40, proc: 'p1' }, gap: { kind: 'backwards', deltaMs: -10 } });
    },
    'a mono that is not a number never advances, and the next reading re-anchors': () => {
      const a = m.observeTime({ ms: 7, mono: 50, proc: 'p1' }, Number.NaN, 'p1', CAP);
      expect([a.at.ms, a.gap]).toEqual([7, { kind: 'backwards', deltaMs: Number.NaN }]);
      expect(m.observeTime(a.at, 80, 'p1', CAP).at.ms).toBe(7);
    },
    'observedSince counts the observed milliseconds between two stamps, never below 0': () => {
      const s0 = { ms: 1_000, mono: 0, proc: 'p1' };
      expect(m.observedSince(s0, { ms: 4_000, mono: 3_000, proc: 'p1' })).toBe(3_000);
      expect(m.observedSince(s0, { ms: 1_000, mono: 9, proc: 'p2' })).toBe(0);
      expect(m.observedSince({ ms: 5_000, mono: 0, proc: 'p1' }, s0)).toBe(0);
    },
    'PROPERTY (1,000 seeded runs): ms never decreases and never exceeds the in-process forward deltas, each capped': () => {
      for (let seed = 1; seed <= 1_000; seed++) {
        const r = mulberry32(seed);
        let proc = 'p0'; let mono = Math.floor(r() * 1e6); let o = m.observeTime(null, mono, proc, CAP).at; let bound = 0; let pnum = 0;
        for (let k = 0; k < 40; k++) {
          const x = r();
          const prev = o; const prevMono = mono; const prevProc = proc;
          if (x < 0.15) { proc = `p${++pnum}`; mono = Math.floor(r() * 1e6); }
          else if (x < 0.25) mono = Math.max(0, mono - Math.floor(r() * 5_000));
          else if (x < 0.35) mono += 60_000 + Math.floor(r() * 3_600_000);   // a freeze
          else mono += Math.floor(r() * 100_000);
          if (proc === prevProc && mono >= prevMono) bound += Math.min(CAP, mono - prevMono);
          const st = m.observeTime(prev, mono, proc, CAP);
          o = st.at;
          if (o.ms < prev.ms) throw new Error(`seed ${seed} step ${k}: ms fell from ${prev.ms} to ${o.ms}`);
          if (o.ms > bound) throw new Error(`seed ${seed} step ${k}: ms ${o.ms} exceeds the capped forward deltas ${bound}`);
          if (o.ms - prev.ms > CAP) throw new Error(`seed ${seed} step ${k}: one step advanced ${o.ms - prev.ms}, past the cap`);
          if (o.mono !== mono || o.proc !== proc) throw new Error(`seed ${seed} step ${k}: not re-anchored on the reading`);
        }
      }
    },
  };
}

const OBSERVED_SET: MutantSet<ObservedModule> = {
  modulePath: path.join(ROOT, 'server/src/time/observed.ts'),
  mutants: [
    { id: 'O1', old: "if (prev.proc !== proc) return { at: { ms: prev.ms, mono, proc }, gap: { kind: 'process', deltaMs } };", new: '' },
    { id: 'O2', old: "if (!(mono >= prev.mono)) return { at: { ms: prev.ms, mono, proc }, gap: { kind: 'backwards', deltaMs } };", new: '' },
    { id: 'O3', old: 'if (prev === null) return { at: { ms: 0, mono, proc }, gap: null };', new: 'if (prev === null) return { at: { ms: mono, mono, proc }, gap: null };' },
    { id: 'O4', old: 'Math.max(0, now.ms - start.ms)', new: 'now.ms - start.ms' },
    { id: 'O5', old: "return { at: { ms: prev.ms, mono, proc }, gap: { kind: 'process', deltaMs } };", new: "return { at: prev, gap: { kind: 'process', deltaMs } };" },
    { id: 'O6', old: 'const step = Math.min(deltaMs, cap);', new: 'const step = deltaMs;' },
    { id: 'O7', old: "gap: step < deltaMs ? { kind: 'step', deltaMs } : null", new: 'gap: null' },
    { id: 'O8', old: 'const cap = Number.isFinite(capMs) && capMs > 0 ? capMs : 0;', new: 'const cap = capMs;' },
    { id: 'O9', old: "{ kind: 'step', deltaMs } : null", new: "{ kind: 'step', deltaMs: step } : null" },
    { id: 'O10', old: 'return OBSERVED_STEP_PERIODS * lanePeriodMs;', new: 'return 2 * lanePeriodMs + 1;' },
  ],
  suite: observeTimeCases,
};

// ---------------------------------------------------------------------------------------------------------- renewalDue

export type RenewalDueModule = typeof import('../../src/continuity/renewalDue.js');
type RIn = import('../../src/continuity/renewalDue.js').RenewalInputs;
type Rd<T> = import('../../src/continuity/renewalDue.js').Reading<T>;
type Trig = import('../../../shared/continuity.js').RenewalTrigger;
type FleetRoleName = import('../../../shared/fleetRoles.js').FleetRole;

export const U = { kind: 'unmeasured', why: 'stale' } as const;
export const M = <T>(value: T): Rd<T> => ({ kind: 'measured', value });

/** Table 3.3.11b written out per role: Renew now, the hard rows, then the soft rows, each in the table's order. */
export const ROWS_WRITTEN: Record<FleetRoleName, readonly Trig[]> = {
  overlord: ['operator', 'hard-cap', 'model-drift', 'resumed-other-class', 'entry-retired', 'term-raised',
    'account-outside-set', 'class-unservable', 'account-load', 'not-local', 'resumed-long', 'soft-ceiling', 'turns',
    'two-compactions', 'idle', 'daily-backstop', 'new-install', 'probe-failed', 'compaction-refused', 'class-changed',
    'evaluation-due'],
  auditor: [], replay: [], worker: [], reviewer: [],
  coordinator: ['operator', 'hard-cap', 'not-local', 'resumed-long', 'two-compactions', 'new-install', 'probe-failed',
    'compaction-refused', 'wave-boundary'],
  plain: [],
};
const HARD_WRITTEN = new Set<Trig>(['operator', 'hard-cap', 'model-drift', 'resumed-other-class', 'entry-retired',
  'term-raised', 'account-outside-set', 'class-unservable', 'account-load', 'not-local', 'resumed-long']);

const BOOL_FIELDS = ['backstopDue', 'installBehind', 'probeFailedUnfixed', 'modelDrift', 'entryRetired', 'termRaised',
  'accountOutsideSet', 'classUnservable', 'accountLoadMove', 'compactionRefused', 'classChanged', 'evaluationDue',
  'notLocal', 'waveBoundary'] as const;

/** A base where nothing fires: a 1M window (hard cap 250k), no context, no idle, every flag measured false. */
export function renewalBase(role: FleetRoleName): RIn {
  const flags = Object.fromEntries(BOOL_FIELDS.map((k) => [k, M(false)])) as Record<(typeof BOOL_FIELDS)[number], Rd<boolean>>;
  return { role, contextTokens: M(0), windowTokens: M(1_000_000), fittedCeilingTokens: M(250_000), turns: M(0),
    compactions: M(0), idleMs: M(0), startResumed: M({ resumed: false, otherClass: false }), renewNow: false, ...flags };
}

/** Each input's domain: unmeasured, and measured values below, at and above every threshold that reads it (the hard
 *  cap at half a 200k window included, review 1894 F9), plus measured values that are not a count (read as
 *  unmeasured). */
export const RENEWAL_DOMAINS: Record<string, readonly unknown[]> = {
  contextTokens: [U, M(0), M(62_499), M(62_500), M(62_501), M(99_999), M(100_000), M(100_001), M(124_999), M(125_000), M(125_001), M(149_999), M(150_000),
    M(150_001), M(249_999), M(250_000), M(250_001), M(-1), M(Number.NaN)],
  windowTokens: [U, M(0), M(200_000), M(500_000), M(1_000_000)],
  fittedCeilingTokens: [U, M(100_000), M(250_000)],
  turns: [U, M(0), M(40), M(41)],
  compactions: [U, M(0), M(1), M(2)],
  idleMs: [U, M(0), M(2_699_999), M(2_700_000)],
  startResumed: [U, M({ resumed: false, otherClass: false }), M({ resumed: true, otherClass: false }),
    M({ resumed: false, otherClass: true }), M({ resumed: true, otherClass: true })],
  renewNow: [false, true],
  ...Object.fromEntries(BOOL_FIELDS.map((k) => [k, [U, M(false), M(true)]])),
};

/** The spec's words as an oracle. A row needs some readings; a measured part that fails decides the row false; else a
 *  part that is unmeasured makes it blind. */
export function expectedRenewal(i: RIn): { due: boolean; why?: Trig; cls?: 'hard' | 'soft'; blind: Trig[] } {
  const val = (r: Rd<number>): number | null => (r.kind === 'measured' && Number.isFinite(r.value) && r.value >= 0 ? r.value : null);
  const ctx = val(i.contextTokens); const win = val(i.windowTokens);
  const cap = win === null || win === 0 ? null : Math.min(250_000, win / 2);
  type V = boolean | null;   // null: unmeasured
  const and = (...p: V[]): boolean | 'blind' => (p.some((x) => x === false) ? false : p.some((x) => x === null) ? 'blind' : true);
  const b = (r: Rd<boolean>): V => (r.kind === 'measured' ? r.value : null);
  // The cap is never above 250k, so a context past 250k times the fraction is past it whatever the window (review I1).
  const above = (frac: number): V => (ctx === null ? null : cap === null ? (ctx > 250_000 * frac ? true : null) : ctx > cap * frac);
  const res = i.startResumed.kind === 'measured' ? i.startResumed.value : null;
  const t = val(i.turns); const c = val(i.compactions); const idle = val(i.idleMs); const fit = val(i.fittedCeilingTokens);
  const row: Record<Trig, boolean | 'blind'> = {
    operator: i.renewNow,
    'hard-cap': and(ctx === null ? null : cap === null ? (ctx >= 250_000 ? true : null) : ctx >= cap),
    'soft-ceiling': and(ctx === null || fit === null ? null : ctx > 0.6 * fit),
    turns: and(t === null ? null : t > 40),
    'two-compactions': and(c === null ? null : c >= 2),
    idle: and(idle === null ? null : idle >= 45 * 60_000, above(0.25)),
    'daily-backstop': and(b(i.backstopDue)), 'new-install': and(b(i.installBehind)),
    'probe-failed': and(b(i.probeFailedUnfixed)), 'model-drift': and(b(i.modelDrift)),
    'resumed-other-class': and(res === null ? null : res.resumed && res.otherClass),
    'entry-retired': and(b(i.entryRetired)), 'term-raised': and(b(i.termRaised)),
    'account-outside-set': and(b(i.accountOutsideSet)), 'class-unservable': and(b(i.classUnservable)),
    'account-load': and(b(i.accountLoadMove)), 'compaction-refused': and(b(i.compactionRefused)),
    'class-changed': and(b(i.classChanged)), 'evaluation-due': and(b(i.evaluationDue)), 'not-local': and(b(i.notLocal)),
    'resumed-long': and(res === null ? null : res.resumed, above(0.5)),
    'wave-boundary': and(b(i.waveBoundary), above(0.25)),
  };
  const rows = ROWS_WRITTEN[i.role];
  const blind = rows.filter((r) => row[r] === 'blind');
  const why = rows.find((r) => row[r] === true);
  return why === undefined ? { due: false, blind } : { due: true, why, cls: HARD_WRITTEN.has(why) ? 'hard' : 'soft', blind };
}

const showIn = (i: unknown): string => JSON.stringify(i);

export function renewalDueCases(m: RenewalDueModule): Record<string, SuiteCase> {
  const check = (i: RIn): void => { expect(m.renewalDue(i), showIn(i)).toEqual(expectedRenewal(i)); };
  const fields = Object.keys(RENEWAL_DOMAINS);
  return {
    'the rows are Table 3.3.11b per role, total over FLEET_ROLES, only long-lived roles have rows': () => {
      expect(m.RENEWAL_ROWS).toEqual(ROWS_WRITTEN);
    },
    'the class column: hard rows are the hard ones, and every role tests them first': () => {
      for (const r of FLEET_ROLE_NAMES) {
        const rows = m.RENEWAL_ROWS[r];
        for (const t of rows) expect(m.TRIGGER_CLASS[t], t).toBe(HARD_WRITTEN.has(t) ? 'hard' : 'soft');
        const firstSoft = rows.findIndex((t) => m.TRIGGER_CLASS[t] === 'soft');
        if (firstSoft >= 0) expect(rows.slice(firstSoft).every((t) => m.TRIGGER_CLASS[t] === 'soft'), r).toBe(true);
      }
    },
    'hardCapTokens: 250k or half the window, whichever is lower': () => {
      expect([m.hardCapTokens(1_000_000), m.hardCapTokens(500_000), m.hardCapTokens(200_000)]).toEqual([250_000, 250_000, 100_000]);
    },
    'EXHAUSTIVE: the base fires nothing, for every role': () => {
      for (const r of FLEET_ROLE_NAMES) expect(m.renewalDue(renewalBase(r))).toEqual({ due: false, blind: [] });
    },
    'EXHAUSTIVE: each input over its domain, one at a time, for every role': () => {
      for (const r of FLEET_ROLE_NAMES) for (const f of fields) for (const v of RENEWAL_DOMAINS[f]!) check({ ...renewalBase(r), [f]: v } as RIn);
    },
    'EXHAUSTIVE: every pair of inputs over their domains, for every role': () => {
      for (const r of FLEET_ROLE_NAMES) {
        const base = renewalBase(r);
        for (let a = 0; a < fields.length; a++) for (let b = a + 1; b < fields.length; b++) {
          for (const va of RENEWAL_DOMAINS[fields[a]!]!) for (const vb of RENEWAL_DOMAINS[fields[b]!]!) {
            check({ ...base, [fields[a]!]: va, [fields[b]!]: vb } as RIn);
          }
        }
      }
    },
    'WORKED: a 1M window at 260k tokens is hard-cap; a 200k window at 100k is hard-cap': () => {
      for (const r of ['overlord', 'coordinator'] as const) {
        expect(m.renewalDue({ ...renewalBase(r), contextTokens: M(260_000) })).toMatchObject({ due: true, cls: 'hard', why: 'hard-cap' });
        expect(m.renewalDue({ ...renewalBase(r), windowTokens: M(200_000), contextTokens: M(100_000) }))
          .toMatchObject({ due: true, cls: 'hard', why: 'hard-cap' });
      }
    },
    'WORKED: a coordinator at a wave boundary with 70k tokens on a 1M window is wave-boundary': () => {
      expect(m.renewalDue({ ...renewalBase('coordinator'), waveBoundary: M(true), contextTokens: M(70_000) }))
        .toEqual({ due: true, cls: 'soft', why: 'wave-boundary', blind: [] });
    },
    'WORKED: 300k tokens with the window unmeasured is hard-cap (the cap is never above 250k); 200k is blind': () => {
      expect(m.renewalDue({ ...renewalBase('coordinator'), windowTokens: U, contextTokens: M(300_000) }))
        .toMatchObject({ due: true, cls: 'hard', why: 'hard-cap' });
      expect(m.renewalDue({ ...renewalBase('coordinator'), windowTokens: U, contextTokens: M(200_000) }))
        .toEqual({ due: false, blind: ['hard-cap'] });
    },
    'WORKED: a stale context reading is not due, with hard-cap blind': () => {
      const got = m.renewalDue({ ...renewalBase('overlord'), contextTokens: U });
      expect(got.due).toBe(false);
      expect(got.blind).toContain('hard-cap');
    },
    'PROPERTY (10,000 seeded inputs per role): an unmeasured reading never makes a renewal due or moves it earlier': () => {
      for (const r of FLEET_ROLE_NAMES) {
        const rnd = mulberry32(0x5eed + r.length);
        const rows = m.RENEWAL_ROWS[r];
        for (let n = 0; n < 10_000; n++) {
          const i: Record<string, unknown> = { ...renewalBase(r) };
          for (const f of fields) { const d = RENEWAL_DOMAINS[f]!; i[f] = d[Math.floor(rnd() * d.length)]; }
          const before = m.renewalDue(i as unknown as RIn);
          const measured = fields.filter((f) => f !== 'renewNow' && (i[f] as { kind: string }).kind === 'measured');
          if (measured.length === 0) continue;
          const f = measured[Math.floor(rnd() * measured.length)]!;
          const after = m.renewalDue({ ...i, [f]: U } as unknown as RIn);
          if (!before.due && after.due) throw new Error(`${r}: unmeasured ${f} made a renewal due: ${showIn(i)}`);
          if (before.due && after.due && rows.indexOf(after.why) < rows.indexOf(before.why)) {
            throw new Error(`${r}: unmeasured ${f} moved ${before.why} to ${after.why}`);
          }
        }
      }
    },
  };
}

const RENEWAL_DUE_SET: MutantSet<RenewalDueModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/renewalDue.ts'),
  mutants: [
    { id: 'D1', old: "'class-unservable', 'account-load', 'not-local', 'resumed-long',\n    'soft-ceiling', 'turns',", new: "'class-unservable', 'account-load', 'not-local', 'soft-ceiling',\n    'resumed-long', 'turns'," },
    { id: 'D2', old: '(atCap ? c >= cap * fraction : c > cap * fraction)', new: '(atCap ? c > cap * fraction : c > cap * fraction)' },
    { id: 'D13', old: "return past(HARD_CAP_TOKENS) ? true : 'blind';", new: "return 'blind';" },
    { id: 'D3', old: "r.kind === 'measured' ? r.value === true : 'blind'", new: "r.kind === 'measured' ? r.value === true : false" },
    { id: 'D4', old: "  overlord: ['operator', 'hard-cap',", new: "  overlord: ['hard-cap'," },
    { id: 'D5', old: "'not-local', 'resumed-long',\n    'two-compactions',", new: "'not-local', 'two-compactions',\n    'resumed-long'," },
    { id: 'D6', old: 'return Math.min(HARD_CAP_TOKENS, windowTokens / 2);', new: 'return HARD_CAP_TOKENS;' },
    { id: 'D7', old: 'if (parts.includes(false)) return false;', new: "if (parts.includes('blind')) return 'blind';" },
    { id: 'D8', old: "typeof r.value === 'number' && Number.isFinite(r.value) && r.value >= 0 ? r.value : null", new: "typeof r.value === 'number' ? r.value : null" },
    { id: 'D9', old: 'turns: (i) => gt(i.turns, TURNS_SOFT),', new: 'turns: (i) => ge(i.turns, TURNS_SOFT),' },
    { id: 'D10', old: "'model-drift': 'hard',", new: "'model-drift': 'soft'," },
    { id: 'D11', old: 'else if (v && why === null) why = t;', new: 'else if (v) why = t;' },
    { id: 'D12', old: 'return w === null || w <= 0 ? null : hardCapTokens(w);', new: 'return w === null ? null : hardCapTokens(w);' },
  ],
  suite: renewalDueCases,
};

// ---------------------------------------------------------------------------------------------------------- softRenewalMay

export type SoftModule = typeof import('../../src/continuity/softRenewal.js');
type SIn = import('../../src/continuity/softRenewal.js').SoftInputs;
type SAns = import('../../src/continuity/softRenewal.js').SoftAnswer;
type SRd<T> = import('../../src/continuity/softRenewal.js').SoftReading<T>;

const MIN = 60_000;
export const NA = { kind: 'not-applicable' } as const;

/** A base where every precondition is clear and the operator has been away 20 observed minutes: a soft renewal may
 *  start. */
export function softBase(role: FleetRoleName): SIn {
  return { role, hibernateHold: { held: false }, readersRunning: M(0), operatorQuietObservedMs: M(20 * MIN),
    placeHiddenObservedMs: M(0), mode: 'when-away', dueSinceObservedMs: 0, generationAgeObservedMs: 30 * MIN,
    holdOffUntilObservedMs: null, softRenewalsInWindow: 0, overlordOutsideActive: false };
}

/** Each input at not applicable and unmeasured (where it is a reading), blocking, at its edge and clear, and a value
 *  that is not a number. */
export const SOFT_DOMAINS: Record<string, readonly unknown[]> = {
  generationAgeObservedMs: [0, 30 * MIN - 1, 30 * MIN, Number.NaN],
  holdOffUntilObservedMs: [null, 30 * MIN, 30 * MIN + 1],
  softRenewalsInWindow: [0, 2, 3, -1, 1.5, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NaN],
  overlordOutsideActive: [false, true],
  hibernateHold: [{ held: false }, { held: true, reason: 'pane' }],
  readersRunning: [NA, U, M(0), M(1), M(Number.NaN), M(-1)],
  operatorQuietObservedMs: [NA, U, M(0), M(20 * MIN - 1), M(20 * MIN), M(Number.POSITIVE_INFINITY)],
  placeHiddenObservedMs: [NA, U, M(0), M(5 * MIN - 1), M(5 * MIN), M(-1)],
  mode: ['when-away', 'on-schedule'],
  dueSinceObservedMs: [0, 30 * MIN - 1, 30 * MIN],
};

/** The spec's words (§3.3.11 R19, the preconditions, the soft budget; C50; Appendix B's "the preconditions, at most 30
 *  minutes"; review 1890 I7: not applicable is not unmeasured, a break is any measured disjunct; review 1894 F3: a budget
 *  count that is not a non-negative integer is unmeasured) as an oracle. */
export function expectedSoft(i: SIn): SAns {
  const no = (waitFor: import('../../src/continuity/softRenewal.js').SoftWait): SAns => ({ start: false, waitFor });
  if (!(i.generationAgeObservedMs >= 30 * MIN)) return no('least-age');
  if (i.holdOffUntilObservedMs !== null && !(i.generationAgeObservedMs >= i.holdOffUntilObservedMs)) return no('hold-off');
  const n = i.softRenewalsInWindow;
  if (!(Number.isInteger(n) && n >= 0)) return no('unmeasured');
  if (!(n <= 2)) return no('budget');
  if (i.role === 'coordinator' && i.overlordOutsideActive) return no('overlord-first');
  const capped = i.mode === 'on-schedule' && i.dueSinceObservedMs >= 30 * MIN;
  if (capped) return { start: true };
  if (i.hibernateHold.held) return no('hold');
  // A measured value that is not a count (NaN, negative, infinite) is read as unmeasured.
  const count = (x: SRd<number>): number | 'u' | 'na' => (x.kind === 'not-applicable' ? 'na'
    : x.kind === 'measured' && Number.isFinite(x.value) && x.value >= 0 ? x.value : 'u');
  const r = count(i.readersRunning);
  if (r === 'u') return no('unmeasured');
  if (r !== 'na' && r !== 0) return no('readers');
  const passes = (x: SRd<number>, t: number): boolean | 'u' | 'na' => { const v = count(x); return v === 'u' || v === 'na' ? v : v >= t; };
  const d = [passes(i.operatorQuietObservedMs, 20 * MIN), passes(i.placeHiddenObservedMs, 5 * MIN)];
  if (d.includes(true)) return { start: true };
  if (d.includes('u')) return no('unmeasured');
  return no('no-break');
}

export function softRenewalCases(m: SoftModule): Record<string, SuiteCase> {
  const check = (i: SIn): void => { expect(m.softRenewalMay(i), showIn(i)).toEqual(expectedSoft(i)); };
  const fields = Object.keys(SOFT_DOMAINS);
  const roles = ['overlord', 'coordinator'] as const;
  return {
    'EXHAUSTIVE: the base starts, for both long-lived roles': () => {
      for (const r of roles) expect(m.softRenewalMay(softBase(r))).toEqual({ start: true });
    },
    'EXHAUSTIVE: each wait\'s input over its domain, one at a time': () => {
      for (const r of roles) for (const f of fields) for (const v of SOFT_DOMAINS[f]!) check({ ...softBase(r), [f]: v } as SIn);
    },
    'EXHAUSTIVE: every pair of inputs over their domains (the first wait in order is named)': () => {
      for (const r of roles) {
        const base = softBase(r);
        for (let a = 0; a < fields.length; a++) for (let b = a + 1; b < fields.length; b++) {
          for (const va of SOFT_DOMAINS[fields[a]!]!) for (const vb of SOFT_DOMAINS[fields[b]!]!) {
            check({ ...base, [fields[a]!]: va, [fields[b]!]: vb } as SIn);
          }
        }
      }
    },
    'the order of the waits: least-age, hold-off, budget, overlord-first, hold, readers, then the break': () => {
      const all: SIn = { ...softBase('coordinator'), generationAgeObservedMs: 0, holdOffUntilObservedMs: 60 * MIN,
        softRenewalsInWindow: 3, overlordOutsideActive: true, hibernateHold: { held: true, reason: 'menu' },
        readersRunning: M(2), operatorQuietObservedMs: M(0), placeHiddenObservedMs: M(0) };
      const seen: string[] = [];
      let cur: SIn = all;
      const clear: Partial<SIn>[] = [{ generationAgeObservedMs: 30 * MIN }, { holdOffUntilObservedMs: null },
        { softRenewalsInWindow: 0 }, { overlordOutsideActive: false }, { hibernateHold: { held: false } },
        { readersRunning: M(0) }, { operatorQuietObservedMs: M(20 * MIN) }];
      for (const c of clear) { const a = m.softRenewalMay(cur); seen.push(a.start ? 'start' : a.waitFor); cur = { ...cur, ...c } as SIn; }
      seen.push(m.softRenewalMay(cur).start ? 'start' : 'wait');
      expect(seen).toEqual(['least-age', 'hold-off', 'budget', 'overlord-first', 'hold', 'readers', 'no-break', 'start']);
    },
    'on-schedule: after 30 minutes the preconditions (hold, readers, break) no longer delay; least age, budget and the Overlord still do': () => {
      const sched: SIn = { ...softBase('coordinator'), mode: 'on-schedule', dueSinceObservedMs: 30 * MIN,
        operatorQuietObservedMs: M(0), placeHiddenObservedMs: M(0), hibernateHold: { held: true, reason: 'background' }, readersRunning: U };
      expect(m.softRenewalMay(sched)).toEqual({ start: true });
      expect(m.softRenewalMay({ ...sched, dueSinceObservedMs: 30 * MIN - 1 })).toEqual({ start: false, waitFor: 'hold' });
      expect(m.softRenewalMay({ ...sched, mode: 'when-away' })).toEqual({ start: false, waitFor: 'hold' });
      expect(m.softRenewalMay({ ...sched, softRenewalsInWindow: 3 })).toEqual({ start: false, waitFor: 'budget' });
      expect(m.softRenewalMay({ ...sched, generationAgeObservedMs: 0 })).toEqual({ start: false, waitFor: 'least-age' });
      expect(m.softRenewalMay({ ...sched, overlordOutsideActive: true })).toEqual({ start: false, waitFor: 'overlord-first' });
    },
    'I7: an input the role does not have neither blocks nor fires; any measured disjunct is a break': () => {
      const co: SIn = { ...softBase('coordinator'), readersRunning: NA, placeHiddenObservedMs: NA };
      expect(m.softRenewalMay(co)).toEqual({ start: true });
      expect(m.softRenewalMay({ ...co, operatorQuietObservedMs: M(0) })).toEqual({ start: false, waitFor: 'no-break' });
      expect(m.softRenewalMay({ ...co, operatorQuietObservedMs: U })).toEqual({ start: false, waitFor: 'unmeasured' });
      expect(m.softRenewalMay({ ...co, operatorQuietObservedMs: NA })).toEqual({ start: false, waitFor: 'no-break' });
      const ov: SIn = { ...softBase('overlord'), operatorQuietObservedMs: U, placeHiddenObservedMs: M(5 * MIN) };
      expect(m.softRenewalMay(ov)).toEqual({ start: true });
      expect(m.softRenewalMay({ ...ov, placeHiddenObservedMs: M(5 * MIN - 1) })).toEqual({ start: false, waitFor: 'unmeasured' });
    },
    'the Overlord does not wait for itself; a coordinator waits for it (C50)': () => {
      expect(m.softRenewalMay({ ...softBase('overlord'), overlordOutsideActive: true })).toEqual({ start: true });
      expect(m.softRenewalMay({ ...softBase('coordinator'), overlordOutsideActive: true })).toEqual({ start: false, waitFor: 'overlord-first' });
    },
    'PROPERTY (10,000 seeded inputs per role): an unmeasured reading never turns a wait into a start': () => {
      const readings = ['readersRunning', 'operatorQuietObservedMs', 'placeHiddenObservedMs'];
      for (const r of roles) {
        const rnd = mulberry32(0x50f7 + r.length);
        for (let k = 0; k < 10_000; k++) {
          const i: Record<string, unknown> = { ...softBase(r) };
          for (const f of fields) { const d = SOFT_DOMAINS[f]!; i[f] = d[Math.floor(rnd() * d.length)]; }
          const before = m.softRenewalMay(i as unknown as SIn);
          for (const f of readings) {
            if ((i[f] as { kind: string }).kind !== 'measured') continue;
            const after = m.softRenewalMay({ ...i, [f]: U } as unknown as SIn);
            if (!before.start && after.start) throw new Error(`${r}: unmeasured ${f} turned a wait into a start: ${showIn(i)}`);
          }
        }
      }
    },
  };
}

export function earlyWhileAwayCases(m: SoftModule): Record<string, SuiteCase> {
  return {
    'at half the soft ceiling or half the turns, yes; below both, no; for the Overlord': () => {
      const b = renewalBase('overlord');   // fitted ceiling 250k: the soft ceiling is 150k, half of it 75k
      expect(m.earlyWhileAway('overlord', { ...b, contextTokens: M(75_000) })).toBe(true);
      expect(m.earlyWhileAway('overlord', { ...b, turns: M(20) })).toBe(true);
      expect(m.earlyWhileAway('overlord', { ...b, contextTokens: M(74_999), turns: M(19) })).toBe(false);
      expect(m.earlyWhileAway('overlord', { ...b, contextTokens: M(75_000), turns: M(20), fittedCeilingTokens: U })).toBe(true);
    },
    'an unmeasured reading, or one that is not a count, says no': () => {
      const b = renewalBase('overlord');
      expect(m.earlyWhileAway('overlord', { ...b, contextTokens: U, turns: U })).toBe(false);
      expect(m.earlyWhileAway('overlord', { ...b, contextTokens: M(200_000), fittedCeilingTokens: U, turns: M(Number.NaN) })).toBe(false);
      expect(m.earlyWhileAway('overlord', { ...b, contextTokens: M(Number.POSITIVE_INFINITY) })).toBe(false);
    },
    'a role whose rows have neither the soft ceiling nor turns never renews early': () => {
      for (const r of ['coordinator', 'worker', 'plain'] as const) {
        expect(m.earlyWhileAway(r, { ...renewalBase(r), contextTokens: M(200_000), turns: M(40) }), r).toBe(false);
      }
    },
  };
}

const SOFT_PATH = path.join(ROOT, 'server/src/continuity/softRenewal.ts');
const SOFT_SET: MutantSet<SoftModule> = {
  modulePath: SOFT_PATH,
  mutants: [
    { id: 'S1', old: 'if (!(i.generationAgeObservedMs >= LEAST_AGE_MS))', new: 'if (!(i.generationAgeObservedMs > LEAST_AGE_MS))' },
    { id: 'S2', old: "if (!(used < SOFT_BUDGET.count)) return wait('budget');", new: '' },
    { id: 'S14', old: "if (!(Number.isInteger(used) && used >= 0)) return wait('unmeasured');", new: '' },
    { id: 'S15', old: 'Number.isInteger(used) && used >= 0', new: 'used >= 0' },
    { id: 'S16', old: 'Number.isInteger(used) && used >= 0', new: 'Number.isInteger(used)' },
    { id: 'S3', old: "if (readers === null) return wait('unmeasured');", new: '' },
    { id: 'S4', old: "  if (i.mode === 'on-schedule' && i.dueSinceObservedMs >= ON_SCHEDULE_WAIT_MS) return START;\n  if (i.hibernateHold.held) return wait('hold');",
      new: "  if (i.hibernateHold.held) return wait('hold');\n  if (i.mode === 'on-schedule' && i.dueSinceObservedMs >= ON_SCHEDULE_WAIT_MS) return START;" },
    { id: 'S5', old: "i.role !== 'overlord' && i.overlordOutsideActive", new: 'i.overlordOutsideActive' },
    { id: 'S6', old: "if (away === 'unmeasured') return wait('unmeasured');", new: "if (away === 'unmeasured') return START;" },
    { id: 'S7', old: "r.kind !== 'not-applicable' && measuredCount(r) === null", new: "measuredCount(r) === null" },
    { id: 'S8', old: '!(i.generationAgeObservedMs >= i.holdOffUntilObservedMs)', new: 'i.generationAgeObservedMs > i.holdOffUntilObservedMs' },
    { id: 'S9', old: "  if (i.hibernateHold.held) return wait('hold');\n  if (i.readersRunning.kind !== 'not-applicable') {", new: "  if (i.readersRunning.kind !== 'not-applicable') {" },
    { id: 'S10', old: "if (i.mode === 'on-schedule' && i.dueSinceObservedMs >= ON_SCHEDULE_WAIT_MS) return START;", new: "if (i.mode === 'on-schedule') return START;" },
    { id: 'S11', old: '[i.placeHiddenObservedMs, BREAK_PLACE_HIDDEN_MS]', new: '[i.placeHiddenObservedMs, BREAK_NO_MESSAGE_MS]' },
    { id: 'S12', old: "if (parts.some(([r, t]) =>", new: "if (parts.every(([r, t]) =>" },
    { id: 'S13', old: "  if (i.readersRunning.kind !== 'not-applicable') {", new: '  {' },
  ],
  suite: softRenewalCases,
};
const EARLY_SET: MutantSet<SoftModule> = {
  modulePath: SOFT_PATH,
  mutants: [
    { id: 'E1', old: 'turns >= TURNS_SOFT * EARLY_WHILE_AWAY_FRACTION', new: 'turns > TURNS_SOFT * EARLY_WHILE_AWAY_FRACTION' },
    { id: 'E2', old: "const pastTurns = rows.includes('turns') && ", new: 'const pastTurns = ' },
    { id: 'E3', old: 'ctx >= fit * SOFT_CEILING_FRACTION * EARLY_WHILE_AWAY_FRACTION', new: 'ctx >= fit * EARLY_WHILE_AWAY_FRACTION' },
    { id: 'E4', old: "const pastCeiling = rows.includes('soft-ceiling') && ", new: 'const pastCeiling = ' },
    { id: 'E5', old: 'return pastCeiling || pastTurns;', new: 'return pastCeiling && pastTurns;' },
  ],
  suite: earlyWhileAwayCases,
};

// ---------------------------------------------------------------------------------------------------------- generationStep

export type GenModule = typeof import('../../src/continuity/generationMachine.js');
type GView = import('../../src/continuity/generationMachine.js').GenView;
type GEvent = import('../../src/continuity/generationMachine.js').GenEvent;
type GAction = import('../../src/continuity/generationMachine.js').GenAction;
type GState = import('../../../shared/continuity.js').GenerationState;

const G_STATES: GState[] = ['active', 'draining', 'checkpointed', 'clearing', 'carded', 'probing', 'degraded', 'ended'];
export const GEN_EVENTS: GEvent[] = [
  { kind: 'due', cls: 'hard' }, { kind: 'due', cls: 'soft' }, { kind: 'drained' }, { kind: 'handover' },
  { kind: 'host-ended' }, { kind: 'host-failed', afterEnd: false }, { kind: 'host-failed', afterEnd: true },
  { kind: 'started', resumed: false }, { kind: 'started', resumed: true }, { kind: 'card-read', hashMatches: true },
  { kind: 'card-read', hashMatches: false }, { kind: 'probes', passed: true }, { kind: 'probes', passed: false },
  { kind: 'deadline' }, { kind: 'renew-now' },
];

/** Every view: each state with `from`, `cls` and the counters at their edge values. */
export function genViews(): GView[] {
  const out: GView[] = [];
  for (const state of G_STATES) for (const from of ['active', 'degraded'] as const) for (const cls of [null, 'hard', 'soft'] as const)
    for (const tries of [0, 1, 2]) for (const renudged of [false, true]) for (const probeRounds of [0, 1])
      for (const hostEnded of [false, true]) for (const proven of [false, true]) out.push({ state, from, tries, cls, renudged, probeRounds, hostEnded, proven });
  return out;
}

const FRESH = { from: 'active', tries: 0, cls: null, renudged: false, probeRounds: 0, hostEnded: false, proven: true } as const;
type Want = { readonly state: GState; readonly over?: Partial<GView>; readonly actions: readonly GAction[] };
/** Table 3.3.11a and §3.3.11's sentences, one rule each, first match. `same` is "any event a state does not name". */
type Rule = { readonly why: string; readonly st: readonly GState[]; readonly ev: (e: GEvent) => boolean;
  readonly when?: (g: GView) => boolean; readonly then: (g: GView) => Want };
/** "A failure before the first half returns the generation to active, with a hold-off" (the model's
 *  FAILED_RENEWAL_RETURNS='active', ruled by plan review 1890 A2), wherever the renewal began. */
/** ...and "A generation never becomes active without having read its card and passed its probes" (§3.3.11): one that
 *  was degraded before it ever passed returns to degraded (the coordinator's ruling, slug a2-active-only-if-proven). */
const BACK = (g: GView): Want => (g.proven
  ? { state: 'active', over: FRESH, actions: ['release-deliveries', 'set-hold-off'] }
  : { state: 'degraded', over: { ...FRESH, from: 'degraded', proven: false }, actions: ['release-deliveries'] });
const DEGRADE = (g: GView): Want => ({ state: 'degraded', over: { ...FRESH, from: 'degraded', proven: g.proven }, actions: ['release-deliveries', 'raise-item'] });
const LIVE: readonly GState[] = ['active', 'draining', 'checkpointed', 'clearing', 'carded', 'probing', 'degraded'];
export const GEN_RULES: readonly Rule[] = [
  { why: '"Every start mints a generation": n ends, n+1 is minted at carded', st: LIVE, ev: (e) => e.kind === 'started',
    then: () => ({ state: 'ended', actions: ['end-this', 'mint-next'] }) },
  { why: 'active: a due renewal drains', st: ['active'], ev: (e) => e.kind === 'due',
    then: (g) => ({ state: 'draining', over: { from: 'active', cls: g.cls, tries: 0, renudged: false, probeRounds: 0, hostEnded: false }, actions: ['hold-deliveries'] }) },
  { why: 'Renew now from active drains, as a hard trigger', st: ['active'], ev: (e) => e.kind === 'renew-now',
    then: () => ({ state: 'draining', over: { from: 'active', cls: 'hard', tries: 0, renudged: false, probeRounds: 0, hostEnded: false }, actions: ['hold-deliveries'] }) },
  { why: '"degraded blocks soft triggers only. A hard trigger still renews"; so does Renew now', st: ['degraded'],
    ev: (e) => (e.kind === 'due' && e.cls === 'hard') || e.kind === 'renew-now',
    then: () => ({ state: 'draining', over: { from: 'degraded', cls: 'hard', tries: 0, renudged: false, probeRounds: 0, hostEnded: false }, actions: ['hold-deliveries'] }) },
  { why: 'draining, drained on a hard trigger: checkpointed is skipped', st: ['draining'], ev: (e) => e.kind === 'drained',
    when: (g) => g.cls === 'hard', then: () => ({ state: 'clearing', over: { tries: 1, hostEnded: false }, actions: ['renew'] }) },
  { why: 'draining, drained: the checkpoint is assembled and the note asked for', st: ['draining'], ev: (e) => e.kind === 'drained',
    then: () => ({ state: 'checkpointed', actions: ['assemble-checkpoint', 'ask-handover'] }) },
  { why: 'draining "120, then back to the state it left"', st: ['draining'], ev: (e) => e.kind === 'deadline', then: BACK },
  { why: 'checkpointed: the note, or "60, then clearing without the note"', st: ['checkpointed'],
    ev: (e) => e.kind === 'handover' || e.kind === 'deadline', then: () => ({ state: 'clearing', over: { tries: 1, hostEnded: false }, actions: ['renew'] }) },
  { why: 'clearing: the receipt\'s first half', st: ['clearing'], ev: (e) => e.kind === 'host-ended',
    then: () => ({ state: 'clearing', over: { hostEnded: true }, actions: [] }) },
  { why: '"A failure before the first half returns the generation to the state it left"', st: ['clearing'],
    ev: (e) => e.kind === 'host-failed' && !e.afterEnd, when: (g) => !g.hostEnded, then: BACK },
  { why: '"A failure after it retries within the state\'s deadline"; renew is idempotent on n', st: ['clearing'],
    ev: (e) => e.kind === 'host-failed', then: (g) => ({ state: 'clearing', over: { tries: g.tries + 1, hostEnded: true }, actions: ['renew'] }) },
  { why: 'clearing "90, for all tries", after the first half: degraded', st: ['clearing'], ev: (e) => e.kind === 'deadline',
    when: (g) => g.hostEnded, then: DEGRADE },
  { why: 'clearing times out before the first half: back to the state it left', st: ['clearing'], ev: (e) => e.kind === 'deadline', then: BACK },
  { why: 'carded: the served hash comes back', st: ['carded'], ev: (e) => e.kind === 'card-read' && e.hashMatches,
    then: () => ({ state: 'probing', over: { probeRounds: 0 }, actions: ['start-probes'] }) },
  { why: 'carded "45, with one re-nudge"', st: ['carded'], ev: (e) => e.kind === 'deadline', when: (g) => !g.renudged,
    then: () => ({ state: 'carded', over: { renudged: true }, actions: ['renudge-card'] }) },
  { why: 'carded after its re-nudge: degraded', st: ['carded'], ev: (e) => e.kind === 'deadline', then: DEGRADE },
  { why: '"When probing passes, generation n+1 is active"', st: ['probing'], ev: (e) => e.kind === 'probes' && e.passed,
    then: () => ({ state: 'active', over: FRESH, actions: ['release-deliveries'] }) },
  { why: 'probing "two rounds at most": a first failure re-reads and probes again', st: ['probing'],
    ev: (e) => e.kind === 'probes' && !e.passed, when: (g) => g.probeRounds === 0,
    then: () => ({ state: 'probing', over: { probeRounds: 1 }, actions: ['renudge-card', 'start-probes'] }) },
  { why: '"Probes that fail twice": degraded', st: ['probing'], ev: (e) => e.kind === 'probes' && !e.passed, then: DEGRADE },
  { why: 'probing "165": degraded', st: ['probing'], ev: (e) => e.kind === 'deadline', then: DEGRADE },
];

export function expectedStep(g: GView, e: GEvent): { next: GView; actions: readonly GAction[] } {
  for (const r of GEN_RULES) {
    if (r.st.includes(g.state) && r.ev(e) && (r.when === undefined || r.when(g))) {
      const w = r.then(e.kind === 'due' ? { ...g, cls: e.cls } : g);
      return { next: { ...g, ...(w.over ?? {}), state: w.state }, actions: w.actions };
    }
  }
  return { next: g, actions: [] };
}

/** Feeds events through `generationStep`; a `started` hands over to the generation it mints. */
function runChain(m: GenModule, start: GView, events: readonly GEvent[]): { views: GView[]; actions: GAction[][]; gens: number } {
  let g = start; let gens = 1;
  const views: GView[] = []; const actions: GAction[][] = [];
  for (const e of events) {
    const s = m.generationStep(g, e);
    views.push(s.next); actions.push([...s.actions]);
    if (s.actions.includes('mint-next')) { g = m.GEN_MINTED; gens++; } else g = s.next;
  }
  return { views, actions, gens };
}

const ev = (kind: GEvent['kind'], x: Record<string, unknown> = {}): GEvent => ({ kind, ...x }) as GEvent;

export function generationStepCases(m: GenModule): Record<string, SuiteCase> {
  return {
    'the starting views: GEN_ACTIVE works, GEN_MINTED is at carded': () => {
      expect(m.GEN_ACTIVE).toEqual({ state: 'active', ...FRESH });
      expect(m.GEN_MINTED).toEqual({ state: 'carded', ...FRESH, proven: false });
    },
    'EXHAUSTIVE: every state x every event x from x cls x the counters\' edges, against Table 3.3.11a written out': () => {
      const views = genViews();
      expect(views.length * GEN_EVENTS.length).toBe(2304 * 15);
      for (const g of views) for (const e of GEN_EVENTS) expect(m.generationStep(g, e), JSON.stringify([g, e])).toEqual(expectedStep(g, e));
    },
    'PROPERTY (10,000 seeded event sequences from active): G1, no mint without a start, one renew per try, ended terminal': () => {
      const rnd = mulberry32(0x6e11);
      for (let n = 0; n < 10_000; n++) {
        let g: GView = m.GEN_ACTIVE; let cardOk = false; let starts = 0; let mints = 0;
        for (let k = 0; k < 30; k++) {
          const e = GEN_EVENTS[Math.floor(rnd() * GEN_EVENTS.length)]!;
          const s = m.generationStep(g, e);
          const where = `seq ${n} step ${k}: ${g.state} ${JSON.stringify(e)}`;
          if (g.state === 'ended' && (s.next !== g && JSON.stringify(s.next) !== JSON.stringify(g) || s.actions.length > 0)) throw new Error(`${where}: ended moved`);
          if (e.kind === 'started' && g.state !== 'ended') starts++;
          mints += s.actions.filter((a) => a === 'mint-next').length;
          if (s.next.state === 'active' && (g.state === 'carded' || g.state === 'probing')) {
            if (!(cardOk && g.state === 'probing' && e.kind === 'probes' && e.passed)) throw new Error(`${where}: active without a read card and a passed round`);
          }
          if (s.actions.filter((a) => a === 'renew').length > 1) throw new Error(`${where}: two renews in one step`);
          if (s.actions.includes('renew') && s.next.tries !== (g.state === 'clearing' ? g.tries + 1 : 1)) throw new Error(`${where}: a renew that is not one try`);
          if (s.actions.includes('renew') && s.next.state !== 'clearing') throw new Error(`${where}: renew outside clearing`);
          if (g.state === 'carded' && s.next.state === 'probing') cardOk = e.kind === 'card-read' && e.hashMatches;
          if (s.actions.includes('mint-next')) { g = m.GEN_MINTED; cardOk = false; } else g = s.next;
        }
        if (mints !== starts) throw new Error(`seq ${n}: ${mints} mints for ${starts} starts`);
      }
    },
    'MODEL CHECKPOINTED_TIMEOUT=clearing: a timed-out checkpoint goes to clearing without the note': () => {
      const r = runChain(m, m.GEN_ACTIVE, [ev('due', { cls: 'soft' }), ev('drained'), ev('deadline')]);
      expect(r.views.map((v) => v.state)).toEqual(['draining', 'checkpointed', 'clearing']);
      expect(r.actions[2]).toEqual(['renew']);
    },
    'MODEL FAILED_RENEWAL_RETURNS=active: a failure before the first half returns to active with a hold-off': () => {
      const r = runChain(m, m.GEN_ACTIVE, [ev('due', { cls: 'soft' }), ev('drained'), ev('handover'), ev('host-failed', { afterEnd: false })]);
      expect(r.views.at(-1)!.state).toBe('active');
      expect(r.actions.at(-1)).toContain('set-hold-off');
    },
    'MODEL FAILED_RENEWAL_RETURNS=active, from degraded too (A2): a failure before the first half returns to active with a hold-off': () => {
      const deg: GView = { ...m.GEN_ACTIVE, state: 'degraded', from: 'degraded', proven: true };
      for (const failure of [[ev('drained'), ev('host-failed', { afterEnd: false })], [ev('drained'), ev('deadline')], [ev('deadline')]]) {
        const r = runChain(m, deg, [ev('renew-now'), ...failure]);
        expect(r.views.at(-1), JSON.stringify(failure)).toEqual(m.GEN_ACTIVE);
        expect(r.actions.at(-1)).toEqual(['release-deliveries', 'set-hold-off']);
      }
    },
    'a generation degraded before it ever passed returns to degraded, never to active (§3.3.11; slug a2-active-only-if-proven)': () => {
      const r0 = runChain(m, m.GEN_MINTED, [ev('deadline'), ev('deadline')]);
      expect(r0.views.at(-1)).toMatchObject({ state: 'degraded', proven: false });
      for (const failure of [[ev('drained'), ev('host-failed', { afterEnd: false })], [ev('drained'), ev('deadline')], [ev('deadline')]]) {
        const r = runChain(m, r0.views.at(-1)!, [ev('renew-now'), ...failure]);
        expect(r.views.at(-1), JSON.stringify(failure)).toMatchObject({ state: 'degraded', proven: false });
        expect(r.actions.at(-1)).toEqual(['release-deliveries']);
      }
    },
    'MODEL START_WHILE_DOWN=reported-at-boot: a start reported late still ends n and mints n+1 at carded': () => {
      const r = runChain(m, m.GEN_ACTIVE, [ev('due', { cls: 'hard' }), ev('drained'), ev('host-ended'), ev('started', { resumed: false })]);
      expect(r.views.at(-1)!.state).toBe('ended');
      expect(r.actions.at(-1)).toEqual(['end-this', 'mint-next']);
      expect(r.gens).toBe(2);
      expect(m.generationStep(m.GEN_ACTIVE, ev('started', { resumed: true })).actions).toEqual(['end-this', 'mint-next']);
    },
    'MODEL CARD_DOOR_SKIPS=table: the card is read at carded only, and a matching read starts the probes': () => {
      expect(m.generationStep(m.GEN_MINTED, ev('card-read', { hashMatches: true }))).toEqual({ next: { ...m.GEN_MINTED, state: 'probing' }, actions: ['start-probes'] });
      expect(m.generationStep(m.GEN_MINTED, ev('card-read', { hashMatches: false }))).toEqual({ next: m.GEN_MINTED, actions: [] });
      for (const st of ['active', 'draining', 'checkpointed', 'clearing', 'probing', 'degraded'] as const) {
        const g = { ...m.GEN_ACTIVE, state: st };
        expect(m.generationStep(g, ev('card-read', { hashMatches: true })), st).toEqual({ next: g, actions: [] });
      }
    },
    'a full renewal: active, draining, checkpointed, clearing, ended; the next carded, probing, active': () => {
      const r = runChain(m, m.GEN_ACTIVE, [ev('due', { cls: 'soft' }), ev('drained'), ev('handover'), ev('host-ended'),
        ev('started', { resumed: false }), ev('card-read', { hashMatches: true }), ev('probes', { passed: false }), ev('probes', { passed: true })]);
      expect(r.views.map((v) => v.state)).toEqual(['draining', 'checkpointed', 'clearing', 'clearing', 'ended', 'probing', 'probing', 'active']);
      expect(r.views.at(-1)).toEqual(m.GEN_ACTIVE);
    },
  };
}

const GEN_SET: MutantSet<GenModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationMachine.ts'),
  mutants: [
    { id: 'G1', old: "if (e.kind === 'card-read' && e.hashMatches) return", new: "if (e.kind === 'card-read') return" },
    { id: 'G2', old: "if (e.passed) return to(GEN_ACTIVE, 'active', ['release-deliveries']);", new: "if (e.passed || g.probeRounds >= 1) return to(GEN_ACTIVE, 'active', ['release-deliveries']);" },
    { id: 'G3', old: "  draining: (g, e) => {\n    if (e.kind === 'drained') {\n      return g.cls === 'hard'", new: "  draining: (g, e) => {\n    if (e.kind === 'drained') {\n      return g.cls !== 'soft'" },
    { id: 'G4', old: "if (!g.hostEnded && !e.afterEnd) return back(g);", new: 'if (!e.afterEnd) return back(g);' },
    { id: 'G5', old: "to(GEN_ACTIVE, 'active', ['release-deliveries', 'set-hold-off'])", new: "to(GEN_ACTIVE, 'active', ['release-deliveries'])" },
    { id: 'G6', old: "if (e.kind === 'due' && e.cls === 'hard') return drain(g, 'degraded', 'hard');", new: "if (e.kind === 'due') return drain(g, 'degraded', 'hard');" },
    { id: 'G7', old: "if (e.kind === 'deadline') return g.renudged ? degrade(g) : to(g, 'carded', ['renudge-card'], { renudged: true });", new: "if (e.kind === 'deadline') return degrade(g);" },
    { id: 'G8', old: "return g.probeRounds >= 1 ? degrade(g) :", new: 'return g.probeRounds >= 2 ? degrade(g) :' },
    { id: 'G9', old: "if (e.kind === 'deadline') return g.hostEnded ? degrade(g) : back(g);", new: "if (e.kind === 'deadline') return degrade(g);" },
    { id: 'G10', old: "  ended: (g) => same(g),", new: "  ended: (g, e) => (e.kind === 'started' ? startedHere(g) : same(g))," },
    { id: 'G11', old: "if (e.kind === 'deadline') return g.hostEnded ? degrade(g) : back(g);", new: "if (e.kind === 'deadline') return g.hostEnded ? degrade(g) : g.from === 'degraded' ? degrade(g) : back(g);" },
    { id: 'G14', old: 'const back = (g: GenView): GenStep => (g.proven', new: 'const back = (g: GenView): GenStep => (true' },
    { id: 'G15', old: "proven: g.proven }, 'degraded'", new: "proven: true }, 'degraded'" },
    { id: 'G12', old: "return to(g, 'clearing', ['renew'], { tries: g.tries + 1, hostEnded: true });", new: "return to(g, 'clearing', ['renew', 'renew'], { tries: g.tries + 1, hostEnded: true });" },
    { id: 'G13', old: "    if (e.kind === 'handover' || e.kind === 'deadline') return clear(g);", new: "    if (e.kind === 'handover') return clear(g);\n    if (e.kind === 'deadline') return back(g);" },
  ],
  suite: generationStepCases,
};

/** This plan's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const RENEWAL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/roleOf.ts#roleFactsOf': ROLE_FACTS_SET as MutantSet<never>,
  'server/src/time/observed.ts#observeTime': OBSERVED_SET as MutantSet<never>,
  'server/src/continuity/renewalDue.ts#renewalDue': RENEWAL_DUE_SET as MutantSet<never>,
  'server/src/continuity/softRenewal.ts#softRenewalMay': SOFT_SET as MutantSet<never>,
  'server/src/continuity/softRenewal.ts#earlyWhileAway': EARLY_SET as MutantSet<never>,
  'server/src/continuity/generationMachine.ts#generationStep': GEN_SET as MutantSet<never>,
};
