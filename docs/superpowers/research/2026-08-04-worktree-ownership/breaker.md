# Adversarial review — worktree adoption + child descent (D1–D5)

Sources read (not summarised from memory):
`/srv/projects/OpenClawHetzner/infra/<server-host>-portability/ccd` (5,439 lines),
`infra/ccrc/server/src/{lifecycle,fleet,registry,watch,wsaudit,server,ccdargv}.ts`,
`infra/ccrc/agent/src/whitelist.ts`, `infra/ccrc/shared/api.ts`.

Empirical probes: plain git 2.43.0, fresh repos under
`…/scratchpad/probes/p1|p2|p3`, local `file://`-style bare origins, no network, nothing
outside the scratchpad touched. Every line marked **MEASURED** was run.

---

## 0. The headline, and it inverts the framing of the task

D2 is described as *adding* `.claude/worktrees/` and `.worktrees/` to `info/exclude`. **On this
fleet those patterns are already in the projects' committed `.gitignore`**, so the state D2
creates is the state that already exists:

```
custom-tools/.gitignore:18  .worktrees/
custom-tools/.gitignore:21  .claude/worktrees/
rp-llm/.gitignore:59,63     .worktrees/ , .claude/worktrees/
acme-platform-ts:16      .claude/worktrees/
intake-platform:17,20       .worktrees/ , .claude/worktrees/
data-internal:42            .worktrees/
synapsium-platform:45,51    .worktrees/ , .claude/*
```

Which means the destruction path below is **live in ccd as shipped, today**, not something D2
introduces. D3 is not an accompaniment to D2; D3 is the fix for an existing latent data-loss path.
Design and staging must be written that way, or the plan will be sequenced as "D2 then D3" and the
window it opens will read as new when it is actually already open.

---

## F1 — `git worktree remove` destroys everything under an ignored path, including repositories it never enumerated. BLOCKER

**Scenario.** Session workspace `ws/parent`. Claude Code creates a child worktree at
`<workdir>/.claude/worktrees/agent-2`, works in it, leaves `notes.txt` uncommitted and one commit
unpushed. PR for the parent merges → archive → reap.

**MEASURED (probe p1), with `.claude/worktrees/` excluded:**

```
parent  git status --porcelain            -> (empty)          # REAP_DIRTY=0, dirty-tree PASSES
parent  status --porcelain --ignored=matching -> !! .claude/worktrees/
git -C main worktree remove <parent>      -> rc 0             # no --force needed
ls <parent>/.claude/worktrees/agent-2/    -> No such file or directory
```
`notes.txt` (uncommitted) is **gone, unrecoverably**. The unpushed commit survives only because the
branch ref happens to survive; the working tree does not.

**Worse — the nested-repo case D3 cannot see.** A plain `git init` (or a `git clone`, or a
superpowers `.worktrees/<feature>` set up as a clone) inside the same ignored path:

```
git -C main worktree list --porcelain | grep -c plain   -> 0     # invisible to D3's enumeration
git -C main worktree remove <parent>                    -> rc 0
ls <parent>/.claude/worktrees/plain                     -> No such file or directory
```
Its only copy of a commit is destroyed — objects and all. **D3 enumerates children with
`git worktree list` filtered by path prefix; that query structurally cannot see this.**

Contrast, same probe: `git clean -xfd` prints `Skipping repository .claude/worktrees/w` and leaves
it alone. Git *has* the safe primitive; `worktree remove` deliberately does not use it.

`ccd`'s own destructive tail is not the culprit and has no `--force` and no `rm -rf` fallback
(only `rm -rf` in the file is the clips directory, ccd:4120-4122, with a direct-child assertion).
The delete is inside `git worktree remove` at ccd:4049.

**Closure.** The enumerated-children gate is necessary but not sufficient. Before `worktree remove`
of a parent, walk the filesystem under `$workdir` for any `.git` (file or directory) that is not in
the enumerated child set, and refuse with a token naming the path. That is a filesystem question —
the same argument `_ws_sensitive_inside` already makes for itself at ccd:2034-2042
("git collapses a nested repository … the question here is what will be deleted, which is a
filesystem question"). Reuse that walk; it is already bounded and already runs.

---

## F2 — the dirty-tree guard is what protects children today, and it protects them only by accident. BLOCKER (staging)

**MEASURED (p1), no exclude in place:** parent `status --porcelain` → `?? .claude/`, so
`REAP_DIRTY=1` and `_ws_reap_eval` refuses `dirty-tree` (ccd:2649). That is the entire reason no
child has been destroyed yet in the projects that do *not* gitignore `.claude/worktrees/`.

So the current safety is: "the child happens to be untracked rather than ignored." Six projects on
this box have already lost that accident (§0). Any change that normalises the exclude — including
D2 as written — removes it everywhere, and F1 becomes reachable fleet-wide.

**Closure.** Never land D2 without F1's filesystem gate in the same commit. Write the inverted test
first: a fixture whose parent holds a child worktree with an uncommitted file, asserting the reap
**refuses**; then confirm it fails against today's `ccd` before the gate exists.

---

## F3 — path-prefix matching is broken by two symlink hops before any code is written. BLOCKER

D3 defines children by path containment. **MEASURED layout on this box:**

```
/home/you/projects -> /data/projects        (symlink)
cd /data/projects && pwd -P -> /srv/projects   (second hop)
git worktree list --porcelain reports the RESOLVED path (measured p3: an alias path is
  never echoed back)
registry `workdir` for a main-checkout session = "$PROJECTS_ROOT/$project"
                                               = /home/you/projects/<p>   (unresolved)
```

A naive `[[ "$childPath" == "$workdir"/* ]]` compares `/srv/projects/…`
against `/home/you/projects/…` and matches **nothing**. Descent then enumerates zero
children, every child gate passes vacuously, and `git worktree remove` deletes them (F1). The
failure is silent and unconditional — the most dangerous shape there is.

`~/worktrees` happens to be a real directory today (`pwd -P` → `/home/you/worktrees`), so
ws-add workspaces are accidentally fine and a test written only against them will pass.

**Closure.** Resolve both sides with `_ws_realpath` (ccd:944) exactly as `_ws_wt_branch` already
does (ccd:1004-1009, comparing both `$real` and `$path`). Add a self-check: the parent's own
workdir must appear in its own `worktree list` under the same normalisation before any child
conclusion is drawn — if the parent cannot find *itself*, "no children" is not an answer.

---

## F4 — `sensitive-ignored` fires on the project's own tracked source, permanently, with no override. BLOCKER (usability, but it is a §7 no-override guard so it is terminal)

Once the child worktree sits under an ignored entry, `_ws_collect_ignored` (ccd:2297-2309) hands
the collapsed directory to `_ws_sensitive_inside`, which `find`s the whole subtree against
`_WS_SENSITIVE_GLOBS` (ccd:1968). A child worktree is a **full checkout of the project**, so the
project's own committed files are scanned.

**MEASURED (p1):** repo with a tracked `migrations/001.sql`; child worktree created; parent's
ignored entry is `!! .claude/worktrees/`; the find predicate returns
`…/.claude/worktrees/agent-3/migrations/001.sql`. `.sql` is not in `_WS_SENSITIVE_NOISE_EXT`
(ccd:2012), so `REAP_SENSITIVE` is non-empty → `sensitive-ignored` (ccd:2653), which §7 forbids
overriding.

**Census of tracked, non-noise, secret-shaped filenames per project (`git ls-files`, read-only):**

```
data-internal 116   rp-llm 20   MekWarLive 7
custom-tools 0   acme-platform-ts 0   synapsium-platform 0   intake-platform 0   OpenClawHetzner 0
```

So in `data-internal`, `rp-llm` and `MekWarLive` **every session that has ever had a child worktree
becomes permanently un-reapable**, with a refusal whose remedy ("move them") means "delete your
repository's committed migrations". Meanwhile in `custom-tools` / `acme-platform-ts` /
`intake-platform` the guard does not fire — which is precisely why F1 is reachable there.

The guard is inverted from its purpose: it refuses on the projects where deletion is *safe* and
waves through the projects where the child is destroyed.

**Closure.** A child worktree is not "ignored bytes of the parent". Enumerate it, remove it from
the parent's ignored walk (prune the path in `_ws_sensitive_inside`'s `find`), and audit it as its
own unit against its own index — a file **tracked in the child** is in git and is not what the
sensitive guard is for.

---

## F5 — the 30 s scan budget and the `du` per entry do not survive 26 GB of children. SERIOUS

`REAP_SCAN_SECONDS=30` is a whole-workspace deadline (ccd:2023, 2080). Measured baseline in ccd's
own comment: 3.4 s over 355,392 entries. Measured on this box: 26 GB / 37 foreign worktrees, each a
full checkout plus (often) `node_modules`. `_ws_collect_ignored` also runs `du -sb` per entry
(ccd:2274) and **refuses the whole collection** if `du` does not complete cleanly.

Expiry produces `tree-unreadable` with the remedy "remove or move the largest ignored directory and
reap again" — i.e. the operator is told to hand-delete the very child worktrees the design exists
to manage. The same collector is on `ws-gc --prune`'s orphan arm (ccd:4508), so the sweep inherits
it.

**Closure.** Same as F4: excise enumerated children from the parent's walk and give each child its
own budget, so cost is linear in children rather than quadratic in the parent's tree.

---

## F6 — A1 answered: the fingerprint extension does **not** close TOCTOU, because the resume path never compares a token. SERIOUS

The recompute path is real and I checked it: `cmd_ws_reap` → `_ws_reap_locked` → `_ws_reap_eval`,
and the token is compared in ccd at **ccd:3887** (`if [[ "$token" != "$REAP_TOKEN" ]]`), server-side
never. So on the evaluated path a fingerprint extension does work.

But `_ws_reap_locked`'s resume fork is explicit at **ccd:3712-3733**: *"`--expect` IS NOT CHECKED ON
THIS PATH, and that is a decision rather than an oversight."* It re-proves Phase B and Phase D1
only. So:

- reap SIGKILLed at (c) (breadcrumb `worktree`, ccd:4007), worktree still on disk;
- a child is created or grown in the gap (a background agent process in a child, a resumed
  session, a human);
- the next `ws-reap --expect <any 64-hex>` takes the resume fork, re-runs `status` +
  `_ws_collect_ignored` (which sees the child only as ignored bytes), and `git worktree remove`
  destroys the new child set with **no consent covering it and no record of it**.

The tombstone cannot help: `_ws_tombstone` (ccd:3512-3521) records id/project/workdir/branch/base/
tip/uuid/wrapper/mergeCommit/proof/pr/prUrl/ignored/clips/transcript/attic/reflog/reapedAt —
**no child set**. `_ws_tombstone_reclip` (ccd:3526) re-measures clips only.

Second-order note: once `.claude/worktrees/` is an ignored entry, `REAP_IGNDIGEST` already moves
when child *bytes* change (record is `sensitive\tbytes\tpath`, ccd:2311/2354) — so on the evaluated
path much of the TOCTOU is already covered, and a naive "extend the fingerprint with child bytes"
adds volatility without adding coverage: with 26 GB of children any write refuses `state-changed`
and the sheet may never be re-confirmable.

**Closure.** (a) Fingerprint the child **set** — path + HEAD oid + dirty flag + branch per child —
not child bytes. (b) Record that set in the tombstone at (b), and on the resume re-enumerate and
refuse if it differs. The precedent is already in the file: finding E's clips re-measure on the
resume (ccd:4024-4034) is exactly this shape, including its refusal `tombstone-unwritable`.

---

## F7 — A3 answered: yes, there is a path where a child is silently destroyed, and it is not a `--force` anywhere. SERIOUS→BLOCKER (it is F1's mechanism, recorded separately because the question was asked directly)

There is no `--force` on any `git worktree remove` in ccd (ccd:4049 and ccd:1099 both bare) and no
`rm -rf` fallback in `_ws_reap_tail` — the only `rm -rf` is the clips directory, twice-guarded
(ccd:4099-4122). The destruction in F1 is `git worktree remove`'s own recursive delete of an
ignored subtree. **`git worktree lock` on the child does not protect it** — MEASURED (p2): locked
child, `worktree remove <parent>` → rc 0, child gone. Locking the **parent** does refuse
(rc 128, "cannot remove a locked working tree"), which is the only lock that buys anything.

One honesty point in ccd's favour, which should be stated in the design rather than discovered:
the reap sheet **does** list `.claude/worktrees/` among the ignored entries with its byte total
(`REAP_IGNORED` → `ign_json`, ccd:2311 → cmd_ws_audit). So this is not literally silent — it is
**misdescribed**: N git worktrees on M branches with dirty trees are presented in the same list as
`node_modules`, under the sentence "none of it is in git, and all of it goes" (ccd:4548).

---

## F8 — teardown primitives: `branch -d` refuses after the parent goes, and the CAS delete bypasses git's protection. SERIOUS

**MEASURED (p1/p3):**

```
after `worktree remove <parent>`:
  git branch -d agent/c3            -> rc 1  "cannot delete branch 'agent/c3' used by worktree at …"
  git update-ref -d refs/heads/agent/c3 <sha> -> rc 0     # ccd's (g) primitive, ccd:4089
and, on a LIVE (not stale) worktree elsewhere:
  git update-ref -d refs/heads/live/branch <sha> -> rc 0
  the live worktree then reports: "## No commits yet on live/branch…origin/main [gone]"
```

Two consequences for D3:
1. Order is load-bearing: children must be `worktree remove`d **before** the parent, or their
   `branch -d` refuses forever until a `worktree prune`.
2. Do **not** reuse the parent's `update-ref -d` CAS for children. It bypasses git's "branch is in
   use by a worktree" protection, and on this box that protection is real: 34 `ccrc-wt/*` review
   worktrees exist, any of which may hold the same branch. Use `worktree remove` then `branch -d`,
   and treat a `branch -d` failure as a refusal, never as a reason to escalate to `-D`.

---

## F9 — A6 answered: double-remove wedges the tail, and the breadcrumb vocabulary is a closed set. SERIOUS

**MEASURED (p2):**
```
worktree remove <child>            -> rc 0
worktree remove <child> (again)    -> rc 128  fatal: '<path>' is not a working tree
worktree remove <child-whose-dir-CC-deleted>  -> rc 0      # prunable record, clears fine
```
`_ws_reap_tail` refuses hard on `worktree-remove-failed` (ccd:4050-4054) with the whole stderr —
correct for the parent, wrong for a child that Claude Code's own cleanup already removed. And the
resumed-phase case list is **closed**: `""|worktree|branch|clips` at ccd:3929, anything else →
`reaping-phase-unknown`, permanently. A `children` phase must be added to that case statement, to
`_ws_reap_locked`'s per-phase tip re-validation (ccd:3761), and to `_ws_gc_row`'s `reaping` state
(ccd:4352) in the **same** change, or every interrupted child-inclusive reap wedges forever.

**Closure.** Child removal treats "record absent AND directory absent" as done; anything else
refuses. Write the breadcrumb `children` before the first child removal, since the tail's own
comment (ccd:3916-3928) establishes that a loose reading of an unknown phase is how a run reported
success over steps it had skipped.

---

## F10 — D1 as drafted makes an adopted session strictly **worse** off: classified as a workspace, then refused by every workspace verb. SERIOUS

`cmd_start` (ccd:5179-5183) writes exactly `wrapper, project, workdir, uuid, home, started`. **No
`branch`, no `base`, no `workspace`.** D1 backfills `workspace` only.

- `_ws_archive_manifest` requires `project && workdir && branch` (ccd:1379) → `incomplete registry`
  → `cmd_ws_archive` dies "cannot describe … truthfully" (ccd:1328). **Unarchivable.**
- `_ws_reap_eval` Phase A requires the same three (ccd:2472) → `incomplete-registry`. **Unreapable.**
- `watch.ts:206/212` now includes it in the per-project `pr-state` sweep; `_pr_state_one` answers
  `{"phase":"unknown","reason":"error"}` for a branchless session (ccd:1626) — every 120 s, forever.

So adoption without a branch backfill converts an ignorable main-checkout session into a permanently
stuck pseudo-workspace that also pollutes the PR lane.

**Closure.** Adoption must backfill `branch` (from `_ws_wt_branch "$main" "$workdir"` — git's record,
never `rev-parse` in the directory, per ccd:990-1001) and `base` (default `origin/HEAD` is already
`_ws_reap_eval`'s fallback at ccd:2470, but `_ws_archive_manifest` records it, so write it
explicitly). Refuse adoption outright for a detached worktree rather than adopting it branchless.

---

## F11 — A2 answered: drift is terminal and there is no verb that ends it. SERIOUS

Measured on this box: `custom-tools-warm-meadow` moved `ws/warm-meadow → feat/… → main` within
hours. `_ws_reap_eval` rung 1 (ccd:2534) refuses `registry-branch-drift` and the surrounding
comment is explicit that the disagreement "is never resolved, it is refused".

There is **no remedy verb**:
- `ws-rename` renames the branch *in git* and refuses once it has an upstream (ccd:1219-1221) — the
  drifted case always does.
- `cmd_ws_rm` is terminal-only and deliberately absent from `EXEC_WHITELIST` (whitelist.ts:293-297).
- Nothing writes `$REG/<id>.branch` except `ws-add` and `ws-rename`.

So an adopted workspace that drifts is unreapable forever, and the only escape is a hand edit of
`$REG` — for a fleet whose stated goal is "ccd owns the whole lifecycle".

**Closure — pick one and write down the cost.**
(a) `ccd ws-rebind --session <id>`: re-point the registry `branch` to git's record. Cheap; must be
terminal-only or token-gated, because it turns a refusal into a pass.
(b) Treat the registry `branch` as a cache refreshed from git at every fleet scan. The drift veto
then dies by construction — acceptable **only** if the fingerprint's `worktreeHead` (ccd:2599,
fingerprint field 11 at ccd:2413) becomes the sole branch authority and the consent sheet shows the
branch it will delete. Note the disclosed mutation survivor at ccd:2593-2598 says exactly this: the
field is written from `wthead` "the day that rung moves or softens".

---

## F12 — D1 arms an unattended pane-kill on live sessions. SERIOUS

`FleetWatcher.archiveMerged` (watch.ts:304) skips `r.workspace === null`. That single null check is
the only thing keeping the 120 s sweep away from main-checkout sessions today. Backfilling
`workspace` makes every adopted session eligible: the moment a PR bound to its registry branch reads
`merged`, ccd runs `ws-archive`, which `_ws_unsupervise`s and `tmux kill-session`s (ccd:1341-1342) —
destroying the pane and its scrollback of a session the user may be actively working in, on a
different branch (the measured drift case).

`archiveSafety` checks only busy/idle. An idle session between turns looks identical to an abandoned
one.

**Closure.** Do not overload `workspace` as the adoption flag. Add a distinct `adopted` field, and
gate `archiveMerged` on `workspace !== null && adopted !== '1'` (or require an explicit per-session
opt-in). Auto-archive of a session a human never asked ccd to manage is a policy change, not a
classification change, and it should be a separate decision in the plan.

---

## F13 — A7 answered: `workspace` is not a label, it is a switch in five subsystems, and a non-slug value breaks two of them. SERIOUS

Consumers found by grep:

| site | what it does with `workspace` |
|---|---|
| `fleet.ts:38` (`persistedPr`) | non-null ⇒ the session gets a PR control on screen |
| `watch.ts:206,212,272` | non-null ⇒ included in the per-project `pr-state` sweep |
| `watch.ts:304` | non-null ⇒ eligible for automatic archive (F12) |
| `server.ts:340` | non-null ⇒ `/stop` uses `stopId(id)` instead of `stopPair(wrapper,project)` |
| `ccd:2453, 1021, 1161, 1298` | non-empty ⇒ reap / rm / rename / archive are permitted at all |
| `ccd:4414` (`_ws_gc_scan`) | requires `"$p-$s" == "$id"` |
| `shared/api.ts:9,622` | on the wire; PWA fleet line falls back `name ?? branch ?? workspace ?? id` |

Two break:
- **`ccd:4414`.** An adopted id is `<wrapper>-<project>` (e.g. `claude-custom-tools`), so
  `"$project-$slug"` can never equal it. Every adopted session whose directory vanishes emits a
  `reg-broken` row forever and is never purged by `--prune`'s dead-reg arm. Registry rows leak.
- **`_ws_slug_free`** (ccd:791) only inspects `$REG/$project-$slug.*`. An adopted session's label
  lives under `$REG/<wrapper>-<project>.workspace`, so `_ws_slug_new` can hand a brand-new ws-add
  workspace the same label an adopted session already displays. Two rows, same `project › workspace`
  string on screen.

`server.ts:340` is benign (measured by reading `cmd_stop`, ccd:5323-5329: the one-arg form takes any
id whole). A branch-shaped value like `feat/company-enquiry` never reaches argv or a path — it is
display + boolean only — so it is not a safety issue, but it will render as a slug in the fleet line.

**Closure.** Keep `workspace` meaning "a ccd-created slug". Add `adopted=1` and, if a display label
is wanted, `wslabel`. Change ccd's four permission gates from "workspace non-empty" to "this workdir
is a linked worktree of `$PROJECTS_ROOT/$project`", which is the fact the gates are actually about
and which `_ws_common_dir` + `_ws_wt_branch` already answer.

---

## F14 — A9 answered: adoption turns a read into a write on repositories ccd never initialised. SERIOUS

`cmd_ws_add` writes `.ccrc/` into `$common/info/exclude` (ccd:911-913) — for repos it created a
workspace in. **MEASURED:** exactly 6 of 21 projects have that line today. D2's exclude write would
extend to every adopted project, i.e. ccd starts writing into the git metadata of checkouts the user
works in daily and that ccd has otherwise only read.

Two costs, both real:
1. The exclude is **repo-wide across every worktree including the main checkout**. Adding
   `.claude/worktrees/` there hides those directories from the user's own `git status` in the main
   checkout — and the untracked marker is currently the only thing telling anyone that 26 GB of
   agent worktrees exist under `/data/projects/*/.claude/worktrees/`.
2. It is the change that makes F1 reachable (F2).

**Closure.** Do not use `info/exclude` for this at all. Children are enumerable from git; teach the
guards about them directly. That deletes the write, keeps the untracked-dirty refusal as a backstop
in the six projects that still have it, and removes an irreversible edit to a repo ccd does not own.

Also for A9: reap inside a `.claude/worktrees/` parent removes a directory **inside the user's daily
checkout**. `git worktree remove` handles that fine, but the branch step does not (F8), and the
`ws-gc` classification does not (F17).

---

## F15 — A4 answered: the premise is wrong in one direction and worse in another. MODERATE

**ws-gc already sees them.** `_ws_gc_scan` (ccd:4369) iterates `$PROJECTS_ROOT/*` and reads each
main's `git worktree list`. Measured: `/data/projects` resolves to `/srv/projects`
and `ccrc-wt/exec/.git` contains
`gitdir: /srv/projects/OpenClawHetzner/.git/worktrees/exec` — so both the 37
`.claude/worktrees/*` trees and the 34 `ccrc-wt/*` trees **are linked worktrees of mains under
PROJECTS_ROOT and are already enumerated**, classified `foreign` by `_ws_gc_row` (ccd:4346-4347),
reported and never pruned. The "34 invisible" premise should be corrected before it drives design.

**What is genuinely uncovered:**
- A worktree whose main is *not* under `$PROJECTS_ROOT` — nothing enumerates it.
- `wt-model-rates-sync`: **MEASURED**, `/data/projects/wt-model-rates-sync/.git` is the file
  `gitdir: /srv/projects/data-internal/.git/worktrees/wt-model-rates-sync`. It is
  a *worktree masquerading as a project*, so `_ws_gc_scan` iterates it as its own project and
  enumerates `data-internal`'s entire worktree list **a second time under a different project label**
  — with different `ours` classification, and `_ws_gc_prune_row`'s `stale-meta` arm would run
  repo-wide `git worktree prune` from the nested main. `listProjects` also offers it as a `ws-add`
  target (`server.ts:326` passes `:project` straight through with no validation; ccd only checks
  `^[A-Za-z0-9._-]+$`).
- **D3's containment rule mis-models the box.** The children a session actually creates today are
  not all under its workdir: `ccrc-wt/*` is on a different volume entirely. Path containment will
  classify those as orphans, not children, forever.

**Closure.** D4's "listProjects skips linked worktrees" is right and cheap: `io.readdir('<dir>/.git')`
returns null for a *file*, which is the exact directory-ness probe `lifecycle.ts:45` already uses.
Apply the same skip in `_ws_gc_scan`'s project loop. Then say explicitly whether out-of-tree children
(`ccrc-wt`) are in scope; if they are, the child relation must be **recorded at creation** (a
registry side-file per session), not inferred from paths.

---

## F16 — A5 answered: a vanished child is prunable metadata, not lost work, and the parent's own rung says the opposite. MODERATE

**MEASURED (p2):** CC deletes its own child directory →
`worktree list --porcelain` shows the record plus `prunable gitdir file points to non-existent
location`; `worktree remove <child>` → rc 0; `branch -d` then → rc 0.

The parent's analogous rung is a **refusal**: `worktree-missing` unless a breadcrumb exists
(ccd:2475-2479), on the stated principle "a missing worktree is a refusal when the USER removed it
and a resume when WE did". For a child the same principle gives the opposite answer — CC removing
its own child is the normal case, not a user hand-deletion.

The `/tmp` registration (registered workdir at a swept scratchpad path) is the *parent* shape of
this: `worktree-missing` → refusal → nothing ever cleans it up, and `_ws_gc_scan`'s dead-reg arm
skips it if it is archived or reaping (ccd:4395).

**Closure.** State the child rule explicitly: a prunable child record is cleared, its branch must
still pass the reachability gate before `branch -d`, and a child whose *directory* is gone but whose
*branch* is unreachable from base refuses the parent (the work is in the reflog only, and
`_ws_attic_pin` (ccd:3153) pins **only the parent's** reflog).

---

## F17 — two subsystems will permanently disagree about the same directory. MODERATE

`_ws_gc_row`'s `ours` test is "exactly one level below `$wsroot/$project`" (ccd:4328-4330), so an
adopted worktree can **never** be classified as ours — it is `foreign`, "reported so it is visible,
never pruned". Meanwhile its registry row will say `workspace`, and `ws-reap` will delete it.
`ws-gc` will keep reporting a directory that reap already owns, and after a reap it will report
nothing at all because the registry row is purged.

**Closure.** Make `ours` mean "a registered session's workdir" (registry lookup by resolved path)
rather than "under `$wsroot/$project` at depth 1". One predicate, two consumers.

---

## F18 — stash accounting does not descend, and the descent makes the existing fleet-wide arm far more likely to fire. MODERATE

`refs/stash` is shared across every worktree of a repo (ccd:295-297). A `git stash` taken **inside a
child** names the *child's* branch, so `_ws_stash_count "$main" "$parentBranch"` returns an honest 0
and the parent reap passes — then the child's worktree and branch go, and the stash's association is
orphaned (objects survive while `refs/stash` does).

Worse: the off-branch arm (ccd:359-368) attributes an **anonymous** stash by base commit, and ccd's
own comment (ccd:328-335) concedes that one such stash on shared history "counts against all of
them and every workspace of that project answers `stashes-present`". Children are detached and
short-lived, so anonymous stashes taken in them are exactly the shape that arm catches — and one of
them wedges every workspace in the project.

**Closure.** Count stashes per **child branch** in the descent, and put the child's name in the
refusal detail (the file's own standard: the remedy travels in the message).

---

## F19 — A10 answered: archive/restore are coherent about children, the byte figure is not. MINOR

Archive touches children not at all — it destroys nothing (ccd:1290-1293), and restore requires only
`[[ -d "$workdir" ]]` then `_spawn` + `_ws_supervise` (ccd:1561-1567). Children are still there. So
there is no restore incoherence.

The incoherence is arithmetic: `_ws_archive_manifest`'s `worktreeBytes` is `_ws_gc_bytes "$workdir"`
(ccd:1503), i.e. `du` over the whole tree **including** children, surfaced as `archivedBytes` on the
fleet wire. The UI promises reclaimable bytes that D3 will then refuse to reclaim.

**Closure.** Report parent bytes and child bytes as two fields, and say how many children the refusal
would be about.

---

## F20 — `archivedreason` is a live forgery today; D4 should be framed as fixing it. MINOR

`cmd_ws_archive` writes `merged:#N` when a PR number exists and the bare literal **`merged`**
otherwise (ccd:1346-1347). A human archiving an unmerged workspace therefore gets a record asserting
it was merged — the exact measurement-forgery class this file hunts everywhere else. D4's
`empty|manual|merged:#N` is correct; write it up as a defect fix with the line cited, not as a new
field.

Related and load-bearing for D3: `wsaudit.ts`'s `SENTENCES` map is enumerated **in both directions**
against every token ccd's source can emit (its own header says so, and `refusalSentence` falls back
to `ccrc declined: <token>`). Any new refusal token from the descent (`child-dirty`,
`child-unpushed`, `child-foreign-repo`, `children-changed`) must land in `SENTENCES` in the same
commit — the test failing is the mechanism working.

---

## F21 — A8 answered: no whitelist widening is required, and one temptation must be refused explicitly. MINOR

D1–D4 as drafted introduce **no new argv and no new grant**. Archive/Restore already exist
(`['ws-archive','--session']`, `['ws-restore','--session']`, whitelist.ts:303-304). Child paths come
from `git worktree list`, never from argv — no new user-controlled string reaches a command line.
`CcdArgv`'s brand (ccdargv.ts) still holds; `CCD_ARGV` is the only mint site.

Three things to pin in the plan so a later round does not undo them:
1. `ws-gc` is in `UNGRANTABLE_VERBS` (whitelist.ts:229) and absent from `EXEC_WHITELIST` because
   `['ws-gc']` would permit `--prune`. If orphan enumeration (F15) is wanted in the PWA, it needs a
   **new read-only verb** with its own name — never a `ws-gc` grant.
2. Any new destructive step that reaches `rm -rf` must carry the direct-child assertion the clips
   path carries (ccd:4099-4122). Today `git worktree remove` is the only recursive delete on the
   parent path and it must stay that way.
3. `REQUIRED_VERB_FLAG` (whitelist.ts:218) pins `ws-reap` to `--expect`. A `--children` or
   `--force-children` flag would be a *different* grant; it must not be added to the same prefix.

---

## Ordering the fixes

1. **F1 + F2 + F3** are one commit: enumerate children (resolved paths), refuse on any un-enumerated
   `.git` under the workdir, and prove it with a test that fails against today's ccd.
2. **F4 + F5**: excise children from the parent's ignored walk; audit each child on its own index.
3. **F6 + F8 + F9**: child set in the tombstone, `children` breadcrumb phase, children-before-parent
   with `worktree remove` + `branch -d` and no CAS escalation.
4. **F10 + F11 + F12 + F13**: `adopted` as its own field; backfill branch/base; a rebind story;
   `archiveMerged` gated off adoption.
5. **F14 + F15 + F17**: drop the `info/exclude` write; skip linked worktrees in `listProjects` and
   `_ws_gc_scan`; unify the `ours` predicate.
