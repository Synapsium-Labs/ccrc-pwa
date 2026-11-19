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
- **The cause.** The cap counts placed runs outside the idle and terminal states, including `dispatched`, `working`
  and `unknown`, whatever their worker is doing. A worker that waits (on the operator, its coordinator or an outside
  event) can keep its run `working`, so it keeps a slot and stays awake.
- **The design.** The fleet measures waiting; no coordinator declares it. Eligible parked workers can sleep after
  30 minutes quiet. The operator can then arm sleep for idle workers on `working` runs, and separately arm the cap
  to stop charging measured waiting runs. A coordinator still refused takes the wave itself or is mailed when a slot
  frees.
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
- Once armed, a waiting worker gives up its dispatch slot after about 30 minutes without anyone acting per worker.
  An eligible worker also gives up its process. A worker holding a live claim keeps its process by design, even if
  its run no longer holds a slot.
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
on a box that has `hibernate-hold-ok`). The hold must name the newest placed non-terminal run and that run's
`sessionId` must match the worker. A hold naming any other open run, an operator's own text and an unreadable read
keep holding. D-8789 amends D-6091's "an open run's hold still holds" for the worker's own newest placed run, as
ruling F5 (b) requires. It is a behaviour change in a commit of its own, live at once.

### Part 2. An idle worker on a `working` run sleeps after 30 minutes

The run-done policy (`server/src/stopDone.ts`, `server/src/sleep.ts`) gains one case: the worker's newest placed run is
`working` and the turn marker has been quiet for `STOP_DONE_PARKED_IDLE_MS` (30 minutes).

- `not-done` no longer holds that case, and the worker's own `working` run no longer holds `run-worker`. A second
  active run naming the worker still does.
- A `dispatched` run is not included: its worker has not started, and its brief is unread mail.
- Every hold that marks a use stays as it is: `mail`, `marker-background`, `background` from the row, `scheduled`,
  `claim`, `viewer`, `menu`, `roster`, `bucket`, `turn`, the act-time re-measure and `ccd`'s `attached`.
- The `working-idle-sleep` row ships in shadow; the operator arms it on the Shadow lanes card (D-8790). The lane
  applies the row's gate to a sleep verdict only when the run it read has `runStateOf(store) === 'working'`.
  While shadowed it journals that decision without acting or mailing; it does not gate the existing parked cases.
- The asleep row and the journal line say "waiting on a working run" where they say "parked at …" today.

### Part 3. A run holds a slot only while its worker works

`store.capsUsage` (`server/src/coord/store.ts`) owns the predicate for which placed runs count today. The new cap
reader, used by `capsMeasured` and the caps view, measures those same rows; it does not repeat that predicate.
It reports how many counted rows have a worker measured waiting, including rows whose worker is known asleep,
stopped, dead or archived (`gone`). An awake worker qualifies only with an idle turn verdict, no marker or row
background work, no subagents, no session cron and at least one readable timestamp among `turnAt`, `stopAt` and
`restartAt`, with 30 minutes since the newest one. A marker with no stamps is unmeasured and counts. So does any
reading that cannot be made. A worker between turns keeps its slot. This amends D-6094 (`48ef4ad0e`): read the
marker's quiet time, not just idle at the instant of asking, and drop the two-hour run-age bound (D-8792).

- **Shadow first.** The `cap-counts-working` Shadow lanes row ships in shadow. From merge the caps view reports
  waiting separately, but the effective cap count stays exactly as it is today. Only while the operator has armed
  that row do measured waiting runs stop using slots. Freed slots are handed out at the stack's wake-budget rate.
- **Mail wake.** The cap does not refuse a mail wake or an operator-requested wake; the wake budget still paces
  them. Under the proposed starts-not-wakes rule (D-8793, the operator's to confirm), a worker counts again when
  it wakes. Busy workers may briefly exceed the cap; new starts wait until the count is back under it.
- **Send-back.** This is a separate door: `advance -> working` from `awaiting-review`, `merging` or `closing`.
  Unarmed, today's cap check stands. Armed, a send-back to a sleeping worker is a resume, not a start, and cannot
  be refused at the cap (D-8792). This exemption does not bypass any other gate. D-6093 (`81fc8422b`) supplies the
  live-resume and live send-back exemptions for the armed path.

### Part 4. The coordinator is told once; the stall watch is unchanged

The stall verdict holds every rung for a worker whose lifecycle reads `stopped`, and a sleeper reads `stopped`. So a
worker put to sleep on a `working` run leaves the quiet ladder, and nothing wakes it to ask. That hold stays: waking a
waiting worker every few hours to ask whether it still waits is the loop the anti-goals forbid.

Instead, a live sleep on a `working` run can queue system mail to that run's coordinator (D-8791). Use the
stall-notice pattern: record the observation in the same transaction as the mail, or use `hasMailWithSubject` with
both the run and the worker's `stopAt` in the subject. Send at most once per `(run, stopAt)` and at most once per run
per `STOP_DONE_PARKED_IDLE_MS`, even across acknowledgement and restart. The mail names the run and the worker's last
turn, and explains the two routes back: mail can request a wake, or a send-back can resume the run. A worker parked
at review, merge or close sends no such mail: there the wait is the coordinator's own.

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

| Task | Adopts | Draft base | Landing and arming order |
|---|---|---|---|
| 1 | #3069: Part 1, the fix | `main` | After this design and plan land |
| 2 | #3070: Part 2 with Part 4's mail | #3069 | After Task 1; ships in shadow; operator arms Part 2 first |
| 3 | #3074: Part 3, with D-6093 | `main` | Lands after Task 2; no code dependency on Task 1. Ships in shadow; operator arms Part 3 only after Part 2 and the arming evidence |
| 4 | #3077: W1-4 | #3074 | After Task 3 |
| 5 | Stack: W1-4b | — | After Task 4 and its own Step 0 gate |
| 6 | Stack: W1-5 | — | After Task 5 and D-8126 A5 on `main` |

Each PR pins today's behaviour first, ships its guard with a test that goes red when the guard is removed, and rolls
back by revert. Parts 2 and 3 have separate operator switches; merging either does not arm it.

## 5. Constraints

- The repository's architecture rules: the verdicts stay pure (L1), the lanes act (L4), one owner per fact.
  `store.capsUsage` owns the SQL counted-row predicate; the caps view and admission go through the new cap reader.
  The sleep rule lives in `decideSleep` alone.
- Additive wire only. No new run state, so `run-states.test.ts` and `FLEET_PROTO` are untouched.
- No new `ccd` verb. `ccd hibernate --hold-ok` exists.
- The sleep lane's switches (`stop-done-disabled`, `hibernate-disabled`, `reclaim-paused`) stop Parts 1 and 2 and
  therefore Part 4's mail. They do not control Part 3. Part 3's own operator switch restores the current cap count
  and send-back check without a deploy, while keeping the waiting readings visible. Each new row is defined only in
  the existing shared lane-arm catalogue, with a shadow seed and the catalogue's census coverage; no parallel marker.
  Part 5 keeps the fleet-capacity plan's controls.
- Account switching and the auto-swap are never touched.

## 6. Left to the builder

- The shape of the own-run comparison in `heldKindOf` and how `stopDoneSleepInput` carries it.
- How much of each stack commit survives the re-ground: `main` has moved more than 440 commits since its base.
- The console's exact words for the caps control and the asleep row, judged at every width, skin and theme.
- OA-F2 and OA-F3 are evidence for arming Part 3, not merge gates. Re-measure from shadow for the 30-minute rule:
  OA-F2 gives the dated sample size and share of eligible finished children asleep by the 30-minute mark, with
  mail-held exclusions; OA-F3 lists the currently counted runs the rule would exclude and their measured worker
  readings. The item asking the operator to arm Part 3 shows both. §1 is the baseline, not that evidence. W1-4b's
  separate Step 0 self-claimed-dispatch count still gates its behaviour commit.

## 7. Risks

- **A wake costs time.** Mail to a sleeper wakes it at most once per 10 minutes per recipient, under the wake budget.
  A send-back has its own cap check as described in Part 3; accepting the send-back does not make mail delivery or
  waking instantaneous.
- **More workers at once.** Arm Part 2 first to let eligible workers release their processes, then Part 3 after the
  shadow evidence has been shown. A live claim still keeps the process. Once Part 3 frees slots, workers can wake
  later and briefly take the busy count above the cap. The operator can turn Part 3 off or lower the dial.
- **A stalled worker is not asked.** A worker that stopped short and then sleeps gets no `stall-check:`; its
  coordinator gets Part 4's mail instead and has to act on it.
- **Part 1 acts on deploy.** About eleven parked workers will go to sleep within the hour. Each wakes on mail, a
  dispatch or the operator opening it.

## 8. Promise delta

This spec is a design for review, and it ships no behaviour. It changes no Promise. Each build pull request of the
plan carries any delta of its own.

```promise-delta
none - a design spec for review that ships no behaviour, and the build plan carries any Promise change
```
