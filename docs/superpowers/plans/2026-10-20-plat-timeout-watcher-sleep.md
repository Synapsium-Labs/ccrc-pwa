# The pure-bash timeout watcher's sleep outlives the call

**Size:** S. **Deploy class:** `ccd/` (one line in each of four byte copies) plus one server test file; no `agent/`, `pwa/` or wire change. One task.

## Problem

`_plat_timeout` (and its byte copies `_rt_timeout` in `ccd/ccgpt-runtime`, `_auth_timeout` in `ccd/ccd-account-auth`, and the copy in `ccd/ccrc`) has a pure-bash arm for a box with no coreutils `timeout`. That arm starts a watcher subshell, `( sleep "$secs" … || exit 0; printf 1 > "$stamp"; kill -TERM "$pid" ) &`, and TERMs it when the watched command answers first. The watcher subshell dies in its foreground `sleep` and leaves the sleep running, reparented, for the rest of `$secs`. The same bash behaviour D-6113 fixed in `_swap_beat` applies here. The watcher's output goes to `/dev/null`, so nothing waits on the orphan. On a box without `timeout`, though, every answered call leaves one `sleep` behind. The server suite's orphan check (D-3533) caught it in `ccrc-models-lock.test.ts`, where the capture sites run with `timeout` removed from `PATH`.

## Task 1: the watcher takes its sleep with it (D-6123)

**Files:** `ccd/ccd`, `ccd/ccrc`, `ccd/ccd-account-auth`, `ccd/ccgpt-runtime` (the watcher line of `_plat_timeout`, `_rt_timeout` and `_auth_timeout`, kept byte-identical across the copies and line-count neutral, so anchored citations do not move), and `server/test/ccrc-models-lock.test.ts`.

**Steps:**

1. Red: the case 'with no coreutils timeout, the watcher takes its own sleep with it: nothing outlives a call that answered (D-3533's orphan check)'. It runs `_plat_timeout 37 command sleep 0.3` with `timeout` and `gtimeout` removed from `PATH`, then counts `sleep 37` processes. On `origin/main` it fails with `left=1`.
2. Fix: the watcher runs `sleep "$secs" & s=$!; wait "$s" || exit 0` behind `trap '[ -n "$s" ] && kill "$s"; exit 0' TERM`. A trapped TERM interrupts `wait`, where it cannot interrupt a foreground child, and the trap ends the sleep. A watcher whose sleep runs out still stamps and TERMs the watched command, exactly as before.
3. Nothing else changes. The coreutils arm, the stamp file, the exit code mapping and the call sites are untouched. ccd's provenance marker is re-stamped.

**Verify:** `ccd-plat-timeout`, `ccrc-models-lock`, `ownership`, `ccd-account-auth`, `ccd-bounded-reads`, `ccd-contexts`, `citations` and `ccrc-account` (578 pass, 31 skipped). The new case is red on `origin/main` (`left=1`) and green with the fix.

**Routing:** native. **Needs:** nothing. **Gates:** none.

## Deviations and decisions

### Issued for this work and defined here

- **D-6123** — `plat-timeout-watcher-sleep-reaped`: the pure-bash watcher in `_plat_timeout` and its byte copies sleeps in the background and waits on it, behind a TERM trap that kills the sleep. A call that answers before its timeout therefore leaves no orphaned `sleep` for the run's orphan check (D-3533) to find. This is the same shape D-6113 fixed in `_swap_beat`.
