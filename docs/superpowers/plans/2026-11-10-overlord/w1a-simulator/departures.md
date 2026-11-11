# W1a simulator: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-simulator.md`'s "Deviations found" and the index plan. Each
departure is named by its plain-words slug, with no number; the plan file itself is left unedited.

## New departures

- **reach-clock-stops-while-the-server-is-down, tightening of the invariant's statement.** The plan's CB-reach
  restarted its clock at a `server boot` line but judged that line before applying the restart. Seed 9 showed a mail
  falling due at the very instant the server crashed: no sweep could push it, and the boot line was then found in
  violation. The rule now: the scenario appends `server crash down sim` before each `world.crash`, CB-reach carries
  `up` (true at the start), a crash line sets it false, a boot line sets it true and restarts `steadySince`, and a
  violation needs `up`. The clock stops while the server is down and restarts at its boot. Three control rows pin it.
