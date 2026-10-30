// The browser leg's file order: the files that set its wall time start first (desktop polish Task C12, item 11). Not a
// test file (no `*.browser.test.*` in its name); `vitest.browser.config.ts` names `SlowFirstSequencer`.
//
// vitest starts the files it has no timings for largest first, and CI keeps no timings for this leg (the server
// shards' `testtimes.json` covers the server suite alone), so the three small wheel-chain files started last, at 462 to
// 589 s, and set the tail. Started first, they overlap the rest: simulated on run 40612653530's durations over three
// workers, 814 s against 862 s. Every other file keeps vitest's own order after them. `test/browser-leg.test.ts` pins
// that each name is a browser file, so a renamed one reds rather than silently dropping out of the list.
import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** Slowest first, as CI's browser leg measured them (run 40612653530): wheel-chain 400 s, ask-inline 383 s,
 *  wheel-chain-chip 255 s, wheel-chain-well 221 s. */
export const SLOW_FIRST: readonly string[] = [
  'wheel-chain.browser.test.ts',
  'ask-inline.browser.test.ts',
  'wheel-chain-chip.browser.test.ts',
  'wheel-chain-well.browser.test.ts',
];

/** `files` (paths) with the `SLOW_FIRST` ones first, in that list's order, and the rest in the order given. */
export function slowFirst<T>(files: readonly T[], pathOf: (f: T) => string): T[] {
  const rank = (f: T): number => {
    const at = SLOW_FIRST.indexOf(path.basename(pathOf(f)));
    return at < 0 ? SLOW_FIRST.length : at;
  };
  return files.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(({ f }) => f);
}

/** vitest's own order (its cache and sizes), then `slowFirst`. */
export class SlowFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return slowFirst(await super.sort(files), (f) => f.moduleId);
  }
}
