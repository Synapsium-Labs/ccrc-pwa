// `mayActW2`, W2's one door into the decider (Overlord W2, the act catalogue B; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` Task B3, F9, the index's question 27). Its cases live once
// in `sim/mayActSets.ts#mayActW2Cases`, which the mutation floors also run against each mutant: whatever the gathered object
// carries, the decider sees no grant, no command, no stated entry, no answer verdicts, no grant facts and an unmeasured arming.
import { describe, it } from 'vitest';
import * as w2 from '../src/coord/overlordMayActW2.js';
import { mayActW2Cases } from './sim/mayActW2Sets.js';

describe('mayActW2: the dormant branches stay dormant (question 27)', () => {
  for (const [name, run] of Object.entries(mayActW2Cases(w2))) it(name, run);
});
