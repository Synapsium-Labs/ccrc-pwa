# The mail pass's ladder and the raw turn-word readers read through the one reading

- **D-8610 (2026-11-12)** — `session-reading-ladders`: the mail pass's recipient rung reads the session through `readSession`, and the nine readers that still compared Claude Code's raw status word read it through `turnWordOf`; no behaviour changes, and W2's census pins drop to `statusLadders` 1 function and `rawTurnWordReaders` 1 function (`turnWordOf` alone).

The first carried constraint of the closed architecture refactor (`docs/superpowers/programs/architecture-refactor.md`).
W2's census (D-8049, `server/test/census-w2/`) held two ladders and ten raw readers; it now holds `readSession`'s ladder
and the reading itself.

## Order of the work

1. **Characterization first, green on the old code.** `mail-recipient-ladder-characterization.test.ts` drives the mail
   pass over every row of tmux's verdict (`live`, `gone`, `unknown`), the `.hibernated` marker (present or not) and the
   lifecycle a gone pane reads (`stopped`, `restarting`, `orphan`, `never-started`, `unmeasurable`), and records the gate,
   the attempt count and the wake. `turn-word-readers-characterization.test.ts` records each moved reader's answer for
   the seven words of `turn-words-characterization.test.ts`; `interrupt-route.test.ts` gains the route's row per word.
2. **The move.** No characterization row changed.
3. **The pins.** The census lists shrink to what is left.

## What moved

| Reader | File | Now |
|---|---|---|
| The mail pass's recipient rung (`FleetWatcher.mailPass`) | `server/src/watch.ts` | One `readSession` per row from the facts it holds: a gone pane is the reading's `absent` substrate, and `session-dead` is its `deadCause` (the dead lifecycle, set exactly when `lifecycleIsDead` names it). `tmux-unknown` still reads `sv` for tmux's message. |
| `interruptVerdict` | `server/src/inject/send.ts` | `turnWordOf` once; `waiting` and every unknown word are `unknown`, a turn, as before. |
| The interrupt route | `server/src/server.ts` | `turnWordOf(word.word) === 'idle'` skips the row's read, as before. |
| `decideIdleCompactNudge` | `server/src/idlenudge.ts` | The `keystroke` policy (the nudge types a prompt): only `idle` is at rest, which is the old exact compare. |
| The stall lane's six | `server/src/coord/stall.ts` | `stallCoordGate`, `stallCoordBusySince`, `stallIdleStart`, `stallOrphanEInner`, `stallVerdictInner` (frozen) and `stallWaveOneLadder` compare `turnWordOf(word)`. The `waiting` compares stay: `waiting` is no `Turn`, it is the dialog fact. |

## Deviations found

- **The mail pass keeps one rule of its own, a different fact.** It holds and wakes any gone pane that carries a
  `.hibernated` marker, whatever lifecycle sits beside it (D-5242). `readSession` calls a row `asleep` only when it is
  `stopped` AND marked, and reads a marked `orphan` or `never-started` as dead and a marked `restarting` or `unmeasurable`
  as alive or doubt. `ccd hibernate` writes the stop stamp and the marker together, so the rows differ only where the
  marker sits beside another lifecycle, which the characterization pins (held `hibernated` and woken). Taking the
  reading's answer there would park or silently hold mail that today wakes its recipient: a behaviour change of its own,
  not part of a move. The rule now reads `reading.substrate === 'absent'` and the record's `hibernatedAt`, which the
  census does not count as a ladder (one fact, no lifecycle).
- **`rawTurnWordReaders` stops at 1, not 0.** Its last rows are `turnWordOf`'s own three compares, the allowlist that IS
  the one reading. Hiding them behind a set lookup would only blind the census.
- **Three pins followed the move.** `stall-vocabulary.test.ts` admits `turnWordOf` beside `stallWatchSays` on the stall
  lane's one import line from `sessionReading` (still no policy table, no `turnSays`). `hibernate-census.test.ts` loses
  its `dead-lifecycle server/src/watch.ts` row: the mail lane asks `lifecycleIsDead` through the reading now, and its
  `tmux-verdict` row still says it consults `hibernatedAt` first. `lifecycle-sweep.test.ts`'s allow-list for
  `mailPass` swaps `lifecycleIsDead(` for the reading's `lifecycle` fact, matched whole.
- **Not in this change.** The local test run on this machine reds some `mail-sweep` and `stall-sweep` rows, each of
  which reds on the old code too, and two `session-hook-turnmark` rows, which test the bash hook this change does not
  touch.
