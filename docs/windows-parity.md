# ccrc on Windows: where it differed from Linux, and what closed each difference

Measured on a Windows 11 box running the port (`feat/windows-port`), `CCRC_FLEET=local`, MSYS2 runtime, the `win/`
supervisor in place of `systemd --user`. Each row: what a user gets on Linux, what Windows did, the fix, and what proves
it (a test that goes red without the fix, unless said otherwise; LIVE = re-measured on the box after the fix).

## Root causes (most rows are one of these)

1. **`CCD_OS` reads `linux` on MSYS2**, so every Linux branch ran on Windows.
2. **Two kinds of process.** Claude Code, node and Windows git are native Win32 programs: Windows pids, no cwd in
   `/proc`, no catchable signals, no process groups. bash, tmux, flock are MSYS.
3. **Two shells.** Claude Code ran hooks under Git Bash, a second MSYS runtime.
4. **Two spellings of one path.** ccd and the registry speak `/c/Users/...`; native node opens only `C:/...`;
   Claude Code reports `C:\...`. MSYS converts argv and env, never a path inside code or a file.
5. **The supervisor was a partial systemd.**
6. **No cgroups, no PSI, a `/tmp` that survives a reboot.**

## Closed

| # | Linux | Windows before | Fix | Proof |
|---|---|---|---|---|
| A0 | A process using a tree keeps it from removal (temp sweep, ws-reclaim, ws-expire, ws-collect, ws-orphan) | A native process (Claude Code, the node and git it starts) using a tree was invisible: `/proc` has no cwd for them | `_ws_win_native_users` (ccd) reads native processes' current directories from their PEB and merges them into `_ws_path_users_many` and `_ws_cwd_users`; a probe that cannot finish answers unmeasured | `ccd-win-native-users.test.ts` (a native grandchild invisible to /proc makes a tree `held`) |
| A1 | The session hook writes `<id>.hookstate.json` and `<id>.turn.json` | It ran under Git Bash, where MSYS2's tmux lost `$TMUX`, `jq` was a native WinGet build and path-like arguments were rewritten: it exited 0 and wrote nothing | Sessions spawn with `CLAUDE_CODE_GIT_BASH_PATH` = MSYS2's bash (`_pane_shell_env`), a child's shell pin is that bash, the tmux lookup passes `-S` from `$TMUX` on Windows | Claude Code 2.1.306 ran a probe hook under `/usr/bin/bash` with `/usr/bin/jq`; `ccd-win-spawn-env.test.ts` |
| A2 | `ccrc.service` loads `ccrc.env` and the exposure file | Ignored: the sign-in gate (`CCRC_AUTH`) could not be armed | The supervisor reads `EnvironmentFile=`/`Environment=` and drop-ins; a unit's POSIX `PATH=` is spelled for Windows and put first | `win-supervisor.test.ts`; LIVE (`CCRC_ROLE is absent` gone; `ccrc-models` exits 0) |
| A3 | Account sign-in in the browser | Refused `no-user-manager`; `systemd-run -p K=V` ran `K=V` as the command | `show-environment`; `systemd-run --unit` makes a transient unit in the supervisor (`-p` pairs, `RuntimeMaxSec`, `StandardOutput`, `--setenv`); `is-active`/`stop` answer for it | `win-supervisor.test.ts`; LIVE (`_svc_have_user_manager` yes) |
| A4 | Scope sweep | Exit 1 every minute (no `XDG_RUNTIME_DIR`) | The supervisor sets `XDG_RUNTIME_DIR` (MSYS `/run/user/<uid>`, emptied on the first start after a boot) | LIVE (exit 0) |
| A5 | Conflict radar | Exit 1 every 5 min (no `signal.pthread_sigmask` in MSYS2's python) | A no-op mask where it is missing | `win-timer-sweeps.test.ts`; LIVE (exit 0) |
| A6 | Usage accounting | Exit 1 every run (`node -e` importing a `/c/...` path) | The path as an argument, imported by file URL | `win-timer-sweeps.test.ts` |
| A7, A8 | Archive checks the worktree; the projects list hides linked worktrees | Every archive refused `worktreeGone`; a session's worktree listed as the project | `nativePath` at `localIO`'s edge (either separator); the projects root joined with `/` | `io-native-path.test.ts`; LIVE (`/api/projects` names `/c/.../projects/ccrc-pwa`) |
| A9 | Approval guard hard-denies sensitive paths | `C:\...\.cc-sessions\x` fell to an operator prompt; a `C:\` home gave a child no roots | Paths judged in MSYS spelling; a command's drive-letter paths too | `approvalguard.test.ts` (Windows block) |
| A10 | A bounded child's timeout ends its group | ESRCH read as "gone": a hung child outlived its timeout | `winKillTree` (`taskkill /T /F`) | `win-tree-kill.test.ts` |
| A11 | `kill -0` on Claude Code's pid keeps a live worker | Windows pids unknown to MSYS: every live worker read dead | `_plat_alive` (Windows pid aware); `_plat_pstart` reads a Windows pid's creation time as the FILETIME Claude Code records in `procStart`, so a recycled pid reads dead as on Linux | `win-parity-bash.test.ts` |
| A12 | Process ancestry via `ps -o` | No `-o` in MSYS `ps`: admin merge always refused, a nested `ccrc test` waited on itself | `_plat_lineage` (MSYS parents, then Windows parents) | `win-parity-bash.test.ts` |
| A13 | Tool commands get a higher `oom_score_adj` | Prefix set with nothing to raise; likely broke stdio MCP servers | No prefix without `/proc/self/oom_score_adj` | `ccd-win-spawn-env.test.ts` |
| B1 | Console tick well inside its interval | 6.1 s a tick: every tmux call waited 2 s on a dead socket that survived the reboot | The first start after a boot removes tmux sockets no server answers | `win-supervisor.test.ts`; LIVE (p50 ~100 ms, 0 overruns) |
| B2 | Memory pressure feeds the wake gate | No reading at all | A reading without PSI carries the free memory; the headroom floor applies | `pressure-no-psi.test.ts` |
| B4, B5 | A failed or hung oneshot is `failed`, and a hung one is stopped | Every exit `inactive`; a hung run stopped its timer for good | Exit code maps to `failed`; `TimeoutStartSec=` | `win-supervisor.test.ts`; LIVE (`--state=failed` empty) |
| B7 | A clean stop seals the dead-coordinator breaker | SIGTERM is TerminateProcess: never sealed | IPC `shutdown` from the supervisor, 6 s bound; a restart waits for the old exit; a stale exit no longer restarts the new server | `win-supervisor.test.ts`; LIVE (`breaker's state is sealed` on restart) |
| B8 | Live state by pane pid | A pid collision across number spaces showed another session | Fast path checks the session uuid (Windows) | `livestate-pid-collision.test.ts` |
| B9 | No-follow opens | `O_NOFOLLOW` was 0: refusal gone | `shared/nofollow.mjs` (lstat, then dev/ino) | `win-nofollow.test.ts` |
| B10 | Private-file mode checks | Every file read 0666: noise and a sweep that never ran | Mode parts skipped on Windows; token files get an owner-only ACL | `win-modes.test.ts`, `token-files.test.ts`; LIVE (box-token PASS) |
| B11 | Disk block | `/tmp` mis-resolved | `os.tmpdir()`, drive roots | `disk-win.test.ts` |
| B12 | Claude Code temp budget, child temp roots | Sweep root absent; TMPDIR ignored by native node | Root `<TEMP>/claude`; TEMP/TMP exported beside TMPDIR | `win-timer-sweeps.test.ts`, `win-parity-bash.test.ts` |
| B13 | Graceful stop lets Claude Code save | SIGTERM is a hard kill | `/exit` typed into an empty input first | `win-parity-bash.test.ts` |
| S1-S13 | systemd semantics | Missing | ExecCondition, OnCalendar (`*:0/N`, hourly, daily), `Persistent=` catch-up, template timers, StartLimit from the unit, journalctl `--since`/`-g`/`-f`, `list-units --state`, multi `-p`, NRestarts | `win-supervisor.test.ts` |
| S7 | `ccrc-agent.service` (a box as the fleet half) | Refused (409) | A `Type=simple` unit whose ExecStart is node is spawned as node, with its EnvironmentFile and Restart=always | `win-supervisor.test.ts` |
| C1 | OS word | `linux` | `windows` in doctor, install and `ccrc-caps` (the server reads it) | `win-parity-bash.test.ts`, `update-inventory.test.ts`; LIVE |
| C3-C5 | | Slice drop-in split by a backslash; dev tool and test box arm broken | Skipped or refused with a sentence | tests beside each |

## What stays different (the platform has no equivalent)

- **Containment.** No cgroups: no memory caps per pane, for the test slice or the graph build, no OOM victim choice.
  Runs are uncontained and doctor says so. A Windows Job Object caps a whole process TREE, and that is why it is NOT
  used for the units' `MemoryMax=`: the fleet's one tmux server is born of whichever process first asks for a session,
  and `ccd-limit-watchdog` and `ccd-telemetry-keepalive` start sessions, so a job on either would put every pane of the
  fleet under that sweep's 256M or 2G cap, and a pane's allocation failure would take the shared server down. Linux
  avoids this with a scope per pane; nothing in bash can move a process out of a Windows job.
- **Pressure.** Free memory only; no stall-time PSI, no IO pressure.

## Speed: the cost of starting a process

ccd and ccrc are bash, and bash starts a process for every `$(...)`, `awk` and helper. On Linux that costs about a
millisecond. On the measured box it cost about 280 ms per program start (`/usr/bin/true` 50 times: 14 s) and 120 ms per
command substitution, with Windows Defender real-time protection on; Cygwin's usual figure is 10-30 ms. Every verb pays
it: `ccd caps` 0.7 s, and `ccrc settings --write` 113-148 s, past its own `TimeoutStartSec=120`, so the settings timer
was stopped as hung on some runs and `box-settings.json` went stale. Two remedies:

- **The box (the operator, as administrator):** a Defender exclusion for `C:\msys64` (or for its `bash.exe`, `awk`,
  `jq`, `tmux`, `python3` processes) and for the ccrc trees (`~/ccrc-versions`, `~/.local`), the usual setting for any
  Cygwin/MSYS2 workload. Not a change this port makes: it is a security setting.
- **The code:** fewer process starts on the hot paths. The largest single one measured is `_ccrc_knob` (27 s of the 146):
  it scans `ccrc.env` with one `awk` per key, plus a NUL check and a systemd-model parse, two or three processes per key
  over seventy keys; one scan of the file per run would remove most of it.

## Not measured

- A live Claude Code session end to end (the box's account has no credential): A1 in a real session, A11, A13's MCP
  consequence, B12 and B13 against a real Claude Code.
- Linux: every change is gated to Windows or identical there by construction, and the suites that guard Linux
  behaviour (contexts census, platform block, spawn census, tmux socket census) pass here; the full Linux suite runs in CI.
