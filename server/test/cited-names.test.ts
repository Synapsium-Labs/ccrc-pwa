// Which names the cited words name (Overlord spec C12; W2 relay plan, Task A2, RL8). The cases live in `relayCases.ts`, shared
// with the mutation floors (`sim/relaySets.ts`), and run here against the real module. Fixtures are neutral names only.
import { describe, it } from 'vitest';
import * as cited from '../src/coord/citedNames.js';
import { citedNamesOfCases } from './relayCases.js';

describe('citedNamesOf (RL8: whole tokens on the private-name matcher)', () => {
  for (const [name, run] of Object.entries(citedNamesOfCases(cited))) it(name, run);
});
