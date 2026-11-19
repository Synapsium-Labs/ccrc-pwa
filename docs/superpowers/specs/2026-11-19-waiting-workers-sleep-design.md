# Waiting workers sleep and hold no slot (design)

**Status:** adopted by the Overlord programme (2026-11-19, the operator's direction). Its five calls carry the numbers
the allocator issued, D-8789 to D-8793, defined in the plan's "Deviations found"; D-8793 stays the operator's to
confirm.

**Related:** `2026-10-20-fleet-capacity-and-worker-lifecycle-design.md` (§3.1, §3.4, §3.5, rulings F5 and F7) and its
plan `docs/superpowers/plans/2026-10-20-fleet-capacity-w1.md` (D-6091 to D-6097);
`2026-11-09-coordinator-autonomy-default-design.md` §8.4 (wave A8); `2026-09-29-worker-stall-watch-design.md`; the
Overlord spec's R22 (the dispatch cap stays the operator's dial).

## In short

- A coordinator at the dispatch cap asked the operator to stop idle sessions so that approved builds could start. The
  operator's direction: the fleet frees its own capacity, and such an item is never raised again.
- **The cause.** The cap counts run rows in `dispatched` or `working`, whatever their worker is doing. A worker that
  waits (on the operator, on its coordinator, on an outside event) keeps its run `working`, so it keeps a slot and
  stays awake. Nothing in the fleet says "waiting".
- **The design.** The fleet measures waiting; no coordinator declares it. A worker that has been idle for 30 minutes is
  put to sleep whatever its run's state, and a run holds a slot only while its worker is working. A coordinator that
  is still refused takes the wave itself or is mailed when a slot frees.
- **One defect found on the way.** The sleep of workers parked at review, merge or close (D-6092) has never acted on
  the fleet, because every dispatched worker carries a hold that names its own open run. Part 1 fixes it.

## 1. What was measured

Read-only, on the live fleet, 2026-11-18 and 2026-11-19.

| What | Measured |
|---|---|
| The cap, and runs counted against it | 24 and 24 |
| Counted runs whose worker had been idle 10 to 49 hours | 4 |
| Work runs parked at review, merge or close, worker idle over 30 minutes | 11, all awake, none asleep |
| Work runs at `working`, worker idle over 30 minutes | 4, all awake |
| The hold on every one of those workers | its own run's (`program:<slug> wave:<n> run:<id>`) |
| Fleet box at the time | 37 of 62 GB available, memory pressure near zero, load 7 on 16 cores |

Stopping the sessions the item named would have freed no slot: a stop does not change a run's state.

## 2. Goals, non-goals, anti-goals

**Goals**
- A waiting worker holds no slot and no process within about 30 minutes, with no act by anybody.
- A coordinator refused at the cap never needs the operator: it works the wave itself or waits for the server's mail.
- The operator sees how many workers are working and how many are waiting.

**Non-goals**
- Admission by box memory (fleet-capacity W3). The cap stays a count, and stays the operator's dial (R22).
- A way for a coordinator to declare a run waiting, or a new run state.
- Changing the stall watch in any way.
- Retiring anything: sleep keeps the workspace, the branch, the transcript and the registry row.

**Anti-goals**
- A worker put to sleep while something uses it: a turn, background work, a session cron, unread mail, a live claim, a
  screen with it open.
- A sleeping worker that reads as dead or stalled, so that a lane re-dispatches it, abandons its run or pushes the
  operator.
- A waiting worker woken in a loop by the fleet's own mail.

## 3. Approaches

1. **Declared waiting.** The coordinator parks a run (a new state or flag) and the server frees the slot. Precise, but
   it depends on every coordinator saying so, and the measurements show nobody says anything: four workers idle for up
   to 49 hours on `working` runs.
2. **Measured waiting (chosen).** The server already reads whether a worker is idle (the turn marker, the live word).
   Idle for 30 minutes with nothing using it is waiting, by measurement. No new state, no new skill clause.
3. **Memory admission** (fleet-capacity W3). It removes the count altogether. It is ruled and unbuilt, it needs
   readings `ccd` does not have yet, and R22 keeps the count as a spend dial.

The operator chose the scope on 2026-11-19 ("way 2" for this session; the rest of D-8126 goes to the Overlord
programme). Approach 2 and the 30 minutes were this design's calls, shown to the operator and not overruled.

## 4. The design

### Part 1. The parked sleep acts (a fix)

`heldKindOf` (`server/src/sleepLane.ts`) reads a hold that names a non-terminal run as `run-live`, and `run-live`
holds sleep. The hold a dispatch writes names the worker's own run, so a worker parked at `awaiting-review`, `merging`
or `closing` never passes. The fix: a hold that names **the worker's own newest placed run** guards the workspace, not
the process, so it passes for the run-done policy exactly as a programme hold does (through `ccd hibernate --hold-ok`,
on a box that has `hibernate-hold-ok`). A hold naming any other open run, an operator's own text and an unreadable
hold keep holding. This restores ruling F5 (b); it is a behaviour change in a commit of its own, live at once
(`D-8789`).

### Part 2. An idle worker on a `working` run sleeps after 30 minutes

The run-done policy (`server/src/stopDone.ts`, `server/src/sleep.ts`) gains one case: the worker's newest placed run is
`working` and the turn marker has been quiet for `STOP_DONE_PARKED_IDLE_MS` (30 minutes).

- `not-done` no longer holds that case, and the worker's own `working` run no longer holds `run-worker`. A second
  active run naming the worker still does.
- A `dispatched` run is not included: its worker has not started, and its brief is unread mail.
- Every hold that marks a use stays as it is: `mail`, `marker-background`, `scheduled`, `claim`, `viewer`, `menu`,
  `roster`, `bucket`, `turn`, the act-time re-measure and `ccd`'s `attached`.
- It ships in shadow, as one row on the Shadow lanes card, and the operator arms it (`D-8790`).
- The asleep row and the journal line say "waiting on a working run" where they say "parked at …" today.

### Part 3. A run holds a slot only while its worker works

`capsMeasured` (`server/src/coord/dispatch.ts`) counts a run in an active state unless its worker is measured
**waiting**: asleep, stopped, dead or archived, or awake with its turn marker quiet for 30 minutes and nothing running
(no background work, no session cron). A worker between turns keeps its slot. This builds on D-6094 from the stranded
stack (`handoff/d8126-autonomy-stack`, commit `48ef4ad0e`), with one real change: that commit reads "idle" at the
instant of asking and guards only by the run's age, so its reading gains the marker's quiet time, and its two-hour
bound goes (`D-8792`). It ships live, in a commit of its own.

- **The cap governs starts, not wakes** (`D-8793`, the operator's to confirm). A waiting worker that
  wakes on mail is never refused, as an asked wake never is; it counts again from that moment. So busy workers can
  pass the cap for a while when waiting workers wake after their slots were given away, and new starts are refused
  until the count is back under it. The wake budget still paces the wakes.
- Slots that this frees are handed out no faster than the wake budget's rate, as that commit builds it.
- Every reading that cannot be made keeps counting: the cap fails closed.
- The caps view answers the count and how many runs were left out, and the console's caps control says both.
- A live resume and a send-back of a live worker skip the check (D-6093, commit `81fc8422b`).

### Part 4. The coordinator is told once; the stall watch is unchanged

The stall verdict holds every rung for a worker whose lifecycle reads `stopped`, and a sleeper reads `stopped`. So a
worker put to sleep on a `working` run leaves the quiet ladder, and nothing wakes it to ask. That hold stays: waking a
waiting worker every few hours to ask whether it still waits is the loop the anti-goals forbid.

Instead, when the lane puts a worker to sleep on a `working` run, it queues one system mail to that run's coordinator
(`queueSystemMail`, keyed on the run and the sleep so a restart never sends it twice): the run, when the worker's last
turn ended, and that mail or a send-back wakes it (`D-8791`). The coordinator then knows
whether its worker waits for something or stopped short, and acts by its own skill. A worker parked at review, merge
or close sends no such mail: there the wait is the coordinator's own.

The other lanes were read against a sleeper on an active run and need no change: `runStuck` already answers `asleep`,
the claimant ladder reads a sleeper as alive, drift's `run-quiet` reads run events only, and the dead-dispatch pass
acts on `planned` runs alone.

### Part 5. A refused coordinator is never stranded

From the stack, re-grounded on `main` and reviewed again, under the fleet-capacity plan's own gates:

- **W1-4 (D-6095):** a refused dispatch is stamped, journalled and put in the feed; a lane mails the oldest refused
  coordinator per programme when the cap has room.
- **W1-4b (D-6096):** the in-place bind, and the `self-dispatch` refusal.
- **W1-5 (D-6097):** the refusal's words and the coordinator skill's entry. It lands after D-8126 A5 is on `main`: the
  Overlord programme's A5 rewrites the same skill text.

### Order

| PR | What | Depends on |
|---|---|---|
| 1 | Part 1, the fix | nothing |
| 2 | Part 2 with Part 4's mail, in shadow | 1 |
| 3 | Part 3, with D-6093 | 1 |
| 4 | W1-4 | 3 |
| 5 | W1-4b | 4 |
| 6 | W1-5 | 5, and A5 on `main` |

Each PR pins today's behaviour first, ships its guard with a test that goes red when the guard is removed, and rolls
back by revert. Part 2 goes live by the operator's switch.

## 5. Constraints

- The repository's architecture rules: the verdicts stay pure (L1), the lanes act (L4), one owner per fact. The cap's
  predicate lives in `capsMeasured` alone; the sleep rule in `decideSleep` alone.
- Additive wire only. No new run state, so `run-states.test.ts` and `FLEET_PROTO` are untouched.
- No new `ccd` verb. `ccd hibernate --hold-ok` exists.
- The sleep lane's switches (`stop-done-disabled`, `hibernate-disabled`, `reclaim-paused`) stop every part of this.
- Account switching and the auto-swap are never touched.

## 6. Left to the builder

- The shape of the own-run comparison in `heldKindOf` and how `stopDoneSleepInput` carries it.
- How much of each stack commit survives the re-ground: `main` has moved more than 440 commits since its base.
- The console's exact words for the caps control and the asleep row, judged at every width, skin and theme.
- The gates the fleet-capacity plan names (OA-F2, OA-F3, the self-claimed-dispatch count): §1 answers the first two;
  the plan records them in each PR body.

## 7. Risks

- **A wake costs time.** Mail to a sleeper wakes it at most once per 10 minutes per recipient, under the wake budget.
  A send-back reaches a sleeping worker by mail, so a fix round can start up to that much later.
- **More workers at once.** Part 3 frees slots that waiting workers held, and those workers can wake later, so busy
  workers can pass the cap for a while. The operator lowers the dial if spend says so.
- **A stalled worker is not asked.** A worker that stopped short and then sleeps gets no `stall-check:`; its
  coordinator gets Part 4's mail instead and has to act on it.
- **Part 1 acts on deploy.** About eleven parked workers will go to sleep within the hour. Each wakes on mail, a
  dispatch or the operator opening it.
