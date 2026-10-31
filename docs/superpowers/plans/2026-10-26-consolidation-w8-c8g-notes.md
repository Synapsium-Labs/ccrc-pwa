# Consolidation W8, Task C8g: notes while building (D-7059; ARCH-73, #808)

Task C8g of `2026-10-26-consolidation-w8-journals-spawn-launchd.md`, built on `origin/main` `1e4305230`. The plan is not edited (the ledger guard). This note records what Step 0 confirmed, what the build measured, and where the build differs from the plan's text. None of it changes behaviour. No new D-number is needed, so this note lists no `D-TBD-<slug>`.

## Step 0, re-grounded on `1e4305230`

- **Gate.** C8f is on `main` (#1665): `server/src/journalKernel.ts`, `server/test/journal-kernel.test.ts`, `census-w8/journal.ts` (four queries) and `single-definition/kernel-tail-journal.test.ts` (with its positive control and "the kernel imports nothing") exist.
- **The two framers.** `coord/mirrorplan.ts#frameRead` (`lastIndexOf('\n')`, then `split('\n')` over the complete part, blanks filtered) and `collectLane.ts#parseCollectLaneJournal` (`split('\n')`, one trailing empty string popped). `frameRead` has one caller, `coord/mirror.ts` (two calls). `parseCollectLaneJournal` has one caller in `server/src`, `coord/collectLaneJournal.ts#read`.
- **`journalparse.ts` frames nothing.** `parseJournalLine` parses one line that `frameRead` has already cut. `coord/collectLaneJournal.ts` frames nothing either: it reads the file whole and checks the last byte (`0x0a`) before an append. Neither `coord/mirror.ts` nor either of these splits text on a newline.
- **The audit stands.** Framing is the one shared step. The cursor is the mirror's alone (the collect-lane journal is read whole and has no cursor). "Gap" is `lifecycle_gaps` (`shrank`, `rotated-away`, unorderable names) in the mirror and `mismatch` in the collect-lane control. "Generation" is a rotation file name in the mirror and a strictly rising integer in the collect-lane journal. Their tolerance is opposite: the mirror drops a blank line and leaves a partial tail unconsumed, while the collect-lane parser refuses a blank, torn or non-increasing record. Step 0 found no cursor, gap or generation step the two share, so the PR body names none.
- **Census at base** (`journalFramers()` run over a `git archive` of the base's `server/src`): 3 sites in 2 framers, `mirrorplan.ts` `frameRead` twice (its `lastIndexOf` and its `split`) and `collectLane.ts` `parseCollectLaneJournal` once. `delegationKernelImports()`: 0.
- **Rule 6.** 26 open PRs. None holds `journalKernel.ts`, `mirrorplan.ts`, `collectLane.ts`, any `census-w8/journal*` file, `kernel-tail-journal.test.ts`, `journal-kernel.test.ts`, `mirrorplan.test.ts`, `collect-lane-control.test.ts`, `collect-lane-journal.test.ts`, `collect-readers.test.ts` or `collect-pacing.test.ts`.

## Where the build differs from the plan's text

- **Where the characterization rows live.** The plan's file list names no caller suite. Step 1's rows sit in each framer's own suite: `mirrorplan.test.ts` holds `frameRead`'s four rows. `collect-lane-control.test.ts` holds `parseCollectLaneJournal`'s five. `collect-lane-journal.test.ts` holds "a blank record is malformed", the row the mutation table names in that suite, through the adapter. Each row pins the whole `FramedRead` or `CollectLaneJournalRead`.
- **Two import pins gained one entry each.** `collectLane.ts`'s imports are pinned exactly in two places. `collect-readers.test.ts` ("collectLane.ts is L1 …") pins an allowlist, and `collect-pacing.test.ts` ("the collector imports the derivation …") pins the exact sorted list. Each now names `./journalKernel.js`, an L1 file that imports nothing, with the reason cited (D-7059). The pacing pin also checks that the import binds `splitJournalRecords` alone. These edits are in the collect-lane move commit, so no commit is red. The plan's file list did not anticipate them.
- **`frameRead`'s no-newline early return is folded.** With no newline, `splitJournalRecords` answers an empty `complete`, so `nextCursor` is `cursor + 0` and `lines` is empty. That is the answer the early return gave, and Step 1's no-newline row pins it.
- **The delegation ratchet has its own census query.** The global constraint says new queries go in the chain's census module. So the check "no `coord/delegation-*.ts` imports `journalKernel.ts`" is `census-w8/journal.ts#delegationKernelImports()`, held against a fixture and the real tree, and `kernel-tail-journal` pins it empty. That row also checks that delegation files exist, so the pin is not over nothing.
- **`journalFramers()` reads the syntax tree.** It counts a `split` or `lastIndexOf` call whose first argument is the string `\n` or a regex literal naming `\n`. It looks only in the four files the plan names, and in `collectLane.ts` only inside `parseCollectLaneJournal`, because that file also splits a refusal's stderr in another function. Known width: a separator held in a variable, or framing in a fifth file, is not seen.

## Mutation table, run

| Mutant | Suite | Red |
|---|---|---|
| `splitJournalRecords` drops blanks | collect-lane-journal | "a blank record is malformed (D-7059 …)" and "empty, whitespace, truncated and blank-middle files read malformed". collect-lane-control is red as well: "a blank record is malformed blank at its own record number" and "empty, whitespace and blank records are malformed" |
| `frameRead` counts `complete.length` | mirrorplan | "the cursor is in bytes: a multibyte line …" and "counts BYTES, not characters …" |
| the tail treated as a complete line in `frameRead` | mirrorplan | "a partial line is not consumed: …" and four more (5 red) |
| the tail dropped in `parseCollectLaneJournal` | collect-lane-control | "a file with no final newline: its last record read" and eight more (9 red) |
| `delegation-journal.ts` imports the kernel | kernel-tail-journal | "the delegation journal stays separate: …" |
| (extra) `parseCollectLaneJournal` splits by hand again | kernel-tail-journal | "no hand-rolled NDJSON framer in the lifecycle mirror or the collect-lane journal …" |
