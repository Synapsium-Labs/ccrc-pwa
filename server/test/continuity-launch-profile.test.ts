// server/test/continuity-launch-profile.test.ts
//
// `compactThresholdFor` (Overlord W1a launch profiles, Task 4; spec §3.3.4, C39): the auto-compact point of a long-lived
// role, from its launch profile and its measured window. The cases live in `sim/launchProfileSets.ts`, so the mutation
// floor (`sim/mutation-floors.test.ts`) runs the same oracle against each mutant. The hard cap is read from the renewal
// deciders (`hardCapTokens`); `single-definition/` holds it to that one definition.
import { describe, it } from 'vitest';
import * as launchProfileModule from '../src/continuity/launchProfile.js';
import { compactThresholdCases } from './sim/launchProfileSets.js';

describe('compactThresholdFor (C39)', () => {
  for (const [name, run] of Object.entries(compactThresholdCases(launchProfileModule))) it(name, run);
});
