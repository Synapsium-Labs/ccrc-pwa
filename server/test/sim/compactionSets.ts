// The compaction piece's oracles and mutant sets (Overlord W1a, `docs/superpowers/plans/2026-11-10-overlord/w1a-compaction.md`).
// Each decider's cases are written ONCE here, as suite cases over a module: the piece's own suites run them against the
// real module, and `mutation-floors.test.ts` runs them against each named mutant (ruling R11, D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { FLEET_ROLE_NAMES } from '../../../shared/fleetRoles.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type CompactionModule = typeof import('../../src/continuity/compaction.js');

/** The history instruction every text ends with (C51), written out so this oracle does not read the table it judges. */
export const HISTORY_INSTRUCTION = 'End the summary with the history node of this conversation and the line: check what you recall against ccrc history or the server before you act on it.';

export function compactInstructionsCases(m: CompactionModule): Record<string, SuiteCase> {
  return {
    'total: every role answers a text, one line of printable ASCII, at most 600 characters, no quote character': () => {
      for (const r of FLEET_ROLE_NAMES) {
        const t = m.compactInstructionsFor(r);
        expect(typeof t, r).toBe('string');
        expect(t, r).toMatch(/^[\x20-\x7e]+$/);
        expect(t.length, r).toBeLessThanOrEqual(600);
        expect(t, r).not.toMatch(/['"`\\$]/);
      }
    },
    'every text ends with the history instruction and drops tool output (C51)': () => {
      for (const r of FLEET_ROLE_NAMES) {
        expect(m.compactInstructionsFor(r).endsWith(HISTORY_INSTRUCTION), r).toBe(true);
        expect(m.compactInstructionsFor(r), r).toContain('Drop tool output');
      }
    },
    'auditor and replay take plain\'s text; the other five are five texts': () => {
      expect(m.compactInstructionsFor('auditor')).toBe(m.compactInstructionsFor('plain'));
      expect(m.compactInstructionsFor('replay')).toBe(m.compactInstructionsFor('plain'));
      const five = (['overlord', 'coordinator', 'worker', 'reviewer', 'plain'] as const).map((r) => m.compactInstructionsFor(r));
      expect(new Set(five).size).toBe(5);
    },
    'each text names its role and keeps what C51 lists for it': () => {
      const c = m.compactInstructionsFor('coordinator');
      expect(c.startsWith('Compaction instructions (coordinator): ')).toBe(true);
      for (const k of ['run id', 'plan path', 'claim id', 'ruling with its date', 'open ask and item id', 'mail you have not answered']) expect(c).toContain(k);
      for (const r of ['worker', 'reviewer'] as const) {
        const w = m.compactInstructionsFor(r);
        expect(w.startsWith(`Compaction instructions (${r}): `), r).toBe(true);
        for (const k of ['plan path', 'task and step', 'failing test or command', 'deviation slug or number', 'branch tip sha']) expect(w, r).toContain(k);
        expect(w, r).not.toContain('run id');
      }
      const o = m.compactInstructionsFor('overlord');
      expect(o.startsWith('Compaction instructions (overlord): ')).toBe(true);
      for (const k of ['run id', 'mail you have not answered', 'request id', 'operator message id']) expect(o).toContain(k);
      const p = m.compactInstructionsFor('plain');
      expect(p.startsWith('Compaction instructions (plain): ')).toBe(true);
      expect(p).toContain('every instruction the operator gave');
    },
  };
}

const COMPACT_INSTRUCTIONS_SET: MutantSet<CompactionModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/compaction.ts'),
  mutants: [
    // R11's named mutants: every role answers plain's text; coordinator and worker swap texts.
    { id: 'C1', old: 'return FLEET_ROLES[role].compactInstructions;', new: 'return FLEET_ROLES.plain.compactInstructions;' },
    { id: 'C2', old: 'return FLEET_ROLES[role].compactInstructions;', new: "return FLEET_ROLES[role === 'coordinator' ? 'worker' : role === 'worker' ? 'coordinator' : role].compactInstructions;" },
  ],
  suite: compactInstructionsCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const COMPACTION_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/compaction.ts#compactInstructionsFor': COMPACT_INSTRUCTIONS_SET as MutantSet<never>,
};
