// One stall measure (native Docs reader, the reader lab plan of 2026-11-03, Task 7, refinement (j)): `lib/frameGap.ts`,
// R19's longest gap between animation frames, moved so R19's page and the reader lab share it.
import { describe, expect, it } from 'vitest';
import { longestFrameGap } from '../src/lib/frameGap';

/** A frame clock over fixed times that settles `during` as it hands out the last one. */
function clock(times: readonly number[]): { frame: () => Promise<number>; during: Promise<void> } {
  let i = 0;
  let settle: () => void = () => undefined;
  const during = new Promise<void>((resolve) => { settle = resolve; });
  const frame = (): Promise<number> => {
    const t = times[i] ?? times[times.length - 1] ?? 0;
    i += 1;
    if (i >= times.length) settle();
    return Promise.resolve(t);
  };
  return { frame, during };
}

describe('longestFrameGap (reader lab plan, Task 7)', () => {
  it('is the longest gap between two consecutive frames while the work runs', async () => {
    const c = clock([0, 16, 32, 400, 416]);
    expect(await longestFrameGap(c.frame, c.during)).toBe(368);
  });

  it('a work that settles by the first frame answers 0', async () => {
    const c = clock([5]);
    expect(await longestFrameGap(c.frame, c.during)).toBe(0);
  });

  it('a work that rejects ends the measure the same way', async () => {
    let n = 0;
    const frame = (): Promise<number> => Promise.resolve((n += 10));
    const during = Promise.reject(new Error('stopped'));
    expect(await longestFrameGap(frame, during)).toBeGreaterThanOrEqual(0);
  });
});
