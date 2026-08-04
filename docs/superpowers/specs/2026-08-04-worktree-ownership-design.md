# Worktree ownership — child worktrees under workspace sessions

Ratified 2026-08-04 by the operator: **guards + ordered teardown + honest
consent UI**, adoption of foreign worktrees explicitly cut. Built in THIS repo
(`ccrc-pwa`), after the canonicalisation runbook
(`docs/superpowers/plans/2026-08-04-ccrc-pwa-canonicalisation.md`) completes.

Evidence base: `docs/superpowers/research/2026-08-04-worktree-ownership/` —
eight reports (six investigators, two adversarial verifiers, one critique)
produced 2026-08-04 against monorepo commit 9f15625 / ccrc-pwa b7ba967, plus
the operator's on-disk inspection of Conductor 0.77.5. Facts below marked
MEASURED were reproduced by an independent verifier on fresh fixtures.

**Line numbers in this spec and in the research are UNTRUSTWORTHY by
default** — verification found ~25 of the code map's ccd cites off by 5–90
lines. Every edit site must be re-derived from the pinned tree at plan time by
searching for the quoted code, never taken from a `ccd:NNNN` cite.

## The problem, measured

A Claude Code agent running inside a ccd workspace session creates its own
worktrees under the workspace (`.claude/worktrees/agent-<hex>` for
`isolation: worktree` subagents; superpowers uses `.worktrees/`). Today:

1. **MEASURED (git 2.43.0):** `git worktree remove <parent>` with a registered
   child worktree nested inside SUCCEEDS at rc 0, no warning, and deletes the
   child — uncommitted work and all. `ccd`'s reap tail and `ws-rm` both run
   exactly this command.
2. **MEASURED:** whether ccd reaches that command is decided by gitignore
   state. Six of six child-hosting projects on the fleet already ignore
   `.claude/worktrees/`, so a child leaves the parent's `git status
   --porcelain` EMPTY — the `dirty-tree` rung passes. The hole is live in
   shipped ccd; only the current absence of children under the six live
   workspaces (measured 2026-08-04) makes exposure zero today.
3. **MEASURED:** `git worktree lock` on a child does NOT block removal of the
   parent (rc 0, child destroyed). Locks protect only direct-target removal.
   A locked orphan is immune to `worktree prune` even `--expire=now` and pins
   its branch until an explicit unlock.
4. **MEASURED:** a nested INDEPENDENT repository (plain `git init`, a clone, a
   superpowers `.worktrees/<feature>` clone) is invisible to `git worktree
   list` — path-prefix enumeration structurally cannot see it — and
   `worktree remove <parent>` destroys it objects-and-all. (`git clean -xfd`
   prints "Skipping repository"; git has the safe primitive, worktree remove
   does not use it.)
5. **MEASURED:** children register FLAT in `<main>/.git/worktrees/<leaf-basename>`
   at every depth — no parent/child field exists anywhere in git's records.
   Nesting is a filesystem accident; the tree is reconstructed only by
   resolved-path prefix. And the fleet's paths are symlinked
   (`~/projects → /data/projects → /srv/projects`):
   registry `workdir` holds unresolved paths, git reports resolved ones, so
   **all containment math MUST use `pwd -P`-resolved paths on both sides** or
   every child gate passes vacuously.
6. The reap fingerprint (thirteen inputs) contains nothing about children, and
   the resume fork after an interrupted reap deliberately does NOT re-check
   `--expect` — a child created after consent is destroyed on resume with no
   consent and no record.
7. The ReapSheet already shows child bytes today — inside the ignored-files
   total, under the sentence "none of it is in git, and all of it goes".
   Live checkouts presented as disposable build output: the measurement-forgery
   class this codebase keeps finding, already on its own consent sheet.

## Design

### D1 — The nested-checkout guard (ships first, alone deployable)

Immediately before ANY `git worktree remove` ccd performs (reap tail, ws-rm),
walk the target directory for stray `.git` entries (file or directory) other
than the target's own:

- Any found → refuse, token `nested-checkouts-present`, detail naming each
  path. No override flag exists (consistent with the file's no-force rule,
  pinned by the existing "implements no force or override flag of any kind"
  test).
- A **filesystem walk**, not a `git worktree list` query — fact 4 requires it.
  `find <target> -mindepth 2 -name .git` shape; the walk must treat
  unreadable directories as a refusal (`tree-unreadable`), same polarity as
  every Phase B read.

This alone closes the data-loss path: with the guard in place, the worst a
parent reap can do with children present is refuse.

### D2 — Child-aware descent in `_ws_reap_eval` + ordered teardown

Enumeration: registered children = entries of `git -C <main> worktree list
--porcelain` whose **resolved** path sits strictly inside the parent's
resolved workdir. Stray repos = D1's walk minus registered children.

Per registered child, the ladder requires (any failure refuses the PARENT,
token naming the child):

- clean tree, stderr-empty status read (same two-guard shape as the parent's)
- not mid-operation: rebase / merge / conflicted squash / cherry-pick /
  revert, detected via `git rev-parse --git-path` plumbing checks —
  refusal `child-busy:<op>`. (Reimplemented from plumbing facts; do not copy
  Conductor's GPL-derived script.)
- no commits unreachable from the parent project's `origin/HEAD`
  (`rev-list --count base..childtip` = 0, unprovable → refuse)
- branch not checked out anywhere else

Stray repos always refuse (`nested-checkouts-present`); ccd never deletes a
repository it cannot enumerate the state of.

Teardown, only after every child passes, innermost-first (sort resolved paths
longest-first): per child `git worktree remove <child>` then
`git branch -d <childbranch>` — **plain `-d`, never `-D`, never
`update-ref -d`** (MEASURED: `update-ref -d` deletes a branch even while a
LIVE worktree elsewhere holds it; `branch -d` refuses — that refusal is
wanted). Then the parent's existing CAS delete, unchanged. After any child
removal fails midway: stop, leave the rest standing; the breadcrumb makes the
resume path finish or refuse coherently (D3).

The breadcrumb phase vocabulary is a CLOSED set enforced in three places
(the case statement, the resume fork, gc's reaping row) — the new child
teardown phase word must land in all three in the same commit or the resume
path wedges. This is pinned by an existing test.

### D3 — Consent covers children

- `_ws_fingerprint` gains a 14th input: `childrenDigest` — sorted
  `resolvedpath \t branch \t headOid \t dirtyCount` per registered child plus
  a `stray:<resolvedpath>` line per stray repo, sha256'd. Child SET and
  state, not child bytes (bytes churn on every agent write and would refuse
  `state-changed` perpetually).
- The reap tombstone and the `reaping` breadcrumb record the consented child
  set. The resume fork — which does not re-check `--expect` — re-derives the
  live child set and refuses to terminal (`state-changed`) if it differs from
  the recorded one. This closes the consent-then-spawn TOCTOU.
- Every hardcoded-token fixture in the reap/audit test files is invalidated
  by the 14th input. Plan-time task: count them first (`grep -c` the token
  literals), regenerate deliberately, and treat an unexpectedly small count
  as a wrong-tree signal.

### D4 — The UI stops lying about children

- `ws-audit` output gains `children[]`: per child `{path, branch, headOid,
  dirty, busy, stray}` — the same facts the fingerprint hashes.
- Server: audit route passes it through (parseAudit + shared type + 
  `reviveFleetSession`-equivalent for the audit shape). Adding any field to a
  shared type MUST update its revive function — the literal-return pattern
  makes omission a compile error; keep it that way.
- ReapSheet: children render as their own section — named checkouts with
  branch and state — never inside the ignored-bytes total, and the
  "none of it is in git, and all of it goes" sentence is scoped to what it is
  actually true of. A parent with children shows why it will refuse BEFORE
  the user taps.
- No new `FleetSession` wire field in v1 (the fleet line does not show child
  counts); the audit payload is the single surface. Revisit only if the
  sheet proves insufficient.

### D5 — Riders (independent, small, same branch)

1. **Archive/Restore in the `...` menu** (`SessionActionsSheet`): Archive
   gated `workspace !== null && archivedAt === null`, Restore on the
   complement; both call the existing `api.archive`/`api.restore`; toast
   errors via `apiErrorText` (the sheet's own convention: "Couldn't <verb> —
   …"). No server, whitelist, CCD_ARGV, or store changes — MEASURED
   all present; state refreshes via the existing 2s FleetWatcher tick.
2. **`archivedreason` tells the truth**: `empty` (branch carries no commits
   beyond base), `manual`, or `merged:#N` — decided by the three-state
   `_ws_gc_merged` primitive at archive time. Zero non-test consumers
   measured, so the value change is nearly free; the three tests that read
   it update in the same commit.
3. **`listProjects` skips linked worktrees**: skip iff readdir(workdir)
   includes `.git` AND readdir(workdir/'.git') === null (readdir-null is the
   file-vs-dir probe FleetIO affords). MEASURED constraint: four legitimate
   non-git project dirs exist (cctest, cab-batch, cab-archive, bt-rules) —
   "has no .git" must NOT be skipped. Apply the same probe to the
   registry-union loop (the second door for the masquerade). The pinned
   lifecycle test's expected array updates accordingly.

## Global constraints (bind every task)

- **No `--force`, no `-D`, no `update-ref -d` anywhere in child handling.**
  MEASURED: `worktree remove --force` cascade-deletes even un-ignored
  children; the no-force rule is already pinned by test.
- **All path containment on `pwd -P` resolved paths, both sides.**
- **No new info/exclude patterns.** The projects that need `.claude/worktrees/`
  ignored already ignore it; where it is NOT ignored, the dirty-tree refusal
  is the safe state. Writing it would be ccd editing git metadata of repos it
  never initialised, and would hide the only status-level signal that
  children exist.
- **No new agent-whitelist grant, no new user-controlled argv.** Child paths
  come from git and the filesystem, never from argv. `ws-gc` stays
  UNGRANTABLE. `gh` stays structurally impossible. Any new refusal token
  lands in the audit-sentence map (`wsaudit.ts` SENTENCES) in the same
  commit — an unmapped token renders as raw slug in the sheet.
- **verb-gate rules**: any new `CCD_ARGV` call site sits in a recognisable
  handler containing literal `verbSupported(`; destructive verbs join the
  NEW_GENERATION list; whitelist-subset SAMPLES/EXPECTED updated together.
- **Tests under fixture `$HOME` only** — never against the live fleet; the
  full nested-child reap runs end-to-end inside the existing
  `ccdWsHelpers.ts` harness.
- **`HOME` is the only isolation boundary; `PROJECTS_ROOT`/`WORKTREES_ROOT`
  take no env override.**

## Cut from v1 (deliberate, with reasons)

- **Adoption of foreign worktrees as sessions.** MEASURED to make sessions
  strictly worse naively (incomplete registry → every verb refuses; arms the
  120s auto-archive pane-kill). Legacy mislabeled sessions retire by
  attrition. If revisited: needs a distinct registry field (not `workspace`),
  a drift policy, and an auto-archive gate — a spec of its own.
- **The existing 26 GB of foreign trees** (37 under `.claude/worktrees/` of
  main checkouts, 34 under `ccrc-wt/`): one-time operator-reviewed triage
  (ws-gc already enumerates the first set as `foreign`, report-only), not ccd
  machinery. Out-of-tree SDD worktrees must never be auto-reaped.
- **Empty-branch reap rung**: clears one 19 MB workspace on today's fleet.
- **info/exclude write** (see constraints).

## Future work (recorded, not scoped)

- **`ws-checkpoint`**: Conductor's checkpointer primitive — full workspace
  snapshot incl. untracked as a synthetic commit on a private ref
  (`refs/ccrc/checkpoints/<id>`), no HEAD move. Would make dirty workspaces
  safely reapable ("checkpoint, then clean up") and turn several permanent
  refusals into staged paths. The research file has the exact plumbing.
- **`.env` seeding at ws-add** (Conductor's `.worktreeinclude`), with
  seeded-file hashes recorded so an unchanged seeded secret does not trip
  `sensitive-ignored` at reap while a modified one still does.
- **Per-project setup scripts** at ws-add + an env contract
  (name/path/root/base vars) — first colleague ask once ccrc-pwa ships.
- **Branch-rename remedy** for `registry-branch-drift` — arrives with the
  smart-branch-naming spec (ported by the canonicalisation runbook).
- **`_ws_sensitive_inside` 30s budget vs. large child sets** — probe at plan
  time with a `find`/`du` timing over a multi-GB fixture; if the budget
  blows, the walk needs early-exit-per-child before D2 lands.
- **Leaf-basename collision**: two children named `agent-foo` under different
  parents collide in `.git/worktrees/` namespace — git's suffixing behavior
  unprobed; probe at plan time.

## Testing strategy

TDD throughout, in the existing suites' idiom. The load-bearing new fixtures:

1. parent + ignored registered child (clean / dirty / busy / unpushed) —
   refusal tokens and the pass path
2. parent + stray `git init` under the ignored path — `nested-checkouts-present`
3. consent TOCTOU: audit → spawn child → reap `--expect` → `state-changed`;
   and the resume-fork variant (breadcrumb present, child set changed)
4. teardown order: two nested levels, innermost removed first, `branch -d`
   refusal (child branch checked out elsewhere) stops the parent CAS
5. symlinked `PROJECTS_ROOT` fixture proving resolved-path containment
6. every D5 rider pins its behavior in the suite that owns the surface

Suites stay green at their current counts plus the new tests; the tokens
regenerated for the 14th fingerprint input are counted before and after.
