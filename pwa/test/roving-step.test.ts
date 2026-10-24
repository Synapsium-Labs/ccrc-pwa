// The roving stepper (T2c, D-6329): the one step an arrow key, Home or End takes across n items. Pinned on the move
// from FleetTable's `STEP` and `rovingKey`, then given the `wrap: false` arm the lanes row's cards need.
import { describe, expect, it } from 'vitest';
import { rovingStep } from '../src/lib/rovingStep';

describe('rovingStep', () => {
  it('an arrow steps to the next and the previous, Home and End to the ends', () => {
    expect(rovingStep('ArrowRight', 1, 4, { wrap: true })).toBe(2);
    expect(rovingStep('ArrowDown', 1, 4, { wrap: true })).toBe(2);
    expect(rovingStep('ArrowLeft', 2, 4, { wrap: true })).toBe(1);
    expect(rovingStep('ArrowUp', 2, 4, { wrap: true })).toBe(1);
    expect(rovingStep('Home', 2, 4, { wrap: true })).toBe(0);
    expect(rovingStep('End', 1, 4, { wrap: true })).toBe(3);
  });

  it('with wrap, a step past either end comes round', () => {
    expect(rovingStep('ArrowRight', 3, 4, { wrap: true })).toBe(0);
    expect(rovingStep('ArrowDown', 3, 4, { wrap: true })).toBe(0);
    expect(rovingStep('ArrowLeft', 0, 4, { wrap: true })).toBe(3);
    expect(rovingStep('ArrowUp', 0, 4, { wrap: true })).toBe(3);
  });

  it('without wrap, a step past either end stays', () => {
    expect(rovingStep('ArrowRight', 3, 4, { wrap: false })).toBe(3);
    expect(rovingStep('ArrowDown', 3, 4, { wrap: false })).toBe(3);
    expect(rovingStep('ArrowLeft', 0, 4, { wrap: false })).toBe(0);
    expect(rovingStep('ArrowUp', 0, 4, { wrap: false })).toBe(0);
    // inside the ends it steps as with wrap, and Home and End still go to the ends
    expect(rovingStep('ArrowRight', 1, 4, { wrap: false })).toBe(2);
    expect(rovingStep('ArrowLeft', 2, 4, { wrap: false })).toBe(1);
    expect(rovingStep('Home', 2, 4, { wrap: false })).toBe(0);
    expect(rovingStep('End', 1, 4, { wrap: false })).toBe(3);
  });

  it('any other key is null', () => {
    for (const wrap of [true, false]) {
      expect(rovingStep('Enter', 1, 4, { wrap })).toBeNull();
      expect(rovingStep('a', 1, 4, { wrap })).toBeNull();
      expect(rovingStep('Tab', 1, 4, { wrap })).toBeNull();
    }
  });
});
