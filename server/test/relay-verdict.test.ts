// The relay's own checks and the one helper that drops a path's project (Overlord W2 relay plan, Task A2; Table 6, RL3, RL4,
// RL5, RL7). The cases live in `relayCases.ts`, shared with the mutation floors (`sim/relaySets.ts`), and run here against the
// real modules.
import { describe, it } from 'vitest';
import * as relay from '../src/coord/relay.js';
import * as overlaps from '../src/coord/overlaps.js';
import { relayFactsOfCases, relayVerdictCases } from './relayCases.js';

describe('relayVerdict (Table 6, first match)', () => {
  for (const [name, run] of Object.entries(relayVerdictCases(relay))) it(name, run);
});

describe('relayFactsOf (RL4: the one place the project is dropped)', () => {
  for (const [name, run] of Object.entries(relayFactsOfCases(overlaps))) it(name, run);
});
