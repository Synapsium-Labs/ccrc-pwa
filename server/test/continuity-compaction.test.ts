// `compactInstructionsFor` against its oracle (Overlord W1a compaction, Task 1; spec §3.3.9, C51). The cases live in
// `sim/compactionSets.ts`, where `mutation-floors.test.ts` runs them against each named mutant too.
import { describe, it } from 'vitest';
import * as compactionModule from '../src/continuity/compaction.js';
import { compactInstructionsCases } from './sim/compactionSets.js';

describe('compactInstructionsFor (C51)', () => {
  for (const [name, run] of Object.entries(compactInstructionsCases(compactionModule))) it(name, run);
});
