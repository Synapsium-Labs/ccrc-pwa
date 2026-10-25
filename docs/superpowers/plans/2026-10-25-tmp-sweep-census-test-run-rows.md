# Tmp-sweep census: the reader takes the test-run arm's session-less rows: Implementation Plan

> **For agentic workers:** one task, one PR. REQUIRED SUB-SKILL: superpowers:test-driven-development (red first, then
> green). Fixture HOMEs only.

**Goal.** The server's census reader accepts the `moved` rows that the tmp sweep's test-run arm writes. One dead
test-run root must no longer make the whole census unreadable.

**Spec:** `docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md` §2.1 ("The census", "Mail and the budget
notice") and §2.2 (the test-run arm). **Related plan:** `docs/superpowers/plans/2026-10-23-fleet-disk-retention.md`,
Tasks DR-10 (#1246) and DR-12 (#1261). Anchors are `≈:` hints into `origin/main` as of 2026-10-25. Re-ground each one
by its function name before editing.

## What was measured (2026-10-25)

- **The writer.** `ccd/ccd-tmp-sweep`'s test-run arm (DR-10, #1246, first released in v0.0.637) appends one `moved`
  row for each dead `ccrc-testrun-*` root, with `'id': ''` and `'uuid': ''` (≈:1039, in the test-run arm). That is
  because no session owns such a root (spec §2.2).
- **The reader.** `parseMoved` in `server/src/tmpSweep.ts` (DR-12, #1261) requires `str(id)` and `str(uuid)`, so
  both must be non-empty. `parseTmpSweepCensus` then answers `null` for the whole file if any one row fails.
- **On the fleet box.** From the first pass that found a dead test-run root, every server boot logs `tmp-sweep census:
  the census file is malformed; it is read as unmeasured`. The shipped reader, run on a copy of that census, answers
  `null`. The only failing row is the test-run row. Its `name`, `kind`, `bytes`, `at` and `shadow` are all
  well-formed.
- **The cost.** The lane fails toward keeping (`tmpSweepLane.ts`), so nothing is lost. But no receipt is mailed, no
  holder is named for `disk.holders`, and no budget notice is sent while the row stands. A row stays in `moved` for up
  to 7 days.
- **The spec.** The census shape lists `moved:[{seq, id, uuid, name, kind, bytes, at, shadow, quarantine}]`, and `kind`
  includes `test-run`. It does not say what `id` and `uuid` hold on a test-run row.

## The decision (D-6854)

- **A `test-run` row may be session-less.** A `moved` row whose `kind` is `test-run` may carry `id: ''` and
  `uuid: ''`, both empty together. Every other kind keeps today's rule. A test-run row with exactly one of the two
  empty is still malformed.
- **The reader follows the writer.** The writer is the census's only writer and has been in the field since v0.0.637,
  so it is unchanged.
- **The parsed row says "no session" as its own value.** `TmpSweepMoved`'s `id` and `uuid` become `string | null`, and
  `null` means "no session owns this row". `parseMoved` maps the writer's two empty strings to `null`. This keeps the
  empty string out of every caller, so none can mistake it for a session id (CLAUDE.md: no overloaded value at a
  seam), and the compiler then names every reader of the field.
- **A session-less row is never mailed.** `tmpSweepReceipts` never groups or mails a row whose `id` is `null`: a live
  test-run row has no one to tell. A `grep` for `\.moved\b` and `TmpSweepMoved` under `server/src` should find no
  other reader. Confirm that, and record what you found.

## Task 1: the reader takes the test-run arm's rows

**Files:**

- Modify `server/src/tmpSweep.ts`: `TmpSweepMoved`, `parseMoved` and `tmpSweepReceipts`, as decided above. Say in a
  comment, once, where the reader's rule meets the writer's line.
- Modify `server/test/tmp-sweep-test-runs.test.ts`. Add **the contract row**:
  - drive the real `ccd/ccd-tmp-sweep` against its fixture HOME with one dead test-run root, as the file's own cases
    do;
  - read the census it wrote from the fixture HOME, and give it to `parseTmpSweepCensus`;
  - the census parses, and the row reads `kind: 'test-run'`, `id: null` and `uuid: null`.

  This is the row that was missing: nothing ran the writer's output through the reader.
- Modify `server/test/tmp-sweep-mail.test.ts`:
  - **Receipts:** with a live (non-shadow) test-run row beside a session's live row, `tmpSweepReceipts` mails the
    session and no one else.
  - **Malformed stays malformed:** each of these answers `null`: a `scratch` row with an empty `id`; a `test-run` row
    with only `id` empty; and a `test-run` row with only `uuid` empty.
- Modify the spec's census paragraph (§2.1) with one sentence: a `test-run` row names no session, and its `id` and
  `uuid` are empty strings (D-6854).
- Create this plan, as `docs/superpowers/plans/2026-10-25-tmp-sweep-census-test-run-rows.md`.

**Steps:**

1. Write the contract row and the three malformed rows. Run them, and see the contract row red on today's reader, with
   the failure it reports.
2. Change the reader. All the new rows are green.
3. Write the receipts row. Measure it red with the receipts skip deleted, on a scratch copy restored byte-identical by
   `cmp`. If the compiler refuses that mutant instead, record that the type is the mechanism.
4. **Mutation table.** Each mutant is measured, not argued. It runs on a scratch copy and is restored by `cmp`, and you
   record how each one ended.
   - Drop the test-run carve-out: the contract row goes red.
   - Allow an empty `id` on any kind: the `scratch` row goes red.
   - Allow one-sided emptiness: the one-sided rows go red.
5. **Gates.** In your worktree, one file at a time, in the foreground, `--pool=forks --maxWorkers=2`:
   - `tmp-sweep-mail`, `tmp-sweep-test-runs`, `tmp-sweep-live`, `tmp-sweep`, `tmp-sweep-output-cap` and
     `fleet-health`;
   - `single-definition`, `docs-parity`, `citations`, `topology-clean`, `private-names`, `dtbd` and `typecheck-tests`;
   - `deviation-refs`, after `git fetch origin main`.

## Deviations found

- **D-6854.** The census reader accepts a `test-run` `moved` row with `id: ''` and `uuid: ''`, and parses both as
  `null` ("no session owns this row"). `tmpSweepReceipts` never mails such a row. The writer (DR-10) has written these
  rows since v0.0.637, and the reader (DR-12) refused them, so one dead test-run root made the whole census read as
  malformed. The spec said nothing about these two fields on a test-run row. The reader now follows the writer, and the
  spec says so.
- **D-6855.** Spare, unused.

## As built (2026-10-25)

- **Readers of the row.** A `grep` for `\.moved\b` and `TmpSweepMoved` under `server/src` finds only
  `server/src/tmpSweep.ts`: the type, `parseMoved`, `parseTmpSweepCensus` and `tmpSweepReceipts`. Under `pwa/src`,
  `shared` and `agent/src` it finds nothing. `server/src/tmpSweepLane.ts` calls `parseTmpSweepCensus` and
  `tmpSweepReceipts`, but it reads only the receipt mails, whose `toId` stays `string`. It never reads a `moved` row.
- **The reader.** `parseMoved` checks the other fields first. It then sets `sessionless` (kind `test-run`, and `id`
  and `uuid` both `''`), and refuses any other empty `id` or `uuid`. The comment that names the writer's line
  (`test_run_arm` in `ccd/ccd-tmp-sweep`) is on that check. `tmpSweepReceipts` skips a row whose `id` is `null`
  before it skips shadow and expired rows.
- **Red first.** The contract row (`tmp-sweep-test-runs.test.ts`) failed on the old reader with
  `the writer's own census reads as measured: expected null not to be null`. The three malformed rows
  (`tmp-sweep-mail.test.ts`) were already green on the old reader, as they should be: they pin that the carve-out stays
  narrow.
- **Mutation table.** Each mutant was made in place, with a copy of the original in the session's scratch directory. Each
  ran in a subshell with `ulimit -u` set to the measured thread count plus 1500, under `timeout -k 10 600`. The file was
  then restored, and `cmp` exited 0 every time.

  | Mutant | `tsc --noEmit` | Rows that went red |
  |---|---|---|
  | M1: delete the receipts skip (`r.id === null`) | refused (TS2322 at the receipt's `id`) | the receipts row (`tmp-sweep-mail`, 1 of 57) |
  | M2: drop the test-run carve-out (`sessionless = false`) | clean | the contract row (`tmp-sweep-test-runs`, 1 of 17); `tmp-sweep-mail` stays green |
  | M3: allow an empty `id` on any kind | clean | the `scratch` row and the test-run row with only `id` empty (2 of 57) |
  | M4: allow one-sided emptiness on a test-run row | clean | both one-sided test-run rows (2 of 57) |

  M1 is held twice: by the type, because a `null` id cannot reach a mail's `toId`, and by the receipts row. M2 is held
  only by the contract row, which runs on Linux alone, like its whole file.
- **The writer's row matched the plan.** The contract row read `kind: 'test-run'`, `id: ''` and `uuid: ''` from the
  real sweep. So D-6855 was not needed.
