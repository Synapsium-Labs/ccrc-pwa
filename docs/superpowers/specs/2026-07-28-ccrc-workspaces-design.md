# Workspaces: parallel worktrees, visible PRs, self-clearing rows

**Goal:** let one project run several sessions at once — each in its own git
worktree on its own branch — and make the PR lifecycle visible enough that a
merged branch cleans itself up instead of accumulating.

Inspired by [Conductor](https://www.conductor.build/), adapted to a fleet that
Conductor does not have to reason about: sessions pinned to rate-limited
accounts, driven from a phone, on a host the user never sees.

## What exists today

| capability | state | evidence |
|---|---|---|
| session runs in an arbitrary directory | **already works** | `ccd start <wrapper> <project> [workdir]` (`ccd:449`) |
| fleet reports the branch | **already works** | `FleetSession.branch` (`shared/api.ts:17`) |
| registry stores project as a field | **already works** | `_reg_set "$id" project` (`ccd:460`) |
| sessions are systemd-supervised | **already works** | `claude-session@.service`, a template unit per id |
| `gh` available and authenticated | **already works** | 2.45.0, scopes include `repo` |
| two sessions on one project | **blocked** | `_id() { echo "$1-$2"; }` (`ccd:90`) |

The blocker is one line. Everything else is plumbing that already exists.

### Why the id is nearly free to change

The id looks structural but is almost purely a key. The registry stores
`wrapper`, `project`, `workdir` and `uuid` as **fields** (`ccd:460-461`), and
only two places parse the id itself:

- `_id_wrapper` (`ccd:227`), used solely as the fallback in `_home_for`
  (`ccd:235`) when the `home` field is unset;
- `idHomeWrapper(r.id)` (`fleet.ts:62`), the same fallback behind `r.home ?? …`.

`cmd_start` never writes `home`; it is written later by `ccd prefer` (`ccd:582`).
Measured on the live registry, **2 of 9 sessions have no `.home` file at all**
(`claude-corp-data-internal`, `claude-corp-intake-platform`), so the prefix
fallback is not theoretical — it is load-bearing for those two today, and any
session created and never `prefer`-ed joins them. Set `home` at creation and
**every currently running session keeps working unchanged** — `claude2-MekWarLive`
still resolves through the fallback it always used. There is no migration step,
no downtime, and no flag day.

### The wart this removes

Because the id encodes the account, it asserts something that swapping routinely
falsifies. Measured on the live registry:

```
claude-rp-llm                    prefix says claude       actually on claude2
claude-corp-orchard-api  prefix says claude-corp  actually on gpt
claude2-expoAI-assistant         prefix says claude2      actually on claude
```

Three of nine ids are lying right now. **The PWA is already immune** —
`SessionCard` titles the card `session.project` and renders the account as a
separate live chip from `session.wrapper` (`SessionCard.tsx:169,178-181`), so the
lie is confined to `ccd ls`, tmux names and systemd unit names. This matters for
phasing: there is no PWA-visible identity bug to fix.

## Decisions

Ruled during design; recorded so the plan does not relitigate them.

1. **The server performs every git and `gh` operation.** The session is never
   asked to run git. It is asked only to write prose about work it did.
2. **The PR draft comes back as a file, never a pane scrape.** Reading the answer
   off the pane is the same failure class as the structured-ask alignment bug,
   where a mid-redraw capture labelled a row with copy it was not going to send.
3. **A busy session queues rather than refuses.** Server-side actions never wait
   on the draft.
4. **Archive automatically only when nothing can be lost; otherwise always ask.**
5. **Creating a workspace asks for nothing.** Zero friction; the row names itself
   once work starts.

## Identity and grouping

```
project   OpenClawHetzner              registry field, exists today
 └ workspace  quiet-mesa               new field; the id suffix
    id        OpenClawHetzner-quiet-mesa
    workdir   ~/worktrees/OpenClawHetzner/quiet-mesa
    branch    quiet-mesa                renamed at PR time
    home      claude-corp               explicit from creation
    wrapper   claude2                   where it is now, after swaps
```

- **New registry fields:** `workspace` (the slug) and `base` (the ref it forked
  from). `base` is read once, by `gh pr create --base`; nothing else stores PR
  data, because the poll joins on `headRefName` and a cached PR number would only
  be a second copy that can go stale.
- **`cmd_start` gains one line:** `_reg_set "$id" home "$wrapper"`. This is what
  frees the id, and it is correct independently of workspaces.
- **Row label:** `name ?? branch ?? workspace ?? id` — the `id` tail keeps the
  rule total for legacy rows, which have no `workspace`. `FleetSession.name` is the live
  display name from `sessions/<pid>.json`, so an anonymous `quiet-mesa` row
  starts reading sensibly the moment work begins — no git operation required.
- **The main checkout is a workspace like any other:** the one whose workdir is
  `$PROJECTS_ROOT/<project>`. It never auto-archives, because it never has a PR.

### Slug constraints

`^[a-z0-9][a-z0-9-]{1,30}$`. No dots, because tmux `-t` target syntax reads
`session:window.pane`; no slashes, because systemd instance names escape `/`.
Slugs are generated adjective-noun, retried on collision against existing
registry keys.

**Known latent issue, deliberately not fixed here:** `project` is validated as
`^[A-Za-z0-9._-]+$` (`ccd:452`), so a project name containing a dot already
produces an ambiguous tmux target via `_tmux() { echo "cc-$1"; }` (`ccd:91`). No
current project has one. Constraining new slugs does not make this worse, and
fixing it is unrelated to workspaces.

### Account assignment

A new workspace's `home` is the least-loaded account by `_limit_score`, after
which the existing swap machinery owns it. Three home-able accounts means four
workspaces on one project occupy the whole fleet.

**The `+` button must say so before the tap, not after.** A workspace that
silently lands on an exhausted account presents as a stalled session with no
explanation, which is the worst possible version of this. The affordance shows
the account it is about to assign and its current headroom.

## The visual model

```
▾ OpenClawHetzner                                    3  +
  │  main                    idle   claude
  │  fix-c-u-under-press   ● busy   claude-corp   4/7
  │  attachment-tray         idle   claude2   #41 ✓ ready

▾ expoAI-assistant                                   1  +
  │  main                  ● busy   claude       2/9

▸ synapsium-platform                                 2  +
```

Projects are collapsible; the count is live sessions; `+` adds a workspace.

| state | row shows | derived from |
|---|---|---|
| no branch pushed | — | no upstream |
| pushed, no PR | `create PR` | branch matches no PR's `headRefName` |
| PR open, checks running | `#41 ◐` | `statusCheckRollup` |
| PR open, green **and mergeable** | `#41 ✓ ready` | rollup + `mergeStateStatus` |
| PR open, checks failing | `#41 ✗ 2 failing` | rollup contains FAILURE |
| PR open, branch drifted | `#41 ⚠ conflicts` | `mergeable == CONFLICTING` |
| merged, safe | *row disappears* | archive test below |
| merged, unsafe | `#41 merged · 3 uncommitted` `archive` | archive test below |
| closed unmerged | `#41 closed` `archive` | `state == CLOSED` |

`✓ ready` folds in `mergeable`/`mergeStateStatus` rather than resting on CI
alone. A green rollup says the *tests* passed; it says nothing about conflicts or
required reviews. A row reading `ready` beside a PR GitHub would refuse is
exactly the confident-and-wrong display this feature exists to eliminate.

### Where PR state comes from

**One `gh` call per project, not per workspace:**

```
gh pr list --state all --limit 100 --repo <owner/repo> \
   --json number,headRefName,headRefOid,state,mergedAt,url,mergeable,mergeStateStatus,statusCheckRollup
```

Results are keyed by `headRefName` and joined onto workspaces by branch. Ten
projects on a 30-second poll is 20 calls/minute against a 5000/hour budget, and
the cost scales with **projects**, not workspaces — opening more workspaces adds
nothing.

The poll lives beside the existing fleet polling and is cached in server state.
A failed or unauthenticated `gh` call degrades to "no PR information" on every
row of that project; it never blocks the fleet view and never fabricates state.

## Lifecycle

### Create — `ccd ws-add <project>`

1. `git -C $MAIN fetch origin`
2. base = `git symbolic-ref refs/remotes/origin/HEAD` — never a hardcoded `main`
3. generate slug, retry on collision
4. `git worktree add -b <slug> ~/worktrees/<project>/<slug> <base>`
5. append `.ccrc/` to `$GIT_COMMON_DIR/info/exclude` if absent
6. run `.ccrc/workspace.sh` if present
7. `home` = least-loaded account; write registry fields
8. `systemctl --user enable --now claude-session@<id>`

Steps 4-8 are individually recoverable: a failure after the worktree exists
leaves a worktree with no session, which `ws-rm` cleans up. `ws-add` is not
atomic and does not pretend to be; it reports which step failed.

### Scaffolding: one hook, no config schema

A fresh worktree is git-complete and **useless** — no `node_modules`, no `.env`,
no local config. Measured on this repo: the tracked checkout is 3.3M; the
`node_modules` needed to run the suites is **704M**. Across the fleet the gap is
starker still — MekWarLive's working directory is 39G but its tracked checkout is
only 228M, so worktrees are cheap in git terms and the entire cost is
scaffolding.

Conductor solves this with three mechanisms (`.worktreeinclude`,
`file_include_globs`, `scripts.setup`). One suffices: an optional tracked
`.ccrc/workspace.sh`, run after creation with `$MAIN` and `$WT` in the
environment. For this repo:

```sh
for m in infra/ccrc/server infra/ccrc/agent infra/ccrc/pwa; do
  cp -al "$MAIN/$m/node_modules" "$WT/$m/node_modules"
done
```

`cp -al` hardlinks: same filesystem, so 704M is instantaneous and costs inodes
rather than bytes, against minutes and 704M for `npm ci`.

**Caveat, stated because it is a real sharp edge:** hardlinks share inodes, so
anything editing a file *in place* under `node_modules` — patch-package, a
hand-applied patch — writes through to the main checkout. npm replaces rather
than edits, so the common case is safe; a project that patches dependencies
writes `npm ci` in its own hook instead. No hook at all yields a bare worktree,
which is the right answer for docs and config work.

### Raise a PR

1. Server deletes any stale `.ccrc/pr-draft.md`.
2. Server injects **one** prompt into the running session asking for branch name,
   title and body, written to `.ccrc/pr-draft.md`, and explicitly instructing it
   to run no git commands.
3. Server watches for the file (the agent already tails and reads files).
4. On arrival: `git branch -m <proposed>`, `git push -u origin`, `gh pr create`.
5. On timeout (180s): body generated from commit subjects and diffstat, branch
   keeps its slug, PR opens anyway.

The branch rename happens here, immediately before the first push, so it always
lands while the branch has no upstream. **Renaming after a push produces two
branches**, which is the failure this ordering exists to prevent.

Because the rename is deferred, `git branch -a` and the worktree directory keep
saying `quiet-mesa` until a PR exists, and permanently if none ever does. This is
accepted: the row label never depended on the rename, so the visible cost is nil.

### Merge

`gh pr merge --squash` on a row GitHub reports as genuinely mergeable. Offered
only in the `✓ ready` state.

### Archive — the safety test

Three conditions, **all** required:

1. GitHub reports `state == MERGED`
2. `git status --porcelain` is empty, untracked included
3. local `HEAD` equals the PR's `headRefOid`

All three → server stops the session (`systemctl --user disable --now`), removes
the worktree, deletes the local branch, drops the registry entry, appends to an
archive log. Any one fails → nothing is touched and the row shows `archive` as an
explicit action.

**Why condition 3 rather than `@{u}..HEAD`:** GitHub commonly deletes the remote
branch on merge, so the upstream comparison errors exactly when the answer
matters; and under squash-merge the local commits never appear in `main` by SHA,
so comparing against `main` reports false differences. Comparing local `HEAD`
against the SHA **GitHub says it merged** is exact — equality proves every local
commit was accounted for.

`git worktree remove` refuses on a dirty tree by itself; condition 2 means we
never reach that refusal in the automatic path.

### Deliberately not built

**An archived-workspaces list.** The PR on GitHub is already the permanent record
with better search than anything built here, and a list of dead rows is precisely
the clutter this feature exists to remove. The archive log line suffices for
reconstruction.

## Error handling

| failure | behaviour |
|---|---|
| `gh` unauthenticated or rate-limited | rows show no PR state; fleet unaffected; logged once per backoff window, not per poll |
| draft file never appears | PR opens with a generated body after 180s |
| draft file malformed | same as never appearing; the raw file is kept for inspection |
| `workspace.sh` fails | workspace is created and reported as `setup failed`; not auto-archived |
| `git worktree add` fails | nothing registered, nothing spawned, error surfaced verbatim |
| session dies mid-draft | timeout path; PR still opens |
| archive test cannot reach GitHub | not merged as far as we know → nothing archived |

Every ambiguous case resolves toward *do nothing destructive*.

## Testing

- **`ccd`**, driven from vitest under an isolated `HOME` as `ccd-limits.test.ts`
  already does: `_id` opacity (a session with an explicit `home` resolves
  correctly regardless of its id prefix); legacy ids still resolve through the
  fallback; slug validation rejects dots, slashes, leading hyphens and
  over-length; collision retry.
- **Archive test**, as a pure function over `(prState, headRefOid, localHead,
  porcelain)`: each of the three conditions failing individually must block, all
  three passing must permit. This is the destructive path — it gets exhaustive
  coverage, including the squash-merge shape where local commits are absent from
  `main`.
- **PR-state join**, from fixture `gh` JSON: every row in the state table above,
  plus a branch matching no PR, plus two PRs on one branch (newest wins).
- **`✓ ready` must require both signals.** A fixture with a green rollup and
  `mergeable: CONFLICTING` must render `⚠ conflicts`. Verified by mutation:
  dropping the `mergeStateStatus` term has to turn the suite red.
- **Draft handling:** arrival, timeout, malformed, and stale-file-from-previous-
  attempt.
- **PWA:** project grouping and collapse; the account chip; each PR badge state;
  the `+` affordance showing the account it will assign.
- **Non-regression:** the existing 292/84/270 suites, three clean typechecks, and
  the 78-pair contrast gate.

## Phasing

Each phase is independently deployable and independently useful.

| phase | touches | delivers |
|---|---|---|
| **1** | `ccd` + server + PWA | `ws-add`/`ws-rm`, explicit `home`, the per-project `+`, and grouping — a project can hold two sessions and you can tell them apart |
| **2** | server + PWA | `gh` polling, row badges, `create PR` with draft, `merge` |
| **3** | server | the archive test and auto-archive |

### Why grouping is not a standalone first phase

The obvious cheap opener — "collapsible project groups in the PWA, zero backend
risk" — was measured and rejected. The live fleet is **nine sessions across nine
distinct projects**, so grouping today renders nine groups of one: a header row
and a chevron per card, strictly worse than the flat list, delivering nothing
until something can create a second session on one project. And the identity wart
it was supposed to fix is already absent from the PWA (above).

So grouping ships **with** `ws-add`, in the same phase that first makes a project
hold two sessions.

### Grouping appears only when it earns its space

A project with one session renders exactly as it does today: a plain card, no
header, no chevron, no indentation. Grouping — header, collapse, per-project `+`
— appears only for projects with two or more sessions. Most projects have one and
always will; the screen must not pay for worktrees it does not have.

**Collapse must never hide urgency.** This screen's primary job is answering
"what needs me?" (`sortFleet`: needs-you → idle → working → dead). So a collapsed
project header carries its aggregate state, a project sorts by its most urgent
member, and a project containing a pending dialog cannot present as quiet.

Phase 2 also pays off before a single worktree exists, since existing sessions
already have branches and can already raise PRs.

Each phase earns its own implementation plan.

## Out of scope

- **Multi-repo workspaces.** One workspace is one worktree of one repo.
- **Rebasing or updating a workspace against a moved base.** The `⚠ conflicts`
  badge reports the condition; resolving it is the session's job, through
  ordinary conversation.
- **Review workflows** — requesting reviewers, approving, commenting. Read-only
  PR state only.
- **Forge portability.** `gh` and GitHub specifically. The polling layer is
  isolated behind one function so another forge could be added, but nothing is
  built for one now.
- **Evicting a session from an out-of-pool lane**, still open from the rollover
  spec and still unrelated.
