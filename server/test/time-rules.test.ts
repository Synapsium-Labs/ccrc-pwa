import { describe, it, expect } from 'vitest';
import {
  TIMER_MAX_MS, ENTROPY_MIN_BYTES, ENTROPY_MAX_BYTES, ENTROPY_MAX_BOUND,
  checkDelayMs, checkEntropyBytes, checkEntropyBound, wallNotBefore,
} from '../src/time/rules.js';

describe('time rules (Overlord spec §11.5)', () => {
  it('the bounds', () => {
    expect([TIMER_MAX_MS, ENTROPY_MIN_BYTES, ENTROPY_MAX_BYTES, ENTROPY_MAX_BOUND])
      .toEqual([2_147_483_647, 16, 1024, 4_294_967_296]);
  });
  it.each([0, 0.5, 1, 60_000, 2_147_483_647])('a delay of %s ms is kept', (ms) => expect(checkDelayMs(ms)).toBe(ms));
  it.each([-1, 2_147_483_648, NaN, Infinity, -Infinity])('a delay of %s ms is refused',
    (ms) => expect(() => checkDelayMs(ms)).toThrow(RangeError));
  it.each([16, 32, 1024])('%s bytes are drawn', (n) => expect(checkEntropyBytes(n)).toBe(n));
  it.each([0, 15, 1025, 16.5, NaN])('%s bytes are refused', (n) => expect(() => checkEntropyBytes(n)).toThrow(RangeError));
  it.each([1, 2, 8, 2 ** 32])('a bound of %s is kept', (n) => expect(checkEntropyBound(n)).toBe(n));
  it.each([0, -1, 2 ** 32 + 1, 1.5, NaN])('a bound of %s is refused', (n) => expect(() => checkEntropyBound(n)).toThrow(RangeError));
  it('wallNotBefore: rows', () => {
    expect(wallNotBefore(1000, null)).toBe(1000);
    expect(wallNotBefore(1000, 999)).toBe(1000);
    expect(wallNotBefore(1000, 1000)).toBe(1000);
    expect(wallNotBefore(999, 1000)).toBe(1000);    // the clock stepped back: the stored time stands
  });
  it('wallNotBefore: never below either input, always one of them, monotonic in the reading', () => {
    const xs = [0, 1, 999, 1000, 1001, 1_786_000_000_000];
    for (const r of xs) for (const s of [null, ...xs]) {
      const out = wallNotBefore(r, s);
      expect(out).toBeGreaterThanOrEqual(r);
      if (s !== null) expect(out).toBeGreaterThanOrEqual(s);
      expect([r, s]).toContain(out);
      for (const r2 of xs) if (r2 >= r) expect(wallNotBefore(r2, s)).toBeGreaterThanOrEqual(out);
    }
  });
});
