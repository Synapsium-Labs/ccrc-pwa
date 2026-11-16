// `precompactDecision` against its oracle (Overlord W1a compaction, Task 4; spec §3.3.4, C39; rulings R7a, R11). The
// cases live in `sim/compactionSets.ts`, where `mutation-floors.test.ts` runs them against each named mutant, and the
// parity table there runs through the hook's bash arm too (`session-hook-precompact-refuse.test.ts`).
import { describe, it } from 'vitest';
import * as precompactModule from '../src/continuity/precompact.js';
import { precompactDecisionCases } from './sim/compactionSets.js';

describe('precompactDecision (C39, R7a, R11)', () => {
  for (const [name, run] of Object.entries(precompactDecisionCases(precompactModule))) it(name, run);
});
