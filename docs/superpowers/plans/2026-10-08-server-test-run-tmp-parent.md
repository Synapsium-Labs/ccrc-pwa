# #316: one owned temp parent per server test run, collected even when the run is killed. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** Today a server `vitest` run killed by `timeout`, Ctrl-C, a tmux hangup or the OOM killer leaks every fixture directory its workers made, plus vitest's own transform cache. After this plan:

- Every run puts all of its temp writes under one directory, `$TMPDIR/ccrc-testrun-XXXXXX/tmp/`.
- The run removes that directory at the end, and also on SIGTERM, SIGINT, SIGHUP and `exit`.
- A run killed outright (SIGKILL) is collected by the next run under the same `TMPDIR`.

**Architecture.**

- One new plain-JS module, `server/test/run-tmp.globalsetup.mjs`, imports only `node:` builtins. It holds every name and number, and these functions:
  - `condemn`, `probeRun`, `reapRuns`, `openRun`, `armSignals`;
  - the default-export `setup`.
- `vitest.config.ts` wires it as `globalSetup`, which runs in vitest's MAIN process.
- The workers inherit the redirected `TMPDIR` when they fork.
- Liveness is an owner unix socket, not a pid.
- `tmpHelpers.ts` changes in comments only. Its `afterAll` and R20a still bound the peak disk use inside a run.

**Synthesised from** two competing designs: A (a per-run parent with socket liveness) and B (per-worker registries). **The base mechanism is A's**, for four reasons:

- It covers every writer that honours `TMPDIR`: `mkTmp`, the roughly 16 files and 37 sites that call `mkdtempSync(tmpdir())` raw, and the `ccd`, `git` and `bash` children.
- Cleanup is one `rm`.
- It is the issue's own proposal 1.
- It is the agent package's shipped precedent (`agent/test/contain-path.globalsetup.ts`).

B's design is rejected. It covers `mkTmp` alone. It runs `rm -rf` on paths read from files, which needs six guards. It needs pid-namespace handling.

**Grafted from B:**

- SIGHUP in the arm (measured: without it a HUP leaks every time).
- The mutation table's run-N-times treatment of racy mutants.
- (Removing vitest's own `TestProject.tmpDir` was B's too; it is the dropped Task 5, now a follow-up.)

**Fixed from A:**

- A socket that connects is authoritative `live`, even when `owner.json` is missing.
- The not-a-socket case asserts the exact verdict string, so it is red on macOS too, not only on Linux.
- An `exit` listener is added, which covers a crash of the main process.
- The reaper also runs at teardown.
- T5 derives `globalSetup` from the real config, as in the agent precedent `agent/test/contain-path.test.ts`.
- Inserts go below every line that something cites.

**Tech stack.** Node `net` unix sockets and `fs`; vitest 4.1.10 `globalSetup`; bash-free tests (bare `node` children plus a nested real vitest).

**Issue.** Synapsium-Labs/ccrc-pwa#316: proposal 1, with the departures below. Proposal 2 is superseded. Proposal 3 (a sweeper) is a follow-up issue.

---

## Design summary

### 1. What was read (origin/main `852c0451`, re-measured at `669b8305`)

**Code read in the repository:**

- `server/test/tmpHelpers.ts`:
  - the header paragraph on why there is no prefix sweep;
  - `mkTmp` (`:38-52`), a range `ccrc-account.test.ts` cites;
  - the end-of-file and per-test cleanup (R20a).
- `server/vitest.config.ts`: no `globalSetup`. `:87` and `:92` are cited by the CI spec and `ccrc-account.test.ts`.
- `vitest.select.config.ts`: `mergeConfig` concatenates arrays, so a base `globalSetup` reaches CI.
- `tmpfixtures.test.ts`.
- `shared/lifecycle.ts` and its manifest describe in `lifecycle.test.ts`.
- `agent/vitest.config.ts`, `agent/test/contain-path.globalsetup.ts`, and `agent/test/contain-path.test.ts`.
- `.github/ci/select-tests.mjs`: a `vitest.*config.*` change runs the full suite, and main-process reads join the baseline.
- `ccd-entry-install.test.ts`: the shebang has a 127-byte limit, and its path sits under `mkTmp`.
- `session-hook.test.ts`: scratch-slug rules keyed on the `os.tmpdir()` prefix.
- `delegation-rig.test.ts`: a short `/tmp` base for `sun_path`.
- `ccrc-uninstall.test.ts`: the D-3533 pin that the config wires no `globalSetup` (see D-4499's amendment).

**vitest dist** (`chunks/cli-api.*.js`, 4.1.10):

- `addCleanupListeners`: `process.once('SIGINT'|'SIGTERM')`, then `setTimeout(process.exit, 1)`. There is no SIGHUP handler.
- The worker env is built from `process.env` at scheduling.
- `_initializeGlobalSetup`: `setup(project)` is passed the `TestProject`.
- `TestProject.tmpDir`: public, documented in `reporters.d.*.d.ts`.

**Specs and the issue:**

- The artifact-lifecycle policy (`2026-08-11-artifact-lifecycle-policy.md`) §2, pattern **E**.
- The child-reclamation spec §5.2.
- #316 and its one comment.

### 2. Root cause

Only hooks inside the worker processes ever remove fixtures, and nothing that outlives a killed worker owns them. Moving cleanup to the main process is not enough on its own.

**Measured on a Mac:**

- **Teardown alone.** `globalSetup` teardown never runs on a signal. Under `timeout 4 vitest run`, 6 of 6 runs leaked.
- **Teardown plus an `exit` hook.** 5 of 6 runs leaked. GNU `timeout` signals its child and then the child's process group. vitest's main process gets SIGTERM twice, and its `once` listener is gone by the second delivery, so the default action kills the process before the 1 ms exit timer fires.
- **SIGHUP.** vitest installs no handler, so a SIGHUP kills main outright: 2 of 2 runs leaked.
- **Persistent listeners in main.** 6 of 6 runs under `timeout` were clean, and so were 3 runs each of double SIGTERM, SIGTERM to main only, SIGINT to the group and SIGHUP to the group. The exit codes were 143, 130 and 129.

**Real baseline.** `timeout 25 vitest run test/ccrc-doctor.test.ts` under a scratch `TMPDIR` left behind (re-measured at Task 0):

- 10 `ccrc-*` fixture dirs;
- vitest's own `<nanoid>` transform dir, **5.6 MB**;
- 15 MB in all, from 25 seconds of one file, rc 124.

### 3. The mechanism

**Layout:** `<base>/ccrc-testrun-XXXXXX/{live.sock, owner.json, tmp/}`.

- `base = realpath(os.tmpdir())`, read in main.
- The workers' `TMPDIR` is `…/tmp`, so nothing a test does writes beside the socket.

**`setup()`:**

1. Reap `base`.
2. `openRun`: `mkdtemp`, then `mkdir tmp`, then `listen(live.sock)` and `unref`, then write `owner.json` (`wx`, 0600; pid, host and start time, for diagnosis only).
3. Set `TMPDIR` and `CCRC_TEST_RUN_DIR`.
4. Arm SIGTERM, SIGINT, SIGHUP and `exit`, persistently. Each one condemns the run dir, sets `exitCode ??= 128+n`, and calls `setTimeout(process.exit, 1)`.

**Teardown:** disarm, restore `TMPDIR`, condemn, close the server, then reap `base` again. A condemn that answers `left:` warns and drops `owner.json`, so a run whose rename failed reads `unowned` and is collected once quiet; one that answers `gone` warns that another actor removed the live run (review fixes, below).

**`condemn(dir)`:**

- First `rename → dir.dead`. The rename is atomic and only one actor wins it; ENOENT returns `'gone'`.
- Then `rm` with `maxRetries: 3`. An interrupted `rm` leaves a `.dead` dir, which any later reaper removes without probing.
- It returns `'removed' | 'gone' | 'left:<code>'` and never throws.

**`probeRun(dir)`** returns one of six results, kept distinct:

| `live.sock` | connect | `owner.json` | verdict |
|---|---|---|---|
| socket | connects | any | `live` |
| socket | ECONNREFUSED | present | `dead` |
| socket | ECONNREFUSED | absent | `unowned` |
| absent | – | absent | `unowned` |
| absent | – | present | `unmeasurable:ENOENT` |
| not a socket | – | any | `unmeasurable:not-a-socket` |
| socket | any other error, or a 2 s timeout | any | `unmeasurable:<code>` |

All of these were measured:

- A SIGSTOPped owner still connects — while its listen queue has room. Past it, macOS answers ECONNREFUSED (`dead`) and Linux EAGAIN (`unmeasurable:EAGAIN`): the known limitation in `## Risk notes`, found in review.
- A SIGKILLed owner whose forked IPC child is still alive gives ECONNREFUSED, because the workers do not inherit the listening fd.
- On Linux a regular file gives ECONNREFUSED; on macOS it gives ENOTSOCK. Hence the `lstat` check comes first.
- The `sun_path` limit is 104 bytes on macOS and 108 on Linux (each measured at the boundary). Beyond it Node 24+ fails `listen` and `connect` with EINVAL, but **Node 22 and Node 20 silently truncate** the path and bind or connect at the shorter name (measured on Linux, 22.23.3 and 20.20.2; found at Task 7, see D-4497's amendment). So the module checks the byte length itself before either call, and answers EINVAL on every Node.
- In Docker, the socket answers identically through a bind-mount spelling and a whole-volume spelling of one directory.

**`reapRuns(base, {now, uid, quietS})`:**

1. Look only at names matching `^ccrc-testrun-[A-Za-z0-9]{6}(\.dead)?$`. The anchors matter: `mkTmp('ccrc-run-signals-')` already exists in the suite.
2. Each entry must `lstat` as a real directory owned by `uid`.
3. Remove `.dead` dirs without probing.
4. Condemn a `dead` or `unowned` dir only when it is **quiet**: `now − max(ctime(run), ctime(run/tmp)) ≥ quietS`, with `quietS` = 600 by default.
5. Wrap each entry in `try`/`catch`, so the reaper never throws out of setup. An entry another actor removed between the listing and its `lstat` is `gone`, not an error (review fix).

ctime is used because nothing can rewind it, and only top-level entries move it (both measured). The gate protects orphan workers, which outlive a killed main process and keep working; they were measured alive 12 s after main died.

**Refusal.** If `realpath`, `mkdtemp`, `listen` or the `owner.json` write fails:

- remove what was made;
- leave `TMPDIR` alone;
- delete any inherited `CCRC_TEST_RUN_DIR`;
- set `CCRC_TEST_RUN_REFUSED=<code>`;
- print `ccrc-test: per-run temp dir refused (<code>) …`.

This is the status quo, made loud. It mirrors the reclamation spec: "a temp root that cannot be made private is not used".

The envelope is a base of at most 74 characters on macOS and 78 on Linux. Measured bases:

| Base | Length (chars) |
|---|---|
| macOS default (`/private/var/folders/<x>/<y>/T`) | 56 |
| a child's `~/.cc-tmp/<id>` | about 45–55 |
| CI | 4 |

### 4. Red-first tests

All the tests are in `server/test/run-tmp.test.ts`, plus one case in `lifecycle.test.ts`.

| Group | What it runs | What it proves |
|---|---|---|
| T1 | in-process | the wiring |
| T2 | bare `node` owners | the verdicts |
| T3 | `reapRuns` with injected `now` and `uid` | the reaper's rules |
| T4 | bare `node` with the arm | the signal arm |
| T5 | nested real vitest | the system end to end |
| T6 (review) | `setup()` in a bare `node` child | teardown's warnings and its failed-rename path, the refusal env, the quiet-window parse |

The plan below gives each case and the condition that makes it red. Several conditions cannot be produced on a test box, so the tests simulate them:

- **GNU `timeout`'s double delivery:** `kill(pid)` followed by `kill(-pid)` on a detached child. There is no coreutils dependency.
- **A bind mount:**
  - a symlinked base, on every platform;
  - the `/System/Volumes/Data` firmlink on macOS (same dev and ino, which `realpath` does not unify);
  - `unshare -Urm` with `mount --bind` on Linux, skipped by name where unprivileged user namespaces are refused.
- **The `sun_path` overflow:** a 90-character path component.

### 5. Edge cases, macOS and back-compat

**Concurrency:**

- Concurrent runs in one base see each other as `live`.
- Two reapers race on the rename, and the loser gets `'gone'`.
- A run still being created is `unowned` but fresh, so it is left.

**What runs, by how the run ends:**

| How the run ends | What collects it |
|---|---|
| a normal end, pass or fail | teardown |
| SIGTERM, SIGINT, SIGHUP (including GNU `timeout`'s double delivery) | the signal arm |
| a crash of main | the `exit` listener |
| SIGKILL, OOM, power loss | the next run's setup or teardown, after 10 minutes |
| `timeout -k` in the middle of the arm's `rm` | it leaves `.dead`, which the next run removes |

**macOS:**

- No `/proc` is needed.
- The firmlink case runs there.
- A template-less BSD `mktemp` in a child still ignores `TMPDIR`, as it does today.

**Back-compat:**

- Loose `ccrc-*` dirs from before this change are never touched.
- Tests that set their own `TMPDIR` are unaffected.
- Every fixture path grows by 24 characters. The candidates this could break are:
  - the shebang in `ccd-entry-install`: about 80 bytes becomes about 104 on macOS, against a limit of 127;
  - the scratch-slug rules in `session-hook`: the base prefix is unchanged;
  - any unix socket a test binds under a `mkTmp` path on macOS.

  The full-suite gate is the arbiter (Task 7).

### 6. Conventions

- **Single definition.** Every name and number lives once, in the `.mjs`, and the tests import it. The `RUN_NAME_RE` regex is built from `RUN_PREFIX` and `DEAD_SUFFIX`.
- **The one textual second copy** is the `LIFECYCLE` root string, which L0 cannot import. The new `lifecycle.test.ts` case pins it with `toContain(RUN_PREFIX)`. The row's collector names the quiet window as `RUN_QUIET_S` instead of copying its number, and the case pins that too (review fix; the README's "ten minutes" is reader prose and unpinned).
- **D-N:** four numbers, below.
- **Docs:** the README's `npm test` paragraph, `CLAUDE.md`'s fixture-HOMEs bullet, CONTRIBUTING's "Tests are hermetic", the `tmpHelpers.ts` header and the `vitest.config.ts` comment.

### 7. Risks; out of scope

**Risks (see `## Risk notes`):**

- The arm deletes the run dir under workers that may still be running.
- Every path is 24 characters longer.
- The run depends on vitest internals.
- The first run after a SIGKILL pays a synchronous `rm`.
- The quiet gate is a heuristic.

**Out of scope (follow-ups):**

- **Proposal 3, the sweeper** — a follow-up issue. It is still needed for:
  - dirs leaked before this change, which no run ever touches;
  - `TMPDIR`s that no later run visits;
  - children with a minimal env;
  - a SIGKILLed run's vitest `tmpDir`.
- **The dropped Task 5:** vitest's own `TestProject.tmpDir` in the arm (see below).
- #172, the orphan processes.
- The `agent`, `pwa` and `e2e` suites.

---

## Operator rulings on the draft's open questions (2026-10-08)

1. **Lifecycle and the reclamation spec's §5.2.** The run parent can live inside a child's `~/.cc-tmp/<id>`, which ws-reclaim collects whole. **No spec ruling is needed:** a run removes only names this suite's runs create (`ccrc-testrun-XXXXXX`, matched by an anchored expression, and its `.dead` twin), on the `graph-corpus-filter` precedent, and ws-reclaim still owns the leaf.
2. **The quiet window.** 600 s is accepted. Orphan workers were measured alive 12 s after main died.
3. **Long `TMPDIR`s.** Refusal keeps today's behaviour and prints a warning, as planned; T1 is red there. The degraded mode (a parent with no liveness) is not taken.
4. **Task 5** (vitest's own `tmpDir` in the arm) is **dropped** and becomes a follow-up. It touches vitest's own directory; it would save 5.6 MB per killed run.
5. **Existing stock.** Pre-existing leaked dirs are out of scope. Proposal 3, the sweeper, becomes a follow-up issue.

## Global Constraints

- **Base.** Draft from `origin/main` `852c0451`; executed on `669b8305`. In Step 1 of each task, re-measure the anchors with `grep -nF`. If an anchor is missing or not unique, stop and report.
- **Running tests:**
  - **On macOS:** `cd server && PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/vitest run test/<file> --maxWorkers=1`.
  - **On Linux:** the same command without the `PATH` prefix.
  - Never bare `npx vitest`.
- **Do not shift cited lines.** Make every insert BELOW the cited lines:
  - `vitest.config.ts`: after `:92`;
  - `tmpHelpers.ts`: after `:52`, just above `afterAll`;
  - `shared/lifecycle.ts`: append the row;
  - `lifecycle.test.ts`: append inside the manifest describe.

  After every task that edits `README.md`, `CLAUDE.md`, `tmpHelpers.ts` or `vitest.config.ts`, run the five citation cases:
  ```bash
  ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND'
  ```
- **Hermetic.**
  - Fixture roots go under `mkTmp`.
  - A socket base goes under `/tmp/ccrc-rt-XXXXXX` (from `mkdtempSync('/tmp/ccrc-rt-')`), because `mkTmp` paths are too long for `sun_path` on macOS. It is removed after the test, as in delegation-rig.
  - Never signal a pid that is not ours.
  - `killGroup(pid)` refuses unless `Number.isInteger(pid) && pid > 1`, and is only ever called on a child spawned `detached: true`.
- **Mutation-table discipline.** Measure every row at the task's own source stage. Use `cp` and `cmp` around each edit, and restore before committing. Run a racy row 10× and report its red count.
- **Real values never go in the repo.** No fleet paths, hostnames or numbers other than the issue's published measurements.

## Review Focus

1. **The reaper never deletes a live run.** A connecting socket is `live` whatever else is true. A verdict of `unmeasurable` is never acted on. Only `dead` or `unowned` that are also quiet are condemned (T2, T3; T3m pins the filter). The one exception is the known limitation in `## Risk notes`: a whole run stopped for long enough on macOS.
2. **The reaper cannot be steered out of its directory.** It checks the name regex, `lstat` (never `stat`), the uid, and that the entry is a direct child of `base`. A symlink named like a run, and its target, both survive (T3f).
3. **The signal arm is persistent and always exits.** A second SIGTERM cannot kill main in the middle of an `rm`. The exit codes are 143, 130 and 129. After teardown it is disarmed (T4).
4. **Refusal is loud and complete.** The run keeps the status quo `TMPDIR`, has no run-dir env, prints its stderr line, and T1 is red (T5f, T1).
5. **The cleanup never throws.** Neither `condemn` nor `reapRuns` can fail the run (T3j, T3l).

## Risk notes

- **Deleting under orphan workers.** The arm deletes at once. Under a signal to main only, a worker blocked in `spawnSync` wakes up and finds its fixtures gone. A child that recreates a `HOME` path makes an `unowned` dir, which the quiet gate later collects. This is the same class of hazard as `afterAll` versus lingering children (#172).
- **Path growth of 24 characters.** Task 7's full suite is the gate. If a test breaks only because of length, fix it at its own site with a short root (the `ccd-entry-install` precedent). Never shorten the prefix to cover it.
- **The `TMPDIR` envelope.** A base longer than about 74 characters (macOS) or 78 (Linux) refuses. The refusal is loud, and T1 is red there (ruling 3).
- **vitest internals.** The plan relies on three of them:
  - `globalSetup` runs in main;
  - workers inherit the env at fork;
  - the `once` signal listeners.

  T1 and T5 go red on an upgrade that changes any of them.
- **Known limitation: a long-paused run on macOS (found in review; D-4499's amendment).** A stopped owner never accepts, and each probe's connection stays in its listen queue after the prober hangs up. Measured with an owner listening on a unix socket and SIGSTOPped, probed by connect-then-destroy as `tryConnect` does:
  - **macOS** (Node 26.5.0, `kern.ipc.somaxconn` 128): probes 1–128 connect; from 129 on, ECONNREFUSED, which `probeRun` reads as `dead` beside `owner.json`.
  - **Linux** (Docker `node:22-bookworm`, Node 22.23.3; `somaxconn` 4096, Node's backlog 511): probes 1–512 connect; from 513 on, EAGAIN, which is `unmeasurable:EAGAIN` and never acted on. Safe.

  Every run probes every run in its base twice (setup and teardown), so on macOS about 64 later runs under one `TMPDIR` while a whole run is stopped (Ctrl-Z, a debugger pause; a mutation sweep makes that many) read it `dead`. Nothing in a stopped run writes, so it is also quiet, and it is condemned. When it resumes its fixtures are gone; its teardown's `condemn` then answers `gone`, and teardown WARNS (T6a). Recorded, not fixed: a pid veto (keep a `dead` run whose `owner.json` host matches and whose pid is present) is not taken, because a pid answers differently per namespace and is reused, which is why liveness is a socket (D-4499).
- **Latency.** The first run after a SIGKILL pays a synchronous `rm`, reported on stderr. An `rm` that cannot finish (EACCES) leaves `.dead` and warns every run. It never fails the run: a raw-`mkdtemp` test that leaves a 0500 dir must not turn a green suite red.

## Deviations found

Four numbers, issued by the allocator for this plan's four departures from #316's proposal 1. The draft's fifth slug belonged to the dropped Task 5 and was never issued.

- **D-4496** — *The reaper condemns a dead or unowned run only after 600 s with no top-level change to the run dir or its `tmp/`, measured by ctime. It runs at both setup and teardown.*
  - **Proposed:** at startup, a dead pid is enough.
  - **Why:** orphan workers outlive their main process (measured alive 12 s after main died), and a reaper that acted on "main is dead" alone would delete fixtures from under them. ctime is used because nothing can rewind it. Reaping at teardown too means a run that started while a dead run was still fresh collects it on its way out.
  - **Tunable for tests only:** `CCRC_TEST_RUN_QUIET_S` (a whole number of seconds; anything else is ignored with a warning).
- **D-4497** — *If the socket cannot be bound (a `TMPDIR` too long for `sun_path`, or a sandbox), or the parent cannot be made, the run keeps today's behaviour, says so on stderr, and T1 is red.*
  - **Proposed:** nothing.
  - **Precedent:** the reclamation spec's "a temp root that cannot be made private is not used".
  - **Shape:** `TMPDIR` is left alone, an inherited `CCRC_TEST_RUN_DIR` is deleted, `CCRC_TEST_RUN_REFUSED=<code>` is set, and one `ccrc-test: per-run temp dir refused (<code>) under <base>; fixtures go loose in TMPDIR as before` line is printed. Ruled on 2026-10-08 (ruling 3) over a degraded mode.
  - **Amendment (Task 7): the length is checked here, not left to `listen`.** The draft relied on `listen` failing EINVAL past `sun_path`, measured on Node 26 (macOS) and Node 24 (Linux). Run on Linux under Node 22.23.3 — the version CI runs — T2i, T2j and T5f were red: `listen` SUCCEEDED on an overlong path, and a probe through an overlong spelling answered ENOENT. Node 22 and 20 truncate the path to `sun_path` and bind or connect at the shorter name (measured at the boundary: 108 bytes binds at its full path, 109 binds elsewhere; Node 24 refuses 109). Left alone, a long `TMPDIR` would bind a socket at a path nobody named and run on with a liveness no other spelling can reach. So `openRun` refuses with EINVAL when `live.sock`'s path is longer than `RUN_SUN_PATH_MAX` (108 on Linux, 104 elsewhere), before `listen`, through the same refusal that removes what was made; and `probeRun` answers `unmeasurable:EINVAL` without connecting. T2k pins the envelope at the platform's own limit.
- **D-4498** — *Persistent SIGTERM, SIGINT and SIGHUP listeners, plus an `exit` listener, in vitest's main process remove the run dir, then exit with 128+n.*
  - **Proposed:** "removes it in teardown".
  - **Why:** teardown never runs on a signal (6 of 6 runs leaked). GNU `timeout` delivers SIGTERM twice, after vitest's `once` listener is gone. An `exit` hook alone leaked in 5 of 6 runs. HUP has no handler at all.
- **D-4499** — *The next run decides "killed" by an owner unix socket that refuses connections, not by "pid is dead". The parent's name is `ccrc-testrun-XXXXXX` (mkdtemp), not `ccrc-run-<pid>`.*
  - **Proposed:** #316 proposal 1 says "removes any `ccrc-run-*` whose pid is dead".
  - **Why:**
    - A socket is immune to pid reuse and to pid namespaces.
    - It answers through any bind-mount spelling (measured in Docker).
    - The workers do not inherit it, so the main process's death is visible even while orphans run (measured).
    - `ccrc-run-` is already a `mkTmp` prefix (`run-signals.test.ts`).
  - **Amendment (Task 4): the D-3533 pin is narrowed to what D-3533 rules.** `ccrc-uninstall.test.ts` pinned the gpt-lane fixture-ownership correction with `expect(config).not.toMatch(/globalSetup|laneReaper\.ts/)` against `server/vitest.config.ts`, so wiring this file reds it. What D-3533 withdrew is a LANE reaper with numeric-PID signal authority and next-run recovery of another run's processes; the spec's own line is "`server/vitest.config.ts`: no lane reaper `globalSetup`". This parent signals no process — its arm calls `process.exit` on itself, and its liveness is a socket, so the PID-reuse race D-3533 argues from does not arise. The pin now reads every `globalSetup` entry the config names and asserts none is the lane reaper and none carries signal authority (`process.kill`, an `eww` process scan); `laneReaper.ts` itself stays unnamed in the config. Review fix: when the config sets `globalSetup` at all, the pin also asserts that its parse found an entry, so a bare-string or double-quoted shape is red instead of checking nothing (U3).
  - **Amendment (review, 2026-10-09): a long-paused owner is a known limitation, not `live`.** The draft measured "a SIGSTOPped owner still connects" with one probe. A stopped owner connects only while its listen queue has room: macOS refuses after 128 probes, so a whole run stopped long enough under a busy `TMPDIR` reads `dead` and is condemned; Linux answers EAGAIN after 512, `unmeasurable`, and is safe (`## Risk notes`). No pid veto is added, for the reason this entry gives for a socket; teardown warns when its own run was already gone, which is where the case surfaces.

## File structure

| File | Change |
|---|---|
| `server/test/run-tmp.globalsetup.mjs` | **new**: the mechanism and every constant |
| `server/test/run-tmp.test.ts` | **new**: T1–T5 |
| `server/vitest.config.ts` | `globalSetup` entry and its comment, after `:92` |
| `server/test/ccrc-uninstall.test.ts` | the D-3533 pin narrowed (D-4499's amendment) |
| `server/test/tmpHelpers.ts` | one comment paragraph above `afterAll` |
| `shared/lifecycle.ts` | a new row, appended |
| `server/test/lifecycle.test.ts` | one case, appended inside the manifest describe |
| `README.md`, `CLAUDE.md`, `CONTRIBUTING.md` | prose |

## Tasks

### Task 0: Pre-flight (no commit)

- [ ] **Step 1: Check the base.** `git fetch origin main`, `git log -1 --format=%h origin/main`; confirm no open PR adds a `globalSetup` to `server/vitest.config.ts`.
- [ ] **Step 2: Confirm the anchors**, each with `grep -nF`:
  - `maxWorkers: '40%',` is at `vitest.config.ts:92`;
  - `afterAll(removeTmpFixtures);` is at `tmpHelpers.ts:97`;
  - `export const LIFECYCLE` is at `shared/lifecycle.ts:16`;
  - `lifecycle.test.ts` ends its manifest describe at its last line.
- [ ] **Step 3: Measure the baseline leak for the PR:**
  ```bash
  B=$(mktemp -d /tmp/ccrc-base-XXXXXX)
  (cd server && TMPDIR=$B timeout 25 ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts)
  ls -A $B | wc -l; du -sh $B; rm -rf $B
  ```
  Expected: rc 124, and a non-zero count.
- [ ] **Step 4: Record the green baseline counts** for `tmpfixtures`, `lifecycle` and `session-hook -t '<five citation cases>'`.

### Task 1: `condemn`, `openRun` and `probeRun` (T2, plus the `condemn` cases)

**Files:** `server/test/run-tmp.globalsetup.mjs` (new; constants plus these three functions), `server/test/run-tmp.test.ts` (new).

- [ ] **Step 1: Write the cases first.** Harness `startOwner(base, { forkChild })`: a bare `node --input-type=module -e <src>` child that imports `openRun` by `pathToFileURL`, runs it, and prints `JSON.stringify(result)`; with `forkChild` it also spawns an idle `node` child over an `'ipc'` stdio slot, as vitest forks its workers, and prints its pid. Socket bases come from `realpathSync(mkdtempSync('/tmp/ccrc-rt-'))`, removed in `afterEach`; every spawned pid is SIGKILLed there.

  `describe('probeRun — six verdicts, never folded', …)`:

  | ID | Setup | Expected |
  |---|---|---|
  | T2a | owner alive | `live` |
  | T2b | owner SIGSTOPped (SIGCONT in `finally`) | `live` |
  | T2c | owner SIGKILLed | `dead` |
  | T2d | owner with `forkChild`; SIGKILL the owner only; `childPid` still alive | `dead` |
  | T2e | owner alive, `owner.json` unlinked | `live` |
  | T2f | owner SIGKILLed, `owner.json` unlinked | `unowned` |
  | T2g | owner SIGKILLed, `live.sock` unlinked | `unmeasurable:ENOENT` |
  | T2h | owner SIGKILLed, `live.sock` replaced by a regular file | exactly `unmeasurable:not-a-socket` |
  | T2i | owner SIGKILLed, probed through a symlink spelling longer than 108 bytes | `unmeasurable:EINVAL`; the short spelling still gives `dead` |
  | T2j | `openRun` on `join(base, 'x'.repeat(90))` | `{ refused: 'EINVAL' }`, and the directory holds nothing afterwards |
  | T2k | the envelope: a base whose socket path is exactly `RUN_SUN_PATH_MAX` bytes, then one byte more (added at Task 7) | the first opens and probes `live`; the second refuses `EINVAL` and leaves nothing |

  `describe('condemn', …)`:

  | ID | Case | Expected |
  |---|---|---|
  | C1 | a dir with content | `'removed'`; neither `dir` nor `dir.dead` exists |
  | C2 | condemn the same dir again | `'gone'` |
  | C3 | `skipIf(root)`: a 0500 subdir holding a file | `left:<errno>` (EACCES on Linux; ENOTEMPTY from Node 26's `rm` on macOS, measured); `dir` is gone and `dir.dead` exists (the rename came first). Restore 0700, then condemn `dir.dead`: `'removed'` |

- [ ] **Step 2: Run, expecting red:** the file fails to load (`Cannot find module './run-tmp.globalsetup.mjs'`).
- [ ] **Step 3: Implement** the constants, `condemn`, `probeRun` (the table in §3) and `openRun`. The opening comment gives the measurements from §2 and §3 and says why this is a `.mjs` that imports only `node:` builtins: bare-`node` children import it, and the node-floor version cannot strip types (`shared/base-url.mjs` is the precedent).
- [ ] **Step 4: Run, expecting green.**
- [ ] **Step 5: Mutation rows** M1–M6.
- [ ] **Step 6: Commit** `test(server): run-tmp — the owner-socket verdicts and condemn for #316's per-run parent (D-4499)`.

### Task 2: `reapRuns` (T3)

- [ ] **Step 1: Write the cases.** `describe('reapRuns — only dead, quiet, ours, by name', …)`. Fixtures go in a `/tmp/ccrc-rt-` base: live and dead runs via `startOwner`; unowned runs via `mkdtempSync(base/RUN_PREFIX)` plus `mkdir tmp`. `now = Date.now() + 601_000` unless the case says otherwise.

  | ID | Fixture | Expected |
  |---|---|---|
  | T3a | a live run | left, with verdict `live` |
  | T3b | a dead run | removed |
  | T3c | a dead run with the real `now` | left as `dead:not-quiet` |
  | T3d | unowned, old and fresh (made 1.1 s apart; `quietS: 1`, `now` = the fresh one's ctime + 500 ms) | the old one removed; the fresh one left |
  | T3e | `X.dead` holding a file and an `owner.json`, and no socket | removed without probing |
  | T3f | a symlink `ccrc-testrun-abcdef` pointing at a victim dir outside `base` that holds a file | the link and the victim's file both survive |
  | T3g | `uid: process.getuid() + 1` | every run is left as `foreign-uid` |
  | T3h | a real dir `ccrc-testrun-signals-abcdef` | left; it does not appear in either list |
  | T3i | a dead run; after a 1.1 s sleep `mkdir run/tmp/x`; `quietS: 1, now: ctime(run/tmp) + 500` | left; `run`'s own ctime is quiet but `tmp/`'s is not |
  | T3j | `skipIf(root)`: one `.dead` dir with a 0500 subdir, and one dead run | the first is in `left` as `left:<errno>`, the second is removed, and the call resolves |
  | T3k | a second spelling of the base: a symlink everywhere; on darwin also `/System/Volumes/Data` + base; on Linux `unshare -Urm` with `mount --bind`, skipped by name when `unshare -Urm true` fails | in each, a dead run is removed and a live run is left |
  | T3l | `skipIf(root)`: a base readable but not searchable (0400) holding two run-named dirs | both are in `left` as `error:EACCES`, and the call resolves |

  T3l is the case R7 needs: `condemn` and `probeRun` never throw, so the only throw an entry can raise is its own `lstat`, and a base that lists but cannot be searched raises it for every entry. Two entries, so an outer `try` that stopped at the first is red too.
- [ ] **Step 2: Run, expecting red.** `reapRuns` is not exported (`TypeError: reapRuns is not a function`).
- [ ] **Step 3: Implement `reapRuns`.** It sorts the names and walks only `RUN_NAME_RE` matches. Each entry runs inside `try` and records `error:<code>` in `left` on a throw. The checks are `lstat`, then `isDirectory`, then the `uid`; a `.dead` name goes straight to `condemn`; otherwise `probeRun`; only `dead` or `unowned` continue; `quietSince = max(st.ctimeMs, lstat(run/tmp).ctimeMs ?? st.ctimeMs)`; if `now − quietSince < quietS*1000` the entry is left as `<v>:not-quiet`; otherwise `condemn`. It returns `{ removed: [name, why][], left: [name, why][] }`. If `readdirSync(base)` fails, it returns `left: [['.', 'unreadable:<code>']]`.
- [ ] **Step 4: Run, expecting green.**
- [ ] **Step 5: Mutation rows** R1–R8.
- [ ] **Step 6: Commit** `test(server): run-tmp — the next run's reaper: dead or unowned, quiet, ours, by exact name (D-4496)`.

### Task 3: `armSignals` (T4)

- [ ] **Step 1: Write the cases.** The harness `armed(base, variant)` is a bare `node` child that runs `openRun`, then `armSignals(run)`, prints the run, then: `'wait'` idles; `'throw'` throws from a 50 ms timer; `'disarm'` calls the returned disarm and idles. **The child disarms BEFORE it prints the run:** a SIGTERM that arrives between the print and the disarm is caught by libuv and then dropped, and the child hangs (measured). Each child has a 15 s kill-after watchdog in the test.

  | ID | Action | Expected |
  |---|---|---|
  | T4a | SIGTERM | `{code: 143, signal: null}`; neither `run` nor `run.dead` exists |
  | T4b | SIGINT | 130; clean |
  | T4c | SIGHUP | 129; clean |
  | T4d | a child whose exit the harness defers 3 s (it wraps `process.exit`; the arm is untouched). SIGTERM, poll every 2 ms until `run` is gone (the first SIGTERM was handled) while the child still runs, then a second SIGTERM | 143; clean |
  | T4e | `'throw'` | code 1; clean (the `exit` listener) |
  | T4f | `'disarm'`, then SIGTERM | `{code: null, signal: 'SIGTERM'}`; `run` is still present |
  | T4g | positive control: a child that calls `openRun` but never arms, then SIGTERM | `signal: 'SIGTERM'`; `run` is present |

  **Why T4d waits for the rename, and defers the exit.** Two SIGTERMs sent back to back merge into one pending signal, so a `once` mutant passed 10 of 10 that way (measured). The second must arrive after the first was handled and before the exit. The draft widened that window by planting 4,000 files for the `rm` to chew through; on Linux that `rm` is a few milliseconds, too narrow to hit reliably under CI load, so at Task 7 the harness instead defers the child's exit by 3 s (passing `process.exit`'s arguments on as given: `process.exit(undefined)` exits 0, measured). The window no longer depends on the machine.
- [ ] **Step 2: Run, expecting red.** `armSignals is not a function`; T4g passes.
- [ ] **Step 3: Implement** `armSignals(run)`: persistent `process.on` for each of `RUN_SIGNALS` (`SIGHUP: 1, SIGINT: 2, SIGTERM: 15`) and for `exit`; each signal condemns the run, sets `process.exitCode ??= 128 + n`, and calls `setTimeout(() => process.exit(), 1)`; `exit` condemns. It returns the disarm.
- [ ] **Step 4: Run, expecting green.**
- [ ] **Step 5: Mutation rows** A1–A7. A2 (`once`) is deterministic through T4d's mid-`rm` second signal; run it 10× and report the count.
- [ ] **Step 6: Commit** `test(server): run-tmp — a persistent SIGTERM/SIGINT/SIGHUP/exit arm that collects the run (D-4498)`.

### Task 4: `setup()`, the wiring, and the end-to-end tests (T1, T5a–T5f)

**Files:** `run-tmp.globalsetup.mjs`, `run-tmp.test.ts`, `server/vitest.config.ts`, `server/test/ccrc-uninstall.test.ts`.

- [ ] **Step 1: Write the cases.**

  **T1**, `describe('this run is wired', …)`: `RUN_REFUSED_ENV` is unset (the message names the code and says the `TMPDIR` is too long for a unix socket); `RUN_DIR_ENV` is set (the message says `globalSetup` is not wired in `vitest.config.ts`); `realpathSync(tmpdir()) === join(run, RUN_TMP)`; `mkTmp('ccrc-runtmp-wire-')` starts with `join(run, RUN_TMP) + sep`; `await probeRun(run) === 'live'`.

  **T5 harness**, after `agent/test/contain-path.test.ts`: `VITEST` resolved through `createRequire(import.meta.url).resolve('vitest/package.json')`; `globalSetup` DERIVED from `server/vitest.config.ts` by regex, resolved against `server/`, failing if nothing is wired. The fixture root is `mkTmp('ccrc-runtmp-e2e-')` with a PLAIN-OBJECT `vitest.config.mjs` (`globals`, `include: ['*.fx.test.mjs']`, `testTimeout: 60000`, the derived `globalSetup`) and one fixture test that makes `mkdtempSync(tmpdir()/ccrc-fx-)`, appends `{pid, tmpdir, runDir, refused, baseListing}` to `$FX_RECORD`, then acts on `$FX_MODE`: `sleep` (30 s), `untilquiet` (until `ctime(FX_DEAD/tmp) + Q + 500 ms`), `die` (SIGKILLs its own worker), `pass`. `nested(base, env)` spawns `process.execPath VITEST run --root <fx>` with `detached: true`, env `{...process.env, TMPDIR: base, CI: '1', FX_*}` with the three run env names deleted unless the case sets them. The base is `realpathSync(mkdtempSync('/tmp/ccrc-rt-'))`; afterwards `killGroup(pid, 'SIGKILL')` (guarded), then `rmSync(base)`.

  | ID | Action | Expected |
  |---|---|---|
  | T5a | `sleep`; wait for the record; `kill(pid,'SIGTERM')` then `kill(-pid,'SIGTERM')` | exit `{code:143, signal:null}`; the record's `tmpdir` matches `^<base>/ccrc-testrun-[A-Za-z0-9]{6}/tmp$`; no `ccrc-testrun-*` in `base` |
  | T5b | `die` | non-zero `code`; no `ccrc-testrun-*` in `base` (teardown collects the dead worker's fixture) |
  | T5c | `sleep`; on the record, SIGKILL main only, then `killGroup` the orphans | the run dir is present and `probeRun` gives `dead`. A second `pass` run with the default quiet leaves it (the gate's positive control). A third with `CCRC_TEST_RUN_QUIET_S=0` removes it |
  | T5d | `sleep`; `kill(-pid,'SIGHUP')` | `{code:129}`; no `ccrc-testrun-*` |
  | T5e | kill a run as in T5c; refresh `dead/tmp`'s ctime; at once start a run with `CCRC_TEST_RUN_QUIET_S=8`, `FX_DEAD=<dead run>`, `FX_MODE=untilquiet` | `baseListing` still contains the dead run (setup left it, not quiet); after exit it is gone (teardown reaped it). Margin-based: the only requirement is a nested startup under 8 s |
  | T5f | base `join(base, 'x'.repeat(90))`; env `RUN_DIR_ENV='/inherited/never'`; `pass` | the record shows `tmpdir === longBase`, no run dir, `refused === 'EINVAL'`; stderr contains `ccrc-test: per-run temp dir refused (EINVAL)`; no `ccrc-testrun-*` under `longBase` |

- [ ] **Step 2: Run, expecting red.** T1 is red with "globalSetup is not wired". Every T5 case is red at the derivation of `globalSetup`.
- [ ] **Step 3a: Implement `setup`**: reap (one `ccrc-test:` line when anything was removed or left), `openRun`, or `refuse(code, base)` (D-4497); set `TMPDIR` to the run's `tmp/` and `CCRC_TEST_RUN_DIR`; arm. Its teardown disarms, restores `TMPDIR`, deletes `CCRC_TEST_RUN_DIR`, condemns (warning on `left:`), closes the server, and reaps again.
- [ ] **Step 3b: Wire the config.** After `maxWorkers: '40%',`: a two-line comment and `globalSetup: ['test/run-tmp.globalsetup.mjs'],`.
- [ ] **Step 3c: Narrow the D-3533 pin** in `ccrc-uninstall.test.ts` (D-4499's amendment), red-first: with the config wired it is red as it stands; narrowed, it is green, and red again when the config names `laneReaper.ts` or the wired file gains a `process.kill`.
- [ ] **Step 4: Run, expecting green.** `run-tmp.test.ts` (T1–T5f), `tmpfixtures.test.ts`, `ccrc-uninstall.test.ts -t 'numeric-PID'`, then the five citation cases.
- [ ] **Step 5: Mutation rows** S1–S6, U1–U2.
- [ ] **Step 6: Commit** `fix(server): one owned temp parent per vitest run, collected at teardown, on a signal, or by the next run (#316; D-4497)`.

### Task 5 (dropped by ruling 4; follow-up): vitest's own `tmpDir` in the arm

`setup(project)` would pass `project.tmpDir` to the arm, which would remove it (lstat, a directory owned by this uid) on a signal; T5a and T5d would then assert an empty base. vitest removes that directory on a normal close; on a killed run it was measured at 5.6 MB. Left for a follow-up, together with proposal 3.

### Task 6: The lifecycle row, the comments and the docs

- [ ] **Step 1: The red case**, appended to `lifecycle.test.ts` inside `describe('shared/lifecycle.ts — the policy §4(a) manifest')`: `server-test-run-dirs` is declared, pattern `E`, its `root` contains `RUN_PREFIX` (imported from `./run-tmp.globalsetup.mjs`: the one textual twin) and its collector names `run-tmp.globalsetup.mjs`. Red because the class is not declared.
- [ ] **Step 2: Implement.** Append to `LIFECYCLE`, with a two-line comment:
  ```ts
  { name: 'server-test-run-dirs', root: '${TMPDIR:-/tmp}/ccrc-testrun-<6>/ (+ .dead mid-removal)', pattern: 'E',
    creators: ['server vitest globalSetup (server/test/run-tmp.globalsetup.mjs)'],
    collector: 'server/test/run-tmp.globalsetup.mjs (teardown; SIGTERM/SIGINT/SIGHUP/exit arm; the next run\'s reap at setup and teardown: owner socket refuses AND 600 s ctime-quiet)',
    bound: 'one test run; after a SIGKILL, until the next run under the same TMPDIR',
    tier: '1,551 dirs / 5.74 GiB from five timed-out shards in one morning (#316, 2026-10-07)', ruling: null },
  ```
- [ ] **Step 3: Prose.**
  - **`tmpHelpers.ts`:** one paragraph above `afterAll` (no line shift at `:38-52`): `mkTmp` dirs now land inside the run's `ccrc-testrun-*/tmp`; the file-scoped `afterAll` and R20a stay, because they bound the peak disk use within a run (the 650-dir, 2.5 GB file); the run parent is what a killed run can no longer leak.
  - **README**, after the "Run one file with…" paragraph: the per-run parent; the three collectors; the `ccrc-test: per-run temp dir refused (<code>)` line and its envelope; `CCRC_TEST_RUN_QUIET_S`, for tests only.
  - **`CLAUDE.md`'s fixture-HOMEs bullet:** the per-run parent, in the bullet's own words. Keep its line count, or run the citation cases.
  - **CONTRIBUTING "Tests are hermetic":** one sentence with the same fact and the refusal line.
- [ ] **Step 4: Run.** `lifecycle.test.ts`, `run-tmp.test.ts`, the five citation cases, and `tsc -p test/tsconfig.tests.json --noEmit`, which `typecheck-tests.test.ts` also runs.
- [ ] **Step 5: Mutation rows** L1 and L2.
- [ ] **Step 6: Commit** `docs(server): declare server-test-run-dirs (pattern E) and document the per-run temp parent (#316)`.

### Task 7: The gate

- [ ] **Step 1: Full suite.** `vitest.config.ts` changed, so CI runs the whole server suite anyway. Run it under a fresh short `TMPDIR`, and compare the FAILED titles with an `origin/main` baseline run under the same conditions. A new red is acceptable only if it is a path-length failure fixed at its own site (Risk notes); a known load flake (`CLAUDE.md`'s list) is re-run in isolation.

  Watch these three: `ccd-entry-install -t 'shebang names the PATH-selected python3'`; `session-hook -t 'scratch slug'`; `delegation-rig`.
- [ ] **Step 2: Leak drills.**
  - **Run under `timeout`:** `TMPDIR=$B timeout 25 ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts`, then `ls -A $B`. Expected: rc 124 and nothing but vitest's own `<nanoid>` dir (Task 5 is dropped). Before the fix, Task 0 measured 11 entries and 15 MB.
  - **`timeout -s KILL` drill:** expect one `ccrc-testrun-*` left. A rerun with `CCRC_TEST_RUN_QUIET_S=0` removes it.
- [ ] **Step 3:** `git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts`.

## Mutation table (measure each row at its task's source stage; restore after)

| Row | File / function | Mutation | Expected red |
|---|---|---|---|
| M1 | `probeRun` | any connect error → `dead` | T2i |
| M2 | `probeRun` | drop the `isSocket()` check | T2h (exact string), on both platforms |
| M3 | `probeRun` | `owner.json` checked before connect, with `unowned` returned first | T2e |
| M4 | `openRun` | the one refusal helper does not `rm` the run dir | T2j, T2k, T5f |
| M5 | `condemn` | `rm` without the rename first | C3 (`dir` still exists) |
| M6 | `condemn` | ENOENT on the rename throws | C2 |
| M7 | `openRun` | no length check before `listen` | T2j, T2k, T5f on Node 22 (Linux); green on Node 26, whose `listen` fails EINVAL itself |
| M8 | the length check | `>=` in place of `>` (one byte too strict) | T2k, on every Node |
| M9 | `probeRun` | no length check before `connect` | T2i on Node 22 (Linux); green on Node 26 |
| R1 | `reapRuns` | no quiet gate | T3c, T3d (fresh) |
| R2 | `reapRuns` | `statSync` in place of `lstatSync` | T3f (the link is renamed away) |
| R3 | `reapRuns` | no uid check | T3g |
| R4 | `reapRuns` | `name.startsWith(RUN_PREFIX)` in place of the regex | T3h |
| R5 | `reapRuns` | `.dead` names probed instead of condemned | T3e |
| R6 | `reapRuns` | quiet measured on `run` only | T3i |
| R7 | `reapRuns` | no per-entry `try` | T3l (rejects) |
| R8 | `reapRuns` | skip an entry when `realpath(dir) !== join(base, name)` (a containment check by spelling) | T3k |
| A1 | `armSignals` | return before registering | T4a–e |
| A2 | `armSignals` | `process.once` | T4d (the second SIGTERM after the first was handled); report N/10 |
| A3 | `armSignals` | no `setTimeout(process.exit)` | T4a–d time out |
| A4 | `armSignals` | no `exitCode` set | T4a–c (code 0) |
| A5 | `RUN_SIGNALS` | drop SIGHUP | T4c, T5d |
| A6 | `armSignals` | no `exit` listener | T4e |
| A7 | disarm | returns a no-op | T4f |
| S1 | `vitest.config.ts` | delete the `globalSetup` line | T1 and all of T5 |
| S2 | `setup` | `TMPDIR` not set | T1, T5a |
| S3 | teardown | no `condemn` | T5b |
| S4 | `setup` | no reap at setup | T5c (third run) |
| S5 | teardown | no reap at teardown | T5e |
| S6 | `refuse` | the inherited `RUN_DIR_ENV` is not deleted | T5f |
| U1 | `vitest.config.ts` | `globalSetup` also names `test/laneReaper.ts` | the narrowed D-3533 pin |
| U2 | `run-tmp.globalsetup.mjs` | gains a `process.kill` | the narrowed D-3533 pin |
| L1 | `shared/lifecycle.ts` | delete the row | the new `lifecycle.test.ts` case |
| L2 | `shared/lifecycle.ts` | `root` without `ccrc-testrun-` | the same case |
| M10 (review) | `openRun` | the listen-error handler is not removed once listening | T2l |
| M11 (review) | `condemn` | no ENOENT check on a `.dead` name handed in as is | C4 |
| R9 (review) | `reapRuns` | only `live` is left (`v === 'live'` in place of the dead-or-unowned filter) | T3m |
| R10 (review) | `reapRuns` | quiet measured on `mtimeMs` in place of `ctimeMs` | T3o |
| R11 (review) | `reapRuns` | an entry's `lstat` ENOENT is an error, not `gone` | T3n |
| S7 (review) | teardown | no warning when its own `condemn` answers `gone` | T6a |
| S8 (review) | teardown | `owner.json` not dropped after a failed rename | T6b |
| S9 (review) | `setup` | an inherited `CCRC_TEST_RUN_REFUSED` not deleted on success | T6c |
| S10 (review) | `parseQuiet` | no whole-number guard (`Number(raw)` for any set value) | T6d |
| U3 (review) | `vitest.config.ts` | `globalSetup` as a bare string, or with double-quoted entries | the narrowed D-3533 pin |
| L3 (review) | `shared/lifecycle.ts` | the collector carries `600 s` beside `RUN_QUIET_S` | the lifecycle case |
| L4 (review) | `shared/lifecycle.ts` | the collector no longer names `RUN_QUIET_S` | the lifecycle case |

## Execution record (2026-10-08)

Executed on `669b8305` (Tasks 0–4, 6 and 7; Task 5 dropped by ruling 4). `origin/main` moved to `b0647d85` during the gate, and the branch merged onto that cleanly. It did not merge onto `6fc7ef11`, so it was rebased there on 2026-10-09 (see Review fixes, below).

**Task 0.** `timeout 25 vitest run test/ccrc-doctor.test.ts` under a fresh `TMPDIR`: rc 124, 11 entries (10 `ccrc-*` fixture dirs and vitest's `<nanoid>`), 15 MB. Green baselines: `tmpfixtures` + `lifecycle` 62/62; the five citation cases 5 passed.

**Amendments to the draft, each found while executing:**

1. **C3's errno is the platform's.** Node 26's `rm` on macOS reports ENOTEMPTY for a 0500 subdir, not EACCES; C3 and T3j assert `left:E…`.
2. **T3l is new.** `condemn` and `probeRun` never throw, so T3j cannot see R7 (no per-entry `try`). T3l (a base that lists but cannot be searched, two run-named entries) is what reds it.
3. **T5c also asserts the setup reap.** Without it S4 (no reap at setup) is green, because teardown's reap removes the run anyway; the third run's worker now records that it never saw the dead run.
4. **The D-3533 pin is narrowed** (D-4499's amendment). It sits in a `describeLinux` block, so it is red on Linux once the config is wired: measured on Linux Node 22 in Docker, and on macOS by a temporary `describe` switch that was not committed.
5. **Node 22 truncates an overlong socket path** (D-4497's amendment): T2i, T2j and T5f were red on Linux Node 22.23.3 until the length check landed; T2k is new.
6. **Children are signalled only through their live `ChildProcess` handles**, never by a pid that may have been reused; a detached group is signalled as a group.
7. **T4d defers the child's exit** instead of racing the `rm` (see Task 3).

**Measured mutation table** (macOS Node 26 unless marked; each row applied with `cp`/`cmp` around it and restored):

| Row | Red | Cases |
|---|---|---|
| M1 | 1/1 | T2i |
| M2 | 1/1 | T2h (macOS read `unmeasurable:ENOTSOCK`) |
| M3 | 1/1 | T2e |
| M4 | 1/1 | T2j, T2k, T5f |
| M5 | 1/1 | C2, C3 |
| M6 | 1/1 | C2 |
| M7 | Linux Node 22 1/1; macOS 0/1 | T2j, T2k, T5f (Node 26's `listen` refuses by itself) |
| M8 | 1/1 on both | T2k |
| M9 | Linux Node 22 1/1; macOS 0/1 | T2i |
| R1 | 1/1 | T3c, T3d, T3i |
| R2 | 1/1 | T3f |
| R3 | 1/1 | T3g |
| R4 | 1/1 | T3h |
| R5 | 1/1 | T3e |
| R6 | 1/1 | T3i |
| R7 | 1/1 | T3l |
| R8 | 1/1 | T3f, T3k's symlink spelling (the firmlink spelling stays green: `realpath` does not unify it) |
| A1 | 1/1 | T4a–T4e |
| A2 | **10/10**; Linux Node 22 5/5 | T4d |
| A3 | 1/1 | T4a–T4d, T5d |
| A4 | 1/1 | T4a–T4d |
| A5 | 1/1 | T4c, T5d |
| A6 | 1/1 | T4e |
| A7 | 1/1 | T4f |
| S1 | 1/1 | T1, T5a–T5f |
| S2 | 1/1 | T1, T5a |
| S3 | 1/1 | T5b, T5c, T5e |
| S4 | 1/1 | T5c |
| S5 | 1/1 | T5e |
| S6 | 1/1 | T5f |
| U1 | 1/1 | the narrowed pin (the config naming `laneReaper.ts`; wired as a real entry, vitest fails to start) |
| U2 | 1/1 | the narrowed pin (`… carries signal authority`) |
| L1 | 1/1 | the lifecycle case |
| L2 | 1/1 | the lifecycle case |

**`run-tmp.test.ts`:** 41 passed, 1 skipped on macOS Node 26 (the Linux bind-mount case) and on Linux Node 22 (the macOS firmlink case); the Linux `unshare -Urm` case ran there. With real `strace`, `ci-trace-run.test.ts`'s traced runs are green on Linux Node 22 under the wired config.

**Leak drills (macOS).** `timeout 25` on `ccrc-doctor`: rc 124, and the base holds only vitest's own `<nanoid>` dir (5.6 MB; the dropped Task 5). `timeout -s KILL 25`: rc 137, one `ccrc-testrun-*` left; a rerun under the default window leaves it, and one with `CCRC_TEST_RUN_QUIET_S=0` prints `ccrc-test: reaped 1 dead test-run dir(s) …` and removes it.

**The gate: the full server suite on macOS.** Both runs shared a loaded machine (load average 11–43).

| | `origin/main` `669b8305` | this branch |
|---|---|---|
| `TMPDIR` (real path) | 29 chars | 56 chars, the macOS default's length |
| files: failed / passed / skipped | 16 / 521 / 2 | 11 / 527 / 2 |
| tests: failed / passed / skipped | 66 / 25,127 / 750 | 28 / 25,207 / 751 |
| left in `TMPDIR` after the complete run | 57 entries, 2.6 MB | 0 |

- **Failed in both (22),** pre-existing on this machine: `build-release` and `release-main` (BSD tar), two `ccd-docs-tree` rows, one `child-reclaim-paused-at-server` row, `session-hook`'s SessionStart cost ratio, one `update-spawn` row, and `typecheck-tests` (no `agent/` dependencies installed in the worktree; `tsc -p test/tsconfig.tests.json` was run by hand and reports nothing in this change).
- **Failed on this branch only (7), none caused by it.** `ccrc-account`'s D-2221 deadline case fails the same way with the `globalSetup` removed under the same load, and is green 3/3 at lower load. `ccrc-codex` L0a (a 1,000 ms wait) is green 4/4 in isolation. `platform-hazards`' FIFO-EOF probe is red 2/5 both with and without the `globalSetup` (its own comment records reds on unchanged trees). `session-hook-merge-deny`'s 100 KB bound, and three `session-hook` cases (a known load-flake suite), are green in isolation.
- **The three watched path-length cases,** alone at a 56-character base: the `ccd-entry-install` shebang case, `session-hook`'s scratch-slug cases and `delegation-rig` are green, and the base is empty afterwards.
- **Observed: nested runs inside the suite refuse on macOS.** `ci-shards.test.ts` spawns four real vitest runs of the server config. Their base is the outer run's `tmp/` (80 characters at the macOS default), past the envelope, so each refuses by design and prints its `ccrc-test:` line. Their fixtures land in the outer run's `tmp/` and go with it. On Linux the nested base is 28 characters, and each nested run gets a parent of its own.

**Follow-ups:**

- **Proposal 3, a sweeper** (its own issue). It would cover loose dirs leaked before this change, `TMPDIR`s no later run visits, children with a minimal env, and a SIGKILLed run's vitest `tmpDir`.
- **Task 5:** vitest's own `TestProject.tmpDir` in the arm, 5.6 MB per killed run.
- **Optional:** a run that finds itself inside another run (`CCRC_TEST_RUN_DIR` inherited, its base that run's `tmp/`) could use it silently instead of refusing. That would remove the four macOS lines above.
- #172, the orphan processes.

### Review fixes (2026-10-09)

**Rebased onto `origin/main` `6fc7ef11`.** #315 had appended its `history-*` rows to `LIFECYCLE`, and its cases to `lifecycle.test.ts`, at the same end-of-list anchors as this branch. Both sides were kept: the history rows come first, then `server-test-run-dirs`; this branch's case sits inside the manifest describe, before main's `docs W2 — ccdEnding` describe. `lifecycle.test.ts` is 74/74 green after the rebase.

**Fixed, each red-first or measured by mutation (macOS Node 26.5.0):**

- **`openRun`'s listen-error handler outlived `listen` (should-fix).** It answers with a refusal, and a refusal removes the run, so an `accept` failure later in the run (EMFILE, ENFILE, ENOMEM, ENOBUFS) would have deleted a live run's whole `TMPDIR`. It is now named and removed first thing in the listen callback. T2l emits a post-listen error and asserts the run survives (M10).
- **A long-paused owner (should-fix).** See the known limitation in `## Risk notes` and D-4499's amendment. The module header, its verdict table and T2b's comment now say "while its listen queue has room". Teardown warns when its own `condemn` answers `gone` (T6a, S7). No pid veto.
- **The reaper's safety filter had no test (should-fix).** T3m: a live owner read through a spelling too long to connect (`unmeasurable:EINVAL`) and a socket replaced by a file (`unmeasurable:not-a-socket`) are both left, however quiet (R9).
- **`CLAUDE.md:67` overclaimed (should-fix)**, and so did `tmpHelpers.ts` and `CONTRIBUTING.md`: none said a SIGKILLed run's parent waits for a later run under the same `TMPDIR`. Each now says so, with line counts kept; the five citation cases are green.
- **A failed rename at teardown leaked silently.** The close unlinks `live.sock`, and owner.json with no socket is `unmeasurable:ENOENT`, which no reaper acts on. The reviewer's fix, skipping the close, does not hold. Node's own handle cleanup unlinks a listening unix socket when the process exits naturally (measured on Node 26 and Node 22; `process.exit` and SIGKILL leave it), and T6b stayed red with the close skipped. Teardown instead drops `owner.json` after a failed rename. The run then reads `unowned`, with its socket or without it, and is collected once quiet (T6b, S8).
- **ENOENT is `gone`.** In `reapRuns`, an entry removed between the listing and its `lstat` is `gone`, not `error:ENOENT` (T3n, R11). `condemn` answers `gone` for a `.dead` name that is already absent (C4, M11). The "reaped N" line counts only `:removed` rows. That is a message only, and no test pins it.
- **New tests for guards that had none:** the ctime quiet gate (T3o, R10), the success path's delete of an inherited `CCRC_TEST_RUN_REFUSED` (T6c, S9), and `parseQuiet`'s whole-number guard (T6d, S10). T6 runs `setup()` in a bare `node` child, not in a nested vitest.
- **Nits:** the narrowed D-3533 pin now tells "no `globalSetup`" from "a `globalSetup` it cannot read" (U3). The lifecycle row names `RUN_QUIET_S` instead of copying 600 s (L3, L4). T2i compares against `RUN_SUN_PATH_MAX`. §2's exit codes are in order. `run-tmp.test.ts`'s header now says what is true about signalling: through the handle in `afterEach`, by group id for a detached group, and by pid only for a child a case has just seen running.

**Measured rows** (each applied with `cp`/`cmp` around it, then restored):

| Row | Red | Cases |
|---|---|---|
| M10 | 1/1, and red-first before the fix | T2l |
| M11 | 1/1, and red-first | C4 |
| R9 | 1/1 (T3m is green on the real code before and after; nothing pinned the filter) | T3m |
| R10 | 1/1 | T3o |
| R11 | 1/1, and red-first (`error:ENOENT`) | T3n |
| S7 | 1/1, and red-first | T6a |
| S8 | 1/1, and red-first (`unmeasurable:ENOENT`) | T6b |
| S9 | 1/1 | T6c |
| S10 | 1/1 | T6d |
| U3 | bare string and double-quoted: old pin 0/1 each (a silent pass), new pin 1/1 each; the real config and a config with no `globalSetup` stay green | the narrowed pin, under the temporary `describeLinux` → `describe` switch (not committed) |
| L3 | 1/1 | the lifecycle case |
| L4 | 1/1 | the lifecycle case |

**`run-tmp.test.ts` after the fixes:** 50 passed and 1 skipped on macOS Node 26.5.0 (the Linux bind-mount case). On Linux Node 22.23.3 (Docker `node:22-bookworm`, uid 1000, seccomp unconfined), `run-tmp`, `lifecycle` and `tmpfixtures` together pass 134 with 1 skipped (the macOS firmlink case), so the `unshare -Urm` bind-mount case ran.
