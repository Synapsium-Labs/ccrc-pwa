# A workspace's life: named correctly, and reclaimed

**Goal:** make a workspace's branch correct from the moment it exists, and make
sure worktrees are reclaimed rather than quietly accumulating on a disk that is
already 87% full.

Sits between [workspaces Phase 1](2026-07-28-ccrc-workspaces-design.md) (shipped)
and the [fleet hierarchy](2026-07-28-ccrc-fleet-hierarchy-design.md) (specced,
unbuilt). It comes first because workspaces became creatable from a phone today,
so both problems start compounding now.

## Two defects that exist right now

### The branch tracks `main`

Measured on the live workspace `custom-tools-quiet-basin`:

```
$ git -C ~/worktrees/custom-tools/quiet-basin status -sb
## quiet-basin...origin/main

$ git config --get branch.quiet-basin.merge
refs/heads/main
```

`cmd_ws_add` runs `git worktree add -b "$slug" "$wt" "$base"` where `$base` is
`origin/main`. Git's `branch.autoSetupMerge` default is `true`, which sets an
upstream whenever the start point is a remote-tracking ref. So every workspace
branch created so far believes its upstream is `main`.

Consequences, in order of how badly they bite:

- `git pull` in a workspace merges `main` into the workspace branch — silently,
  and at exactly the moment a session is most likely to run it.
- `git push` fails with *"The upstream branch of your current branch does not
  match the name of your current branch"*. Confusing, though `push.default=simple`
  at least prevents it pushing to `main`.
- `git status` reports the branch as "up to date with 'origin/main'", which is
  actively misleading about whether the work is pushed.
- Anything reading `@{u}` resolves to `origin/main`. The workspaces spec already
  ruled `@{u}..HEAD` out for the archive test on other grounds; this would have
  made it wrong as well as unavailable.

**Fix:** `git worktree add -b "$slug" --no-track "$wt" "$base"`. A workspace
branch has no upstream until it is deliberately pushed.

### The branch name matches no convention

The branch is the raw slug, `quiet-basin`. Every repo on this fleet uses
`type/slug`:

| repo | recent branches |
|---|---|
| intake-platform | `docs/pilot-copy-fit`, `feat/int-7-mcp-image-attachments` |
| synapsium-platform | `feat/site-windtunnel`, `fix/site-visual-polish` |
| MekWarLive | `feature/battlescape-a1c-c`, `chore/MEK-995-cleanup` |
| OpenClawHetzner | `ccrc/attachment-tray` |

A bare `quiet-basin` is indistinguishable from a human's branch, sorts nowhere
useful, and gives no hint it is machine-created and disposable.

**Fix:** create the branch as `ws/<slug>`. Namespaced, self-describing, sorts
together, and matches the `type/slug` shape every repo already uses. The
directory and the session id keep the bare slug — only the branch is prefixed.

## Renaming

`ccd ws-rename <id> <new-branch>` renames the branch and records it.

- **Refuses once the branch has an upstream.** Renaming after a push produces two
  branches on the remote; the freeze rule from the workspaces spec becomes an
  enforced precondition rather than a convention.
- **Refuses a name that already exists** locally or on the remote.
- **Validates** against `^[A-Za-z0-9._/-]+$` with no leading/trailing `/`, no
  `..`, and no `.lock` suffix — the subset of `git check-ref-format` that
  matters, checked explicitly rather than trusted to git's exit code.
- Updates the registry's `branch` field so the fleet reads the new name without
  waiting for a pane capture.

This is the mechanism workspaces Phase 2 calls when the agent proposes a PR
branch name. Building it here means Phase 2 adds the *policy* (who chooses the
name, and when) to a rename that already works, rather than both at once.

**Not in this spec: deciding the name automatically.** Session display names are
already descriptive (`add-mcp-image-attachments`, `frontend-ui-foundation-39`),
so deriving a branch from them is tempting and probably right — but choosing the
`type/` prefix is a judgement call, and that belongs with Phase 2's agent-authored
PR flow.

## Reclamation

Disk: **301G, 87% used, 41G free** at time of writing, and free space moved
44G → 41G during a single working session. One workspace currently costs 19M
(tracked checkout; `cp -al` makes hardlinked `node_modules` ~free), so the danger
is not a single worktree — it is that **nothing ever reclaims one**.

### `ccd ws-gc` — report by default, act only when asked

`ws-gc` inspects and prints; `ws-gc --prune` acts. Never the reverse: a garbage
collector that deletes by default is one typo from deleting work.

It reports four categories:

| category | definition | `--prune` does |
|---|---|---|
| **orphan worktree** | directory under `$WORKTREES_ROOT` with no `<project>-<slug>.uuid` in the registry | removes it, but only when `git status --porcelain` is empty **and** the branch is merged or absent |
| **stale git metadata** | `.git/worktrees/<slug>` whose workdir is gone | `git worktree prune` |
| **dead registry entry** | registry entry whose workdir no longer exists | removes the registry files |
| **dirty workspace** | tracked by ccd, uncommitted changes present | **nothing** — reports size and age only |

A dirty workspace is never touched, at any flag. `ws-rm` already refuses one; a
sweep that overrode that would make the refusal meaningless.

### Report every worktree; prune only our own

This is not a hypothetical risk — **it has already happened, at scale, through
other tooling.** Measured on this box:

```
MekWarLive/.claude/worktrees/   16 dirs, 29G
  oldest 2026-06-15, newest 2026-07-04   (all ≥24 days idle)
  largest agent-a7ed588…  4.8G  = 4.5G CDK output + 1.6G node_modules
  git worktree list reports 17 registered against 16 on disk
```

29G of abandoned agent worktrees was the single largest item on a 87%-full disk,
and one stale git registration was already present. Nothing surfaced any of it.

**Since measured, that 29G has been reclaimed by hand** — 16 worktrees removed
after checking each was clean, unopened and sessionless; all 48 branches kept.
The disk is now 73% used. That does not weaken the case, it *is* the case: the
audit was manual, took a working session, and nothing will stop the next 29G
accumulating. What survives as a live example is smaller and equally invisible:

```
custom-tools: /home/you/.handoff/wt/custom-tools-receiver-heartbeat--20260728-221900-3091316
```

A handoff worktree, registered against `custom-tools`, outside `$WORKTREES_ROOT`,
belonging to tooling that is now switched off. `ws-gc` must report it and must
not touch it.

So `ws-gc` enumerates worktrees for every project via `git worktree list`, not
just those under `$WORKTREES_ROOT`, and reports path, age, size and dirty state
for all of them. Anything ccd did not create is reported as **foreign** and never
pruned, at any flag — that tooling owns its own cleanup, and guessing at another
tool's lifecycle is how a reclaimer destroys work it did not understand.

The value is the visibility. 29G accumulated over six weeks because no command
existed that would have said so.

### A disk floor on creation

`ws-add` refuses below a floor (default 10G, `CCD_DISK_FLOOR_GB`), naming the
free space and the floor. Cheap, and it converts "the box filled up and
everything broke" into "this one command declined".

The check is on the filesystem holding `$WORKTREES_ROOT`, because `~/worktrees`
and `/data/projects` need not be the same mount even though they are today.

Read it with `df -Pk`, not `df --output=avail`: GNU `df` rejects `-P` and
`--output` together (*"options -P and --output are mutually exclusive"*), and
`-P` is the flag that matters — it guarantees one filesystem per line, so a long
device name cannot wrap the row and shift the field being parsed. `-k` pins the
unit to 1K blocks, which `-P` alone does not (GNU `df -P` reports 512-byte
blocks under `POSIXLY_CORRECT`).

### Footprint

`ws-gc` prints per-workspace and total disk. **`du` de-dupes hardlinks only
within a single invocation**, so N separate `du -sb` calls over worktrees that
share a hardlinked `node_modules` count that tree N times: their sum overstates
what removing them all would actually return.

The report therefore uses two different measurements and labels them as such:

- **per row** — an individual `du -sb`, answering "how much does this one
  workspace cost on its own"
- **total** — a single `du -scb` over every listed path at once, which de-dupes
  shared inodes across all of them and so is the exact figure that would be
  freed by removing the lot

The total is smaller than the sum of the rows exactly when workspaces share
hardlinks; the report says so in one line rather than leaving the arithmetic
looking broken.

## Archive on merge

The workspaces spec's Phase 3 rule, brought forward because it is the mechanism
that actually reclaims: a merged PR whose workspace is clean is removed
automatically.

The safety test is unchanged, and all three conditions are required:

1. GitHub reports `state === 'MERGED'`
2. `git status --porcelain` is empty, untracked included
3. local `HEAD` equals the PR's `headRefOid`

Condition 3 is why this is safe: the SHA GitHub says it merged, compared against
what is on disk. Equal means every local commit is accounted for, so removal
provably loses nothing. Fail any condition and nothing is touched — the row shows
`archive` as an explicit action instead.

**This depends on PR state**, which the [fleet hierarchy
spec](2026-07-28-ccrc-fleet-hierarchy-design.md) introduces (per-branch
`gh pr list --head`, measured at 492–918ms). Archive-on-merge therefore lands
*after* that, and this spec builds everything it needs except the trigger:
`ws-gc`'s safety checks, `ws-rm`'s refusals, and the disk accounting.

## Error handling

| failure | behaviour |
|---|---|
| `ws-add` below the disk floor | refuses, names free space and the floor, creates nothing |
| `ws-rename` on a pushed branch | refuses, explains that the remote already has it |
| `ws-rename` to an existing name | refuses, names the collision |
| `ws-gc` cannot stat a worktree | reports it as unknown, prunes nothing |
| `ws-gc --prune` fails partway | reports what was and was not reclaimed; never leaves a half-removed registry entry |
| `git worktree prune` fails | reported, non-fatal — it is metadata, not data |

Every ambiguous case resolves toward doing nothing destructive.

## Testing

- **`--no-track`**: a workspace created by `ws-add` has **no** upstream.
  `git rev-parse --abbrev-ref '@{u}'` must fail, and
  `git config --get branch.<b>.merge` must be empty. This is the live defect —
  it gets an explicit regression test, and a mutation removing `--no-track` must
  turn it red.
- **Branch prefix**: the branch is `ws/<slug>` while the directory and id keep
  the bare slug. Assert all three, so a future change cannot quietly unify them.
- **`ws-rename`**: renames a fresh branch; refuses once an upstream exists;
  refuses a colliding name; rejects `..`, a leading `/`, and a `.lock` suffix;
  updates the registry `branch` field.
- **`ws-gc`**: each of the four categories detected on a fixture tree; default
  invocation modifies **nothing** (assert the tree is byte-identical after);
  `--prune` reclaims orphans and stale metadata but leaves a dirty workspace
  untouched. That last one is the load-bearing case — verify by mutation that
  removing the dirty guard turns the suite red.
- **Disk floor**: `ws-add` refuses below the floor and creates no worktree, no
  registry entry, and no session. Drive it by pointing `CCD_DISK_FLOOR_GB` above
  actual free space rather than by filling a disk.
- **Host isolation**, as Phase 1 established: `HOME` is the only root, `tmux` and
  the systemd wrappers are stubbed, and the suite must leave the nine live
  sessions, `~/worktrees` and `/data/projects` untouched.

## Out of scope

- **Choosing a branch name automatically** — Phase 2, with the agent.
- **Raising or merging PRs** — Phase 2.
- **A scheduled sweep.** `ws-gc` is a command. Running it on a timer is a
  decision to make once the report has been read a few times and its judgement is
  trusted; wiring a cron to a deleter that has never been observed is how a
  reclaimer becomes an incident.
- **Pruning anything outside `$WORKTREES_ROOT`.** ccd removes only what it
  created. See below — it still *reports* the rest.
