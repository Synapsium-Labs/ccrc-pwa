# Overlord W1a, timers: departures from the plan

Each departure from `w1a-timers.md` is named by a slug. No D-number is taken here: the coordinator folds these into the
programme's ledger. The plan's own decisions (its "Deviations found" list) stand unless a slug below changes one. This
note starts with PR A (Tasks 1 to 3); PRs B to E add their sections below.

## Spec departures, for the spec's next correction

Both come from the plan's "Deviations found" and are recorded here as the plan asks.

- **stall-notice-names-no-note** — C65 says a stall notice after the hold names the timer, its due time "and the first
  words of its note". The notice names the id and the due time only, because stall notices go out as `operator` and C63
  (H7) and the stall text rule keep a session's words out of that envelope (the coordinator's ruling on review 2030 F3).
  Built in PR C (Task 9).
- **timer-gate-fails-open-like-every-gate** — Table 11.1d and C65 say `ccrc-api` answers `capability-missing` without
  `timers-v1`. It does so on a current cap file only, and sends the request on an absent, stale or torn one, as every
  gate in the client does (the coordinator's ruling on review 2030 m3). Built in PR D (Task 11).

## The open questions' defaults

The four defaults the coordinator kept on review 2030: **reclaim-reads-gone**, **no-restore-generation-reader**,
**m36-refusals-unrecorded** and **incarnation-reason-is-a-string**. PR A builds the deciders the first and last rest on:
`timerCleanupVerdict` takes the incarnation as `measured`, `absent` or `unmeasured`, and only `absent` can cancel; the
literal `'absent'` comparison is the lane's input builder's (PR C).

## PR A: the vocabulary, the deciders, the table (Tasks 1 to 3)

### The vocabulary (Task 1)

- **timer-actor-list** — `TimerActor` gets a sibling `Record<TimerActor, true>` map and the derived `TIMER_ACTORS`. The
  wire-totality scan (`server/test/rings/wire-totality.test.ts`) refuses an exported literal union in `shared/` without
  one, and the vocabulary test walks every actor with it.
- **timer-refusals-are-a-status-record** — `TIMER_REFUSALS` is declared as the ten words with their statuses in one
  record, spread into `REFUSAL_STATUS` (`LEASE_DOOR_REFUSALS`' idiom), so each word and its status are written once.
- **undecided-role-gets-the-least-cap** (the plan's) — the column holds the seven roles' caps; the `undecided` reading's
  5 is the set door's to apply (PR B), as the plan says.

### The deciders (Task 2)

- **cleanup-run-and-programme-first** — the order is the plan's: a closed run or an ended programme cancels before the
  `listedAt` rung, so a timer whose run closed is cancelled even when it was set after the tick's listing began. The case
  is pinned, with a mutant (K14) that moves the listing rung first.
- **archived-reads-alone** — `setter-archived` reads the listing's `archived` alone (the brief: `archivedAt !== null`),
  not `listed && archived`: the lane only finds an archive stamp on a row the listing built.
- **preview-ellipsis-inside-the-sixty** — `timerPreview`'s "at most 60 code points" counts the ellipsis: a cut keeps at
  most 59 code points and adds `…`. A head that ends inside a word backs off to the last space before it that has words
  before it; a head with no such space (one long word, or a leading space and then one long word: review 2038 F2) is
  hard-cut at 59, and trailing space is trimmed, so a note with words never previews as the ellipsis alone. A note of 60 or fewer is itself, uncut.
  It does not fold line breaks: the card's one-line rule (`card.ts#oneLine`, PR D) applies where the line is drawn.
- **timer-mail-lines** — the plan names what each timer's lines say; the words are: `Timer <id>: due <UTC>, fired <n>
  min late.` (whole minutes from `dueAt` to now, floored, never below 0), then `Credited to <setById> at <UTC>; run <n>.`
  (or `programme <slug>.`, or `no run or programme.`), then the untrusted block. Stamps are `card.ts#iso`, the card's own
  absolute UTC, so the two read alike. Timers are separated by a blank line. The subject joins its ids with `, ` and, when
  they do not all fit in 200 bytes, ends `, …)` after the ids that do.
- **one-mail-per-group-a-pass** — `packTimerMail` stops a group at the first timer that would not fit (oldest first), and
  the rest of that group waits for the next pass, as the plan says. Groups are ordered by their oldest due timer.

### The table and its writers (Task 3)

- **fire-is-a-savepoint** — `markTimersFired` undoes its own writes through a savepoint before it throws, so it is all or
  nothing on its own as well as inside the lane's `tx`, which then rolls the mail back with it.
- **sets-since-throws** — `setsSince` answers a number, and a failed read throws rather than answering 0; the set door
  maps the throw to `timer-unmeasured` (PR B), so a box fault never reads as "no sets this hour".
- **timer-row-role-is-a-string** — a row's `role` reads back as the stored word, not narrowed to `FleetRole`: a newer
  build may store a role this one does not know, and nothing in W1a decides on a stored role.
- **store-delegates-through-a-namespace** — `store.ts` imports the timer functions as one namespace
  (`import * as timers from '../continuity/continuityStore.js'`) rather than widening the shared named import that the
  generations and card delegates use, which other W1a pieces edit at the same time.
- **migration-slot-measured** — migration 70, measured on `origin/main` at `9e55a891a` (69 entries). The notes piece
  (#2796) and launch profiles PR B (#2794) each add a migration too; whichever lands later merges `main` once, takes the
  next slot and re-counts (`coord-db.test.ts`'s pins and `run-close-switch.test.ts`'s rollback list).

### Fix round 1 (review 2038, the coordinator's rulings)

- **too-late-past-the-bound** (F3, ruled: the spec over the plan) — any number past `TIMER_DUE_MAX_MS`, an unsafe
  positive integer and `+Infinity` included, answers `timer-too-late` (Table 11.6, C65). Everything else that is not a
  safe integer of at least five minutes answers `timer-too-soon`: under five minutes, zero, a negative, `-Infinity`,
  `NaN`, a fraction, or a value that is not a number. The plan's sentence ("`timer-too-soon` (not a safe integer, or
  under five minutes)") read the first group as too soon. PR B's door tests pin both groups through the door.
- **preview-backs-off-only-to-words** (F2) — the correction to preview-ellipsis-inside-the-sixty above, with its case
  and mutant.
- **bound-key-that-does-not-read-fails** (F5) — a stored `runId` that is neither null nor a number fails the whole read,
  as every other bad column does, rather than reading as an unbound timer. The same rule holds for `programme` (neither
  null nor text), which folded the same way; under the column's TEXT affinity only a blob reaches it.
- **pack-order-pinned** (F1) — no behaviour change: two cases and two mutants pin that a timer that does not fit stops
  its group (a smaller, later timer never rides ahead of it) and that timers due at the same instant go in id order.
- **carried to PR B** (F4, F6) — the set door pins the bounds on the credited id and the programme, a throwing
  `setsSince` answers `timer-unmeasured` (503), and `write-failed` answers 503. Nothing changes in PR A.

## Growth (PR A)

Measured against the merge base before the push; see the PR body for the figures.

## PR C: the timer sender, the lane, the stall hold (Tasks 7 to 9)

### The timer sender (Task 7)

- **role-readers-measured** (Step 2) — the readers of a role sender, measured at the merge base: `FleetWatcher.mailSender`
  (`watch.ts`: the park notice and the sender push), `CoordStore.runLastMoves` (`store.ts`: `MAIL_ROLE_IDS` in its
  `NOT IN`), `REVIVE_SKIPPED_SENDERS` (`mailRevive.ts`, typed by `SystemMailSender`) and `insertSystemMailTx` /
  `queueSystemMail` (`rundefsTx.ts`, typed by it). `shared/api.ts#ASK_OPERATOR_PRINCIPAL` deliberately does not derive from
  the map, and nothing in `pwa/src` reads it. `POST /api/mail` refuses `fromId: 'timer'` as `unknown-sender` (no registry
  row), pinned before and after the row.
- **role-sender-cases-in-one-file** — the characterization (green on `main`, its own commit) and the flipped pins live in
  the new `mail-role-senders.test.ts`, the revive's two cases included, rather than split into `mail-revive.test.ts`, so
  the one file holds what every reader does with the role. `run-last-move.test.ts`'s role-list pin gains `timer`.
- **escalation-push-names-the-recipient** — a parked timer mail mails no park notice and pushes nothing tagged `timer`;
  the park's one operator escalation (`escalatePark`) still pushes, tagged with the recipient, as it does for every role.

### The lane (Task 8)

- **run-and-programme-read-in-the-pass** — the bound run's state and the programme's `planEnd` are read synchronously in
  the pass, right before the cleanup decides, rather than in the async gather; the gather keeps the pending read and the
  stamps. Each run is read once a pass.
- **run-row-absent-waits** — a bound run whose row does not read (a failed read, or no row) is `unmeasured`, so its timer
  waits; runs are never deleted, so no row is a fault, never a close.
- **programme-row-absent-reads-ended** — `programmeLive` answers false for a programme with no row as for one whose
  `planEnd` is set, so such a timer is cancelled `programme-ended`. The set door refuses a programme that is not live
  (bound-key-must-be-live), so no timer binds a programme with no row; a read that throws waits.
- **due-is-the-passs-clock** — `dueAt <= now` is the pass's own selection of the `keep` timers to pack, with `now` from
  `Clock.wall()` after the gather.
- **sim-lends-mail-clock** — the store's mail insert stamps `at` from the ambient clock (`insertMail`), which the lane does
  not own and the simulator stubs to a thrower, so `timerDay.ts` lends the pass the server's wall clock for its length.
- **sim-crash-is-a-write-that-aborts** — a crash inside a pass is a trigger that aborts every write to `mail` and
  `continuity_timers` past a drawn count (`generationDay.ts`'s shape); the scenario then crashes the server. 32 seeds in CI.
- **watcher-level-cases** — `continuity-timer-lane.test.ts` also drives `FleetWatcher.sweepTimers`, so the "read the
  listing from `records`" mutant (Step 6) is caught where it would be written.

### The stall hold (Task 9)

- **hold-answers-its-timer** — `timerHoldUntil` answers `{ id, dueAt, until }` or null, not the time alone, so the verdict
  and the three notices read the one pick. `stallTimerHold` times it against the ladder that decides r1
  (`stallR1QuietFrom`, and the marker ladder's back-off or the resolved quiet time).
- **hold-gates-r1** — the hold answers at step 10's quiet rung when r1 is due, in both ladders. A held r1 sends nothing,
  so r2 and r3, which follow r1, do not come either; once r1 is sent, the hold plays no part.
- **pending-holds-until-it-fires** — a pending timer holds while it waits: until its `dueAt` plus one quiet period while
  it is not yet due, and to the cap once overdue (the lane is held or a pass behind). Fired, it holds until `firedAt` plus
  one quiet period.
- **stall-timers-laundered** — `stallTimersOf` maps the store's hold read to `StallTimers` with the ids and times only, so
  a note never enters `stall.ts`; a failed read, or a fired row with no fire time, is `unmeasured`.
  `stallTimerFiredSince` spells the read's `now - TIMER_HOLD_CAP_MS` beside the cap.
- **timer-hold-floor** — `timerHoldUntil`'s cases are written once in `sim/timerSets.ts` (seven mutants, floor 1) and run
  on the real module by `stall-timer-hold.test.ts`. The lane-level cases are in `stall-sweep.test.ts`: the real lane pass
  fires the timer and the real `sweepStalls` holds its check.

### Rollback (measured before merge)

- **no-rollback-wait, measured** — at `v0.0.1164`, the oldest version kept on the fleet box, `mailSender` reads a role
  only for `coordinator` (so `timer` is read as a session id: one park notice and a push for it, as Task 7's
  characterization pins), and `dueDeliveries` selects queued deliveries by state with no sender filter, so a queued timer
  mail is delivered by the older lane.

## Growth (PR C)

Measured against the merge base before the push: `server/src/watch.ts` +16, `server/src/coord/store.ts` 0.
