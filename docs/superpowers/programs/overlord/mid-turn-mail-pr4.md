# Overlord wave 183, mid-turn mail PR 4: notes for the ledger

This note records what PR 4 of the mid-turn mail plan (`docs/superpowers/plans/2026-11-19-mid-turn-mail.md`, Tasks 4.1 to
4.3) built and measured, and where it departs from the plan, by slug. The coordinator folds it into the programme ledger
and mints any numbers. No D-number is defined here.

## In short

- **Built:** the one `routeSet` answer helper (`server/src/routeSetOutcome.ts`, L1, in C2's row of the ring and context
  table), with the generations and launch-profile lanes moved onto it behind characterization tests; the projection's
  decider (`server/src/coord/mailHoldPolicy.ts#decideMailHold`, L1); the pass (`server/src/coord/mailHoldLane.ts`), its
  `mailHold` lane row, the watcher's sweep and the store port's `urgentHolds` member; and the capability constant
  `MAILHOLD_ROUTE_CAP` (`route-mailhold-v1`).
- **The coordinator's binding ruling on PR 3's review (F2) is in this PR:** a mailhold renewal leaves no journal row and no
  swap.log line. It is a two-line change in ccd's `cmd_route` (slug `renewal-record-skip-in-ccd`).
- **Not in this PR: Task 4.4, the ack's kick** (slug `ack-kick-waits-for-routes`). Until PR 4b lands, a hold the ack
  releases leaves its marker standing until the projection's next pass, at most one `MAIL_SWEEP_MS` (10 s) later, plus
  the pass's own time. While the hook's arms are shadow that costs nothing; once A is armed, a session that has just
  acked its urgent mail can be refused a gated act for up to that long.
- **Growth,** by the growth check's own counter against the merge base `f4c786986`: `server/src/watch.ts` +11 (the plan
  estimated +16), `server/src/laneSchedule.ts` +5, `server/src/ccdargv.ts` +1, `ccd/ccd` +1 (the `ccd (program)` row +1),
  `server/src/coord/ports.ts` 0 (one word added to an existing line), `server/src/continuity/profileLane.ts` 0 and
  `server/src/continuity/renewalWiring.ts` -1. New files, in no growth row: `routeSetOutcome.ts` 10 code lines,
  `coord/mailHoldPolicy.ts` 36, `coord/mailHoldLane.ts` 95. `growth-check` passes armed, with no waiver. `routes.ts` and
  `server.ts` are untouched (their growth belonged to Task 4.4).
- **The lane schedule's monotonic count** is 54: this PR's row and D-8126 A7's (#3079, merged first) both joined it, and
  this branch absorbed `main` once (the conflict probe answered a conflict on that one count line, an additive conflict).
  D-8126 A6 (#3080) adds a row too, so whichever of us lands second sets the count again.
- **The marker is written live from the first deploy,** as the plan says (P10): nothing reads it until the hook's arms
  are armed, and a server talking to a fleet box whose ccd does not advertise `route-mailhold-v1` sends nothing.

## 1. What runs where

| Piece | Where | What it does |
|---|---|---|
| The answer helper | `server/src/routeSetOutcome.ts#routeSetOutcome` | maps one `ccd route` answer to `written`, `unreachable` or `refused` with the first stderr line |
| The decider | `server/src/coord/mailHoldPolicy.ts#decideMailHold` | write (appear, differ, renew), clear (released, mail-off), nothing, or skip (incapable, unreadable, unrenderable) |
| The pass | `server/src/coord/mailHoldLane.ts#mailHoldPass` | one `urgentHolds` read a pass (none under `mail-disabled`), the decider per listed session, one `routeSet` argv per session to write |
| The lane row | `server/src/laneSchedule.ts` (`mailHold`) | `MAIL_SWEEP_MS` by `derivedFrom`, flight `skip`, clock `mono`, `staleAfterMs` 60 s, after the `mail` row |
| The sweep | `server/src/watch.ts#sweepMailHold` | dispatched beside `sweepMail` in `tick()`, never awaited, on the tick's listing, whether or not `mail-disabled` stands |
| The renewal record | `ccd/ccd#cmd_route` | a `mailhold` write whose pairs equal the standing marker's prints its `set` line and records nothing |

*Table 1. PR 4's pieces.*

## 2. Mutations

Each mutation was an in-place edit with a sha-checked restore from a saved copy, or a `runMutants` set for the L1
decider (ruling N1). Every mutant went red.

| Guard | Mutation | Red case |
|---|---|---|
| The ring and context row | drop `routeSetOutcome.ts` from C2's row | `rings/totality`: no row reaches it |
| The decider | 14 textual mutants (`server/test/sim/mailHoldPolicySets.ts`), among them the plan's three: drop the renewal rule, drop the forged-marker clear, write under `mailDisabled` | each mutant's own case; score 1 |
| The renewal record skip (F2) | delete the line; compare whole values; compare the `until` parts; skip the `set` line; skip for every field | `ccd-route-mailhold`: the ten-renewals case, the changed-set case, the other-field case |

| The pass reads the store | the pass reads no hold (`new Map()`), standing for the mail lane's due list, which the lane's port does not reach | `mail-hold-lane`: the not-due renewal case and six more |
| The row's flight | `none` | `lane-schedule`: the row pin |
| The sweep runs under `mail-disabled` | the sweep returns when the switch stands | `mail-hold-lane`: the end-to-end case |
| The sweep is its own dispatch | called from inside `mailPass`, after its first act | `mail-hold-lane`: the end-to-end case |
| The switch reaches the pass | the sweep passes `false` | `mail-hold-lane`: the end-to-end case |
| The capability gate | drop `route-mailhold-v1`; drop the `route` verb | `mail-hold-lane`: the one-argv case, each |
| A failure once an episode | log every pass; a success never ends the episode | `mail-hold-lane`: the failed-write case, each |
| The wall clock | `Date.now()` for the clock handed in | `mail-hold-lane`: the wall-clock case and three more |
| The id refusal | dropped | `mail-hold-lane`: the unreadable-and-refused case |
| An unreadable marker | read as absent | `mail-hold-lane`: the unreadable-and-refused case |
| Unlisted holds counted | dropped | `mail-hold-lane`: the unlisted case |
| No store read under `mail-disabled` | read it | `mail-hold-lane`: the mail-disabled case |
| A clear is the empty value | write `x` | `mail-hold-lane`: three clear cases |
| A store read that throws | log every pass; the episode never ends; let the throw escape | `mail-hold-lane`: the store-throw case, each |

*Table 2. The mutants: 14 in the decider's set, 5 in ccd, 18 in the pass and the watcher, and the ring row. All red.*

## 3. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `ack-kick-waits-for-routes` | Task 4.4 (the ack kicks the projection) needs `server/src/coord/routes.ts`, which another programme's frozen run holds. By the coordinator's brief it waits as PR 4b, beside PR 2b and PR 3b. Until then a released hold's marker stands until the next pass (at most `MAIL_SWEEP_MS`, 10 s, plus the pass). Nothing else in Tasks 4.1 to 4.3 needed `routes.ts`. | plan Task 4.4 |
| `renewal-record-skip-in-ccd` | The coordinator's binding ruling on PR 3's review (F2): a renewal adds no journal line and no swap.log line. The journal and swap.log lines are `cmd_route`'s, so the change is in ccd, a file the plan's Table 5 does not list for PR 4: one line in `cmd_route`'s write loop, after the write, that prints the `set` line and skips both records when the field is `mailhold`, the new value is not empty, and its pairs (the text after the first `:`) equal the standing marker's as `_route_get` read it. A malformed standing value reads as `<n bytes, unrecognised>`, which holds no `:`, so a write over it is recorded. The file is written either way. | `ccd/ccd#cmd_route`, `server/test/ccd-route-mailhold.test.ts` |
| `route-helper-takes-a-shape` | The plan has the helper take "the `runCcd` result". It takes a structural `{ ran, ok, stderr }` (`RouteSetAnswer`), which `CcdResult` satisfies, so the L1 file imports nothing and no L1 file reaches up to the L2 port for a type. | `server/src/routeSetOutcome.ts` |
| `characterization-in-one-file` | The characterization cases and the helper's own cases share `route-set-outcome.test.ts`. The characterization commit came first and was green on `main`'s code; the helper's cases joined in the helper's commit; the move commit changed no test line at all. The launch-profile lane's three outcomes were already pinned in `continuity-profile-lane.test.ts`; the generations lane's PreCompact answers are seen through `retract`, which warns on every answer but `written`. | `server/test/route-set-outcome.test.ts` |
| `decider-skips-unrenderable` | An addition to Task 4.2's list: a held pair the grammar cannot spell (a role outside the two words, a delivery id outside its digits) is a third skip, `unrenderable`, never a throw. The store's CHECK on `mail.urgentAs` makes the role case unreachable today. | `server/src/coord/mailHoldPolicy.ts` |
| `decider-renews-a-dead-lease` | Task 4.2 names renewal under 120 s left. A matching marker that is no longer live (`until <= now`, or past `now + 360`) is renewed too, since `mailHoldLive` would make the hook ignore it. At exactly 120 s left it is not renewed ("fewer than", `MAILHOLD_RENEW_UNDER_S`'s own docstring). | `server/src/coord/mailHoldPolicy.ts` |
| `mail-disabled-from-the-tick-listing` | The pass reads `mail-disabled` off the tick's listing (`FleetReadModel.switches`), where the mail lane takes a fresh listing of its own. The mail lane's fresh read is a fail-shut kill switch for delivery; here the switch only turns writes into clears, and an unlisted registry gives the pass no rows at all, so the tick's listing is enough. | `server/src/watch.ts#sweepMailHold` |
| `cap-constant-in-ccdargv` | `MAILHOLD_ROUTE_CAP` is declared in `server/src/ccdargv.ts` beside `BROWSER_ROUTE_CAP` and held equal to ccd's `echo route-mailhold-v1` by `ccd-archive.test.ts`'s census, the third spelling. | `server/src/ccdargv.ts` |
| `e2e-kicks-the-row` | Task 4.3's end-to-end case primes the watcher, touches `mail-disabled`, kicks the `mailHold` row so it is due at the next tick, runs `tick()` and waits on `inFlight('mailHold')`. | `server/test/mail-hold-lane.test.ts` |
| `store-read-throw-holds-nothing-new` | An addition to Task 4.3's list: a `urgentHolds` read that throws is not "no hold". The pass writes and clears nothing that pass, logs once an episode, and returns, so every marker keeps its lease until the hook lets it lapse (D3). A pass that let the throw escape would be caught by the row's `warnKey` and logged every 10 s. | `server/src/coord/mailHoldLane.ts` |
| `due-list-mutant-approximated` | Task 4.3's mutation "let the pass read the mail lane's due list instead of the store" cannot be spelled in place: the lane's port has only `urgentHolds`. The mutant reads no hold at all (`new Map()`), which is what the due list answers for a delivery the mail lane will not retry yet, and the not-due renewal case reds. | `server/test/mail-hold-lane.test.ts` |
| `not-ran-narrowed-at-each-site` | The not-ran census (`server/test/consolidationCensus.ts`) reads each `runCcd(` site's text and accepts a site that narrows `ran === false` itself or hands its result to a reader in `RAN_CARRY_READERS`. `routeSetOutcome` reads `ran` first, but it is not in that list, and the file is held by another programme's frozen run, whose holder refused the one-word addition. So each of the three sites (the launch-profile lane, the generations lane's PreCompact write, the mailhold pass) narrows `res.ran === false` itself and answers `ROUTE_SET_UNREACHABLE`, the helper's exported value, and hands the ran arm to the helper. Follow-up, once that file is released: add `routeSetOutcome` to `RAN_CARRY_READERS` and let the three sites hand over the whole answer. | `server/src/routeSetOutcome.ts`, `server/test/consolidationCensus.ts` |
| `clear-reason-mail-off` | The decider's clear under `$REG/mail-disabled` answers the reason `mail-off`, not `mail-disabled`: the quoted marker word has one named home (`single-definition/vocabularies.test.ts`), and a reason word is not the marker. | `server/src/coord/mailHoldPolicy.ts` |
| `mail-sweep-load-timeouts` | Four `mail-sweep.test.ts` cases (each builds up to four primed watchers) timed out at vitest's 20 s locally, at load average 9 to 11, in a full-file run and alone. One of them timed out the same way with this PR's sweep dispatch removed from `tick()`, so the cause is the load, not the new sweep. CI's run is the arbiter. | `server/test/mail-sweep.test.ts` |
| `route-mailhold-spawn-timeout` | PR 3's test helper in `ccd-route-mailhold.test.ts` spawned bash with no timeout. This PR adds cases through it, so the helper now carries a 60 s timeout and `SIGKILL`, rather than adding untimed spawns. | `server/test/ccd-route-mailhold.test.ts` |
