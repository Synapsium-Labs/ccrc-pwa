# Overlord W1, the inbox and its reads: task notes

The W1 inbox piece (`docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`, the one pull request of its "The PR split";
spec `docs/superpowers/specs/2026-11-09-overlord-design.md` §6.8, §3.8, §3.2, §3.3.5, §11.2). What the ledger should learn
from this pull request. The coordinator folds it into the programme ledger and mints the numbers.

## What was built

- **The vocabulary and the deciders** (Task 1): `shared/overlordInbox.ts` (bands, row kinds, each kind's own nudge, the row and
  answer shapes, `READ_CEILINGS`, the path id parser, the wake's subject, body codec and fixed lines) and
  `server/src/coord/overlordInbox.ts` (`composeInbox`, `inboxOrder`, `rowNudgeOf`, `readCeilingVerdict`, `acknowledgeVerdict`,
  `inboxWakeVerdict`, `inboxProbeSource`). `READ_DOOR_MAP` gains `sequence`. Ten mutant sets join the floors here, every mutant
  killed: three on the L0 vocabulary (`parseMessageId`, `readInboxWakeBody`, `renderInboxWakeLine`) and seven on the L1 deciders.
  In all the branch adds fourteen floor rows: those ten, `envelope.ts#fixedLineMailOf` and `#sweepDesignationOf` (Task 4),
  `overlordInbox.ts#inboxProbeSourceOf` (the inbox's probe source through its two steps, which the door and the wake share), and
  `envelope.ts#fixedLineReplayOf` (fix round 1). Fix round 1 also added mutants to the existing `probeDoor.ts` sets.
- **The read runner** (Task 2): `server/src/coord/overlordRead.ts#runOverlordRead`, the one "count, then record, then answer" for
  every Overlord read door, and three readers on the private store: `servedReadsSince` (the ceiling's counter), and the
  text-free `unsettledFacts` and `messageFactsById`.
- **The three doors** (Task 3), in a routes file of their own, `server/src/coord/overlordInboxRoutes.ts`: `GET /api/overlord/inbox`,
  `GET /api/overlord/messages/:id` and `POST /api/overlord/messages/:id/acknowledge`, each a box-token lane that asks the gate
  with its own `OVERLORD_DOORS` row and is fenced (`write: true`). `operator-message-readers.test.ts` holds that only the
  `messages` handler reads a message's words outside the private store.
- **The fixed-line table and the coalesced wake** (Task 4): the mail lane's operator-message branch became one table,
  `server/src/coord/envelope.ts#FIXED_LINE_MAIL` (first as a move-only one-row table, then the `spot-probe` and `inbox-wake`
  rows), read through `fixedLineMailOf` with the designation the sweep already reads once a pass. A row whose first delivery
  moves nothing in the private store is acked on its first delivery (`operatorModel/nudgeLane.ts#settleFixedLine`). The wake
  lane, `server/src/coord/overlordInboxWake.ts`, runs on the `inboxWake` row of `LANE_SCHEDULE` and asks the gate through
  `overlordGateRun.ts#overlordReadGate`, which reads the same facts as the door's runner; `buildServer` hands it to the watcher
  (`FleetWatcher.useInboxReadGate`), as it hands the coordination serialiser.
- **The client and the door tools** (Task 5): `ccrc-api`'s `overlord.inbox`, `overlord.messages` and `overlord.acknowledge`, and
  the door process's `inbox`, `messages` and `acknowledge` tools, all three fenced.

## Departures, by slug

The plan's own slugs are built as its "Deviations found" section states them: `read-ceilings-from-cadence`,
`one-runner-for-every-read-door`, `no-line-no-read`, `inbox-carries-ids-not-words`, `probe-round-served-alone`,
`wake-covers-unnudged-rows`, `fixed-line-mail-is-one-table`, `inbox-is-the-roles`, `acknowledge-absent-is-said-not-operator`,
`messages-one-id`, `inbox-fails-whole`, `fenced-reads`, `ceiling-counts-fenced-reads`, `acknowledge-stamps-after-the-store`
(not built yet, see `acknowledge-stamps-nothing-without-sequence-a`) and `wake-holds-with-the-gate`. These are new, measured on
`main` at `b33a9ae137`:

- `inbox-doors-in-their-own-file`: the plan puts the three handlers in `server/src/coord/overlordRoutes.ts`. The box-token census
  pins that file to the operator's session-gated doors only, with no box-token lane. The doors live in
  `server/src/coord/overlordInboxRoutes.ts`, a lane source of its own for the box-token census, and one more file the gate
  census and the doors census scan.
- `acknowledge-stamps-nothing-without-sequence-a`: sequence A has not landed (no `stampSequenceInTx`, no `SEQUENCE_KIND_MAP`),
  so `acknowledge` writes no sequence line. The spot is marked in the handler. Whichever of this piece and sequence A lands
  second adds the stamp call there and its census row (the plan's "Sequence A" paragraph; sequence A's worker was told).
- `said-not-operator-already-in-the-vocabulary`: `said-not-operator` (409) and `read-ceiling` (429) were already in
  `OVERLORD_REFUSALS`, so `shared/refusal.ts` and the refusal table data are unchanged. Door process B1 shipped
  `unknown-message` (404) at its pick-up report; the plan's index change 5 (one word for one cause) is left to that piece.
- `closed-book-ledger-written`: `READ_LEDGER_WRITTEN` was `false`, pinned to "nothing in `server/src` calls `recordRead`". The
  runner is that first caller, so it turns `true`, and `readsBetween` leaves out lines whose door is `inbox` and lines whose
  outcome is not `rows` in the same change (the plan's question 6 and index change 5): an inbox read never opens a probe's book.
- `ledger-generation-is-n`: a read line's `generation` is the pass's live generation number `n`, not its row id.
- `opener-census-names-the-store-opener`: the plan's census holds `openOperatorModelDb(` to `index.ts`. On `main`, `index.ts`
  calls `openOperatorModelStore`, which calls the opener inside `server/src/operatorModel/`. The census allows the opener only
  under `server/src/operatorModel/` and `openOperatorModelStore(` only in `index.ts`.
- `wake-hook-verdict-holds-not-designated`: the decider holds a `hook` gate verdict as `not-designated`, and a designated session
  whose gate was not asked as `unmeasured`, because `not-the-overlord` may be spelled only in `overlordGate.ts` (the core
  vocabulary census).
- `wake-sender-spelled-in-l0`: `INBOX_WAKE_SENDER` is `operator`, spelled in L0 because the private store's constant may be
  imported by type only there; a test holds the two equal.
- `wake-line-lapsed-clause`: a deadline already past renders "the first has lapsed"; a time left is rounded up to whole seconds.
  No W1 row has a deadline.
- `one-reading-of-the-callers-generation`: the plan has the wake read "the same readers gates B's runner binds". The runner's
  fact reading is factored into helpers that `overlordReadGate` shares, and one exported `callerGenerationOf` is the only
  reading of a caller's live generation, used by the runner, the read gate, the inbox door and the wake.
- `mail-origin-carries-the-body`: `CoordStore.mailOrigin` also answers the mail's body, which only the wake's fixed line reads
  (its keys and counts; the time left is read at the mail pass's clock, `wake-time-left-is-the-pass-clock` below). No words: a
  wake body holds ids and numbers only.
- `wake-logs-not-designated-once`: a box with no designated session logs `the inbox wake holds: not-designated` once a boot,
  by the plan's rule that a hold is logged when its word changes.
- `acknowledge-body-is-the-pane-pair`: `ccrc-api overlord acknowledge <id>` takes no body; the client builds
  `{"byId":…,"byUuid":…}` and refuses any `--json`.
- `non-pass-gate-is-unavailable` (review 3506 A3): the three doors answer a gate result other than `pass` with `unavailable`
  (503, "the gate did not pass the call"), as the linking confirm does, where the plan names `not-the-overlord`. The branch is
  unreachable today: each door's row refuses the hook's group (`others: 'refuse'`), so the gate itself refuses first, and
  `not-the-overlord` may be spelled only in `overlordGate.ts` (the core vocabulary census).

## Fix round 1 (review 3389)

- `fixed-line-replay-acks-only` (F1): a wake or a spot-probe notice is acked on its first delivery. When the process stops between
  `markDelivered` and that ack, the row stays outstanding and comes back as a replay. `coord/envelope.ts#fixedLineReplayOf` answers
  `ack-only` for it, and `operatorModel/nudgeLane.ts#finishFixedLineAck` acks it before the mail pass would type, so the
  recipient is never told twice and the wake's `outstanding` hold clears. To keep the mail pass at its 150-line cap, the stranded
  `/clear` read moved into the send's own options.
- `ledger-coverage-is-incomplete` (F2): `READ_LEDGER_WRITTEN` says that a read door writes the ledger, which makes a counted read
  `open`. It never said that every read leaves evidence. The timer list (`GET /api/sessions/:id/timers`) answers a timer's note
  with no ledger line and no read stamp. `continuity/probeDoor.ts#READ_LEDGER_COMPLETE` (false) keeps the designated session
  uncovered, so a zero count answers `unmeasured`, never `closed`, while a counted read is still `open`. The change that gives the
  timer list its evidence turns it true. No continuity route changed. Downstream: with no `closed` spot probe to fit, the fitted
  ceiling (`continuity/renewalReadings.ts#fittedCeilingOf`) reads the window's hard cap, so the soft ceiling reads the hard cap
  until the timer list gets its evidence. That is the plan's cap-as-measured (slug `fitted-ceiling-is-the-producers-answer`).
- `acknowledge-unknown-is-unsupported` (F4): a message in a state this build does not know is `unknown` to `acknowledgeVerdict`.
  The private store's move refuses it (`messageMove`), so the door answers 501 `unsupported`, writes nothing and is not retried.
  It used to report that the message could be settled and then answer `write-failed`.
- `inbox-keeps-unknown-rows` (F5): `unsettledFacts` keeps every row not in a settled state, so a row in a state this build does
  not know stays in the inbox as a text-free `unknown` fact.

## Fix round 2 (review 3506)

- F1, the recovery measured end to end: `overlord-prompt-record.test.ts` seeds a wake, and a spot-probe notice, that were
  delivered once and never acked. It replays each past the replay window through the real `sweepMail` and asserts the row ends
  `acked`, with no line typed and no key pressed. Measured: with the pass's early exit after `finishFixedLineAck` removed (a bare
  call), both cases are red: the row is acked, then the line is typed again (one literal send where none is expected). With the exit
  restored, byte for byte, both are green. No production code changed.

## Residuals accepted by the coordinator (review 3389)

The coordinator accepted these by mail in fix round 1. Each is stated here as the code behaves.

- Third finding, the read ceiling's window. `coord/overlordRead.ts#runOverlordRead` counts a door's served reads
  (`servedReadsSince`), decides the ceiling, then awaits `compose()`, and only then records the read line (`recordRead`). Nothing
  serialises the route handlers around that window: no lock, and the runner is not on the coordination serialiser. Two requests
  admitted and witnessed together could both count the same last slot before either records, and both be served. This is a
  static trace from the source, not a reproduction. Whether two valid production requests can overlap is unverified: the door
  process sends its calls one at a time.
- Sixth finding, the message id vocabulary. `shared/overlordInbox.ts#parseMessageId` accepts any positive safe integer, while
  `ccd/ccrc-api` refuses an id longer than ten digits (`bad-id`) and the door process does not check safety before the client
  refuses. A valid id of eleven or more digits cannot be fetched or acknowledged through the client. One shared L0 rule for all
  three is the fix, for a later piece.
- Seventh finding, `wake-time-left-is-the-pass-clock`. The wake's time left is rendered from the mail pass's clock
  (`watch.ts`'s `mailPass` takes `Date.now()` once at its start), not the moment the line is typed. So it is at most one pass
  earlier than typing. It is latent: no W1 row has a deadline. This pull request's comments now say the pass's clock
  (`envelope.ts`, `operatorNudge.ts`, `overlordInboxWake.ts` and three test comments); no comment in another piece's file says
  otherwise.
- Turn-state lead, unverified: `server.ts#buildServer` passes a null live-process fact to `readTurnMarkMeasured`, which may keep a
  stale marker from an earlier process of the same session id from reading as stale. Not measured.
- Conformance leads: the L1 inbox module imports another L1 module at runtime where the plan's text asks for L0 only (the import
  is pure, so the ring rule holds), and the non-pass gate wording is `non-pass-gate-is-unavailable` above.

## Absorb of main 5102a69aa3

One merge of main at `5102a69aa3` (after #3208), on the coordinator's absorb request. Two paths conflicted, on counts only,
and were resolved by hand, keeping both sides: main's restore doors and this piece's inbox doors.

- `server/src/auth/gate.ts`: the gate stands in front of 297 routes (main 294, this piece 295, the merge base 292).
- `server/test/auth-gate.test.ts`: main's comment for 297 is kept and the inbox line added. It now reads 300 routes, 300
  scanned, 297 HTTP routes, 186 gated and 111 exempt.

Re-derived from the merged tree and found already right, with no edit: the box-token census, `README.md`'s machine-lane count,
the client's route table, the doors census, the run-session census and the four census suites of the inbox piece. One row was
added: `mutation-floors.json`'s `server/src/coord/envelope.ts#fixedLineReplayOf` at floor 1, the exact bytes the isolation
piece agreed to. The first full run of the floors file on this branch also caught mutant L4 in `sim/probeDoorSets.ts`, whose
target line fix round 1 had changed (`covered: true` became `covered`). Its target text now follows the source, and it is
killed again.

## Index changes this piece asks for

As the plan's "Index changes" section lists them, with these measured notes:

- Item 4 (board and history B, sequence C): call `runOverlordRead` after their own gate call; `READ_CEILINGS` already holds
  `board`, `history` and `sequence`.
- Item 5: `readsBetween`'s exclusion is built here (`closed-book-ledger-written`). The pick-up report's `unknown-message` stays.
- Item 7: open until sequence A lands (`acknowledge-stamps-nothing-without-sequence-a`).

## Shared files

Edited in own hunks beside W1 peers, under the coordinator's ruling of the day: `server/src/server.ts`, `server/src/watch.ts`,
`server/src/coord/ports.ts`, `server/src/laneSchedule.ts`, the census and gate suites, `mutation-floors.json` and `CLAUDE.md`.
`README.md`'s machine-lane count and door line came by a packet that run 1850's coordinator accepted for this exact text.
Whoever lands second re-derives the count words.
