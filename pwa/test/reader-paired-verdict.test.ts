import { describe, expect, it } from 'vitest';
import { readerPairedControlPasses, readerPairedVerdict, type ReaderTimingPair } from '../browser/reader-paired-verdict';

function pairs(baseMs: number, candidateMs: number, count = 20): ReaderTimingPair[] {
  return Array.from({ length: count }, () => ({ baseMs, candidateMs }));
}

const controls = { opening: [0.97, 1], closing: [1, 1.03] } as const;

describe('D-9030 within-pair reader verdict', () => {
  it('passes at the ceiling using the median of pair ratios, not the ratio of arm medians', () => {
    // The ratio of arm medians is 167 / 150, which would wrongly fail.
    const reading = [...pairs(100, 106, 10), ...pairs(200, 228, 10)];
    expect(readerPairedVerdict('mode-only', reading, controls)).toMatchObject({ figure: 1.10, ceiling: 1.10, verdict: 'pass' });
  });

  it('returns mode-only red above the ceiling when all four controls pass', () => {
    expect(readerPairedVerdict('mode-only', pairs(100, 111), controls)).toMatchObject({ figure: 1.11, ceiling: 1.10, verdict: 'red' });
  });

  it('passes hosted at 30 ms using median per-pair differences, not the difference of arm medians', () => {
    // The arm medians are 100 and 230 ms; most pairs differ by only 30 ms.
    const reading = [...pairs(100, 130, 8), ...pairs(200, 230, 8), ...pairs(100, 260, 4)];
    expect(readerPairedVerdict('hosted', reading, controls)).toMatchObject({ figure: 30, ceiling: 30, verdict: 'pass' });
  });

  it('refers a counted hosted overrun with BASE and ratio evidence instead of declaring a red', () => {
    expect(readerPairedVerdict('hosted', pairs(150, 181), controls)).toMatchObject({
      figure: 31, ceiling: 30, baseMedian: 150, ratio: expect.closeTo(1.206667, 6), verdict: 'hosted-over',
    });
  });

  it.each([
    { opening: [0.969, 1], closing: [1, 1] },
    { opening: [1, 1.031], closing: [1, 1] },
    { opening: [1, 1], closing: [0.969, 1] },
    { opening: [1, 1], closing: [1, 1.031] },
  ] as const)('records but does not count the row if any same-build control misses its bounds (%j)', (failed) => {
    expect(readerPairedVerdict('mode-only', pairs(100, 120), failed)).toMatchObject({ figure: 1.20, verdict: 'not-counted' });
    expect(readerPairedVerdict('hosted', pairs(100, 140), failed)).toMatchObject({ figure: 40, verdict: 'not-counted' });
  });

  it('rejects a same-build control when one arm is delayed by a known 10 ms', () => {
    const sameBuild = [...pairs(80, 80, 10), ...pairs(120, 120, 10)];
    const delayed = sameBuild.map(({ baseMs, candidateMs }) => ({ baseMs, candidateMs: candidateMs + 10 }));
    expect(readerPairedControlPasses(sameBuild)).toBe(true);
    expect(readerPairedControlPasses(delayed)).toBe(false);
  });
});
