// D-7058 (ARCH-73 #808, its journal half; spec 2026-10-19 K17 "Journal-to-db mirrors", third bullet): the log-first
// journals' shared pieces, stated once. It imports nothing and makes no I/O (ring L1, context K): each journal's
// adapter reads its own file and hands the text here, and each writer calls `appendThenApply` inside its own `tx()`.
// What stays each caller's own: its error mapping (`setIntent`'s `journal-unreadable`/`journal-unwritable`,
// `setCollectLane`'s `failed` phases), its leniency (`LedgerLog.maxAllocated` parses per project and salvages, and is
// NOT routed through `maxJournalEpoch`), its file format and its path. The delegation journal (authority, not a
// projection; spec §3.19) never imports this file.

/**
 * The largest `"epoch":<digits>` over the non-empty lines of a journal's text: the one body `PoolEdgeLog.maxEpoch`
 * and `UpdateIntentLog.maxEpoch` shared byte for byte. Regex-only: a torn final append still counts when an epoch can
 * be read out of the fragment (over-counting is the safe direction). An EXISTING journal that yields no epoch
 * (zero-length, the ext4 delayed-allocation crash shape, or no epoch anywhere) THROWS, with the caller's own words
 * and path: reading it as "nothing issued" would be the reissue the journal exists to prevent. A MISSING file never
 * reaches here: `ENOENT` is the adapter's `null`.
 */
export function maxJournalEpoch(text: string, what: string, path: string): number {
  let max: number | null = null;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const m = /"epoch":(\d+)/.exec(line);
    if (m === null) continue;
    const n = Number(m[1]);
    if (max === null || n > max) max = n;
  }
  if (max === null) {
    throw new Error(
      `${what} journal exists at ${path} but yields no epoch — ` +
      'zero-length or unparseable is not the same as absent; answering ' +
      'null here would be the reissue this file exists to prevent',
    );
  }
  return max;
}

/**
 * MAX(file, db): the floor every log-first writer issues past, so a number the journal holds and the database never
 * committed is SKIPPED, NEVER REISSUED. `null` on either side means "nothing recorded there"; both `null` is `null`.
 */
export function journalFloor(dbMax: number, fileMax: number | null): number;
export function journalFloor(dbMax: number | null, fileMax: number | null): number | null;
export function journalFloor(dbMax: number | null, fileMax: number | null): number | null {
  if (dbMax === null) return fileMax;
  if (fileMax === null) return dbMax;
  return Math.max(dbMax, fileMax);
}

/** Where `appendThenApply` got to. The caller starts it at `'decide'`; the kernel sets `'append'`, `'apply'` and
 *  `'done'` as it passes each, so after a throw it names the step that threw. */
export type JournalPhase = 'decide' | 'append' | 'apply' | 'done';

/** One log-first write: `decide` answers `{ go }` with what to write or `{ stop }` with the caller's answer; `append`
 *  writes the journal; `apply` writes the rows and answers the caller's result. */
export interface JournalStep<D, R, S> {
  decide(): { readonly go: D } | { readonly stop: S };
  append(d: D): void;
  apply(d: D): R;
}

/**
 * The journal FIRST, the row SECOND: decide, then (on `go`) append, then apply. A stop calls neither. A throw from
 * any step is rethrown UNCHANGED (never wrapped, never mapped), with `phase.at` left at the step that threw, so a
 * failure after the append leaves the journal ahead (a skipped number), and never the row ahead of the journal. It
 * opens no transaction: each caller calls it inside its own `tx()`, which rolls the rows back on the rethrow.
 */
export function appendThenApply<D, R, S>(step: JournalStep<D, R, S>, phase?: { at: JournalPhase }): R | S {
  const d = step.decide();
  if ('stop' in d) return d.stop;
  if (phase !== undefined) phase.at = 'append';
  step.append(d.go);
  if (phase !== undefined) phase.at = 'apply';
  const r = step.apply(d.go);
  if (phase !== undefined) phase.at = 'done';
  return r;
}
