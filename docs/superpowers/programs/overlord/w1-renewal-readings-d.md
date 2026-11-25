# W1 renewal readings, PR D: the account readings

Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md`, Task 7 only, with its Global Constraints,
Cross-plan seams, Review Focus and fix-round findings F1, F5 and F7. Built on `main` at `09c8f5d502`. No deviation number
was allocated for this run: departures are recorded by slug below, for the coordinator to fold into the ledger.

## What was built

Three readings of the Overlord's generation leave `W1` and become measured. They are hard rows of Table 3.3.11b.

- **`accountOutsideSetOf(answer, candidates, holds)`** (C46). It reads the parsed `ccd pool-answer` line, the candidates
  and the holds. The rules follow the plan's order, first match: not run, refused or unparsed reads unmeasured, naming
  which. A project word on the route record reads unmeasured `no set on the route record`. A held account is outside the
  set (F7). `serve`, or `mismatch` over a crossing that stands, reads measured `false`, or unmeasured `holds unread` when
  the holds could not be read. `undecidable` reads unmeasured with the pool state. A crossing that cannot be read is
  unmeasured. Outside the set, the candidates decide: any unmeasured candidate reads unmeasured (F5), one serving reads
  `true`, and none serving reads `false` (`stranded`). "Has a set" is read from the session's `side` word, never from
  `pool-side` (F1). `holds` is the literal `'not-wired'` in this PR. The read and unread hold arms are covered by unit
  cases, and PR H wires them.
- **`classUnservableOf(on, candidates, nowS)`** (Table 3.4b). It asks the server's twin, `serviceability(class, laneFacts,
  'set-side', nowS)`, for the generation's class (`familyClassOf(g.model)`) on the account it runs on. Serviceability B's
  `classUnservableReading` maps the answer. Servable here reads `false`. An unmeasured own answer reads unmeasured. After
  that, the other candidates decide: any unmeasured reads unmeasured (F5), one serving reads `true`, none reads `false`.
  An unknown class, an unknown account and unread account facts each read unmeasured.
- **`accountLoadOf(account, candidates, nowS)`** and **`accountLoadMoveOf(load, turn)`** (C57). The first is serviceability
  B's `accountLoadMoveReading`, with this account as the current candidate and the rest as the others. An account that is
  not a candidate reads unmeasured. The F5 guard is described below. The second joins that reading with "the turn marker
  reads idle" (`state !== 'working'`) by Kleene's and. A measured busy session reads `false`. A load that is not due reads
  `false`. An unread marker beside a due load reads unmeasured, naming the marker.
- **`overlordCandidatesOf(designation, facts)`** builds the candidates once a pass: designation A's `overlordAccounts`
  list under serviceability B's `overlordLoadCandidates`. **`boundCandidates(designation, sessionId, candidates)`** binds
  them to one generation, and a designation bound to another session (a rebind) does not apply.
- Every mapper checks the designation first. With no designation, all three read measured `false`. With the designation
  unreadable, all three read unmeasured `designation unreadable`.
- **The wiring** (`renewalReadingsWiring.ts`) does this for the Overlord's generation only:
  - Once a pass, it reads the account facts: the roster, `readLimits`, `readSharesMeasured`, the store's central pool edges
    and `laneFactsOf` for each roster account. It builds the candidates from those facts once.
  - Once a pass for each Overlord session, it asks for the pool answer through the body adapter's composer, behind
    `ccdCan(state, 'poolAnswer')`.
  - Each reading runs inside its own catch. A read that fails makes only that field unmeasured `<reading> read failed`,
    logged once per pass (F17).
  - A coordinator gets none of the three. With no runner, io, roster or store edges, the three keep the lane's `W1`.

## Where `main` differed from the plan

- **The unmeasured other in the load move is still folded on `main`.** `accountLoadMoveReading` counts only serving
  others, so an `unmeasured` other drops out and "no counted other" reads `false`. `account-load.test.ts`'s own case pins
  that: `accountLoadMoveReading(cand('c', lim(86)), [cand('o', lim(10), 'unmeasured')])` is measured `false`. So the guard
  was built as the plan says, in `accountLoadOf`: a `false` beside any unmeasured other reads unmeasured. It is one owner's
  rule held on the consumer's side until serviceability B reads that case as unmeasured itself (the plan's index change).
  When that lands, this guard's line should go.
- **No `watch.ts` line.** The wiring already receives the watcher's `io`, `cfg`, `runCcd` and `fleetState` (the deps
  spread in `sweepGenerations`). So it calls the producers' own readers (`readLimits`, `readSharesMeasured`) instead of
  taking the tick's limits from the watcher. The cost is one limits read and one shares read of its own on a pass that
  judges an Overlord generation. No packet to the holder of `watch.ts` was needed.
- **The pool-answer read reuses the body adapter's composer.** `overlordBody.ts`'s `poolAnswer` was a closure. It is now
  the exported `ccdPoolAnswer(ran, state, id)`, and the body and the wiring each call it. The body's catch-all runner is
  the exported `bodyRunner`, which the body now builds its own `ran` from. So there is one composer, one capability check,
  one runner shape, no new `runCcd(` site and no new ccd verb.
- **`WatcherCoordMember` gains `accountPoolEdges`** (`coord/ports.ts`, one word). Designation A's ordered list reads the
  central pool edges, and the watcher's store port did not carry them. `rings/watcher-store-port.test.ts` pins the member
  list against what the watcher reaches.
- Serviceability B's `Candidate`, `overlordLoadCandidates`, `classUnservableReading` and `accountLoadMoveReading` were on
  `main` with the shapes the plan assumed.

## Departures, by slug

| Slug | What and why |
|---|---|
| `account-load-split-into-load-and-move` | The plan's `accountLoadMoveOf(load, others, turn)` is two L1 functions: `accountLoadOf(account, candidates, nowS)` (the not-a-candidate rule and the F5 guard) and `accountLoadMoveOf(load, turn)` (the idle half). The plan put "not a candidate" in the wiring. It is a decision, so it belongs in L1. |
| `class-unservable-takes-the-lane-facts` | `classUnservableOf(on, candidates, nowS)` takes the account's lane facts, not a ready `Serviceability`. Calling `serviceability` is the decision, so it stays in L1. It also needs the account's id to tell this account from the others. |
| `account-readings-candidates-built-in-l1` | `overlordCandidatesOf` composes designation A's `overlordAccounts` with serviceability B's `overlordLoadCandidates`, the same composition `loadLineReading` makes inline. So `renewalReadings.ts` also imports `coord/overlordDesignation.ts` (C5, L1), beside the plan's `poolrule.ts` and `accountLoad.ts` (C1, L1). All three are named in the module's header. |
| `rebind-reads-the-account-rows-false` | A designation bound to another session makes the three read measured `false` for this generation, as `termRaisedOf` reads a rebind. The plan did not say. `boundCandidates` asks the module's existing `boundTo`, so no new session comparison enters the run/session census. |
| `designation-checked-before-the-pool-answer` | In each mapper, the designation's arms come before rule 1. This follows Step 1's cases: no designation reads `false` and an unreadable designation reads unmeasured, whatever the pool answer. |
| `account-reads-from-the-wiring-not-watch` | See "No `watch.ts` line" above. |
| `pool-answer-composer-shared-with-the-body` | See the body adapter above. |
| `watcher-port-gains-account-pool-edges` | See `WatcherCoordMember` above. The plan's index row said "others 0". |
| `load-move-guards-the-unmeasured-other` | The F5 guard, as built. It is blind in one more case than it needs to be: a current account with a fresh load under the hard line reads `false` on the producer's own terms, but beside an unmeasured other it reads unmeasured here, because the mapper sees only the producer's answer. A blind hard row never fires, so the cost is a missed renewal and never a false one. It goes away with serviceability B's fix. |

## Mutation table

**Before:** each set's baseline (the real module) passes its suite. `mutation-floors.test.ts` refuses a set whose baseline
fails. **After:** each mutant below is applied in memory by the floors harness, and each one is killed. The six new sets
are at floor 1 (every mutant killed), measured green in `test/sim/mutation-floors.test.ts`. The floor keys were added and
no floor was lowered.

| Set | Mutant | Killed by (one of) |
|---|---|---|
| `accountOutsideSetOf` | O1 "has a set" tested on `poolSide` (F1) | the F1 case over pool set B1's mismatch line |
| | O2 crossing `none` read as `valid` | the F1 case |
| | O3 the servable-account check dropped | "outside the set with none serving is not due" |
| | O4 an unmeasured candidate folded into "none serves" (F5) | the F5 case |
| | O5 the held check dropped (F7) | the F7 case |
| | O6 unread holds read as none | "holds unread" |
| | O7 `undecidable` read as serve | "a bad set passes the set test…" |
| | O8 crossing `unreadable` read as `none` | "a crossing that cannot be read…" |
| | O9 no set read as a set | "a project word on the route record" |
| | O10 not designated read as applying | "with no designation the row does not apply" |
| | O11 an answer not run read as serve | "not run, refused and unparsed…" |
| `classUnservableOf` | U1 the servable-account check dropped | "no other candidate serves: not due" |
| | U2 an unmeasured other folded (F5) | the F5 case |
| | U3 this account counted as another | the F5 case's second line |
| | U4 the own reading ignored | "servable here: not due" |
| | U5 an unmeasured own reading read as unservable | "the account's own answer unmeasured" |
| | U6 asked on the `other` side | "the set side is asked…" |
| | U7 not designated read as due | "no designation: measured false" |
| `accountLoadOf` | L1 the F5 guard dropped | the F5 case |
| | L2 the current account counted among the others | "this account's own serves word is not an other's" |
| | L3 not a candidate read as not due | "an account not among the candidates…" |
| | L4 not designated read as unmeasured | "no designation: measured false" |
| `accountLoadMoveOf` | M1 the idle conjunct dropped | "a measured busy session is not due" |
| | M2 an unread marker read as idle | "an unread marker with a due load" |
| | M3 a failed turn read as busy | "a due load on an idle session is due" |
| | M4 the unmeasured load preferred to a measured busy | "a measured busy session is not due" |
| `overlordCandidatesOf` | C1 the ordered list not asked | "the designated set's accounts, in order" |
| `boundCandidates` | B1 a rebind read as this session's | "bound to this session…; to another session…" |

**The plan's six (Step 5), also measured by hand** on the real file. Each mutation was applied to
`renewalReadings.ts`, `continuity-renewal-readings.test.ts` was run alone, and the file was restored. Before: 107 of 107
pass. After:

| Mutation | Cases red |
|---|---|
| "has a set" tested on `poolSide` again (F1) | 10 |
| crossing `none` read as `valid` | 4 |
| the servable-account check dropped | 2 |
| an unmeasured candidate folded into "none serves" (F5) | 2 |
| the idle conjunct dropped | 2 |
| an unread marker read as idle | 1 |

**The wiring, by hand,** against `continuity-renewal-readings-wiring.test.ts`. Before: 47 of 47 pass. After: one case red
for each of these:

- the pool answer asked without its per-pass memo;
- the facts read without their per-pass memo;
- the account readings moved outside the Overlord-only gate (a coordinator gets them);
- the rebind binding skipped.

## What arms when this merges

The three readings change only the due record and `blind`, which the generations lane writes in shadow and live alike.
The renewal acts run only when the `continuity` row on the Shadow lanes card (`lane_arm_settings`, seeded `shadow`) is
Live and the box's ccd can renew (`canRenew`). With that row in shadow, nothing acts on the box: the Overlord's shadow walk
only records the would-be state. With it Live, the Overlord's generation can now become due on `account-outside-set`,
`class-unservable` or `account-load`, and the renewal act drains it at its next turn end and renews it. Coordinators are
unchanged.

**What reads `W1` for PRs G and H:**

- the Overlord's soft `placeHiddenObservedMs` (PR G);
- the holds into `accountOutsideSet`, which stay `'not-wired'` until PR H (a held account is not yet seen as outside the
  set);
- the digest reading in `installBehind` (PR H).

`entryRetired` and `evaluationDue` stay `W1` as the plan says (W4 and W3).

## Verification

Each file was run alone through `ccrc test`:

- `continuity-renewal-readings.test.ts`: 107 passed. `continuity-renewal-readings-wiring.test.ts`: 47 passed.
- `continuity-generations-lane.test.ts`: 105 passed.
- `sim/generation-day.test.ts`: 39 passed, in 480 s.
- Every file under `test/rings/`: green. `watcher-store-port` passed 23.
- `sim/mutation-floors.test.ts`: every renewal-readings set green. Two sets for `pwa/src/face/mood.ts` failed their
  baseline on the test box because the `@ccrc/ui` package could not be found there. That is the test box's install, not
  this change, which touches nothing under `pwa/`.
- `consolidation-census` 33, `id-argv-census` 11, `growth-check` 62, `growth-caps` 12, `overlord-body` 39,
  `overlord-designate-route` 51, `overlord-settings-doors` 60, `account-load` 29: all green.
- The server's `tsc --noEmit` is clean.
- The whole test-tree type check (`test/tsconfig.tests.json`) was killed by the slice's 6G memory cap (exit 137). A
  narrow check over the touched files and their imports is clean.

### The pull request's first run

Both readings suites, `continuity-generations-lane`, `sim/generation-day` and `sim/mutation-floors` ran in the pull
request's run and passed. Three files failed:

- `verb-gate.test.ts`: the moved pool-answer call site resolved no scope, because its signature wrapped onto a line the
  scanner does not read as a function head. Fixed: the signature is one line, through a `BodyRan` type alias.
- `run-session-census.test.ts`: `boundCandidates` added a session comparison by hand. Fixed: it asks the existing
  `boundTo`.
- `ccrc-install-tree.test.ts` ("repairs a mode someone changed"): timed out at 20 s. It fails the same way on a clean
  checkout of `main` at `bd4e28b691` on the test box, so it is `main-red` and was left alone.

Both fixes were run alone afterwards: `verb-gate` 25 passed, `run-session-census` 18 passed, the readings suites 107 and
47, `overlord-body` 39, and the renewal-readings floors green.

## Known limits

- The pool answer's cost per pass on the fleet box (plan question 8) was not measured on the fleet box. It is one ccd
  read per pass for each Overlord session, plus the one limits read and the one shares read above.
- The F5 load guard is broader than it needs to be (see `load-move-guards-the-unmeasured-other`).
- The holds stay `'not-wired'` until PR H.
