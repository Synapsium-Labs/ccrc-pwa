# Session continuity wave 6a: eight departures from its plan, recorded

The plan, `2026-11-11-session-continuity-wave6a-graceful-stop-shadow.md`, defines D-8316 to D-8332. Wave 6a shipped in
#2687 (merged 2026-11-12 as `933f293f`). Its worker named departures by slug, and its three reviews (1838, 1841 and
1844) added to them. The coordinator allocated D-8346 to D-8353 on 2026-11-12 at 04:42 UTC, at acceptance, and defines
them here. Two of the worker's slugs were fixed in review and take no number: `gs-bound-pins-the-note-not-the-wait`
(fix rounds 1 and 2 pin the live wait's bound) and `graceful-stop-count-exit-no-final-poll` (fix round 2 polls once
more after the loop).

The live arm stands unarmed: nothing in the tree writes `$REG/graceful-stop-live`. So D-8350 and the live half of D-8351
describe a wait that no stop runs today. The shadow runs at every stop of the three sites, and D-8348's race and
D-8351's observer and `exited=` notes are the shadow's too.

- **D-8346 (2026-11-12)** — `spec-section12-codex-premise` (Task 4, the spec's rev 12): rev 12 also corrects §12's
  "the Codex lane's delegation (`not-applicable`)" by a dated note. It is the same false premise as §6's "(the Codex
  lane)" (the plan's COORDINATOR note 8), and it adds one item to D-8322's list of stale neighbours.
- **D-8347 (2026-11-12)** — `graceful-stop-poll-uses-sleep-not-the-seam` (Task 2): the plan lists `_pane_scope_sleep`
  among what the graceful stop consumes. Both poll loops, the live wait in `_graceful_stop_before` and the shadow
  observer `_graceful_stop_observe`, call bare `sleep`. The suites stub that seam to log rather than wait
  (`ccd-stop-pane-scope`), which would make these loops spin.
- **D-8348 (2026-11-12)** — `graceful-stop-same-exit-race` (Task 2; review 1838 F1, review 1841 N4): at the first
  handoff, a process that exited between `kill -0` and the read of its stat file had two outcomes:
  - it read `unmeasured=stat-unreadable` rather than gone, which fails safe;
  - `_ci_proc_start` aborted the shell under `set -u`, so the shadow observer died silently, and an armed wait would
    have aborted the stop between the unit stop and the kill.

  Fix round 1 removed both. `_ci_proc_start` initialises its read variable, and `_graceful_stop_same` re-checks
  `kill -0` after a failed read: gone answers rc 1, alive rc 2. One fail-safe race remains. If the pid is reaped
  between the first `kill -0` and the stat read, and reused before the second `kill -0`, the answer is rc 2
  (`unmeasured=stat-unreadable`), not rc 1. No path signals after rc 2.
- **D-8349 (2026-11-12)** — `graceful-stop-test-windows` (Task 2's tests; review 1838 F9): the plan sets
  `GRACEFUL_STOP_OBSERVE_S` and `GRACEFUL_STOP_TERM_WAIT_S` per case at 1 to 3 s, and asserts the live exit
  `300 <= N < 10000`. The suite departs in four ways:
  - its exit-expecting cases run at 5 s windows, and it asserts the live exit `< 5000`;
  - the ignore-TERM, frozen-clock, clock and zero-poll rows run `GRACEFUL_STOP_OBSERVE_S=8`, and all but the clock
    row assert a 3500 ms ceiling;
  - the four live-wait rows have a 60 s vitest timeout, for a loaded runner.

  No bound in `ccd/ccd` changed for them.
- **D-8350 (2026-11-12)** — `graceful-stop-tick-ms-grammar` (Task 2; review 1841 F2, review 1844 F5): the live wait
  takes its poll in milliseconds by slicing `GRACEFUL_STOP_POLL_S` as `0.<fraction>`. Fix round 2 made a poll that
  slices to 0 ms (`0`, empty, `0.0005`) fall back to 100 ms, tick and sleep together. Two cases remain:
  - a poll of 1 s or more mis-slices: `1` reads as 100 ms, `1.5` as 500 ms and `2` as 200 ms, and the clock still
    bounds the wait;
  - a non-numeric poll (`abc`, `-1`, `1e-1`) is an arithmetic error after the SIGTERM. Bash then abandons the whole
    verb, so there is no note, no wait, no kill and no respawn, and the session is left down, as review 1838 F1's abort
    would have left it. Review 1844 F5 said the caller continues; the coordinator's fact-check at acceptance measured
    otherwise, on bash 5.3.

  The constant is `0.1` in the file, and only the tests set it.
- **D-8351 (2026-11-12)** — `graceful-stop-stopped-clock` (Task 2; review 1844 F3 and F6, and the coordinator's own
  reading at acceptance): both loops are bounded by `_plat_epoch_ms`, the wall clock.
  - **The live wait.** Fix round 2 made a count of twice the nominal passes the backstop for a clock that stops or
    steps back. On such a clock the wait can run about twice `GRACEFUL_STOP_TERM_WAIT_S` (about 20 s) and note
    `alive=10000`, where §5.3 says "waits up to".
  - **The shadow observer.** It has no count backstop. If the clock steps back while the killed process lives on, it
    polls past `GRACEFUL_STOP_OBSERVE_S` until the process exits or the clock passes the bound. It runs in its own
    transient unit, so it holds up no stop.
  - **Every `exited=`.** On such a clock, any `exited=` the live wait or the shadow observer writes can read 0 or less.
    `deploy/measure-continuity.py`'s stage-3 parser counts a negative value in `malformed_lines`, and a zero in the
    percentiles. So this reaches the shadow's lines today, not only an armed wait.
- **D-8352 (2026-11-12)** — `graceful-stop-zero-poll-value-unpinned` (Task 2's tests; review 1844 F4): the zero-poll
  row pins that the fallback exists. It goes red without the fallback, and red with its tick half or its sleep half
  dropped. It does not pin the 100 ms value: a 10 ms or a 500 ms fallback stays green, because the clock bounds the
  wait. The value changes only the load and the resolution of `exited=`.
- **D-8353 (2026-11-12)** — `stage3-raises-on-an-unreadable-swap-log` (Task 3; review 1838 F4):
  `deploy/measure-continuity.py --stage 3` catches only a missing swap.log. A permission error, or a directory at that
  path, raises a traceback instead of reading as unmeasured. Stages 4 and 7 and the carry section behave the same way.
  So the fix is carried to a later instrument change, for all four together.
