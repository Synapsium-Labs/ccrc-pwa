// Overlord W1, sequence PR B2 (plan w1-sequence-monitor.md Tasks 4 to 6): the invariant monitor's deciders. The cases live in
// `sim/invariantSets.ts`, shared with the mutation floors, and run here against the real module.
import { describe, it } from 'vitest';
import * as invariants from '../src/coord/invariants.js';
import {
  findingMovesCases, i17Cases, i2Cases, i5Cases, i7Cases, invariantPassDueCases, invariantVerdictCases, latchedOfCases, verdictWordChangesCases,
} from './sim/invariantSets.js';

const SUITES = {
  'invariantVerdict (Task 4: the table, one row per invariant of Table 11.7a)': invariantVerdictCases,
  'I2, the structural arm': i2Cases,
  'I5, the term arm': i5Cases,
  'I7, read only under a coherent guard, over Confirm\'s two sides': i7Cases,
  'I17, the timers against their mail by mailId': i17Cases,
  'findingMoves (Task 6: what a pass records and resolves)': findingMovesCases,
  'invariantPassDue (Task 6: the head moved, the mode moved, or the table sweep elapsed)': invariantPassDueCases,
  'latchedOf (Task 6: how a live finding\'s latch stood)': latchedOfCases,
  'verdictWordChanges (Task 6: one log line per moved word)': verdictWordChangesCases,
} as const;

for (const [title, cases] of Object.entries(SUITES)) {
  describe(title, () => {
    for (const [name, run] of Object.entries(cases(invariants))) it(name, run);
  });
}
