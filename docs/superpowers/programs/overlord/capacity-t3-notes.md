# Capacity, Task 3: notes (Overlord wave 188, run 2841)

This pull request adopts draft #3074, "a run holds a slot only while its worker works" (spec
`docs/superpowers/specs/2026-11-19-waiting-workers-sleep-design.md` Part 3, plan
`docs/superpowers/plans/2026-11-19-waiting-workers-sleep.md` Task 3). The draft's characterization commit comes over
unchanged. The rest was rebuilt on today's `main`, reshaped by the design review's binding rulings (F1, F3, F4, F6,
F16), and treated as unreviewed work. Numbers: D-8792 (cap-counts-working) and D-8793 (cap-governs-starts), as issued
to run 2838 and defined in the plan's "Deviations found".

## What changed against the draft

- **shadow-switch.** The draft changed the cap at merge. Here a new Shadow lanes row, `cap-counts-working`
  (`shared/lane-arm.ts`, seeded `shadow` by migration 110), is the only switch (`dispatch.ts#capCountsWorkingArmed`).
  In shadow the count, every refusal, the resume check and the send-back check are exactly today's. Only while the row
  is armed does the cap leave waiting runs out, hand out freed slots, skip the check for a live resume (D-6093), and
  admit a send-back to a sleeper. The row gets the same census and single-definition coverage as the other rows: the
  lane list, the GET pin, the gate list, the non-W1a arm case, the migration census and the card test.
- **shadow-record.** In shadow, a dispatch or a send-back the cap refuses that arming would have let through writes
  one server-journal line, `ccrc-server: cap-counts-working shadow: …`. It names the start and each counted run arming
  would leave out, with its reading (`dispatchDecide.ts#capShadowLine`), or, for a send-back arming would admit as a
  free resume, the worker's state (`dispatchDecide.ts#capShadowResumeLine`; review 2875 F7). The line is written AFTER
  the refusal has been returned, outside the coordination serialiser (`deferShadowRecord`, see
  **shadow-off-the-path**). That line is OA-F3's evidence, together with the caps view's `waiting` count. The row's
  card words name the prefix.
- **waiting-needs-a-stamp.** As F4 requires: an awake worker is `waiting` only with an idle verdict, no marker or row
  background work, no subagents, no session cron, and at least one readable stamp among `turnAt`, `stopAt` and
  `restartAt`, quiet for `STOP_DONE_PARKED_IDLE_MS`. A marker with no stamps is `unmeasured` and counts. So does every
  reading that cannot be made, a port that throws or answers past the deadline included. Each has its own red case.
  Two readings follow `decideSleep` instead of failing closed (review 2875 F4, see **same-reading-as-decideSleep**).
- **one-port.** The draft carried two ports, `paneLive` (for D-6093's live resume) and `workerFacts`. Here
  `workerFactsFor` (L3, `turnverdict.ts`) answers `gone` with a reason (`absent`, `stopped`, `archived`, `asleep`,
  `no-pane`), and one L1 rule, `resumeSkipsCap(facts, door)`, decides both the live resume and the send-back resume, so
  `sessionReadsLive` and `paneLive` are gone. `workerFactsFor` checks archived, then asleep, then stopped, because a
  sleeper also carries a stop stamp.
- **send-back-resume.** F6: armed, `advance -> working` for a run whose worker is awake or asleep is never refused at
  the cap, even with no slot free. Unarmed, today's check stands. Both are pinned by unit and route tests.
- **closing-not-a-send-back.** The plan and F6 name three source states: `awaiting-review`, `merging` and `closing`.
  `RUN_TRANSITIONS` has no `closing -> working` edge, so the gate refuses that send-back as a bad transition before it
  ever asks the cap. "Never refused at the cap" holds for `closing` because the cap is never reached. The test pins it
  rather than inventing an edge.
- **advance-untouched.** `server/src/coord/advance.ts` is held by run 1850, and this change does not need it. The
  send-back check is `dispatch.ts#sendBackCapCheck`, which returns the `overConcurrency` thunk the gate already asks.
  Its edge test, `dispatchDecide.ts#sendBackCharged`, is held equal to the gate's own cap edge, state by state, in
  `caps-counts-working.test.ts`, so the two cannot drift.
- **counted-rows-one-statement.** F16: the counted-row predicate is one statement, `store.capsCountedRuns`, and
  `capsUsage` is its length. The cap reader takes its waiting subset over those same rows. The draft's
  `activeRunWorkers` with a shared SQL fragment is gone. `routes.ts` still calls `.capsUsage(` once, in `capsView`.
- **routes-packet.** `server/src/coord/routes.ts` is held by run 1850. Under item 486 its holder consented (mail 27140)
  to one packet of nine hunks against `main` at `963286cc98`. For fix round 1 (review 2875 F1) the holder consented
  (mail 27463) to one revised packet in its place: ten hunks against `main` at `31671ca230` (routes.ts is the same blob
  there), 31 lines added and 4 removed, sha256 `26977b5b…e90693`. It is applied here byte for byte: two new import
  lines, `capPorts`, the dispatch deps spread, the send-back check before the gate, and `capsViewMeasured` beside
  `capsView`, which now takes an optional view and sends no `waiting` without a worker port. The POST caps line under
  the lock is main's own again, and the readings follow the lock. Four existing lines are rewritten: the gate's
  `overConcurrency:` and the three caps replies, each a call site that has to go through the new reader. The
  caps-route shape pin follows both links and holds the POST's readings outside the lock. Run 2842 (Task 4) has its own
  consented hunk under the same gate line, and whichever lands second rebuilds.
- **caps-view-mode.** The caps view sends `usage.workingOnly` beside `usage.waiting` (both additive), so the console
  can say the right thing in each mode: armed, "3 / 4 working, 2 waiting"; shadow, "5 / 4, 2 of them waiting", the
  count the cap still uses. With an older server it says today's "5 / 4". The draft's single wording would have shown a
  count in shadow that the cap does not use.
- **migration-slot.** The seed takes slot 110, the next free one on `main` today. Capacity Task 2, approvals PR 3 and
  door B1 build on the same slot, so whoever lands second moves up. The entry says how to re-measure.
- **seed-or-ignore.** The seed is `INSERT OR IGNORE`. The first full run on the PR found that
  `decision-model-records.test.ts` rolls a database back one version by dropping later tables. It cannot drop a row
  from an older table, so a plain insert met the row on replay and refused. A file that already holds the row now
  keeps it, which a `coord-db` case pins.
- **advance-door-word.** `resumeSkipsCap`'s send-back door is named `'advance'`, the route it rides. `mail-routes`'
  census reads a quoted kebab word under `server/src/coord` as a code, and this one is a parameter.
- **shadow-off-the-path.** Review 2875 F1, the coordinator's ruling: fix before merge. In shadow the worker readings
  only feed the journal line, so the dispatch door refuses exactly as on main, with no worker read on its path, and the
  readings and the line follow through `deferShadowRecord` (`setImmediate` by default; the tests hold the work and run
  it after the refusal). Armed, the readings decide, so they stay, bounded. Measured at the cap with 10 counted runs
  and a 300 ms worker port, 15 refusals each (median): main 0.6 ms; the reviewed tip `9c8abde7` 302 ms in shadow and
  304 ms armed; this tip 0.8 ms in shadow and 301 ms armed (one bounded read round).
- **read-deadline.** `turnverdict.ts#WORKER_READINGS_DEADLINE_MS`, 5 s, bounds each worker read the cap waits for, as
  a timer local to `workerFactsFor` (the port, L3). A read past it is `unmeasured`, so its run counts: a slow fleet
  costs the armed rule its freed slots, never a wrong admit. The coordinator asked for one overall deadline on
  `workerReadings`. That function reads every worker in parallel, so the per-read bound is its overall bound. The timer
  sits in the adapter because a deadline timer makes a file L3 (the rings rule), and `dispatch.ts` is imported by L1
  files (`abandonDeadDispatch.ts`), so a timer there would point an edge outward. It needs no `routes.ts` change. The
  bound comes from a measurement. One awake worker's read is about 25 agent and tmux operations in sequence, and twelve
  round trips from the fleet box to the server at load 10 to 15 took a median of about 140 ms, so about 3.5 s a read
  at the median. The tail is cut.
- **send-back-plan.** Review 2875 F3: `dispatchDecide.ts#sendBackCapPlan` (L1) answers `today`, `free` or `recount` from
  measured facts (armed, port, cap full, the edge, the worker's facts or null), with the free-resume rule inside it.
  `sendBackCapCheck` (L4) reads, asks it, and acts. It reads the worker only when the plan without it is not `today`.
  A freed slot is pending as data (`freedSlotPending`), L4 asks the watcher's window, which records into it, and the
  pure `capRefusalOf` takes the answer. `decideAdmit` takes `freedSlotAdmitted`, never the port, so no write is reached
  from L1. `advance.ts` is untouched.
- **stamp-checks-the-pane.** Review 2875 F5: an asleep or stopped stamp is checked against `sessionVerdict` once. A
  failed kill can leave a live pane under the stamp. `gone` needs the pane proved gone. A live pane is read like any
  awake worker. A pane tmux could not answer for is `unmeasured`.
- **same-reading-as-decideSleep.** Review 2875 F4, a stated departure from "every reading that cannot be made keeps the
  run counted". Two readings are the sleep lane's own (`sleep.ts`), not fail-closed. A frame row whose `subagents` is
  null ("no fresh hook data") reads as no subagents. `workerReadingOf` does not require the marker's `state === 'done'`.
  The live `idle` verdict, `bg` and `crons` at exactly 0, and 30 minutes since the newest stamp cover both. A worker
  would need 30 minutes with no hook event, no busy word and no `bg` while a subagent runs. The miss direction is a
  truly idle worker.
- **no-port-no-guess.** Review 2875 F9: with no worker port `workerReadings` answers null, never an empty map, and the
  caps view sends no `waiting` (the console then says today's "N / cap").
- **test-db-template.** `caps-counts-working.test.ts` copies one migrated database per case instead of replaying 110
  migrations each time, which timed out a six-fixture case on a loaded box.

## Checked and left as written

- `ACTIVE_RUN_STATES`, `run-states.test.ts` and `FLEET_PROTO` are untouched: no new run state and no new wire version.
  No `ccd` verb is added.
- The cap's value and who sets it are unchanged: only what counts changes, and only when armed.
- The freed-slot window is the watcher's own list (`FleetWatcher.admitFreedSlot`), never the shared wake list, so a
  mail wake is never pushed back by it, as D-8793 requires.

## Carries from review 2875 (not done here)

- **F6.** `sendBackCharged` restates the advance gate's cap row. Drift is never unsafe, and the test holds them equal
  state by state. Once `advance.ts` is free, the gate's cap row should call `sendBackCharged`.
- **F8.** Armed, a refusal because the freed-slot window is spent carries the raw count (for example 5/4), while the
  console reads "3 / 4 working, 2 waiting". A coordinator cannot tell pacing from full. A distinct word or field is a
  follow-up.
- **F11.** The plan and the spec still list `closing` as a send-back source state. A wording follow-up should make them
  match `RUN_TRANSITIONS` (see **closing-not-a-send-back**).
- **F12.** `capsMeasured` is now read before the pause and mail-disabled check on the send-back door, and on every
  advance edge. These are pure reads that fail toward refusal. Only a store that throws would surface ahead of the
  `paused` or `run-unreadable` answer.

## Arming evidence (after merge, not a gate)

Part 3 stays in shadow. The item asking the operator to arm it carries OA-F2 (from Part 2's shadow, after Part 2 is
armed) and OA-F3: the caps view's `waiting` count and the `cap-counts-working shadow:` journal lines, with each run's
reading.
