# Overlord W1: the readiness word (task note)

The note of the one pull request that builds `docs/superpowers/plans/2026-11-14-overlord-w1/w1-readiness.md`, Tasks 1 to 4
(programme overlord, wave 235, run 3866). The coordinator folds what the ledger should learn from it. No deviation number was
allocated: every departure below is a slug.

## In short

One measured word for the designated Overlord, decided by a pure first-match table (`overlordReadiness`, Table 6.4a) that
never rises on doubt. A lane computes it every ten seconds from each producer's one reader, records each change of word as a
row stamped on `overlord_sequence`, and serves it through one read that answers `unmeasured` (`boot`, `stale`) whenever this
process has not measured lately. The operator is told one push per dead episode, and items that end when their cause clears.

The build is in two stages (the brief): stage 1 is everything that touches no file the invariant monitor's worker (#3394)
holds; stage 2, after the monitor lands, adds the held files, the wiring and Task 4.

## What was built, task by task

| Task | Commit | What |
|---|---|---|
| 1 | `feat(overlord): the readiness word, decided first match and falling only with doubt (H20)` | `shared/overlord-readiness.ts` (L0: the fourteen words, `admitRank`, the starting values, `RESTART_OUTCOME_MAP`, `STRAND_CAUSE_MAP`, `ReadinessWire`); `server/src/coord/overlordReadiness.ts` (L1: `readinessFactsOf`, `overlordReadiness`, `readinessNotices`, `servedReadiness`, `readinessCountOf`, `readinessSubjectOf`). Tests: an exhaustive reference written from the plan's rows over three domains (130,464 cases), monotonicity over `admitRank`, unmeasured never ready, the restart count and bound, every notice rule, and the spec's Table 6.4a read both ways (`single-definition/overlord-readiness-table.test.ts`). |
| 2 (stage 1) | `feat(overlord): readiness rows, stamped on the one sequence, and the items' records (H20)` | The migration (two tables, two indexes); `coord/overlordReadinessStore.ts` (`recordReadinessInTx`/`recordReadiness`, `readinessNow`, `readinessChanges`, `openReadinessItems`, `closeReadinessItem`, `pruneReadiness`); `continuityStore.ts#restartsSince` and `#liveGenerationOfIdentity`; the private store's `lastServedReadAt`; the `readiness` kind in `SEQUENCE_KIND_MAP` and its writer in the stamp census. |
| 3 (stage 1) | `feat(overlord): the readiness lane's pass and its read, behind a port (C23, H20)` | `coord/overlordReadinessLane.ts`: `ReadinessLane` (its memory, `pass(tick)`, `read()`) behind `ReadinessLanePort`. |
| merge | `Merge remote-tracking branch 'origin/main'` | The one ordinary merge of `main` at `ad35cf5538` (the invariant monitor, #3394), at the coordinator's stage-2 word. The schema file's conflict was taken as main's side, so the merge adds nothing of this branch's there. |
| 2 (migration) | `feat(overlord): migration 130, the readiness word's two tables, and the pins that count it (H20)` | Migration 130 (two tables, two indexes), the two schema-version pins and the lifecycle test's entry count: its holders' yes'd packets, in one commit so the expected renumber is one edit. `test(overlord): the two replay tests undo migration 130 too` moves the two hand-written undo chains. Renumbered to **131** at the merge of main 812b6c4e4e, where the paste delivery recipe's table (#3415) took 130; the pins and both undo chains moved with it. |
| 2 and 4 | `feat(overlord): a dead Overlord's one push, and the stranded, count and hold items (C23, C56, C57)` | `ledgersStore.ts#settleItemCheckedInTx` beside the checked raise; `raiseReadinessItem` and `settleReadinessItem` (each the operator item and its record in one transaction, on `OVERLORD_ITEM_PROGRAMME`, raised by `ccrc`); `READINESS_PUSH_TEXT` and `READINESS_ITEM_TEXT` (L0), `readinessPushOf` and `readinessItemTextOf` (L1); the lane acts through the store, and its port loses `raiseItem` and `settleItem`; the writers census. |
| 3 | `feat(overlord): the readiness lane runs every ten seconds, and GET /api/overlord/readiness serves its word (C23, H20)` | The `overlordReadiness` row of `LANE_SCHEDULE`; the watcher's `sweepOverlordReadiness` and its two calls; `Deps.overlordReadiness`; `coord/overlordReadinessWiring.ts#readinessLaneOver`, built once in `index.ts`; the read door, its door-table row and its masked-route entry; the run-session census's three non-binding sites. |
| 1 (floors) | `test(overlord): the readiness deciders' mutation floors, 58 mutants, all killed (H20)` | `test/sim/readinessSets.ts`: four keys at floor 1. |
| census | `test(overlord): the gate's counts, ...` and `test(overlord): the box-token census lists the readiness read ...` | The gate's route counts, the box-token paragraph of `CLAUDE.md`, core-vocab's handle holders and `OVERLORD_OPERATOR_DOORS`: each its holder's yes'd packet. |

## Where main differed from the plan

Measured on `4fa87d73f8` before Task 1 (mailed to the coordinator, mails 36603 and 36604):

- Every producer the plan cites is on main but `OVERLORD_ITEM_PROGRAMME` (the monitor, #3394) and `accountHolds` (later).
- `GenerationOutcome` gained `retired` after the plan was written (slug `retired-outcome-is-not-a-restart`, below).
- main already classifies StopFailure tokens (`server/src/coord/stopFailure.ts#STOP_FAILURE_ERRORS`, seven in its account
  class), where the plan meant to measure its own list (slug `account-failure-reads-the-stopfailure-classes`, below).
- `restartVerdict(binding, body, now)` also refuses while a pending attempt is inside its deadline, so `restartable` (and the
  push's Restart action) is false then, as the door is.
- The private store answers `StoreRead`; an empty inbox read writes a served line (`rows`, count 0), so `lastServedReadAt`
  takes the served outcome only, and a case pins that an empty read counts.
- The ladder's read is composed in `server.ts` (the gate's ladder port); the default rung is `chat`.
- The candidates are `renewalReadings.ts#overlordCandidatesOf`; exhaustion per candidate is `poolRunway.ts#earliestReset` over
  that account alone.

## Departures, by slug

The plan's own slugs stand as written (questions 1 to 14, and `strand-cause-from-structured-readers`). This build adds:

- **`retired-outcome-is-not-a-restart`** (ruled yes, call 1319). `RESTART_OUTCOME_MAP` has a fourth class, `retire`, for
  `retired`: the operator ended the binding and no later start replaced it, so it is never counted. A case pins that a retire
  then a new designation's first start counts zero restarts, in a new term and in the same term.
- **`served-read-bounded-by-the-generation-start`.** `lastServedReadAt(generation, sinceMs)` takes the generation's start too:
  the read ledger is never pruned and has only the `(door, at)` index, so each door's range reads the index instead of the
  ledger. Proof older than the start never counts anyway (question 7).
- **`readiness-port-declared-by-the-lane`.** The lane's port is declared in the lane's own file (the consumer declares the
  port), not in `coord/ports.ts`, which another worker holds.
- **`registry-named-before-the-brakes`.** Row 3 names the registry before `off`: on a failed listing `mail-disabled` is
  unreadable too, and the plan's Table 2 and Task 3 say the failed listing reads `why: registry`. The word is the same
  either way.
- **`readiness-reads-only-on-coord-store`.** `CoordStore` gains read delegates only (`readinessNow`, `readinessChanges`,
  `restartsSince`, `liveGenerationOfIdentity`); the writers are called by the lane alone, so they get none.
- **`account-failure-reads-the-stopfailure-classes`** (ruled yes, call 1319; a departure from the spec's Table 6.4a sentence
  "only for `rate_limit`, `authentication_failed` or `billing_error`"; the spec already carries the ruled sentence). The
  strand's `turn-failed` cause reads the stall watch's one classifier, `stopFailure.ts#stopFailureClass(err) === 'account'`,
  and the plan's L0 `ACCOUNT_FAILURE_ERRS` is not built. Measured list on `4fa87d73f8` (source: `STOP_FAILURE_ERRORS`, the
  hook's StopFailure arm records Claude Code's `error` cleaned to `[a-z_]`): `rate_limit`, `billing_error`,
  `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `verification_required`, `cloud_credential_error`.
  A token the classifier cannot name (it answers null, a missing token included) is neither a failure nor a pass: the
  strand fact reads unmeasured, so the word answers `unmeasured` at row 8 (`stranded`), never higher, unless a measured
  cause (an empty set, every account limited, a blocked swap) strands it first. A case pins that the cause follows the
  owner's class token by token, so a token added to that class later is covered with no edit here.

- **`readiness-lane-built-in-the-composition-root`.** The plan builds the lane object in `watch.ts`, with `index.ts` as the
  fallback. It is built in `index.ts` by `readinessLaneOver`, as the invariant monitor is: each port member needs a producer
  the composition root holds (the private store, the watcher's limits, the notice sinks). The watcher keeps only its sweep and
  the two calls (`watch.ts` +11 net lines).
- **`readiness-reads-the-operator-rung-from-the-ladder-rows`.** The plan's input is `ladderRead(...).effective.operatorRung`.
  The composed ladder read is built inside `server.ts` with the watcher's conditions, and a condition never moves the operator's
  rung, so the wiring asks the ladder's one decider (`overlordLadder.ts#effectiveRung`) over the stored row with no latches
  and no conditions. An unreadable row is `unmeasured`, as before.
- **`readiness-settle-refused-writes-nothing`.** When the lane's settle finds the item already moved by the operator
  (dismissed or done), it writes nothing and answers `settled: false`; the next pass's reconcile closes the record as the
  operator's. No record is settled twice, and a dismissed item is closed, never settled.
- **`readiness-item-levels`** (fix round 1, F2, ruled). What differs from the plan's question 9 is the `count` and `hold`
  items only: they are `later`, not `soon`, because each stands beside a running Overlord (one account short of a spare, or
  one account held out of its list) and nothing it does waits on them. The `stranded` item is the plan's `soon` with no label,
  so it pushes nothing; no item of this piece is `blocking`, none takes a push-outbox reach, and the store imports nothing from
  the push outbox. The one push of this piece is the dead push, once per episode.
- **`restart-under-way-until-minted`** (fix round 1, F1). The plan's restart in progress counts only while the body is
  `down`. `restartsSince` counts minted generations, and the generations lane mints on its own 30 s cadence while this lane
  passes every 10 s, so from the body coming back up to its generation minting a third restart read below the bound,
  broke the dead episode and pushed again. The lane now keeps its newest first `down` sighting within the hour after the body
  is back up (`SubjectReadings.lastDownAt`, memory, never stored), and the decider counts the restart as under way until a
  generation whose start is after that sighting is live, unless the generation is renewing (a renewal's own restart, which
  is not counted). Why this and not holding the episode open: it keeps the rule in the count, where question 3 puts it, so
  `dead` reads from the down sighting to the end of the hour with no other word between, and the episode break rule stays
  one rule. The decider case "2 completed and the body up is not dead" stands unchanged, with no down sighting; new cases pin
  the stretch, and a lane case runs down, up and not yet minted, minted, with one push.
- **`readiness-ready-clock-per-binding`** (fix round 1, F10, ruled). The plan's `readySince` is the newest `ready` row of any
  session. It is now the current binding's: `readinessNow` also answers that row's session, and the decider starts the deaf
  clock only when it is the subject's, so a new Overlord that was never ready has no deaf clock from its predecessor. The row
  already carries what tells bindings apart: every designation and rebind binds a new body with a session id of its own, and
  a restart keeps it, so no schema change. `leftReadyAt` stays global, as the review found harmless.
- **`readiness-read-is-the-lane-read`** (fix round 1, F13). The board's named read, the plan's `readinessRead()`, is built as
  the lane's `read()` (`ReadinessLane.read`), which serves `servedReadiness`; the L0 comment says so.
- **`readiness-item-detail-in-why`.** Each item's `how` is fixed per item and cause, as short steps; the one measured detail
  (the earliest reset, ccd's refusal, the failure word, ccd's reason, the count) closes its `why`. The earliest reset over
  the candidates is `unmeasured` when any candidate's reset is unreadable, and is written in UTC to the second. The hold item
  names its lane only: the holds port carries no profile properties, so its `how` points at the hold beside the item.
- **`readiness-push-restart-action-opens-the-url`.** The dead push carries the action `overlord-restart` only when Restart
  would act; the service worker has no handler of its own for it yet, so a tap opens the push's `url` (`/`), as the body tap
  does. Home A gives the place its path later.

What the designation plan's Restart section would have said (fix round 1, F5, carried here at the coordinator's ruling):
"`restartVerdict` is the one Restart decider: readiness's `restartable` asks it, so the dead push carries Restart exactly when
the door would act. It accepts an asleep or gone body, and refuses an up, a restarting (`down`) or an unmeasured one, and any
body while a pending attempt is inside its deadline."

## Readings the tests pin that the plan leaves implicit

- A body down WITHIN the bound reads `restarting` even while the generation renews (row 5 comes before row 6); past the bound
  with the generation renewing it reads `renewing`.
- A `down` body is never past the bound until the lane has seen it: `since` is the lane's first sighting.
- When both `deaf` halves are unmeasured, the operator-message half is named.

## Mutation tables

Every mutant ran against its set's suite (`test/sim/readinessSets.ts`). Before: the unmutated suite green (the harness refuses
to score otherwise). After: each mutant red in at least one case. Floor 1 for each key; no other floor moved.

| Key | Mutants | Killed | The plan's mutants among them |
|---|---|---|---|
| `overlordReadiness.ts#overlordReadiness` | 14 | 14 | swap stranded and dialog-open, swap dialog-open and wedged; an unmeasured wedged or stranded read as the fault; the renewing guard on the third-restart clause; `>=` for the bound (and for the count); `not-built` read true (saturated, deaf's held half); proof equal to `leftReadyAt` |
| `#readinessFactsOf` | 24 | 24 | drop the in-progress `+1`; add it while renewing; `limited` at the ceiling line read from one candidate, not all (the code has no chat line); an `absent` turn marker read as wedged; the deaf clock started with a null `readySince` |
| `#readinessNotices` | 16 | 16 | push on a level; the count item raised under a `set-admits-none` strand; settle on an unmeasured cause (its guard is redundant behind row order, so the mutant reads an unmeasured word as measured); settle instead of close a dismissed item; raise on `absent` |
| `#servedReadiness` | 9 | 9 | serve the stored word before the first pass; serve it past the limit |
| `#readinessCountOf` (fix round 1, F8) | 4 | 4 | the unmeasured-candidate guard deleted (CO-1); every candidate counted; no list or an unmeasured list counting none |

The extra mutants (37 of the 58) are listed by id in the set file. One extra (`FA-19`, an unproven generation read as proven)
first survived; a generation-mapping case was added and it is now killed. The push and item-text deciders were mutated by
hand while their tests were written (13 mutants, each red): the Restart action dropped, the bodies swapped, a constant dedupe
key, every cause given one text, the detail sentence dropped, the hold's lane dropped, the count's plural, the latest reset
for the earliest, the time cut to the minute, a reworded refusal, an L0 `how` replaced, the push url, a count step dropped.

Fix round 1 adds the `readinessCountOf` key at floor 1 and five facts mutants: FA-20 the restart under way ends when the body
is back up, FA-21 a sighting exactly an hour old no longer counts, FA-22 a generation started at the sighting reads minted,
FA-23 a renewing generation counts once back up (F1), and FA-24 the ready clock of any session (F10). Three mutants were
retargeted to the moved text, their meaning unchanged: FA-2 and FA-6 (the restart in progress) and NO-15 (a checking item
is live, now over the ledger's own list). 67 mutants in all, every one killed.

## Fix round 1 (review 3922, call 1438)

Each fix ships with a case that is red without it, measured by putting the old line back, running, and restoring it.

| Finding | Fix | Red without it |
|---|---|---|
| F1 | the restart under way until its generation mints (slug `restart-under-way-until-minted`) | the up half set to `false`: three decider cases and the lane sequence (down, up and not yet minted, minted: dead throughout, one push); the window made exclusive; the minted check made `>=`; `!renewing` dropped |
| F2 | the stranded item `soon` with no label, no reach, no outbox import (slug `readiness-item-levels`, reworded) | the level put back to `blocking`: the store's level case and the lane's "no outbox row" case |
| F3 | the boot flag set only once the first row is recorded | the flag set before the record: a refused first row, and a refused first stamp, each read a stored `ready` |
| F4 | a pass token checked after the awaits | the check disabled: an overtaken pass held at the turn marker, and at the hook state, writes a row |
| F5 | the item-state lists imported from `shared/ledgers.ts`; the unused closed-by list removed | NO-15, retargeted to the imported list, killed |
| F6 | (tests only) down, up, down; dialog, none, dialog; nobody designated between sightings | each reset and each `clear` deleted alone |
| F7 | (tests only) `overlord-readiness-wiring.test.ts`: the sweep passes the tick on a listed tick and a failed listing; text pins of the two calls, the sweep and the root's assignment | each call, the sweep's body and the assignment deleted |
| F8 | `readinessCountOf` in a mutation set, floor 1 | CO-1 to CO-4, all killed |
| F9 | the prune keeps an open dead episode's first row by the break rule, whatever the newest word | the keep list put back to the newest row's episode |
| F10 | the ready clock is the current binding's (slug `readiness-ready-clock-per-binding`) | FA-24, and the decider case over a predecessor's ready row |
| F11 | "Rows added" corrected: one row and one line ever with nobody designated; two a start with a designation; about fifteen producers a designated pass | (note) |
| F12 | migration 131 everywhere; the spec-amendment sentence removed | (note) |
| F13 | the L0 comment names the lane's `read()`; slug `readiness-read-is-the-lane-read` | (comment) |
| F14 | an unreadable identity reads the generation and the restarts unmeasured | the fallback to the session id put back |
| F15 | (test only) two passes within a day prune once, a pass a day later prunes again | the throttle removed, and made never to repeat |
| F16 | the restart-count suite copies a migrated template, as its two siblings do | (setup only) |

## What runs from the merge

Measured on the test box at this branch's tip, with nobody designated: the real lane, built by `readinessLaneOver`, over a
fresh fixture `coord.db` opened through every migration, with fake time ports. 362 passes at 10 s (an hour), then one jump
of a day past the prune.

- **Arms:** one lane, `overlordReadiness`, every 10 s on the monotonic throttle, one pass at a time. No timer, no process, no
  ccd verb, no switch. The read door answers `unmeasured` (`boot`) until the first pass.
- **The first pass** reads the designation and the stored word, then writes one `absent` row and its one `overlord_sequence`
  line in one transaction, then reads the item records and runs the day's prune, which deletes nothing.
- **Every later pass** runs five statements, all reads: the designation, the stored word (two), the change-of-word check and
  the item records. The change-of-word check runs inside `recordReadiness`'s `BEGIN IMMEDIATE`, which writes nothing and
  commits, so the write lock is taken once a pass. Held: 0.038 ms at the median, 0.63 ms at the worst of 364 transactions.
- **A pass** takes 0.18 ms at the median and 0.39 ms at the 99th percentile.
- **Rows added** (corrected in fix round 1, F11, as the review measured): with nobody designated, one `absent` row and one
  `overlord_sequence` line ever, not one per start (a restart's pass answers the same `absent` and writes nothing), and none per
  day. With a designation, each server start writes two rows and two sequence lines (the boot `unmeasured` row, then the
  measured word), and a designated pass reads about fifteen producers, not five. No `overlord_readiness_items` record, no
  `operator_items` row, no `push_outbox` row and no push before a designation.
- **Nothing arms before a designation:** `overlord-readiness-route.test.ts`'s case "a lane over a fixture coord.db with nobody
  designated writes the absent word once, and raises no item and sends no push" fails if a pass with nobody designated writes
  a second row, a second sequence line, an item, an outbox row or a push. Mutated (a designation answered as a designated
  session), it goes red.

## Known limits

- The holds port is `not-wired` until renewal readings PR H passes `accountHolds`: no hold item is raised before it.
- The migration number (131) and the gate's route counts are provisional: both are settled at this pull request's last merge
  of `main` before the queue (the coordinators' rule, call 1369).
- A crash restart whose generation mints in a new term is not counted: a new term starts a new chain of restarts, and only an
  operator act raises the term (review 3922, recorded, not filed).
- The dead push's Restart action reflects the episode's first row: a body that moves from `down` to `gone` inside one episode
  updates the row in place with no new push, so the push can lack a Restart the door would now accept; the tap opens the place
  either way (review 3922, by design).
