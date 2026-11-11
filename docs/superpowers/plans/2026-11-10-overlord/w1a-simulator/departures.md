# W1a simulator: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-simulator.md`'s "Deviations found" and the index plan. Each
departure is named by its plain-words slug, and by its number once the coordinator has issued one; the plan file itself
is left unedited.

## New departures

- **D-8240, reach-clock-stops-while-the-server-is-down, a change to the invariant's statement.** It judges fewer lines
  than the plan's predicate, so it relaxes the plan's wording; it is the rule spec I1 states. The plan's CB-reach
  restarted its clock at a `server boot` line but judged that line before applying the restart. Seed 9 showed a mail
  falling due at the very instant the server crashed: no sweep could push it, and the boot line was then found in
  violation. The rule now: the scenario appends `server crash down sim` before each `world.crash`, CB-reach carries
  `up` (true at the start), a crash line sets it false, a boot line sets it true and restarts `steadySince`, and a
  violation needs `up`. The clock stops while the server is down and restarts at its boot. Three control rows pin it
  ("stays green while the server is down", "restarts its clock at the boot", and "judges a crash line while the server
  is still up": a crash line is judged before it is applied, so a push missed before the crash stays red, and the row
  goes red if the crash is applied first). The `server crash` line is one only
  the simulator can write, since a live server writes nothing as it dies, so the W1 monitor, which sees only boots,
  must restart the clock at a boot line and cannot apply the down rule.
- **sim-world-bounds-scheduled-calls, addition.** This is the worker's own addition; no plan offered it. The world holds
  a budget of scheduled calls (`SimWorld`'s `maxCalls`, 200 000 by default), so a zero-delay re-arm fails instead of
  hanging: past the budget the call is not made, the fake records a warning, the re-arm stops and `simulate` throws. The
  fake is untouched. `Scenario` has no field for the budget, since no scenario needs one: a scenario that needs more
  than 200 000 calls (a week at one call a second) has to change `run.ts`, which builds the world.

## Rulings within the plan

From the review of run 1796 (fix round 1):

- `simulate` and `assertScenario` are async, and a scheduled call that returns a promise that rejects fails the run.
  The mechanism: `SimWorld` keeps every promise a scheduled call returns until it settles, and `simulate` awaits
  `world.settle()` after `runUntil`, before it reads the fake's warnings and before it restores the ambient stubs.
  `settle()` waits on microtasks only, up to 10 000 turns, and one turn more for the fake's own `.catch`; it never yields
  to a timer or to I/O, so nothing outside the scenario runs while the stubs stand. The mutation runner awaits each
  suite case, so a case that rejects kills its mutant. `server/test/fakeTime.ts` is untouched. Two rows pin it (a
  rejection at once, and one after three awaits), and each goes red without the settle.
- CB-rung-never-falls takes its episode from the lane's `held some` .. `held none` lines, the held mail the lane reads
  itself, never from the episode the decider returns (M5: a decider that returns no episode switched the invariant
  off). The decider opens an episode at its oldest held mail and closes it when nothing is held, so the two agree.
- CB-reach's threshold arm is exact: the push is due at the first sweep at or after the threshold, computed from the last
  boot's phase (sweeps run every `STALL_SWEEP_MS` from the boot), and within one sweep of the link being measured again
  or of a boot, as before. M6 (`<` to `<=`) differs from the decider only when a sweep falls exactly on the threshold,
  and then pushes one sweep late. Moving mail off the 5-minute grid would make it an equivalent mutant, not a killed one,
  so the bound is made exact instead. A control row pins both a mail queued on a sweep and one queued half a sweep after.
- M5 and M6 are in the mutant set and killed: M5 by CB-rung-never-falls, M6 by CB-reach, on seed 1 first.

- Task 5: the mutation runner rewrites a copy's relative imports to absolute paths, the plan's Step 3 fallback. Under
  vitest a `file:` URL with a `.js` specifier is not mapped to its `.ts` source; an absolute path is, `shared/` included.
- Task 4: the scenario sets a current `done` turn marker when the word moves into `idle` or `idle-blocked`, as a Stop
  hook leaves it; `waiting` keeps the turn open, as `stallCoordBusySince` documents.
- Task 6: `FAST` is the plan's rule applied to W0's final `matrix.out`: the scenarios measured at 1.1 s or less at the
  defaults. `nohold` measured 1.2 s there, so it runs only with `CCRC_MODEL=full`.
- Task 6: the bytecode row runs first in its file, so no earlier row's run can have left a `__pycache__` that makes it
  vacuous.

## Known survivors

- **M7** (`return 0` to `return 1` below the threshold: rung 1 at first sight of held mail) and **M8** (`rung: 0` to
  `rung: 2` in the fresh episode: rung 2 at minute 0) survive every seed. Both invariants fail only towards the operator
  (a push late or missing), and nothing checks a push that comes early or too often. Whether the spec needs a "no push
  before its cause" invariant is a spec question, which the coordinator carries in the ledger for the wave that turns
  the push lane on. They are not in the set: the floor demands every mutant killed (A1 below), so a set holding a
  survivor goes red. M8 also leaves the edge `rung-1` unreached, which `assertScenario`'s coverage check reports, but
  the floors suite does not check coverage.

## Known limits

- **Async lanes are not interleaved.** A continuation after an `await` in a scheduled call runs after the whole
  `runUntil`, at the run's end time, so a lane that awaits between its own steps does not see the timers that fell due
  meanwhile. A rejection is seen; the order is not. A wave that drives an async lane steps the world one call at a time.
- **A1.** The floor assertion cannot go red: every result must already be `killed` and an `invalid` throws, so the
  score is always 1, and an empty set scores 1 too. The floors file and its merge-base ratchet constrain nothing until a
  set may keep a survivor. The plan prescribes this shape.
- **A2.** The ambient guard in `run.ts` stubs six sources only (`Date.now`, `performance.now`, `Math.random` and the three
  timers). `crypto.randomUUID` and `randomBytes`, `process.hrtime` and `AbortSignal.timeout` pass, and the static scan
  covers neither `server/test/sim` nor `stall.ts`.
- **A3.** The bytecode row in `overlord-model.test.ts` is vacuous in a checkout where
  `server/test/model/overlord/__pycache__` already exists (the directory is git-ignored). `importsOf` keeps only the
  first name on a line, so `import sys, fractions` passes the standard-library row.
- **A4.** `check.py`'s `run()` reports any `RuntimeError` (a `RecursionError` included) as `state bound exceeded`;
  `MUTATION=<typo>` is not validated and runs the baseline; `main_json` copies `main`'s mutation loop and its
  `KEY=VALUE` parse, so the JSON the test reads and the table pasted into a PR can drift apart.
- **A8.** Without the call budget, a 0 ms re-arm spins a synchronous loop that vitest's `testTimeout` cannot interrupt:
  the run hangs with a worker at full CPU instead of going red. A mutant that loops inside the decider is the same case.
- **A9.** `mutate.ts`'s `RELATIVE` is a second reader of import specifiers beside `scan/parse.ts`. Its reason for
  being different: it rewrites text, it does not parse it; a mutant's copy is source text written to disk, and the
  rewrite must change only the specifier's bytes. Its limits: it also rewrites a match inside a comment (harmless in a
  copy that is only loaded), and it misses `import x = require('…')`, which no ES module under `server/src` uses.
- **A10.** The default seed list 1 to 32 is declared twice, in `mutation-floors.test.ts` and in
  `stall-coord-blocked-day.test.ts`. The floors suite does not go through `simSeeds`, so `CCRC_SIM_SEED` never reaches
  it and its kill message carries no replay line.

## Owed, outside this piece

- Three more test files carry a local mulberry32 that the plan's nine missed (`server/test/history-lib.test.ts`,
  `server/test/delegation-delta-applier.test.ts`, `server/test/tickDietCorpus.ts`), so D-8225's move is not complete;
  they move in a follow-up.
- A mutant that loops inside a decider is not bounded by the runner, which has no per-mutant timeout.
