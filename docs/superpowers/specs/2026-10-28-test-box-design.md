# The test box: test runs off the fleet host, results streamed back to the session

**Spec** · 2026-10-28 · Status: draft for review, rev 0. It designs #1695 (step 2 of moving test runs off the fleet
host). It builds on #1694 (step 1: the capped tests slice, the fleet-wide admission queue and the `ccrc test` wrapper),
which is not built yet; this spec names what it needs from step 1 in §3.1. Docs only: no code ships with it.

**Related:** #1694 (step 1), #389 (the vitest worker cap in the session environment), #1752 (per-box sizes as ccrc
settings, the pattern every key below follows), #1772 (the worktree `node_modules` lifecycle), #1274 (CI workers per
runner), `2026-09-23-ci-test-selection-design.md` (the selection map and the per-file durations the daily run
publishes), `2026-10-23-fleet-disk-retention-design.md` §2.5 (the agent's `disk` op, the shape §5.2 copies),
`2026-08-10-architecture-ddd-clean-solid.md` (rings).

## In short

On 2026-10-28 about 20 coding sessions on the fleet host each ran vitest (3 workers), tests-inclusive `tsc`, mutation
loops and Chrome browser tests, and one session ran deliberate CPU burners. Load reached 80 on 16 threads, the agent was
starved, and the server showed the fleet host as unreachable. Test fsyncs on the host's mirrored consumer NVMe also
raise the io-pressure banner. A box-level CPU guard holds meanwhile (a session-slice CPU quota and a raised agent CPU
weight, as box config, not in this tree).

The test box is a second, separate box that runs those suites instead. The design, one line per question:

- **Transport: git, never rsync.** The wrapper snapshots the worktree, dirty and untracked-but-not-ignored files
  included, into one commit built in a throwaway index (the session's index and tree are untouched), and pushes it to a
  scratch ref in a mirror on the test box. About a dozen guard suites read the real repository's history and
  `origin/main`, so a file copy without `.git` cannot give the local answer (§2.1). Scratch refs never go to `origin`:
  the repository is public.
- **Caches: warm slots.** The test box keeps N run slots per repository. Each slot is a checkout with its own installed
  `node_modules` per package, keyed exactly as CI keys them (lockfile hash, node version, platform). A run checks its
  commit out into a free slot and reinstalls a package only when its key changed. Lockfiles change about five times a
  month per package (§1.4), so nearly every run starts warm (§2.2).
- **Secrets: none on the box, none in the run.** A run gets a fixed, allowlisted environment and an empty HOME under an
  unprivileged user with no outbound network. The session's environment is never forwarded. A snapshot that would carry
  a secret-shaped untracked file is refused before it leaves the fleet host (§2.3).
- **Fallback: the local slice, said out loud.** Remote off, box unreachable, a version mismatch, or a queue over its
  limit: the wrapper runs the same command in step 1's slice and says why, in the first line and the last (§2.4).
- **GitHub CI keeps the full suites.** The full server suite is about 4.4 hours of file time (§1.1); it stays with the
  merge queue and `workflow_dispatch`. The test box takes single files, file sets under a time budget, the
  tests-inclusive typecheck, mutation loops and the browser tests (§2.5).
- **Placement: per repository, by config.** A repository uses the test box when the test box's repository table lists
  it. ccrc-pwa is the first row. Every programme's coordinators and workers reach it through the same skill routing
  step 1 adds (§2.6).
- **Operator controls: one switch, one card.** A switch in the switchboard turns remote runs on or off; a card in
  Settings shows the box's state, slots and queue depth, read through a new agent op shaped like `disk` (§2.7).

Everything box-specific is a ccrc setting with a neutral default (§4). Eight operator decisions close the spec (§8),
including when the old box stops being the rollback source.

## 1. Measured

Code citations are to `origin/main` `379da862c`. CI figures are from merge-queue run 40685460825 (full suite, green,
2026-10-28) and its `times-*` artifacts. Tree sizes were measured on a checkout of that commit on a workstation. No box
was touched.

### 1.1 The heaviest suites and their times

| CI job (full run) | wall time | note |
|---|---|---|
| `browser (pwa)` | 962 s | one job, real Chrome through playwright-core, 36 files |
| `server 1/12` … `server 12/12` | 598–773 s each | 2 vitest workers per shard on a 4-vCPU runner |
| `node floor (22.16.0)` | 696 s | |
| `pwa 1/3` … `pwa 3/3` | 123–239 s | |
| `pwa typecheck and storybook` | 77 s | |
| `test (agent)` | 61 s | |
| `typecheck (server)` | 28 s | `tsc` over `server/src` only |

The server suite in that run: **1,156 files, 16,007 s of whole-file wall time** (hooks and collection included, as the
file-times reporter counts it). Per file: median 1.7 s, p90 32.6 s, p99 206 s; 810 files under 5 s, 163 over 20 s, 69
over 60 s. The heaviest:

| file | wall |
|---|---|
| `ccd-tick-diet-equivalence-utf8-route.test.ts` | 572 s |
| `ccd-tick-diet-equivalence-route.test.ts` | 490 s |
| `ccd-ws-reap.test.ts` | 355 s |
| `ccrc-doctor-codex.test.ts` | 318 s |
| `ccd-child-reclaim-verb-tail.test.ts` | 317 s |
| `ccd-ws-audit.test.ts` | 295 s |
| `history-replay.test.ts` | 288 s |
| `typecheck-tests.test.ts` (the tests-inclusive `tsc`) | 125 s |
| `session-hook.test.ts` | 104 s |

So a session's typical run (one file, or the handful its change touches) is seconds to a few minutes, and the full
server suite is CI-sized: 12 runners × 4 vCPU for about 12 minutes. On a 16-vCPU box it would hold the whole box for
well over half an hour.

### 1.2 What the tests need from the machine

Counted over `server/test/*.test.ts` (1,120 files) at the commit above; one file can count in several rows.

| need | files | what it means for the test box |
|---|---|---|
| a real `tmux` binary (contained sockets, never a live server) | ≈97 | install tmux, same major as the fleet host |
| `systemd-run`/`systemctl` named (poisoned to fail, per `ghContainedEnv` and the containment builders) | ≈91 | nothing real is called; the poison must still resolve first on PATH |
| a `/proc` walk | ≈87 | Linux; and the walks see every same-uid process, so a run user of its own (§2.3) |
| Linux-only (`skipIf`/`runIf` on platform) | ≈46 | Linux, like the fleet host |
| loopback listeners, free ports | ≈85 | loopback only; no outbound network needed |
| `strace` | ≈9 | install strace |
| `python3` (asserted present when `CI` is set) | ≈14 | install python3 |
| the real repository's git history or `origin/main` (`topology-clean`, `deviation-refs`, `consolidation-path-guard`, the ratchets) | about a dozen | the run needs a real clone with `origin/main` (§2.1) |
| real Chrome (`CCRC_CHROME`; "throws on a box with no Chrome: red, never skipped") | 36 pwa browser files | install Chrome or Chromium, path in config |

CI's own list (`.github/actions/server-deps`) is the same: `tmux jq strace python3` on Linux, plus `bash tmux flock jq
coreutils` on macOS. The suites read almost no ambient environment: `PATH`, `HOME`, `TMPDIR`, `LANG`, `CI` and a few
test-owned `CCRC_*` names. `CI` changes about 17 assertions (it makes some presence checks strict), so the test box does
not set it unless the local run had it (§2.3).

### 1.3 Size of a ccrc-pwa worktree and its installs

| piece | size |
|---|---|
| tracked tree (4,105 files) | ≈173 MB, of which `docs/` ≈85 MB and `server/test` ≈50 MB |
| packed repository objects | ≈480 MB (shared by every worktree of one clone) |
| `server/node_modules` (225 lock entries) | ≈188 MB, ≈5,000 files |
| `pwa/node_modules` (647) | ≈218 MB, ≈18,100 files |
| `ui/node_modules` (810) | ≈262 MB, ≈15,700 files |
| `agent/node_modules` (116) | small; not installed on the measuring checkout |

A warm slot is therefore about 0.9 GB with its installs. A snapshot push is a delta against the mirror: for an ordinary
change, kilobytes to a few megabytes.

### 1.4 How often the installs change

Commits to `origin/main` in the 30 days to 2026-10-28: 912. Of those, lockfile changes: `server` 5, `pwa` 5, `ui` 3,
`agent` 1. A per-lockfile install cache is warm for nearly every run; a branch that changes a lockfile pays one
`npm ci` for that package in the slot it lands in.

### 1.5 What step 1 gives this design

#1694 ships `ccrc-tests.slice` (a hard `MemoryMax`, bounded swap, low `CPUWeight`), a `ccrc test` wrapper in its own
file that runs a command in that slice with the session's environment, a fleet-wide admission queue for heavy runs
(lock files in the registry, a dead holder frees its slot), skill routing to the wrapper, a deny rule on bare
`systemd-run` of test commands, a doctor line and a UI card. None of it is on `main` yet. This spec adds the remote arm
to that wrapper and reuses the slice as the fallback unchanged.

## 2. Decisions

### 2.1 Transport: a snapshot commit pushed to a scratch ref (D-TBD-testbox-transport)

**The snapshot.** The wrapper builds a commit that is exactly the worktree as the session sees it, without touching the
session's index, stash or tree:

1. scrub the inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` and `GIT_OBJECT_DIRECTORY` (a
   polluted `GIT_DIR` has written into the real repository before);
2. with `GIT_INDEX_FILE` set to a throwaway file: `git read-tree HEAD`, `git add -A` (honours `.gitignore`, so
   `node_modules`, build output and gitignored local files stay home), `git write-tree`;
3. `git commit-tree <tree> -p HEAD -m 'ccrc test snapshot'`. If the tree equals `HEAD^{tree}`, the snapshot is `HEAD`
   itself and nothing new is written.

A clean tree costs one `rev-parse`. A dirty tree writes loose objects into the clone's object store, which `git gc`
collects with the rest once the commit is unreferenced; the wrapper keeps no ref to it on the fleet host.

**The push.** `git push <testbox-remote> <snapshot>:refs/ccrc-test/<run-id>`. The test box keeps one bare mirror per
repository that fetches `origin` on a timer (config, default 5 min) and before each run whose base it lacks, so the push
carries only the session's own new objects. The run checks out the snapshot with `origin/main` present, so the history
guards measure the same range they measure locally.

**Never `origin`.** Pushing scratch refs to the repository's own remote would publish uncommitted work on a public
repository and keep it in GitHub's ref history. The wrapper refuses a test-box remote whose URL equals any of the
clone's own remotes.

**Why not rsync.** Rsync of tracked and dirty files moves fewer bytes on a cold box, but it carries no history, so the
guard suites in §1.2 lose `origin/main` and give a different answer from local; adding `.git` to it is a worse git
push. It also needs its own file list (tracked, modified, untracked-not-ignored), which is the index work above done by
hand. Rejected.

**Ref lifetime.** The test box deletes `refs/ccrc-test/<run-id>` when the run's result has been kept for its retention
time (config, default 24 h), and prunes on its own `gc` timer.

### 2.2 Caches: warm slots keyed by lockfile (D-TBD-testbox-slots)

Per repository the test box keeps `slots` checkouts (config; default 4 on a 16-vCPU box, see §4). Each slot is a linked
worktree of the mirror plus its installed packages. The repository table (§2.6) lists the packages in install order;
for ccrc-pwa that is `server`, `agent`, `ui`, then `pwa` (pwa reads `ui` source and resolves it from `ui/node_modules`).

A run:

1. takes a free slot (the queue, §2.8);
2. `git checkout --force --detach <snapshot>`, then `git clean -ffdx` with each package's `node_modules` excluded;
3. for each package, compares the slot's recorded key with the snapshot's key — `sha256(lockfile)`, node version,
   platform, the same inputs as `server-deps`' cache key — and runs `npm ci` only on a mismatch, with a shared npm cache
   so it is offline-fast;
4. runs the command (§2.5) in the package directory.

**Why slots, not shared trees.** A shared read-only `node_modules` reached by symlink breaks `file:` links (`pwa` →
`../ui`) and any resolution that takes a realpath; a hardlinked copy shares inodes, so a test that writes under
`node_modules` would corrupt every slot; overlay mounts need privileges or a user namespace and add a moving part. A
slot that owns its installs is what a warm CI runner is, and at about 0.9 GB a slot it costs a few GB on the box.

**Temp.** Each run gets its own `TMPDIR` under the slot, removed after the run (the suites' own run-tmp parent still
cleans inside it). `TMPDIR` on a tmpfs is a config option, off by default: it removes the fsync cost but changes free
space and timing, so it waits for the parity check (§6) to pass with it on.

### 2.3 Secrets and isolation (D-TBD-testbox-env)

The tests need no secrets: they run against fixture HOMEs, with `gh`, `curl`, `ssh`, the system managers and `tmux`
servers contained (CLAUDE.md, "FIXTURE HOMEs only"). The test box is built so that holds by construction, not by
convention:

- **No credentials on the box** beyond its own service token and, for a private repository, a read-only deploy key
  used only by the mirror fetch. No `gh` login, no account files, no provider keys.
- **A run user of its own**, unprivileged, with an empty HOME per run, no `~/.gitconfig` credential helper and no
  ssh agent. The `/proc` walks in §1.2 then see only the run's own processes.
- **A fixed environment.** The run starts from an empty environment plus: `PATH` (the box's tool directory first),
  `HOME`, `TMPDIR`, `LANG`, `TERM`, and the names in a forward allowlist (config, default empty). The session's
  environment is never forwarded: on the fleet host it carries the session's account settings and tokens. `CI` is
  forwarded only if the local invocation had it, so the answer matches the local one.
- **No outbound network for the run.** The run unit carries `IPAddressDeny=any` with `IPAddressAllow=localhost`.
  Only the service's mirror fetch and `npm ci` reach out, and only to the git host and the package registry.
- **Containment of the run unit.** Each slot runs in a slice with its own `MemoryMax`, `MemorySwapMax` and CPU quota
  (config), so a runaway test cannot take the test service down with it.
- **The snapshot is checked before it leaves.** Gitignored files never enter it (§2.1). On top of that the wrapper
  refuses a snapshot whose untracked, unignored paths match a deny list (config; default `*.pem`, `*.key`, `.env`,
  `.env.*`, `id_*`, `*.p12`) and names the paths. A refusal falls back to local, with the reason.
- **Results.** The log the box keeps is the run's own output, kept for the retention time and deleted with the ref. It
  is shown only to the session that submitted it. It passes through no other surface, so no new egress mask is needed;
  the card in §2.7 shows counts, never log text.

A check that nothing leaks becomes a test of the service: a fixture run that prints its whole environment and its HOME
listing, compared against the allowlist.

### 2.4 Fallback: the local slice, said out loud (D-TBD-testbox-fallback)

The wrapper chooses remote only when all of these hold; otherwise it runs the same command through step 1's local path
(the tests slice and its admission queue), unchanged:

| check | source | fallback reason printed |
|---|---|---|
| the remote switch is on | the switchboard marker (§2.7) | `test box: off` |
| the repository is in the test box's table | the box's status answer | `test box: this repository is not set up there` |
| the box answers its status call within the deadline (config, default 3 s) | direct call | `test box: unreachable (<detail>)` |
| node major.minor, tmux major and git major match the fleet host's | the box's status answer | `test box: version differs (<name> <local> vs <remote>)` |
| the queue is under its limit (config, default 20 waiting runs) | the box's status answer | `test box: queue full (<n> waiting)` |
| the snapshot passes the deny list | §2.3 | `test box: snapshot refused (<paths>)` |
| the command is one the box runs (§2.5) | the repository table | `test box: <command> runs locally` |

The reason is the first line the session sees and is repeated in the final summary, as `ran on: local (fallback: …)`.
A remote run's summary says `ran on: test box`.

**The box drops mid-run.** The run keeps going on the box; the wrapper reconnects with the run id and its last log
offset, within a deadline (config, default 60 s). After that it prints `test box: lost the run` and, by default, runs
the command locally (config can make it fail instead). Ctrl-C or the session ending cancels the remote run.

### 2.5 What runs where (D-TBD-testbox-routing)

| work | where | why |
|---|---|---|
| one test file, or a set whose estimated time is under the budget | test box | the common case; seconds to minutes |
| a mutation loop (one file, many runs) | test box | many short runs; the slot stays warm |
| the tests-inclusive typecheck (`tsc --noEmit -p test/tsconfig.tests.json`, `typecheck-tests`) | test box | the 2.7 GB run that started step 1 |
| pwa browser tests | test box | needs Chrome; CI's longest job (962 s) |
| the full server suite, or a set over the budget | GitHub CI | about 16,000 file-seconds (§1.1); the merge queue runs it anyway |
| the macOS legs | GitHub CI | another platform |
| anything that needs a real system manager, a live tmux server or a live account | nowhere | no test does this; such a command is refused, not routed |

**The budget.** The wrapper estimates a file set's time from the per-file durations the daily CI run publishes
(`2026-09-23-ci-test-selection-design.md`) with the median for a file it does not know, divided by the slot's worker
count. Over the budget (config, default 15 min) the wrapper does not start a remote run: it prints the CI command
(`gh workflow run ci.yml --ref <branch> -f mode=full` for the full suite) and exits non-zero, so the session decides;
the local slice is still available with `--local`.

**The command.** `ccrc test --remote <package> -- <argv>`. The repository table lists, per package, the command heads
the box runs (default for ccrc-pwa: `./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`, `npm test`,
`npm run test:browser`); anything else falls back to local with its reason. The `--maxWorkers` a session passes is
kept, capped at the slot's worker count. Step 1's bare `ccrc test <argv>` gains a default: remote when the switch is
on and the checks in §2.4 pass, local otherwise; `--local` forces the slice.

**Results stream back.** The service streams the run's stdout and stderr as they happen, then a summary frame: exit
status, the failed files and test names (from a JSON reporter the service adds beside the session's own reporters,
like CI's file-times reporter), the run's wall time and the last 40 log lines (config). The wrapper prints them and
exits with the run's exit status, so "counted exits" read the same as local runs.

### 2.6 Placement: which repositories and programmes

The test box keeps a repository table in its own config: one row per repository with its fetch URL, its packages in
install order, the command heads per package, the system tools it needs and its slot count. ccrc's code names no
repository. ccrc-pwa is the first row, because its suites are the measured load. Other repositories join by adding a
row; a repository with no row runs locally with the reason in §2.4.

Programmes are not configured separately. Every coordinator and worker already reaches tests through the skills step 1
changes; once the switch is on, every programme whose repository has a row uses the test box, and the rest use the
slice. A per-programme opt-out is not built: the fallback already covers a repository the box cannot serve.

### 2.7 Operator controls and status (D-TBD-testbox-status)

**The switch.** A new row in `shared/switches.ts`'s `SWITCHES`: a `$REG/testbox-remote-live` marker on the fleet host,
written by the server's switch route from the Settings card, absent meaning off. The wrapper reads the marker itself,
so the switch works with the server down. The kill direction is the operator's at a terminal too: removing the marker
turns remote runs off at once; runs already on the box finish.

**The status read.** A new agent op, `testbox`, shaped like the `disk` op (`agent/src/disk.ts`): an L3 adapter on the
fleet host that calls the test box's status endpoint with a deadline and returns the answer or a typed failure. The
server's L1 decider turns it into a state (`off`, `ok`, `degraded` (slots down or a version mismatch), `unreachable`)
and the L4 timer polls it (config, default 30 s). The server keeps its one agent link; it never reaches the test box
itself. The fleet agent is legitimately the caller: it is on the host whose wrapper submits runs, so it sees the same
reachability the wrapper sees.

**The card.** Settings › Automation gains a Test box card beside step 1's tests-slice card:

- the switch, with one sentence of what it does;
- state, last answer time, service version, the fleet host's and the box's node, tmux and git versions;
- slots busy of total, queue depth, runs and fallbacks in the last 24 hours, with fallbacks grouped by reason;
- the deps keys warm per package for each repository row.

| width | layout |
|---|---|
| phone | one column; the switch and state on top, then a two-row summary (slots, queue); versions and the 24-hour counts behind a disclosure |
| laptop | the card in the settings column; switch and state on one line, a three-cell row (slots, queue, fallbacks), versions under it |
| wide | the same card at the column's width, with the deps-keys table shown open |

Doctor gains a line on the fleet host: the switch, the box's state, queue depth, and the version comparison.

### 2.8 The queue on the box

The box's queue is its own; step 1's fleet-wide admission queue governs local runs only. Fairness: at most one running
run per session (config), first come first served across sessions, and a waiting run prints its position as the queue
moves. A run waits at most a deadline (config, default 10 min) before the wrapper falls back with
`test box: waited <n> min`. Slots × workers is sized to the box (§4); on 16 vCPU the defaults are 4 slots × 3 workers.

### 2.9 Where the service lives in the tree (D-TBD-testbox-service-home)

Two homes were weighed:

- **A. The agent package, in a test role.** The test service is a second entry point of `agent/`: it reuses the
  agent's bearer-token check, its WebSocket server, the release tarball and the update lane that already rolls the
  agent, and adds a run-frame family with its own whitelist. The fleet agent and the test service are different
  processes on different hosts, which is the "another host or process" reason the consolidation spec accepts.
- **B. A new package.** Cleaner boundaries, but a second token check, a second release artifact and a second update
  lane: the duplicate mechanisms the consolidation wave is retiring.

Recommendation: **A.** The wrapper's remote arm is the client; the run frames are `run.submit`, `run.log`, `run.summary`,
`run.cancel` and `status`. The service's own pieces (the slot manager, the key comparison, the queue) are L1 deciders
with L3 adapters for git, npm and systemd, like the rest of `agent/`.

## 3. What this needs from others

### 3.1 From step 1 (#1694)

- the wrapper's file, its argv shape (`ccrc test [--local|--remote] <package> -- <argv>`) and its exit-status contract;
- the slice and admission queue as the local path, unchanged;
- the skill routing and the deny rule on bare `systemd-run` test units, which make the wrapper the only door, so the
  remote arm covers every route.

If step 1 lands with another argv, §2.5 follows it.

### 3.2 Open PRs and order

This PR adds one file under `docs/superpowers/specs/` and touches no other file, so it is line-disjoint from every open
PR. The build that follows will touch `shared/switches.ts` (a row), `agent/` (a new entry point and op), the Settings
Automation section and the doctor checks; it lands after #1694, and its plan re-checks open PRs on those files then.
#1772's deps-shed arm and this design meet later: once typechecks and tests run remotely, a fleet worktree needs its
`node_modules` only for local fallback runs, which makes shedding them cheaper. That is a follow-up, not part of this
spec.

## 4. Configuration

Every size, cap, count and path is a ccrc setting read through `_ccrc_knob` (the process environment, else
`~/.ccrc/ccrc.env`, else the default), as #1752 does for the session slice. Defaults are neutral: with no test box
configured, remote is simply unavailable and every run is local.

| key (fleet host) | default | meaning |
|---|---|---|
| `CCRC_TESTBOX_URL` | unset | the test service's URL; unset means no test box |
| `CCRC_TESTBOX_TOKEN_FILE` | `~/.ccrc/testbox.token` | the bearer token for the service (0600) |
| `CCRC_TESTBOX_GIT_REMOTE` | unset | the push URL of the box's mirror for this repository |
| `CCRC_TESTBOX_STATUS_DEADLINE` | `3s` | §2.4 |
| `CCRC_TESTBOX_RECONNECT_DEADLINE` | `60s` | §2.4 |
| `CCRC_TESTBOX_LOST_RUN` | `local` | `local` or `fail` (§2.4) |
| `CCRC_TESTBOX_QUEUE_LIMIT` | `20` | §2.4 |
| `CCRC_TESTBOX_QUEUE_WAIT` | `10m` | §2.8 |
| `CCRC_TESTBOX_BUDGET` | `15m` | §2.5 |
| `CCRC_TESTBOX_DENY_GLOBS` | `*.pem *.key .env .env.* id_* *.p12` | §2.3 |
| `CCRC_TESTBOX_POLL` | `30s` | §2.7 |

| key (test box) | default | meaning |
|---|---|---|
| `CCRC_TESTBOX_SLOTS` | `2` | slots per repository; a 16-vCPU box sets 4 |
| `CCRC_TESTBOX_WORKERS` | `2` | vitest workers per slot; a 16-vCPU box sets 3 |
| `CCRC_TESTBOX_SLOT_MEMORY_MAX` | `4G` | per-slot `MemoryMax`; a 30 GB box sets 6G |
| `CCRC_TESTBOX_SLOT_SWAP_MAX` | `1G` | per-slot `MemorySwapMax` |
| `CCRC_TESTBOX_SLOT_CPU_QUOTA` | `200%` | per-slot CPU quota; a 16-vCPU box sets 350% |
| `CCRC_TESTBOX_ROOT` | `~/.ccrc/testbox` | mirrors, slots, logs |
| `CCRC_TESTBOX_REPOS` | `~/.ccrc/testbox-repos.d` | the repository table (§2.6) |
| `CCRC_TESTBOX_FETCH_EVERY` | `5m` | mirror fetch timer |
| `CCRC_TESTBOX_RETENTION` | `24h` | result, log and ref lifetime |
| `CCRC_TESTBOX_ENV_FORWARD` | empty | §2.3 |
| `CCRC_TESTBOX_TMPFS` | `off` | §2.2 |
| `CCRC_TESTBOX_LOG_TAIL` | `40` | §2.5 |
| `CCRC_CHROME` | unset | Chrome or Chromium binary for the browser tests |

## 5. Acceptance, mapped

| acceptance (#1695) | how it is shown |
|---|---|
| the same pass/fail answer as locally | the parity check in §6, before the switch is armed, and a fixture test of the wrapper that compares the summary of a remote and a local run of the same snapshot |
| coding sessions see no test-run memory or CPU | on the fleet host a remote run costs a `git add -A` over the tree, one push and a stream: measured in the build as the wrapper's own peak RSS and CPU time, with a ceiling in a test; the tests slice stays empty while every run is remote |
| when the box is down, runs fall back and say so | a fixture test per row of §2.4's table: the reason in the first and last line, the local slice used, the exit status the local run's |

## 6. The parity check, before arming

Before the operator turns the switch on, a one-off parity run: for the 20 most recent merged PRs, the wrapper runs each
PR's CI-selected server files plus `typecheck-tests` and the browser suite twice on the same snapshot, once locally in
the slice and once on the test box, and compares per-file pass/fail. A disagreement in a file on the known-load-flake
list (CLAUDE.md) is re-run alone on both sides before it counts. Any other disagreement blocks arming and is reported
by file. The same run repeated with `CCRC_TESTBOX_TMPFS=on` decides that option.

## 7. Why it is safe

- Nothing on the fleet host changes until the switch is armed; with no URL configured the wrapper is step 1's.
- The fallback is the path that exists, and every fallback says why.
- No secret is on the box, none is forwarded, the run cannot reach the network, and the snapshot is checked first.
- Scratch refs never reach the public remote.
- The server keeps one agent link and never reaches a third box.

## 8. Operator decisions

| # | decision | recommended |
|---|---|---|
| OA-T1 | Transport: snapshot commit pushed to a scratch ref on the box's mirror (§2.1), or rsync | **git push**; rsync loses the history the guard suites read |
| OA-T2 | Where the service lives: the agent package in a test role, or a new package (§2.9) | **agent package, test role** |
| OA-T3 | Full server suite: CI only, or allowed on the box when its queue is idle (§2.5) | **CI only**, budget 15 min per remote run |
| OA-T4 | A run lost mid-flight: re-run locally, or fail (§2.4) | **re-run locally**, said out loud |
| OA-T5 | Which repositories first (§2.6) | **ccrc-pwa only**; others by adding a row once its parity check passes |
| OA-T6 | `TMPDIR` on tmpfs on the box (§2.2) | **off until §6 passes with it on**, then on |
| OA-T7 | Arming: the switch on after §6 passes, and step 1's local slice kept as the fallback for good | **yes** |
| OA-T8 | When the old box stops being the rollback source of the fleet move and is rebuilt as the test box | **after** the fleet host has run 7 days with no rollback-class incident **and** a full snapshot of the old box is taken and verified restorable; the snapshot stays the rollback source for 30 more days, then is deleted by the operator |

## Deviations found

New design decisions, numbered `D-TBD-<slug>` because the allocator was not reachable from the session that wrote this
spec; they are replaced by issued numbers before landing:

- **D-TBD-testbox-transport**: the snapshot commit in a throwaway index, pushed to `refs/ccrc-test/<run-id>` on the
  box's mirror; never to the clone's own remotes; rsync rejected (§2.1).
- **D-TBD-testbox-slots**: warm per-repository slots with per-package installs keyed by lockfile hash, node version and
  platform; shared, hardlinked and overlay trees rejected (§2.2).
- **D-TBD-testbox-env**: the run's fixed allowlisted environment, its own user and empty HOME, no outbound network, and
  the snapshot deny list (§2.3).
- **D-TBD-testbox-fallback**: the fallback checks, their printed reasons, and the lost-run rule (§2.4).
- **D-TBD-testbox-routing**: what runs on the box, what stays with CI, the time budget and the command heads (§2.5).
- **D-TBD-testbox-status**: the `testbox-remote-live` switch row, the `testbox` agent op and the Settings card (§2.7).
- **D-TBD-testbox-service-home**: the test service as a second entry point of the agent package (§2.9).
