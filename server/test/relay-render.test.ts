// The relayed mail's body and its priority (Overlord W2 relay plan, Task A3; RL13, RL18). The cases live in `relayCases.ts`,
// shared with the mutation floors (`sim/relaySets.ts`), and run here against the real module.
import { describe, it } from 'vitest';
import * as relay from '../src/coord/relay.js';
import { relayPriorityCases, renderRelayBodyCases } from './relayCases.js';

const SUITES = {
  'renderRelayBody (RL13: the typed lines, the operator\'s words by id, the part last and fenced)': renderRelayBodyCases,
  'relayPriority (RL18: the class and the place)': relayPriorityCases,
} as const;

for (const [title, cases] of Object.entries(SUITES)) {
  describe(title, () => {
    for (const [name, run] of Object.entries(cases(relay))) it(name, run);
  });
}
