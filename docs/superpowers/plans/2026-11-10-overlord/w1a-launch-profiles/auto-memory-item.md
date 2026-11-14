# The operator item on auto memory (W0-09): arm the launch-profile lane?

For the coordinator to raise as an operator item (plan `w1a-launch-profiles.md`, Task 8). The text below is the item. The
section after it is for the coordinator only.

---

## Turn auto memory off for fleet sessions?

**What was measured.** Claude Code's auto memory is on for every account on the fleet box. W0b counted 8 to 14 non-empty
project-memory directories in each account, most of them shared across accounts by a link. No account sets
`autoMemoryEnabled`. W0-09 measured that one launch setting, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, keeps project memory out
of a session's requests, both before and after an account swap.

**Why it matters.** A session loads whatever memory its account has stored as if it were the session's own knowledge, and
nobody reviews what is in it (spec §3.8). A swap adds the new account's memory on top. For a long-lived session that is
renewed and checked against a replay baseline, an unreviewed memory changes what it knows between two measurements.

**What arming the `launch-profile` lane does.** It is a row on Settings › Automation › Shadow lanes.
- From each session's next launch, its route names its role's launch profile, and ccd applies it.
- Auto memory is off for every role except plain sessions.
- Plain sessions follow the Settings row "Auto memory for plain sessions" (Settings › Automation). Its default is off.
- The Overlord's profile also turns off forks and the agent view. Those apply once W1's Overlord exists.
- The lane writes at most five routes a minute, so a fleet converges over a few minutes. A route only changes the
  session's next launch, never a running one.

**What it does not do.**
- It deletes nothing. The doctor's `auto-memory` check lists the directories that exist today; you decide what to remove.
- It moves no compaction setting. The lowered auto-compact window, Claude Code's own window and idle compaction off
  follow only once the `continuity` row is live too. That row cannot go live before the renewal act ships.
- It leaves alone any session that carries the history programme's W3 steer marker, for as long as the marker stands.

**Options.**
1. **Arm now.** Auto memory goes off for coordinators, workers, reviewers and the rest from their next launch; plain
   sessions follow their Settings row.
2. **Arm for long-lived roles only, first.** A one-line change to `profileFor` (recorded as a departure) makes every role
   but `coordinator` and `overlord` keep its memory until a later item.
3. **Keep it in shadow.** The lane keeps logging the writes it would make. Nothing changes.

**Recommended: arm once the replay baseline is recorded (option 1, after the baseline).** A memory nobody reviews is loaded
as the session's own, so the baseline should be measured first, under the same conditions the renewal will compare against.

---

## For the coordinator (not part of the item)

- **The interim rule (ruling R9).** Raise this item only after the replay quiz's baseline run is recorded. Until the
  replay-quiz piece's `baseline-missing` refusal ships, that rule is the only thing that keeps an early arm from
  forfeiting the baseline. The item says "after the baseline" for the same reason.
- **The W3 steering cohort.** The lane skips any session that carries `~/.ccrc/history/steer-on/<id>` (it reads the same
  file the session hook's W3 gate reads). The cohort's 7-day bound ends 2026-11-17 16:57 UTC, and the operator then removes
  the markers. Arming before that date changes nothing for the two cohort sessions; tell the history coordinator if the
  item is answered before then.
- **What to read before arming.** The server's log line `ccrc-server: launch-profile (shadow): N session(s) would get a
  route write (…)`, written whenever the count changes, shows what the first live passes will write.
