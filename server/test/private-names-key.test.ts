// The private-name matcher under a key (Overlord W2 private names, PR A, Tasks 2 and 3; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-private-names.md). The cases live once in `sim/privateNamesSets.ts`,
// whose mutant set runs them against each mutant in `sim/mutation-floors.test.ts`; here they run against the real module.
import { describe, it } from 'vitest';
import * as names from '../../shared/private-names.mjs';
import { keyCases } from './sim/privateNamesSets.js';

describe('the key threads through every hash of the matcher', () => {
  for (const [name, run] of Object.entries(keyCases(names))) it(name, run);
});
