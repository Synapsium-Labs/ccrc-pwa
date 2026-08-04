# Conductor prior art — operator-measured on-Mac snapshot, 2026-08-04

Source: the operator's own inspection of `~/conductor/` + `~/projects/custom-tools`
on their Mac (git plumbing, settings files, `du`). Not docs. Facts below are
design inputs for the ccd worktree-ownership spec; each carries the design
consequence it forces.

## Layout — convergent with ccd

- Workspaces live OUTSIDE the repo: `~/conductor/workspaces/<repo>/<name>` —
  the same shape as ccd's `~/worktrees/<project>/<slug>`. One shared object
  store (77 MB `.git`), working-tree-only cost per workspace (17 MB).
- Directory name is the ORIGINAL workspace name, forever. Branch renames don't
  touch it; a symlink at the new name bridges (`explain-conductor-worktrees ->
  buffalo-v2`). Symlinks go DANGLING when targets die (`fix-slides-download-email
  -> iqaluit`, target gone since May).

## Branch renaming is a NORMAL lifecycle event

- Branch born `<gh-username>/<workspace-name>` (`you/buffalo-v2`), then the
  AGENT is instructed to rename it to match the work
  (`you/explain-conductor-worktrees`). Reflog records it.
- Consequence for ccd: warm-meadow's "drift" is not an anomaly — it is how
  agent-driven work behaves. Adoption must RECONCILE renames (registry follows
  git's worktree record, updated at scan time), not refuse forever. Reap-time
  registry==git equality stays as the final gate; the registry just has to be
  KEPT true between reaps, not written once at ws-add. This converges with the
  in-flight `ws/soft-prairie` "smart branch naming" spec (branch takes the name
  the model wrote) — Conductor independently ships the same idea.

## Archive semantics — ccd's are STRONGER; keep ccd's

- Conductor archive = move `.context/` (transcripts, attachments) to
  `~/conductor/archived-contexts/<repo>/<name>/`; worktree deleted;
  `git.delete_branch_on_archive` optional. 71 archived contexts exist.
- No audit, no manifest, no staged confirm. And it LEAKS: 9 orphan workspace
  dirs (4.0 GB) whose admin dirs were pruned but whose files were never
  deleted, plus dangling rename symlinks. No gc exists to find them.
- Consequence: do NOT copy Conductor here. ccd's archive→audit→confirmed-reap
  with manifest is the differentiator; Conductor's measured leak is the
  failure mode it prevents.

## Worth stealing

1. **`.env` seeding**: new workspaces get `.env*` copied from the root
   (default pattern; `.worktreeinclude` / `file_include_globs` configurable).
   ccd has nothing — a fresh `ws-add` workspace lacks every gitignored env
   file, guaranteed colleague friction. TENSION to resolve if adopted: ccd's
   reap refuses `sensitive-ignored` on exactly these files, so seeding must
   record seeded-file hashes so an UNCHANGED seeded `.env` doesn't block
   deletion while a MODIFIED one still does. Future-work in the spec, not
   in-scope.
2. **Per-worktree `push.autoSetupRemote=true`** (written to `config.worktree`
   at creation): first push creates the upstream. Makes ccd's `no-upstream`
   reap refusal self-healing for pushed work. One line in `cmd_ws_add`;
   in-scope candidate.
3. **Layered TOML settings** (managed > repo local > repo shared > user >
   defaults, with a JSON schema URL). Prior art for ccrc-pwa spec 1's
   config/de-personalisation shape.
4. **Per-repo setup scripts** (`scripts.setup`, `run_mode`): run in each new
   workspace. Future-work note for ccrc-pwa (colleagues will ask on day one).
   Their measured cost: ~1.0 GB/workspace with node_modules installed — the
   spec should mention on-demand vs at-create tradeoff.

## From the app bundle itself (conductor-0.77.5, inspected 2026-08-04)

Rust binary + SQLite; embedded migrations expose the data model. Bundled
helpers: `git-busy-check.sh`, `checkpointer.sh`, `spotlighter.sh`, own `gh`,
`watchexec`, and a `conductor-skill` Claude Code skill (their agent-facing
docs, incl. settings schemas and env contract).

- **5-state workspace lifecycle**: `initializing → setting_up → ready →
  archiving → archived` (migrated from a 3-state system; states are explicit
  DB rows, transitions owned by the app). ccd's equivalent is implicit
  (registry files + archived marker); the explicit in-flight states
  (`setting_up`, `archiving`) exist to survive crashes mid-transition —
  worth noting for ccd's spawn window (ProjectCard already models "ws-add in
  flight" client-side only).
- **Naming**: `city_name` + `directory_name` columns — a city-name generator
  (buffalo-v2, warsaw-v2) plays ccd's slug role; directory name immutable,
  `branch` mutable, `initialization_parent_branch` + `intended_target_branch`
  tracked separately. Rename is first-class (`custom_prompt_rename_branch`
  per repo).
- **`git-busy-check.sh`** (52 lines): refuses when a rebase / merge /
  conflicted squash / cherry-pick / revert is IN PROGRESS — plumbing checks
  via `git rev-parse --git-path`. ccd's ladder has no in-progress-operation
  rung (dirty-tree and detached-HEAD catch most shapes, but a paused rebase
  or clean conflicted state has cleaner refusal semantics as `busy:<op>`).
  STEAL for the descent design: cheap, local, precise tokens. Reimplement
  from the plumbing facts, not by copying (their script derives from git's
  GPL contrib/git-prompt.sh).
- **`checkpointer.sh`** (273 lines): full-workspace snapshots as synthetic
  commits on private refs `refs/conductor-checkpoints/<id>` — captures HEAD
  oid + index tree + worktree tree INCLUDING untracked files (temp-index
  trick), no HEAD move, neutral committer; restore = reset --hard +
  read-tree + clean -fd. Direct kin of ccd's `refs/ccrc/attic/<id>/` but
  strictly stronger: attic pins existing commits; this snapshots
  uncommitted state. FUTURE-WORK gem: a `ws-checkpoint` verb of this shape
  would make a DIRTY workspace safely reapable (work provably in the object
  store before deletion) — turning `dirty-tree` from a permanent refusal
  into "checkpoint, then clean up". Out of scope now; record in the spec.
- **Defensive convergence**: checkpointer's exit-103 guard (refuse when repo
  root resolves to an ANCESTOR of cwd — a workspace that lost its checkout
  inside a git-controlled $HOME) is the same defect class as ccd's
  foreign-worktree rung. Independent teams converged on the same guards.
- **Per-repo hooks**: `scripts.setup` / `scripts.archive` / named
  `scripts.run.<id>` with `run_mode = concurrent|nonconcurrent`; 10 ports
  allocated per workspace (`CONDUCTOR_PORT..+9`); env contract
  (`CONDUCTOR_WORKSPACE_NAME/PATH/ROOT_PATH/DEFAULT_BRANCH/IS_LOCAL`).
  The ccd analogue would be a per-project setup hook at ws-add — future
  work, but the ENV CONTRACT is worth copying when it lands.

## What Conductor does NOT solve (we are not reinventing)

- **Children**: Claude Code running inside a Conductor workspace can still
  create `.claude/worktrees/` under it — nothing in Conductor's model handles
  nested/child worktrees, ordered teardown, or child-aware safety. Our descent
  design has no wheel to reuse.
- **Foreign-worktree adoption**: the Mac shows the same two-family split as
  the Linux box (25 superpowers `.worktrees/` = 21 GB beside Conductor's own).
  Conductor ignores the other family entirely.
- **gc/audit**: absent, and the 4 GB of orphans is the result.
