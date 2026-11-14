// The generations piece's deciders, their oracles and mutant sets (Overlord W1a, the generations plan): `startVerdict`
// (what a reported start does to an identity's generations) and `waveBoundaryOf`. The cases are written ONCE here, as
// suite cases over a module: `continuity-generation-start.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { START_SOURCES, type GenerationOutcome, type GenerationState, type StartSource } from '../../../shared/continuity.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { RoleReading } from '../../src/roleOf.js';
import type { StartFacts, StartVerdict } from '../../src/continuity/generationStart.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type GenerationStartModule = typeof import('../../src/continuity/generationStart.js');

const OWN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const T = 1_000_000;

const roles: RoleReading[] = [
  ...(['overlord', 'auditor', 'replay', 'worker', 'reviewer', 'coordinator', 'plain'] as FleetRole[]).map((role) => ({ kind: 'role' as const, role })),
  { kind: 'undecided', between: 'coordinator-or-plain' }, { kind: 'undecided', between: 'worker-or-reviewer' },
];
const registries: StartFacts['registry'][] = [
  { kind: 'absent' },
  { kind: 'row', uuid: OWN, lane: 'lane-a' }, { kind: 'row', uuid: OWN, lane: 'lane-b' },
  { kind: 'row', uuid: OTHER, lane: 'lane-a' }, { kind: 'row', uuid: null, lane: 'lane-a' }, { kind: 'row', uuid: OWN, lane: null },
];
const lives: StartFacts['live'][] = [null,
  ...(['active', 'degraded', 'carded', 'probing', 'draining', 'checkpointed', 'clearing'] as GenerationState[]).flatMap((state) => [
    { state, reportedAt: T - 10, rowIncarnation: 'inc-1', lane: 'lane-a' },
    { state, reportedAt: T - 10, rowIncarnation: 'inc-2', lane: 'lane-a' },
    { state, reportedAt: T + 10, rowIncarnation: 'inc-1', lane: 'lane-a' },
    { state, reportedAt: T, rowIncarnation: null, lane: null },
  ]),
];

/** Every combination: six sources, six registry reads, nine role readings, 29 live rows, two incarnations. */
export function startFactCases(): StartFacts[] {
  const out: StartFacts[] = [];
  for (const source of START_SOURCES as StartSource[])
    for (const registry of registries) for (const role of roles) for (const live of lives)
      for (const rowIncarnation of ['inc-1', null]) out.push({ source, uuid: OWN, reportedAt: T, rowIncarnation, registry, role, live });
  return out;
}

/** The plan's and the reviews' words, written out rather than read off `startVerdict`'s code. */
export function expectedStart(f: StartFacts): StartVerdict {
  const no = (skip: Extract<StartVerdict, { mint: false }>['skip']): StartVerdict => ({ mint: false, skip });
  if (f.source === 'compact' || f.source === 'fork') return no(f.source);
  if (f.registry.kind === 'absent') return no('unregistered');
  if (f.source !== 'startup' && f.registry.uuid === null) return no('uuid-unmeasured');
  if (f.source !== 'startup' && f.registry.uuid !== f.uuid) return no('foreign-uuid');
  if (f.live !== null && f.reportedAt < f.live.reportedAt) return no('late');
  if (f.role.kind === 'undecided') return no('undecided');
  if (!(f.role.role === 'overlord' || f.role.role === 'coordinator')) return no('not-long-lived');
  let outcome: GenerationOutcome = 'woken';
  const old = f.live;
  const lane = f.registry.lane;
  if (old !== null && old.state === 'clearing') outcome = 'renewed';
  else if (old !== null && lane !== null && old.lane !== null && lane !== old.lane) outcome = 'swapped';
  else if (old !== null && old.state === 'active' && f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation) outcome = 'crashed';
  return { mint: true, role: f.role.role, outcome, resumed: f.source === 'resume' };
}

export function startVerdictCases(m: GenerationStartModule): Record<string, SuiteCase> {
  const cases = startFactCases();
  return {
    'enumerates 18792 cases': () => { expect(cases.length).toBe(18_792); },
    'startVerdict answers the plan\'s rules for every case': () => {
      for (const f of cases) {
        const got = m.startVerdict(f);
        const want = expectedStart(f);
        if (JSON.stringify(got) !== JSON.stringify(want)) expect(got, JSON.stringify(f)).toEqual(want);
      }
    },
    'every skip word is reachable, and the long-lived roles are the ones with renewal rows': () => {
      const seen = new Set(cases.map((f) => { const v = m.startVerdict(f); return v.mint ? 'mint' : v.skip; }));
      expect([...seen].sort()).toEqual(['mint', ...m.START_SKIPS].sort());
      expect((['overlord', 'auditor', 'replay', 'worker', 'reviewer', 'coordinator', 'plain'] as FleetRole[]).filter(m.longLived))
        .toEqual(['overlord', 'coordinator']);
    },
  };
}

const runRows = (...xs: [string, string][]): { state: string; program: string }[] => xs.map(([state, program]) => ({ state, program }));

export function waveBoundaryCases(m: GenerationStartModule): Record<string, SuiteCase> {
  return {
    'the newest work run open and the one before it closed, of one programme, is a boundary': () => {
      expect(m.waveBoundaryOf(runRows(['working', 'p'], ['done', 'p']))).toBe(true);
      expect(m.waveBoundaryOf(runRows(['dispatched', 'p'], ['failed', 'p']))).toBe(true);
    },
    'anything else is not': () => {
      expect(m.waveBoundaryOf([])).toBe(false);
      expect(m.waveBoundaryOf(runRows(['working', 'p']))).toBe(false);
      expect(m.waveBoundaryOf(runRows(['working', 'p'], ['working', 'p']))).toBe(false);
      expect(m.waveBoundaryOf(runRows(['done', 'p'], ['done', 'p']))).toBe(false);
      expect(m.waveBoundaryOf(runRows(['done', 'p'], ['working', 'p']))).toBe(false);
      expect(m.waveBoundaryOf(runRows(['working', 'p'], ['done', 'q']))).toBe(false);
    },
  };
}

const START_SET: MutantSet<GenerationStartModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationStart.ts'),
  mutants: [
    { id: 'S1 compact mints', old: "  if (f.source === 'compact') return skip('compact');\n", new: '' },
    { id: 'S2 fork mints', old: "  if (f.source === 'fork') return skip('fork');\n", new: '' },
    { id: 'S3 an unlisted row mints', old: "  if (f.registry.kind === 'absent') return skip('unregistered');\n", new: '' },
    { id: 'S4 startup checked too', old: "  if (f.source !== 'startup') {", new: '  if (true) {' },
    { id: 'S5 no uuid check', old: "    if (f.registry.uuid !== f.uuid) return skip('foreign-uuid');\n", new: '' },
    { id: 'S6 an unreadable uuid passes', old: "    if (f.registry.uuid === null) return skip('uuid-unmeasured');\n", new: '' },
    { id: 'S7 late by receipt only', old: 'f.reportedAt < f.live.reportedAt', new: 'f.reportedAt < f.live.reportedAt - 100' },
    { id: 'S8 late inclusive', old: 'f.reportedAt < f.live.reportedAt', new: 'f.reportedAt <= f.live.reportedAt' },
    { id: 'S9 undecided mints as its first role', old: "  if (f.role.kind === 'undecided') return skip('undecided');\n", new: "  if (f.role.kind === 'undecided') return { mint: true, role: 'coordinator', outcome: startOutcome(f), resumed: false };\n" },
    { id: 'S10 every role long-lived', old: 'return RENEWAL_ROWS[role].length > 0;', new: 'return RENEWAL_ROWS[role] !== undefined;' },
    { id: 'S11 never renewed', old: "if (old.state === 'clearing') return 'renewed';", new: '' },
    { id: 'S12 swap ignored', old: "if (lane !== null && old.lane !== null && lane !== old.lane) return 'swapped';", new: '' },
    { id: 'S13 crash on any state', old: "if (old.state === 'active' && f.rowIncarnation !== null", new: 'if (f.rowIncarnation !== null' },
    { id: 'S14 crash across incarnations', old: ' && f.rowIncarnation === old.rowIncarnation', new: '' },
    { id: 'S15 resumed on every source', old: "resumed: f.source === 'resume'", new: "resumed: f.source !== 'startup'" },
    { id: 'S16 crash before swap', old: "  if (lane !== null && old.lane !== null && lane !== old.lane) return 'swapped';\n  if (old.state === 'active' && f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation) return 'crashed';", new: "  if (old.state === 'active' && f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation) return 'crashed';\n  if (lane !== null && old.lane !== null && lane !== old.lane) return 'swapped';" },
  ],
  suite: startVerdictCases,
};

const WAVE_SET: MutantSet<GenerationStartModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/generationStart.ts'),
  mutants: [
    { id: 'W1 any programme', old: 'newest.program === before.program\n    && ', new: '' },
    { id: 'W2 newest may be closed', old: '!closed(newest.state) && ', new: '' },
    { id: 'W3 before may be open', old: ' && closed(before.state);', new: ';' },
    { id: 'W4 one run is enough', old: 'newest !== undefined && before !== undefined && newest.program === before.program', new: 'newest !== undefined && (before === undefined || newest.program === before.program)' },
  ],
  suite: waveBoundaryCases,
};

/** This plan's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const GENERATION_START_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/generationStart.ts#startVerdict': START_SET as MutantSet<never>,
  'server/src/continuity/generationStart.ts#waveBoundaryOf': WAVE_SET as MutantSet<never>,
};
