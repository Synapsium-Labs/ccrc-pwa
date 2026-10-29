# The test box: test runs off the fleet host, results streamed back to the session

**Spec** · 2026-10-28 · Status: draft for review, rev 7 and its close-out (no further design rounds). It designs #1695 (step 2 of moving test runs off the fleet
host). It builds on #1694 (step 1: the capped tests slice, the fleet-wide admission queue and the `ccrc test` wrapper),
which is not built yet; this spec names what it needs from step 1 in §3.1. Docs only: no code ships with it.

**Revisions.** Rev 1 reproduced the session's git state instead of committing the dirty tree. Rev 2 added the private
`/tmp` and the parity reference. Rev 3 named the box and made the push key create-only. Rev 4 hardened reused slots
(a read-only, rebuilt `.git`, self-healing resets). Rev 5 follows the design ruling of 2026-10-28: a short threat model
puts the work in the good-faith scope of test containment (#1785), and reused slots are replaced by **disposable
runs**: every run gets a fresh directory, a fresh shared checkout and a copy-on-write clone of a pristine install, and
the directory is deleted after the run. That removes the slot reset, the idle refs, the `.git` rebuild and check, the
recorded deps and build keys, the retry-then-rebuild loop and the Rebuild control. The concurrency limit becomes a run
count, the push gains a pre-receive refusal of a reused run id, and §4 states what a fresh run costs against the
15-minute budget. Rev 6, under the same threat model, keeps the box's tools in step with the fleet host: the ccrc
release pins the node, npm, Chrome for Testing and python3 versions it was verified with, the update lane installs
them on the box from their official download hosts when it rolls the fleet host, and a mismatch marks the box
`degraded` with a **Bring tools up to date** control (§2.10). It also gives the pristine install the run's fresh
directory, root cleanup and caps plus a retry with backoff, makes `runs/<k>` root's, adds `RemoveIPC=yes`, collects
the log and the reporter file outside the run directory, moves the npm settings into a root-owned `npmrc`, and
splits the cost table by when each cost is paid. Rev 7 closes the last review's three points and ends the design
rounds: the box installs the versions the fleet agent **measures on the fleet host** (node, npm, Chrome, python3, git,
tmux), not versions recorded from CI, and the box gets a new test-service release as the same tarball the fleet
host installs, fetched from the release host on the update lane's signal. The close-out (2026-10-29) makes §2.10 match
the code and adds no key machinery: the box verifies a release exactly as the fleet host's update lane does today
(`SHA256SUMS`, then the tarball's Sigstore provenance bundle through the installed `deploy/verify-provenance.mjs`,
then the tarball's `MANIFEST`), a node download is checked against nodejs.org's `SHASUMS256.txt`, the new service takes
over only after the tools are switched, and the only version difference that makes runs fall back is §2.4's version
row; any smaller difference shows on the card only. What is still open goes to the build plan (§9).

**Related:** #1694 (step 1), #1785 (test containment and its good-faith scope), #389 (the vitest worker cap in the
session environment), #1752 (per-box sizes as ccrc settings, the pattern every key below follows), #1772 (the worktree
`node_modules` lifecycle), #1274 (CI workers per runner), `2026-09-23-ci-test-selection-design.md` (the selection map
and the per-file durations the daily run publishes), `2026-10-23-fleet-disk-retention-design.md` §2.5 (the agent's
`disk` op, the shape §2.7 copies), `2026-08-10-architecture-ddd-clean-solid.md` (rings).

## In short

On 2026-10-28 about 20 coding sessions on the fleet host each ran vitest (3 workers), tests-inclusive `tsc`, mutation
loops and Chrome browser tests, and one session ran deliberate CPU burners. Load reached 80 on 16 threads, the agent was
starved, and the server showed the fleet host as unreachable. Test fsyncs on the host's mirrored consumer NVMe also
raise the io-pressure banner. A box-level CPU guard holds meanwhile (a session-slice CPU quota and a raised agent CPU
weight, as box config, not in this tree).

The test box is a second, separate box that runs those suites instead. The design, one line per question:

- **The box: the old fleet host, rebuilt clean.** The Hetzner CX53 the fleet moved off (16 vCPU, 32 GB) is today the
  frozen rollback source of that move. Nothing is installed on it until it stops being that; then it is wiped,
  reinstalled from a clean image and joined to the tailnet under a new identity (§2.0).
- **Threat model: cooperative sessions.** The isolation prevents accidents, keeps every fleet secret off the box and
  keeps the box from reaching the fleet; a hostile session is out of scope (§2, "Threat model").
- **Transport: git, never rsync.** The wrapper sends the session's HEAD sha, its branch name, its resolved
  `origin/main` sha and the dirty state (the staged tree and the worktree tree, built from a copy of the session's
  index, so the session's index and tree are untouched). It pushes them over the tailnet to create-only scratch refs in
  a mirror on the test box. The run's checkout has HEAD on a branch of the same name, `origin/main` at the session's sha
  and the dirty state as uncommitted changes, so `HEAD`, the branch, `git status` and every
  `merge-base(origin/main, HEAD)..HEAD` range read the same as locally (§2.1). Scratch refs never go to `origin`: the
  repository is public.
- **No carry-over by construction.** Every run gets a disposable directory: a fresh shared checkout from the mirror,
  and `node_modules` as a copy-on-write clone of a pristine install the service builds once per lockfile, node version
  and platform. Build outputs are built inside the run. The directory is deleted after the run (§2.2).
- **Secrets: none on the box, none in the run.** Every piece of session-controlled code (the install's lifecycle
  scripts, the builds, the tests) runs as an unprivileged run user, in a static unit, with a fixed allowlisted
  environment and an empty HOME. The run has loopback only; an install reaches a local registry proxy and nothing
  else. The session's environment is never forwarded (§2.3).
- **Tools: the fleet host's own versions, installed by the update lane.** The fleet agent measures the node, npm,
  Chrome, python3, git and tmux versions its host runs; rolling the fleet host also brings the box the same release,
  verified as the fleet host's update lane verifies it, and installs exactly those versions from their official
  download hosts. A mismatch marks the box `degraded`, and the card's **Bring tools up to date** runs the same step
  (§2.10).
- **Fallback: the local slice, said out loud.** Remote off, box unreachable, a tool version that differs at the
  version row, or a queue over its limit: the wrapper runs the same command in step 1's slice and says why, in the
  first line and the last (§2.4).
- **GitHub CI keeps the full suites.** The full server suite is about 4.4 hours of file time (§1.1); it stays with the
  merge queue and `workflow_dispatch`. The test box takes single files, file sets under a time budget, the
  tests-inclusive typecheck, mutation loops and the browser tests (§2.5).
- **Placement: per repository, by config.** A repository uses the test box when the test box's repository table lists
  it. ccrc-pwa is the first row (§2.6).
- **Operator controls: one switch, one card.** A switch turns remote runs on or off; a card in Settings shows the
  box's state, runs and queue depth, read through a new agent op shaped like `disk` (§2.7).

Everything box-specific is a ccrc setting with a neutral default (§4). Seven operator decisions close the spec (§8),
including when the old box stops being the rollback source.

## 1. Measured

Code citations are to `origin/main` `379da862c`. CI figures are from merge-queue run 40685460825 (full suite, green,
2026-10-28) and its `times-*` artifacts. Tree sizes and the run costs in §4 were measured on a checkout of that commit
on a workstation. No box was touched.

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
| a real `tmux` binary (contained sockets, never a live server) | ≈97 | install tmux at the fleet host's version (§2.10) |
| `systemd-run`/`systemctl` named (poisoned to fail, per `ghContainedEnv` and the containment builders) | ≈91 | nothing real is called; the poison must still resolve first on PATH |
| a `/proc` walk | ≈87 | Linux; and the walks see every same-uid process, so a run user per concurrent run and `ProtectProc=invisible` (§2.3) |
| Linux-only (`skipIf`/`runIf` on platform) | ≈46 | Linux, like the fleet host |
| loopback listeners, free ports | ≈85 | loopback only; no outbound network needed |
| a literal `/tmp/` path (`delegation-rig` makes `mkdtempSync('/tmp/dlgt-')` because a unix socket path is capped near 108 bytes; `run-tmp`, `shutdown-seal`) | 29 name `'/tmp/…'`; tmux's own socket dir is `/tmp/tmux-<uid>` when `TMUX_TMPDIR` is unset | a writable private `/tmp` in both units and a `TMPDIR` no longer than the local one (§2.2, §2.3) |
| `strace` | ≈9 | install strace |
| `python3` (asserted present when `CI` is set) | ≈14 | install python3 at the fleet host's version (§2.10) |
| the real repository's git history or `origin/main` (`topology-clean`, `deviation-refs`, `consolidation-path-guard`, the ratchets) | about a dozen | the run needs a real clone whose HEAD and `origin/main` are the session's own shas; `consolidation-path-guard` diffs `$(git merge-base origin/main HEAD)..HEAD` and `deviation-refs` walks that range, so dirty changes must stay uncommitted (§2.1) |
| the guards' base overrides `CCRC_HISTORY_BASE` (`topology-clean`, `consolidation-path-guard`) and `CCRC_LEDGER_BASE` (`deviation-refs`) | 3 | forwarded by default, resolved to a sha first (§2.1, §2.3) |
| the real repository's branch name or `git status` (`buildinfo`, `build-release`) | a few | the checkout is on a branch of the session's name with the session's staged, unstaged and untracked state (§2.1); the many `ccd-*` files that read branches do it in fixture repos and need nothing |
| gitignored build outputs (`server/dist`, `server/dist-pwa`, `agent/dist`): `auth-gate` runs cases only when `server/dist-pwa/index.html` exists, `authFixtures` imports from `server/dist/...` | 23 files name one of the three paths; most build their own copy under a fixture HOME | the snapshot never carries them (they are ignored), so the run builds each one the local tree has (§2.2) |
| real Chrome (`CCRC_CHROME`; "throws on a box with no Chrome: red, never skipped") | 36 pwa browser files | install Chrome for Testing at the fleet host's version, path in config (§2.10) |

CI's own list (`.github/actions/server-deps`) is the same: `tmux jq strace python3` on Linux, plus `bash tmux flock jq
coreutils` on macOS. The suites read almost no ambient environment: `PATH`, `HOME`, `TMPDIR`, `LANG`, `CI` and a few
test-owned `CCRC_*` names. `CI` changes about 17 assertions (it makes some presence checks strict), so the test box does
not set it unless the local run had it (§2.3).

### 1.3 Size of a ccrc-pwa worktree and its installs

| piece | size |
|---|---|
| tracked tree (4,105 files) | ≈173 MB, of which `docs/` ≈85 MB and `server/test` ≈50 MB |
| packed repository objects | ≈480 MB (shared by every checkout of one mirror) |
| `server/node_modules` (225 lock entries) | ≈188 MB, ≈6,000 files |
| `pwa/node_modules` (647) | ≈218 MB, ≈20,500 files |
| `ui/node_modules` (810) | ≈262 MB, ≈18,000 files |
| `agent/node_modules` (116) | small; not installed on the measuring checkout |

A pristine install set is therefore about 0.7 GB. A run's clone of it shares its data blocks (§2.2), so a run's own
disk is the tracked tree, its build outputs and the clone's metadata. A snapshot push is a delta against the mirror:
for an ordinary change, kilobytes to a few megabytes.

### 1.4 How often the installs change

Commits to `origin/main` in the 30 days to 2026-10-28: 912. Of those, lockfile changes: `server` 5, `pwa` 5, `ui` 3,
`agent` 1. A pristine install exists for nearly every run; a branch that changes a lockfile pays one `npm ci` for that
package inside its first run, while the service builds the pristine install for the next.

### 1.5 What step 1 gives this design

#1694 ships `ccrc-tests.slice` (a hard `MemoryMax`, bounded swap, low `CPUWeight`), a `ccrc test` wrapper in its own
file that runs a command in that slice with the session's environment, a fleet-wide admission queue for heavy runs
(lock files in the registry, a dead holder frees its place), skill routing to the wrapper, a deny rule on bare
`systemd-run` of test commands, a doctor line and a UI card. None of it is on `main` yet. This spec adds the remote arm
to that wrapper and reuses the slice as the fallback unchanged.

## 2. Decisions

### Threat model

Sessions are cooperative, not adversaries: this is the good-faith scope of test containment (#1785). The isolation
has three goals:

1. **no accidental carry-over** between runs, so a remote answer equals a local one;
2. **no fleet secret** ever on the box;
3. **no reach back**: the box cannot reach the fleet host or anything else on the tailnet, and reaches the internet
   only for what it needs.

A deliberately hostile session (forging refs, planting git files to poison a later run, attacking the push key) is out
of scope. The box holds no secrets and is rebuildable, so a hostile run can at worst spoil the box's own answers, and
the merge-queue CI, not the test box, is the authority for landing. The measures below that look like defence
(separate run users, a private network, create-only refs) are there because accidents take those shapes too: a test
that walks `/proc`, a listener left open, a wrapper bug that reuses a run id.

### 2.0 The box

The test box is the old Hetzner CX53 the fleet host moved off: 16 vCPU and 32 GB, the size §4's "16-vCPU box" values
are written for. Today it is the frozen rollback source of that move, so this spec installs nothing on it and no build
step touches it while it holds that role. It becomes the test box only when the operator retires it as the rollback
source (§8, row 1), and then it is **rebuilt, not reused**: it held the fleet's account credentials, tokens and work
data, and goal 2 cannot be shown on a disk that once held them. The rebuild is a fresh OS from a clean image, the fleet
work volume detached and not reattached, a new tailnet identity, and `CCRC_TESTBOX_ROOT` on its own XFS filesystem made
with `reflink=1` (§2.2). The tailnet ACL lets the fleet host reach the box's service port and ssh port, and lets the box
reach nothing on the tailnet, the fleet host included. The box's egress allowlist (`CCRC_TESTBOX_EGRESS_ALLOW`) names
its destinations by host name, and nothing else is reachable apart from the tailnet client's own coordination traffic:

| name | for | who uses it |
|---|---|---|
| `github.com` | the mirror fetch | the service |
| the npm upstream (`CCRC_TESTBOX_REGISTRY_UPSTREAM`, default `registry.npmjs.org`) | packages and npm itself | the registry proxy only |
| the release host, the one the fleet host's update lane fetches from | the ccrc release tarball, its `SHA256SUMS` and its provenance bundle (§2.10) | the tools unit only |
| `nodejs.org` | the node release and its checksum file (§2.10) | the tools unit only |
| `storage.googleapis.com`, the Chrome for Testing download host | the Chrome for Testing build at the fleet host's version (§2.10) | the tools unit only |
| the OS package mirror (`CCRC_TESTBOX_OS_MIRROR`, default the distribution's own) | python3, git, tmux, strace, jq and Chrome's system libraries (§2.10) | the tools unit only |

A timer resolves the names into the firewall's address sets, and each rule also matches the sending unit (its
cgroup), so a run, prepare or install unit (which reach loopback only, §2.3) gains nothing from the list. A name served from a
shared CDN resolves to addresses that serve more than that name; under the threat model that is accepted, because no
session-controlled code runs as a user the rules let out. The service and the mirror's ssh listen on the tailnet address only, never on a
public interface or on loopback, so a run's loopback-only network (§2.3) cannot reach them either.

### 2.1 Transport: the session's git state pushed to scratch refs

The state is sent, not a commit of it: a commit of the dirty tree would put working-tree changes into HEAD, so every
guard that measures `merge-base(origin/main, HEAD)..HEAD` would see one extra commit.

**What a submission carries.** Four things, each read on the fleet host without touching the session's index, stash or
tree:

| item | how the wrapper reads it | scratch ref on the box |
|---|---|---|
| HEAD | `git rev-parse HEAD` | `refs/ccrc-test/<run-id>/head` |
| the branch | `git symbolic-ref --quiet --short HEAD`; empty means detached | sent in the run frame, no ref |
| the base | `git rev-parse --verify origin/main^{commit}`; unresolved means none, and the run then has no `origin/main` either | `refs/ccrc-test/<run-id>/base` |
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
mirror's gets its own. The mirror URL is per repository (§4).

**The push user and the create-only rule.** The push lands as `ccrc-tb-push` (config), a system user that exists only
for this: its login shell is `git-shell`, and its one `authorized_keys` entry is
`restrict,command="<forced-command script>" <the fleet host's push key>`. The forced command runs
`git-receive-pack '<path>'` only when `SSH_ORIGINAL_COMMAND` is exactly that and `<path>` is a mirror the repository
table lists, and exits non-zero on anything else. The mirror is `core.sharedRepository=0664` with group `ccrc-tb-git`
(the service and the push user), so the service's fetch and `gc` can rewrite pushed objects; run users read the mirror
as others. The mirror's `config` and its hooks directory (named by `core.hooksPath`, outside the mirror) are root's.

The mirror's `pre-receive` hook refuses the whole push unless every ref it names is a **creation** under one
`refs/ccrc-test/<run-id>/`, where `<run-id>` is 32 hex characters the wrapper draws at random, **and no ref under that
prefix already exists**. So a wrapper bug that reuses a run id, or pushes to a branch, fails loudly instead of mixing
two runs' state.

**The mirror.** A plain bare clone (`git clone --bare <url>`) with `remote.origin.fetch` set to
`+refs/heads/*:refs/remotes/origin/*`, fetched with `--prune` on its timer (config, default 5 min). It is not
`--mirror`: a mirror fetch prunes every ref the remote lacks, which would delete `refs/ccrc-test/*` under a running
run, and it would pull `refs/pull/*`. Pruning a refspec touches only refs that refspec maps, so scratch refs survive.
The timer fetch exists only to keep pushes small (they are deltas against what the mirror has).

**The run's checkout** (in the prepare phase, as the run user, §2.2 and §2.3). Every git call that reads the mirror
passes `-c safe.directory=<mirror>` (the mirror is the service's, git refuses a local fetch from another user's
repository otherwise, and the run's HOME is empty), and every git call passes `-c core.hooksPath=/dev/null` with
`GIT_CONFIG_NOSYSTEM=1`:

1. `git init checkout`, `objects/info/alternates` set to the mirror's object directory, and `origin`'s URL set to the
   row's fetch URL (never fetched from: the run has no network). This is `git clone --shared --no-checkout` without
   copying the mirror's own refs, so the checkout holds the run's refs and nothing else;
2. `git fetch <mirror> 'refs/ccrc-test/<run-id>/*:refs/ccrc-test/run/*'` (objects are shared, so this moves no data);
3. `git checkout --force -B <branch> refs/ccrc-test/run/head`, or `--detach` when the session was detached;
4. `git update-ref refs/remotes/origin/main refs/ccrc-test/run/base`, unless the session had no base;
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
| `git remote get-url origin` | the repository's URL | the same |

Not reproduced, by design: other local branches, other remote-tracking refs, the stash, reflogs, the session's
`git config` and upstream tracking, and gitignored files other than the build outputs in §2.2. No test reads them from
the real repository today; the parity check (§6) is what would find one.

**Never `origin`.** Pushing scratch refs to the repository's own remote would publish uncommitted work on a public
repository and keep it in GitHub's ref history. The wrapper refuses a mirror URL that equals any of the clone's own
remotes.

**Why not rsync.** Rsync of tracked and dirty files carries no history, so the guard suites in §1.2 lose `origin/main`
and give a different answer from local; adding `.git` to it is a worse git push. It also needs its own file list
(tracked, modified, untracked-not-ignored), which is the index work above done by hand. Rejected.

**Ref lifetime.** A shared checkout borrows the mirror's objects, and git-clone(1) warns that it breaks when the source
prunes an object it still names. The run's checkout names only objects reachable from that run's
`refs/ccrc-test/<run-id>/*`, so one rule keeps it whole: the mirror deletes a run's refs only after the retention time
(config, default 24 h) **and** only once that run's directory is gone (§2.2). The mirror's `gc` then runs on its own
timer with git's default prune expiry, at any moment. Nothing on the box outlives its run, so there is no idle ref to
keep.

### 2.2 Disposable runs

**Every run starts from a fresh directory, and the directory is deleted after the run**, so carry-over is impossible
by construction rather than prevented by a reset that has to be complete (rev 4's reused slots needed a reset rule and
a check for every piece of state they kept).

**The run directory.** The box runs at most `CCRC_TESTBOX_RUNS` runs at once (config; default 2, this box 4, §8). Each
concurrent run takes a free run user `ccrc-tb-<k>`, `k` from 1 to that count; the user owns nothing between runs. The
run's directory is `<CCRC_TESTBOX_ROOT>/runs/<k>/run`, a fixed path, so socket paths built from it are the same length
every time. `runs/<k>` itself is root's (0755) and the run writes only `runs/<k>/run`: the prepare unit's one
privileged step (`ExecStartPre=+`, a fixed script) refuses to start when `run` already exists and otherwise creates it
owned by the run user, mode 0700, and `run` is the units' only `ReadWritePaths` (§2.3). So a run cannot leave a
sibling of `run` that the cleanup would miss, or replace `run` with a link. It holds `checkout/` (the shared checkout,
its `node_modules` and build outputs), `home/` (the npm cache is `home/.npm`, set by the box's `npmrc`, below) and the
reporter file `report.json`.

A run has two phases, each its own unit as the run user (§2.3):

**Prepare** (loopback plus the registry proxy):

1. the checkout of §2.1;
2. for each package in the repository table's install order (ccrc-pwa: `server`, `agent`, `ui`, then `pwa`, which
   resolves `ui` source through its `file:` link), the **install key**: `sha256` of the package's install inputs (its
   `package.json` and `package-lock.json`; the table adds `ui/package.json` for `pwa`), the node version and the
   platform, the same inputs as `server-deps`' CI cache key. When a pristine install for that key exists, the prepare
   copies it: `cp -R --reflink=always --preserve=timestamps <pristine>/<key> checkout/<package>/node_modules`. The clone
   shares the pristine install's data blocks and diverges on write, so a test that writes under `node_modules` writes
   its own copy, exactly as it would locally. When none exists, the prepare runs `npm ci --prefer-offline` in the
   checkout against the registry proxy (the cache and registry come from the box's `npmrc`, below), and the service
   queues a pristine build for that key (below);
3. the build outputs (below).

**Run** (loopback only): the command (§2.5) in the package directory.

**Results leave the directory first.** The run unit's stdout and stderr go to `StandardOutput=truncate:` and
`StandardError=` files under `<CCRC_TESTBOX_ROOT>/out/<k>/`, which the system manager opens as root before it drops to
the run user, so the run writes its output only through the descriptors it was given and never sees the files'
directory. The service tails them for the live stream (§2.5) and appends them to the run's log under `logs/<run-id>`.
The JSON reporter (§2.5) writes `runs/<k>/run/report.json`; the cleanup unit's first step copies it, as a regular
file opened without following links and under a size cap (`CCRC_TESTBOX_REPORT_MAX`, default 16M), to
`results/<run-id>/report.json`, owned by the service. A missing, oversized or non-regular report gives a summary that
says `no report (<reason>)` and keeps the exit status.

**Cleanup.** When the run unit has stopped (passed, failed, killed or timed out), the service starts
`ccrc-testbox-clean@<k>`, a static root unit whose fixed `ExecStart` collects the report (above) and then runs
`rm -rf --one-file-system` on that run's directory, and nothing else. It runs outside the run's sandbox and after it,
so nothing the run left in the directory, in any mode, can survive it; `RemoveIPC=yes` on the units (§2.3) covers
what a run leaves outside it, in `/dev/shm` and the System V tables. The run user returns to the free pool only when the directory is gone. A cleanup that fails keeps that run
user out of the pool and is retried on the service's next sweep; the status answer counts it (§2.7). At start the
service sweeps every `runs/<k>/run` with no active unit, so a box reboot leaves nothing behind.

**Pristine installs.** A pristine install is built once per install key, in its own unit
(`ccrc-testbox-install.service`, as the dedicated user `ccrc-tb-install`, prepare-phase network), and is treated as a
run in every way that matters for carry-over:

- **a fresh directory**: `<CCRC_TESTBOX_ROOT>/install/` is root's and the unit writes only `install/run`, which its
  privileged first step refuses to reuse and creates empty, owned by the install user, exactly as for `runs/<k>/run`;
- **the inputs only**: the service writes the key's install inputs, read from the mirror at the run's tree, to
  `specs/install`; the unit lays them out at their relative paths in `install/run/build` and runs `npm ci` from the
  lockfile alone, with HOME `install/run/home`;
- **the same caps**: the unit runs in its own slice with the per-run `MemoryMax`, `MemorySwapMax` and CPU quota (§4),
  with `PrivateTmp=yes` and `RemoveIPC=yes`, and counts as one run against `CCRC_TESTBOX_RUNS`; at most one runs at a
  time;
- **root cleanup**: on success a fixed privileged post-step, which reads only the key the service wrote, moves the
  package's `node_modules` to `<CCRC_TESTBOX_ROOT>/pristine/<key>` owned by root, so no run or later install can change
  it, with npm's modes kept so a run's clone is writable by its owner as a local install is; then, success or not,
  `ccrc-testbox-clean@install` removes `install/run` as the run cleanup does.

**A failed pristine build retries with backoff.** A build that exits non-zero, times out or is killed is retried for
the same key after a delay that grows (`CCRC_TESTBOX_PRISTINE_RETRY`, default 2 m, 10 m, 1 h, then once a day). While
a key has no pristine install, its runs keep installing in their own copy (above), so they pay one `npm ci` each and
still pass or fail on their own merits. The card (§2.7) lists each failed key with its package, the short key, the
exit status, the attempt count and the next attempt time, and the box is `degraded` while one is listed. A new key
for the same package (a newer lockfile) replaces the failed one in the list.

The service deletes a pristine install unused for `CCRC_TESTBOX_PRISTINE_KEEP` (default 7 d) when no prepare is
copying it; a run's clone is independent of it once made.

Lifecycle scripts run in both installs (`node-pty` needs its install step), so they are session-controlled code and run
where §2.3 puts it. The proxy, the service's, is the one warm layer every install reads, over HTTP.

**npm settings come from a root-owned `npmrc`.** The npm settings every install on the box needs are in the global
`npmrc` of the box's node install (`<tools>/node/<version>/etc/npmrc`, root's, written by the tools unit, §2.10),
which npm reads with no environment variable:

```
registry=http://<CCRC_TESTBOX_REGISTRY_PROXY>/
cache=${HOME}/.npm
nodedir=<tools>/node/<version>
```

So the run's environment carries no `npm_config_*` name and matches a local one (§2.3), the cache lands inside the
run's own HOME and goes with the directory, and a native build finds the headers the node release tarball ships under
`include/node` instead of downloading them. A project `.npmrc` (ccrc-pwa has none) would override these as it does
locally; the run's network (§2.3) still reaches only the proxy.

**XFS, settled.** The run root is XFS with `reflink=1`, the `mkfs.xfs` default on current distributions. btrfs also
reflinks, but brings snapshots, subvolumes and its own space accounting this design has no use for; XFS gives only the
one feature needed. At start the service makes a probe reflink (`cp --reflink=always`) under the root and reports the
box `down` if it fails, so a filesystem without reflink never silently turns every run into a full copy.

**Build outputs.** The tests read three gitignored outputs (§1.2): `server/dist`, `server/dist-pwa` and `agent/dist`.
The snapshot never carries them, and without a rule the box would skip cases a fleet worktree that has built them runs.
The rule: **the run builds the outputs the local tree has.** The submission carries a list of which of the repository
table's declared outputs exist locally (an existence check per path, nothing more), and the prepare phase runs each
one's build command from the table (ccrc-pwa: `npm run build` in `server` for `server/dist`, the pwa build for
`server/dist-pwa`, `npm run build` in `agent` for `agent/dist`). There is no build cache across runs. The one gap left
is a local output older than its source: the run builds it fresh. The summary says `built on box: <outputs>`. The other
rule (both sides always without them) cannot hold: the wrapper cannot remove a session's built outputs, and CI builds
them.

**Why reflink clones, not shared trees.** A shared read-only `node_modules` reached by symlink breaks `file:` links and
any resolution that takes a realpath, and makes a test that writes under `node_modules` fail where it passes locally;
a hardlinked copy shares inodes, so such a write would change the pristine install; overlay mounts need privileges or a
user namespace. A reflink clone is a private, writable, ordinary directory that costs metadata, not data.

**Temp.** Both units run with `PrivateTmp=yes`: each unit instance gets its own empty, writable `/tmp` and `/var/tmp`,
removed by systemd when the unit stops. So the suites that bind sockets under a literal `/tmp` (§1.2) and tmux's
default `/tmp/tmux-<uid>` work as they do locally, and concurrent runs cannot see each other's `/tmp`. The run's
`TMPDIR` is a short directory inside that private `/tmp` (config, default `/tmp/r`): the suites' run-tmp parent puts a
`live.sock` under `realpath(TMPDIR)` and refuses a path past the `sun_path` cap (`RUN_SUN_PATH_MAX`), so the box's
`TMPDIR` is never longer than the shortest `TMPDIR` a fleet session uses, and the parity fixture in §5 binds a socket at
the longest name the suites build, under `TMPDIR` and under `/tmp`, on both sides. `/tmp` on a tmpfs
(`TemporaryFileSystem=/tmp` in place of `PrivateTmp`) is a config option, off by default: it removes the fsync cost but
changes free space and timing, so it waits for the parity check (§6) to pass with it on.

### 2.3 Secrets and isolation

The tests need no secrets: they run against fixture HOMEs, with `gh`, `curl`, `ssh`, the system managers and `tmux`
servers contained (CLAUDE.md, "FIXTURE HOMEs only"). The rule behind every point below: **everything the submission
controls runs as a run user or the install user**, which is the install's lifecycle scripts, the builds and the tests,
and never as the service.

- **No credentials on the box** beyond the service's own token file and, for a private repository, a read-only deploy
  key used only by the mirror fetch. No `gh` login, no account files, no provider keys. The service user owns those
  files (0600) and runs nothing from a submission.
- **A user per concurrent run.** Run users are unprivileged system users with no login shell, no sudo and no group
  shared with the service; they read the mirror as others and never its hooks or key material. HOME is the run
  directory's empty `home/`, with no `~/.gitconfig` and no ssh agent. Concurrent runs are different uids with no
  writable path in common, so they cannot signal, trace or read each other.
- **`/proc` shows the run only.** The units set `ProtectProc=invisible`, so a `/proc` walk sees the run user's own
  processes only. They do not set `ProcSubset=pid`: it would also hide `/proc/meminfo`, `/proc/stat` and the other
  system files node, vitest and the tests read. Locally the same walks see every process of the session's uid; the
  tests already filter to their own trees, and the parity check (§6) is what shows they do.
- **Static units, one narrow polkit rule.** The service never builds a unit's properties. The box installs static
  units in the system manager: the templates `ccrc-testbox-prepare@<k>`, `ccrc-testbox-run@<k>` and
  `ccrc-testbox-clean@<k>` (`k` a run number or `install`), `ccrc-testbox-install` and `ccrc-testbox-tools` (§2.10).
  The prepare and run templates set `User=ccrc-tb-%i`, the run's slice, `IPAddressDeny`/`IPAddressAllow`,
  `ProtectProc`, `NoNewPrivileges`, `PrivateDevices`, `PrivateTmp=yes`, `RemoveIPC=yes` (the run user's POSIX shared
  memory in `/dev/shm`, message queues and System V objects are removed when the unit stops; `PrivateDevices` still
  shares the host's `/dev/shm`, so without it a segment could outlive the run directory), `ProtectSystem=strict` with
  `runs/%i/run` as the only `ReadWritePaths`, and a fixed `ExecStart` of the service's runner script; the install unit
  sets the same for `install/run`. The run's argv and environment reach the runner as a spec file the service writes
  under `<CCRC_TESTBOX_ROOT>/specs/<k>`, readable but not writable by the run user. A polkit rule lets the service user
  `start`, `stop` and read the state of units whose name matches
  `^ccrc-testbox-((prepare|run)@[0-9]+|clean@([0-9]+|install)|install|tools)\.service$`, and nothing else. `IPAddressDeny` needs the system
  manager, which is why these are system units; polkit cannot constrain transient-unit properties such as `User=`,
  which is why they are static. The installer writes the units, the users and the rule: box setup, not session code.
- **A fixed environment.** The runner starts from an empty environment plus: `PATH` (the box's tool directory first),
  `HOME`, `TMPDIR`, `LANG`, `TERM`, the worker-count names (§2.5), and the names in a forward allowlist (config,
  default `CCRC_HISTORY_BASE CCRC_LEDGER_BASE`, resolved to shas as §2.1 says). No `npm_config_*` name is set: npm's
  settings come from the root-owned `npmrc` (§2.2). The session's environment is never
  forwarded: on the fleet host it carries the session's account settings and tokens. `CI` is forwarded only if the
  local invocation had it, so the answer matches the local one.
- **Network.** The run unit: `PrivateNetwork=yes`, its own network namespace with only its own loopback, so it cannot
  reach the box's loopback, the tailnet address or another run's listeners; `IPAddressDeny=any` with
  `IPAddressAllow=127.0.0.1/32 ::1/128` stays as a second fence. The prepare and install units must reach the proxy on
  the box's loopback, so they get `IPAddressDeny=any` and `IPAddressAllow=` loopback plus the proxy's address. The proxy
  is a caching read-only npm registry run by the service user on a loopback address of its own (config, default
  `127.0.0.2:4873`), and is the only thing with egress to the upstream registry.
- **Containment of the units.** Each run's units, and the pristine install's, run in their user's slice with its own
  `MemoryMax`, `MemorySwapMax` and CPU quota (config), so a runaway test or install cannot take the service down with
  it.
- **The snapshot is checked before it leaves.** Gitignored files never enter it (§2.1), and the size caps keep large
  untracked files out. On top of that the wrapper refuses a snapshot whose untracked, unignored paths match a deny list
  (config; default `*.pem`, `*.key`, `.env`, `.env.*`, `id_*`, `*.p12`) and names the paths. A refusal falls back to
  local, with the reason.
- **Results.** The log the box keeps is the run's own output, collected outside the run directory (§2.2), kept for the
  retention time and deleted with the refs. It
  is fetched by run id with the fleet host's token, which only the wrapper and the agent op read (the fleet host is the
  single-user boundary). It passes through no other surface, so no new egress mask is needed; the card in §2.7 shows
  counts, never log text.

Three checks become tests of the service (§5): a fixture run that prints its whole environment, its HOME listing and
the processes its `/proc` walk sees while another run sleeps, compared against the allowlist and its own unit; a
fixture install whose lifecycle script tries the upstream registry directly, a public address, the service's token
file and a pristine install, each of which must fail; and a carry-over fixture, where a run writes under
`node_modules`, `node_modules/.vite`, `/tmp`, `/dev/shm` (a POSIX shared-memory segment left open), `.git/hooks` and
`.git/config`, leaves a read-only directory and tries to create a sibling of `runs/<k>/run`, and the next run as the
same run user, from another fixture session, sees none of it, the sibling was refused, the pristine install is
byte-unchanged, and the run directory is gone between the two while its log and report are kept.

### 2.4 Fallback: the local slice, said out loud

The wrapper chooses remote only when all of these hold; otherwise it runs the same command through step 1's local path
(the tests slice and its admission queue), unchanged:

| check | source | fallback reason printed |
|---|---|---|
| the remote switch is on | the switchboard marker (§2.7) | `test box: off` |
| the repository is in the test box's table | the box's status answer | `test box: this repository is not set up there` |
| the box answers its status call within the deadline (config, default 3 s) and is not `down` | direct call | `test box: unreachable (<detail>)` or `test box: down (<reason>)` |
| node major.minor, npm major, tmux major, git major, python3 major.minor and Chrome major match the fleet host's | the box's status answer; a mismatch also marks the box `degraded` (§2.10) | `test box: version differs (<name> <local> vs <remote>)` |
| the service's protocol version is the wrapper's | the box's status answer | `test box: protocol differs (<local> vs <remote>)` |
| the queue is under its limit (config, default 20 waiting runs) | the box's status answer | `test box: queue full (<n> waiting)` |
| the snapshot passes the deny list | §2.3 | `test box: snapshot refused (<paths>)` |
| the snapshot is under its size caps | §2.1 | `test box: snapshot too large (<path> <size>)` |
| the index has no unmerged entries | §2.1 | `test box: unmerged paths` |
| the command is one the box runs (§2.5) | the repository table | `test box: <command> runs locally` |
| the file set's estimated time is under the budget (§2.5) | the wrapper's estimate | `test box: over budget (<estimate>)` |
| every git step of the checkout succeeds (§2.1) | the prepare phase | `test box: prepare failed (git <step>: <detail>)` |
| every package's clone or `npm ci` succeeds (§2.2) | the prepare phase | `test box: install failed (<package>, exit <n>)` |
| every declared build output the local tree has builds (§2.2) | the prepare phase | `test box: build failed (<output>, exit <n>)` |

The last three rows are checked on the box, after the run was accepted: the service ends the run with a `prepare
failed` summary that carries the reason, runs nothing of the command, cleans up as for any run, and the wrapper falls
back exactly as for the rows above. The reason is the first line the session sees and is repeated in the final
summary, as `ran on: local (fallback: …)`. A remote run's summary says `ran on: test box`. Every row falls back the same
way for the bare `ccrc test` and for `--local`; only an explicit `--remote` refuses instead of falling back, and only
for the budget row (§2.5). A fallback never changes the exit status: it is the local run's, so the coordinators'
counted exits read a fallback as the run it was.

**The parity reference.** "The same answer as locally" means the same answer as a local run **at the lockfile
install**: each package's `node_modules` as `npm ci` makes it from the committed lockfile, which is what a pristine
install is. A session's own installs can differ from that (a stale install, a package installed but not saved, a
lockfile edited since the last install). Before a remote run the wrapper compares, per package, the `packages` entries
of `node_modules/.package-lock.json` (the hidden lockfile npm writes) against those of the package's
`package-lock.json`, name, version and integrity, and on a difference prints
`local deps differ from lockfile (<package>: <first entry>)` in the first line and the summary. The remote run goes
ahead: its answer is the reference one, and the line tells the reader why a local run might disagree. The comparison
reads two files per package and runs no npm.

**No `node_modules` to fall back to.** A worktree whose ignored dependencies #1772's lifecycle shed, or one never
installed, has no `node_modules` for the local path. A fallback then runs `npm ci` for the missing packages inside the
tests slice first, through the admission queue, and says so: `test box: <reason>; installing <packages> locally`.
`CCRC_TESTBOX_FALLBACK_INSTALL=refuse` makes it refuse instead, with `test box: <reason>; no local deps for
<packages>` and the refusal exit status of §2.5.

**The box drops mid-run.** The run keeps going on the box; the wrapper reconnects with the run id and its last log
offset, within a deadline (config, default 60 s). After that it prints `test box: lost the run`, sends `run.cancel` for
the run id (one attempt, within the status deadline) so the box stops it and cleans up, and then, by default, runs the
command locally (config can make it fail instead). Ctrl-C or the session ending cancels the remote run.

### 2.5 What runs where

| work | where | why |
|---|---|---|
| one test file, or a set whose estimated time is under the budget | test box | the common case; seconds to minutes |
| a mutation loop (one file, many runs) | test box | many short runs, each a fresh copy (§4 has the cost) |
| the tests-inclusive typecheck (`tsc --noEmit -p test/tsconfig.tests.json`, `typecheck-tests`) | test box | the 2.7 GB run that started step 1 |
| pwa browser tests | test box | needs Chrome; CI's longest job (962 s) |
| the full server suite, or a set over the budget | GitHub CI | about 16,000 file-seconds (§1.1); the merge queue runs it anyway |
| the macOS legs | GitHub CI | another platform |
| anything that needs a real system manager, a live tmux server or a live account | nowhere | no test does this; such a command is refused, not routed |

**The budget.** The wrapper estimates a file set's time from the per-file durations the daily CI run publishes
(`2026-09-23-ci-test-selection-design.md`) with the median for a file it does not know, divided by the run's worker
count. The prepare phase is not counted: at up to half a minute with no build outputs and up to about two minutes
with all three (§4) it is inside the margin a 15-minute budget leaves. Over the budget (config, default 15 min) the wrapper does not start a remote run, and what it
does depends on the form:

- **bare `ccrc test <argv>`**: it falls back to the local slice like every other check in §2.4, with
  `test box: over budget (<estimate>)` in the first and last line, and prints the CI command
  (`gh workflow run ci.yml --ref <branch> -f mode=full` for the full suite) as a hint. Exit status: the local run's.
- **explicit `ccrc test --remote …`**: the session asked for the box only, so the wrapper runs nothing, prints the
  reason and the CI command, and exits with the refusal status, **75** (`EX_TEMPFAIL`). No command head in the
  repository table exits 75 today (vitest and `tsc` give 0, 1 or 2; `npm test` passes its script's status through, and
  no script in the tree uses 75), so a counted exit can tell "refused, nothing ran" from a red run. Step 1's exit
  contract reserves 75 for this (§3.1). The other refusals in this spec (`CCRC_TESTBOX_FALLBACK_INSTALL=refuse`,
  `CCRC_TESTBOX_LOST_RUN=fail` before anything ran) use it too.

**The command.** `ccrc test --remote <package> -- <argv>`. The repository table lists, per package, the command heads
the box runs (default for ccrc-pwa: `./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`, `npm test`,
`npm run test:browser`); anything else falls back to local with its reason. Step 1's bare `ccrc test <argv>` gains a
default: remote when the switch is on and the checks in §2.4 pass, local otherwise; `--local` forces the slice.

**The worker count is always set.** `server/vitest.config.ts` sets `maxWorkers: '40%'`, a share of the cores the
process sees, so a run without a flag would take 6 workers on a 16-vCPU box inside a unit capped at 400% CPU, and a
count unlike the local one. The runner therefore always sets the count: `VITEST_MAX_WORKERS`, `VITEST_MAX_THREADS` and
`VITEST_MAX_FORKS` (the names #389 sets; vitest 4 applies the first after config resolution, so it overrides the
config's share, and earlier majors read the other two) to `CCRC_TESTBOX_WORKERS`, and for a `vitest` command head an
explicit `--maxWorkers=<n>`. A `--maxWorkers` the session passes is kept when it is lower. The summary records it as
`workers: <n>`, and when the local run of the same command would get a different count it adds `local default: <m>`.
The parity check (§6) runs its local leg with the same count as the box.

**Results stream back.** The service streams the run's stdout and stderr as they happen, from the output files the
system manager writes outside the run directory (§2.2), then a summary frame: exit status, the failed files and test
names (from a JSON reporter the service adds beside the session's own reporters, like CI's file-times reporter, read
from the copy the cleanup collects), the run's wall time, the prepare time, and the last 40 log lines (config). The wrapper
prints them and exits with the run's exit status, so "counted exits" read the same as local runs.

### 2.6 Placement: which repositories and programmes

The test box keeps a repository table in its own config: one row per repository with its fetch URL, its packages in
install order with their install inputs, the command heads per package, the declared build outputs and their build
commands, and the system tools it needs. ccrc's code names no repository. ccrc-pwa is the first row, because its suites
are the measured load. Other repositories join by adding a row; a repository with no row runs locally with the reason
in §2.4.

Programmes are not configured separately. Every coordinator and worker already reaches tests through the skills step 1
changes; once the switch is on, every programme whose repository has a row uses the test box, and the rest use the
slice. A per-programme opt-out is not built: the fallback already covers a repository the box cannot serve.

### 2.7 Operator controls and status

**The switch.** A new row in `shared/switches.ts`'s `SWITCHES`: a `$REG/testbox-remote-live` marker on the fleet host,
written by the server's switch route from the Settings card, absent meaning off. The wrapper reads the marker itself,
so the switch works with the server down. Removing the marker at a terminal turns remote runs off at once; runs
already on the box finish.

**The status read.** A new agent op, `testbox`, shaped like the `disk` op (`agent/src/disk.ts`): an L3 adapter on the
fleet host that calls the test box's status endpoint with a deadline and returns the answer or a typed failure. The
server's L1 decider turns it into a state: `off`, `ok`, `degraded` (a tool version that differs from the fleet
host's, a tool sync in progress or failed, a failed pristine key, or a run user held out by a failed cleanup), `down` (the service answers but cannot run: no reflink on the run root, a missing mirror), or
`unreachable`. The L4 timer polls it (config, default 30 s). The server keeps its one agent link; it never reaches the
test box itself. The fleet agent is legitimately the caller: it is on the host whose wrapper submits runs, so it sees
the same reachability the wrapper sees.

**The card.** Settings › Automation gains a Test box card beside step 1's tests-slice card:

- the switch, with one sentence of what it does;
- state, with the reason when `degraded` or `down`, last answer time, service and protocol versions, and, for every
  tool §2.4 compares, the fleet host's measured version and the box's, with the differing cell marked;
- **Bring tools up to date**, shown when a tool differs or the last sync failed: it runs the same sync step as the
  update lane (§2.10), shows `syncing <tool>` while it runs, and is disabled until it ends; the last sync's time and
  result sit under it;
- runs in progress of the limit, queue depth, runs and fallbacks in the last 24 hours, with fallbacks grouped by
  reason;
- the pristine installs present per package for each repository row, and each failed pristine key with its exit
  status, attempt count and next attempt (§2.2).

| width | layout |
|---|---|
| phone | one column; the switch and state (with its reason) on top, then **Bring tools up to date** as a full-width button when shown, then a two-row summary (runs, queue); versions, the 24-hour counts, the pristine installs and failed keys behind a disclosure |
| laptop | the card in the settings column; switch and state on one line, the button at the end of the state line when shown, a three-cell row (runs, queue, fallbacks), the versions table (fleet host, box) under it |
| wide | the same card at the column's width, with the versions table and the pristine-installs table shown open side by side |

The control's route calls a `testbox.tools-sync` action through the same agent link (the `testbox` op's one write),
which sends the box a `tools.sync` frame naming the release the fleet host runs and the versions the agent measured
on it. The route, the action and the frame take no argument from the page: the release and the versions are the fleet
host's own, never the caller's.

Doctor gains a line on the fleet host: the switch, the box's state, queue depth, and the version comparison.

### 2.8 The queue on the box

The box's queue is its own; step 1's fleet-wide admission queue governs local runs only. Fairness: at most one running
run per session (config), first come first served across sessions, and a waiting run prints its position as the queue
moves. A run waits at most a deadline (config, default 10 min) before the wrapper falls back with
`test box: waited <n> min`. Runs × workers is sized to the box (§4); on 16 vCPU the defaults are 4 runs × 3 workers.

### 2.9 Where the service lives in the tree

Two homes were weighed:

- **A. The agent package, in a test role.** The test service is a second entry point of `agent/`: it reuses the
  agent's bearer-token check, its WebSocket server, the release tarball and the update lane that already rolls the
  agent, and adds a run-frame family with its own whitelist. The fleet agent and the test service are different
  processes on different hosts, which is the "another host or process" reason the consolidation spec accepts.
- **B. A new package.** Cleaner boundaries, but a second token check, a second release artifact and a second update
  lane: the duplicate mechanisms the consolidation wave is retiring.

Recommendation: **A.** The wrapper's remote arm is the client; the run frames are `run.submit` (the run id, the branch,
which scratch refs were pushed, the build outputs present locally, the argv and the forwarded names), `run.log`,
`run.summary`, `run.cancel`, `tools.sync` (§2.10) and `status`. The service's own pieces (the run manager, the
pristine-install store, the queue, the tool sync) are L1 deciders with L3 adapters for git, npm and systemd, like the
rest of `agent/`.

### 2.10 Tools in step with the fleet host

A remote answer equals a local one only while the two hosts run the same node, npm, Chrome, python3, git and tmux, and
the box has no way of its own to know what the fleet host runs. So the fleet host says what it runs, and the box
installs exactly that, through the lane that already rolls both hosts (§2.9).

**The versions are the fleet host's, measured.** The fleet agent measures the versions its host runs, with the `PATH`
sessions get: `node --version`, `npm --version`, `"$CCRC_CHROME" --version` (a Chrome for Testing version),
`python3 --version`, `git --version` and `tmux -V`. It measures after the update lane has rolled the host and on every
`testbox` poll (§2.7). That measurement is the only source of the versions the box installs; CI's versions play no
part, because the answer that must match is the one the same session would get locally.

**How the box gets a new test-service release.** The test service ships in the ccrc release tarball (§2.9). When the
update lane has finished rolling the fleet host to a release, it signals the box with a `tools.sync` frame naming that
release's version and carrying the versions the agent measured. The service starts `ccrc-testbox-tools.service`, a
static root unit whose fixed script reads only the spec the service wrote, checks each value against its format, and:

1. fetches that release from the release host and verifies it **exactly as the fleet host's update lane does today**
   (`_upd_resolve` and `_upd_fetch` in `ccd/ccrc`, covered by `ccrc-update-fetch.test.ts` and
   `verify-provenance.test.ts`), as a pinned fetch from `<release base>/download/<tag>`, where the release base is
   `CCRC_RELEASE_BASE_URL` (default: this repository's GitHub releases). In order:
   - `SHA256SUMS`: its first line must name a tarball `ccrc-*.tar.gz` (printable ASCII, at most 200 bytes, no `/`),
     and the version in that name must equal the requested tag;
   - the tarball, checked against `SHA256SUMS` (`sha256sum -c`) before anything is extracted;
   - the bundle `<tarball>.sigstore.json` from beside it. A 404 refuses (the box has no `--allow-unsigned`); any other
     fetch failure is a transient fault, not a verdict on the release. The bundle goes through
     `deploy/verify-provenance.mjs` from the box's **installed** tree, never the tarball's own copy, with `--blob`,
     `--tag <tag>` and the repository's owner and name. Its default `sigstore` backend checks, offline, the bundle's
     signature over the tarball's digest against the vendored trusted root (`deploy/sigstore-trusted-root.jsonl`, or
     the file `CCRC_SIGSTORE_TRUSTED_ROOT` names when that is set), with one certificate-transparency log entry, one
     transparency log entry and a timestamp; the certificate's OIDC issuer,
     `https://token.actions.githubusercontent.com`; its subject alternative name, which must be exactly one of two workflow identities,
     `.github/workflows/release-main.yml@refs/heads/main` or `.github/workflows/release.yml@refs/tags/<tag>` in this
     repository; and the in-toto subject, which must be named `ccrc-<tag>.tar.gz` with the tarball's sha256. The tag
     is bound by that subject name, not by the identity: a `release-main.yml` identity is the same for every tag. The
     verifier's exit 1 refuses the release; any other non-zero exit (exit 3 when its dependencies do not load) means
     it could not run, which also stops the sync but is not a verdict on the release;
   - after extraction in a staging directory, `MANIFEST` (`sha256sum -c` over the tree), and `build.json`'s version,
     which must equal the tag.

   The box needs nothing beyond that: no release signing key (the provenance is keyless), no `gh`, and no network
   for the verifier itself, only a node and the server package's production dependencies beside the installed tree
   (§9). A release that fails any check is never installed. The verified tree stays staged until step 6;
2. downloads `node-v<version>-linux-x64.tar.xz` and `SHASUMS256.txt` from `nodejs.org` over HTTPS, checks the
   tarball's sha256 from that file, and unpacks it to `<tools>/node/<version>`, which keeps the release's
   `include/node` headers for `nodedir` (§2.2), then writes that install's root-owned `npmrc`;
3. installs `npm@<version>` into that node prefix from the npm registry, through the registry proxy, checked against
   the registry's `dist.integrity`;
4. downloads the Chrome for Testing `linux64` build at the measured version from its download host over HTTPS and
   unpacks it to `<tools>/chrome/<version>`, with its system libraries from the OS mirror;
5. installs python3, git and tmux at the measured versions, and strace and jq at the distribution's, from the OS
   package mirror under the package manager's own signature check;
6. switches `<tools>/current`, a directory of links naming one version of each, in a single rename, and only then
   installs the test service from the staged release; the new service takes over once the runs in progress end, and
   queued runs wait for it. So a new service never runs on the previous tool set.

A `tools.sync` whose release is the one installed and whose versions are the box's changes nothing.

`<tools>` is `CCRC_TESTBOX_TOOLS_DIR`, root's and read-only to every other user; `CCRC_CHROME` on the box names the
link. A run resolves `<tools>/current` once, when its prepare starts, and uses those versioned paths for its whole
life, so a sync during a run changes nothing under it; the next prepare picks the new set. The service keeps the
previous version of each tool until no run uses it. A new node version changes every install key (§2.2), so the
service queues the new pristine builds as soon as the sync ends.

**A mismatch is visible and has a control.** The status answer reports the release the box runs, its tool versions
and the sync's state, and the fleet agent compares them with its own measurement. A box whose release or versions
differ from the fleet host's is `degraded` with the reason `tools differ (<tool> <fleet host> vs <box>)`. The one rule
for falling back is §2.4's version row (and its protocol row, for a service that speaks another protocol): a
difference that reaches it makes every wrapper on the fleet host fall back with that row. Any difference below it (a
node or python3 patch, an npm, git or tmux minor, a Chrome build, or a release whose protocol is unchanged, as in the
window between the fleet host's roll and the box's sync) only shows on the card, as `degraded`, and runs stay
remote. A tool changed on the fleet host outside the lane shows up at the next poll the
same way. A sync that fails (a download, a signature or checksum, an OS mirror without the measured version) leaves
`current` and the installed release on the previous set, marks the box `degraded` with
`tool sync failed (<tool>: <detail>)`, and is retried with the pristine build's backoff (`CCRC_TESTBOX_PRISTINE_RETRY`).
The card's **Bring tools up to date** (§2.7) sends the same `tools.sync` at once, with the agent's latest
measurement.

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
PR. The build that follows will touch `shared/switches.ts` (a row), `agent/` (a new entry point and op), the agent's
tool-version measurement, the update lane (the `tools.sync` step), the Settings Automation section and the doctor
checks; it lands after #1694, and its plan re-checks open PRs on those files then.
#1772's deps-shed arm and this design meet later: once typechecks and tests run remotely, a fleet worktree needs its
`node_modules` only for local fallback runs, which makes shedding them cheaper. That is a follow-up, not part of this
spec.

## 4. Configuration

Every size, cap, count and path is a ccrc setting read through `_ccrc_knob` (the process environment, else
`~/.ccrc/ccrc.env`, else the default), as #1752 does for the session slice. Defaults are neutral: with no test box
configured, remote is simply unavailable and every run is local.

**What a fresh run costs.** Two columns of figures with different standing: the **measured** column was timed on a
workstation (APFS clones, Apple silicon) at the commit in §1, and the **box** column is an estimate for XFS on the
16-vCPU box, which the build replaces with its own measurement there. The **paid** column says when the cost falls:
before the command starts (the run's prepare, which the session waits for), after the run (the session does not
wait), or outside any run.

| step | paid | measured (workstation) | box (estimate) |
|---|---|---|---|
| shared checkout of the 4,105 tracked files | prepare, every run | 3.5 s | 2–5 s |
| `node_modules` clones: `server` (≈6,000 files), `ui` (≈18,000), `pwa` (≈20,500) | prepare, every run | 2.9 s + 6.7 s + 11.0 s = 20.6 s | 10–25 s together (per-file metadata cost) |
| **prepare, no build outputs** | | **≈24 s** | **12–30 s** |
| `server/dist` (`tsc`) | prepare, when the local tree has it | 3.9 s | 5–10 s |
| `server/dist-pwa` (the pwa build: `tsc --noEmit` ≈40 s, then `vite build` 10.4 s) | prepare, when the local tree has it | ≈50 s | 50–70 s |
| `agent/dist` (`tsc`) | prepare, when the local tree has it | not measured (no install on the checkout) | under 10 s |
| **prepare, all three outputs** | | **≈78 s, plus `agent/dist`** | **about 1–2 min** |
| cleanup (`rm -rf` of the run directory) | after the run | ≈7 s for the `ui` and `pwa` clones | 5–15 s |
| `npm ci` for a package whose key has no pristine install | prepare, first runs of a new lockfile only | not measured | 1–3 min per package against a warm proxy |
| pristine build for a new key | outside any run (its own unit, §2.2) | not measured | 1–3 min per package |
| tool sync (§2.10) | outside any run, once per release or fleet-host tool change | not measured | a few minutes, mostly the Chrome download |

So the worst ordinary case, a run whose local tree has all three outputs, waits about two minutes before its command
starts: under a seventh of the 15-minute budget, which is why the budget estimate (§2.5) leaves the prepare uncounted.
A mutation loop pays the prepare once per wrapper call: once for a loop inside one command, once per mutant for a loop
that calls the wrapper each time (up to half a minute each when no outputs are built). The `npm ci` row is paid only
by runs that arrive before the pristine build for their key is done, which §1.4 puts at about five lockfile changes a
month per package.

| key (fleet host) | default | meaning |
|---|---|---|
| `CCRC_TESTBOX_URL` | unset | the test service's URL; unset means no test box |
| `CCRC_TESTBOX_TOKEN_FILE` | `~/.ccrc/testbox.token` | the bearer token for the service (0600) |
| `CCRC_TESTBOX_GIT_URL_BASE` | unset | the push URL prefix of the box's mirrors (for example `ssh://ccrc-tb-push@<host>/`); the box's status answer gives each repository row's mirror path, and the wrapper joins the two |
| `CCRC_TESTBOX_GIT_KEY` | `~/.ccrc/testbox-push.key` | the ssh key for that push (0600); on the box it is the push user's one forced-command key, accepted for new `refs/ccrc-test/<run-id>/*` refs only (§2.1) |
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
| `CCRC_TESTBOX_RUNS` | `2` | runs at once, a pristine build counting as one; this box sets 4 (§8) |
| `CCRC_TESTBOX_WORKERS` | `2` | vitest workers per run, always set by the runner (§2.5); a 16-vCPU box sets 3 |
| `CCRC_TESTBOX_RUN_TMPDIR` | `/tmp/r` | the run's `TMPDIR`, inside the unit's private `/tmp`; never longer than a fleet session's (§2.2) |
| `CCRC_TESTBOX_RUN_MEMORY_MAX` | `4G` | per-run `MemoryMax`; this box sets 6G (§8) |
| `CCRC_TESTBOX_RUN_SWAP_MAX` | `1G` | per-run `MemorySwapMax` |
| `CCRC_TESTBOX_RUN_CPU_QUOTA` | `200%` | per-run CPU quota; this box sets 400%, four CPUs (§8) |
| `CCRC_TESTBOX_ROOT` | `~/.ccrc/testbox` | mirrors, run directories, pristine installs, logs; on an XFS filesystem with `reflink=1` (§2.2) |
| `CCRC_TESTBOX_REPOS` | `~/.ccrc/testbox-repos.d` | the repository table (§2.6) |
| `CCRC_TESTBOX_FETCH_EVERY` | `5m` | mirror fetch timer |
| `CCRC_TESTBOX_RETENTION` | `24h` | result, log and ref lifetime |
| `CCRC_TESTBOX_PRISTINE_KEEP` | `7d` | §2.2; a pristine install unused this long is deleted |
| `CCRC_TESTBOX_PRISTINE_RETRY` | `2m 10m 1h 1d` | §2.2, §2.10; the delays between attempts of a failed pristine build or tool sync, the last repeating |
| `CCRC_TESTBOX_REPORT_MAX` | `16M` | §2.2; the largest reporter file the cleanup collects |
| `CCRC_TESTBOX_TOOLS_DIR` | `/opt/ccrc-testbox/tools` | §2.10; the synced tools, root's, with `current` naming the set in use |
| `CCRC_TESTBOX_OS_MIRROR` | the distribution's own | §2.0, §2.10; the OS package mirror |
| `CCRC_TESTBOX_EGRESS_ALLOW` | `github.com`, the registry upstream, the release host, `nodejs.org`, `storage.googleapis.com`, the OS mirror | §2.0; the egress allowlist by name, each name tied to the units that may use it |
| `CCRC_TESTBOX_PUSH_USER` | `ccrc-tb-push` | §2.1; the push user |
| `CCRC_TESTBOX_ENV_FORWARD` | `CCRC_HISTORY_BASE CCRC_LEDGER_BASE` | §2.3; a ref-valued name is resolved to a sha and pushed (§2.1) |
| `CCRC_TESTBOX_RUN_USER_PREFIX` | `ccrc-tb-` | §2.3; concurrent run `k` runs as `<prefix><k>` |
| `CCRC_TESTBOX_REGISTRY_PROXY` | `127.0.0.2:4873` | §2.3; the registry proxy's own loopback address, reachable from the prepare and install units only |
| `CCRC_TESTBOX_REGISTRY_UPSTREAM` | `https://registry.npmjs.org` | §2.3; the proxy's upstream |
| `CCRC_TESTBOX_TMPFS` | `off` | §2.2; `on` mounts the units' `/tmp` as a tmpfs instead of `PrivateTmp` |
| `CCRC_TESTBOX_LOG_TAIL` | `40` | §2.5 |
| `CCRC_CHROME` | `<tools>/current/chrome` | the Chrome for Testing binary at the fleet host's version, for the browser tests (§2.10) |

## 5. Acceptance, mapped

| acceptance (#1695) | how it is shown |
|---|---|
| the same pass/fail answer as locally | the parity check in §6, before the switch is armed; a fixture test of the wrapper that compares the summary of a remote and a local run of the same snapshot; and a git-state fixture test: a fixture repository with an `origin/main`, a branch two commits ahead, one staged, one unstaged and one untracked change, where a probe prints `rev-parse HEAD`, `--abbrev-ref HEAD`, `rev-parse origin/main`, `merge-base origin/main HEAD`, `diff --name-only <mb> HEAD`, `rev-list --count <mb>..HEAD` and `status --porcelain`, and a dirty-tree guard (a copy of `consolidation-path-guard`'s diff check) runs; local and box output must be byte-identical, run once with the session on a newer and once on an older `origin/main` than the mirror's; a socket fixture that binds a unix socket at the longest name the suites build (the run-tmp `live.sock` path and a `delegation-rig`-shaped `/tmp/dlgt-*` tmux socket), once under `TMPDIR` and once under `/tmp`, must bind on both sides; and a worker fixture whose test prints vitest's resolved worker count must print `CCRC_TESTBOX_WORKERS` on the box with no flag passed |
| a run's checkout stays whole across mirror `gc` (§2.1) | a service test: a fixture submission with a dirty tree is prepared, the mirror runs `git gc --prune=now`, and the run must pass with `git fsck` in its checkout reporting no missing object |
| no run's result depends on an earlier run (§2.2) | the carry-over fixture test in §2.3; a fixture run killed mid-way whose directory the cleanup must still remove; and a pushed run id that already holds a ref, which the pre-receive hook must refuse whole |
| a run with no pristine install for its key | a fixture lockfile with no pristine install: the run installs in its own copy and passes, the pristine install appears afterwards, and the next run with that lockfile clones it; a fixture lockfile whose install fails: the build is retried on the backoff, the card lists the key, the box is `degraded`, runs for that key still install in their copy, and the install directory is gone after every attempt |
| the box's tools follow the fleet host's release (§2.10) | a service test against fixture download hosts: a `tools.sync` with a fixture release and new measured versions verifies the release as `_upd_fetch` does (a tarball whose provenance bundle names another workflow, or is absent, must not install), installs the versions, switches `current` in one rename before the new service takes over, leaves a run that started before it on its old paths, and queues the new pristine builds; a checksum that does not match leaves `current` unchanged and marks the box `degraded` with `tool sync failed`; a status answer whose versions differ at §2.4's version row makes the wrapper fall back with that row, and one that differs only below it marks the box `degraded` and still runs remote; and the card's **Bring tools up to date** sends the same frame with the fleet host's release and measured versions, not the page's |
| coding sessions see no test-run memory or CPU | on the fleet host a remote run costs a `status`, a `git add -A` that reuses the session's stat cache, one push and a stream: measured in the build as the wrapper's own peak RSS and CPU time, with a ceiling in a test, on a dirty tree and on one with a file over the cap (which must not be hashed); the tests slice stays empty while every run is remote |
| no credentials reachable, no outbound network | the env, `/proc` and install fixture tests in §2.3 |
| when the box is down, runs fall back and say so | a fixture test per row of §2.4's table: the reason in the first and last line, the local slice used, the exit status the local run's; for the budget row also the explicit `--remote` form, which must run nothing and exit 75; a box whose run root has no reflink reports `down`; and a fixture worktree with no `node_modules`, under each value of `CCRC_TESTBOX_FALLBACK_INSTALL` |
| local deps that differ from the lockfile are named | a fixture package whose `node_modules/.package-lock.json` has one entry at another version: the wrapper prints `local deps differ from lockfile (<package>: <entry>)` and still runs remote |

## 6. The parity check, before arming

Before the operator turns the switch on, a one-off parity run: for the 20 most recent merged PRs, the wrapper runs each
PR's CI-selected server files plus `typecheck-tests` and the browser suite twice on the same snapshot, once locally in
the slice and once on the test box, and compares per-file pass/fail **and per-test skip counts and names**, so a case
one side skips (a missing build output, a platform gate) shows up even when both files pass. Both sides build the
declared outputs fresh first, the local leg runs on a fresh worktree at the lockfile install (`npm ci` per package,
the parity reference of §2.4), and both legs run with the same worker count, `CCRC_TESTBOX_WORKERS` (§2.5). A
disagreement in a file on the known-load-flake list (CLAUDE.md) is re-run alone on both sides before it counts. Any
other disagreement blocks arming and is reported by file. The same run repeated with `CCRC_TESTBOX_TMPFS=on` decides
that option.

## 7. Why it is safe

- Nothing on the fleet host changes until the switch is armed; with no URL configured the wrapper is step 1's.
- The fallback is the path that exists, and every fallback says why.
- No run inherits anything from an earlier one: its directory, checkout and installs are new, and they are deleted
  after it.
- No secret is on the box, none is forwarded, the run cannot reach the network, an install reaches only a local
  registry proxy, every piece of submitted code runs as an unprivileged user that cannot see other runs, and the
  snapshot is checked first.
- Scratch refs never reach the public remote.
- The box is rebuilt clean before it serves, the tailnet lets it reach nothing, and its egress is a named list
  (GitHub, the npm upstream, the release host and the tools' official download hosts), each name open only to the
  units that need it.
- The box runs the fleet host's own release, verified as the fleet host's update lane verifies it, and the tool
  versions measured on the fleet host; any difference shows on the card, and one that reaches §2.4's version row makes
  every run fall back instead of getting a remote answer.
- The server keeps one agent link and never reaches a third box.
- The merge-queue CI stays the authority for landing, so even a wrong answer from the box cannot land a change.

## 8. Operator decisions

Everything else in this spec is design, settled by the reasons given where it is described. The transport (§2.1), the
secrets rule (§2.3), the disposable runs with reflink clones of a pristine install on XFS (§2.2, from the
2026-10-28 ruling) and the tools synced to the fleet host's measured versions with the release fetched and verified
as the fleet host's update lane verifies it (§2.10) are among those, so none is
a choice here. These are the choices the operator makes; each row names
the recommended option first.

| # | decision | recommended | why |
|---|---|---|---|
| 1 | Which box, and when it stops being the fleet move's rollback source (§2.0) | **the old Hetzner CX53, retired as the rollback source once the new fleet host has run 7 days with no rollback-class incident and a full snapshot of the old box is verified restorable; the snapshot stays the rollback source for 30 more days, then the operator deletes it; the box is rebuilt clean** | it is already paid for and sized for the load, and the snapshot keeps the rollback while the box is wiped |
| 2 | What runs where (§2.5) | **box: single files, file sets under the 15-minute budget, the tests-inclusive typecheck, mutation loops, browser tests; local slice: everything else and every fallback; GitHub CI: the full suites and the macOS legs** | the full server suite is CI-sized (about 16,000 file-seconds) and the merge queue runs it anyway |
| 3 | Concurrency and caps on this box (§2.2, §4) | **4 runs at once, each capped at 6 GB memory and 4 CPUs (`MemoryMax=6G`, a 400% CPU quota), 3 vitest workers a run** | 4 × 6 GB is 24 GB, which leaves headroom for the service, the registry proxy and the page cache on a 16-vCPU 32 GB box |
| 4 | Fallback when the box is down, full, refusing or failing to prepare (§2.4) | **run in step 1's local slice and say why in the first and last line; a worktree with no `node_modules` installs inside the slice** | the session always gets its answer and the exit status is the local run's |
| 5 | A run lost mid-way (§2.4) | **re-run locally, as now, after sending `run.cancel`; the alternative is to fail fast (`CCRC_TESTBOX_LOST_RUN=fail`)** | the session gets its answer either way, at the cost of running the command twice when the box was only slow |
| 6 | On/off control (§2.7) | **one switch on the Settings › Automation Test box card, backed by a marker file a terminal can remove; armed only after the parity check in §6 passes** | the operator can turn it off from the UI or a shell, and it works with the server down |
| 7 | Which repositories first (§2.6) | **ccrc-pwa only; another repository by adding a row once its own parity check passes** | its suites are the measured load |

## Decisions this spec adds

The build plan allocates a deviation number for each of these when it lands; until then they are named by this PR,
#1780.

- **Threat model**: cooperative sessions, the good-faith scope of #1785; the goals are no accidental carry-over, no
  fleet secret on the box and no reach back to the fleet or the tailnet; a hostile session is out of scope because the
  box holds no secrets, is rebuildable and is not the authority for landing (§2).
- **Transport**: the session's HEAD, branch, resolved `origin/main` and staged and worktree trees, built from a copy of
  the session's index and pushed over the tailnet to `refs/ccrc-test/<run-id>/*` on the box's mirror (a plain bare
  clone, never `--mirror`); a forced-command push user and a pre-receive hook that accepts only creations under one
  run-id prefix that holds no ref yet; the run's checkout reproduces the state as uncommitted changes; size caps; never
  to the clone's own remotes; rsync rejected (§2.1).
- **Disposable runs**: every run gets a fresh directory at a fixed per-run-user path, a fresh shared checkout holding
  only its own refs, `node_modules` as a reflink clone of a pristine install built once per install key in its own
  unit (or an install inside the run when none exists, with the pristine one built for the next), and build outputs
  built inside the run with no cache across runs; a root cleanup unit deletes the directory after the run; run refs
  live until the retention time and the directory's deletion; reused slots, shared, hardlinked and overlay trees
  rejected; the run root is XFS with `reflink=1`, probed at start (§2.2).
- **Temp**: a private `/tmp` per unit and a short run `TMPDIR` inside it, never longer than a fleet session's; tmpfs
  `/tmp` off until the parity check passes with it on (§2.2, §6).
- **Environment and isolation**: the run's fixed allowlisted environment, a user per concurrent run with an empty HOME,
  `ProtectProc=invisible` without `ProcSubset`, a private network namespace for the run, the registry proxy only for
  installs, and the snapshot deny list; the box rebuilt clean, reachable only from the fleet host over the tailnet,
  reaching nothing on it, with egress by name to GitHub, the npm upstream and the tools' download hosts, each open
  only to the units that use it (§2.0, §2.3).
- **Privilege**: static `ccrc-testbox-{prepare,run,clean}@<k>`, `ccrc-testbox-install` and `ccrc-testbox-tools` system
  units with fixed users, `RemoveIPC=yes` on the prepare, run and install units, `runs/<k>` and `install/` root's
  with only their `run` directory writable, started by the service through one polkit rule limited to those names
  (§2.2, §2.3).
- **Pristine builds**: the install unit gets the run's fresh directory, root cleanup and caps, and a failed build
  retries with backoff and is listed on the card (§2.2).
- **Results and npm settings**: the live output and the reporter file are collected outside the run directory before
  cleanup; the registry, cache and `nodedir` come from a root-owned `npmrc`, never the run's environment (§2.2).
- **Tools**: the fleet agent measures node, npm, Chrome, python3, git and tmux on the fleet host and the box installs
  exactly those versions; on the update lane's signal the box fetches the same release tarball from the release host
  and verifies it as `_upd_fetch` does (`SHA256SUMS`, the Sigstore provenance bundle through the installed
  `verify-provenance.mjs`, `MANIFEST`), with no key of its own; node is checked against nodejs.org's `SHASUMS256.txt`;
  the new service takes over only after `current` is switched; the release host and the tools' download hosts are the
  only names added to the egress allowlist; a mismatch marks the box `degraded` and offers **Bring tools up to date**
  on the card, and only a difference at §2.4's version or protocol row makes runs fall back (§2.10).
- **Fallback**: the fallback checks (the budget, the version and protocol check, a `down` box and the prepare-phase
  failures among them), their printed reasons, the lost-run rule (`run.cancel`, then the local run) and the
  install-or-refuse rule for a worktree with no `node_modules` (§2.4).
- **Parity reference**: the reference answer is a local run at the lockfile install; the wrapper names local installs
  that differ from the lockfile (§2.4).
- **Refusal exit**: exit 75 means "refused, nothing ran", reserved in step 1's exit contract (§2.5).
- **Routing**: what runs on the box, what stays with CI, the time budget (prepare time uncounted, §4), the command
  heads and the worker count the runner always sets (§2.5).
- **Status**: the `testbox-remote-live` switch row, the `testbox` agent op with its `degraded` and `down` states and
  its one write (`testbox.tools-sync`), and the Settings card with its per-width layout (§2.7).
- **Service home**: the test service as a second entry point of the agent package (§2.9).

## 9. Left to the build plan

This is the last design round. These minor points are settled in the build plan, not in another revision:

- Chrome for Testing publishes no checksum, so its download is trusted on HTTPS from the official host; the plan may
  add a hash the fleet agent records from its own install.
- An OS mirror may not carry the fleet host's exact python3, git or tmux version; the sync then fails visibly (§2.10),
  and the plan decides whether the box tracks the fleet host's distribution release to avoid it.
- Step 1 of §2.10 runs the installed tree's `verify-provenance.mjs`, which needs a node and the server package's
  production dependencies on the box; the plan names how box setup places the first verified release and which node
  runs the verifier.
- Node's `SHASUMS256.txt` is checked over HTTPS only; whether the box also checks its `.sig`, and where node's
  release keys would come from, is the plan's (no code ships them today).
- How the new test service takes over from the old one while runs are in progress (§2.10, step 6), and the frame's
  exact fields.
- The agent's measurement runs with the sessions' `PATH`; the plan names where it reads that `PATH` from.
- The box column of §4's cost table, replaced by measurements on the box.
