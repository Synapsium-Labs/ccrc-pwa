# The test box: test runs off the fleet host, results streamed back to the session

**Spec** · 2026-10-28 · Status: draft for review, rev 2. It designs #1695 (step 2 of moving test runs off the fleet
host). It builds on #1694 (step 1: the capped tests slice, the fleet-wide admission queue and the `ccrc test` wrapper),
which is not built yet; this spec names what it needs from step 1 in §3.1. Docs only: no code ships with it.

**Rev 1** answers the first review: the box now reproduces the session's git state (HEAD, branch, `origin/main`,
staged, unstaged and untracked) instead of committing the dirty tree (§2.1); slots are separate shared clones, so each
has its own `origin/main` (§2.2); gitignored build outputs the tests read are handled (§1.2, §2.2); installs and runs
happen as a per-slot user in static units started through one narrow polkit rule (§2.3); the snapshot reuses the
session's stat cache and has size caps (§2.1); and the push URL is per repository (§4).

**Rev 2** answers the second review: both units get a private `/tmp` and the run's `TMPDIR` is a short path inside it,
so the suites that bind unix sockets under a literal `/tmp` work and no socket path grows past the local one (§2.2,
§2.3); each slot has its own npm cache inside its directory and the registry proxy is the only shared warm layer (§2.2);
a slot returns to an idle state the mirror always keeps before the run's refs can expire, so the mirror's `gc` cannot
prune objects a shared clone still names (§2.1); the parity reference is a local run at the lockfile install, the
wrapper says when the session's installs differ from it, and the fallback says what happens with no `node_modules`
(§2.4); the runner always sets the worker count (§2.5); the run unit sees every package's `node_modules` and the build
outputs read-only, with the vite and vitest caches on an empty tmpfs each run, so no run leaves state for the next
(§2.3); and a bare `ccrc test` over the time budget falls back to the local slice like every other check, while an
explicit `--remote` refuses with an exit status no test run gives (§2.4, §2.5).

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

- **Transport: git, never rsync.** The wrapper sends four things: the session's HEAD sha, its branch name, its
  resolved `origin/main` sha, and the dirty state (the staged tree and the worktree tree, built from a copy of the
  session's index, so the session's index and tree are untouched). It pushes them to scratch refs in a mirror on the
  test box. The box checks HEAD out on a branch of the same name, sets `origin/main` to the session's sha and lays the
  dirty state back as uncommitted changes, so `HEAD`, the branch, `git status` and every
  `merge-base(origin/main, HEAD)..HEAD` range read the same as locally. About a dozen guard suites read the real repository's history, so a file
  copy without `.git` cannot give the local answer (§2.1). Scratch refs never go to `origin`: the repository is
  public.
- **Caches: warm slots.** The test box keeps N run slots per repository. Each slot is a shared clone of the mirror (its
  own refs, the mirror's objects) with its own installed `node_modules` per package, keyed exactly as CI keys them
  (lockfile hash, node version, platform). A run checks its commit out into a free slot and reinstalls a package only
  when its key changed. Lockfiles change about five times a month per package (§1.4), so nearly every run starts warm
  (§2.2).
- **Secrets: none on the box, none in the run.** Every piece of session-controlled code (the install's lifecycle
  scripts, the builds, the tests) runs as the slot's own unprivileged user, in a static unit, with a fixed allowlisted
  environment and an empty HOME. The run has loopback only; the install reaches a local registry proxy and nothing
  else. The session's environment is never forwarded. A snapshot that would carry a secret-shaped untracked file is
  refused before it leaves the fleet host (§2.3).
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

Everything box-specific is a ccrc setting with a neutral default (§4). Ten operator decisions close the spec (§8),
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
| a `/proc` walk | ≈87 | Linux; and the walks see every same-uid process, so a run user per slot and `ProtectProc=invisible` (§2.3) |
| Linux-only (`skipIf`/`runIf` on platform) | ≈46 | Linux, like the fleet host |
| loopback listeners, free ports | ≈85 | loopback only; no outbound network needed |
| a literal `/tmp/` path (`delegation-rig` makes `mkdtempSync('/tmp/dlgt-')` because a unix socket path is capped near 108 bytes; `run-tmp`, `shutdown-seal`) | 29 name `'/tmp/…'`; tmux's own socket dir is `/tmp/tmux-<uid>` when `TMUX_TMPDIR` is unset | a writable private `/tmp` in both units and a `TMPDIR` no longer than the local one (§2.2, §2.3) |
| `strace` | ≈9 | install strace |
| `python3` (asserted present when `CI` is set) | ≈14 | install python3 |
| the real repository's git history or `origin/main` (`topology-clean`, `deviation-refs`, `consolidation-path-guard`, the ratchets) | about a dozen | the run needs a real clone whose HEAD and `origin/main` are the session's own shas; `consolidation-path-guard` diffs `$(git merge-base origin/main HEAD)..HEAD` and `deviation-refs` walks that range, so dirty changes must stay uncommitted (§2.1) |
| the guards' base overrides `CCRC_HISTORY_BASE` (`topology-clean`, `consolidation-path-guard`) and `CCRC_LEDGER_BASE` (`deviation-refs`) | 3 | forwarded by default, resolved to a sha first (§2.1, §2.3) |
| the real repository's branch name or `git status` (`buildinfo`, `build-release`) | a few | the slot is on a branch of the session's name with the session's staged, unstaged and untracked state (§2.1); the many `ccd-*` files that read branches do it in fixture repos and need nothing |
| gitignored build outputs (`server/dist`, `server/dist-pwa`, `agent/dist`): `auth-gate` runs cases only when `server/dist-pwa/index.html` exists, `authFixtures` imports from `server/dist/...` | 23 files name one of the three paths; most build their own copy under a fixture HOME | the snapshot never carries them (they are ignored) and the slot's clean would delete them, so the box builds each one the local tree has (§2.2, OA-T9) |
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

### 2.1 Transport: the session's git state pushed to scratch refs (D-TBD-testbox-transport)

Rev 0 committed the dirty tree and checked that commit out. That made dirty changes part of HEAD on the box while they
are working-tree changes locally, so every guard that measures `merge-base(origin/main, HEAD)..HEAD` saw a different
diff and one extra commit, and `git status` and the branch name differed too. Rev 1 sends the state, not a commit of it.

**What a submission carries.** Four things, each read on the fleet host without touching the session's index, stash or
tree:

| item | how the wrapper reads it | scratch ref on the box |
|---|---|---|
| HEAD | `git rev-parse HEAD` | `refs/ccrc-test/<run-id>/head` |
| the branch | `git symbolic-ref --quiet --short HEAD`; empty means detached | sent in the run frame, no ref |
| the base | `git rev-parse --verify origin/main^{commit}`; unresolved means none, and the box then has no `origin/main` either | `refs/ccrc-test/<run-id>/base` |
| the dirty state | two trees: the staged tree `I` and the worktree tree `W` (below); absent when the tree is clean | `refs/ccrc-test/<run-id>/snap` |

`CCRC_HISTORY_BASE` and `CCRC_LEDGER_BASE` are treated like the base: when the session's environment sets one, the
wrapper resolves it to a commit locally (`rev-parse --verify <value>^{commit}`), pushes it as
`refs/ccrc-test/<run-id>/history-base` or `…/ledger-base`, and forwards the sha in its place. A value that does not
resolve locally is forwarded unchanged, so the guard refuses it on both sides the same way.

**The clean check.** `GIT_OPTIONAL_LOCKS=0 git status --porcelain=v1 -z --untracked-files=all`. Empty output is a clean
tree: no trees are built and the submission carries HEAD, the branch and the base only. `GIT_OPTIONAL_LOCKS=0` keeps the
check from refreshing the session's index behind its back.

**The dirty state.** With the five `GIT_*` location variables scrubbed (a polluted `GIT_DIR` has written into the real
repository before):

1. copy the session's index (`git rev-parse --git-path index`, which names a linked worktree's own index) to a
   throwaway file and point `GIT_INDEX_FILE` at it. The copy keeps the stat cache, so the next step rehashes only files
   whose stat changed, not the 4,105 tracked files;
2. `git write-tree` → `I`, the staged tree. Unmerged entries make this fail; the wrapper falls back with
   `test box: unmerged paths`;
3. the size check (below), then `git add -A` (honours `.gitignore`) and `git write-tree` → `W`, the worktree tree;
4. `git -c commit.gpgSign=false commit-tree I -p HEAD` → `S_I`, then `git -c commit.gpgSign=false commit-tree W -p S_I`
   → `S_W`, with a fixed author and committer in the environment so no identity or signing prompt can block. These two
   commits are only carriers for the trees; nothing on the box checks them out.

**Size caps.** Before step 3 the wrapper lists the untracked, unignored files (`git ls-files -o --exclude-standard -z`)
and the modified tracked ones, and sums their sizes. A single untracked file over `CCRC_TESTBOX_UNTRACKED_FILE_MAX`
(default 5M) or a total over `CCRC_TESTBOX_SNAPSHOT_MAX` (default 64M) stops the remote path with
`test box: snapshot too large (<path> <size>)` naming the largest offender. Scratch dumps, logs and vitest temp leaks
inside the worktree therefore never get hashed, written as loose objects or pushed. The loose objects a normal dirty
tree writes are unreferenced after the push and `git gc` collects them; the wrapper keeps no ref on the fleet host.

**The push.** `git push --no-verify <mirror-url> HEAD:refs/ccrc-test/<run-id>/head <base>:…/base S_W:…/snap` (plus the
override refs). `--no-verify` keeps the session's `pre-push` hook out of it. Because every needed commit is pushed, the
box never depends on its own fetch timer having caught up: a session on an older or newer `origin/main` than the
mirror's gets its own. The mirror URL is per repository (§4). The mirror's `update` hook accepts only refs under
`refs/ccrc-test/` from the push key, so the key cannot rewrite the mirror's copy of the repository's branches.

**The mirror.** A plain bare clone (`git clone --bare <url>`) with `remote.origin.fetch` set to
`+refs/heads/*:refs/remotes/origin/*`, fetched with `--prune` on its timer (config, default 5 min). It is not
`--mirror`: a mirror fetch prunes every ref the remote lacks, which would delete `refs/ccrc-test/*` under a running
slot, and it would pull `refs/pull/*`. Pruning a refspec touches only refs that refspec maps, so scratch refs survive.
The timer fetch exists only to keep pushes small (they are deltas against what the mirror has).

**What the slot does with it** (in the prepare phase, as the slot's user, §2.2 and §2.3):

0. the reset (see "Ref lifetime" below), so the prepare starts from the idle commit whatever the last run left;
1. `git fetch <mirror> 'refs/ccrc-test/<run-id>/*:refs/ccrc-test/run/*'` into the slot's own refs (objects are shared,
   so this moves no data);
2. `git checkout --force -B <branch> refs/ccrc-test/run/head`, or `--detach` when the session was detached;
3. `git update-ref refs/remotes/origin/main refs/ccrc-test/run/base`, or delete it when the session had no base;
4. the clean (§2.2);
5. when the tree was dirty: `git read-tree -m -u HEAD S_W^{tree}` lays `W` into the working tree, then
   `git read-tree S_I^{tree}` puts the index back to `I`. Modified files are modified, staged files staged, untracked
   files untracked, deleted files deleted; then `git update-index -q --refresh` so the stat cache matches the new files.

**What a test sees.** Against the session's own worktree at submission:

| read | local | box |
|---|---|---|
| `git rev-parse HEAD` | the session's HEAD | the same sha |
| `git rev-parse --abbrev-ref HEAD` | the branch, or `HEAD` | the same |
| `git rev-parse origin/main` | the session's last fetch | the same sha |
| `git merge-base origin/main HEAD`, `git diff --name-only <mb> HEAD`, `git rev-list <mb>..HEAD` | from the two shas above | the same, so the history guards measure the same range |
| `git status --porcelain` | staged, unstaged, untracked | the same entries |
| `git diff`, `git diff --cached` | the session's unstaged and staged changes | the same |
| `git remote get-url origin` | the repository's URL | the same (the slot's `origin` URL is the row's fetch URL, never fetched from: the run has no network) |

Not reproduced, by design: other local branches, other remote-tracking refs, the stash, reflogs, the session's
`git config` and upstream tracking, and gitignored files other than the build outputs in §2.2. No test reads them from
the real repository today; the parity check (§6) is what would find one.

**Never `origin`.** Pushing scratch refs to the repository's own remote would publish uncommitted work on a public
repository and keep it in GitHub's ref history. The wrapper refuses a mirror URL that equals any of the clone's own
remotes.

**Why not rsync.** Rsync of tracked and dirty files carries no history, so the guard suites in §1.2 lose `origin/main`
and give a different answer from local; adding `.git` to it is a worse git push. It also needs its own file list
(tracked, modified, untracked-not-ignored), which is the index work above done by hand. Rejected.

**Ref lifetime and the shared-clone invariant.** A slot borrows the mirror's objects (§2.2), and git-clone(1) warns
that a `--shared` clone breaks when the source prunes an object the clone still names. A slot names objects through
more than its refs: its HEAD, its branch, its index (which holds `W`'s blobs) and its reflogs. Deleting only
`refs/ccrc-test/run/*` at the end of a run would leave the idle slot naming objects the mirror keeps only through
`refs/ccrc-test/<run-id>/*`; once those expire and `gc.pruneExpire` passes, the next prepare's checkout hits missing
objects. The invariant is therefore: **every object a slot names is reachable from a ref in the mirror, at every
moment.** It is kept by these rules:

1. each slot is configured `core.logAllRefUpdates=false` and `gc.auto=0`, so it keeps no reflog and never repacks;
2. the mirror keeps one idle ref per slot, `refs/ccrc-test/slot/<n>`, set by the service to the mirror's
   `refs/remotes/origin/main` before that slot's next reset;
3. **the reset**, run as the slot's user at the end of every run (the run unit's `ExecStopPost`, so a failed or killed
   run resets too) and again as the first step of every prepare: fetch `refs/ccrc-test/slot/<n>` into the slot,
   `git checkout --force --detach` it, `rm -f .git/index` then `git read-tree` of that commit's tree, delete every
   local branch and `refs/remotes/origin/main` and `refs/ccrc-test/run/*`. Afterwards the slot names only the idle
   commit and objects it reaches;
4. the mirror deletes `refs/ccrc-test/<run-id>/*` only after the run's retention time (config, default 24 h) **and**
   only when no slot records that run id as its last run without a completed reset. A slot whose reset failed is marked
   down and its run's refs are kept until an operator clears it;
5. the mirror moves `refs/ccrc-test/slot/<n>` only while slot `n` is idle and reset, never under a run.

The mirror's `gc` then runs on its own timer with git's default prune expiry and needs no "only while idle" window: the
invariant, not the timing, keeps the slots whole. A service test runs `git gc --prune=now` on the mirror between two
runs of one slot, with the first run's refs already expired, and the second run must prepare and pass (§5).

### 2.2 Caches: warm slots keyed by lockfile (D-TBD-testbox-slots)

Per repository the test box keeps `slots` checkouts (config; default 2, a 16-vCPU box sets 4, see §4). Each slot is a
shared clone of the mirror (`git clone --shared --no-checkout`: its own refs, the mirror's objects through
`objects/info/alternates`) plus its installed packages. Rev 0 made slots linked worktrees of the mirror; linked
worktrees share `refs/remotes/*`, so four concurrent runs could not each have their own `origin/main`. A shared clone
costs no object storage and gives every slot its own refs. The repository table (§2.6) lists the packages in install
order; for ccrc-pwa that is `server`, `agent`, `ui`, then `pwa` (pwa reads `ui` source and resolves it from
`ui/node_modules`).

A run has two phases, each its own unit as the slot's user (§2.3):

**Prepare** (loopback plus the registry proxy):

1. the git steps of §2.1, with the clean between checkout and the dirty state: `git clean -ffdx` excluding each
   package's `node_modules` and the slot's recorded build outputs;
2. for each package, compares the slot's recorded deps key with the snapshot's — `sha256(lockfile)`, node version,
   platform, the same inputs as `server-deps`' cache key — and runs `npm ci` only on a mismatch, against the registry
   proxy, with `npm_config_cache=<slot>/npm-cache` and `--prefer-offline`. The cache is the slot's own, inside the
   slot directory the prepare unit may write (§2.3), owned by the slot's user; no npm cache is shared between slots,
   because a cache every slot uid can write would be a channel between slots. The shared warm layer is the registry
   proxy, which is the service's and which slots only read through HTTP. Lifecycle scripts run (`node-pty` needs its
   install step), so this is session-controlled code and runs where §2.3 puts it. Node headers are installed on the
   box and named by `npm_config_nodedir`, so a native build never downloads them;
3. the build outputs (below).

**Run** (loopback only): the command (§2.5) in the package directory.

**Build outputs.** The tests read three gitignored outputs (§1.2): `server/dist`, `server/dist-pwa` and `agent/dist`.
The snapshot never carries them, and without a rule the box would skip cases a fleet worktree that has built them runs.
The rule (OA-T9): **the box builds the outputs the local tree has.** The submission carries a list of which of the
repository table's declared outputs exist locally (an existence check per path, nothing more), and the prepare phase
runs each one's build command from the table (ccrc-pwa: `npm run build` in `server` for `server/dist`, the pwa build for
`server/dist-pwa`, `npm run build` in `agent` for `agent/dist`). A slot keeps an output and skips its build when its
recorded build key (the snapshot's tree sha of the output's source paths, from the table, plus the deps key) matches.
An output absent locally is removed from the slot, so both sides run without it. The one gap left is a local output
older than its source: the box builds it fresh. The summary says `built on box: <outputs>` so a reader knows.

The other rule (both sides always without them) cannot hold: the wrapper cannot remove a session's built outputs, and
CI builds them, so a box that never builds them would be the odd one out.

**Why slots, not shared trees.** A shared read-only `node_modules` reached by symlink breaks `file:` links (`pwa` →
`../ui`) and any resolution that takes a realpath; a hardlinked copy shares inodes, so a test that writes under
`node_modules` would corrupt every slot; overlay mounts need privileges or a user namespace and add a moving part. A
slot that owns its installs is what a warm CI runner is, and at about 0.9 GB a slot it costs a few GB on the box.

**The slot directory.** `<slot>` is `<CCRC_TESTBOX_ROOT>/slots/<repository>/<n>`, holding `checkout/` (the shared
clone, its `node_modules` and build outputs), `npm-cache/` and `home/` (emptied each run), all owned by the slot's user.
The run spec the service writes lives outside it (§2.3), so the slot's user cannot replace it.

**Temp.** Both units run with `PrivateTmp=yes`: each unit instance gets its own empty, writable `/tmp` and `/var/tmp`,
seen by that unit's processes only and removed by systemd when the unit stops. So the suites that bind sockets under a
literal `/tmp` (§1.2) and tmux's default `/tmp/tmux-<uid>` work as they do locally, concurrent slots cannot see each
other's `/tmp`, and nothing a run leaves in `/tmp` survives it. The run's `TMPDIR` is a short directory inside that
private `/tmp` (config, default `/tmp/r`), never a path under the slot root: the suites' run-tmp parent puts a
`live.sock` under `realpath(TMPDIR)` and refuses a path past the `sun_path` cap (`RUN_SUN_PATH_MAX`), and a deep
`TMPDIR` would cross that cap on the box while the local one does not. The rule: the box's `TMPDIR` is never longer
than the shortest `TMPDIR` a fleet session uses, and the parity fixture in §5 binds a socket at the longest name the
suites build, under `TMPDIR` and under `/tmp`, on both sides. `/tmp` on a tmpfs (`TemporaryFileSystem=/tmp` in place
of `PrivateTmp`) is a config option, off by default: it removes the fsync cost but changes free space and timing, so
it waits for the parity check (§6) to pass with it on.

### 2.3 Secrets and isolation (D-TBD-testbox-env, D-TBD-testbox-privilege)

The tests need no secrets: they run against fixture HOMEs, with `gh`, `curl`, `ssh`, the system managers and `tmux`
servers contained (CLAUDE.md, "FIXTURE HOMEs only"). The test box is built so that holds by construction, not by
convention. The rule behind every point below: **everything the submission controls runs as the slot's user**, which
is the install's lifecycle scripts, the builds and the tests, and never as the service.

- **No credentials on the box** beyond the service's own token file and, for a private repository, a read-only deploy
  key used only by the mirror fetch. No `gh` login, no account files, no provider keys. The service user owns those
  files (0600) and runs nothing from a submission.
- **A user per slot.** Slot `n` runs as `ccrc-tb-<n>` (the prefix is config), an unprivileged system user with no
  login shell, no sudo and no group shared with the service except a read group on the mirror's object store. The
  slot's directory (§2.2: its checkout, `node_modules`, npm cache and run home) is owned by that user and mode 0700;
  its `TMPDIR` is in the unit's private `/tmp`. HOME is emptied at the start of each run, with no `~/.gitconfig`
  credential helper and no ssh agent. Concurrent runs are different uids with no writable path in common, so they
  cannot signal, trace or read each other.
- **`/proc` shows the run only.** The units set `ProtectProc=invisible` and `ProcSubset=pid`, so a `/proc` walk sees
  the slot user's own processes and nobody else's, not even the service's. Locally the same walks see every process of
  the session's uid; the tests already filter to their own trees, and the parity check (§6) is what shows they do.
- **Static units, one narrow polkit rule.** The service never builds a unit's properties. The box installs two
  template units, `ccrc-testbox-prepare@<n>.service` and `ccrc-testbox-run@<n>.service`, in the system manager, each
  with `User=ccrc-tb-%i`, the slot's slice, its `IPAddressDeny`/`IPAddressAllow`, `ProtectProc`, `NoNewPrivileges`,
  `PrivateDevices`, `PrivateTmp=yes` (§2.2), `ProtectSystem=strict` with the slot directory as the only
  `ReadWritePaths`, and a fixed `ExecStart` of the service's runner script. The run unit adds the read-only rule
  below. The run's argv and environment reach the runner as a spec file the service writes under
  `<CCRC_TESTBOX_ROOT>/specs/<n>`, a directory the service owns and the slot user can read but not write. A polkit rule lets the service user
  `start`, `stop` and read the state of units whose name matches `^ccrc-testbox-(prepare|run)@[0-9]+\.service$`, and
  nothing else. `IPAddressDeny` needs the system manager (a user manager does not enforce it), which is why these are
  system units; polkit cannot constrain transient-unit properties such as `User=`, which is why they are static
  templates. The installer writes the units, the users and the rule; that is box setup, not session code.
- **A fixed environment.** The runner starts from an empty environment plus: `PATH` (the box's tool directory first),
  `HOME`, `TMPDIR`, `LANG`, `TERM`, the worker-count names (§2.5), and the names in a forward allowlist (config, default `CCRC_HISTORY_BASE
  CCRC_LEDGER_BASE`, resolved to shas as §2.1 says). The session's environment is never forwarded: on the fleet host it
  carries the session's account settings and tokens. `CI` is forwarded only if the local invocation had it, so the
  answer matches the local one.
- **Network.** The run unit: `IPAddressDeny=any`, `IPAddressAllow=127.0.0.1/32 ::1/128`. The prepare unit: the same
  plus the registry proxy's address. The proxy is a caching read-only npm registry run by the service user on a
  loopback address of its own (config, default `127.0.0.2:4873`), so the run unit, which allows only `127.0.0.1`, cannot
  reach it. The proxy is the only thing with egress to the upstream registry. The mirror fetch is the service's and
  runs nothing from a submission.
- **No run leaves state for the next.** A slot's checkout persists across runs from different sessions, so anything a
  run can write that the next prepare does not rebuild would make one session's result depend on another's
  submission. The run unit therefore sees each package's `node_modules` and each declared build output read-only
  (`ReadOnlyPaths=`), and gets an empty tmpfs over each package's `node_modules/.vite` and `node_modules/.vitest`
  (`TemporaryFileSystem=`), where vite's dependency optimiser and vitest's results cache write; the prepare unit
  creates those mount points. The per-slot paths come from the repository table: the installer writes them into a
  drop-in per slot instance (box setup, not session code). The prepare unit, which installs and builds, keeps them
  writable; everything else the run can write in the checkout is either tracked (the reset puts it back) or
  gitignored and removed by the next prepare's `git clean -ffdx`. A test that writes under `node_modules` fails with
  `EROFS` on the box where it passes locally; the parity check (§6) names it, and it is a test that writes outside its
  fixture HOME.
- **Containment of the units.** Each slot's units run in that slot's slice with its own `MemoryMax`, `MemorySwapMax`
  and CPU quota (config), so a runaway test or install cannot take the service down with it.
- **The snapshot is checked before it leaves.** Gitignored files never enter it (§2.1), and the size caps keep large
  untracked files out. On top of that the wrapper refuses a snapshot whose untracked, unignored paths match a deny list
  (config; default `*.pem`, `*.key`, `.env`, `.env.*`, `id_*`, `*.p12`) and names the paths. A refusal falls back to
  local, with the reason.
- **Results.** The log the box keeps is the run's own output, kept for the retention time and deleted with the refs. It
  is shown only to the session that submitted it. It passes through no other surface, so no new egress mask is needed;
  the card in §2.7 shows counts, never log text.

Two checks that nothing leaks become tests of the service (§5): a fixture run that prints its whole environment, its
HOME listing and the processes its `/proc` walk sees while another slot runs a sleeper, compared against the allowlist
and its own unit; and a fixture install whose lifecycle script tries the upstream registry directly, a public address,
the service's token file and another slot's npm cache, each of which must fail. A third test covers carry-over: a
fixture run writes a file under `node_modules`, under `node_modules/.vite` and under `/tmp`, and the next run in the
same slot, from another fixture session, must see none of them.

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
| the snapshot is under its size caps | §2.1 | `test box: snapshot too large (<path> <size>)` |
| the index has no unmerged entries | §2.1 | `test box: unmerged paths` |
| the command is one the box runs (§2.5) | the repository table | `test box: <command> runs locally` |
| the file set's estimated time is under the budget (§2.5) | the wrapper's estimate | `test box: over budget (<estimate>)` |

The reason is the first line the session sees and is repeated in the final summary, as `ran on: local (fallback: …)`.
A remote run's summary says `ran on: test box`. Every row falls back the same way for the bare `ccrc test` and for
`--local`; only an explicit `--remote` refuses instead of falling back, and only for the budget row (§2.5). A fallback
never changes the exit status: it is the local run's, so the coordinators' counted exits read a fallback as the run it
was.

**The parity reference.** "The same answer as locally" means the same answer as a local run **at the lockfile
install**: each package's `node_modules` as `npm ci` makes it from the committed lockfile, the box's starting point.
A session's own installs can differ from that (a stale install, a package installed but not saved, a lockfile edited
since the last install). Before a remote run the wrapper compares, per package, the `packages` entries of
`node_modules/.package-lock.json` (the hidden lockfile npm writes) against those of the package's `package-lock.json`,
name, version and integrity, and on a difference prints `local deps differ from lockfile (<package>: <first entry>)`
in the first line and the summary. The remote run goes ahead: its answer is the reference one, and the line tells the
reader why a local run might disagree. The comparison reads two files per package and runs no npm.

**No `node_modules` to fall back to.** A worktree whose ignored dependencies #1772's lifecycle shed, or one never
installed, has no `node_modules` for the local path. A fallback then runs `npm ci` for the missing packages inside the
tests slice first, through the admission queue, and says so: `test box: <reason>; installing <packages> locally`.
`CCRC_TESTBOX_FALLBACK_INSTALL=refuse` makes it refuse instead, with `test box: <reason>; no local deps for
<packages>` and the refusal exit status of §2.5 (OA-T10).

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
count. Over the budget (config, default 15 min) the wrapper does not start a remote run, and what it does depends on
the form:

- **bare `ccrc test <argv>`**: it falls back to the local slice like every other check in §2.4, with
  `test box: over budget (<estimate>)` in the first and last line, and prints the CI command
  (`gh workflow run ci.yml --ref <branch> -f mode=full` for the full suite) as a hint. Exit status: the local run's.
  So a file set step 1 ran locally still runs, and its exit means what it meant.
- **explicit `ccrc test --remote …`**: the session asked for the box only, so the wrapper runs nothing, prints the
  reason and the CI command, and exits with the refusal status, **75** (`EX_TEMPFAIL`). No test command this wrapper
  runs exits 75 (vitest, `tsc` and npm give 0, 1 or 2 and pass a child's status through), so a counted exit can tell
  "refused, nothing ran" from a red run. Step 1's exit contract reserves 75 for this (§3.1). The other refusals in
  this spec (`CCRC_TESTBOX_FALLBACK_INSTALL=refuse`, `CCRC_TESTBOX_LOST_RUN=fail` before anything ran) use it too.

**The command.** `ccrc test --remote <package> -- <argv>`. The repository table lists, per package, the command heads
the box runs (default for ccrc-pwa: `./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`, `npm test`,
`npm run test:browser`); anything else falls back to local with its reason. Step 1's bare `ccrc test <argv>` gains a
default: remote when the switch is on and the checks in §2.4 pass, local otherwise; `--local` forces the slice.

**The worker count is always set.** `server/vitest.config.ts` sets `maxWorkers: '40%'`, a share of the cores the
process sees, so a run without a flag would take 6 workers on a 16-vCPU box inside a unit capped at 350% CPU, and a
count unlike the local one. The runner therefore always sets the count: `VITEST_MAX_WORKERS`, `VITEST_MAX_THREADS` and
`VITEST_MAX_FORKS` (the names #389 sets; vitest 4 applies the first after config resolution, so it overrides the
config's share, and earlier majors read the other two) to `CCRC_TESTBOX_WORKERS`, and for a `vitest` command head an
explicit `--maxWorkers=<n>`. A `--maxWorkers` the session passes is kept when it is lower. The summary records it as
`workers: <n>`, and when the local run of the same command would get a different count (the session's own
`VITEST_MAX_WORKERS`, else the config's share of the local cores) it adds `local default: <m>`. The parity check (§6)
runs its local leg with the same count as the box.

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

Recommendation: **A.** The wrapper's remote arm is the client; the run frames are `run.submit` (the run id, the branch,
which scratch refs were pushed, the build outputs present locally, the argv and the forwarded names), `run.log`,
`run.summary`, `run.cancel` and `status`. The service's own pieces (the slot manager, the key comparison, the queue) are
L1 deciders with L3 adapters for git, npm and systemd, like the rest of `agent/`.

## 3. What this needs from others

### 3.1 From step 1 (#1694)

- the wrapper's file, its argv shape (`ccrc test [--local|--remote] <package> -- <argv>`) and its exit-status contract,
  with one status reserved for "refused, nothing ran" (75, §2.5) that no test run gives;
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
| `CCRC_TESTBOX_GIT_URL_BASE` | unset | the push URL prefix of the box's mirrors (for example `ssh://<user>@<host>/`); the box's status answer gives each repository row's mirror path, and the wrapper joins the two, so one key serves every repository |
| `CCRC_TESTBOX_GIT_KEY` | `~/.ccrc/testbox-push.key` | the ssh key for that push (0600); the mirror accepts it for `refs/ccrc-test/*` only |
| `CCRC_TESTBOX_UNTRACKED_FILE_MAX` | `5M` | §2.1 |
| `CCRC_TESTBOX_SNAPSHOT_MAX` | `64M` | §2.1 |
| `CCRC_TESTBOX_STATUS_DEADLINE` | `3s` | §2.4 |
| `CCRC_TESTBOX_RECONNECT_DEADLINE` | `60s` | §2.4 |
| `CCRC_TESTBOX_LOST_RUN` | `local` | `local` or `fail` (§2.4) |
| `CCRC_TESTBOX_QUEUE_LIMIT` | `20` | §2.4 |
| `CCRC_TESTBOX_QUEUE_WAIT` | `10m` | §2.8 |
| `CCRC_TESTBOX_BUDGET` | `15m` | §2.5 |
| `CCRC_TESTBOX_DENY_GLOBS` | `*.pem *.key .env .env.* id_* *.p12` | §2.3 |
| `CCRC_TESTBOX_POLL` | `30s` | §2.7 |
| `CCRC_TESTBOX_FALLBACK_INSTALL` | `install` | `install` or `refuse`, for a fallback with no local `node_modules` (§2.4) |

| key (test box) | default | meaning |
|---|---|---|
| `CCRC_TESTBOX_SLOTS` | `2` | slots per repository; a 16-vCPU box sets 4 |
| `CCRC_TESTBOX_WORKERS` | `2` | vitest workers per slot, always set by the runner (§2.5); a 16-vCPU box sets 3 |
| `CCRC_TESTBOX_RUN_TMPDIR` | `/tmp/r` | the run's `TMPDIR`, inside the unit's private `/tmp`; never longer than a fleet session's (§2.2) |
| `CCRC_TESTBOX_SLOT_MEMORY_MAX` | `4G` | per-slot `MemoryMax`; a 30 GB box sets 6G |
| `CCRC_TESTBOX_SLOT_SWAP_MAX` | `1G` | per-slot `MemorySwapMax` |
| `CCRC_TESTBOX_SLOT_CPU_QUOTA` | `200%` | per-slot CPU quota; a 16-vCPU box sets 350% |
| `CCRC_TESTBOX_ROOT` | `~/.ccrc/testbox` | mirrors, slots, logs |
| `CCRC_TESTBOX_REPOS` | `~/.ccrc/testbox-repos.d` | the repository table (§2.6), including each row's declared build outputs, their build commands and source paths (§2.2) |
| `CCRC_TESTBOX_FETCH_EVERY` | `5m` | mirror fetch timer |
| `CCRC_TESTBOX_RETENTION` | `24h` | result, log and ref lifetime |
| `CCRC_TESTBOX_ENV_FORWARD` | `CCRC_HISTORY_BASE CCRC_LEDGER_BASE` | §2.3; a ref-valued name is resolved to a sha and pushed (§2.1) |
| `CCRC_TESTBOX_RUN_USER_PREFIX` | `ccrc-tb-` | §2.3; slot `n` runs as `<prefix><n>` |
| `CCRC_TESTBOX_REGISTRY_PROXY` | `127.0.0.2:4873` | §2.3; the registry proxy's own loopback address, reachable from the prepare unit only |
| `CCRC_TESTBOX_REGISTRY_UPSTREAM` | `https://registry.npmjs.org` | §2.3; the proxy's upstream |
| `CCRC_TESTBOX_TMPFS` | `off` | §2.2; `on` mounts the units' `/tmp` as a tmpfs instead of `PrivateTmp` |
| `CCRC_TESTBOX_LOG_TAIL` | `40` | §2.5 |
| `CCRC_CHROME` | unset | Chrome or Chromium binary for the browser tests |

## 5. Acceptance, mapped

| acceptance (#1695) | how it is shown |
|---|---|
| the same pass/fail answer as locally | the parity check in §6, before the switch is armed; a fixture test of the wrapper that compares the summary of a remote and a local run of the same snapshot; and a git-state fixture test: a fixture repository with an `origin/main`, a branch two commits ahead, one staged, one unstaged and one untracked change, where a probe prints `rev-parse HEAD`, `--abbrev-ref HEAD`, `rev-parse origin/main`, `merge-base origin/main HEAD`, `diff --name-only <mb> HEAD`, `rev-list --count <mb>..HEAD` and `status --porcelain`, and a dirty-tree guard (a copy of `consolidation-path-guard`'s diff check) runs; local and box output must be byte-identical, run once with the session on a newer and once on an older `origin/main` than the mirror's; a socket fixture that binds a unix socket at the longest name the suites build (the run-tmp `live.sock` path and a `delegation-rig`-shaped `/tmp/dlgt-*` tmux socket), once under `TMPDIR` and once under `/tmp`, must bind on both sides; and a worker fixture whose test prints vitest's resolved worker count must print `CCRC_TESTBOX_WORKERS` on the box with no flag passed |
| a slot stays usable across mirror `gc` (§2.1) | a service test: run a fixture submission with a dirty tree in slot 1, expire its refs, `git gc --prune=now` the mirror, then run a second submission in slot 1; the prepare and the run must pass and `git fsck` in the slot must report no missing object |
| no run's result depends on an earlier run (§2.3) | the carry-over fixture test in §2.3 |
| coding sessions see no test-run memory or CPU | on the fleet host a remote run costs a `status`, a `git add -A` that reuses the session's stat cache, one push and a stream: measured in the build as the wrapper's own peak RSS and CPU time, with a ceiling in a test, on a dirty tree and on one with a file over the cap (which must not be hashed); the tests slice stays empty while every run is remote |
| no credentials reachable, no outbound network | the env, `/proc` and install fixture tests in §2.3 |
| when the box is down, runs fall back and say so | a fixture test per row of §2.4's table: the reason in the first and last line, the local slice used, the exit status the local run's; for the budget row also the explicit `--remote` form, which must run nothing and exit 75; and a fixture worktree with no `node_modules`, under each value of `CCRC_TESTBOX_FALLBACK_INSTALL` |
| local deps that differ from the lockfile are named | a fixture package whose `node_modules/.package-lock.json` has one entry at another version: the wrapper prints `local deps differ from lockfile (<package>: <entry>)` and still runs remote |

## 6. The parity check, before arming

Before the operator turns the switch on, a one-off parity run: for the 20 most recent merged PRs, the wrapper runs each
PR's CI-selected server files plus `typecheck-tests` and the browser suite twice on the same snapshot, once locally in
the slice and once on the test box, and compares per-file pass/fail **and per-test skip counts and names**, so a case
one side skips (a missing build output, a platform gate) shows up even when both files pass. Both sides build the
declared outputs fresh first, the local leg runs on a fresh worktree at the lockfile install (`npm ci` per package,
the parity reference of §2.4), and both legs run with the same worker count, `CCRC_TESTBOX_WORKERS` (§2.5). A disagreement in a file on the known-load-flake list (CLAUDE.md) is re-run alone on both
sides before it counts. Any other disagreement blocks arming and is reported by file. The same run repeated with
`CCRC_TESTBOX_TMPFS=on` decides that option.

## 7. Why it is safe

- Nothing on the fleet host changes until the switch is armed; with no URL configured the wrapper is step 1's.
- The fallback is the path that exists, and every fallback says why.
- No secret is on the box, none is forwarded, the run cannot reach the network, the install reaches only a local
  registry proxy, every piece of submitted code runs as a slot user that cannot see other slots, and the snapshot is
  checked first.
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
| OA-T6 | The units' private `/tmp` on tmpfs on the box (§2.2) | **off until §6 passes with it on**, then on |
| OA-T7 | Arming: the switch on after §6 passes, and step 1's local slice kept as the fallback for good | **yes** |
| OA-T8 | When the old box stops being the rollback source of the fleet move and is rebuilt as the test box | **after** the fleet host has run 7 days with no rollback-class incident **and** a full snapshot of the old box is taken and verified restorable; the snapshot stays the rollback source for 30 more days, then is deleted by the operator |
| OA-T9 | Gitignored build outputs the tests read (§2.2): the box builds the ones the local tree has, or both sides run without them | **the box builds the ones the local tree has**; the other rule cannot hold locally |
| OA-T10 | A fallback in a worktree with no `node_modules` (shed by #1772, or never installed) (§2.4): install the missing packages inside the tests slice, or refuse with exit 75 | **install inside the slice**, said out loud; the session needs its answer, and the slice caps the install |

## Deviations found

New design decisions, numbered `D-TBD-<slug>` because the allocator was not reachable from the session that wrote this
spec; they are replaced by issued numbers before landing:

- **D-TBD-testbox-transport**: the session's HEAD, branch, resolved `origin/main` and staged and worktree trees, built
  from a copy of the session's index and pushed to `refs/ccrc-test/<run-id>/*` on the box's mirror (a plain bare
  clone, never `--mirror`); the slot reproduces them as uncommitted state; size caps; never to the clone's own remotes;
  rsync rejected (§2.1).
- **D-TBD-testbox-slot-invariant**: every object a slot names is reachable from a mirror ref at every moment: no slot
  reflogs or gc, a per-slot idle ref, a reset after every run and before every prepare, and run refs kept until the
  slot that ran them has reset (§2.1).
- **D-TBD-testbox-slots**: warm per-repository slots as shared clones of the mirror, with per-package installs keyed by
  lockfile hash, node version and platform, and the declared build outputs built when the local tree has them; linked
  worktrees, shared, hardlinked and overlay trees rejected; a per-slot npm cache, the registry proxy the only shared
  warm layer (§2.2).
- **D-TBD-testbox-tmp**: a private `/tmp` per unit and a short run `TMPDIR` inside it, never longer than a fleet
  session's (§2.2, §2.3).
- **D-TBD-testbox-no-carryover**: the run unit sees `node_modules` and the build outputs read-only, with an empty
  tmpfs over the vite and vitest caches (§2.3).
- **D-TBD-testbox-env**: the run's fixed allowlisted environment, a user per slot with an empty HOME, `ProtectProc`,
  loopback only for the run, the registry proxy only for the install, and the snapshot deny list (§2.3).
- **D-TBD-testbox-privilege**: static `ccrc-testbox-{prepare,run}@<n>` system template units with fixed users, started
  by the service through one polkit rule limited to those names (§2.3).
- **D-TBD-testbox-fallback**: the fallback checks (the budget among them), their printed reasons, the lost-run rule
  and the install-or-refuse rule for a worktree with no `node_modules` (§2.4).
- **D-TBD-testbox-parity-reference**: the reference answer is a local run at the lockfile install; the wrapper names
  local installs that differ from the lockfile (§2.4).
- **D-TBD-testbox-refusal-exit**: exit 75 means "refused, nothing ran", reserved in step 1's exit contract (§2.5).
- **D-TBD-testbox-routing**: what runs on the box, what stays with CI, the time budget, the command heads and the
  worker count the runner always sets (§2.5).
- **D-TBD-testbox-status**: the `testbox-remote-live` switch row, the `testbox` agent op and the Settings card (§2.7).
- **D-TBD-testbox-service-home**: the test service as a second entry point of the agent package (§2.9).
