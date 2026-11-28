// The relay's and the nudge's body parsers (Overlord W2 relay plan, Task A1; Table 3, RL14, RL15). The cases live in
// `relayCases.ts`, shared with the mutation floors (`sim/relaySets.ts`), and run here against the real module.
import { describe, it } from 'vitest';
import * as body from '../src/coord/relayBody.js';
import { parseNudgeBodyCases, parseRelayBodyCases } from './relayCases.js';

const SUITES = {
  'parseRelayBody (Table 3: the keys, then each field in order; a closed set of refusals)': parseRelayBodyCases,
  'parseNudgeBody (§4: the nudge\'s five fields)': parseNudgeBodyCases,
} as const;

for (const [title, cases] of Object.entries(SUITES)) {
  describe(title, () => {
    for (const [name, run] of Object.entries(cases(body))) it(name, run);
  });
}
