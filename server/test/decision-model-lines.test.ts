// Overlord W2, the decision model's lines, canary, drift and doors (plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Tasks 6 to 8): the L1 deciders in
// `src/coord/decisionLines.ts` against the real module. The cases live in `decisionModelCases.ts`, which the mutation sets
// (`sim/decisionModelSets.ts`) run against each mutant too. `applyDecision` and `gateOutcome` are in
// `ALL_DECISION_MODEL_CASES`, which `decision-model-decide.test.ts` runs; they are named here again so this file alone
// proves Task 8's cases.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as decisionLines from '../src/coord/decisionLines.js';
import * as decisionModel from '../src/coord/decisionModel.js';
import { isDecisionModelWord } from '../src/coord/decisionModel.js';
import { ALL_DECISION_LINES_CASES, APPLY_CASES, GATE_OUTCOME_CASES } from './decisionModelCases.js';

describe('decisionLines.ts: arming direction, lines, canary, drift and the doors (Tasks 6 to 8)', () => {
  it.each(ALL_DECISION_LINES_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => c.run(decisionLines));
});

describe('decisionModel.ts: applying an answer (Task 8)', () => {
  it.each([...APPLY_CASES, ...GATE_OUTCOME_CASES].map((c) => [c.name, c] as const))('%s', (_n, c) => c.run(decisionModel));
});

describe('the words these files spell', () => {
  // mail-routes.test.ts scans every quoted kebab word in server/src/coord and admits each through a declared list. These
  // two files' words come from `isDecisionModelWord`, except the three below, which other declared unions admit.
  const OTHER_UNIONS = new Set(['bad-request', 'authority-rolled-back', 'authority-unmeasured']);
  const here = path.dirname(fileURLToPath(import.meta.url));
  it.each(['decisionLines.ts', 'decisionModel.ts'])('every quoted kebab word of %s is declared', (file) => {
    const src = readFileSync(path.join(here, '../src/coord', file), 'utf8');
    for (const m of src.matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)) {
      const tok = m[1]!;
      expect(isDecisionModelWord(tok) || OTHER_UNIONS.has(tok), tok).toBe(true);
    }
  });
  it('the held causes and the refusal words are decision-model words', () => {
    for (const w of ['off-refused', 'line-key', 'no-key', 'drift', 'canary', 'bound', 'decision-row-unknown', 'bad-endpoint', 'key-required',
      'clear-yes', 'to-operator', 'not-run', 'already-held']) expect(isDecisionModelWord(w), w).toBe(true);
  });
});
