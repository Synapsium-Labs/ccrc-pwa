# The swap heartbeat's sleep outlives its stop

**Size:** S. **Deploy class:** `ccd/` (one function body) plus one server test file; no `agent/`, `pwa/` or wire change. One task.

## Problem

The server suite's process-leak check (D-3533) failed a PR run after every test file had passed. The report named one process: a `sleep 20` whose cwd was a `ccrc-ccd-swap-*` fixture home, seven seconds old.

**Measured: two shapes of the same defect.** A bash subshell that is killed while it runs a FOREGROUND `sleep` dies alone. Its `sleep` keeps running, is reparented, and keeps every file descriptor it inherited.

1. **Test harness: the reported `sleep 20`.** In `server/test/ccd-swap.test.ts`, the case 'gives up after SWAP_BEAT_MAX ticks with its parent still alive — the second bound' starts a killer subshell, `( command sleep 20; kill -9 "$beat" ) … & killer=$!`. When the beat ends on its own bound, the test runs `kill "$killer"`. That kill ends the subshell and leaves its `sleep 20` running. The killer's output goes to `/dev/null`, so nothing waits on it. The orphan outlives the run, and the leak check reports it. It is the only `sleep 20` in the file.
2. **ccd, in production: the same shape.** `_swap_beat` ran `sleep "$SWAP_BEAT_INTERVAL"` in the foreground of the stamper subshell. `_swap_beat_stop` TERMs that subshell, so every stopped swap left the stamper's in-flight `sleep` (up to 30 s) running. That sleep holds the stdout the stamper inherited from `cmd_swap`. Anything that captures `ccd swap`'s output waits for EOF until the sleep ends. The agent runs `ccd swap` through `execFile`, and a shell runs it through `$(…)`. Measured with the interval at 5 s: the capture returned after 5.1 s, and the sleep was still alive 0.2 s after `_swap_beat_stop` returned. The swap's outcome is unchanged; only its return is late, by up to one interval, after every swap.

## Gate: none — the killer fix is on `main`, its pin lands here

#1016 landed the killer-line fix for shape 1 on `main`: a TERM trap that ends the killer's own sleep. #983 and #960 carry the same hunk. This work adds what none of them has, a check that pins the fix. The check sits on separate lines, at least one unchanged line away from that hunk, so it merges cleanly with #983 and #960 (simulated with `git merge-tree`).

## Task 1: the stamper takes its sleep with it (D-6113)

**Files:** `ccd/ccd` (`_swap_beat`), `server/test/ccd-swap.test.ts` (the bound case's killer line and a check on it, plus two new cases at the end of the heartbeat `describe`).

**Steps:**

1. Red: the case 'stopping the stamper ends its in-flight sleep too, so a captured `ccd swap` returns at once'. It uses a real `sleep` (no stub) and `SWAP_BEAT_INTERVAL=5`. It starts `_swap_beat` in the background, polls with `pgrep -P` until the stamper has a child (so the stop always lands mid-sleep), records that child, and runs `_swap_beat_stop`. It then asserts that the child is dead and that the whole snippet returned in under 3 s. On `origin/main` it fails with `kid=found alive=yes` after 5.1 s.
2. Fix: `_swap_beat` runs `sleep … & s=$!; wait "$s"` behind `trap '… kill "$s" …; exit 0' TERM`. A trapped signal interrupts `wait`; it does not interrupt a foreground child. The trap is dropped on both ways out (the parent check's early return and the end of the bound), so a foreground call hands its caller back the TERM disposition it had. A second case pins that: 'leaves no TERM trap behind on either way out of a foreground call'.
3. Red: the bound case ('gives up after SWAP_BEAT_MAX ticks … the second bound') also asserts that its killer's `sleep 20` is gone. After the beat ends, it polls with `pgrep -P` until the killer has a child and records that pid, so the check cannot pass vacuously. It then kills the killer as before and polls `kill -0` on the recorded pid for up to 2 s. On `origin/main` it fails with `killer_sleep=found left=yes` (a red run then kills the sleep itself, so the red run leaks nothing). Fix: the killer runs `command sleep 20 & s=$!` behind `trap 'kill "$s"; exit 0' TERM` and waits on it. That is the hunk #1016 landed.
4. The stamper's trap also waits on the sleep it kills (`{ kill "$s"; wait "$s"; }`), so the stamper is gone only once its sleep is, and `_swap_beat_stop`'s own `wait` returns after both.
5. Nothing else changes. The stamper still checks its parent before every stamp, still stops after `SWAP_BEAT_MAX` ticks, and still stamps every `SWAP_BEAT_INTERVAL`. `cmd_swap` and `_swap_beat_stop` are untouched. Account switching and the auto-swap are not gated on anything new.

**Mutation table** (each mutation run against the whole `ccd-swap.test.ts`, on a `git archive` copy):

| # | Mutation of `_swap_beat` | Result |
|---|---|---|
| M1 | foreground `sleep` again (the `origin/main` shape), trap kept | red: in-flight sleep case (5.3 s) |
| M2 | the trap kills nothing (`trap 'exit 0' TERM`) | red: in-flight sleep case |
| M3 | no trap at all (background sleep and `wait` kept) | red: in-flight sleep case |
| M4 | the early return keeps the trap | red: no-trap-left case |
| M5 | the bound's exit keeps the trap | red: no-trap-left case |
| M6 | no `wait` (the beat does not pace itself) | red: the wall-clock re-stamp case and the in-flight sleep case |
| M7 | `s` cleared before the `wait` (the `wait` kept, on `$!`) | red: in-flight sleep case |
| M8 | the trap kills the sleep but does not wait on it | green: not pinned. The gap between the kill and the reaping is microseconds, too short to observe without a flaky check. Kept as hardening. |
| M9 | the killer's trap kills nothing (`trap 'exit 0' TERM`) | red: the second-bound case |
| M10 | the killer has no trap (background sleep and `wait` kept) | red: the second-bound case |

**Verify:** `cd server && ./node_modules/.bin/vitest run test/ccd-swap.test.ts --maxWorkers=2` (19 pass), then the other `ccd-swap-*` suites, `tsc --noEmit`, and the doc suites (`deviation-refs` after `git fetch origin main`, `dtbd`, `topology-clean`, `single-definition`, `docs-grammar`).

**Routing:** native. It is a judgment fix to a process-lifetime property, not a literal change.

**Needs:** nothing. **Gates:** none.

## Deviations and decisions

### Issued for this work and defined here

- **D-6113** — `swap-beat-sleep-reaped`: a subshell that is TERMed while it runs a foreground `sleep` leaves that sleep running. Both places this happened now sleep in the background and wait on it, behind a TERM trap that kills the sleep. `_swap_beat` (ccd) also waits on the sleep it kills and drops the trap on both of its exits, so `_swap_beat_stop` leaves no orphaned `sleep` holding `cmd_swap`'s stdout, and a captured `ccd swap` returns as soon as the swap does. The bound case's killer subshell in `ccd-swap.test.ts` takes its `sleep 20` with it (the fix landed in #1016), so the suite leaves nothing for the run's orphan check (D-3533) to find. Both are pinned by checks that record the sleep's pid and assert it is gone.
