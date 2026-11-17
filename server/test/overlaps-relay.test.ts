// Overlord W2, overlaps (plan w2-overlaps.md, Task 2 Steps 2 and 3): `pairBlocks`, `blockingPairs` and the relay's verdict
// (Table 3). The cases live in `overlapsCases.ts` (the mutant sets judge by the same list).
import { describe, it } from 'vitest';
import * as overlaps from '../src/coord/overlaps.js';
import { BLOCK_CASES, VERDICT_CASES } from './overlapsCases.js';

describe('pairBlocks and blockingPairs (question 7)', () => {
  for (const c of BLOCK_CASES) it(c.name, () => c.run(overlaps));
});
describe('relayConflictVerdict (Table 3, question 1)', () => {
  for (const c of VERDICT_CASES) it(c.name, () => c.run(overlaps));
});
