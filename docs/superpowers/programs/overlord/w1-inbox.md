# Overlord W1, the inbox and its reads: task notes

The W1 inbox piece (`docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`, the one pull request of its "The PR split";
spec `docs/superpowers/specs/2026-11-09-overlord-design.md` §6.8, §3.8, §3.2, §3.3.5, §11.2). What the ledger should learn
from this pull request. The coordinator folds it into the programme ledger and mints the numbers.

## What was built

- **The vocabulary and the deciders** (Task 1): `shared/overlordInbox.ts` (bands, row kinds, each kind's own nudge, the row and
  answer shapes, `READ_CEILINGS`, the path id parser, the wake's subject, body codec and fixed lines) and
  `server/src/coord/overlordInbox.ts` (`composeInbox`, `inboxOrder`, `rowNudgeOf`, `readCeilingVerdict`, `acknowledgeVerdict`,
  `inboxWakeVerdict`, `inboxProbeSource`). `READ_DOOR_MAP` gains `sequence`. Ten mutant sets join the floors, every mutant killed.
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
  (its keys and counts; the time left is measured at typing). No words: a wake body holds ids and numbers only.
- `wake-logs-not-designated-once`: a box with no designated session logs `the inbox wake holds: not-designated` once a boot,
  by the plan's rule that a hold is logged when its word changes.
- `acknowledge-body-is-the-pane-pair`: `ccrc-api overlord acknowledge <id>` takes no body; the client builds
  `{"byId":…,"byUuid":…}` and refuses any `--json`.

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
  timer list its evidence turns it true. No continuity route changed.
- `acknowledge-unknown-is-unsupported` (F4): a message in a state this build does not know is `unknown` to `acknowledgeVerdict`.
  The private store's move refuses it (`messageMove`), so the door answers 501 `unsupported`, writes nothing and is not retried.
  It used to report that the message could be settled and then answer `write-failed`.
- `inbox-keeps-unknown-rows` (F5): `unsettledFacts` keeps every row not in a settled state, so a row in a state this build does
  not know stays in the inbox as a text-free `unknown` fact.

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
