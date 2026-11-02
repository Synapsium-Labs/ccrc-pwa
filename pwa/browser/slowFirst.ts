// The browser leg's file order and its split into CI legs. Not a test file (no `*.browser.test.*` in its name);
// `vitest.browser.config.ts` names `SlowFirstSequencer`.
//
// ORDER (desktop polish Task C12, item 11). vitest starts the files it has no timings for largest first, and CI keeps
// no timings for this leg (the server shards' `testtimes.json` covers the server suite alone), so the three small
// wheel-chain files started last, at 462 to 589 s, and set the tail. Started first, they overlap the rest. The order
// was a hand-kept list of four names; it now reads `MEASURED_SECONDS` (`browser/legs.ts`), the one record of what
// each file costs, so every leg starts its own slowest files first, whichever they are. A file with no measured time
// starts before every measured one, as vitest's own rule starts an unknown file first: a slow new file started last
// would set the tail, and a fast one started first costs a worker a few seconds. Ties keep vitest's own order.
//
// SPLIT (2026-11-02). Under `--shard=<i>/<n>` vitest asks the sequencer which files are leg i, handing it every file
// it collected; `legOf` answers with the time-balanced split instead of vitest's hash split. Each leg prints its files
// and their measured seconds to stderr, so a leg's log says what it ran and what the split expected of it.
// `test/browser-leg.test.ts` pins that every measured name is a browser file, so a renamed one reds rather than
// silently turning unmeasured, and `test/browser-legs.test.ts` that the legs partition what vitest collects.
import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { MEASURED_SECONDS, legOf, legSeconds, secondsOf } from './legs.js';

/** Every measured file, slowest first (ties by name). */
export const SLOW_FIRST: readonly string[] = Object.keys(MEASURED_SECONDS)
  .sort((a, b) => MEASURED_SECONDS[b]! - MEASURED_SECONDS[a]! || (a < b ? -1 : a > b ? 1 : 0));

/** `files` with the unmeasured ones first, in the order given, then the measured ones slowest first. `pathOf` gives
 *  a file's path relative to the pwa package (`browser/<name>`). */
export function slowFirst<T>(files: readonly T[], pathOf: (f: T) => string): T[] {
  const rank = (f: T): number => {
    const at = SLOW_FIRST.indexOf(pathOf(f));
    return at < 0 ? -1 : at;
  };
  return files.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(({ f }) => f);
}

/** A spec's path relative to the package root, with forward slashes: the key `MEASURED_SECONDS` and `legOf` use. */
function relativeTo(root: string, moduleId: string): string {
  return path.relative(root, moduleId).split(path.sep).join('/');
}

/** vitest's own order (its cache and sizes), then `slowFirst`; under `--shard`, the time-balanced leg. */
export class SlowFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const root = this.ctx.config.root;
    return slowFirst(await super.sort(files), (f) => relativeTo(root, f.moduleId));
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    if (shard === undefined) return files;
    const paths = files.map((f) => relativeTo(root, f.moduleId));
    const byPath = new Map(files.map((f, i) => [paths[i]!, f]));
    // Every collected path, duplicates included: `splitLegs` refuses a path collected twice.
    const leg = legOf(paths, shard.index, shard.count);
    process.stderr.write(`browser leg ${shard.index}/${shard.count}: ${leg.length} of ${files.length} files, `
      + `${legSeconds(leg)} s measured\n${leg.map((f) => `  ${f} ${secondsOf(f)} s${f in MEASURED_SECONDS ? '' : ' (unmeasured)'}\n`).join('')}`);
    return leg.map((f) => byPath.get(f)!);
  }
}
