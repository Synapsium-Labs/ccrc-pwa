// Overlord W1, sequence C (plan w1-sequence-monitor.md Task 7): the two read doors' deciders. The cases live in
// `sim/sequenceDoorSets.ts`, shared with the mutation floors, and run here against the real module.
import { describe, it } from 'vitest';
import * as door from '../src/coord/overlordSequenceDoor.js';
import { invariantsReadAnswerCases, readSequenceQueryCases, restoreGenerationOfCases, sequenceDoorAnswerCases } from './sim/sequenceDoorSets.js';

const SUITES = {
  'readSequenceQuery (the cursor read\'s closed query)': readSequenceQueryCases,
  'restoreGenerationOf (the restore counter\'s one reader, as the wire\'s word)': restoreGenerationOfCases,
  'sequenceDoorAnswer (page, gap, ahead or unavailable, and the ledger line\'s words)': sequenceDoorAnswerCases,
  'invariantsReadAnswer (the operator\'s read of the monitor)': invariantsReadAnswerCases,
} as const;

for (const [title, cases] of Object.entries(SUITES)) {
  describe(title, () => {
    for (const [name, run] of Object.entries(cases(door))) it(name, run);
  });
}
