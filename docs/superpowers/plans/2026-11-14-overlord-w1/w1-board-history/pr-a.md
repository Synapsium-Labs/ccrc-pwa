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
- **`bite-checks-by-hand`** (revised in fix round 1, review 2126 F9). `references/mutation-run.py` runs Python modules
  only, so the plan's four bite checks were first made by hand. They are now reproducible in the tree:
  - **Mutant sets** (`server/test/sim/overlordHistorySets.ts`, run by the mutation floors): the scope enumeration
    (`ccd/history/lib.mjs#decideScope`, S1: an env source with `--session` answers `overlord`), the role read
    (`ccd/history/read-context.mjs#measureReach`, C1: it opens the box's role file), and the ready word
    (`agent/src/historyOp.ts#createHistoryOp`, H1 and H2: `servable` without the platform check, without the resolver
    check). The same set carries F1's link-close mutant (H3: `abandon` terminates nothing).
  - **A planted control** (`overlord-read-context.test.ts`): the side-effect pin is a scan of `read-context.mjs`'s text,
    which no module suite sees, so a case appends a top-level `process.umask` to the text and shows the scan red on both
    counts and the planted copy refused in a worker.

## Found in fix round 1 (review 2126)

- **`one-admitted-store-sequence`** (ruled F7). `read-context.mjs#openAdmitted` is the one admitted-store opening: the
  reach with the caller's role, `decideCliStore`, `openReader`, the meta store id, the journal mode and `userVersion`
  for `decideStatusRead`. `cli.mjs#readContextIn`, `cli.mjs#readContextEnv` and `overlord-read.mjs` all call it. The
  store-id fallback is the caller's (`refusalStoreId` for the CLI, `() => null` for the Overlord's read), and so is
  the busy timeout (the Overlord's read only). The characterization suite is green before and after, so the CLI's
  answers did not change.
- **`request-refuses-a-bare-separator`** (ruled F3). The request reader refuses a bare `--` with a new closed word,
  `separator`, and `overlord-read.mjs` re-checks it. The op no longer appends `--json` (every runner takes
  `json: true`), so a trailing value-taking option is the verb's own `bad-args`. `--regex` is still checked first,
  wherever it stands.
- **`agent-reads-the-request-body`** (ruled F5). `validateReq` hands the reader the frame less `t`, `id` and `op`, so
  the 8,192-byte bound measures the body the server's door bounds. A key the reader does not know stays in the body,
  so a `regex` key is still refused.
- **`own-words-from-the-map`** (ruled F6). Each own word maps to the one outcome that carries it (`OWN_WORD_MAP`), and
  the answer reader's own-word branches read that map. `isOverlordHistoryOwnWord` is the union's guard for the wire
  totality scan.
- **`read-path-calls-pin`** (ruled F2). `overlord-read-scope.test.ts` pins the read path's calls over both
  `overlord-read.mjs` and `read-context.mjs`, because the opening moved into the latter:
  - store.mjs names from a read-only set per file;
  - no call named for a `WRITING_FORMS` operation;
  - no `exec` but the busy timeout's PRAGMA;
  - no prepared statement but a read.

  A planted control shows each of these red.
- **`open-spy-beside-the-read-spy`** (ruled F4). The credential cases use a new preload,
  `server/test/fixtures/overlord-history/preload-openspy.mjs`. It covers the sync, callback and promise opens, the
  directory reads and `createReadStream`, and each form has a control. History's `preload-readspy.mjs` is left as it
  is, because other suites read its lines. Search, describe and expand all run under it.

## Chosen values

- `OVERLORD_HISTORY_REQUEST_MAX_BYTES` 8,192; at most 32 arguments of at most 1,024 characters.
- `OVERLORD_HISTORY_ANSWER_MAX_BYTES` 65,536 (the module's `OVERLORD_READ_ANSWER_MAX_BYTES` equals it, pinned);
  at most 1,000 items read back.
- The read's busy timeout 15 s, under the op's 20 s deadline (pinned).

## Growth (the growth check's own count)

- `ccd/history/lib.mjs`: 6,981 to 6,982 (+1).
- `ccd/history/recall.mjs`: 1,652 to 1,661 (+9), under its cap of 1,692.
