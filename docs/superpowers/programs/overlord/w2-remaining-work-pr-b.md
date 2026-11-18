# Overlord W2 remaining work B: notes for the ledger

This note records what PR B of [`w2-remaining-work.md`](../../plans/2026-11-16-overlord-w2/w2-remaining-work.md) (Tasks 4
and 5) built, and where it departs from the plan's text. The coordinator folds it into the programme ledger and mints any
numbers. No D-number is defined here.

## In short

- **Built:** `edgeVerdict` (L1, `server/src/coord/edgeVerdict.ts`), which maps the done-test reader's answer for an edge's
  target to what the edge's one writer does; `settleEdge`, that writer, and `openEdgesToMeasure`, the arm's read
  (`programmeFactsStore.ts`, two `CoordStore` delegates); the edge arm, a third arm of the forecast lane
  (`forecastLane.ts#runForecastLane`), which asks `doneTestRead.ts#readTarget` and nothing else; the move of
  `EDGE_PREDICATES` and `EdgeTarget` onto done tests' vocabulary; `EDGE_CLEARING_SHIPPED` set to `true`.
- **The carried rulings, built:** the edge's check asks `readTarget` and never reads a run's lineage or `closePr` itself
  (review 2377 F3), so the done-test reader census's admission of `programmeFactsStore.ts#edgeTargetFacts` is deleted;
  a `pr-merged` edge's admission asks only that the run row exists, and the edge clears only through the run's own
  `closePr` naming that pull request, merged (review 2381 N1), with `edgeTargetVerdict`, the wave-boundary reference
  sentence and the plan's question 2 table changed together; an unknown stored edge state counts as open in the keep
  lookup and the cap count (review 2347 F2), the index as ruled on ask 543 below.
- **No migration.** `store.ts` +2 (the two delegates), `watch.ts` 0: the arm is inside the forecast lane's module, and the
  watcher's pass logs failures as before.
- **Live at merge:** the forecast lane's next pass measures every open edge. An edge whose target has passed is `met`, one
  whose target ended the wrong way is `target-ended`, and one whose target no row can answer is `target-unmeasurable`.

## 1. Departures from the plan, by slug

| Slug | What the plan says | What this PR does, and why |
|---|---|---|
| `edge-unmeasurable-answer-ends-at-once` | Task 4's rows 2 and 3 read "any unmeasured answer of the reader" | The reader has two failure words, and the brief's carried ruling (review 2381 N1) maps them apart. `unmeasured` (a read that failed now, such as a locked database) starts or keeps the clock, and seven days of it end the block. `unmeasurable` (a fact no row of this build can answer: `lineage-unattributed`, `not-this-runs-pr`, `no-close-record`) can never change, so the edge moves to `target-unmeasurable` at once, with `unmeasurable: <why>` as its evidence. Neither is ever read as met. |
| `unknown-edge-state-guarded-in-the-writer` | Review 2347 F2: an unknown stored state counts as open in the keep lookup, the cap count and the partial unique index | Ruled on ask 543 (no migration). One SQL spelling, `OPEN_EDGE_SQL` (every state but this build's three closed words, derived from `EDGE_STATES`), serves the keep lookup, the cap count and the arm's read, inside the writer's one transaction. An unknown-state row is kept, never duplicated, and counts toward the cap. The partial unique index `programme_edges_one_open` stays `WHERE state = 'open'`; widening it waits for the next migration that touches `programme_edges` (the coordinator carries it to the ledger PR). |
| `edge-unreadable-rows-never-settled` | Row 1: "the edge's state is not `open`" | Row 1 also answers `none` for an edge whose state, kind or target this build cannot read (each flagged by the store's read), and for a target that could not be asked. A word or shape a newer build wrote is never ended by this one, so the block stays visible, flagged, until a build that can read it measures it. |
| `edge-verdict-hands-the-settle` | `settleEdge(db, id, verdict, evidence, now)` sets the state on an end and `unmeasuredSince` otherwise | `edgeVerdict` decides what is written: an `end` (the state and the masked evidence) or a `clock` (the value of `unmeasuredSince`: the first unmeasured time kept, or null). `settleEdge(db, id, settle, now)` writes it, `WHERE id = ? AND state = 'open'`, and a clock write changes nothing when the value is unchanged, so a second pass writes nothing. Decide in L1, act in L3. |
| `edge-predicates-picked-from-done-tests` | The pick comes from `shared/overlordRequests.ts`, "as done tests names it" | Done tests A shipped its vocabulary as `shared/doneTests.ts`. `EDGE_PREDICATES` is a pick from `DONE_PREDICATES` (a key map that `satisfies Partial<Record<DonePredicate, true>>`, so a word missing there does not compile), and `EdgeTarget` is `Extract<DoneTarget, …>`, so the edge's targets are done tests' bare targets. `shared/programmeFacts.ts` now imports that sibling (its header says so). |
| `edge-arm-reads-every-open-edge` | "for each open edge of a listed programme" | The lane lists no programmes: it reads unsealed closes and due seals. The arm reads every edge that counts as open, of every programme (`openEdgesToMeasure`), bounded by `OPEN_EDGES_PER_PROGRAMME_MAX` per programme. |
| `edge-evidence-words` | "The evidence is the reader's answer, masked and cut whole" | `met` and `target-ended` store the reader's evidence (`pr-7`, `pr-7-not-merged`, `abandon`, `item-9-done`); `target-unmeasurable` stores `unmeasurable: <why>` or `unmeasured since <ms>: <why>`. Each is masked and cut whole to `EDGE_EVIDENCE_MAX`. |
| `edge-pass-counters` | (not stated) | `ForecastPass` gains `edgesEnded` (edges the pass moved out of `open`) and `edgesUnmeasured` (open edges whose target answered unmeasured). A throw on one edge is recorded on `failed` as `<programme>: <message>`, and the pass goes on. |
| `edge-states-declared-for-the-kebab-census` | (not stated) | `edgeVerdict.ts` names `target-ended` and `target-unmeasurable`, so `mail-routes.test.ts`' kebab census of `server/src/coord` admits the edge states through a new L0 guard, `isEdgeState` (which the store's read now uses too). Dropping that admission reds the scan. |
| `pr-merged-admission-asks-only-the-run` | Question 2's table: a `pr-merged` target names "a pull request that run's recorded lineage names" | The carried ruling (review 2381 N1). The plan's question 2 table and bullet, review focus 4, Task 3's step 9 row and the `edge-targets-tied-to-rows` line now say a run that exists, cleared through its own close record; the plan file is edited in this PR on the coordinator's word, under a `Ledger-Edit` trailer. |

## 2. Plan steps measured

- **Characterization first:** `programme-remaining.test.ts` pins `EDGE_PREDICATES`, their order, their kinds and their
  guard, committed green on the old literal before the move commit, which changes `shared/programmeFacts.ts` alone.
- **Task 4 mutants** (`server/test/sim/programmeFactsSets.ts`, key `server/src/coord/edgeVerdict.ts#edgeVerdict`, floor
  1): thirteen, every one killed: unmeasured read as met, the not-open guard skipped, met and ended swapped, row 2's age
  check dropped, pending keeping the clock, an unreadable state, kind or target settled, seven days by more than rather
  than at least, unmeasurable read as transient, the clock restarted on every unmeasured answer, the evidence not masked,
  the evidence not cut. `edgeTargetVerdict`'s set keeps six mutants; ET-4 is now "a pull request on this programme's run
  refused", since the lineage check it mutated is gone.
- **Task 5 red checks** (each applied to the file, the named suite run, and the file restored from a saved copy): see
  section 3.

## 3. Red checks

Each change was applied to the file, the named suite run red, and the file restored from a saved copy (compared byte
for byte afterwards):

| Change | Suite that reds |
|---|---|
| `settleEdge` called from the remaining-work door | `single-definition/writers-map` (the caller census) |
| `settleEdge`'s end without `state = 'open'` | `forecast-lane` (the concurrent pass) and `programme-facts-store` (two cases) |
| `settleEdge`'s clock without `state = 'open'` | `programme-facts-store` (the unknown-state row) |
| `edgeTargetFacts` reads the lineage again | `single-definition/done-test-reader` (the admission is gone) |
| The keep lookup reads only the literal `'open'` | `programme-facts-store` (an unknown-state row is kept, no second edge) |
| The cap count reads only the literal `'open'` | `programme-facts-store` (an unknown-state row counts toward the cap) |
| The edge arm removed | `forecast-lane` (eight cases) |
| The edge states undeclared in the kebab census | `mail-routes` |
| `EDGE_CLEARING_SHIPPED` back to `false` | `programme-remaining` |

## 4. For landing

- **Peers who agreed co-edits:** forecasts B (run 2433: `shared/programmeFacts.ts`, `programmeFactsStore.ts`,
  `forecastLane.ts`, `forecast-lane.test.ts`; each piece in its own block or section, my arm and port members and
  counters after theirs), desktop polish WM1 (`store.ts` delegates, one `mutation-floors.json` row), gates A
  (`writers-map.test.ts`: the `settleEdge` writer row and its caller census) and quiz PR2 (`mail-routes.test.ts`: the
  edge-state admission). Whoever lands second merges `main` once and keeps both sides.
- **`EDGE_CLEARING_SHIPPED` is `true` here.** Forecasts B's health and critical-path cases pin both values; whichever PR
  lands second moves its live-wiring case to the `true` branch.
- **Residual for the ledger:** the partial unique index `programme_edges_one_open` reads the literal `'open'` (ask 543).
