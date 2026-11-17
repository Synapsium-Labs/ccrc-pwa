// Overlord W2, overlaps (plan w2-overlaps.md, Task 2 Step 1 and the `pairMoves` properties): Table 2, each case over three
// or more passes with a small applier. The cases live in `overlapsCases.ts` (the mutant sets judge by the same list).
import { describe, it } from 'vitest';
import * as overlaps from '../src/coord/overlaps.js';
import { MOVE_CASES } from './overlapsCases.js';

describe('pairMoves: the episodes of a pair, first match per key (question 8)', () => {
  for (const c of MOVE_CASES) it(c.name, () => c.run(overlaps));
});
