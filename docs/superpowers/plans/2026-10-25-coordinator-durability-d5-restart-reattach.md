# Coordinator durability D5 (#759): a restarted worker is told at once, and its coordinator hears once

D5 of the coordinator-durability programme (#759, epic #752). A run worker whose pane was respawned over background
tasks that did not survive (orphan D's candidate) used to sit idle until orphan D fired after `ORPHAN_D_IDLE_MS`. The
stall watch gains a wave-2 arm, `restarted`, that reads the same candidate the moment the restart is on the marker:
rung 1 mails the worker a re-check notice, rung 2 mails the run's claimant one heads-up. Both are class `self-wake`
(recorded, never pushed). It ships dark behind the existing `stall-watch-w2-live` marker; no new marker.

**Not done here.** The ticket's hold-card sentence (the session hook's SessionStart arm) is not added; the worker's
notice is the rung-1 self-mail instead. Whether that reading stands is an operator ruling at arming time.

## Deviations found

- **D-6853** — The `restarted` arm judges rung 1 and rung 2 together from one marker read while rung 1 is
  unrecorded, because the worker's own turn on its notice ends orphan D's candidate and a rung 2 left to the next
  sweep would almost never go out. The worker notice is the rung-1 self-mail (`restarted:`), not a hold-card
  sentence in the session hook, which is a growth-limited god file with frozen compaction-card anchors. The
  heads-up window (`RESTARTED_HEADS_UP_MS`, 10 minutes) runs on restart times and reads the worker's primary run's
  rows only, so it is per worker on its run. Pins: `server/test/stall-restarted.test.ts`, and the two `restarted`
  cases in `server/test/stall-sweep.test.ts`.
