# ccd change-map — "worktree ownership": adoption, child worktrees, truthful archivedreason

Target file: `/srv/projects/OpenClawHetzner/infra/ccrc-portability/ccd`
(5,439 lines, single bash file). Every claim below carries a `ccd:LINE` cite.

**Evidence labels used throughout**

| label | meaning |
|---|---|
| **[R]** MEASURED-BY-READING | I read the code at the cited line and the claim is about what the code *says*. |
| **[P]** MEASURED-BY-PROBE | I ran it, this session, in a throwaway git repo under `…/scratchpad/probes/`. Plain git 2.43, no network, no real repo touched. |
| **[I]** INFERRED | A guess about runtime behaviour I did not run. These are the empirical agent's job — collected at the top. |

---

## 0. NEEDS EMPIRICAL CONFIRMATION (the [I] items, collected)

These are the runtime claims this map rests on that I did **not** execute. Each is written as a
falsifiable proposition with the ccd site it decides.

1. **[I] `_ws_sensitive_inside`'s 30 s deadline over a real 26 GB child worktree.**
   `REAP_SCAN_SECONDS=30` (ccd:2023) bounds a single `find` walk of *every* collapsed ignored
   directory (ccd:2095). If `.claude/worktrees/` is gitignored, that walk descends the entire child
   tree. Measured on this box the largest ignored tree cost 3.4 s for 355k entries (ccd:2062-2066
   comment) — but the foreign-worktree footprint is 26 GB / 37 trees. Proposition: *on a real
   OpenClaw project with a nested `.claude/worktrees/agent-*` present and ignored, the reap's
   inside-scan exceeds 30 s and every workspace in that project answers `tree-unreadable` with the
   `did not finish within 30s` detail (ccd:2087-2090, ccd:2102).* Decides whether descent needs its
   own budget or a "skip registered child worktrees" predicate.

2. **[I] `du -sb` cost and correctness over a nested child in `_ws_collect_ignored`** (ccd:2274) and
   `_ws_gc_bytes` (ccd:4190). Proposition: *the ignored entry `.claude/` is sized recursively, so
   `ignoredBytes` on the reap sheet includes the whole child worktree and the sheet tells the human
   they are about to delete N GB that is actually another session's checkout.*

3. **[I] Whether Claude Code's own `EnterWorktree` worktrees are created with `git worktree add`
   against `$PROJECTS_ROOT/<project>` or against the *session's* worktree.** The 37 measured trees
   live at `/data/projects/*/.claude/worktrees/`, i.e. under the **main checkout**, not under a
   ws/ worktree. That matters for §3/§4: if children are always registered against `$main`, then
   `git -C "$main" worktree list --porcelain` (ccd:1011, ccd:4383) already enumerates them and
   adoption is a classification change, not a discovery problem. If some are registered against the
   *parent worktree's* gitdir, the record lives in `$main/.git/worktrees/<parent>/…` and needs a
   different walk. Probe: `git -C <main> worktree list --porcelain | grep -c '\.claude/worktrees'`
   on a live project, plus `cat <child>/.git` to see which gitdir it points at.

4. **[I] Whether the live foreign trees are on stable branches.** The CONTEXT states one live
   session (custom-tools-warm-meadow) was measured switching branches mid-session. Proposition:
   *`_ws_wt_branch` (ccd:1002) polled twice a day over the 37 foreign trees returns a different name
   for ≥1 of them*, which is what kills the registry-`branch` field as an adoption primary key
   (§6 below).

5. **[I] `_ws_status` on an adopted foreign session.** `_ws_status` (ccd:239) reads a wrapper status
   file keyed off the tmux pane pid. An adopted foreign worktree has **no tmux pane and no wrapper**,
   so `ws-archive` (ccd:1315) and reap Phase D1 (ccd:2828) either refuse `status-unknown` forever or
   short-circuit. I read the caller sites; I did not read `_ws_status`'s body closely enough to state
   which. Probe: source ccd, `_reg_set` a fake adopted id with no `wrapper`, call `_ws_status`.

6. **[I] `flock` behaviour for a *parent* reap holding the lock while a *child* reap is requested.**
   The lock path is `$REG/.reap-$id.lock` (ccd:1554, and `cmd_ws_reap`'s own). If children get their
   own ids they get their own locks, and nothing serialises parent-vs-child. Proposition: *two
   concurrent `ws-reap` runs, one on the parent and one on its child, both acquire their locks and
   the parent's `git worktree remove` races the child's.*

7. **[I] Whether `git worktree remove` on a parent refuses when the child is *untracked but not
   ignored*.** I measured the ignored case ([P], §4). The untracked case is masked by ccd's own
   `dirty-tree` guard firing first (ccd:2739), so it only matters for a design that relaxes that
   guard.

8. **[I] The `.claude/` ignore status per project.** Everything in §3/§4 branches on whether
   `.claude/` (or `.claude/worktrees/`) is in `.gitignore` / `info/exclude` for a given repo. If it
   is **untracked**, ccd refuses `dirty-tree` and nothing is destroyed. If it is **ignored**, ccd
   walks straight through. Probe: `git -C <each project> check-ignore -v .claude/worktrees/` across
   `$PROJECTS_ROOT/*`.

---

## 1. The single assumption, and where it is written down

**session = one worktree on one branch** is not stated once; it is encoded in five independent
places, and any adoption/child design has to move all five together.

| # | site | the encoded assumption | cite |
|---|---|---|---|
| 1 | registry shape | one `workdir`, one `branch`, one `workspace` per id | ccd:918-921 **[R]** |
| 2 | "is this a workspace" | *the presence of the `workspace` field*, nothing else | ccd:1021, ccd:1298, ccd:1752, ccd:1817, ccd:2452 **[R]** |
| 3 | "is this ours" | path is **exactly** `$WORKTREES_ROOT/$project/<one-segment>` | ccd:4328-4330 **[R]** |
| 4 | branch identity | registry `branch` must equal git's worktree record, or refuse | ccd:2538-2539 **[R]** |
| 5 | teardown | one `worktree remove` + one CAS `update-ref -d` | ccd:4049, ccd:4089 **[R]** |

Note the split: (2) is a *registry* question, (3) is a *filesystem-path* question, and they disagree
about the same tree. A foreign worktree fails (3) and has no answer to (2) at all.

---

## 2. `cmd_ws_add` — the info/exclude write (ccd:857-938)

### What it does today **[R]**

```
ccd:898-900   branch="ws/$slug";  git -C "$main" worktree add -b "$branch" --no-track "$wt" "$base"
ccd:911       common=$(git -C "$main" rev-parse --path-format=absolute --git-common-dir)
ccd:912       mkdir -p "$common/info"
ccd:913       grep -qxF '.ccrc/' "$common/info/exclude" || echo '.ccrc/' >> "$common/info/exclude"
ccd:915-921   _reg_set … wrapper/project/workdir/uuid/workspace/base/branch
```

**Exactly one pattern is excluded today: `.ccrc/`** (ccd:913). Nothing else. It is written to the
**shared** `info/exclude` (`--git-common-dir`, ccd:911), so it applies to the main checkout and every
worktree of that repo at once — that is deliberate and documented at ccd:903-910.

The `grep -qxF` is an *exact whole-line fixed-string* test (ccd:913), so it is idempotent per pattern
and additive-safe.

### What child-worktree support needs here

- **Add two patterns, not one.** `.claude/worktrees/` (Claude Code's own isolation trees — the 26 GB
  measured under `/data/projects/*/.claude/worktrees/`) and `.worktrees/`. Both as directory-suffixed
  patterns so they match the collapsed-directory form `--ignored=matching` produces (`build/`, see
  ccd:2050-2053). **[R]** on the mechanism, **[I]** on whether `.claude/` as a whole is already
  ignored per project (§0 item 8).
- **The loop shape has to change.** ccd:913 is a single hardcoded line; three patterns want a
  `for pat in .ccrc/ .claude/worktrees/ .worktrees/; do … done`. Cheap, but it is the line pinned by
  `ccd-workspaces.test.ts:241 'excludes .ccrc/ so a draft file can never be committed'` and
  `:258 'writes the exclude to the project itself when the environment shadows cd'` — both assert on
  the file's content, so both need updating.
- **THE TRAP:** excluding `.claude/worktrees/` is what *flips* the child from `?? .claude/`
  (untracked → ccd refuses `dirty-tree`, work safe) to `!! .claude/` (ignored → ccd walks straight
  into deleting it). **[P]** measured both states, §4 below. **Adding this exclude without also
  adding child-descent to the reap guards converts a safe refusal into a silent destruction.** This
  is the single highest-risk edit in the whole map.
- `--no-track` (ccd:899) and the `ws/` prefix (ccd:898) are the *parent* naming convention. Children
  are named by Claude Code (`agent-*`) and ccd will never own their names; any design that assumes a
  `ws/` branch prefix for children is wrong.

### Adoption needs a *new* registration path here

`cmd_ws_add` is the **only** writer of the `workspace` field (ccd:920) **[R]**. Adoption of a foreign
worktree means writing that field for a tree ccd did not create — so either a new verb (`ws-adopt`)
or a `--adopt <path>` arm. It cannot reuse `cmd_ws_add`'s body: ccd:899 *creates* the worktree and
ccd:892 dies on a slug that is not free.

---

## 3. `cmd_ws_archive` + `_ws_archive_manifest` (ccd:1290-1509)

### Fields, and the tree each is computed over **[R]**

| manifest field | computed by | over what tree | sees a nested child? |
|---|---|---|---|
| `branch` | `_reg_get "$id" branch` (ccd:1408) | registry only | no |
| `worktreeHead` | `_ws_wt_branch "$main" "$workdir"` (ccd:1430) | `$main`'s worktree record for **one path** | no — one path per call |
| `tip` | `git -C "$main" rev-parse refs/heads/$branch` (ccd:1457) | `$main` refs | no |
| `dirty` | `git -C "$workdir" status --porcelain` (ccd:1483) → count ccd:1487 | the parent worktree | **[P] no** — a child under an *ignored* path is invisible; under an unignored path it appears as one `?? .claude/` line |
| `ignoredDigest` | `_ws_ignored_digest "$workdir"` (ccd:1491) → `status --porcelain --ignored=matching` (ccd:411) | parent worktree, **directories collapsed to one entry** | only as the single string `.claude/` — its *contents* never enter the digest |
| `stashes` | `_ws_stash_count "$main" "$branch"` (ccd:1502) | repo-wide `refs/stash`, filtered to **the parent's branch name** (ccd:284) | **no** — a stash pushed from the child names `child/one`, matches neither `On ws/x:` nor `WIP on ws/x:` (ccd:284) and, being *named*, is not caught by the `(no branch)` arm either (ccd:369-371) |
| `worktreeBytes` | `_ws_gc_bytes "$workdir"` (ccd:1503) → `du -sb` (ccd:4190) | parent worktree | **yes — `du` is recursive**, so bytes silently include the child. This is the one field that *does* descend, and it descends into a number, not into a guard. |
| `pr`, `transcript` | registry / `_transcript_path` | — | no |

**So: `du` includes nested dirs; nothing else does.** **[R]** for the code paths, **[P]** for the
`dirty`/`ignored` visibility.

### Where a CHILD's uncommitted work is invisible to the manifest

**[P] measured.** With `.claude/` in `info/exclude`, a child worktree holding `?? .env` and
`?? uncommitted.txt`:

```
parent:  git status --porcelain            → (empty), rc 0
parent:  git status --porcelain --ignored=matching → "!! .claude/"
child:   git status --porcelain            → "?? .env"  "?? uncommitted.txt"
```

The manifest therefore records `"dirty":0` and one collapsed `ignoredDigest` entry, for a tree that
contains two uncommitted files and a whole second checkout. `ws-archive` is lossless so this costs
nothing *yet* — but it is the record `ws-reap` compares against (ccd:1320-1325 says so out loud).

### `archivedreason` is hardcoded `merged` — ccd:1344-1347 **[R]**

```
1344   local pr; pr=$(_reg_get "$id" prnumber)
1345   _reg_set "$id" archived "$(date +%s)"
1346   if [[ "$pr" =~ ^[0-9]+$ ]]; then _reg_set "$id" archivedreason "merged:#$pr"
1347   else                             _reg_set "$id" archivedreason "merged"; fi
```

Facts that decide the redesign:

- **Nothing in ccd verifies mergedness before writing this.** `cmd_ws_archive`'s own preamble
  (ccd:1291-1293) says it destroys nothing and only demands an affirmative idle (ccd:1315-1316). The
  merge proof lives 1,100 lines later in `_ws_reap_eval` Phase C (ccd:2793-2820). So
  `archivedreason=merged` is asserted about a workspace whose branch may be unpushed, unmerged, or
  have no PR at all. **[R]**
- The `#$pr` half is *also* known-unreliable: ccd:706-714 documents that a stale `prnumber` makes
  `ws-archive` file `merged:#42` for a PR that no longer binds, which is why `_pr_state_one` now
  `clear('prnumber')` unconditionally (ccd:704). The number is defended; the word `merged` is not.
- **`archivedreason` has no consumer.** `grep -rn archivedreason` over `ccrc/server/src`,
  `ccrc/shared`, `ccrc/agent/src`, `ccrc/ui` → **zero hits**. Only ccd writes it (ccd:1346-1347),
  `cmd_ws_restore` deletes it (ccd:1564), and three tests read it
  (`ccd-archive.test.ts:575, :587, :1037`). **[R]** It is a write-only breadcrumb today.

**Change map for a truthful reason.** The honest values are all locally derivable at ccd:1344:

| condition, at ccd:1344 | proposed value |
|---|---|
| `$pr` numeric **and** `_ws_gc_merged "$main" "$branch"` returns 0 (ccd:4425) | `merged:#$pr` |
| `$pr` numeric, merge unprovable | `pr-open:#$pr` |
| no PR, branch is an ancestor of `origin/HEAD` | `merged` |
| no PR, branch ahead of base | `parked` |
| the manifest recorded drift (`worktreeHead != branch`, ccd:1436-1448) | `drifted` |
| adopted foreign tree, never ccd's to merge | `adopted` |

`_ws_gc_merged` (ccd:4425-4441) is already in this file, already sets a three-state
`GC_MERGED_STATE` (`merged`/`unmerged`/`unprovable`, ccd:4424) and already refuses to fabricate on
rc 128 (ccd:4440). It is the right primitive and costs one `merge-base --is-ancestor`. **[R]**
Because there is no consumer, changing the *values* breaks nothing on the wire — but a new value
must not break the three tests above, and if the design wants the reason on the sheet it needs a new
`shared/api.ts` field, which is a separate contract change.

---

## 4. `_ws_reap_eval` — every rung, and how a nested child behaves TODAY

Function spans ccd:2445-2856. Phases as the file itself labels them.

### Phase A — identity (ccd:2450-2599) **[R]**

| rung | line | today, with a nested child |
|---|---|---|
| registry entry exists | 2451 | unaffected |
| `workspace` field non-empty ⇒ not a main checkout | 2452-2453 | **the whole adoption gate.** A foreign tree has no id and no `workspace`, so it is `not-a-workspace` and unreachable by every ws-* verb. |
| `archived` marker | 2454-2455 | unaffected |
| `project`/`workdir`/`branch` all present | 2469-2470 | unaffected |
| workdir missing without a `reaping` breadcrumb ⇒ `worktree-missing` | 2472-2478 | unaffected |
| `_ws_wt_branch` has a record ⇒ else `no-worktree-record` | 2521-2522 | asks about **one path only** (ccd:1002-1013). A child is a *separate* record in the same `worktree list` output and is simply never looked at. |
| record is not detached ⇒ else `detached-head` | 2528-2529 | ditto |
| `wthead == registry branch` ⇒ else `registry-branch-drift` | 2538-2539 | **the rung that kills naive adoption** — see §6 |
| `_ws_common_dir "$workdir" == _ws_common_dir "$main"` ⇒ else `foreign-worktree` | 2575-2577 | a *child of our own repo* passes this: it is the same common-dir. So `foreign-worktree` does **not** protect against nesting. |
| `REAP_WTHEAD="$wthead"` | 2597 | one value; the fingerprint has one slot |

**Descent requires:** a new enumeration between ccd:2478 and ccd:2521 that reads
`git -C "$main" worktree list --porcelain` **once** and collects every record whose path is a strict
prefix-descendant of `$workdir`. `_ws_wt_branch` (ccd:1002-1013) already parses exactly that output
and already resolves symlinks via `_ws_realpath` (ccd:944) — it should be split into a
`_ws_wt_records` producer and `_ws_wt_branch` kept as the one-path consumer, so children inherit the
symlink handling for free. **[R]**

### Phase B — nothing local is lost (ccd:2601-2741) **[R] + [P]**

Three reads, all `-C "$workdir"`, all one directory:

1. `git -C "$workdir" status --porcelain` with rc **and** stderr checked (ccd:2730-2734), count at
   ccd:2735, refuse `dirty-tree` at ccd:2737-2738.
   **[P] Does it see a nested child?** *Only if the child's path is not ignored.* Measured:
   - child at `parent/.claude/worktrees/agent-1`, `.claude/` **not** ignored → `?? .claude/`, one
     line ⇒ `REAP_DIRTY=1` ⇒ **refuses `dirty-tree`**. Work is safe, by accident.
   - `.claude/` in `info/exclude` → **empty output, rc 0, no stderr** ⇒ `REAP_DIRTY=0` ⇒ **passes**,
     even with `?? .env` and `?? uncommitted.txt` living inside the child.
2. `_ws_collect_ignored "$workdir"` (ccd:2739-2740 → ccd:2114-2363).
   **[P] Does it see the child?** Yes, as **one collapsed entry** `!! .claude/` (ccd:2265, the
   `'!! '*` filter). Then:
   - `du -sb "$wd/.claude/"` (ccd:2274) sizes the **entire child recursively** into `ignoredBytes`.
   - `_ws_sensitive_match ".claude/"` (ccd:2278) → no match.
   - because it is a directory, `_ws_sensitive_inside` (ccd:2296) walks it with
     `find "$abs" -mindepth 1 \( … \) -print0` under a 30 s **whole-workspace** deadline
     (ccd:2095, ccd:2023). So the child's `.env` **is** found and **does** raise
     `sensitive-ignored` (ccd:2741-2742) — the one guard §7 forbids overriding.
   **The consequence:** today a child holding a `.env` refuses; a child holding only ordinary source
   is walked, sized, and passed. Its uncommitted `.txt` is never seen by anything.
3. `sensitive-ignored` refusal (ccd:2741-2742).

**Descent requires:** for each child record found in Phase A, re-run rungs 1–3 with
`-C "$childpath"`, and merge the counts. The natural shape is to hoist ccd:2726-2742 into a
`_ws_reap_tree_guards <path>` helper and call it once per tree. Note the *asymmetry* that must be
preserved: the parent's ignored set must **stop collapsing at a registered child boundary**,
otherwise the child is double-counted (once as `.claude/` bytes, once as its own tree) and the
30 s budget is spent twice on the same files. **[I]** on cost (§0 item 1).

### The stash rungs (ccd:2802-2811, outside the `if [[ -d ]]`) **[R]**

- `refs/stash` existence corroboration (ccd:2802-2806) is **repo-wide** — unaffected by nesting.
- `REAP_STASHES=$(_ws_stash_count "$main" "$branch")` (ccd:2807) is scoped to **one branch name**
  (ccd:284). A stash pushed from a child on `child/one` is counted for neither the parent nor
  anything else. **Descent requires** `_ws_stash_count` to be called per child branch too, and the
  refusal detail (ccd:2809) to name which tree the entries belong to.
- `no-upstream` (ccd:2812) and `unpushed-commits` (ccd:2814-2818) are likewise per-branch.

### Phase C — merged PR (ccd:2820-2856) **[R]**

`REAP_TIP` (ccd:2821), `_gh_repo_slug` (ccd:2822), `_gh_pr_list` (ccd:2823), `_pr_py pick`
(ccd:2824), the tab-shift anchor (ccd:2845), the mandatory `timeout 60 git fetch` (ccd:2795 region /
ccd:2793-2799), `base-missing` (ccd:2812 region), `_ws_merge_proof` (ccd:2820).

Every one of these is about **one branch**. A child branch has, by construction, **no PR** — Claude
Code's isolation worktrees are not pushed. So a literal per-child Phase C would refuse `no-bound-pr`
for every child, permanently.

**Design consequence, stated plainly:** children cannot be gated on "merged". The only honest child
gate is *"nothing local is lost"* — Phase B rungs plus `unpushed-commits`/`stashes-present` —
because the child's commits are protected by a different mechanism: **[P] the attic already reaches
them.** `_ws_attic_pin` runs `git -C "$workdir" reflog show --all` (ccd:4004 → ccd:3202), and refs
are shared across worktrees of a repo, so a commit made in the child appears in that reflog **from
the parent's directory** (measured: `childtip` present twice in the parent's `reflog --all`). That
is luck rather than design — it works only for *committed* child work, only within the 200-entry cap
(ccd:3202), and it is not what the code's own comment claims to be doing (ccd:3153-3155 says "the
worktree's HEAD reflog"). Worth pinning with a test either way.

### Phase D1 (ccd:2828-2856) **[R]**

`_ws_status` (ccd:2829), `sensitiveDigest` (ccd:2838), `_ws_clip_manifest` (ccd:2851), and
`_ws_fingerprint` with **thirteen** inputs (ccd:2853-2855 → ccd:2404-2417). See §5 for whether
children join the fingerprint.

---

## 5. `_ws_reap_tail` — teardown order, and the CAS (ccd:3896-4142)

### The journalled sequence, as written **[R]**

| step | line | what |
|---|---|---|
| — | 3914 | `bytes=$(_ws_gc_bytes "$workdir")` — the receipt, recursive `du`, so it includes the child |
| — | 3929-3935 | breadcrumb phase must be one of `""\|worktree\|branch\|clips`, else `reaping-phase-unknown` |
| — | 3978-3982 | **re-read** `$REG/$id.archived`, else `not-archived` |
| (a) | 4004 | `_ws_attic_pin` |
| (b) | 4006 | `_ws_tombstone` |
| (c) | 4007 | `_reg_set "$id" reaping worktree` |
| (d) | 4008 | `_ws_unsupervise` |
| (e) | 4009 | `tmux kill-session` |
| (f) | 4037-4057 | `git -C "$main" worktree remove "$workdir"`; on failure refuse `worktree-remove-failed` (ccd:4050-4054); then `_reg_set "$id" reaping branch` |
| (g) | 4088-4095 | `git -C "$main" update-ref -d "refs/heads/$branch" "$REAP_TIP"` — **compare-and-swap**, refuse `branch-moved`; then `reaping clips` |
| (h) | 4117-4122 | `rm -rf "$cdir"` on `~/.cc-clips/$id`, path-confined |
| (i) | 4130 | `_reg_purge "$id"` |
| — | 4137-4141 | the `{"reaped":…}` receipt |

### What `git worktree remove` does when the removed tree CONTAINS another registered worktree

**[P] MEASURED, and this is the finding that drives the whole design.**

Setup: `main` + worktree `parent` (branch `ws/parent`) + worktree
`parent/.claude/worktrees/agent-1` (branch `child/one`), `.claude/` in `info/exclude`, child holding
uncommitted `.env` and `uncommitted.txt`.

```
git -C main worktree remove parent   →  rc 0      ← IT SUCCEEDS
ls -d parent                         →  No such file or directory
```

The parent directory — **including the entire child worktree and its uncommitted files** — is gone.
git does not notice, does not warn, does not refuse. Afterwards:

```
git -C main worktree list --porcelain
  worktree …/parent/.claude/worktrees/agent-1
  branch refs/heads/child/one
  prunable gitdir file points to non-existent location

git -C main branch -D child/one
  error: cannot delete branch 'child/one' used by worktree at '…/parent/.claude/worktrees/agent-1'
```

So the aftermath is: **destroyed work, a `prunable` orphan registration, and a branch that cannot be
deleted by any `branch -d/-D`** until the registration is pruned. ccd's own gc then classifies that
record `foreign-stale` (ccd:4326-4327 — path fails the `ours` test at ccd:4330 because
`rel` contains `/`) and `_ws_gc_prune_row` **declines it permanently**: *"is foreign metadata — ccd
removes only what it created"* (ccd:4586). A permanent, undeletable residue row.

### Where child-first ordering must slot in

Between (e) and (f), i.e. **at ccd:4037**, before the `if [[ -d "$workdir" ]]`. The order has to be:

1. for each child record, innermost-first: `git -C "$main" worktree remove "$childpath"`
2. for each child branch, innermost-first: the same CAS `update-ref -d` (ccd:4089) against a tip
   recorded in the tombstone
3. then (f)/(g) for the parent, unchanged

Reasons the ordering is not negotiable, all **[P]/[R]**:

- Doing the parent first destroys the child's *files* (measured above) while leaving its
  *registration* and its *branch* — the worst of both.
- `update-ref -d` on a child branch **before** its worktree is removed will not be blocked (unlike
  `branch -d`, which refuses "used by worktree at"; `update-ref` bypasses that check — this is
  **[I]**, worth a probe, because ccd chose `update-ref -d` over `branch -d` precisely to bypass
  git's opinions, ccd:4059-4060). Removing the worktree first makes the question moot.
- The breadcrumb vocabulary at ccd:3930 is a **closed set** (`""|worktree|branch|clips`) with an
  explicit refusal for anything else (ccd:3931-3934), written after a measured incident (ccd:3916-3928).
  Child steps therefore need **new breadcrumb phases added to that case arm** — e.g.
  `children`, `child-branches` — or the resume path refuses `reaping-phase-unknown` forever. This is
  a hard dependency: you cannot add a step without adding its phase word here **and** to the resume
  fork's own `case "$resumed"` (ccd:3766-3771 region, the `clips) : ;;` arm) **and** to
  `_ws_gc_prune_row`'s `reaping` row (ccd:4587).

### The CAS / fingerprint (`--expect`) inputs — do children need to join?

`_ws_fingerprint` (ccd:2404-2417) hashes **thirteen** named facts:

```
id, branch, tip, headRefOid, mergeCommit, proof, dirtyCount, ignoredDigest,
sensitiveDigest, stashCount, worktreeHead, baseOid, clipsDigest
```

**Yes, children must join — and the file already contains the argument for why.** ccd:2405-2412
documents the thirteenth input being added *because* pasting two clips between the sheet and the tap
left the token identical and the reap deleted them: *"A change to WHAT GETS DELETED that no human
consented to in any form is the one thing D2 exists to refuse."* A child worktree appearing between
audit and tap is exactly that shape, and today it is invisible: **[P]** with `.claude/` ignored, the
parent's `dirtyCount` stays 0 and `ignoredDigest` covers only the collapsed string `.claude/` — but
note ccd:2313-2334 changed the digest to hash the **records** (`sensitive\tbytes\tpath`), and the
record carries `du`'s recursive byte count, so *growing* a child does move the token. *Creating* the
first child moves it too (a new `.claude/` record appears). What does **not** move it is the child's
branch moving, or its HEAD changing, or an uncommitted file appearing inside it at constant size.

Minimum honest addition: a **fourteenth input**, `childrenDigest` — a sorted digest over
`path\tbranch\theadOid\tdirtyCount` per registered descendant. That mirrors `clipsDigest`'s shape
(hash a manifest rather than carry it, ccd:2413-2414) and inherits its refusal discipline
(ccd:2851-2852: a digest is a claim the thing was read; when it was not, **refuse**, don't emit "").

Knock-on: adding a fingerprint input invalidates **every** existing token fixture in
`ccd-ws-reap.test.ts` and `ccd-ws-audit.test.ts` that hardcodes a sha (see
`ccd-ws-reap.test.ts:958 'the token is IDENTICAL across two audits…'` and the `state-changed`
family at `:171/:179/:194/:207`).

Also: the **`bytes` receipt** at ccd:3914 is taken *before* (f) and is recursive, so on a
child-aware reap it will over-report unless children are measured separately. **[R]**

---

## 6. Session classification, adoption, and registry-`branch` drift

### Where "workspace vs main" is decided — **at registration, nowhere else** **[R]**

- `cmd_start` (ccd:5167-5185) registers `wrapper/project/workdir/uuid` and **never writes
  `workspace`** (ccd:5179-5181). That absence *is* "main checkout".
- `cmd_ws_add` writes `workspace "$slug"` (ccd:920). That presence *is* "workspace".
- Every consumer re-derives it from that one field: `cmd_ws_rm` ccd:1021-1023, `cmd_ws_rename`
  ccd:1159, `cmd_ws_archive` ccd:1298-1299, `cmd_pr_state` ccd:1752, `cmd_pr_open` ccd:1817,
  `_ws_reap_eval` ccd:2452-2453.
- `cmd_ls` (ccd:5336-5349) does **not** classify at all — it iterates `$REG/*.uuid` and prints
  `id / wrapper / alive / workdir`. There is no workspace column. **[R]**
- The fleet JSON is not built in ccd; `_ws_gc_scan`'s second loop keys on `$REG/*.workspace`
  (ccd:4388) — that glob is how ccrc enumerates workspaces.

**What adoption touches:** to make a foreign worktree a first-class session you must mint an id and
write `workspace` — at which point **every** verb above accepts it, including `ws-rm` (ccd:1015) and
`ws-reap`. There is no intermediate "adopted, read-only" tier today. If the design wants one, it
needs a *fourth* state beside main/workspace/absent — the cheapest shape that fits this file's
conventions is a new registry field (`adopted=1`) checked beside `workspace` at each of the seven
sites listed above, because a field's *absence* is already load-bearing and cannot carry a third
value.

**And `_ws_gc_row` must learn about it** (ccd:4316-4359): today ownership is decided **purely by
path shape** —

```
4328   local rel="${wt#$wsroot/$project/}"
4329   local ours=0
4330   [[ "$wt" == "$wsroot/$project/"* && -n "$rel" && "$rel" != */* ]] && ours=1
```

An adopted tree at `/data/projects/foo/.claude/worktrees/agent-3` can never satisfy this, so it will
be reported `foreign` (ccd:4345) and declined by `--prune` (ccd:4584) no matter what the registry
says. **Adoption requires ccd:4330 to consult the registry** — e.g. `ours=1` also when
`$REG/<id>.workdir` resolves to `$wt` — which turns a pure string test into a filesystem+registry
join and needs `_ws_realpath` (ccd:944) on both sides.

### The registry-`branch` field vs a drifting foreign branch

`branch` is written **once**, at ccd:921, and thereafter only by `cmd_ws_rename` (ccd:1242) **[R]**.

The rung that punishes drift is **`registry-branch-drift`, ccd:2538-2539**:

```
2538   [[ "$wthead" == "$branch" ]] \
2539     || { _reap_refuse registry-branch-drift "the registry says $branch, git's worktree record for $workdir says $wthead"; return 1; }
```

and its rationale is at ccd:2530-2537: *"reap cannot [let git win], because the registry's name is
what its stash count, its upstream check, its tip, its PR bind and its CAS delete are all built
from. So a disagreement here is never resolved, it is refused."*

`_ws_wt_branch` (ccd:1002-1013) is the *other* side: it reads `git -C "$main" worktree list
--porcelain`, matches on the resolved path (ccd:1009-1010), returns the branch name, `""` for a
recorded detached HEAD, and exit 1 for no record at all (ccd:1012). It explicitly *follows a rename
whether ccd or the user did it* (ccd:995-1001).

**The measured collision:** the CONTEXT records a live session
(`custom-tools-warm-meadow`) moving `ws/warm-meadow → feat/… → main` within hours. Applied to an
adopted foreign tree, that means:

- `ws-reap` refuses `registry-branch-drift` **permanently** (ccd:2539) — a state the operator must
  fix by hand every time Claude Code checks out a branch.
- `ws-archive` **records** it rather than refusing (ccd:1436-1448 states this ladder explicitly:
  drift is "a fact about the world that happens not to be the expected one", so it becomes the
  `worktreeHead` field) — so archive works and reap does not, which is exactly the "stranded in the
  live fleet" shape ccd:1370-1375 warns about, one layer up.
- `cmd_ws_rm` **lets git win and merely notes the divergence** (ccd:1105-1112) — a third policy for
  the same fact, in the same file.

**Design consequence:** for adopted trees, `branch` must stop being an identity claim and become a
*sample*. The identity primary key has to be the **path** (which `_ws_wt_branch` already keys on,
ccd:1009) plus the repo's common-dir (`_ws_common_dir`, ccd:983). The `branch` field then becomes
`branchAtAdoption`, recorded but never compared — and the CAS at ccd:4089 must take the branch from
`_ws_wt_branch` *at the instant of deletion*, with that name in the fingerprint so the token still
refuses a mid-flight switch. Three of ccd's own rungs currently assume the opposite (ccd:2538,
ccd:1408 manifest `branch`, ccd:4089 CAS).

---

## 7. Per-verb: `cmd_ws_rm`, `cmd_ws_gc`, `cmd_ws_restore`, `cmd_ws_attic`

### `cmd_ws_rm` (ccd:1015-1140) **[R]**

- Gate: `workspace` field non-empty (ccd:1021-1023).
- Evidence pair before touching anything: `_ws_wt_branch` registered **and**
  `_ws_common_dir "$workdir" == _ws_common_dir "$main"` (ccd:1046-1048).
- Dirty guard with rc **and** stderr (ccd:1077-1082) — **[P]** blind to an ignored child, exactly as
  Phase B is.
- Teardown: `_ws_unsupervise` (ccd:1085) → `tmux kill-session` (ccd:1086) → `git worktree remove`
  (ccd:1099) → `branch -d` (**not** `-D`, ccd:1108-1110) → `_reg_purge` (ccd:1138).
- **Same nesting hazard as the reap tail**, and worse: there is no attic, no tombstone, and no CAS
  here. A `ws-rm` on a parent holding a child destroys the child's files and leaves the undeletable
  branch — **[P]**. `branch -d` at ccd:1109 would *also* fail for the child if it were ever named,
  and the code already prints the "kept branch … unmerged, or still in use" line (ccd:1110), which
  is the message an operator would see with no idea a child was involved.
- Child-first removal must slot in at **ccd:1097**, before the parent's `worktree remove`.

### `cmd_ws_gc` (ccd:4723-4813) and `_ws_gc_scan` (ccd:4360-4407) **[R]**

**Does it walk `WORKTREES_ROOT` only? No — and this is the good news.**

```
4369   for main in "$PROJECTS_ROOT"/*; do
4370     [[ -e "$main/.git" ]] || continue
4383   done < <(git -C "$main" worktree list --porcelain 2>/dev/null; echo)
```

The scan roots are **`$PROJECTS_ROOT/*`**, and the enumeration is **git's own worktree list per
project**. So every one of the 37 `.claude/worktrees/` trees and every `ccrc-wt` tree **is already
enumerated**, provided it is registered against a repo under `$PROJECTS_ROOT`. `WORKTREES_ROOT` is
used only to *classify* (ccd:4367 → ccd:4330).

What happens to them today:

| tree | classification | `--prune` behaviour |
|---|---|---|
| `~/worktrees/<proj>/<slug>` (ours) | `tracked`/`dirty`/`archived`/`reaping`/`orphan`/`tree-unreadable` (ccd:4340-4347) | acted on |
| `/data/projects/<p>/.claude/worktrees/agent-*` | **`foreign`** (ccd:4345) | declined: *"ccd removes only what it created"* (ccd:4584) |
| same, directory gone | **`foreign-stale`** (ccd:4326) | declined: *"is foreign metadata"* (ccd:4586) |
| `/mnt/.../ccrc-wt/*` | `foreign` **[I]** — only if registered against a `$PROJECTS_ROOT` project; if the SDD reviewers registered them against a *worktree*, `worktree list` from `$main` still shows them (git flattens; **[P]** the nested child appeared in `$main`'s list) |
| `wt-model-rates-sync` sitting **inside** `$PROJECTS_ROOT` | scanned as its **own project** at ccd:4369-4371 (it has a `.git` file, `-e` passes for a file too), and its `worktree list` answers about the *parent* repo — so its main-checkout row is `mainreal` and skipped (ccd:4319), and the real project's rows get emitted twice, once per iteration **[I]** — worth an empirical check, it is a live inconsistency today |

So **gc is 11%-blind by policy, not by enumeration**: it *sees* the 26 GB and declines it. The
change is at ccd:4330 (`ours`), ccd:4584/4586 (the two decline arms), and the state vocabulary at
ccd:4340-4347. A `child` state — "registered, inside a workspace we own" — is the missing row.

Second loop (ccd:4388-4406) is the `dead-reg`/`reg-broken` arm; it keys on `$REG/*.workspace` and
skips anything `archived` or `reaping` (ccd:4395). Adopted ids get `.workspace` files, so they join
this loop automatically — including its `[[ "$p-$s" == "$id" ]]` composition check (ccd:4402), which
an adopted id must satisfy or be reported `reg-broken`.

### `cmd_ws_restore` (ccd:1512-1576) **[R]**

- Takes **`ws-reap`'s own lock**, `-n`, at ccd:1554-1560 — deliberately the same lock, argued at
  ccd:1521-1552.
- Removes `archived`, `archivedreason`, `archivemanifest` (ccd:1564) — so **any new truthful-reason
  field must be added to this rm list** or it survives a restore and lies about a live workspace.
- `_spawn` + `_ws_supervise` (ccd:1565-1567): an **adopted foreign session has no wrapper pane to
  spawn**. Restore of an adopted session either needs an adopted-aware `_spawn` or must refuse.
  **[I]** (§0 item 5).
- Children: nothing here touches them; a restore after a partial child teardown leaves children
  removed and the parent alive, with no record. New breadcrumb phases (§5) make this observable.

### `cmd_ws_attic` (ccd:1588-1611) **[R]**

- `--session` lists `refs/ccrc/attic/$id/`, `--drop` deletes them (ccd:1596-1607).
- `_attic_project` (ccd:1578-1586) resolves the project from the registry first, tombstone second —
  so it survives a reap.
- **Children ride along for free today** — **[P]** `_ws_attic_pin`'s `reflog show --all` from the
  parent worktree includes child-branch reflog entries, because refs are shared. But it is
  incidental: uncommitted child work is not a commit and is not pinned, and the 200 cap (ccd:3202)
  is shared between parent and children. A child-aware design should pin each child's tip explicitly
  at ccd:4004, the same way the parent's tip is appended unconditionally (ccd:3197-3203).

---

## 8. `caps` — what must be advertised (ccd:1246-1289)

`cmd_caps` prints a literal heredoc list (ccd:1259-1288) and takes **no argv** (ccd:1258). The list
today: `attach caps clip enable ensure list menu pick pr-open pr-state prefer start stop supervise
swap swap-self ws-add ws-archive ws-attic ws-audit ws-gc ws-reap ws-rename ws-restore ws-rm ls`.

**Hard constraint:** `ccd-archive.test.ts:130` asserts *caps == the dispatcher's own case arms*,
parsed out of the source by regex `^ {2}([a-z][a-z|-]*)\)` anchored on the
`if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then` guard (ccd:5415). So **any new verb must be added in
three places at once**: the dispatcher (ccd:5416-5439), the caps heredoc (ccd:1259-1288), and — for
anything the PWA may invoke — `ccrc/agent/src/whitelist.ts:299-307`'s `EXEC_WHITELIST.ccd`.

Verbs/flags the design plausibly needs:

| new surface | why | notes |
|---|---|---|
| `ws-adopt --path <p>` (or `--project <p> --path <q>`) | the only way to write `workspace` for a tree ccd did not create (§2) | whitelist: **do not grant** — it mints a deletable identity. Terminal-only, like `ws-attic --drop` (ccd:1589-1590). |
| `ws-disown --session <id>` | the inverse; must be reachable or adoption is a one-way trap | |
| `ws-children --session <id>` | read-only enumeration, so the sheet can *list* what a reap will destroy | safe to whitelist as `['ws-children','--session']`, mirroring `ws-audit` |
| new breadcrumb phase words | not a verb, but `_ws_gc_prune_row`'s `reaping` row prints the raw breadcrumb (ccd:4587) and `_ws_reap_tail` refuses unknown ones (ccd:3930) | see §5 |

`UNGRANTABLE_VERBS = ['ws-rm','ws-gc']` (`whitelist.ts:229`) and the `['ws-reap','--expect']` prefix
(`whitelist.ts:306`) are the existing precedents for "exists in caps, never reachable from the PWA".

---

## 9. Existing tests that pin the behaviours this design changes

Root: `/srv/projects/OpenClawHetzner/infra/ccrc/server/test/`
Harness: `ccdWsHelpers.ts` — `HOME` is the **only** isolation boundary (`ccdWsHelpers.ts:1-4`),
`PROJECTS_ROOT`/`WORKTREES_ROOT` derive from it with no env override (ccd:9-13). Any new fixture
must build its repos with `makeRepo`/`makeGhRepo` (`ccdWsHelpers.ts:98-158`) or it leaves the box.

### Directly contradicted by an ownership redesign

| test | file:line | what it pins |
|---|---|---|
| `classifies a worktree outside WORKTREES_ROOT as foreign` | `ccd-ws-gc.test.ts:91` | **the exact shape of the 37 live trees** — asserts `state === 'foreign'`. Adoption must change this expectation. |
| `classifies a worktree nested more than one level under WORKTREES_ROOT as foreign, not orphan` | `ccd-ws-gc.test.ts:131` | ccd:4330's one-segment rule, with a comment ("orphan would let --prune remove it … on a directory-depth guess") that is the counter-argument to loosening it |
| `classifies a foreign worktree whose directory is gone as foreign-stale, not stale-meta` | `ccd-ws-gc.test.ts:118` | the `foreign-stale` residue my probe produced |
| `NEVER touches a foreign worktree, at any flag` | `ccd-ws-gc.test.ts:800` | the decline arm at ccd:4584 |
| `declines to prune a foreign worktree's stale git metadata` | `ccd-ws-gc.test.ts:821` | ccd:4586 |
| `refuses when git's record and the registry name different branches, printing both` | `ccd-ws-audit.test.ts:1167` (`identity refusals`, describe at :1146) | **`registry-branch-drift`**, ccd:2539 — the rung that makes drifting adopted trees unreapable |
| `asks $main for the branch, so a stray git init cannot speak for us` | `ccd-ws-audit.test.ts:1187` | `_ws_wt_branch` as sole authority (ccd:1002) |
| `names the PR in archivedreason AND in what it prints` | `ccd-archive.test.ts:571` (asserts `'merged:#42'` at :575) | ccd:1346 |
| `records a reason even with no PR number, and no note in the line` | `ccd-archive.test.ts:581` (asserts `'merged'` at :587) | ccd:1347 — **the hardcoded word** |
| (restore) `undoes an archive completely` | `ccd-archive.test.ts:1031`, and `:1037` asserts `archivedreason` is null afterwards | ccd:1564's rm list |
| `excludes .ccrc/ so a draft file can never be committed` | `ccd-workspaces.test.ts:241` | ccd:913 — the exclude write |
| `writes the exclude to the project itself when the environment shadows cd` | `ccd-workspaces.test.ts:258` | ccd:911's `--git-common-dir` form |
| `advertises exactly the verbs the dispatcher implements` | `ccd-archive.test.ts:130` | caps/dispatcher parity (§8) |
| `registers the workspace with every field the wire needs` | `ccd-workspaces.test.ts:215` | ccd:918-921's field set |
| the `FIELDS` list | `ccd-workspaces.test.ts:117` | the enumerated registry field names `_reg_purge` reasons about (ccd:117-121) — a new field must be added here |

### Pinned around the reap tail and the token

| test | file:line |
|---|---|
| `removes the worktree, CAS-deletes the branch, and clears the registry LAST` | `ccd-ws-reap.test.ts:705` — the (f)/(g)/(i) order |
| `journals before it destroys — a kill at (d) leaves a resumable workspace` | `:735` |
| `advances the journal to clips BEFORE it removes them` | `:789` |
| `refuses a resume whose breadcrumb phase ccd never wrote, and destroys nothing` | `:1799` — **the closed phase vocabulary at ccd:3930** |
| `stops on a worktree removal it could not do, and keeps the registry` | `:815` |
| `refuses when the branch moved under the CAS, and never orphans it` | `:836` |
| `the token is IDENTICAL across two audits when nothing in the clips directory changed` | `:958` |
| the `state-changed` family | `:171`, `:179`, `:194`, `:207` — every one recomputes a 13-input fingerprint |
| `sees a secret one directory BELOW a collapsed ignored directory` | `:425` — `_ws_sensitive_inside`, the thing that *does* descend today |
| `refuses, with the remedy, when the scan runs out of its budget` | `:503` — the 30 s deadline (§0 item 1) |
| `implements no force or override flag of any kind` | `:123` — kills any `--force-children` escape hatch |
| Phase-B-on-resume family | `:1518`, `:1540`, `:1565`, `:1587` — each re-proves one parent-tree read; children need siblings |

### Pinned around the archive manifest

| test | file:line |
|---|---|
| `carries the stash count a reap would refuse on` | `ccd-archive.test.ts:628` |
| `archives a branch renamed by hand, naming both records and no tip` | `:965` (describe `records branch drift instead of refusing forever`, :961) |
| `archives a worktree parked on another branch, and says which` | `:987` |
| `archives a detached HEAD, recording the empty branch git records` | `:1004` |
| `records worktreeBytes as null … partially-unreadable subdirectory` | `:699` and `ccd-ws-gc.test.ts:1228-1264` — the `du` discipline any child-aware byte accounting inherits |
| `counts an OFF-BRANCH stash — a DETACHED worktree names no branch at all` | `:194` — `_ws_stash_count`'s base-commit arm (ccd:305-378), the closest existing analogue to "attribute work to a tree that names nothing" |

---

## 10. Summary of edit sites, in dependency order

| # | site | edit | risk |
|---|---|---|---|
| 1 | ccd:1344-1347 | truthful `archivedreason` via `_ws_gc_merged` (ccd:4425) | **low** — no src consumer; 3 tests |
| 2 | ccd:1564 | add any new reason/adoption field to the restore rm list | low |
| 3 | ccd:1002-1013 | split `_ws_wt_branch` into `_ws_wt_records` + one-path consumer | low, pure refactor |
| 4 | ccd:2478-2521 | Phase A enumerates descendant worktree records | medium |
| 5 | ccd:2726-2742 | hoist the three tree guards into a per-tree helper; run per child | **high** — the no-override guards |
| 6 | ccd:2807-2818 | per-child stash / upstream / ahead counts | medium |
| 7 | ccd:2404-2417, 2853 | 14th fingerprint input `childrenDigest` | **high** — invalidates every token fixture |
| 8 | ccd:3930 + resume `case` + ccd:4587 | new breadcrumb phases | **high** — a missed arm wedges the resume path forever |
| 9 | ccd:4004, 3438 | attic-pin and tombstone each child tip explicitly | medium |
| 10 | ccd:4037 (and ccd:1097 for ws-rm) | child-first `worktree remove`, innermost first | **critical** — §5 [P] |
| 11 | ccd:4089 | per-child CAS `update-ref -d`, tip from the tombstone | critical |
| 12 | ccd:4330, 4340-4347, 4584, 4586 | `ours` consults the registry; new `child` state; decline arms | medium |
| 13 | ccd:913 | add `.claude/worktrees/` + `.worktrees/` to the exclude write | **critical, and LAST** — it flips children from a safe `dirty-tree` refusal to silently deletable. Must not land before #5 and #10. |
| 14 | ccd:1259-1288 + ccd:5416 + `whitelist.ts:299` | new verbs, three places at once | low, but a parity test fails loudly if missed |

The ordering matters: **#13 is the enabling change and must ship after #5 and #10, not before.**
Today the only thing standing between a nested child worktree and `rm -rf` is that `.claude/` is
untracked rather than ignored, and ccd counts untracked files (ccd:2735, ccd:1077).

---

# Verification

Adversarial pass, 2026-08-04. Method: every ccd cite re-opened against
`/srv/projects/OpenClawHetzner/infra/ccrc-portability/ccd` at its committed
state (`281d625`, 2026-08-02, working tree clean — so no drift excuse); the three load-bearing git
measurements re-run from scratch on fresh fixtures (git 2.43.0, `GIT_CONFIG_GLOBAL=/dev/null`,
no network, throwaway repos under `…/scratchpad/probes-verify/`, deleted after); consumer hunt
widened past the packages §3 grepped.

**Headline: the map's mechanism claims survive; its safety conclusion does not, and a large block of
its line numbers is wrong.**

## REFUTED

### R1 — the closing safety claim is false on this box. `.claude/worktrees/` is ALREADY ignored in 6 of 6 projects that host children.

The map's last sentence, and the whole ordering argument in §10 (#13 "the enabling change … must
ship after #5 and #10"), rests on:

> "Today the only thing standing between a nested child worktree and `rm -rf` is that `.claude/` is
> untracked rather than ignored"

Read-only file check of every project under `/data/projects` that actually holds
`.claude/worktrees/` children:

| project | children | ignored by |
|---|---|---|
| custom-tools | 1 | `.gitignore:21 .claude/worktrees/` **and** `.git/info/exclude:11 **/.claude/worktrees/` |
| expoAI-assistant | 31 | `.gitignore:51 .claude/*` **and** `info/exclude:11` |
| orchard-api | 1 | `.gitignore:16 .claude/worktrees/` **and** `info/exclude:11` |
| intake-platform | 3 | `.gitignore:20 .claude/worktrees/` |
| rp-llm | 2 | `.gitignore:63 .claude/worktrees/` |
| MekWarLive | 0 | `.gitignore:120 .claude/*` **and** `info/exclude:12` |

6/6. (Also ignored, wholesale, in `megamek:21 .claude/` and `mm-data:13 .claude/`, and in
`synapsium-platform:51 .claude/*`.) So the state the map calls the safe one — untracked, `?? .claude/`,
`dirty-tree` refusal — **does not exist for any project that has children**. Every one of them is in
the state the map's own [P] measured as *passes the dirty-tree guard*.

Consequences the map states backwards:

- §2's "**THE TRAP**" is not a trap the design would spring; it was sprung before this design existed.
- §10's ordering ("#13 is the enabling change and must ship after #5 and #10") is moot as a *safety*
  ordering. #5 (per-tree guards) and #10 (child-first removal) are not protected by deferring #13 —
  they are **the only** protection, and they are absent today.
- The residual guard on those six projects is **`sensitive-ignored`** (ccd:2654), not `dirty-tree`
  (ccd:2650): a child holding a `.env` refuses; a child holding only source is walked, sized, and
  passed. The map says exactly this in §4 Phase B rung 2 — it just never carries it back to the
  conclusion.
- ccd:913 still deserves the `.claude/worktrees/` line (belt-and-braces, and `intake-platform` /
  `rp-llm` have no `info/exclude` entry), but it is now a **low-risk** edit, not "critical, and LAST".

### R2 — line citations in ccd:2640–2860 are wrong by 5 to 90 lines; two §10 edit-site rows point at the wrong code.

The file's own phase markers: A=2450, B=2601, C=**2743**, D1=**2815** (`grep -n '── Phase' ccd`).
The map has C=2820-2856 and D1=2828-2856 — both wrong, and §4's Phase C paragraph describes Phase D1's
address space.

| map cite | what is actually there | true line |
|---|---|---|
| `REAP_DIRTY` count "ccd:2735" | a comment about `_ws_gc_dirty` | **2648** |
| `dirty-tree` refusal "ccd:2737-2738" | `ahead=$(git … rev-list --count …)` | **2650** |
| `_ws_collect_ignored "$workdir"` "ccd:2739-2740" | the `unpushed-commits` refusal | **2651** |
| `sensitive-ignored` refusal "ccd:2741-2742" | `unpushed-commits`' else-branch text | **2654** |
| stash rungs "ccd:2802-2811" | `base-missing` | **2721-2726** |
| `no-upstream` "ccd:2812" | `return 1` | **2728-2729** |
| `unpushed-commits` "ccd:2814-2818" | blank | **2737-2741** |
| `REAP_TIP` "ccd:2821" | a comment | **2744** |
| `_gh_repo_slug`/`_gh_pr_list`/`_pr_py pick` "2822/2823/2824" | — | **2746/2747/2748** |
| `_ws_merge_proof` "ccd:2820" | — | **2808** |
| `_ws_status` "ccd:2829" | a comment | **2816** |
| `sensitiveDigest` "ccd:2838" | a comment | **2826** |
| `_ws_clip_manifest` "ccd:2851" | `REAP_DIRTY …` fingerprint arg line | **2847** |
| `_ws_fingerprint` call "ccd:2853-2855" | `REAP_VERDICT=reapable` | **2850-2852** |
| `registry-branch-drift` "2538-2539" | comment | **2534-2535** |
| `detached-head` "2528-2529" | comment | **2524-2525** |
| `no-worktree-record` "2521-2522" | comment | **2519** |
| `foreign-worktree` "2575-2577" | comment | **2583** |
| `REAP_WTHEAD=` "2597" | comment | **2599** |
| `'!! '` filter "ccd:2265" | `git … status --porcelain --ignored=matching -z` | **2271** |
| the 30s `REAP_IGNREASON` "ccd:2087-2090, 2102" | — | **2099** |

**§10 rows #5 and #6 are unusable as written.** "ccd:2726-2742 hoist the three tree guards" points at
the stash-corroboration + upstream/ahead block; the guards are at **2643-2654**. "ccd:2807-2818
per-child stash / upstream / ahead" points at `base-missing` / `_ws_merge_proof`; those rungs are at
**2721-2741**.

### R3 — §3's archive-manifest table cites land on comments, off by 10-30 lines.

Only `worktreeBytes` (ccd:1503) is right. `branch` 1408→**1377-1378**; `worktreeHead` 1430→**1398**;
`tip` 1457→**1431**; `dirty` 1483→**1466**, count 1487→**1470**; `ignoredDigest` 1491→**1475**;
`stashes` 1502→**1492**. Likewise `_ws_stash_count`'s `grep -cF -e "On $branch:" -e "WIP on $branch:"`
is at **292**, not 284 (284 is a comment); the `(no branch)` arm is at **361**, not 369-371.
The *semantics* of the table — which function computes each field, over which tree — are all correct.

### R4 — "`$REG/*.workspace` … that glob is how ccrc enumerates workspaces" (§6) is false.

`infra/ccrc/server/src/registry.ts:54-56` does `io.readdir(cfg.registryDir)` and filters
**`.uuid`**, then reads a fixed field list per id (`registry.ts:59-69`) which *includes* `workspace`.
The `$REG/*.workspace` glob is ccd-internal only — `_ws_gc_scan` (ccd:**4386**, not 4388) and
`cmd_pr_state`'s fleet arm (ccd:**1756**, which §6 does not mention at all).

### R5 — the adoption blast radius stops at ccd. It does not.

§6 lists seven ccd-internal consumers of the `workspace` field and then says "the fleet JSON is not
built in ccd" without naming what does consume it. Writing `workspace` for an adopted id enrols it in,
at minimum:

- `shared/api.ts:9` `workspace: string | null` — it is **on the wire**; parsed at `api.ts:622`.
- `server/src/fleet.ts:38` `if (r.workspace === null) return null;` — the workspace projection.
- `server/src/watch.ts:206, 212, 272` — the PR-polling loops filter on `r.workspace !== null`, so an
  adopted foreign tree gets `ccd pr-state` shelled at it on the poll interval.
- `server/src/watch.ts:304, 322` — merge-notification loop and its `✓ merged · project › workspace`
  push title.
- `server/src/server.ts:340` `if (rec.workspace !== null) return runCcdOr502(reply, CCD_ARGV.stopId(id))`
  — an adopted session with no tmux pane gets routed to `ccd stop`.

This is a second §0-item-5 ("no wrapper, no pane") in a different package, and the map's §8
whitelist analysis does not reach it.

### R6 — §5 files as [I] something ccd already documents as measured.

> "`update-ref -d` on a child branch before its worktree is removed will not be blocked … this is
> **[I]**, worth a probe"

ccd:**4064-4065** states it outright: *"Measured on git 2.43: `update-ref -d <ref> 000…0` and
`update-ref -d <ref> ""` BOTH delete unconditionally and exit 0."* My probe confirms it independently
(below). The map read the surrounding lines (it cites ccd:4059-4060 for "ccd chose `update-ref -d`
over `branch -d` precisely to bypass git's opinions") and still marked the consequence unknown.

### R7 — smaller cite drift (each verified individually)

`_ws_gc_prune_row`'s foreign-stale decline is **4583**, not 4586; the `_reg_purge` at reap-tail step
(i) is **4125**, not 4130; the receipt `printf` is **4132**, not 4137-4141; `cmd_ws_rm`'s `_reg_purge`
is **1134**, not 1138, and its `branch -d` is **1112**, not 1108-1110; `_ws_attic_pin`'s
`reflog show --all` + `head -200` is **3200**, not 3202; the resume `case "$resumed"` is **3761-3762**,
not "3766-3771"; the caps heredoc body is **1261-1288**, not 1259-1288; the dispatcher `case` starts
**5412** and its `BASH_SOURCE` guard is **5411**, not 5415; ccd:913 is quoted without its
`2>/dev/null`. None of these change a conclusion.

## CONFIRMED (28)

**The three re-run measurements — all three reproduce exactly.**

1. **(c) Where children register — CONFIRMED, and stronger than the map's hedge.** §0 item 3 offered
   two branches; only the first is real. A child at `parent/.claude/worktrees/agent-1` writes
   `gitdir: <main>/.git/worktrees/agent-1` — **flattened into the main repo's gitdir**, never under
   `<main>/.git/worktrees/parent/`. `git -C <main> worktree list --porcelain` lists it as a
   first-class record. True **whether the child is created from `$main` or from inside the parent
   worktree** (I tested both: `git -C parent worktree add …` still lands in `<main>/.git/worktrees/`).
   So §3/§4's "adoption is a classification change, not a discovery problem" holds. *Addition the map
   misses:* the gitdir directory is named from the child's **basename**, so two children named
   `agent-1` under different parents of the same repo collide in that namespace and git disambiguates
   — a child-enumeration keyed on that name would be wrong; key on the `worktree <path>` record.
2. **(a) Parent status visibility — CONFIRMED verbatim.** `.claude/` untracked → `?? .claude/`
   (one line, `REAP_DIRTY=1`, refuses). `.claude/` in shared `info/exclude` → `status --porcelain`
   **empty, rc 0, empty stderr** (so it also clears ccd:2643-2647's tree-unreadable conjuncts),
   `--ignored=matching` → `!! .claude/`, while the child itself reports `?? .env` and
   `?? uncommitted.txt`. Exactly as §3 and §4 Phase B claim.
3. **(b) `git worktree remove` of a parent containing registered children — CONFIRMED, all four
   aftermath facts.** `rc 0`; parent directory gone **with both children and their uncommitted files**;
   `worktree list` shows each child `prunable  gitdir file points to non-existent location`;
   `git branch -D child/one` → `error: cannot delete branch 'child/one' used by worktree at '…'`, rc 1.
   And the [I] from R6: `git update-ref -d refs/heads/child/one` on that same branch → **rc 0, branch
   gone**, registration still standing. So §5's child-first ordering argument is correct on every leg,
   including the leg it declined to test.
4. **Bonus [P] re-run — the attic reflog.** A commit made in the child appears **twice** in
   `git -C <parent> reflog show --all` (`refs/heads/child/x@{0}` and `worktrees/c1/HEAD@{0}`), so §7's
   "children ride along for free today" is real; and ccd:**3154**'s comment does say "the worktree's
   HEAD reflog" while ccd:3200 runs `--all`, so the "not what the code's own comment claims" charge
   stands.

**Code claims re-read and confirmed at (or within 2 lines of) the cited site:**

5. ccd:913 writes **exactly one** pattern, `.ccrc/`, via `grep -qxF … || echo … >>`, to the
   `--git-common-dir` `info/exclude` resolved at ccd:911. Idempotent, additive-safe. ✓
6. `cmd_ws_add` (ccd:920) is the **only** writer of the `workspace` field anywhere in ccd —
   `grep -n '_reg_set .* workspace'` returns one hit. ✓ (§2, §6)
7. The registry field set at ccd:918-921 is as tabled. ✓
8. The five encodings of "one worktree, one branch" (§1) all check out: ccd:1019-1021, 1298, 1752,
   1817, 2452-2453 for the `workspace` gate; ccd:4328-4330 for the one-segment path test; the drift
   rung; ccd:4049 + ccd:4089 for the one-remove/one-CAS teardown. ✓
9. `archivedreason` is hardcoded `merged` / `merged:#$pr` at ccd:1346-1347 with **no mergedness check
   anywhere before it**. ✓
10. **`archivedreason` has no consumer — confirmed harder than the map states.** Repo-wide grep
    (not just the four packages): zero non-test hits outside ccd, and decisively
    `server/src/registry.ts:59-69`'s field list reads `archived` and `archivemanifest` but **not**
    `archivedreason`, so it cannot reach the wire even by accident. Asserting tests:
    `ccd-archive.test.ts:575, :587, :1037`, plus the `FIELDS` roster at `ccd-workspaces.test.ts:117`. ✓
11. ccd:1564's rm list is `archived archivedreason archivemanifest`. ✓
12. `_ws_gc_merged` exists at ccd:4425 with the three-state `GC_MERGED_STATE` and the rc-128
    no-fabrication rule. ✓ (so §3's proposed truthful-reason primitive is available)
13. `_ws_wt_branch` at ccd:1002-1013 — one path, `""` for recorded-detached, exit 1 for no record. ✓
14. `_ws_common_dir` ccd:983, `_ws_realpath` ccd:944, `_ws_status` ccd:239, `_ws_stash_count` ccd:282,
    `_ws_collect_ignored` ccd:2114, `_ws_fingerprint` ccd:2404, `_ws_reap_eval` ccd:2445,
    `_ws_attic_pin` ccd:3153, `_ws_clip_manifest` ccd:3208, `_ws_tombstone` ccd:3438,
    `_ws_reap_tail` ccd:3896, `_ws_gc_bytes` ccd:4144, `_ws_gc_row` ccd:4316, `_ws_gc_scan` ccd:4360,
    `_ws_gc_merged` ccd:4425, `_ws_gc_prune_row` ccd:4562, `cmd_ws_gc` ccd:4723, `cmd_start` ccd:5167,
    `cmd_ls` ccd:5336 — every function-definition cite exact. ✓
15. `REAP_SCAN_SECONDS=30` at ccd:2023 and the `timeout "$left" find "$abs" -mindepth 1` at ccd:2095. ✓
16. `du -sb "$wd/$p"` inside `_ws_collect_ignored` at ccd:2274, and `du -sb "$1"` inside `_ws_gc_bytes`
    at ccd:4190. ✓ Both recursive, so §3's "`du` includes nested dirs; nothing else does" holds.
17. The three Phase B guards sit **inside** `if [[ -d "$workdir" ]]` (closing `fi` at ccd:2656) and the
    stash/upstream/ahead rungs sit **outside** it — the structural claim §4 makes, at the wrong
    addresses (R2). ✓
18. Phase A's ladder and its refusal words, in order: `no-such-session`, `not-a-workspace`,
    `not-archived`, `incomplete-registry`, `worktree-missing`, `no-worktree-record`, `detached-head`,
    `registry-branch-drift`, `foreign-worktree` — and the drift rung's rationale text is quoted
    accurately. ✓
19. `foreign-worktree` compares common-dirs, so **a child of our own repo passes it** — §4's key
    observation. ✓
20. `_ws_fingerprint` takes **thirteen** named inputs, in the order listed, and its comment carries the
    clips incident verbatim ("A change to WHAT GETS DELETED that no human consented to in any form is
    the one thing D2 exists to refuse"). ✓
21. The reap-tail sequence (a)…(i): ccd:4004, 4006, 4007, 4008, 4009, 4049/4051/4056, 4089/4090/4095,
    4122, 4125. `bytes=$(_ws_gc_bytes "$workdir")` at ccd:3914 — exact. ✓
22. The breadcrumb vocabulary is a closed set — `""|worktree|branch|clips` at ccd:3930 with
    `reaping-phase-unknown` at 3932 — and the resume fork has its own `case "$resumed"` with a
    `clips) : ;;` arm (3761-3762), and `_ws_gc_prune_row` prints the raw breadcrumb. §5's "three arms
    at once" dependency is real. ✓
23. `_ws_gc_scan` roots on `"$PROJECTS_ROOT"/*` (ccd:4369-4370) and enumerates via
    `git -C "$main" worktree list --porcelain` (ccd:4383, exact) — so §7's "gc is blind by policy, not
    by enumeration" is right. ✓
24. `ours` at ccd:4328-4330 is a pure path-shape test, quoted correctly. ✓
25. `cmd_ws_rm`: gate ccd:1021, evidence pair ccd:1046-1048, dirty guard with rc **and** stderr
    ccd:1076-1082, teardown 1085 → 1086 → 1099 → 1112 (`branch -d`, no `-D`) → 1134. Divergence is
    *noted, not refused*, at ccd:1108-1111 — the third policy for the same fact, as §6 says. ✓
26. `cmd_ls` (ccd:5336-5350) iterates `$REG/*.uuid` and prints ID/WRAPPER/ALIVE/WORKDIR with **no**
    workspace column. ✓
27. The caps heredoc lists **exactly** the 26 verbs §8 quotes, in that order, and `cmd_caps` takes no
    argv (`[[ $# -eq 0 ]] || die`). ✓ Dispatcher parity is real.
28. `whitelist.ts:229` `UNGRANTABLE_VERBS = ['ws-rm', 'ws-gc']` and `whitelist.ts:306`
    `['ws-reap', '--expect']` — both cites **exact**. ✓
29. **§9 is the most accurate section in the map.** 21 test cites spot-checked; every one names a real
    test whose title matches the map's description. Two (`ccd-ws-audit.test.ts:1167`, `:1187`) land a
    line or two into the test body rather than on `it(`, which is cosmetic. The `state-changed` family
    (:171/:179/:194/:207), the Phase-B-on-resume family (:1518/:1540/:1565/:1587), the reap-tail order
    tests (:705/:735/:789/:815/:836), `implements no force or override flag of any kind` (:123) and the
    gc classification set (:91/:118/:131/:800/:821) all check out verbatim. ✓

## UNTESTED

- §0 items 1, 2, 4, 5, 6, 8 as *runtime* propositions — the 30 s deadline over a real 26 GB tree, the
  `du` cost, branch-drift polling over the live foreign trees, `_ws_status` on a wrapper-less id, and
  parent/child `flock` interleaving. All require touching the live fleet or running ccd verbs, both
  outside this pass's safety envelope. (Item 8's *static* half is now answered — see R1.)
- §7's `wt-model-rates-sync`-inside-`$PROJECTS_ROOT` double-emission — needs `_ws_gc_scan` executed.
- The ccd test suite was not run; §9's citations were verified as *locations*, not as *passing*.

## Net assessment

Mechanism: sound. Every behavioural claim I could test reproduced, and several that the map hedged as
[I] are in fact settled (child registration flattening, `update-ref -d` bypassing the in-use check).

Two defects an implementer must not inherit:

1. **Re-derive every line number in ccd:1350-1510 and ccd:2600-2860 before editing.** §10 rows #5 and
   #6 currently address the wrong code.
2. **Reverse the risk framing.** The map's premise is that children are safe today and #13 would make
   them deletable. On this box children are already deletable — 6/6 projects that host them ignore
   `.claude/worktrees/`, and the only thing between `ws-reap` and a live child's checkout is whether
   that child happens to contain a file matching `_ws_sensitive_match`. #5 and #10 are not sequenced
   *before* an enabling change; they are the missing mitigation for a condition already in production.
