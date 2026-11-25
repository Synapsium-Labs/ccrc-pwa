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
// least-loaded shard, by the whole-file times `FILE_MS` measured in CI. CI runs four shards since D-9026 (three since
// D-8167, when two shards had grown to 14 to 19 minutes each; at three the second shard reached 20 minutes); nothing
// here fixes the count: `shard` reads it from vitest's `--shard=i/n`. A file the table does not name costs the table's
// median, so a new file is placed, never dropped.
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

/** Each file's time in ms, by basename (D-7746): what vitest reported per file in the three browser shards of the
 *  merge queue's run 45527962041 (2026-11-25, jobs 138915898214, 138915898216 and 138915898257, read from the job logs
 *  with `gh run view --job <id> --log`: 118 files, 4,333 tests, 7,887 s of file time; every file passed, and the second
 *  shard was cancelled at its 20-minute deadline after its summary line). The refresh of landing-order wave 1e
 *  (D-9026): it names the 36 files the table did not and replaces every other figure.
 *  Before it: the two browser shards of the merge queue's green run 42805910829 (2026-11-10, jobs 129794853574 and
 *  129794853772: 82 files, 5,788 s of file time; the two jobs took 18.6 and 16.9 minutes), the refresh of
 *  desktop-polish Task C19 (D-8167), with the leg's third shard: it added the 11 files the table did not name
 *  (runs-widths, 246 s, among them, which had cost the median) and replaced every other figure. Refresh it from a
 *  newer such log when the leg's shards drift apart. */
export const FILE_MS: Readonly<Record<string, number>> = {
  'ask-inline.browser.test.ts': 524622,
  // Settings › Integrations (#3230) made it 22 cases over every width, skin and theme: 360,336 ms in queue run
  // 45175290557, and 869,850 ms in queue run 45527962041, the one file that took the second of three shards past its
  // 20 minutes (D-9026). Wave 1e divides it in two by its tests' own times in that run: these 12 cases summed 443,250 ms,
  // its -wide sibling the other 10.
  'project-linking-card.browser.test.ts': 443250,
  // The other 10 of the 22 (D-9026): their own times in queue run 45527962041 summed 419,983 ms.
  'project-linking-card-wide.browser.test.ts': 419983,
  'wheel-chain.browser.test.ts': 359131,
  'runs-widths.browser.test.ts': 302464,
  'frame-cost.browser.test.ts': 264200,
  'tool-activity.browser.test.ts': 258536,
  'waiting.browser.test.ts': 249419,
  'wheel-chain-chip.browser.test.ts': 226127,
  'wheel-chain-well.browser.test.ts': 200256,
  'delegation-rows.browser.test.ts': 190628,
  'testbox-manage.browser.test.ts': 179813,
  'waiting-controls.browser.test.ts': 150572,
  'chatgpt-sheet.browser.test.ts': 121316,
  'session-header.browser.test.ts': 111414,
  'auth-resume.browser.test.ts': 104537,
  'linear-items.browser.test.ts': 101473,
  'reader-frame.browser.test.ts': 100500,
  'drawer-prompt-glyph.browser.test.ts': 95054,
  'goals-door-height.browser.test.ts': 94913,
  'item-nav.browser.test.ts': 94706,
  'refusal-copy.browser.test.ts': 93535,
  'delegation-adopt-card.browser.test.ts': 93480,
  'row-fit.browser.test.ts': 91307,
  'reauth-sheet.browser.test.ts': 89898,
  'testbox-connect.browser.test.ts': 89178,
  'docs-compact-head.browser.test.ts': 86816,
  'sign-in-sheet.browser.test.ts': 84294,
  'lanes-row.browser.test.ts': 83416,
  'single-readers.browser.test.ts': 78415,
  'instrument-bar.browser.test.ts': 78082,
  'archive-unowned.browser.test.ts': 74423,
  'docs-mockup.browser.test.ts': 73939,
  'programme-box.browser.test.ts': 72927,
  'phone-bar.browser.test.ts': 69712,
  'backup-banner.browser.test.ts': 69126,
  'accounts-open.browser.test.ts': 67193,
  'archive-claims-sheet.browser.test.ts': 65218,
  'remove-sheet.browser.test.ts': 64849,
  'connect-sheet.browser.test.ts': 59547,
  'limit-wait-row.browser.test.ts': 53939,
  'paste-chips.browser.test.ts': 53790,
  'vaul-motion.browser.test.tsx': 53369,
  'sheet-desktop-arm.browser.test.tsx': 52813,
  'linear-workspaces.browser.test.ts': 50511,
  'docs-mockup-export.browser.test.ts': 48960,
  'accounts-cards.browser.test.ts': 45791,
  'move-sessions.browser.test.ts': 45670,
  'refined-phone.browser.test.ts': 45340,
  'session-panel-words.browser.test.ts': 40413,
  'name-field.browser.test.tsx': 40052,
  'instrument-desk.browser.test.ts': 38098,
  'programme-work-page.browser.test.ts': 34118,
  'mockup-parse.browser.test.ts': 33931,
  'role-fact.browser.test.ts': 33726,
  'confirm-focus.browser.test.ts': 32998,
  'sheet-footer.browser.test.tsx': 31394,
  'tool-well-colour.browser.test.ts': 31351,
  'update-indicator.browser.test.ts': 30046,
  'docs-export.browser.test.ts': 29995,
  'tool-group-fit.browser.test.ts': 29980,
  'abandon-sheet.browser.test.ts': 29857,
  'refined-bar.browser.test.ts': 29362,
  'compaction-fold.browser.test.ts': 28477,
  'content-focus-ring.browser.test.tsx': 28453,
  'account-knob.browser.test.ts': 28314,
  'waiting-doors.browser.test.ts': 28238,
  'reader-lab.browser.test.ts': 27415,
  'ask-surface.browser.test.ts': 26847,
  'one-waiting-page.browser.test.ts': 26733,
  'settings-integrations.browser.test.ts': 26168,
  'model-sheet-labels.browser.test.ts': 24533,
  'lazy-screens.browser.test.tsx': 24070,
  'accounts-openrouter-card.browser.test.ts': 23775,
  'digest-widths.browser.test.ts': 22926,
  'sheet-stack-hide.browser.test.ts': 22757,
  'models-sheet.browser.test.ts': 22728,
  'shadow-lanes-card.browser.test.ts': 22407,
  'waiting-close-run.browser.test.ts': 22193,
  'transcript-work-card.browser.test.ts': 22118,
  'chat-links.browser.test.ts': 21645,
  'page-head-focus.browser.test.ts': 21154,
  'chat-width.browser.test.ts': 20584,
  'chat-colour.browser.test.ts': 20360,
  'epic-page.browser.test.ts': 19726,
  'reader-history.browser.test.ts': 19536,
  'run-tally.browser.test.ts': 19190,
  'programme-page.browser.test.ts': 18768,
  'item-wrap.browser.test.ts': 17684,
  'inspector-hide.browser.test.ts': 16666,
  'disk-banner.browser.test.ts': 16442,
  'palette-search.browser.test.ts': 15885,
  'overrides-in-force.browser.test.ts': 15462,
  'calls-made.browser.test.ts': 15443,
  'account-pool-unavailable.browser.test.ts': 14966,
  'add-project-sheet.browser.test.ts': 14788,
  'sheet-focus-ring.browser.test.tsx': 14089,
  'session-timers.browser.test.ts': 12958,
  'scope-sweep-card.browser.test.ts': 12253,
  'pane-scope-stop-card.browser.test.ts': 12099,
  'fleet-reconnecting.browser.test.ts': 11254,
  'fleet-toggle-row.browser.test.ts': 10512,
  'instrument-group-seen.browser.test.ts': 9287,
  'docs-headers.browser.test.ts': 9144,
  'stall-watch-held.browser.test.ts': 8626,
  'home-root.browser.test.ts': 7641,
  'testbox-card.browser.test.ts': 7574,
  'skin-default.browser.test.ts': 7231,
  'helpers-rail.browser.test.ts': 6718,
  'browser-tools-card.browser.test.ts': 6322,
  'review-cap-coord.browser.test.ts': 6227,
  'build-behind.browser.test.ts': 5527,
  'update-sweep-line.browser.test.ts': 4485,
  'models-sheet-anthropic.browser.test.ts': 4437,
  'roll-idle-card.browser.test.ts': 3034,
  'settings-diagnostics.browser.test.ts': 2895,
  'instrument-fab.browser.test.ts': 2737,
  'testbox-builds.browser.test.ts': 2633,
  'caps-dial.browser.test.ts': 2517,
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
