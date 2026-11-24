// Overlord W1 door process A1 (plan `w1-door-process.md` Task 1): `actKeyClaimVerdict`, the claim door's decider. One case
// per arm in its order, the order itself, and the four restarts (a crash respawn, a Restart, a swap landing, a wake), each
// with the old generation still live and the new start not minted: `renewing` (`not-minted`), then `issue` once minted.
// The cases are written once, in `sim/actKeySets.ts`, so `mutation-floors.test.ts` runs the same ones against each mutant.
import { describe, it, expect } from 'vitest';
import * as actKey from '../src/continuity/actKey.js';
import { actKeyCases } from './sim/actKeySets.js';
import { CLAIM_WHYS, isClaimWhy } from '../../shared/continuity-door.js';

describe('actKeyClaimVerdict', () => {
  for (const [name, run] of Object.entries(actKeyCases(actKey))) it(name, run);
});

describe('the claim\'s why words', () => {
  it('are the decider\'s six, in arm order, and nothing else reads as one', () => {
    expect(CLAIM_WHYS).toEqual(['store-unreadable', 'nonce-spent', 'start-unreported', 'superseded', 'not-minted', 'generation-ended']);
    expect(isClaimWhy('renewing')).toBe(false);
  });
});
