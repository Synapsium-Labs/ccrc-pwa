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
- **shadow-record.** In shadow, a dispatch the cap refuses that arming would have let through writes one server-journal
  line, `ccrc-server: cap-counts-working shadow: …`, naming the run and each counted run arming would leave out, with
  its reading (`dispatchDecide.ts#capShadowLine`). That line is OA-F3's evidence, together with the caps view's
  `waiting` count. The row's card words name the prefix.
- **waiting-needs-a-stamp.** As F4 requires: an awake worker is `waiting` only with an idle verdict, no marker or row
  background work, no subagents, no session cron, and at least one readable stamp among `turnAt`, `stopAt` and
  `restartAt`, quiet for `STOP_DONE_PARKED_IDLE_MS`. A marker with no stamps is `unmeasured` and counts. So does every
  reading that cannot be made, a port that throws included. Each has its own red case.
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
  to one packet of nine hunks against `main` at `963286cc98`, applied here byte for byte: two new import lines,
  `capPorts`, the dispatch deps spread, the send-back check before the gate, and `capsViewMeasured` beside `capsView`.
  Four existing lines are rewritten: the gate's `overConcurrency:` and the three `capsView(` callers. Each is a call
  site that has to go through the new reader. The caps-route shape pin now follows both links. Run 2842 (Task 4) has
  its own consented hunk under the same gate line, and whichever lands second rebuilds.
- **caps-view-mode.** The caps view sends `usage.workingOnly` beside `usage.waiting` (both additive), so the console
  can say the right thing in each mode: armed, "3 / 4 working, 2 waiting"; shadow, "5 / 4, 2 of them waiting", the
  count the cap still uses. With an older server it says today's "5 / 4". The draft's single wording would have shown a
  count in shadow that the cap does not use.
- **migration-slot.** The seed takes slot 110, the next free one on `main` today. Capacity Task 2, approvals PR 3 and
  door B1 build on the same slot, so whoever lands second moves up. The entry says how to re-measure.
- **test-db-template.** `caps-counts-working.test.ts` copies one migrated database per case instead of replaying 110
  migrations each time, which timed out a six-fixture case on a loaded box.

## Checked and left as written

- `ACTIVE_RUN_STATES`, `run-states.test.ts` and `FLEET_PROTO` are untouched: no new run state and no new wire version.
  No `ccd` verb is added.
- The cap's value and who sets it are unchanged: only what counts changes, and only when armed.
- The freed-slot window is the watcher's own list (`FleetWatcher.admitFreedSlot`), never the shared wake list, so a
  mail wake is never pushed back by it, as D-8793 requires.

## Arming evidence (after merge, not a gate)

Part 3 stays in shadow. The item asking the operator to arm it carries OA-F2 (from Part 2's shadow, after Part 2 is
armed) and OA-F3: the caps view's `waiting` count and the `cap-counts-working shadow:` journal lines, with each run's
reading.
