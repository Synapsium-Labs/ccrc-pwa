# Capacity follow-ups, round 1: notes for the ledger

This note records what the first round of capacity follow-ups built (run 2959, Overlord wave 191), and where it departs
from the brief. Its carries come from the reviews of capacity Task 2 (#3101, review 2913) and Task 4 (#3117, review
2907), both on `main`. The plan is [`2026-11-19-waiting-workers-sleep.md`](../../plans/2026-11-19-waiting-workers-sleep.md).
The coordinator folds this note into the programme ledger. It defines no D-number: the sleep lane's changes sit under
D-8790 (`working-idle-sleeps`) and D-8791 (`coordinator-told-of-sleep`), and the wake's under D-6095.

Every lane involved still ships in shadow, and arming is the operator's. This round changes nothing an unarmed lane
does except fixes 1 and 4, which only hold or wake more safely.

## In short

| Fix | Finding | What changed |
|---|---|---|
| 1 | T2 F-A | The run-done act asks its verdict again over the act's own listing, so `mail-disabled` raised after the pass's listing holds a waiting worker: no sleep, no observation row, no mail. A finished worker is unaffected. |
| 2 | T2 F-D | The waiting case's hold-offs lapse on the first pass that reads `working-idle-sleep` armed after a pass that read it in shadow, so a worker logged in shadow is measured at once, not up to an hour later. |
| 3 | T2 F-E | A case pins the key's run part: a shadow-logged worker re-dispatched onto a new `working` run is measured at once. |
| 4 | T4 F3 | An admission wake wakes only the woken run's `capacity` blocks. A `capacity` block that no eligible waiter will wake is woken by the lane's next pass when the cap has room, with the block lane's own mail, in one transaction. |
| 5 | T4 F5 | Armed only: a slot the worker readings free is admission room only while the freed-slot window would admit it, so a waiter the window refused is not woken again every pass. Shadow is unchanged. |
| words | T2 F-B, F-C | Corrected below and in the hold-map text; the arming card says what arming now does. |

## 1. Departures from the brief, by slug

| Slug | What the brief says | What this PR does, and why |
|---|---|---|
| `act-relists-by-reask` | `sleepAct` feeds the act's own fresh listing into `atAct` for the waiting case. | `atAct` keeps its reads and also answers `relisted`, the same pure verdict asked over a listing it is handed. `sleepAct` asks it over the one listing it already reads nearest the argv (D-7047), right after the switches. Reading the listing before `atAct` would have put the live reads between the listing and the argv, and a second listing would break `sleep-lanes-pin`'s pins: one listing per act, and none on a held act. The decision stays in `decideSleep`'s one ladder. |
| `arm-lapse-observed-by-the-lane` | When `working-idle-sleep` moves from shadow to Live, clear `waitingHeld`. | The lane observes the move rather than the arming door clearing it: `StopDoneMemory.waitingArmed` keeps what the last pass read, and `waitingHoldsLapse` (L1, `stopDone.ts`) answers yes on the first pass that reads the row armed after one that read it in shadow. The arming route lives in `routes.ts`, which run 1850 holds, and the lane's memory is the lane's alone. A first pass after a restart clears nothing, because its memory is already empty. |
| `block-wake-at-next-pass` | When a coordinator records a `capacity` block while room already exists, wake it at once, with its mail, in the same transaction as the record. | Asked as a structured ask (the record route's deps come from `routes.ts`, which carries no registry listing and no worker-facts port, so the record could read neither the pause nor `mail-disabled` nor the armed room). Ruled: the admission-wake lane's next pass. `capacityBlockWakes` (L1) picks the live `capacity` blocks no eligible waiter of their coordinator would wake (one recorded after its run's wake, one whose run was never refused, one naming no run in a programme with no waiter), oldest first, within the room the waiters left and the lane's own wake budget. Each is woken through `wakeBlockTx` (the one writer of `wokenAt`) with `blockWakeMail` in one transaction, and the pause and `mail-disabled` hold it as they hold the lane. It wakes within a minute of the record, not in the record's transaction, and it also wakes a block recorded with no room once room comes. |
| `runless-block-wakes-in-programme` | The wake marks only the woken run's `capacity` blocks. | A `capacity` block that names no run is woken by the first wake in its programme (`blockWokenWith`, L1): it waited for room for any run of that programme. A block naming another run of the same coordinator waits for that run's own wake. |
| `block-wake-mail-shape` | (none) | The block wake's mail is the block lane's own (`wake: call <id> (capacity)`, `runId: null`), so every block wake reads one way to a coordinator. A run close does not cancel it. |
| `capsroomof-consented` | Claim every path through the peer protocol. | `server/src/coord/dispatchDecide.ts` is held by W1-4b (run 2958, claim 6009). Its holder consented, by mail, to the edit of `capsRoomOf` alone. Its hunks (the self-dispatch check in `decideRequest` and `SELF_DISPATCH_DETAIL`) are disjoint; whoever lands second takes the other by merge. |
| `wakeroom-in-wakebudget` | `capsRoomOf` counts a reading-freed slot only when the window would admit it, through L1 data, never a write. | `capsRoomOf(c, freedAdmissible)` takes the window's answer as a number. `wakeRoom` (`wakeBudget.ts`) reads it: `wakeAdmitMany`'s count over the list, the list it hands back dropped, so nothing is recorded and the one-owner pin of each window holds. The lane reads the watcher's freed-slot list (`freedSlotRecent`) and never writes it. An ordinary free slot never waits on the window. |

## 2. Words corrected (T2 F-B, F-C)

- **F-B, the unlistable registry.** `capacity-t2-notes.md` (§3, F2) says an unlistable registry holds the waiting case in
  `decideSleep`. In the lane it never gets there: the tick returns before any sweep when its listing fails, and the act's
  own failed listing holds as `registry-unlistable` (`switchedOffAt`). `decideSleep` would hold an unmeasurable switch,
  but the lane never hands it one. The hold-map text (`STOP_DONE_HOLD_MAP['mail-disabled']`) and the F2 case's comment
  now say so. That note is left as it was; this line corrects it for the ledger.
- **F-C, the drain.** `capacity-t2-notes.md` (§5) says going Live puts the fleet's quiet `working` workers to sleep
  "within a pass or two". It is ceil(N/3) passes for N such workers: three acts a pass, and a waiting sleep takes one of
  them like any other. Fix 2 makes the first of those passes the one right after arming.
- **The arming card** (`shared/lane-arm.ts`). `working-idle-sleep`'s Live words now say every waiting worker is measured
  on the first pass after it is set Live. `cap-counts-working`'s Live words now say a coordinator the cap refused is told
  of a freed slot only when one can be handed out.

## 3. Red-first evidence

Each new case was run red before its fix. Each guard was then mutated by hand from a saved copy of its file (the
coordinator's mutation helper runs Python modules only), its suite slice run through `ccrc test`, and the file restored
from the copy. All 16 mutants are killed by an assertion.

| Mutant | Guard | Result |
|---|---|---|
| M1 | the act re-asks over its listing (`relisted`) | killed (1 failed) |
| M2 | the re-ask reads the act's listing, not the pass's | killed (1 failed) |
| M3 | `waitingHoldsLapse` answers yes after a shadow pass | killed (1 failed) |
| M4 | the lane keeps what the last pass read (`waitingArmed`) | killed (1 failed) |
| M5 | the case key carries the run | killed (1 failed) |
| M6 | a block naming another run is not woken with this one | killed (2 failed) |
| M7 | a run-less block is woken only in its own programme | killed (1 failed) |
| M8 | a block with an eligible waiter is left to that waiter | killed (1 failed), after its case was rebuilt to leave room to spare |
| M9 | the lane wakes the blocks it chose | killed (1 failed) |
| M10 | block wakes never pass the room | killed (1 failed) |
| M11 | block wakes spend the lane's wake budget | killed (1 failed) |
| M12 | the pass reads on when blocks wait and no run does | killed (5 failed) |
| M13 | `capsRoomOf` bounds a freed slot by the window | killed (2 failed) |
| M14 | the lane hands `capsRoomOf` the window's answer | killed (1 failed) |
| M15 | `wakeRoom` reads the window | killed (2 failed) |
| M16 | the run-scoped block rule in the wake's transaction | killed (1 failed): at load 18 it first timed out at the 20 s bound, and again with a 60 s bound it failed on the block's `wokenAt` |

## 4. Carried, not done here

- **B-N1, in part.** The `wakeOn === 'capacity'` filter in the transaction is now L1 (`isCapacityBlock`,
  `blockWokenWith`). The rest of B-N1 (the hold rule inline in the lane, the inline cap-refusal test in `dispatchRun`,
  `sendBack: state !== 'planned'` in the store) is untouched.
- **A-N7.** The lane still does not hold on `stall-watch-disabled`, so `capacity` blocks, now including the ones it wakes
  on their own, are the one kind woken while that switch stands.
- **F6.** Nothing cancels a queued block wake mail: a run close does not (it names no run), and neither does a dispatch
  the coordinator made itself before the mail is delivered, so the mail can arrive after its thread was picked up.
- **Two derivations (T2 F4).** The re-ask adds no third: `relisted` asks `stopDoneVerdict`, the same as `atAct`.

## 5. Review notes

- **Hook.** The graphify gate refused one search (`grep` for the arming card's words) until a graph query had answered.
  The query ran and its answer was not used: the graph is not an ancestor of HEAD. The search then ran.
- **Load.** The box ran at a load of about 18 throughout, and every gate file ran alone through `ccrc test`. Green:
  `stop-done-working-idle`, `stop-done-verdict`, `sleep-lanes-pin`, `lane-arm-route`, `caps-counts-working`,
  `wake-budget`, `lane-schedule`, `dtbd`, every `single-definition` and `rings` file, `growth-check` armed, and the server
  and PWA source typechecks. Reds, all vitest `Test timed out`, none an assertion: `stop-done-sweep` (three cases) and
  `admission-wake` (two older cases), both green when re-run alone; `deviation-refs` (its two-real-trees case) and
  `coord-db` (three migration cases), which still timed out alone. The server test typecheck was killed twice by the test
  slice's memory cap. This branch touches no migration, schema or ledger, so CI is the arbiter for those four.
- **Hook, again.** The slice hook refused one `ccrc-api timer set` whose note text named the checks still to run; the
  note was worded without them.
