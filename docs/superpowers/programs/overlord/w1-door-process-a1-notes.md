# Overlord W1, door process A1: notes for the ledger

What door process A1 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`, Tasks 1 to 3) found while
building, for the coordinator to fold into the programme ledger. Each departure is named by a plain-words slug; no number
is taken here.

## Departures

- **`claim-reads-the-minted-start`** (review 2636 F1, the coordinator's ruling; it replaces the first round's
  `claim-reads-starts-that-can-mint`, which chose starts by source): the plan's "the session's newest recorded start" and
  "the start carrying the hash" follow the start the generations lane minted from, which the generation row names
  (`continuity_generations.startId`). The claim binds, of the session's starts carrying the hash, the newest the lane
  minted from (else the newest, not minted yet), and it is superseded only by a start the lane minted from that was recorded
  after it (`reportedAt`, then id). So a start the lane declines never stands in for the start whose generation the key
  belongs to, and never supersedes it: a compaction or a fork, a nested Claude Code process in the pane (it inherits the
  spawn's environment, so its start report carries the same hash, and the lane declines it as not the row's own
  conversation), a start older than the live generation's, and a start of a role or row the lane does not mint. A door
  whose own start was declined answers `superseded` once a newer start has minted, never `renewing` for ever. The one case
  left `renewing` is a session none of whose starts the lane ever mints (a role that is not long-lived, a row the registry
  no longer lists): it fails closed, no key, and the door process's bounded back-off only retries; no door process is
  spawned for such a session. The lane does not record a declined start, and its cursor is no substitute, since a
  coordinator's first generation may still mint from a start the cursor has passed. A newer spawn's start that the lane
  has not judged yet supersedes nothing: until it mints, the old generation is live and its key may still issue once; the
  mint ends that generation, and the fence's calls refuse its key from then on.
- **`arms-5-and-6-are-exclusive`**: the plan's mutant "arms 5 and 6 swapped" is an equivalent mutant: a start whose
  generation is not minted has no state, so the two arms never both hold and no input tells their order apart. It is not
  in `ACT_KEY_MUTANT_SETS`, so the set's mutants (eleven since review 2636 F1) are all killed and the floor is 1.
- **`entropy-dep-optional`**: `ContinuityRouteDeps.entropy` is optional. The composition root always passes
  `deps.time.entropy`; a server built without it (the four other suites that build the continuity routes by hand) answers
  `unavailable` at the claim door, as it does for an absent store. Required, it would have changed four test files other
  pieces edit.
- **`body-on-stdin-as-data-raw`**: `ccrc-api`'s body line in the curl config is `data-raw`, not the plan's `data-binary`.
  Both post the bytes as given; `data-raw` never reads a file, so a body that began with `@` could never be read as a path.
  Every body today is JSON, so the bytes the server receives are unchanged (characterized in
  `ccrc-api-stdin-body.test.ts`). The test-side loopback curl front (`server/test/containedTools.ts`) admits the new line
  shape (`CCRC_API_DATA_LINE_ERE`), with refusal rows in `ccrc-containment.test.ts`.
- **`act-door-scan-reads-a-whole-word`**: `ccrc-api-closed.test.ts`'s scan that the client never spells the operator's
  item doors (`/act`, `/decline`) used `\b`, which ends a word at a hyphen, so `/api/sessions/{id}/act-key` matched it.
  The scan now ends the word at anything but a word character or a hyphen.
- **`door-purge-records-a-linked-directory`**: `_door_purge` refuses a linked `$REG/.door` or `$REG/.door/<id>` and also
  records that directory through `_reg_purge_unremoved`, so `_reg_purge`'s status says a door directory stayed.
- **`door-purge-refuses-dot-ids`**: `_reg_id_ok` admits `.` and `..`, which would make `$REG/.door/<id>` name `$REG/.door`
  or `$REG` itself, so the four literal names would be unlinked there. `_door_purge` refuses both ids beside `_reg_id_ok`.
  `_reg_purge`'s callers pass real ids; the refusal is the helper's own.
- **`door-lib-copies-the-hash-command`**: `_door_prog_ok` copies `__CCD_HASH_CMD` in two statements (`local -a h`, then the
  assignment), because `ccd-lib-load.test.ts`'s census reads `local -a h=("${__CCD_HASH_CMD[@]}")` as a second writer of the
  loader's variable. The census of `__CCD_LAYOUT` readers admits `_door_prog_ok`'s one read, in the docs front's form.
- **`installer-stages-a-sixth-slot`**: the entry installer's staging pattern admitted slots 1 to 4; the sixth library
  stages in slot 5, so the pattern admits `[12345]`.
- **`door-functions-mapped-under-item-436`**: the context map reads the ccd libraries through `CCD_LIB_FILES` in
  `server/test/consolidationCensus.ts`, a file another run holds. The coordinator first deferred this PR's entry there
  (ruling (a)); the operator's ruling on item 436 (Overlord PRs edit the files that run holds now, and that run merges
  later) puts it back. So this PR carries, as one inseparable group: the `CCD_LIB_FILES` entry `'ccd/lib/door.sh'`, the two
  rows `_door_prog_ok` and `_door_purge` in `ccd/contexts.tsv` (both C10, the session host: the door process is a process
  the session hosts) with that file's header comment naming the library, and the three edges in `ccd/contexts-edges.tsv` (`_reg_purge -> _door_purge`, and the helper's calls
  back to C1's `_reg_id_ok` and `_reg_purge_unremoved`).
- **`readme-hunks-under-item-436`**: under the same ruling, README carries this PR's own facts in five hunks, and
  nothing else in README is edited by this PR:
  1. the auth paragraph's machine-lane count word, ninety to ninety-one (eighty-nine before the quiz record's door and this one);
  2. the continuity doors sentence names the act-key claim (`POST /api/sessions/:id/act-key`);
  3. the ccd library list names `lib/door.sh` (the door process: its registry directory's purge and its program's pin
     check);
  4. one restore-list line for the backup's `ccd-lib-door.sh`, beside the other libraries' lines;
  5. the loader paragraph names `ccd/lib/door.sh` the sixth library and `__CCD_LIB_DOOR_SHA256`, and reads "all six".
- **`migration-101-by-position`**: the ladder (#2994) landed migration 99 and the quiz record (#2991) 100 first, so this
  PR's migration is 101, renumbered at the absorptions of `main` (positional, the brief's rule). The same absorption
  recounted the lanes this PR and the quiz record each added: ninety rows in `ccrc-api`, eighty-eight box-token machine
  lanes and ninety-one with the three fleet-host lanes, 282 routes (279 HTTP, 100 exempt).
- **`door-prog-ok-names-no-tool`**: `_door_prog_ok` reads the program with a bounded `cat` and pipes the bytes into the
  loader's hashing command, so it names no GNU-only tool (`macos-platform.test.ts`). A read cut short fails the pipe
  (`pipefail`) or hashes short, and either refuses.
- **`entropy-read-lazily`**: the composition root first read `deps.time.entropy` while building the routes, which threw for
  every suite that builds the server without a time port (the first full run's 151 reds). It is a closure now, as the wall
  clock beside it is.
- **`program-pin-not-rendered-in-a1`**: `__CCD_DOOR_SHA256`, the door program's pin, lands as `stamp-at-install` and the
  entry installer does not render it in A1: the program and its pin are installed together in A2. Until then an
  installed body's `_door_prog_ok` refuses (a placeholder pin), and nothing in A1 calls it outside the tests.

- **`refusal-count-is-the-sessions-own`** (review 2636 F2): `noteRefusedClaim` raises `claimsRefused` only on a row whose
  generation is the claiming session's own, so a session presenting a nonce another session spent changes no count of
  that session's.

## Review 2636's notes (no change)

- **F3**: the claim's two start reads order by the hook-supplied `reportedAt`, then id, as `StartRow` and the generations
  lane's `startBefore` do. A box clock stepped backwards between a start and its successor could make the older sort
  newest. The exposure is the lane's own, so the claim adds no new fact; the decider's order (`recordedAfter`) is that one
  rule.
- **F4**: the hook's non-child prefilter matches `*.door*`, wider than the plan's `.cc-sessions/.door`. It only runs the
  account arm more often, the safe direction, and is kept; removing it reds the four top-level deny cases.
- **F5**: `CLAUDE.md`'s SAFETY section names `~/.cc-sessions/.door/` in a sentence of its own beside the account write
  directories' sentence. The three lists (`ACCOUNT_SECRET_PATHS`, `ACCOUNT_WRITE_DIRS`, the installer's bash copy) agree;
  only the prose is in two sentences.

## The hook refusal

A Bash call that edited the deny lists (a heredoc whose text names the guarded paths) was refused by the session hook's
account arm. It was reported to the coordinator and not retried in any form. The coordinator permitted exactly those
edits through the Edit tool, one file at a time; they were made that way.

## Named residuals (ruled, F23)

- The start door trusts the body's `fromId` and `fromUuid` against a readable registry uuid, so a holder of the box token
  can post a start bound to a hash of its own choosing.
- A forked copy launched with the same config sends no start report and can claim before the original.
- The claim's answer sits in `ccrc-api`'s answer file (`REQ_OUT`, a 0600 `mktemp` file under the session's `$TMPDIR`) for
  the length of the claim, until the client's exit trap removes it.
- Where sessions share a UNIX user, the deny path is an accident guard, not a wall.

## Measurements

- Local runs: `ccrc-containment.test.ts`'s row "`--url=` is not a curl option" fails on this box only: its curl (8.18)
  accepts `--url=` and answers 7, where the row expects curl's own 2. It is not this change's; CI is the arbiter.
- Local runs: `secret-mask.test.ts`'s "typed slowly" case fails here on a clean export of `origin/main` too (a timing case
  under load); and the shellcheck ratchet's program lint is killed by the test slice's memory cap. CI is the arbiter of both.
- Growth (`growthCheck`'s own measure, armed, against the merge base): `ccd/ccd` +3, `ccd/lib/door.sh` +26 (new),
  `ccd (program)` +29, `ccd/session-hook.sh` +2, `ccd/ccrc` +1, `server/src/coord/schema.ts` +5, `server/src/server.ts` 0,
  `shared/api.ts` 0 (edited in place).
- Mutation: `actKeyClaimVerdict`, eleven mutants (review 2636 F1 added the start order's two), all killed (floor 1). By hand, each restored from a saved copy: the body back
  on curl's argv reds the four command-line cases; the key answered on a refused insert reds the race case; the nonce in the
  refusal's log line reds the good-claim case; the non-child prefilter's `.door` fragment removed reds the four top-level
  cases of the door directory (the child cases stay green).
