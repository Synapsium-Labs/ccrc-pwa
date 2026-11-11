// D-8277: the suite's one clock scale for a slow environment (`timeScale.ts`). The map's traced runs set it
// (`.github/ci/trace-run.mjs`, `TRACE_TIME_SCALE`); everywhere else it is unset and every budget is its literal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIME_SCALE_ENV, parseTimeScale, scaledBy, scaledSecondsBy } from './timeScale.js';
import { TRACE_TIME_SCALE, tracedEnv } from '../../.github/ci/trace-run.mjs';

describe('timeScale: one scale for every time budget, read from CCRC_TIME_SCALE (D-8277)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('unset or empty reads as 1: an ordinary run keeps every literal budget', () => {
    expect(parseTimeScale(undefined)).toBe(1);
    expect(parseTimeScale('')).toBe(1);
    expect(scaledBy(1)(20_000)).toBe(20_000);
    expect(scaledSecondsBy(1)(900)).toBe(900);
  });

  it('a number at or above 1 is the scale; a budget is multiplied and rounded UP, never shortened', () => {
    expect(parseTimeScale('10')).toBe(10);
    expect(parseTimeScale('2.5')).toBe(2.5);
    expect(scaledBy(10)(60_000)).toBe(600_000);
    expect(scaledBy(2.5)(3)).toBe(8);
    expect(scaledSecondsBy(2.5)(5)).toBe(13);
  });

  it('a scale that would SHORTEN a budget, or is not a number, is refused loudly rather than read as 1', () => {
    for (const bad of ['0.5', '0', '-2', 'abc', 'NaN', 'Infinity', '1e999']) {
      expect(() => parseTimeScale(bad), bad).toThrow(new RegExp(`${TIME_SCALE_ENV}=`));
    }
  });

  it('the suite\'s own timeouts follow it: vitest.config.ts multiplies testTimeout and hookTimeout', async () => {
    vi.stubEnv(TIME_SCALE_ENV, '3');
    vi.resetModules();
    const base = (process.platform === 'darwin' ? 90_000 : 20_000) * 3;
    const { default: config } = await import('../vitest.config.js');
    expect(config.test?.testTimeout).toBe(base);
    expect(config.test?.hookTimeout).toBe(base);
  });

  it('a traced run sets it: trace-run hands every traced vitest the scale, under this variable, above 1', () => {
    const env = tracedEnv({}, '/w/list.txt');
    expect(env[TIME_SCALE_ENV]).toBe(String(TRACE_TIME_SCALE));
    expect(parseTimeScale(env[TIME_SCALE_ENV])).toBeGreaterThan(1);
  });
});
