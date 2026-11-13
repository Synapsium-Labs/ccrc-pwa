// The renewal deciders' oracles and mutant sets (Overlord W1a, renewal deciders plan). Each decider's exhaustive cases
// are written ONCE here, as suite cases over a module: its own test file runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors). A new decider of this
// plan adds its cases and its set here, and nothing else in the floors file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { RUN_KINDS, type ChildMark } from '../../../shared/api.js';
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
  const { observeTime, observedSince } = m;
  return {
    'null starts at 0, anchored at the mono reading and the process': () => {
      expect(observeTime(null, 5_000, 'p1')).toEqual({ ms: 0, mono: 5_000, proc: 'p1' });
    },
    'the same process, forward: advances by the monotonic delta': () => {
      const a = observeTime(null, 1_000, 'p1');
      expect(observeTime(a, 4_500, 'p1')).toEqual({ ms: 3_500, mono: 4_500, proc: 'p1' });
      expect(observeTime(observeTime(a, 4_500, 'p1'), 4_500, 'p1')).toEqual({ ms: 3_500, mono: 4_500, proc: 'p1' });
    },
    'a new process: no advance, re-anchored on the new reading': () => {
      const a = { ms: 10_000, mono: 90_000, proc: 'p1' };
      expect(observeTime(a, 95_000, 'p2')).toEqual({ ms: 10_000, mono: 95_000, proc: 'p2' });
      expect(observeTime(a, 200, 'p2')).toEqual({ ms: 10_000, mono: 200, proc: 'p2' });
    },
    'mono backwards in one process: no advance, re-anchored': () => {
      expect(observeTime({ ms: 7, mono: 50, proc: 'p1' }, 40, 'p1')).toEqual({ ms: 7, mono: 40, proc: 'p1' });
    },
    'a mono that is not a number never advances, and the next reading re-anchors': () => {
      const a = observeTime({ ms: 7, mono: 50, proc: 'p1' }, Number.NaN, 'p1');
      expect(a.ms).toBe(7);
      expect(observeTime(a, 80, 'p1').ms).toBe(7);
    },
    'observedSince counts the observed milliseconds between two stamps, never below 0': () => {
      const s = { ms: 1_000, mono: 0, proc: 'p1' };
      expect(observedSince(s, { ms: 4_000, mono: 3_000, proc: 'p1' })).toBe(3_000);
      expect(observedSince(s, { ms: 1_000, mono: 9, proc: 'p2' })).toBe(0);
      expect(observedSince({ ms: 5_000, mono: 0, proc: 'p1' }, s)).toBe(0);
    },
    'PROPERTY (1,000 seeded runs): ms never decreases and never exceeds the in-process forward deltas': () => {
      for (let seed = 1; seed <= 1_000; seed++) {
        const r = mulberry32(seed);
        let proc = 'p0'; let mono = Math.floor(r() * 1e6); let o = observeTime(null, mono, proc); let bound = 0; let pnum = 0;
        for (let k = 0; k < 40; k++) {
          const x = r();
          const prev = o; const prevMono = mono; const prevProc = proc;
          if (x < 0.15) { proc = `p${++pnum}`; mono = Math.floor(r() * 1e6); }
          else if (x < 0.25) mono = Math.max(0, mono - Math.floor(r() * 5_000));
          else mono += Math.floor(r() * 100_000);
          if (proc === prevProc && mono >= prevMono) bound += mono - prevMono;
          o = observeTime(prev, mono, proc);
          if (o.ms < prev.ms) throw new Error(`seed ${seed} step ${k}: ms fell from ${prev.ms} to ${o.ms}`);
          if (o.ms > bound) throw new Error(`seed ${seed} step ${k}: ms ${o.ms} exceeds the forward deltas ${bound}`);
          if (o.mono !== mono || o.proc !== proc) throw new Error(`seed ${seed} step ${k}: not re-anchored on the reading`);
        }
      }
    },
  };
}

const OBSERVED_SET: MutantSet<ObservedModule> = {
  modulePath: path.join(ROOT, 'server/src/time/observed.ts'),
  mutants: [
    { id: 'O1', old: 'prev.proc === proc && mono >= prev.mono', new: 'mono >= prev.mono' },
    { id: 'O2', old: 'prev.proc === proc && mono >= prev.mono', new: 'prev.proc === proc' },
    { id: 'O3', old: 'if (prev === null) return { ms: 0, mono, proc };', new: 'if (prev === null) return { ms: mono, mono, proc };' },
    { id: 'O4', old: 'Math.max(0, now.ms - start.ms)', new: 'now.ms - start.ms' },
    { id: 'O5', old: 'return { ms: prev.ms, mono, proc };', new: 'return prev;' },
  ],
  suite: observeTimeCases,
};

/** This plan's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const RENEWAL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/roleOf.ts#roleFactsOf': ROLE_FACTS_SET as MutantSet<never>,
  'server/src/time/observed.ts#observeTime': OBSERVED_SET as MutantSet<never>,
};
