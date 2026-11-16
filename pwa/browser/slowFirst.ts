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
// least-loaded shard, by the whole-file times `FILE_MS` measured in CI. CI runs three shards since D-8167 (two shards
// had grown to 14 to 19 minutes each); nothing here fixes the count: `shard` reads it from vitest's `--shard=i/n`. A
// file the table does not name costs the table's median, so a new file is placed, never dropped.
// `test/browser-leg.test.ts` pins that each name in both lists is a browser file, so a renamed one reds rather than
// silently dropping out.
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
 *  queue's green run 42805910829 (2026-11-10, jobs 129794853574 and 129794853772, read from the job logs with
 *  `gh run view --job <id> --log`: 82 files, 5,788 s of file time; the two jobs took 18.6 and 16.9 minutes).
 *  The refresh of desktop-polish Task C19 (D-8167), with the leg's third shard: it adds the 11 files the table did not
 *  name (runs-widths, 246 s, among them, which had cost the median) and replaces every other figure. Refresh it from a
 *  newer such log when the leg's shards drift apart. */
export const FILE_MS: Readonly<Record<string, number>> = {
  'ask-inline.browser.test.ts': 573465,
  'wheel-chain.browser.test.ts': 355313,
  'wheel-chain-chip.browser.test.ts': 247571,
  'runs-widths.browser.test.ts': 246075,
  'frame-cost.browser.test.ts': 242586,
  'wheel-chain-well.browser.test.ts': 189513,
  'waiting.browser.test.ts': 182038,
  'waiting-controls.browser.test.ts': 143343,
  'row-fit.browser.test.ts': 142565,
  'chatgpt-sheet.browser.test.ts': 125303,
  'delegation-rows.browser.test.ts': 112642,
  'delegation-adopt-card.browser.test.ts': 106588,
  'drawer-prompt-glyph.browser.test.ts': 102435,
  'refusal-copy.browser.test.ts': 101400,
  'phone-bar.browser.test.ts': 98468,
  'reauth-sheet.browser.test.ts': 97183,
  'session-header.browser.test.ts': 96642,
  'limit-wait-row.browser.test.ts': 93232,
  'programme-box.browser.test.ts': 91681,
  'sign-in-sheet.browser.test.ts': 89874,
  'goals-door-height.browser.test.ts': 89491,
  'instrument-bar.browser.test.ts': 86289,
  'lanes-row.browser.test.ts': 86092,
  'auth-resume.browser.test.ts': 84053,
  'docs-compact-head.browser.test.ts': 82743,
  'single-readers.browser.test.ts': 81380,
  'backup-banner.browser.test.ts': 79869,
  'reader-frame.browser.test.ts': 79309,
  'item-nav.browser.test.ts': 73499,
  'vaul-motion.browser.test.tsx': 71553,
  'accounts-open.browser.test.ts': 70585,
  'refined-phone.browser.test.ts': 69311,
  'connect-sheet.browser.test.ts': 62519,
  'remove-sheet.browser.test.ts': 61597,
  'instrument-desk.browser.test.ts': 58668,
  'sheet-desktop-arm.browser.test.tsx': 58169,
  'accounts-cards.browser.test.ts': 52535,
  'linear-workspaces.browser.test.ts': 50681,
  'sheet-footer.browser.test.tsx': 50292,
  'waiting-doors.browser.test.ts': 46875,
  'name-field.browser.test.tsx': 43693,
  'update-indicator.browser.test.ts': 42294,
  'move-sessions.browser.test.ts': 42167,
  'lazy-screens.browser.test.tsx': 34706,
  'tool-group-fit.browser.test.ts': 34223,
  'tool-well-colour.browser.test.ts': 33010,
  'docs-export.browser.test.ts': 32112,
  'role-fact.browser.test.ts': 31870,
  'reader-lab.browser.test.ts': 31102,
  'one-waiting-page.browser.test.ts': 30644,
  'abandon-sheet.browser.test.ts': 30555,
  'sheet-focus-ring.browser.test.tsx': 30477,
  'transcript-work-card.browser.test.ts': 30111,
  'accounts-openrouter-card.browser.test.ts': 29930,
  'compaction-fold.browser.test.ts': 29210,
  'project-linking-card.browser.test.ts': 28901,
  'content-focus-ring.browser.test.tsx': 27895,
  'chat-width.browser.test.ts': 25306,
  'inspector-hide.browser.test.ts': 24996,
  'chat-colour.browser.test.ts': 24849,
  'disk-banner.browser.test.ts': 24749,
  'ask-surface.browser.test.ts': 24609,
  'account-knob.browser.test.ts': 24049,
  'chat-links.browser.test.ts': 23134,
  'refined-bar.browser.test.ts': 20314,
  'programme-page.browser.test.ts': 18718,
  'fleet-toggle-row.browser.test.ts': 18608,
  'fleet-reconnecting.browser.test.ts': 15903,
  'scope-sweep-card.browser.test.ts': 15810,
  'page-head-focus.browser.test.ts': 15141,
  'account-pool-unavailable.browser.test.ts': 15093,
  'skin-default.browser.test.ts': 14226,
  'palette-search.browser.test.ts': 12644,
  'instrument-group-seen.browser.test.ts': 11676,
  'docs-headers.browser.test.ts': 11662,
  'pane-scope-stop-card.browser.test.ts': 10075,
  'browser-tools-card.browser.test.ts': 10044,
  'review-cap-coord.browser.test.ts': 9478,
  'testbox-card.browser.test.ts': 6868,
  'instrument-fab.browser.test.ts': 6133,
  'caps-dial.browser.test.ts': 4487,
  'roll-idle-card.browser.test.ts': 3461,
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
