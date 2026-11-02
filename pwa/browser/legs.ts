// The browser leg's split into CI legs, by measured file time (the merge queue's 20-minute deadline, 2026-11-02).
// Not a test file (no `*.browser.test.*` in its name); `browser/slowFirst.ts`'s sequencer reads it.
//
// One job ran all of browser/ on three workers: 1,066 to 1,223 s of Test step over about 3,500 s of file time, and
// that day 56% of merge-queue runs hit the job's 20-minute limit with every test green. CI runs the leg as
// `vitest run --config vitest.browser.config.ts --shard=<i>/<n>`, one job per leg, and the sequencer answers vitest's
// shard question with `legOf` below instead of vitest's own split. vitest's split sorts files by a hash of their path
// and cuts the list into equal COUNTS, blind to time: on the 47 files of 2026-11-02 it gives legs of 1,000, 1,296
// and 1,314 s, the last holding all three wheel-chain files; this split gives 1,202, 1,202 and 1,206 s. Passing each
// leg's files on the command line was the other shape, and it was refused: vitest's CLI filters match as SUBSTRINGS
// (a `name-field.browser.test.ts` filter would also run a `name-field.browser.test.tsx`), and a list built outside
// vitest has to repeat its include glob. The sequencer is handed exactly the files vitest collected, so a new file
// cannot be missed by a glob of ours: it has no measured time, and it goes to the lightest leg.
//
// Every leg computes the whole split from the same collected list and keeps its own part, so the legs agree without
// talking. `splitLegs` checks that every file is in exactly one leg before any leg is returned (`assertPartition`),
// and `test/browser-legs.test.ts` checks it over the files vitest lists today, and that every name in
// `MEASURED_SECONDS` is still a browser file, so a renamed slow file reds rather than turning unknown.

/** Seconds per file, the longest of three merge-queue runs on 2026-11-02 (run 41480680996 and the two before it:
 *  Test steps of 1,066 s, 1,144 s and 1,223 s on three workers). Paths are relative to the pwa package. A new file
 *  needs no entry: it is placed as `UNMEASURED_SECONDS`. Re-measure from a run's log when the split drifts. */
export const MEASURED_SECONDS: Readonly<Record<string, number>> = {
  'browser/ask-inline.browser.test.ts': 547,
  'browser/wheel-chain.browser.test.ts': 350,
  'browser/frame-cost.browser.test.ts': 251,
  'browser/wheel-chain-chip.browser.test.ts': 228,
  'browser/wheel-chain-well.browser.test.ts': 191,
  'browser/row-fit.browser.test.ts': 188,
  'browser/lanes-row.browser.test.ts': 129,
  'browser/session-header.browser.test.ts': 128,
  'browser/drawer-prompt-glyph.browser.test.ts': 109,
  'browser/vaul-motion.browser.test.tsx': 98,
  'browser/single-readers.browser.test.ts': 98,
  'browser/reader-frame.browser.test.ts': 76,
  'browser/accounts-open.browser.test.ts': 75,
  'browser/refusal-copy.browser.test.ts': 73,
  'browser/refined-phone.browser.test.ts': 72,
  'browser/sheet-desktop-arm.browser.test.tsx': 66,
  'browser/instrument-desk.browser.test.ts': 63,
  'browser/remove-sheet.browser.test.ts': 62,
  'browser/connect-sheet.browser.test.ts': 62,
  'browser/name-field.browser.test.tsx': 53,
  'browser/accounts-cards.browser.test.ts': 53,
  'browser/move-sessions.browser.test.ts': 46,
  'browser/update-indicator.browser.test.ts': 45,
  'browser/sheet-footer.browser.test.tsx': 39,
  'browser/tool-well-colour.browser.test.ts': 38,
  'browser/programme-box.browser.test.ts': 35,
  'browser/tool-group-fit.browser.test.ts': 32,
  'browser/disk-banner.browser.test.ts': 31,
  'browser/delegation-rows.browser.test.ts': 29,
  'browser/sheet-focus-ring.browser.test.tsx': 26,
  'browser/compaction-fold.browser.test.ts': 26,
  'browser/ask-surface.browser.test.ts': 26,
  'browser/content-focus-ring.browser.test.tsx': 25,
  'browser/page-head-focus.browser.test.ts': 24,
  'browser/inspector-hide.browser.test.ts': 24,
  'browser/palette-search.browser.test.ts': 23,
  'browser/refined-bar.browser.test.ts': 20,
  'browser/account-knob.browser.test.ts': 20,
  'browser/instrument-rail.browser.test.ts': 19,
  'browser/instrument-group-seen.browser.test.ts': 19,
  'browser/skin-default.browser.test.ts': 18,
  'browser/fleet-toggle-row.browser.test.ts': 18,
  'browser/testbox-card.browser.test.ts': 13,
  'browser/roll-idle-card.browser.test.ts': 11,
  'browser/caps-dial.browser.test.ts': 11,
  'browser/instrument-fab.browser.test.ts': 10,
  'browser/docs-headers.browser.test.ts': 10,
};

/** What a file with no measured time is charged when it is placed: about the median measured file, so a few new
 *  files spread over the legs rather than all landing on the one that was lightest before them. */
export const UNMEASURED_SECONDS = 45;

/** A file's seconds for placing it: its measured time, or `UNMEASURED_SECONDS`. */
export function secondsOf(file: string): number {
  return MEASURED_SECONDS[file] ?? UNMEASURED_SECONDS;
}

/** Throws unless `legs` holds every one of `files` exactly once and nothing else: a file in no leg would never run,
 *  and one in two legs would run twice while the split's arithmetic says once. */
export function assertPartition(files: readonly string[], legs: readonly (readonly string[])[]): void {
  const seen = new Map<string, number>();
  for (const leg of legs) for (const f of leg) seen.set(f, (seen.get(f) ?? 0) + 1);
  const want = new Set(files);
  const none = [...want].filter((f) => !seen.has(f));
  const twice = [...seen].filter(([, n]) => n > 1).map(([f]) => f);
  const stray = [...seen.keys()].filter((f) => !want.has(f));
  const problems = [
    ...none.map((f) => `${f} is in no leg`),
    ...twice.map((f) => `${f} is in ${seen.get(f)} legs`),
    ...stray.map((f) => `${f} is in a leg but was not collected`),
  ];
  if (problems.length > 0) throw new Error(`browser legs: the split is not a partition: ${problems.join('; ')}`);
}

/** `files` (paths relative to the pwa package) split into `count` legs: measured files longest first, each to the
 *  leg with the least time so far (the lowest-numbered on a tie), then unmeasured files by name, each to the
 *  lightest leg. Depends on the SET of files only, never their order, so every leg computes the same split. Throws
 *  on a duplicate path or a count that is not a positive integer, and on any result that is not a partition. */
export function splitLegs(files: readonly string[], count: number): string[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`browser legs: ${count} is not a leg count`);
  if (new Set(files).size !== files.length) throw new Error('browser legs: a file was collected twice');
  const byName = [...files].sort();
  const measured = byName.filter((f) => f in MEASURED_SECONDS).sort((a, b) => secondsOf(b) - secondsOf(a));
  const unmeasured = byName.filter((f) => !(f in MEASURED_SECONDS));
  const legs: string[][] = Array.from({ length: count }, () => []);
  const load: number[] = legs.map(() => 0);
  for (const f of [...measured, ...unmeasured]) {
    const lightest = load.indexOf(Math.min(...load));
    legs[lightest]!.push(f);
    load[lightest]! += secondsOf(f);
  }
  assertPartition(files, legs);
  return legs;
}

/** Leg `index` (1-based, as `--shard=<index>/<count>` spells it) of `splitLegs(files, count)`. */
export function legOf(files: readonly string[], index: number, count: number): string[] {
  const legs = splitLegs(files, count);
  const leg = legs[index - 1];
  if (!Number.isInteger(index) || leg === undefined) throw new Error(`browser legs: no leg ${index} of ${count}`);
  return leg;
}

/** Total measured (or charged) seconds of `files`. */
export function legSeconds(files: readonly string[]): number {
  return files.reduce((s, f) => s + secondsOf(f), 0);
}
