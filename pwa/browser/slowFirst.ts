// The browser leg's file order and its shards. Not a test file (no `*.browser.test.*` in its name);
// `vitest.browser.config.ts` names `SlowFirstSequencer`.
//
// ORDER (desktop polish Task C12, item 11): the files that set the leg's wall time start first. vitest starts the files
// it has no timings for largest first, and CI keeps no timings for this leg (the server shards' `testtimes.json` covers
// the server suite alone), so the three small wheel-chain files started last, at 462 to 589 s, and set the tail.
// Started first, they overlap the rest: simulated on run 40612653530's durations over three workers, 814 s against
// 862 s. Every other file keeps vitest's own order after them.
//
// SHARDS (D-7746): in the merge queue the leg ran as one job whose median was 17.6 min against its 20-minute timeout,
// and 46 of 203 queue jobs were cancelled at that timeout (2026-10-30 to 11-02), each ejecting its entry. CI runs it as
// `--shard=i/n` now, and `shard` below replaces vitest's hash split with a balanced one: longest file first onto the
// least-loaded shard, by the whole-file times `FILE_MS` measured in CI. A file the table does not name costs the
// table's median, so a new file is placed, never dropped. `test/browser-leg.test.ts` pins that each name in both lists
// is a browser file, so a renamed one reds rather than silently dropping out.
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

/** Each file's time in ms, by basename (D-7746): what vitest reported per file in the two browser shards of the merge
 *  queue's green run 42431228712 (2026-11-08, jobs 128580339322 and 128580339350, read from the job logs with
 *  `gh run view --job <id> --log`: 71 files, 4,795 s of file time; the two jobs took 13 and 16 minutes).
 *  The refresh of desktop-polish Task C14 (D-8110, desk-nav Task A review 1646 A7): it adds the 24 files the table did not
 *  name and replaces every other figure. Refresh it from a newer such log when the leg's shards drift apart. */
export const FILE_MS: Readonly<Record<string, number>> = {
  'ask-inline.browser.test.ts': 588837,
  'wheel-chain.browser.test.ts': 354089,
  'frame-cost.browser.test.ts': 253516,
  'wheel-chain-chip.browser.test.ts': 235747,
  'wheel-chain-well.browser.test.ts': 195659,
  'waiting.browser.test.ts': 175368,
  'row-fit.browser.test.ts': 150088,
  'delegation-rows.browser.test.ts': 132208,
  'chatgpt-sheet.browser.test.ts': 119137,
  'programme-box.browser.test.ts': 105965,
  'goals-door-height.browser.test.ts': 104258,
  'drawer-prompt-glyph.browser.test.ts': 100151,
  'session-header.browser.test.ts': 99052,
  'sign-in-sheet.browser.test.ts': 90142,
  'auth-resume.browser.test.ts': 88595,
  'reauth-sheet.browser.test.ts': 88113,
  'item-nav.browser.test.ts': 86404,
  'phone-bar.browser.test.ts': 85581,
  'lanes-row.browser.test.ts': 80121,
  'single-readers.browser.test.ts': 79725,
  'backup-banner.browser.test.ts': 76971,
  'reader-frame.browser.test.ts': 75091,
  'refusal-copy.browser.test.ts': 70100,
  'connect-sheet.browser.test.ts': 67535,
  'accounts-open.browser.test.ts': 67150,
  'vaul-motion.browser.test.tsx': 65545,
  'remove-sheet.browser.test.ts': 60493,
  'instrument-bar.browser.test.ts': 60373,
  'linear-workspaces.browser.test.ts': 51760,
  'accounts-cards.browser.test.ts': 47695,
  'refined-phone.browser.test.ts': 47325,
  'name-field.browser.test.tsx': 45222,
  'sheet-desktop-arm.browser.test.tsx': 42472,
  'move-sessions.browser.test.ts': 42088,
  'instrument-desk.browser.test.ts': 40509,
  'sheet-footer.browser.test.tsx': 39626,
  'update-indicator.browser.test.ts': 39280,
  'tool-group-fit.browser.test.ts': 36977,
  'transcript-work-card.browser.test.ts': 33440,
  'docs-export.browser.test.ts': 29611,
  'lazy-screens.browser.test.tsx': 29250,
  'tool-well-colour.browser.test.ts': 29075,
  'reader-lab.browser.test.ts': 28515,
  'one-waiting-page.browser.test.ts': 27483,
  'ask-surface.browser.test.ts': 26363,
  'content-focus-ring.browser.test.tsx': 25974,
  'compaction-fold.browser.test.ts': 25913,
  'accounts-openrouter-card.browser.test.ts': 24956,
  'account-knob.browser.test.ts': 24295,
  'disk-banner.browser.test.ts': 23825,
  'chat-colour.browser.test.ts': 23756,
  'chat-width.browser.test.ts': 22564,
  'sheet-focus-ring.browser.test.tsx': 22261,
  'chat-links.browser.test.ts': 21785,
  'inspector-hide.browser.test.ts': 18830,
  'account-pool-unavailable.browser.test.ts': 17881,
  'page-head-focus.browser.test.ts': 14812,
  'fleet-toggle-row.browser.test.ts': 14431,
  'refined-bar.browser.test.ts': 14285,
  'scope-sweep-card.browser.test.ts': 13146,
  'palette-search.browser.test.ts': 13003,
  'fleet-reconnecting.browser.test.ts': 12486,
  'docs-compact-head.browser.test.ts': 11347,
  'skin-default.browser.test.ts': 10918,
  'instrument-group-seen.browser.test.ts': 10655,
  'docs-headers.browser.test.ts': 10582,
  'pane-scope-stop-card.browser.test.ts': 9185,
  'testbox-card.browser.test.ts': 5148,
  'caps-dial.browser.test.ts': 4515,
  'instrument-fab.browser.test.ts': 3299,
  'roll-idle-card.browser.test.ts': 2890,
};

/** `files` (paths) with the `SLOW_FIRST` ones first, in that list's order, and the rest in the order given. */
export function slowFirst<T>(files: readonly T[], pathOf: (f: T) => string): T[] {
  const rank = (f: T): number => {
    const at = SLOW_FIRST.indexOf(path.basename(pathOf(f)));
    return at < 0 ? SLOW_FIRST.length : at;
  };
  return files.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(({ f }) => f);
}

/** The median of `times`' values; 1 when it has none, so every file still costs something. */
function median(times: Readonly<Record<string, number>>): number {
  const v = Object.values(times).sort((a, b) => a - b);
  if (v.length === 0) return 1;
  const mid = v.length >> 1;
  const hi = v[mid] ?? 1;
  return v.length % 2 === 1 ? hi : ((v[mid - 1] ?? hi) + hi) / 2;
}

/**
 * Shard `index` of `count` (1-based) of `files`: longest first (ties by basename, then path), each onto the
 * least-loaded shard (ties to the lowest), by `times` (basename -> ms; a file it does not name costs its median).
 * The shards partition `files`: every file lands in exactly one, whatever `times` holds. Returned in the order given.
 */
export function balancedShard<T>(files: readonly T[], index: number, count: number, pathOf: (f: T) => string,
  times: Readonly<Record<string, number>> = FILE_MS): T[] {
  const fallback = median(times);
  const cost = (f: T): number => times[path.basename(pathOf(f))] ?? fallback;
  const order = files.map((f, i) => ({ f, i, c: cost(f), b: path.basename(pathOf(f)), p: pathOf(f) }))
    .sort((a, b) => b.c - a.c || (a.b < b.b ? -1 : a.b > b.b ? 1 : 0) || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  const loads = new Array<number>(count).fill(0);
  const mine = new Set<number>();
  for (const x of order) {
    let at = 0;
    for (let s = 1; s < count; s++) if ((loads[s] ?? 0) < (loads[at] ?? 0)) at = s;
    loads[at] = (loads[at] ?? 0) + x.c;
    if (at === index - 1) mine.add(x.i);
  }
  return files.filter((_, i) => mine.has(i));
}

/** `files` longest first by `times` (a file it does not name costs its median), stable for equal costs. */
export function longestFirst<T>(files: readonly T[], pathOf: (f: T) => string,
  times: Readonly<Record<string, number>> = FILE_MS): T[] {
  const fallback = median(times);
  const cost = (f: T): number => times[path.basename(pathOf(f))] ?? fallback;
  return files.map((f, i) => ({ f, i, c: cost(f) })).sort((a, b) => b.c - a.c || a.i - b.i).map(({ f }) => f);
}

/** vitest's own order (its cache and sizes), then longest first by `FILE_MS` (so a shard's long files start first and
 *  do not set its tail), then `slowFirst`; and `--shard=i/n` split by `balancedShard`. */
export class SlowFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const pathOf = (f: TestSpecification): string => f.moduleId;
    return slowFirst(longestFirst(await super.sort(files), pathOf), pathOf);
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    return balancedShard(files, shard.index, shard.count, (f) => f.moduleId);
  }
}
