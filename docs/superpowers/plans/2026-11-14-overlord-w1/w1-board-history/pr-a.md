# Board and history door, PR A: notes for the ledger

PR A of `w1-board-history.md` (Tasks 1 to 4): the move into `ccd/history/read-context.mjs`, the `overlord` read scope,
`ccd/history/overlord-read.mjs` and its worker entry, the agent op `overlord-history` and its word in `ready.ops`.
Nothing sends the op yet. The coordinator folds these notes into the programme ledger; no number is defined here.

## Departures found while building

Each is named by its slug; the coordinator mints numbers.

- **`h32-scan-reads-read-context`.** `history-cli.test.ts`'s H-32 case scans `cli.mjs`'s text for its stderr writes and
  for `errLine`. Task 1 moves `errLine` and its one write to `read-context.mjs`, so the case now reads both files
  joined. Its assertions are unchanged (still eight writes).
- **`ready-word-platform-in-the-boot-helpers`.** R10 asks that the real-agent `ops` pins see one list on every runner.
  The platform and the resolver are agent options (`AgentOpts.historySeams`), and the two real-agent boot helpers
  (`agent/test/helpers.ts#boot`, `server/test/remoteHelpers.ts#bootAgent`) pass `platform: 'linux'`; a case that
  passes its own seams replaces them.
- **`request-refuses-the-scope-flags`.** The request reader also refuses `--session`, `--project`, `--workspace`,
  `--agents` and `--json` among the verb's arguments (`bad-args`): the target owns the scope, the `agents` field the
  flag, and the op the JSON form. The plan names only `--regex`.
- **`agent-rereads-the-posted-answer`.** The op reads the worker's posted answer through `readOverlordHistoryAnswer`
  and measures its bytes, as well as the worker measuring before it posts: an off-shape post answers `failed`
  (`internal`), so a message in an off-list word never reaches the wire.
- **`verb-exit-5-is-store-refused`.** A verb's own exit 5 (a store word, such as `migration-pending`) answers
  `store-refused`; every other worded exit a verb answers is `verb-refused`.
- **`an-empty-wal-is-no-write`.** The read creates an empty `-wal` beside the database when none stands, as every WAL
  reader does (the CLI's `openReader` too). The "writes nothing" case reads an absent and an empty `-wal` alike, and
  compares the database's bytes exactly.
- **`reader-cases-live-in-the-sim-sets`.** The two readers' cases are written once, in
  `server/test/sim/overlordHistorySets.ts`, and run by `overlord-read.test.ts` and by the mutation floors.
- **`bite-checks-by-hand`.** `references/mutation-run.py` runs Python modules only. The plan's bite checks on the
  scope enumeration, the role read, the side-effect pin and the ready word were made by hand: each mutant applied to a
  saved copy, the case run red, the file restored from the copy.

## Chosen values

- `OVERLORD_HISTORY_REQUEST_MAX_BYTES` 8,192; at most 32 arguments of at most 1,024 characters.
- `OVERLORD_HISTORY_ANSWER_MAX_BYTES` 65,536 (the module's `OVERLORD_READ_ANSWER_MAX_BYTES` equals it, pinned);
  at most 1,000 items read back.
- The read's busy timeout 15 s, under the op's 20 s deadline (pinned).

## Growth (the growth check's own count)

- `ccd/history/lib.mjs`: 6,981 to 6,982 (+1).
- `ccd/history/recall.mjs`: 1,652 to 1,661 (+9), under its cap of 1,692.
