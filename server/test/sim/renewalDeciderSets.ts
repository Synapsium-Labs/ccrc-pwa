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

/** This plan's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const RENEWAL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/roleOf.ts#roleFactsOf': ROLE_FACTS_SET as MutantSet<never>,
};
