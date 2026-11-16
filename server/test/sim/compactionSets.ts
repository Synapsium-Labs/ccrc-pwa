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
export type PrecompactModule = typeof import('../../src/continuity/precompact.js');

/** The history instruction every text ends with (C51), written out so this oracle does not read the table it judges. */
export const HISTORY_INSTRUCTION = 'End the summary with the history node of this conversation and the line: check what you recall against ccrc history or the server before you act on it.';

export function compactInstructionsCases(m: CompactionModule): Record<string, SuiteCase> {
  return {
    'total: every role answers a text, one line of printable ASCII, at most 600 characters, no quote character or semicolon': () => {
      for (const r of FLEET_ROLE_NAMES) {
        const t = m.compactInstructionsFor(r);
        expect(typeof t, r).toBe('string');
        expect(t, r).toMatch(/^[\x20-\x7e]+$/);
        expect(t.length, r).toBeLessThanOrEqual(600);
        expect(t, r).not.toMatch(/['"`\\$;]/);
      }
    },
    'every text ends with the history instruction, drops tool output and follows the operator\'s standing instructions (C51)': () => {
      for (const r of FLEET_ROLE_NAMES) {
        expect(m.compactInstructionsFor(r).endsWith(HISTORY_INSTRUCTION), r).toBe(true);
        expect(m.compactInstructionsFor(r), r).toContain('Drop tool output');
        // the departure compaction-text-follows-standing-instructions: C51's clause, which the plan's Task 1 texts left out
        expect(m.compactInstructionsFor(r), r).toContain('Drop tool output, and follow any standing compaction instructions the operator gave.');
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

/** One row of the refusal arm's table: the four inputs and the verdict. `scope` is the hook's scope verdict (null: none);
 *  `field` the route field's word (null: absent); `refused` whether a refusal is on record for this turn. */
export interface PrecompactRow { readonly trigger: string | null; readonly scope: string | null; readonly field: string | null; readonly refused: boolean; readonly verdict: 'refuse' | 'pass' }
const row = (trigger: string | null, scope: string | null, field: string | null, refused: boolean, verdict: 'refuse' | 'pass'): PrecompactRow =>
  ({ trigger, scope, field, refused, verdict });
/** The parity table (Task 4, Step 1): every row runs through `precompactDecision` here and through the hook's bash arm in
 *  `session-hook-precompact-refuse.test.ts`, which builds each input as a fixture. Written out, not computed, so the
 *  oracle is not the code it judges. One `refuse` row; every other row changes one input from it, or two. */
export const PRECOMPACT_PARITY: readonly PrecompactRow[] = [
  row('auto', 'main', 'refuse', false, 'refuse'),
  row('auto', 'main', 'refuse', true, 'pass'),         // once a turn (R11)
  row('auto', 'main', null, false, 'pass'),            // dark: the field absent
  row('auto', 'main', 'allow', false, 'pass'),
  row('auto', 'main', 'bogus', false, 'pass'),         // a word the field does not take
  row('manual', 'main', 'refuse', false, 'pass'),      // a manual /compact always passes
  row('other', 'main', 'refuse', false, 'pass'),       // a trigger that is neither word
  row(null, 'main', 'refuse', false, 'pass'),          // no trigger at all
  row('auto', 'subagent', 'refuse', false, 'pass'),    // R7a
  row('auto', 'ambiguous', 'refuse', false, 'pass'),   // R7a
  row('auto', null, 'refuse', false, 'pass'),          // the scope rule could not decide
  row('auto', 'subagent', 'refuse', true, 'pass'),
  row('manual', 'main', null, false, 'pass'),
  row('auto', 'ambiguous', null, true, 'pass'),
];

export function precompactDecisionCases(m: PrecompactModule): Record<string, SuiteCase> {
  return {
    'the parity table: one refusing row, and every change of one input from it passes': () => {
      for (const r of PRECOMPACT_PARITY) expect(m.precompactDecision(r.trigger, r.scope, r.field, r.refused), JSON.stringify(r)).toBe(r.verdict);
    },
    'only auto, main, refuse and not yet refused this turn refuses, over the whole product of the inputs': () => {
      for (const trigger of ['auto', 'manual', 'other', 'idle', '', null]) for (const scope of ['main', 'subagent', 'ambiguous', '', null])
        for (const field of ['refuse', 'allow', 'Refuse', '', null]) for (const refused of [false, true]) {
          const want = trigger === 'auto' && scope === 'main' && field === 'refuse' && !refused ? 'refuse' : 'pass';
          expect(m.precompactDecision(trigger, scope, field, refused), JSON.stringify([trigger, scope, field, refused])).toBe(want);
        }
    },
  };
}

const PRECOMPACT_SET: MutantSet<PrecompactModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/precompact.ts'),
  mutants: [
    // R11's named mutants: manual is refused; refusedThisTurn is ignored; an absent field refuses; a subagent or
    // ambiguous scope refuses.
    { id: 'P1', old: "trigger === 'auto'", new: 'trigger !== null' },
    { id: 'P2', old: " && !refusedThisTurn ? 'refuse'", new: " ? 'refuse'" },
    { id: 'P3', old: "field === 'refuse'", new: "field !== 'allow'" },
    { id: 'P4', old: "scope === 'main'", new: 'scope !== null' },
  ],
  suite: precompactDecisionCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const COMPACTION_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/compaction.ts#compactInstructionsFor': COMPACT_INSTRUCTIONS_SET as MutantSet<never>,
  'server/src/continuity/precompact.ts#precompactDecision': PRECOMPACT_SET as MutantSet<never>,
};
