// The sandbox check (Overlord W1 sandbox PR B, Task 8; spec §3.6 H4, Review Focus 3): `sandboxVerdict` per property, held,
// failed and unmeasured, and `profileEngagedOf`, the ladder's condition input. The cases live in `sim/sandboxSets.ts`, so
// the mutation floor runs the same ones against each mutant.
import { describe, expect, it } from 'vitest';
import * as sandbox from '../src/continuity/sandboxCheck.js';
import { CLAUDE_CODE_OWN_LISTS } from '../../shared/overlord-sandbox.js';
import { launchRowOf } from '../src/continuity/launchProfile.js';
import { BUILD, FIXTURE_OWN_LISTS, sandboxCases } from './sim/sandboxSets.js';

describe('sandboxVerdict and profileEngagedOf (Task 8)', () => {
  for (const [name, run] of Object.entries(sandboxCases(sandbox))) it(name, run);
});

describe('the expected surface comes from the one projection (Review Focus 4)', () => {
  it('its digest, tools, reader types and skills are the overlord row\'s', () => {
    const e = sandbox.expectedSurfaceOf('overlord')!;
    const row = launchRowOf('overlord') as { flags: string[]; stagedSkills: Record<string, string> };
    expect(row.flags[row.flags.indexOf('--tools') + 1]).toBe(e.tools.join(','));
    expect(Object.keys(JSON.parse(row.flags[row.flags.indexOf('--agents') + 1]!) as object)).toStrictEqual([...e.readerTypes]);
    expect(Object.keys(row.stagedSkills)).toStrictEqual([...e.skills]);
  });
  it('the fixture build is one the fixture\'s own lists carry, so the held case is not held by an absent list', () => {
    expect(Object.keys(FIXTURE_OWN_LISTS)).toContain(BUILD);
  });
  it('the fixture lists are isolated: the release\'s table lists no build, the fixture\'s included (review 3325 F4)', () => {
    expect(CLAUDE_CODE_OWN_LISTS).toStrictEqual({});
    expect(sandbox.expectedSurfaceOf('overlord')!.ownLists).toBe(CLAUDE_CODE_OWN_LISTS);
  });
});
