# W1a simulator: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-simulator.md`'s "Deviations found" and the index plan. Each
departure is named by its plain-words slug, with no number; the plan file itself is left unedited.

## New departures

- **reach-clock-stops-while-the-server-is-down, tightening of the invariant's statement.** The plan's CB-reach
  restarted its clock at a `server boot` line but judged that line before applying the restart. Seed 9 showed a mail
  falling due at the very instant the server crashed: no sweep could push it, and the boot line was then found in
  violation. The rule now: the scenario appends `server crash down sim` before each `world.crash`, CB-reach carries
  `up` (true at the start), a crash line sets it false, a boot line sets it true and restarts `steadySince`, and a
  violation needs `up`. The clock stops while the server is down and restarts at its boot. Two control rows pin it ("stays green while the server is down" and "restarts its clock at the boot"). The `server crash`
  line is one only the simulator can write, since a live server writes nothing as it dies, so the W1 monitor, which sees
  only boots, must restart the clock at a boot line and cannot apply the down rule.
- **sim-world-bounds-scheduled-calls, addition.** The plan offered a fire-count cap on one `advance` as optional. It sits
  in the world instead, as a budget of scheduled calls per world (`SimWorld`'s `maxCalls`, 200 000 by default), so a
  zero-delay re-arm fails instead of hanging: past the budget the call is not made, the fake records a warning, the re-arm
  stops and `simulate` throws. The fake is untouched.

## Owed, outside this piece

- Three more test files carry a local mulberry32 that the plan's nine missed (`server/test/history-lib.test.ts`,
  `server/test/delegation-delta-applier.test.ts`, `server/test/tickDietCorpus.ts`), so D-8225's move is not complete;
  they move in a follow-up.
- A mutant that loops inside a decider is not bounded by the runner, which has no per-mutant timeout.
