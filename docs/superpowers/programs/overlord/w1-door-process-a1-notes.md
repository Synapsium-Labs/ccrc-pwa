# Overlord W1, door process A1: notes for the ledger

What door process A1 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`, Tasks 1 to 3) found while
building, for the coordinator to fold into the programme ledger. Each departure is named by a plain-words slug; no number
is taken here.

## Departures

- **`claim-reads-starts-that-can-mint`**: the plan's "the session's newest recorded start" and "the start carrying the hash"
  read only starts whose source can mint a generation, never a `compact` or a `fork`. A compaction keeps the conversation
  and runs in the same process, so its start report repeats the spawn's hash and mints nothing. Read as a start, it would
  supersede the start whose generation the key belongs to, and a door process that first claims after a compaction would
  answer `renewing` for ever. A `fork` sends no start report today; it is excluded for the same reason.
- **`arms-5-and-6-are-exclusive`**: the plan's mutant "arms 5 and 6 swapped" is an equivalent mutant: a start whose
  generation is not minted has no state, so the two arms never both hold and no input tells their order apart. It is not
  in `ACT_KEY_MUTANT_SETS`, so the set's nine mutants are all killed and the floor is 1.
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
- **`door-functions-in-c10`**: `ccd/contexts.tsv` places `_door_prog_ok` and `_door_purge` in C10, the session host (the door process is a
  process the session hosts), so `_reg_purge -> _door_purge` is a cross-context edge, and so are the helper's calls back to C1's
  `_reg_id_ok` and `_reg_purge_unremoved`; `contexts-edges.tsv` carries all three.
- **`program-pin-not-rendered-in-a1`**: `__CCD_DOOR_SHA256`, the door program's pin, lands as `stamp-at-install` and the
  entry installer does not render it in A1: the program and its pin are installed together in A2. Until then an
  installed body's `_door_prog_ok` refuses (a placeholder pin), and nothing in A1 calls it outside the tests.

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
- Mutation: `actKeyClaimVerdict`, nine mutants, all killed (floor 1). By hand, each restored from a saved copy: the body back
  on curl's argv reds the four command-line cases; the key answered on a refused insert reds the race case; the nonce in the
  refusal's log line reds the good-claim case; the non-child prefilter's `.door` fragment removed reds the four top-level
  cases of the door directory (the child cases stay green).
