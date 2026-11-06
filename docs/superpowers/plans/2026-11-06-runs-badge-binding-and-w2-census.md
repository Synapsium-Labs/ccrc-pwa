# The Runs badge reads the binding; W2's census

Leftovers from the architecture epic audit. One PR.

- **D-8049 (2026-11-06)** — the Runs badge reads the worker through the run binding, and W2's gates get a committed census. `runsNeedYou` reads `workerOf` and `coordinatorOf`, so a recycled worker id that is asking no longer counts an open run. `census-w7/pwa.ts#runMembership` reports "is this id listed" asked of a run's raw id, which `runMatchers` could not see through a closure. `census-w2/sessionReading.ts` adds `statusLadders` and `rawTurnWordReaders`, each pinned as a may-only-shrink list.

## What the census found

The spec's W2 exit reads "7 → 1" ladders and "6 readers → 1 reading plus 4 named policies". Measured on this tree:

- **`statusLadders()` reads 2**, `presenceOf` and `FleetWatcher.mailPass`. The mail pass weighs the pane, the `.hibernated` stamp and the lifecycle itself to choose its gate.
- **`rawTurnWordReaders()` reads 10**, `turnWordOf` and nine readers still comparing the word they hold: six stall lane functions, the idle-compact nudge, `interruptVerdict` and its route in `buildServer`.

Neither is moved here: both would be behaviour work with their own characterization. The pins hold them where they are, so the counts can only go down. `changeLatchSites()` at 0 needed no pin: `single-definition/advance-switches.test.ts` has held it since D-5861.

## One behaviour note

`workerOf` answers for the run the session's binding names. A session with two open runs under its id binds the newer one, so the older run no longer counts through its worker. The run list already reads it that way.
