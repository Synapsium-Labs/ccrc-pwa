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
  list under serviceability B's `overlordLoadCandidates`. **`unboundCandidates(designation, sessionId)`** answers from the
  designation alone: `not-designated` when it is not this session's live binding (none, a pending one, or a rebind),
  unmeasured when it is unreadable, and null only for this session's live binding, when the facts must be read.
- Every mapper checks the designation first. With no designation, all three read measured `false`. With the designation
  unreadable, all three read unmeasured `designation unreadable`. In the outside-the-set rule, the answer's own account is
  left out of the candidates that decide, as the other two readings leave it out (fix round 1, D).
- **The wiring** (`renewalReadingsWiring.ts`) does this for the Overlord's generation only:
  - It reads the designation first. When it is not this session's live binding, or is unreadable, the three answer from it
    alone, and neither the facts nor the pool answer is read (fix round 1, I).
  - Otherwise, once a pass, it reads the account facts: the roster, `readLimits`, `readSharesMeasured`, the store's central
    pool edges and `laneFactsOf` for each roster account, and builds the candidates from them.
  - Once a pass for each Overlord session the designation binds, it asks for the pool answer through the body adapter's
    composer, behind `ccdCan(state, 'poolAnswer')`.
  - Each reading runs inside its own catch, logged once per pass (F17). A read the three share fails all three: a facts
    read that throws makes each of them unmeasured `<reading> read failed`, not only one (fix round 1, O).
  - A coordinator gets none of the three. With no store edges, or with no runner, no io or no config to build the reads
    from, the three keep the lane's `W1`. A missing roster does not keep `W1`: with reads handed in and no roster, the facts
    read throws and the three read failed (fix round 1, G). `CcrcConfig.roster` is required by its type, so production cannot
    reach that case.

## Where `main` differed from the plan

- **The unmeasured other in the load move is still folded on `main`.** `accountLoadMoveReading` counts only serving
  others, so an `unmeasured` other drops out and "no counted other" reads `false`. `account-load.test.ts`'s own case pins
  that: `accountLoadMoveReading(cand('c', lim(86)), [cand('o', lim(10), 'unmeasured')])` is measured `false`. So the guard
  was built as the plan says, in `accountLoadOf`: a `false` beside any unmeasured other reads unmeasured. It is one owner's
  rule held on the consumer's side until serviceability B reads that case as unmeasured itself (the plan's index change).
  When that lands, this guard's line should go.
- **No `watch.ts` line, and a second limits reader, legitimately different (fix round 1, A).** The tick reads the limits
  once and publishes them (`FleetWatcher.currentLimits`), but `sweepGenerations` runs before that read in the same tick,
  so the tick's own reading would be the previous tick's, or none on the first. So the wiring calls the producer's own
  reader (`readLimits`), as the request-time callers in `server.ts` do, and the shares read, which has no tick owner, the
  same way. The wiring already receives the watcher's `io`, `cfg`, `runCcd` and `fleetState` (the deps spread in
  `sweepGenerations`), so no packet to the holder of `watch.ts` was needed. The reason is in the wiring's header too.
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
| `rebind-reads-the-account-rows-false` | A designation bound to another session makes the three read measured `false` for this generation, as `termRaisedOf` reads a rebind. The plan did not say. `unboundCandidates` asks the module's existing `boundTo`, so no new session comparison enters the run/session census. |
| `designation-checked-before-the-pool-answer` | In each mapper, the designation's arms come before rule 1. This follows Step 1's cases: no designation reads `false` and an unreadable designation reads unmeasured, whatever the pool answer. |
| `account-reads-from-the-wiring-not-watch` | See "No `watch.ts` line" above. |
| `pool-answer-composer-shared-with-the-body` | See the body adapter above. |
| `watcher-port-gains-account-pool-edges` | See `WatcherCoordMember` above. The plan's index row said "others 0". |
| `outside-set-leaves-its-own-account-out` | Fix round 1, D. Rule 8 counts only the candidates other than the answer's own account, as `classUnservableOf` and `accountLoadOf` leave the session's account out. The plan excludes only a held account. Without it, while the server's set and ccd's answer disagree (up to the pool sync's lag), the session's own serving account would make the reading due and cost a refused renewal on every pass. |
| `account-reads-wait-for-the-designation` | Fix round 1, I. The designation is read before anything else; when `unboundCandidates` answers, no pool answer, edges, limits or shares are read. `boundCandidates` became `unboundCandidates`. |
| `load-move-guards-the-unmeasured-other` | The F5 guard, as built. It is blind in one more case than it needs to be: a current account with a fresh load under the hard line reads `false` on the producer's own terms, but beside an unmeasured other it reads unmeasured here, because the mapper sees only the producer's answer. A blind hard row never fires, so the cost is a missed renewal and never a false one. It goes away with serviceability B's fix. |

## Mutation table

**Before:** each set's baseline (the real module) passes its suite. `mutation-floors.test.ts` refuses a set whose baseline
fails. **After:** each mutant below is applied in memory by the floors harness, and each one is killed. The six new sets
(33 mutants after fix round 1) are at floor 1 (every mutant killed), measured green in `test/sim/mutation-floors.test.ts`.
The floor keys were added and no floor was lowered; the key `boundCandidates`, added in this PR, is now
`unboundCandidates`.

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
| | O12 the answer's own account counted (fix round 1, D) | "D: the answer's own account is never a candidate…" |
| | O13 the mismatch conjunct dropped (fix round 1, E) | "E: an undecidable verdict beside a crossing that stands…" |
| | O14 a held account held to the unreadable crossing (fix round 1, H-b) | the F7 case |
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
| | L5 the guard holds a due load too (fix round 1, H-a) | "H-a: the guard holds only a false…" |
| `accountLoadMoveOf` | M1 the idle conjunct dropped | "a measured busy session is not due" |
| | M2 an unread marker read as idle | "an unread marker with a due load" |
| | M3 a failed turn read as busy | "a due load on an idle session is due" |
| | M4 the unmeasured load preferred to a measured busy | "a measured busy session is not due" |
| `overlordCandidatesOf` | C1 the ordered list not asked | "the designated set's accounts, in order" |
| `unboundCandidates` | B1 not this session's read as a live binding | "the designation alone answers unless…" |
| | B2 an unreadable designation read as a live binding | "the designation alone answers unless…" |

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

### Fix round 1 (review 3797, call 1187): red before, red after

Each point is a case that passes on the fix round's code (readings suite 110 of 110, wiring suite 48 of 48), measured red by
hand with its guard removed or its old behaviour put back, each file run alone and restored after:

| Point | Mutation applied | Case red |
|---|---|---|
| F | the store's edges read not bound to the store (`.bind(coord)` dropped) | the real-store case (a real `CoordStore` on a fixture database, its designation and a central edge seeded) |
| E | the `verdict === 'mismatch'` conjunct dropped | "E: an undecidable verdict beside a crossing that stands…" |
| H-a | the F5 guard's `!load.value` dropped | "H-a: the guard holds only a false…" |
| H-b | the unreadable-crossing rule hoisted above the held check | the F7 case, its new unreadable-crossing line |
| G | the reads built with no io; the reads built with no config | the case for no edges, no runner, no io or no config (both) |
| D | the answer's own account counted again (the round-1 code) | "D: the answer's own account is never a candidate…" |
| I | the reads started before the designation's answer (the round-1 order) | "the designation first…", whose reads must be zero |

E, H-a, H-b and D also have mutants in the floors sets (O13, L5, O14, O12).

## What arms when this merges

The three readings change only the due record and `blind`, which the generations lane writes in shadow and live alike.
The renewal acts run only when the `continuity` row on the Shadow lanes card (`lane_arm_settings`, seeded `shadow`) is
Live and the box's ccd can renew (`canRenew`). With that row in shadow, nothing acts on the box: the Overlord's shadow walk
only records the would-be state. The reads themselves run from the merge, on every tick, in shadow too: for a generation
of the Overlord's role that the designation binds, one pool-answer exec, one limits read, one shares read and one edges
read per pass (fix round 1, I). With the row Live, the Overlord's generation can now become due on `account-outside-set`,
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

- The cost of these reads per pass on the fleet box (plan question 8) was not measured there; the question stays open, and
  the coordinator carries it. They run on every tick from the merge, in shadow too.
- The account-facts assembly (roster, limits, shares, edges, `laneFactsOf` per account) is a third copy beside
  `coord/overlordRoutes.ts`'s `accountFactsOf` and `accountLoad.ts`'s `loadFactsOf` (fix round 1, L); its consolidation is
  carried as a ticket.
- The F5 load guard is broader than it needs to be (see `load-move-guards-the-unmeasured-other`).
- The holds stay `'not-wired'` until PR H.
