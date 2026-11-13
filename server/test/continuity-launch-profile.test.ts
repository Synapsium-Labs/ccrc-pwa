// server/test/continuity-launch-profile.test.ts
//
// `compactThresholdFor` (Overlord W1a launch profiles, Task 4; spec §3.3.4, C39): the auto-compact point of a long-lived
// role, from its launch profile and its measured window. The cases live in `sim/launchProfileSets.ts`, so the mutation
// floor (`sim/mutation-floors.test.ts`) runs the same oracle against each mutant.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as launchProfileModule from '../src/continuity/launchProfile.js';
import { compactThresholdCases } from './sim/launchProfileSets.js';

describe('compactThresholdFor (C39)', () => {
  for (const [name, run] of Object.entries(compactThresholdCases(launchProfileModule))) it(name, run);

  it('reads the hard cap from the renewal deciders, never a second copy of it', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/continuity/launchProfile.ts'), 'utf8');
    expect(src).toContain("import { hardCapTokens } from './renewalDue.js';");
    expect(src).not.toMatch(/250_?000/);
  });
});
