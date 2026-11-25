# Overlord W1: the Overlord's timers (task note)

The note of the one pull request that builds `docs/superpowers/plans/2026-11-14-overlord-w1/w1-overlord-timers.md`, Tasks 1
to 5 (programme overlord, wave 232). The coordinator folds what the ledger should learn from it. No deviation number was
allocated: every departure below is a slug.

## In short

The Overlord becomes a setter of the timer lane W1a built, never a second mechanism. The three timer doors are
`OVERLORD_DOORS` rows that call the gate; every other session keeps W1a's path byte for byte (pinned before the gate, through
the real server); the designated session sets, lists and cancels the role's timers, stamped with the designation's
`designatedTerm`. The lane reads the designation and the authority guard at the top of its synchronous pass: the role's
timers wait while the guard is not coherent or the designation is unmeasured, cancel `retired` once it binds no session or
another term, and fire with a restore line when set before a confirmed restore. Their one mail keeps `overlord` on the row,
goes to the bound session, and reaches the pane as one fixed line that waits until the live generation has read its card.
Every refusal a timer door answers itself after its token is counted (M36). One migration, number 128 on the merged tree
(main took 127 through #3345; renumbered in the one merge of `main`).

## What was built, task by task

| Task | Commit | What |
|---|---|---|
| 1, step 0 | `refactor(timers): the setter's facts are one arm of a union` | W1a's setter facts move into the `session` arm of `SetterFacts`; the K mutants quote the new reads. Every W1a case unchanged. |
| 1 | `feat(timers): the setter kind overlord in the cleanup, and the restore fact` | L0 words (`overlordTimerStamp`, `TIMER_FIRED_SHOWN_MS`, `FiredTimerView`, `TIMER_RESTORE_FACTS`, `TIMER_DOORS`, `TIMER_OWNERS`, `OVERLORD_TIMERS_READS`); the cleanup's `overlord` arm; `timerRestoreFact`; the restore line in `packTimerMail`. |
| 2 | `feat(timers): the restore generation at the set, the fired list and the refusal count` | The migration (a column and a table); `insertTimer` writes `setRestoreGeneration`; `firedTimersOf`, `recordTimerRefusal`, `timerRefusalCounts`, `purgeTimerRefusals`; the writers map. |
| 2 | `feat(timers): the store's delegates ...` | The four `CoordStore` delegates and `mailOrigin`'s `toId`, applied after the holder's yes (packet). |
| 3, step 1 | `test(timers): pin the timer doors' answers before the gate` | `timer-doors-characterization.test.ts`: the five doors through the real server, as a coordinator, a worker and the operator, every status and body pinned, green on the base. |
| 3 | `feat(timers): the Overlord's timers through its door process, stamped with designatedTerm` | The three rows (`act: null`, `unmeasuredDesignation: 'by-profile'`); step 10 skipped for a `null` act; step 1's profile arm; the doors' role path, the restore stamp on every set, the reserved identity word, the operator's read and cancel, the refusal count; the mail route's reserved recipient; the console's mark. |
| 4, move | `refactor(gate): the card fact's mapping is one L1 function` | `cardFactFrom` moved out of the runner, move only, gate suites green. |
| 4 | `feat(timers): the role's timer mail to overlord, one fixed line after the card` | The lane's reads at the top of the pass, the role's arm, `deliverTo`, the refusal purge; the `timer` row of `FIXED_LINE_MAIL`, `renderTimerFiredLine`, `cardHoldVerdict` (first in `envelope.ts`, in this commit), the sweep's hold; the card's timers by identity; the timer day's Overlord case. |
| 4, move | `refactor(gate): the timer line's card hold lives beside step 8, the one home of card-unread` (`b69b9e41c1`) | `cardHoldVerdict` moved from `envelope.ts` to `overlordGate.ts`, move only: the core vocabulary check holds `card-unread` to one spelling file, and step 8 already spells it. |
| 5 | this note | The older-build measurement, departures, mutation tables, what arms on merge. |
| fix round 1 | `fix(timers): the five checks the fast run caught ...` | The census, two migration pins, the mail forms fixture, the sweep's line cap (below). |
| review 3841 | `fix(timers): review 3841: a held timer line claims nothing ...` | F1 to F4 and the note's corrections (below). |

## Where main differed from the plan's "What exists today"

Measured on the base `0a07d29f54`.

1. The watcher's deps are the server's `Deps` less the store, so `overlordAuthorityGuard` and `overlordRestore` already reach
   it (`index.ts` sets them on the same object). `deps.ts` and `index.ts` are not edited.
2. `fixedLineMailOf` already took a `toId`, but it is the delivery's; `mailOrigin` selected no `toId`. The table's matcher now
   takes the mail row's recipient as `mailToId`, beside the delivery's `toId`.
3. `MailGate` lives in `shared/api.ts`, which this piece may not touch: the card hold notes no gate word. It logs once when
   its reason changes and continues, spending no attempt.
4. No I17 predicate exists on main: `overlordSequence.ts` carries no timer or mail invariant. The sequence monitor's mail
   invariant therefore holds trivially; the check is the timer day's own (`TIMER_DAY_INVARIANTS` T1, and the Overlord's day).
5. `LadderActKind` already holds `link-team`, the first door of class `other`; the inbox's three and the history door are
   rows. The census pins that list those rows were extended, not rewritten.
6. The card fact's mapping was inline in the runner (`plainFacts`); moved to `overlordGate.ts#cardFactFrom` first.
7. `otherLaneReadsOf`'s episode latch sits on its `designation()` call, not on a separate function.
8. The identity word was a literal in `roleOf.ts#identityOf`; it is now `OVERLORD_IDENTITY` there, the one spelling.
9. `restoreGeneration()` already answers unmeasured whenever the guard is not coherent.
10. The lane already called `insertSystemMailTx` with `toId: m.setter`, so the mail row's recipient is the setter by
    construction; only the delivery is redirected.

None of these changes what a door answers or what the lane does beyond the plan, so nothing was mailed before building.

## Departures, by slug

The plan's seventeen, built as the plan states them: `timer-doors-name-no-act-kind`, `overlord-lists-its-fired-timers`,
`fired-list-is-the-current-terms`, `fired-list-window-starts-at-the-ack`, `timer-fixed-line-waits-for-the-card`,
`overlord-recipient-is-system-mail-only`, `restore-line-says-it-may-have-fired`, `every-timer-stamps-the-restore-generation`,
`m36-counts-the-timer-doors-own-refusals`, `older-lane-cancels-overlord-timers-setter-gone`,
`overlord-timers-reach-it-by-card-and-list`, `overlord-timers-bind-nothing-in-w1`, `timers-read-before-the-designation`,
`role-timers-wait-while-authority-incoherent`, `timer-doors-unmeasured-designation-by-profile`,
`designation-moved-is-timer-unmeasured`, `operator-cancels-role-timers-through-the-bound-session`.

This build's own:

- `timer-doors-read-the-stores-designation`: the plan gave `ContinuityRouteDeps` a `designation` port. The continuity routes
  already read the designation from the store (`designationReadOf`), so the doors read `coord.designationRead()` the same way;
  no second reader. `restoreGeneration` is the one new port.
- `timer-doors-count-through-the-store`: no `recordRefusal` port; the doors' one helper, `refuseTimer`, calls
  `coord.recordTimerRefusal` inside a `try`, the day from `deps.wall()`.
- `watcher-reads-the-existing-deps`: no `WatcherDeps` member and no `index.ts` line (difference 1).
- `fixed-line-matches-the-mail-rows-recipient-as-mailToId` (difference 2).
- `timer-hold-notes-no-gate-word` (difference 3).
- `exempt-reasons-unchanged`: the three `EXEMPT` reasons in `server/src/auth/gate.ts` were not edited (the session gate's
  file, prose only); the gate order is stated in each door's own comment and its row.
- `card-timers-unmeasured-under-an-unmeasured-designation`: the card's timers key by identity, so an unreadable designation
  makes the fact `unmeasured`, as the checkpoint's already is. See the known limits.
- `episode-logs-through-the-other-lanes-designation-read`: `server.ts` binds the gate's profile port to call
  `otherLaneReads.designation()` before `profile()`, so the whole server logs one line an episode; that line names the other
  lanes' keys, not the timer doors.
- `overlords-day-is-a-named-case`: the timer day gains a named Overlord case on the real lane (rebind, restore with Confirm,
  retire), not a seeded scenario.
- `task-notes-in-the-programme-note`: the plan's `w1-overlord-timers/older-build.md` and `departures.md` are this note (the
  layout guard refuses undated files under `plans/`).
- `refusal-counts-without-rowid`: `continuity_timer_refusals` is `WITHOUT ROWID`, which the plan's table definition does not
  say. Its primary key `(day, door, word)` is the only key it is ever read, upserted or purged by, and a row is three short
  words and a count, so the key is the table: no second b-tree, and no rowid anything could come to depend on. The plan's
  columns, key and writers are unchanged.
- `restore-generation-is-required-on-insert`: `TimerInsert.setRestoreGeneration` is required, so a set that forgets the
  stamp is a compile error.

## Mutation tables

Every floor key is added, none lowered, no pin raised. Each mutant was run against the new code (killed below); the floor
mutants of the reshaped W1a sets (K1 to K14) were re-run after the reshape, every one killed at its unchanged floor.

Floors (`server/test/sim/mutation-floors.json`, run by `mutation-floors.test.ts`):

| Set | New mutants | Killed |
|---|---|---|
| `timers.ts#timerCleanupVerdict` | K15 no authority wait, K16 unbound keeps, K17 the term without the codec, K18 unmeasured read as unbound, K19 another term keeps, K20 the role read as a session | all |
| `timers.ts#timerRestoreFact` (new key, floor 1) | R1 unmeasured now reads none, R2 a null stamp is none, R3 a stamp above now is none, R4 equal is set before, R5 a null stamp after a restore is set before | all |
| `timers.ts#packTimerMail` | P11 the line for unmeasured, P12 no restore line | all |
| `overlordGate.ts#callerStandingOf` | S-13 the Overlord's profile read as other, S-14 by-profile at every door, S-15 unreadable read as other, S-16 absent refused, S-17 no profile read as absent | all |
| `overlordGate.ts#overlordGate` | O-19 step 10 run for a door with no act kind | killed |
| `envelope.ts#fixedLineMailOf` | F20 matched on the sender alone, F21 open to every session, F22 types before the card, F24 never matched | all |
| `envelope.ts#renderTimerFiredLine` (new key, floor 1) | T1 no count, T2 a zero counted, T3 the generic head lost, T4 the hold not carried, T5 matched on the delivery | all |

T4 and T5 mutate `mailNudgeOf`, not `renderTimerFiredLine`, and `mailNudgeOf` has no floor key of its own, so they stay in
the timer line's set, whose cases call `mailNudgeOf` (review 3841 A2). The label is the set's, not the mutated function's.

| Set | New mutants | Killed |
|---|---|---|
| `overlordGate.ts#cardHoldVerdict` (new key, floor 1; beside step 8, the one home of `card-unread`) | C1 a stale card delivers, C2 unmeasured read as unread, C3 every card delivers | all |
| `roleOf.ts#identityOf` | I3's quote reshaped to the constant | killed |

By hand (applied one at a time to the source, the named suite run through `ccrc test`, the file restored):

| Id | Mutant | Red case |
|---|---|---|
| H1 | the registry stamp on the role's path | the designated session's set stores the role's timer, stamped with the designation's term |
| H2 | the designation read before the gate's await | a designation that moves between the gate and the insert answers timer-unmeasured |
| H3 | `fired` served to a coordinator | a coordinator's list carries no fired |
| H4 | the term filter dropped from the fired read | firedTimersOf, and the Overlord's list |
| H5 | the operator cancels a role timer through another session's page | the operator cancels through the bound session's page only |
| H6 | the token's refusal counted | a tokenless call is never counted |
| H7 | no restore stamp on the hook path | a coordinator's set stamps the restore generation |
| H8 | a failing count changes the answer | a failing count changes nothing |
| H9 | the reserved recipient open at the mail route | the identity word refused as a recipient |
| H10 | the role's path cancels as the session | the Overlord cannot cancel a session's timer |
| L1 | the bound session in `mail.toId` | the row says overlord, the delivery the bound body |
| L2 | the designation read in the gather | a rebind going live during the gather's await |
| L3 | the role fired while the guard is rolled back | the restore (F1) |
| L4 | `incarnationOf('overlord')` asked | the gather asks no incarnation for the role |
| L5 | no restore fact at the fire | the restore (F1) |
| L6 | no refusal purge | the purge removes the old counts |
| L7 | the delivery to the role word | the delivery and the envelope name the bound body |
| L8 | the card keyed by the session id | the bound session's card lists the role's timers |
| L9 | an unmeasured designation read as the session id | the timers fact is unmeasured |
| M1 | the line typed before the card is read | held while the card is none, stale or unmeasured |
| M2 | a held delivery spends an attempt | held: attempts unchanged |
| M3 | the hold reads a stale card as current | held while read-stale |
| M4 | the timer row matched on the sender alone | a session-keyed timer mail keeps the generic nudge |
| V1 | the session claimed before the ack-once and the card hold (F1) | a held timer row followed by a plain mail, and by a second timer row |
| V2 | a fired row with no fire time served at zero (F3) | a fired role timer with no fire time is timer-unmeasured |
| V3 | the hold's reason logged on every sweep (F4) | three holds for one reason log once |
| V4 | the hold's reason never logged (F4) | three holds for one reason log once |
| V5 | the gate's profile port deleted in `server.ts` (F2) | a coordinator and a worker are served at all three doors with the designation unreadable |
| V6 | the doors' restore generation port deleted in `server.ts` (F2) | a set stores the restore generation the server's restore state answers |
| V7 | the lane's authority always coherent in `watch.ts` (F2) | a real watcher fires a planted role timer, not while the guard is not coherent |
| V8 | the lane's authority binding deleted in `watch.ts` (F2) | the same real-watcher case |
| V9 | the lane's restore generation binding deleted in `watch.ts` (F2) | the same real-watcher case (its restore line) |
| V10 | the unmeasured episode line written on every call (F2, the plan's case) | one episode line over the timer calls of one episode |

## What an older build does, measured (Table 11.5, ruled F12)

Kept builds on the fleet box: `v0.0.1428` (the oldest) to `v0.0.1466` (the newest release, which predates this piece). The
server box's kept builds were not read from this session. Method, on fixtures only: this branch's code wrote a fixture
`coord.db` holding one pending timer with setter `overlord` and stamp `7`, and one mail from `timer` to `overlord` with one
delivery queued to a fixture session; that build's own code was then imported from a tree extracted from its tag
(`git archive`) and run on the file: `openCoordDb`, `pendingTimers`, `runTimersLane` (its own `incarnationOf` over a fixture
registry with no row named `overlord`), `dueDeliveries`, `mailOrigin`, `mailNudgeOf` and `MAIL_ROLE_IDS`. The rest was read
from that build's source.

So this reads the fleet box's two kept builds, `v0.0.1428` and `v0.0.1466`, and no server box build. The mail sweep was
not run on either: its replay ceiling, the park and the park's push naming were read from each tag's source (review 3841 A1).

`v0.0.1428` (`1dedc34fc6`):

1. **Queued `overlord` mail.** Selected by the delivery's session (`dueDeliveries` returns delivery 1, `toId` the fixture
   session). It types the generic nudge (`mailNudgeOf` answers `renderMailNudge`'s line). The Overlord cannot run the mail
   client, so nothing acks it: by its source the delivered row replays up to `MAIL_REPLAY_MAX_ATTEMPTS` (20) and is then
   parked read-but-unanswered. `timer` is in `MAIL_ROLE_IDS`, so no sender notice is pushed; the new-mail push is record-only
   for a `timer` mail; the park escalation pushes "blocked" tagged with the delivery's session (the bound body), never with a
   session named `overlord`.
2. **Readers of `mail.toId`.** Its new-mail feed and park lanes read the delivery's `toId` (`mailQueuedSince` selects
   `d.toId`), so `overlord` reaches none of them as a session; the receipts lane (`tmpSweepLane`) reads its own mail only.
3. **Pending `overlord` timers.** Its timers lane cancels the role's pending timer `setter-gone` on its first pass (measured:
   `cancelled: [{ id: 1, reason: 'setter-gone' }]`), final, as question 7 expected.
4. **The new column and table.** It boots on the file ("coord.db is at schema 127, this build knows 122: reading it as-is
   and migrating nothing"), reads the timer through its own column list, and never names `continuity_timer_refusals`.

Nothing loses a timer silently beyond the ruled row, and nothing pushes for a session that does not exist.

(The `v0.0.1428` fixture was written before the merge below, when this piece's migration was 127.)

`v0.0.1466` (`1a0c40e691`), measured after this branch's merge of `main` (this piece's migration is 128 there, after #3345's
127, which that build carries), the same method on a fresh fixture at version 128:

1. **Queued `overlord` mail.** Selected by the delivery's session; the generic nudge; `MAIL_REPLAY_MAX_ATTEMPTS` 20, then a
   park; `timer` in `MAIL_ROLE_IDS`, `overlord` not; the new-mail push record-only for a `timer` mail.
2. **Readers of `mail.toId`.** As above: `mailQueuedSince` selects the delivery's `toId`.
3. **Pending `overlord` timers.** Cancelled `setter-gone` on the first pass (measured).
4. **The new column and table.** It boots ("coord.db is at schema 128, this build knows 127: reading it as-is and migrating
   nothing") and reads the timer through its own column list.

Both builds answer alike; nothing loses a timer silently beyond the ruled row, and nothing pushes for a session that does not
exist.

## What starts acting on a box when this merges, and what stays inert

Measured from the code.

Acting at once, on every box:

- The migration adds a column and a table on boot.
- Every call to the three timer doors runs the gate: it reads the designation (and, only while the designation is
  unreadable, the caller's launch profile). With no designation, every caller is `hook` and served W1a's path unchanged
  (the characterization). While the designation is unreadable, a coordinator and a worker keep their timers; a caller whose
  launch profile reads `overlord` or cannot be read is refused 503 `unavailable`.
- Every set stamps `setRestoreGeneration`.
- Every refusal a timer door answers after its token check is counted in `continuity_timer_refusals`; the timers lane
  purges counts older than `TIMER_KEEP_MS`.
- The timers lane reads the designation, the guard and the restore generation once a pass; session setters are unchanged.
- `POST /api/mail` refuses `toId: 'overlord'` by rule.
- The operator's read carries `owner` on each row and `overlordTimers`; the console marks a role row and says when the
  role's timers could not be read.
- The card's timers key by the session's identity: unchanged for every session but the bound one, and `unmeasured` for every
  session while the designation cannot be read.

Inert until a session is designated: the role's path at the doors, every `overlord` timer and its mail, the `timer` fixed
line and its card hold, and the bound session's role rows on the operator's page. The Overlord's set and cancel are writes,
so they also wait on door process B's witness (502 `unmeasured` until the fleet box advertises `door-witness-v1`); its list
works once designated.

## Fix round 1: what the pull request's fast run caught

The first CI on the pushed tip (42fd79d85b) failed five checks in four server shards. Each came from this change and each
was a file the local runs had not included:

- The run/session census counted `termOf`'s designation comparison in `continuity/routes.ts` as a binding decided by
  hand. It reads the designation row's own columns and no run, so it is named in `NOT_BINDING_SITES` with that reason,
  as the envelope's designation comparison already is.
- Two migration tests from main still held 127 as the last entry: the programme lifecycle's (now 127 followed by this
  change's 128) and the limit samples' replay (now undoing 128 as well, from `COORD_SCHEMA_VERSION - 3`).
- The mail prompt forms fixture lacked the timer line, a new row of the fixed-line table. It now carries the line with
  and without a count, rendered by `renderTimerFiredLine`, and the console's mail-rows suite reads both.
- `mailPass` grew to 151 code lines against its cap of 150. The card hold now shares the fixed-line `if` with the
  ack-once check, in the same order, so the cap holds. A hand mutant that deletes the hold turns six cases of the lane
  suite red.

The full run dispatched on that tip ran no tests: its test selection failed to download an artifact (HTTP 503, egress
over the account limit), so `test (server)` reported failure.

## Review 3841: what changed

- **F1, a held line claims nothing.** For one due delivery, the mail pass's order is now:
  1. every gate, in its old order;
  2. the nudge;
  3. the ack-once of a fixed line already delivered, or the card hold (neither types anything);
  4. the session's claim for this sweep;
  5. the send.

  So a held timer row, or a fixed line acked without typing, claims nothing. A plain mail behind it is delivered in the same
  sweep. A second timer row behind a held one holds for the same card. Once the card reads, the first is typed and claims the
  session, and the second waits one sweep as `same-sweep`, as any second mail to one session does. The order of every other
  check is unchanged, and `mailPass` stays at its cap. The ack-once now claims nothing either: it types nothing, so the
  comment over the claim, "one message per session per sweep", is true of both.
- **Nothing times a held line out.** A held timer row stays queued, with no attempt spent and no park, for as long as its
  card does not read current. It is freed when the live Overlord generation of the session it is queued to reads the
  current card. If that session stops being the designated one, the row no longer matches the designated-only timer row,
  so it takes the generic nudge and is not held. No timeout, retry count or park frees it. While it holds, other mail to that
  session is not held behind it (F1).
- **F2.** Four new cases, each red when its binding is deleted (V5 to V10 above):
  - the gate's launch-profile port and the doors' restore generation port, through the real server;
  - the lane's guard and restore bindings, through a real watcher;
  - the plan's one-episode-line case.
- **F3.** The Overlord's list answers `timer-unmeasured` for a fired row whose fire time is null.
- **F4.** One case counts the card hold's log lines: once per change of reason, again after a delivery.
- **F5, A1 and A2** are the departure `refusal-counts-without-rowid`, the sentence under the older-build measurement, and the
  sentence under the floors table.

## Known limits

- `firedTimersOf` carries no row cap: it is bounded by the term and the window, and the purge at 90 days.
- The card's timers fact reads `unmeasured` for every session while the designation is unreadable (above).
- The episode line names the other lanes' keys (above).
- An older build cancels the role's pending timers `setter-gone` (ruled F11), and its park push names the bound body.
- The whole test-tree type check is killed by the test slice's memory cap on this box; a narrow config over every touched
  test file was run instead, with the server's and the console's own type checks.
- `mutation-floors.test.ts` on the test box reds `pwa/src/face/mood.ts`'s two keys because that checkout lacks the design
  system's modules; the same on the base, not this change.

## Index and spec changes for the coordinator

As the plan's "Index changes" and "Spec fixes" sections list, with the departures above added.
