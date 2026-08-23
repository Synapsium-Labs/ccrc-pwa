# Workspace Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make a workspace's branch correct from the moment it exists, and give the fleet a command that says what worktrees are costing and reclaims the ones that are provably finished.

**Architecture:** all of the behaviour lands in `ccd`, the bash session manager that already owns worktree, tmux and systemd lifecycle. Three additions to `cmd_ws_add` (`--no-track`, a `ws/` branch prefix, a disk floor), one new command that renames a branch before it is pushed (`ws-rename`), and one that enumerates every worktree on the box and reclaims only what ccd created and can prove is finished (`ws-gc`). One small server change lets the fleet read a workspace's branch from the registry instead of waiting for a pane capture.

**Tech Stack:** bash, git 2.43, GNU coreutils, TypeScript, Fastify, vitest.

**Spec:** [`docs/superpowers/specs/2026-07-28-ccrc-workspace-lifecycle-design.md`](../specs/2026-07-28-ccrc-workspace-lifecycle-design.md)

## Global Constraints

- Repo `/srv/projects/OpenClawHetzner`, branch `ccrc/workspace-lifecycle`.
- Suites run from the package dir: `cd infra/ccrc/{server,agent,pwa} && npx vitest run`. Single file: `npx vitest run test/x.test.ts`.
- **Baseline to preserve: server 335, agent 86, pwa 313.** Typecheck (`npx tsc --noEmit`) clean in all three.
- `bash -n infra/<server-host>-portability/ccd` must pass after every ccd change.
- No new runtime dependencies. `git`, `du`, `df`, `stat`, `numfmt` and `awk` are the only external binaries; all are already present on the host.
- **`HOME` is the only isolation boundary.** `PROJECTS_ROOT` and `WORKTREES_ROOT` derive from `$HOME` and take no environment override — do not add one. A test that could point `git worktree remove` at a real repository is a failed test. `CCD_DISK_FLOOR_GB` is the single permitted override in this plan, because it can only make ccd refuse to act.
- **The nine live sessions, `~/worktrees` and `/data/projects` must be untouched by any test run.** Verify after the suite, not just before.
- `ws-gc` reports by default and acts only under `--prune`. Never the reverse.
- A dirty worktree is never removed, at any flag, by any command in this plan.
- ccd is `set -uo pipefail` and has **no `set -e`** — a failing `&&` chain does not exit the function. Write refusals as explicit `die` calls, never as a bare `cmd || die` at the end of a function where the next statement matters.
- Every new ccd command must be added to **both** the `case` dispatch and the `usage:` line at `infra/<server-host>-portability/ccd:849`.
- Do not add anything to `infra/ccrc/agent/src/whitelist.ts`. `ws-rename` and `ws-gc` are not reachable from the server in this phase; widening the exec whitelist for an unused command widens the security boundary for no user.

## Measured facts this plan depends on

These were checked on the host on 2026-07-28. Do not re-derive them; do not assume the opposite.

| fact | evidence |
|---|---|
| `df -P --output=avail` is **rejected** | `df: options -P and --output are mutually exclusive` |
| `df -Pk <dir>` field 4 is available 1K blocks | `df -Pk /home` → `80647112` |
| `git worktree list --porcelain` emits a `prunable <reason>` line for a worktree whose directory is gone | git 2.43.0, verified on a fixture |
| `git worktree add -b ws/x --no-track <path> origin/main` leaves **no** upstream | `rev-parse --abbrev-ref '@{u}'` → `fatal: no upstream configured` |
| a slashed branch name does not change the `.git/worktrees/<name>` directory — that is the **path basename** | fixture: branch `ws/quiet-mesa`, path `…/wt`, dir `wt` |
| `git branch -d ws/quiet-mesa` works normally | fixture |
| `du -scb a b` de-dupes hardlinks across all arguments in one invocation and prints a `total` row | verified |
| `numfmt --to=iec` is present | `numfmt --to=iec 5033164800` → `4.7G` |
| `$HOME/projects` → `/data/projects` → `/srv/projects`; git records the **fully resolved** path in `worktree list` | `git -C ~/projects/custom-tools worktree list --porcelain` |
| a live **foreign** worktree exists right now | `/home/you/.handoff/wt/custom-tools-receiver-heartbeat--20260728-221900-3091316` |

**The `ws-gc` code in Tasks 6 and 7 was executed verbatim against a six-state fixture before this plan was written** — one tracked workspace, one orphan, one foreign worktree, one hand-deleted directory and one dead registry entry. It classified all six correctly, skipped the main checkout despite its triple-symlinked path, printed the table and total, and on `--prune` reclaimed the stale metadata and dead entry while declining the foreign and unmerged ones. If it does not behave that way for you, suspect the transcription before suspecting the logic.

Two behaviours that surfaced in that run and are deliberate, not bugs:

- Hand-deleting a worktree directory produces **two** findings, `stale-meta` *and* `dead-reg`. Both are true and both need acting on.
- A repo with no `origin/HEAD` declines every orphan as unmerged, because "merged" is unprovable without a base. Unprovable resolves to declining.

---

## File Structure

| file | responsibility | tasks |
|---|---|---|
| `infra/<server-host>-portability/ccd` | all workspace lifecycle: branch creation, rename, disk floor, gc | 1, 3, 5, 6, 7 |
| `infra/ccrc/server/src/registry.ts` | read the new `branch` registry field | 2 |
| `infra/ccrc/server/src/fleet.ts` | fall back to the registry branch when no pane capture has landed | 2 |
| `infra/ccrc/server/test/ccdWsHelpers.ts` | **new** — the isolated-`HOME` ccd harness, shared by every ccd test file | 4 |
| `infra/ccrc/server/test/ccd-workspaces.test.ts` | existing ccd workspace tests (26) — rewired onto the shared harness | 1, 3, 4 |
| `infra/ccrc/server/test/ccd-ws-rename.test.ts` | **new** — `ws-rename` | 5 |
| `infra/ccrc/server/test/ccd-ws-gc.test.ts` | **new** — `ws-gc` report and `--prune` | 6, 7 |
| `infra/ccrc/server/test/registry.test.ts` | registry field coverage | 2 |

---

### Task 1: The workspace branch is `ws/<slug>`, untracked, and recorded

**Files:**
- Modify: `infra/<server-host>-portability/ccd:145-196` (`cmd_ws_add`)
- Test: `infra/ccrc/server/test/ccd-workspaces.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: registry field `branch` holding the full branch name (e.g. `ws/quiet-mesa`), written by `cmd_ws_add`. Task 2 reads it; Task 5 (`ws-rename`) overwrites it.

**Context:** `cmd_ws_add` today runs `git worktree add -b "$slug" "$wt" "$base"`. Because `$base` is a remote-tracking ref (`origin/main`) and git's `branch.autoSetupMerge` defaults to `true`, every workspace branch created so far has `origin/main` as its upstream. `git pull` in such a workspace merges `main` into the branch. This is live on `custom-tools-quiet-basin` right now.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `infra/ccrc/server/test/ccd-workspaces.test.ts`, immediately after the existing `describe('ws-add', ...)` block:

```ts
describe('ws-add branch naming', () => {
  // The branch is namespaced; the directory and the session id are NOT. A change
  // that unified them would break the id -> registry lookup, so assert all three.
  it('creates the branch as ws/<slug> while the directory and id keep the bare slug', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-mesa');
    expect(fs.existsSync(wt)).toBe(true);                       // directory: bare slug
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();      // id: <project>-<slug>
    const branch = execFileSync('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8' }).trim();
    expect(branch).toBe('ws/quiet-mesa');                       // branch: namespaced
  });

  it('records the branch in the registry so the fleet need not wait for a pane capture', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // THE live defect. Without --no-track, autoSetupMerge sets origin/main as the
  // upstream because the start point is a remote-tracking ref, and `git pull` in
  // the workspace then merges main into the workspace branch.
  it('leaves the branch with no upstream', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-mesa');
    const upstream = sh(`git -C '${wt}' rev-parse --abbrev-ref '@{u}' 2>/dev/null || echo NONE`);
    expect(upstream).toBe('NONE');
    expect(sh(`git -C '${wt}' config --get branch.ws/quiet-mesa.merge || echo EMPTY`)).toBe('EMPTY');
  });

  it('still reports the branch it created in the success line', () => {
    makeRepo('demo');
    const out = sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(out).toContain('branch ws/quiet-mesa');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`

Expected: 4 failures. The branch assertions get `quiet-mesa` instead of `ws/quiet-mesa`; `reg(...,'branch')` is `null`; the upstream is `origin/main` instead of `NONE`.

- [ ] **Step 3: Change the branch creation**

In `cmd_ws_add`, replace:

```bash
  git -C "$main" worktree add -b "$slug" "$wt" "$base" --quiet \
    || die "git worktree add failed for $wt"
```

with:

```bash
  # ws/ namespaces the branch: it sorts with its siblings, matches the type/slug
  # shape every repo here already uses, and says at a glance that the branch is
  # machine-created. The directory and the session id keep the BARE slug — a
  # slash in either would break tmux -t (session:window.pane) and systemd
  # instance names. --no-track is load-bearing: $base is a remote-tracking ref,
  # so git's branch.autoSetupMerge default would otherwise make origin/main this
  # branch's upstream, and `git pull` in the workspace would merge main into it.
  local branch="ws/$slug"
  git -C "$main" worktree add -b "$branch" --no-track "$wt" "$base" --quiet \
    || die "git worktree add failed for $wt"
```

- [ ] **Step 4: Record the branch and report it**

Still in `cmd_ws_add`, in the `_reg_set` block, change:

```bash
  _reg_set "$id" workspace "$slug"; _reg_set "$id" base "$base"
```

to:

```bash
  _reg_set "$id" workspace "$slug"; _reg_set "$id" base "$base"
  _reg_set "$id" branch "$branch"
```

and change the final line of `cmd_ws_add` from:

```bash
  echo "workspace $id on $hw — $wt (branch $slug, from $base)"
```

to:

```bash
  echo "workspace $id on $hw — $wt (branch $branch, from $base)"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: 30 passed (26 existing + 4 new).

- [ ] **Step 6: Verify the existing ws-rm tests still pass and syntax is clean**

Run: `bash -n infra/<server-host>-portability/ccd && cd infra/ccrc/server && npx vitest run`

Expected: `bash -n` silent; 339 passed.

`cmd_ws_rm` reads the branch from the worktree with `rev-parse --abbrev-ref HEAD` rather than assuming the slug, so it already deletes `ws/quiet-mesa` correctly. The existing test `'removes the worktree, the branch and the registry entry'` asserts `git branch --list quiet-mesa` is empty — which it now is for the trivial reason that no such branch was ever created. Fix that assertion so it proves the real branch is gone:

```ts
    const branches = execFileSync('git',
      ['-C', path.join(home, 'projects', 'demo'), 'branch', '--list', 'ws/quiet-mesa'],
      { encoding: 'utf8' });
    expect(branches.trim()).toBe('');
```

Make the same `quiet-mesa` → `ws/quiet-mesa` correction in the two other `ws-rm` tests that assert on `branch --list` (`'refuses a dirty worktree BEFORE it tears anything down'` and `'keeps an unmerged branch and its commit after removing a clean, ahead-of-base workspace'`). In both, the assertion is `not.toBe('')` — a test that would pass vacuously against the wrong name is worse than no test.

- [ ] **Step 7: Prove the `--no-track` test is load-bearing by mutation**

`--no-track` is the whole point of this task and it is one word in one line. Verify a test actually holds it in place: temporarily remove `--no-track` from the `git worktree add` line and re-run.

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`

Expected: **RED** — `'leaves the branch with no upstream'` must fail, with the upstream reported as `origin/main`. If the suite stays green, the regression test is not testing anything; fix it before restoring the flag.

Restore `--no-track` and re-run. Expected: 30 passed.

- [ ] **Step 8: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-workspaces.test.ts
git commit -m "fix(ccd): workspace branches are ws/<slug> with no upstream

git's branch.autoSetupMerge made origin/main the upstream of every workspace
branch, because the start point is a remote-tracking ref. git pull in a
workspace therefore merged main into the workspace branch."
```

---

### Task 2: The fleet reads a workspace's branch from the registry

**Files:**
- Modify: `infra/ccrc/server/src/registry.ts:5-9,22-36`
- Modify: `infra/ccrc/server/src/fleet.ts:67`
- Test: `infra/ccrc/server/test/registry.test.ts`, `infra/ccrc/server/test/fleet.test.ts`

**Interfaces:**
- Consumes: the `branch` registry field written by `cmd_ws_add` (Task 1) and `cmd_ws_rename` (Task 5).
- Produces: `SessionRecord.branch: string | null`. The wire type `FleetSession.branch` already exists in `infra/ccrc/shared/api.ts` and does not change.

**Context:** `FleetSession.branch` is populated only from the statusline (`sl?.branch`), which comes from a pane capture. A workspace created seconds ago has no capture yet, so its branch reads `null` and the PWA falls back to showing the slug. The registry knows the branch at creation time. The statusline stays authoritative when present — it reflects a manual `git checkout` that the registry cannot know about.

- [ ] **Step 1: Write the failing tests**

Append to `infra/ccrc/server/test/registry.test.ts`, inside the existing `describe('readRegistry', …)` block so it inherits that block's `home` / `beforeEach` (it uses the file's existing `seed` helper, `localIO` and `loadConfig`):

```ts
  it('reads the branch a workspace was created on', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-mesa', {
      wrapper: 'claude', project: 'demo',
      workdir: '/home/x/worktrees/demo/quiet-mesa', uuid: 'c'.repeat(36), started: '1',
      workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    });
    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(out[0].branch).toBe('ws/quiet-mesa');
  });

  it('leaves branch null for a main checkout that never had one written', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-demo', {
      wrapper: 'claude', project: 'demo',
      workdir: '/data/projects/demo', uuid: 'd'.repeat(36), started: '1',
    });
    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(out[0].branch).toBeNull();
  });
```

Append to `infra/ccrc/server/test/fleet.test.ts` as a new top-level `describe`, using that file's existing `seedSession` helper. Add `import type { Statusline } from '../src/pane/statusline.js';` to its imports:

```ts
describe('branch precedence', () => {
  const setup = (): { home: string; run: Runner } => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'demo-quiet-mesa', 'claude', {
      project: 'demo', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    });
    // Alive, but with no live-state file — so no statusline can have been
    // derived yet. This is a workspace in the seconds after ws-add.
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    return { home, run };
  };

  it('falls back to the registry branch before any pane capture has landed', async () => {
    const { home, run } = setup();
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('ws/quiet-mesa');
  });

  it('prefers the statusline branch — it reflects a manual checkout the registry cannot know about', async () => {
    const { home, run } = setup();
    const sl = new Map<string, Statusline>([
      ['demo-quiet-mesa', { branch: 'feat/actually-here', ultracode: false, workflowActive: false }],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000, undefined, sl);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('feat/actually-here');
  });

  it('is null when neither source has one', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'claude-demo', 'claude');
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'claude-demo')!.branch).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/server && npx vitest run test/registry.test.ts test/fleet.test.ts`
Expected: FAIL — `branch` is not a property of `SessionRecord` (typecheck error), and the fallback assertion gets `null`.

- [ ] **Step 3: Add the field to the record**

In `infra/ccrc/server/src/registry.ts`, change the interface:

```ts
export interface SessionRecord {
  id: string; wrapper: string; project: string; workdir: string; uuid: string;
  started: boolean; home: string | null; pool: string[] | null; lastswap: number | null;
  workspace: string | null; branch: string | null;
}
```

change the destructured read:

```ts
    const [wrapper, project, workdir, uuid, started, home, pool, lastswap, workspace, branch] = await Promise.all([
      field(io, cfg.registryDir, id, 'wrapper'), field(io, cfg.registryDir, id, 'project'),
      field(io, cfg.registryDir, id, 'workdir'), field(io, cfg.registryDir, id, 'uuid'),
      field(io, cfg.registryDir, id, 'started'), field(io, cfg.registryDir, id, 'home'),
      field(io, cfg.registryDir, id, 'pool'), field(io, cfg.registryDir, id, 'lastswap'),
      field(io, cfg.registryDir, id, 'workspace'), field(io, cfg.registryDir, id, 'branch'),
    ]);
```

and the object built from it:

```ts
      workspace, branch,
```

- [ ] **Step 4: Use it as the fallback**

In `infra/ccrc/server/src/fleet.ts`, change line 67 from:

```ts
      ultracode: sl?.ultracode ?? false, branch: sl?.branch ?? null,
```

to:

```ts
      // The statusline wins: it is a live pane capture and knows about a manual
      // checkout. The registry fills the gap before the first capture lands.
      ultracode: sl?.ultracode ?? false, branch: sl?.branch ?? r.branch ?? null,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run && npx tsc --noEmit`
Expected: 344 passed (335 baseline + 4 from Task 1 + 5 here), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/server/src/registry.ts infra/ccrc/server/src/fleet.ts \
        infra/ccrc/server/test/registry.test.ts infra/ccrc/server/test/fleet.test.ts
git commit -m "feat(ccrc): fleet falls back to the registry branch before a pane capture"
```

---

### Task 3: A disk floor on `ws-add`

**Files:**
- Modify: `infra/<server-host>-portability/ccd` — add `_ws_disk_free_gb` beside the other `_ws_*` helpers (after `_ws_least_loaded`, ccd:136-143), and a check in `cmd_ws_add`
- Test: `infra/ccrc/server/test/ccd-workspaces.test.ts`

**Interfaces:**
- Consumes: `WORKTREES_ROOT`, `die` (both already in ccd).
- Produces: `_ws_disk_free_gb <dir>` → echoes whole GiB available on the filesystem holding `<dir>`, exit 1 if it cannot be determined. `CCD_DISK_FLOOR_GB` (default `10`).

**Context:** the box hit 87% full during a single working session. This check turns "the disk filled up and everything broke" into "this one command declined". It must run **before** anything is created — no worktree, no registry entry, no session.

- [ ] **Step 1: Write the failing tests**

Add to `infra/ccrc/server/test/ccd-workspaces.test.ts`:

```ts
describe('disk floor', () => {
  it('reports whole GiB free for a directory that exists', () => {
    const gb = sh(`_ws_disk_free_gb "$HOME"`);
    expect(gb).toMatch(/^\d+$/);
    expect(Number(gb)).toBeGreaterThan(0);
  });

  it('walks up to the nearest existing parent — WORKTREES_ROOT may not exist yet', () => {
    // ~/worktrees is created lazily by ws-add, so the floor check runs before it
    // exists on a fresh box. df on a missing path fails; the helper must not.
    const gb = sh(`_ws_disk_free_gb "$HOME/worktrees/never/made"`);
    expect(gb).toMatch(/^\d+$/);
  });

  it('refuses ws-add below the floor and creates nothing at all', () => {
    makeRepo('demo');
    expect(() =>
      sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`, { CCD_DISK_FLOOR_GB: '999999' })
    ).toThrow();
    expect(fs.existsSync(path.join(home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    // The branch must not exist either: a floor check that ran after
    // `worktree add` would leave a branch behind on every refusal.
    const branches = execFileSync('git',
      ['-C', path.join(home, 'projects', 'demo'), 'branch', '--list', 'ws/quiet-mesa'],
      { encoding: 'utf8' });
    expect(branches.trim()).toBe('');
  });

  it('names the free space and the floor so the refusal is actionable', () => {
    makeRepo('demo');
    let stderr = '';
    try {
      execFileSync('bash', ['-c', `source "${CCD}"; ${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`],
        { encoding: 'utf8', env: { ...process.env, HOME: home, CCD_DISK_FLOOR_GB: '999999' } });
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? '');
    }
    expect(stderr).toContain('999999');
    expect(stderr).toMatch(/\d+G free/);
    expect(stderr).toContain('ccd ws-gc');
  });

  it('proceeds normally at the default floor', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: FAIL — `_ws_disk_free_gb: command not found`, and `ws-add` happily creates the workspace under a 999999G floor.

- [ ] **Step 3: Write the helper**

Insert into `infra/<server-host>-portability/ccd` immediately after `_ws_least_loaded` (which ends at ccd:143):

```bash
# CCD_DISK_FLOOR_GB is the one environment override ccd honours, because unlike
# PROJECTS_ROOT/WORKTREES_ROOT it can only make ccd REFUSE to act — it can never
# aim a destructive command at a different tree.
CCD_DISK_FLOOR_GB="${CCD_DISK_FLOOR_GB:-10}"

_ws_disk_free_gb() {   # dir -> whole GiB available on the filesystem holding it
  local d="$1"
  # WORKTREES_ROOT is created lazily, so walk up to the nearest parent that
  # exists; df on a missing path just fails.
  while [[ ! -d "$d" && "$d" != / && -n "$d" ]]; do d=$(dirname "$d"); done
  # -P guarantees one filesystem per line, so a long device name cannot wrap the
  # row and shift field 4. -k pins the block size to 1K, which -P alone does not
  # (GNU df -P reports 512-byte blocks under POSIXLY_CORRECT).
  # NOT `df --output=avail`: GNU df rejects -P and --output together.
  local kb; kb=$(df -Pk "$d" 2>/dev/null | awk 'NR==2 {print $4}')
  [[ "$kb" =~ ^[0-9]+$ ]] || return 1
  echo $(( kb / 1024 / 1024 ))
}
```

- [ ] **Step 4: Check the floor before anything is created**

In `cmd_ws_add`, insert immediately after the `[[ -d "$main/.git" ]] || die` line (ccd:149) and **before** the slug resolution:

```bash
  # Before anything is created: no worktree, no branch, no registry entry, no
  # session. A refusal here must leave the box exactly as it found it.
  local free
  free=$(_ws_disk_free_gb "$WORKTREES_ROOT") \
    || die "could not read free space for $WORKTREES_ROOT"
  (( free >= CCD_DISK_FLOOR_GB )) \
    || die "only ${free}G free on $WORKTREES_ROOT, floor is ${CCD_DISK_FLOOR_GB}G — reclaim space first: ccd ws-gc"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bash -n infra/<server-host>-portability/ccd && cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: 35 passed.

- [ ] **Step 6: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-workspaces.test.ts
git commit -m "feat(ccd): ws-add refuses below a disk floor"
```

---

### Task 4: Extract the ccd test harness

**Files:**
- Create: `infra/ccrc/server/test/ccdWsHelpers.ts`
- Modify: `infra/ccrc/server/test/ccd-workspaces.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces — the module Tasks 5, 6 and 7 import:

```ts
export interface CcdHarness {
  home: string;
  sh(snippet: string, env?: NodeJS.ProcessEnv): string;
  reg(id: string, field: string): string | null;
  calls(): string[];
  makeRepo(name: string): string;
  git(cwd: string, ...args: string[]): string;
  cleanup(): void;
}
export function makeCcdHarness(prefix: string): CcdHarness;
export const CCD: string;
export const WS_ADD: string;
```

**Context:** the isolated-`HOME` harness (temp `HOME`, wrapper stubs, `sh`, `reg`, `calls`, `makeRepo`) lives inside `ccd-workspaces.test.ts` today. Three more test files need it. This task moves it and rewires the existing file — **no production code changes, and the test count must not move**.

**This task is pure refactor. If the ccd-workspaces test count changes, or `infra/<server-host>-portability/ccd` appears in the diff, the task is wrong.**

- [ ] **Step 1: Record the count to preserve**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Note the number (35 after Task 3). It must be identical at Step 5.

- [ ] **Step 2: Create the harness module**

Create `infra/ccrc/server/test/ccdWsHelpers.ts`:

```ts
// The isolated-HOME harness every ccd test file uses. HOME is the ONLY isolation
// boundary ccd has: PROJECTS_ROOT and WORKTREES_ROOT derive from it and take no
// environment override, which is what stops a unit test pointing
// `git worktree remove` or `git branch -d` at a real repository.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export const CCD = path.resolve(__dirname, '../../../<server-host>-portability/ccd');

/** ws-add spawns a session; tmux is not available under test, so stub _spawn and
 *  the systemd call. Everything else runs for real. `tmux` is shadowed too,
 *  unconditionally: nothing in ws-add reaches it today, and this is what keeps
 *  that true if something ever does. */
export const WS_ADD = `_spawn() { :; }; _ws_supervise() { :; }; tmux() { :; };`;

export interface CcdHarness {
  home: string;
  sh(snippet: string, env?: NodeJS.ProcessEnv): string;
  reg(id: string, field: string): string | null;
  calls(): string[];
  makeRepo(name: string): string;
  git(cwd: string, ...args: string[]): string;
  cleanup(): void;
}

export function makeCcdHarness(prefix: string): CcdHarness {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude2', 'claude-corp']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }

  const gitEnv = (): NodeJS.ProcessEnv => ({
    ...process.env, HOME: home,
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x',
    GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x',
  });

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv() }).trim();

  return {
    home,
    sh: (snippet, env = {}) =>
      execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
        { encoding: 'utf8', env: { ...process.env, HOME: home, ...env } }).trim(),
    reg: (id, field) => {
      const p = path.join(home, '.cc-sessions', `${id}.${field}`);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
    },
    calls: () => {
      const p = path.join(home, 'ccd-calls');
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
    },
    /** A real git repo with one commit and an origin, so worktree/base logic is
     *  exercised for real rather than mocked. */
    makeRepo: (name) => {
      const origin = path.join(home, 'origins', `${name}.git`);
      const main = path.join(home, 'projects', name);
      execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
      execFileSync('git', ['init', '-b', 'main', main]);
      fs.writeFileSync(path.join(main, 'README.md'), 'hi\n');
      git(main, 'add', 'README.md');
      git(main, 'commit', '-m', 'init');
      git(main, 'remote', 'add', 'origin', origin);
      git(main, 'push', '-u', 'origin', 'main');
      git(main, 'remote', 'set-head', 'origin', '-a');
      return main;
    },
    git,
    cleanup: () => { fs.rmSync(home, { recursive: true, force: true }); },
  };
}
```

- [ ] **Step 3: Rewire `ccd-workspaces.test.ts`**

Replace its header (the imports, the `CCD`/`home` declarations, `sh`, `calls`, `beforeEach`, `afterEach`, `reg`) with:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

// Thin aliases so the assertions below read as they always did.
const sh = (s: string, env: NodeJS.ProcessEnv = {}): string => h.sh(s, env);
const reg = (id: string, field: string): string | null => h.reg(id, field);
const calls = (): string[] => h.calls();
const makeRepo = (name: string): string => h.makeRepo(name);

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-ws-'); home = h.home; });
afterEach(() => { h.cleanup(); });
```

Delete the file's own `const WS_ADD = …` line and its local `makeRepo` definition — both now come from the import. Leave every `describe`/`it` body untouched.

- [ ] **Step 4: Check the import extension against the package's module resolution**

Run: `grep -n '"type"\|"module"' infra/ccrc/server/package.json && grep -rn "from './helpers" infra/ccrc/server/test/*.ts | head -3`

Match whatever the existing sibling-module imports in that directory do — `./ccdWsHelpers.js` if they use explicit `.js` extensions, `./ccdWsHelpers` if they do not. Getting this wrong fails at import time, not typecheck.

- [ ] **Step 5: Run and confirm the count is unchanged**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts && npx tsc --noEmit`
Expected: the exact count from Step 1 (35), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/server/test/ccdWsHelpers.ts infra/ccrc/server/test/ccd-workspaces.test.ts
git commit -m "test(ccrc): extract the isolated-HOME ccd harness for reuse"
```

---

### Task 5: `ccd ws-rename`

**Files:**
- Modify: `infra/<server-host>-portability/ccd` — add `_ws_branch_valid` and `cmd_ws_rename` after `cmd_ws_rm` (which ends at ccd:225), plus the dispatch and usage line at ccd:847-849
- Test: `infra/ccrc/server/test/ccd-ws-rename.test.ts` (new)

**Interfaces:**
- Consumes: `makeCcdHarness`, `CCD`, `WS_ADD` from `./ccdWsHelpers` (Task 4); the `branch` registry field (Task 1).
- Produces: `ccd ws-rename <id> <new-branch>`; `_ws_branch_valid <name>` → exit 0 when the name is acceptable.

**Context:** workspaces Phase 2 will have the agent propose a PR branch name. This builds the rename it will call, so Phase 2 adds only the policy. Renaming after a push would leave two branches on the remote, so an existing upstream is a hard refusal — this turns the freeze convention from the workspaces spec into an enforced precondition.

- [ ] **Step 1: Write the failing tests**

Create `infra/ccrc/server/test/ccd-ws-rename.test.ts`:

```ts
// ws-rename renames a workspace branch before it is pushed. Sourced under an
// isolated HOME, so nothing here can reach the real registry or a real repo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-rename-'); });
afterEach(() => { h.cleanup(); });

/** A workspace on ws/quiet-mesa. Returns its worktree path. */
const addOne = (): string => {
  h.makeRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
  return path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
};

describe('_ws_branch_valid', () => {
  const ok = (s: string): boolean =>
    h.sh(`_ws_branch_valid '${s}' && echo yes || echo no`) === 'yes';

  it('accepts the type/slug shape every repo here uses', () => {
    expect(ok('feat/int-7-mcp-image-attachments')).toBe(true);
    expect(ok('ccrc/attachment-tray')).toBe(true);
    expect(ok('fix/MEK-995.cleanup')).toBe(true);
  });

  it('rejects a leading dash — git would read it as an option', () => {
    expect(ok('--force')).toBe(false);
  });

  it('rejects the ref-format traps git itself rejects', () => {
    expect(ok('feat/../escape')).toBe(false);
    expect(ok('/leading')).toBe(false);
    expect(ok('trailing/')).toBe(false);
    expect(ok('feat/thing.lock')).toBe(false);
    expect(ok('feat/thing.lock/more')).toBe(false);   // any COMPONENT, not just the suffix
  });

  it('rejects spaces, colons and glob characters', () => {
    expect(ok('feat/two words')).toBe(false);
    expect(ok('feat:thing')).toBe(false);
    expect(ok('feat/*')).toBe(false);
  });

  it('rejects the empty name', () => {
    expect(ok('')).toBe(false);
  });
});

describe('ws-rename', () => {
  it('renames the branch and records it', () => {
    const wt = addOne();
    const out = h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`);
    expect(out).toContain('ws/quiet-mesa');
    expect(out).toContain('feat/real-name');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('feat/real-name');
  });

  it('leaves the workspace slug, directory and id alone', () => {
    const wt = addOne();
    h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`);
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('refuses once the branch has an upstream — the remote already has the old name', () => {
    const wt = addOne();
    h.git(wt, 'push', '-u', 'origin', 'HEAD:refs/heads/ws/quiet-mesa');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists locally', () => {
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'branch', 'feat/taken');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/taken`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists on the remote', () => {
    const wt = addOne();
    // On origin but not local: exactly the case a local-only check would miss.
    h.git(wt, 'push', 'origin', 'HEAD:refs/heads/feat/taken-upstream');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/taken-upstream`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('renames anyway when origin is unreachable, and says so', () => {
    // Unreachable is not the same as taken. Refusing here would make ws-rename
    // unusable offline for a branch that has never been pushed.
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'remote', 'set-url', 'origin',
      path.join(h.home, 'origins', 'gone.git'));
    const out = h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name 2>&1`);
    expect(out).toContain('could not reach origin');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
  });

  it('refuses an invalid name without touching the branch', () => {
    const wt = addOne();
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa 'feat/../escape'`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a session that is not a workspace', () => {
    h.sh(`_reg_set claude2-demo wrapper claude2
          _reg_set claude2-demo project demo
          _reg_set claude2-demo workdir ${path.join(h.home, 'projects', 'demo')}
          _reg_set claude2-demo uuid abc`);
    expect(() => h.sh(`cmd_ws_rename claude2-demo feat/real-name`)).toThrow();
  });

  it('refuses an unknown id', () => {
    expect(() => h.sh(`cmd_ws_rename nope-nothing feat/real-name`)).toThrow();
  });

  it('refuses when the name is unchanged', () => {
    addOne();
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa ws/quiet-mesa`)).toThrow();
  });

  it('is reachable as a subcommand', () => {
    addOne();
    expect(h.sh(`"${CCD}" ws-rename demo-quiet-mesa feat/real-name`)).toContain('feat/real-name');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-ws-rename.test.ts`
Expected: FAIL — `_ws_branch_valid: command not found`, `cmd_ws_rename: command not found`.

- [ ] **Step 3: Write the validator**

Insert into `infra/<server-host>-portability/ccd` after `cmd_ws_rm` (ccd:225):

```bash
# ── renaming a workspace branch ────────────────────────────────────
# The subset of `git check-ref-format` that matters, checked explicitly rather
# than trusted to git's exit code: an invalid name must be refused BEFORE any
# git command is run with it as an argument.
_ws_branch_valid() {
  local b="$1"
  [[ -n "$b" ]]                              || return 1
  [[ "$b" =~ ^[A-Za-z0-9._/-]+$ ]]           || return 1   # no space, colon, glob, ~, ^, @{
  [[ "$b" != -* ]]                           || return 1   # git would read it as an option
  [[ "$b" != /* && "$b" != */ ]]             || return 1
  [[ "$b" != *..* ]]                         || return 1
  [[ "$b" != *.lock && "$b" != *.lock/* ]]   || return 1   # any component, not just the last
  return 0
}

cmd_ws_rename() {   # id new-branch — rename a workspace branch before it is pushed
  local id="${1:?usage: ccd ws-rename <id> <new-branch>}"
  local new="${2:?usage: ccd ws-rename <id> <new-branch>}"
  [[ -f "$REG/$id.uuid" ]] || die "no such session: $id"

  local ws project workdir
  ws=$(_reg_get "$id" workspace); project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir)
  # The absence of a workspace field is what distinguishes a main checkout.
  [[ -n "$ws" ]] || die "$id is not a workspace — refusing to rename a main checkout's branch"
  [[ -n "$project" && -n "$workdir" ]] || die "incomplete registry for '$id'"
  [[ -d "$workdir" ]] || die "worktree is gone: $workdir"
  _ws_branch_valid "$new" || die "invalid branch name: $new"

  local main="$PROJECTS_ROOT/$project"
  local old; old=$(git -C "$workdir" rev-parse --abbrev-ref HEAD 2>/dev/null)
  [[ -n "$old" && "$old" != HEAD ]] || die "$id is on a detached HEAD — nothing to rename"
  [[ "$old" != "$new" ]] || die "already named $new"

  # Renaming after a push leaves the old name on the remote and creates a second
  # branch there on the next push. An upstream is the evidence that happened.
  if git -C "$workdir" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    die "$old has an upstream — it is already on the remote; rename before pushing, not after"
  fi

  git -C "$main" show-ref --verify --quiet "refs/heads/$new" \
    && die "branch already exists locally: $new"

  # --exit-code: 0 = the head exists, 2 = it does not, anything else = we could
  # not ask. Unreachable is not the same as taken.
  local rc; git -C "$main" ls-remote --exit-code --heads origin "$new" >/dev/null 2>&1; rc=$?
  case "$rc" in
    0) die "branch already exists on origin: $new" ;;
    2) : ;;
    *) echo "warn: could not reach origin to check for '$new' — renaming anyway" >&2 ;;
  esac

  git -C "$workdir" branch -m "$new" || die "rename failed: $old -> $new"
  _reg_set "$id" branch "$new"
  echo "renamed $id: $old -> $new"
}
```

- [ ] **Step 4: Wire the subcommand**

In the dispatch `case` at ccd:847, add after the `ws-rm` line:

```bash
  ws-rename) shift; cmd_ws_rename "$@" ;;
```

and change the usage line to:

```bash
  *) echo "usage: ccd {start|ensure|supervise|enable|stop|swap|swap-self|prefer|ls|menu|attach|clip|ws-add|ws-rm|ws-rename} <args>" >&2; exit 1 ;;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bash -n infra/<server-host>-portability/ccd && cd infra/ccrc/server && npx vitest run test/ccd-ws-rename.test.ts`
Expected: 16 passed.

- [ ] **Step 6: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-ws-rename.test.ts
git commit -m "feat(ccd): ws-rename renames a workspace branch before it is pushed"
```

---

### Task 6: `ccd ws-gc` — the report

**Files:**
- Modify: `infra/<server-host>-portability/ccd` — add the `_ws_gc_*` helpers and `cmd_ws_gc` after `cmd_ws_rename`, plus the dispatch and usage line
- Test: `infra/ccrc/server/test/ccd-ws-gc.test.ts` (new)

**Interfaces:**
- Consumes: `makeCcdHarness`, `WS_ADD` (Task 4); `PROJECTS_ROOT`, `WORKTREES_ROOT`, `REG`, `_reg_get`, `die`.
- Produces:
  - `_ws_gc_scan` → TSV rows on stdout, one per finding: `state<TAB>project<TAB>slug<TAB>bytes<TAB>agedays<TAB>path`. `bytes` and `agedays` are `-` when the path does not exist. `state` is one of `tracked`, `dirty`, `orphan`, `foreign`, `stale-meta`, `dead-reg`.
  - `cmd_ws_gc` → the formatted report. Task 7 adds `--prune` to it.

**Context:** 29G of abandoned agent worktrees accumulated on this box over six weeks and nothing surfaced it. The value here is visibility; `--prune` (Task 7) is secondary. **This task must not modify anything** — that is its defining property and it gets an explicit test.

The six states:

| state | definition |
|---|---|
| `tracked` | under `$WORKTREES_ROOT`, has a registry entry, clean |
| `dirty` | under `$WORKTREES_ROOT`, has a registry entry, `git status --porcelain` non-empty |
| `orphan` | under `$WORKTREES_ROOT`, **no** `<project>-<slug>.uuid` in the registry |
| `foreign` | a worktree of one of our projects that is **not** under `$WORKTREES_ROOT` — another tool created it |
| `stale-meta` | git has a registration whose directory is gone (`prunable` in `worktree list --porcelain`) |
| `dead-reg` | a registry entry whose `workdir` no longer exists — invisible to git entirely |

- [ ] **Step 1: Write the failing tests**

Create `infra/ccrc/server/test/ccd-ws-gc.test.ts`:

```ts
// ws-gc enumerates every worktree on the box. Sourced under an isolated HOME:
// PROJECTS_ROOT and WORKTREES_ROOT derive from it, so the scan below can only
// ever see the fixtures this file builds.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-gc-'); });
afterEach(() => { h.cleanup(); });

interface Row { state: string; project: string; slug: string; bytes: string; age: string; path: string }

const scan = (): Row[] =>
  h.sh('_ws_gc_scan').split('\n').filter(Boolean).map((l) => {
    const [state, project, slug, bytes, age, p] = l.split('\t');
    return { state, project, slug, bytes, age, path: p };
  });

const find = (rows: Row[], slug: string): Row | undefined => rows.find((r) => r.slug === slug);

/** A tracked workspace on ws/<slug>. Returns its worktree path. */
const addWs = (project: string, slug: string): string => {
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  return path.join(h.home, 'worktrees', project, slug);
};

/** A worktree under WORKTREES_ROOT with no registry entry. */
const addOrphan = (project: string, slug: string): string => {
  const wt = addWs(project, slug);
  fs.rmSync(path.join(h.home, '.cc-sessions', `${project}-${slug}.uuid`));
  return wt;
};

describe('_ws_gc_scan', () => {
  it('reports nothing for a project with only its main checkout', () => {
    h.makeRepo('demo');
    expect(scan()).toEqual([]);
  });

  it('classifies a healthy workspace as tracked', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    const r = find(scan(), 'quiet-mesa')!;
    expect(r.state).toBe('tracked');
    expect(r.project).toBe('demo');
    expect(r.bytes).toMatch(/^\d+$/);
    expect(r.age).toMatch(/^\d+$/);
  });

  it('classifies a workspace with uncommitted changes as dirty', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved\n');
    expect(find(scan(), 'quiet-mesa')!.state).toBe('dirty');
  });

  it('counts untracked files as dirty — git worktree remove objects to them too', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.writeFileSync(path.join(wt, 'notes.md'), 'draft\n');
    expect(find(scan(), 'quiet-mesa')!.state).toBe('dirty');
  });

  it('classifies a worktree with no registry entry as an orphan', () => {
    h.makeRepo('demo');
    addOrphan('demo', 'still-cove');
    expect(find(scan(), 'still-cove')!.state).toBe('orphan');
  });

  it('classifies a worktree outside WORKTREES_ROOT as foreign', () => {
    const main = h.makeRepo('demo');
    // Exactly the shape of the live handoff worktree on this box: registered
    // against one of our projects, living somewhere else entirely.
    const elsewhere = path.join(h.home, '.handoff', 'wt', 'demo-something');
    h.git(main, 'worktree', 'add', '-b', 'handoff/something', elsewhere);
    const r = find(scan(), 'demo-something')!;
    expect(r.state).toBe('foreign');
    expect(r.path).toBe(elsewhere);
  });

  it('classifies a git registration whose directory is gone as stale-meta', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.rmSync(wt, { recursive: true, force: true });
    // Deleting the directory by hand leaves BOTH a stale git registration and a
    // registry entry pointing at nothing. Assert both, rather than letting
    // `find` silently return whichever happens to be emitted first.
    const states = scan().filter((r) => r.slug === 'quiet-mesa').map((r) => r.state).sort();
    expect(states).toEqual(['dead-reg', 'stale-meta']);
  });

  it('treats a worktree it cannot read as dirty, not as clean', () => {
    // A tree whose git metadata is unreadable produces no `status --porcelain`
    // output. If that were taken as "clean", --prune would delete exactly the
    // trees it understands least.
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.rmSync(path.join(wt, '.git'));    // the worktree's gitfile
    expect(h.sh(`_ws_gc_dirty '${wt}' && echo dirty || echo clean`)).toBe('dirty');
  });

  it('classifies a registry entry whose workdir is gone as dead-reg', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    // Remove the worktree properly, so git has no registration left at all —
    // the entry is then invisible to `git worktree list` and only the registry
    // knows it ever existed.
    h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'remove', wt);
    const r = find(scan(), 'quiet-mesa')!;
    expect(r.state).toBe('dead-reg');
    expect(r.path).toBe(wt);
  });

  it('never reports the main checkout as a workspace', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    // The main checkout is the first record in `worktree list --porcelain`, and
    // its path is fully resolved (~/projects -> /data/projects -> /mnt/...), so
    // a plain string comparison against $PROJECTS_ROOT/demo would miss it.
    expect(scan().some((r) => r.slug === 'demo')).toBe(false);
  });

  it('spans every project, not just one', () => {
    h.makeRepo('alpha');
    h.makeRepo('beta');
    addWs('alpha', 'quiet-mesa');
    addOrphan('beta', 'still-cove');
    const rows = scan();
    expect(find(rows, 'quiet-mesa')!.project).toBe('alpha');
    expect(find(rows, 'still-cove')!.project).toBe('beta');
  });

  it('survives a non-repo directory under PROJECTS_ROOT', () => {
    fs.mkdirSync(path.join(h.home, 'projects', 'not-a-repo'), { recursive: true });
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    expect(find(scan(), 'quiet-mesa')!.state).toBe('tracked');
  });
});

describe('ws-gc report', () => {
  const gc = (args = ''): string =>
    h.sh(`cmd_ws_gc ${args}`);

  it('prints a row per finding with its state and path', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    const out = gc();
    expect(out).toContain('tracked');
    expect(out).toContain('quiet-mesa');
    expect(out).toContain(wt);
  });

  it('prints a total, and says why it can be smaller than the rows sum', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    const out = gc();
    expect(out).toMatch(/total\s+\S+\s+across 1 worktree/);
    expect(out).toContain('hardlink');
  });

  it('says so plainly when there is nothing to report', () => {
    h.makeRepo('demo');
    expect(gc()).toContain('nothing to report');
  });

  it('MODIFIES NOTHING — the whole tree is byte-identical afterwards', () => {
    // This is the load-bearing property of the default invocation. A gc that
    // deletes by default is one typo from destroying work.
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    addOrphan('demo', 'still-cove');
    fs.rmSync(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa', 'README.md'));  // make it dirty
    const snapshot = (): string =>
      execFileSync('find', [h.home, '-printf', '%P %s %y\\n'], { encoding: 'utf8' })
        .split('\n').sort().join('\n');
    const before = snapshot();
    gc();
    expect(snapshot()).toBe(before);
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('refuses an unrecognised argument rather than guessing', () => {
    h.makeRepo('demo');
    expect(() => gc('--purge')).toThrow();
  });

  it('is reachable as a subcommand', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    expect(h.sh(`"${CCD}" ws-gc`)).toContain('quiet-mesa');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-ws-gc.test.ts`
Expected: FAIL — `_ws_gc_scan: command not found`, `cmd_ws_gc: command not found`.

- [ ] **Step 3: Write the measurement helpers**

Insert into `infra/<server-host>-portability/ccd` after `cmd_ws_rename`:

```bash
# ── reclamation ────────────────────────────────────────────────────
# ws-gc REPORTS by default and acts only under --prune. 29G of abandoned agent
# worktrees accumulated on this box over six weeks because no command existed
# that would have said so; the visibility is the point.

_ws_gc_bytes() {   # path -> size in bytes, or '-'
  [[ -d "$1" ]] || { echo '-'; return 0; }
  local b; b=$(du -sb "$1" 2>/dev/null | cut -f1)
  [[ "$b" =~ ^[0-9]+$ ]] && echo "$b" || echo '-'
}

_ws_gc_age() {     # path -> whole days since its mtime, or '-'
  [[ -d "$1" ]] || { echo '-'; return 0; }
  local m; m=$(stat -c %Y "$1" 2>/dev/null) || { echo '-'; return 0; }
  [[ "$m" =~ ^[0-9]+$ ]] || { echo '-'; return 0; }
  echo $(( ( $(date +%s) - m ) / 86400 ))
}

_ws_gc_human() {   # bytes -> human, or '-' unchanged
  [[ "$1" =~ ^[0-9]+$ ]] || { echo '-'; return 0; }
  numfmt --to=iec "$1" 2>/dev/null || echo "$1"
}

_ws_gc_dirty() {   # workdir -> 0 when the tree has uncommitted OR untracked files,
                   #            OR when we could not find out
  local out
  # `git status` failing means unreadable, corrupt, or not a worktree at all —
  # NOT clean. Swallowing the exit code and testing an empty string would report
  # every unreadable tree as safe to delete, which is the one answer that loses
  # work. Unknown counts as dirty.
  out=$(git -C "$1" status --porcelain 2>/dev/null) || return 0
  [[ -n "$out" ]]
}
```

- [ ] **Step 4: Write the scanner**

Append, after the helpers above:

```bash
# One TSV row per finding: state project slug bytes agedays path
_ws_gc_row() {   # project mainreal wsroot wt prunable
  local project="$1" mainreal="$2" wsroot="$3" wt="$4" prunable="$5"
  [[ -n "$wt" ]] || return 0
  [[ "$wt" != "$mainreal" ]] || return 0        # the main checkout is not a workspace
  local slug; slug=$(basename "$wt")

  if (( prunable )); then
    printf 'stale-meta\t%s\t%s\t-\t-\t%s\n' "$project" "$slug" "$wt"; return 0
  fi

  local bytes age; bytes=$(_ws_gc_bytes "$wt"); age=$(_ws_gc_age "$wt")

  # Anything ccd did not create is FOREIGN: reported so it is visible, never
  # pruned. Guessing at another tool's lifecycle is how a reclaimer destroys
  # work it does not understand.
  if [[ "$wt" != "$wsroot/$project/"* ]]; then
    printf 'foreign\t%s\t%s\t%s\t%s\t%s\n' "$project" "$slug" "$bytes" "$age" "$wt"; return 0
  fi

  local state
  if   [[ ! -f "$REG/$project-$slug.uuid" ]]; then state=orphan
  elif _ws_gc_dirty "$wt";                    then state=dirty
  else                                             state=tracked
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$state" "$project" "$slug" "$bytes" "$age" "$wt"
}

_ws_gc_scan() {
  local main mainreal project wsroot wt prunable line f id wd p s
  # git records fully resolved paths (~/projects -> /data/projects -> /mnt/...),
  # so both roots have to be resolved before any path comparison.
  wsroot=$(cd "$WORKTREES_ROOT" 2>/dev/null && pwd -P) || wsroot="$WORKTREES_ROOT"

  for main in "$PROJECTS_ROOT"/*; do
    [[ -e "$main/.git" ]] || continue
    project=$(basename "$main")
    mainreal=$(cd "$main" 2>/dev/null && pwd -P) || continue
    wt=""; prunable=0
    # Records are blank-line separated; the trailing `echo` flushes the last one
    # whether or not git emitted a final blank line.
    while IFS= read -r line; do
      case "$line" in
        "worktree "*) wt="${line#worktree }"; prunable=0 ;;
        "prunable"*)  prunable=1 ;;
        "")           _ws_gc_row "$project" "$mainreal" "$wsroot" "$wt" "$prunable"
                      wt=""; prunable=0 ;;
      esac
    done < <(git -C "$main" worktree list --porcelain 2>/dev/null; echo)
  done

  # Registry entries whose worktree is gone. git has no registration for these
  # at all, so the loop above cannot see them.
  for f in "$REG"/*.workspace; do
    [[ -e "$f" ]] || continue
    id=$(basename "$f" .workspace)
    [[ -f "$REG/$id.uuid" ]] || continue
    wd=$(_reg_get "$id" workdir)
    [[ -n "$wd" && ! -d "$wd" ]] || continue
    p=$(_reg_get "$id" project); s=$(_reg_get "$id" workspace)
    # The id is <project>-<slug> by construction. If the registry disagrees with
    # itself, report it and reconstruct nothing — a prune keyed off a wrong
    # reconstruction would delete a different session's entry.
    [[ "$p-$s" == "$id" ]] || { printf 'dead-reg\t%s\t%s\t-\t-\t%s\n' "$id" "?" "$wd"; continue; }
    printf 'dead-reg\t%s\t%s\t-\t-\t%s\n' "$p" "$s" "$wd"
  done
}
```

- [ ] **Step 5: Write the report command**

Append, after the scanner:

```bash
cmd_ws_gc() {   # [--prune]
  [[ -z "${1:-}" ]] || die "usage: ccd ws-gc"

  local rows; rows=$(_ws_gc_scan)
  [[ -n "$rows" ]] || { echo "nothing to report — no worktrees found under $PROJECTS_ROOT"; return 0; }

  local state project slug bytes age p n=0
  local -a paths=()
  printf '%-11s %-18s %-22s %7s %5s  %s\n' STATE PROJECT WORKSPACE SIZE IDLE PATH
  while IFS=$'\t' read -r state project slug bytes age p; do
    printf '%-11s %-18s %-22s %7s %5s  %s\n' \
      "$state" "$project" "$slug" "$(_ws_gc_human "$bytes")" "$age" "$p"
    n=$(( n + 1 ))
    [[ -d "$p" ]] && paths+=("$p")
  done <<< "$rows"

  # One du across every path at once: it de-dupes inodes shared between
  # worktrees, so this is the exact figure that removing the lot would free.
  # The per-row sizes are independent measurements and can sum to more.
  local total='-'
  if (( ${#paths[@]} > 0 )); then
    total=$(du -scb "${paths[@]}" 2>/dev/null | awk '$2 == "total" {print $1}')
    total=$(_ws_gc_human "$total")
  fi
  echo
  echo "total $total across $n worktree$( (( n == 1 )) || echo s ) — what removing all of them would free."
  echo "Rows are measured independently, so they can sum to more than the total when workspaces share hardlinks."
}
```

- [ ] **Step 6: Wire the subcommand**

In the dispatch `case`, add after the `ws-rename` line:

```bash
  ws-gc)     shift; cmd_ws_gc "$@" ;;
```

and change the usage line to:

```bash
  *) echo "usage: ccd {start|ensure|supervise|enable|stop|swap|swap-self|prefer|ls|menu|attach|clip|ws-add|ws-rm|ws-rename|ws-gc} <args>" >&2; exit 1 ;;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bash -n infra/<server-host>-portability/ccd && cd infra/ccrc/server && npx vitest run test/ccd-ws-gc.test.ts`
Expected: 18 passed.

- [ ] **Step 8: Run it against the real box, read the output, and check nothing changed**

```bash
git -C /srv/projects/OpenClawHetzner stash list > /tmp/before-gc.txt
ls -la ~/worktrees ~/worktrees/* >> /tmp/before-gc.txt
bash infra/<server-host>-portability/ccd ws-gc
ls -la ~/worktrees ~/worktrees/* > /tmp/after-gc.txt
diff /tmp/before-gc.txt /tmp/after-gc.txt && echo "UNCHANGED"
```

Expected: the report lists `custom-tools/quiet-basin` as `tracked` (or `dirty`), and the handoff worktree
`/home/you/.handoff/wt/custom-tools-receiver-heartbeat--20260728-221900-3091316` as `foreign`.
`diff` prints nothing and `UNCHANGED` appears. If the real run shows a state you did not expect, stop and report it — do not adjust the classifier to make the output look tidier.

- [ ] **Step 9: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-ws-gc.test.ts
git commit -m "feat(ccd): ws-gc reports every worktree on the box

Reports only. 29G of abandoned agent worktrees accumulated here over six
weeks because no command existed that would have said so."
```

---

### Task 7: `ccd ws-gc --prune`

**Files:**
- Modify: `infra/<server-host>-portability/ccd` — add `_ws_gc_merged` and `_ws_gc_prune_row`, extend `cmd_ws_gc`
- Test: `infra/ccrc/server/test/ccd-ws-gc.test.ts`

**Interfaces:**
- Consumes: `_ws_gc_scan`'s TSV rows (Task 6), `_ws_gc_dirty`, `PROJECTS_ROOT`, `REG`.
- Produces: `ccd ws-gc --prune`.

**What `--prune` does per state:**

| state | action |
|---|---|
| `orphan` | remove the worktree — **only** if the tree is clean **and** its branch is merged into `origin/HEAD` or absent. Then `git branch -d` (never `-D`). |
| `stale-meta` | `git worktree prune` |
| `dead-reg` | `rm -f "$REG/<id>".*` |
| `dirty` | **nothing**, ever |
| `foreign` | **nothing**, ever |
| `tracked` | **nothing** |

Every decision not to act prints a line saying which and why. Silence would read as "there was nothing there".

- [ ] **Step 1: Write the failing tests**

Append to `infra/ccrc/server/test/ccd-ws-gc.test.ts`:

```ts
describe('ws-gc --prune', () => {
  const prune = (): string => h.sh(`cmd_ws_gc --prune 2>&1`);

  it('removes a clean orphan whose branch is merged', () => {
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    // Branch is at origin/HEAD with no commits of its own: merged by definition.
    expect(prune()).toContain('removed orphan worktree');
    expect(fs.existsSync(wt)).toBe(false);
    const branches = h.git(path.join(h.home, 'projects', 'demo'), 'branch', '--list', 'ws/still-cove');
    expect(branches).toBe('');
  });

  it('leaves an orphan alone when it cannot resolve origin/HEAD at all', () => {
    // No origin means no base to compare against, so "merged" is unprovable.
    // Unprovable must resolve to declining, not to deleting.
    const main = h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    h.git(main, 'remote', 'remove', 'origin');
    const out = prune();
    expect(out).toContain('unmerged');
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('leaves an orphan whose branch has unmerged commits, and says why', () => {
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'ahead\n');
    h.git(wt, 'add', 'work.txt');
    h.git(wt, 'commit', '-m', 'ahead of base');
    const out = prune();
    expect(out).toContain('unmerged');
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('leaves an orphan with uncommitted changes, and says why', () => {
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved\n');
    const out = prune();
    expect(out).toContain('uncommitted');
    expect(fs.existsSync(wt)).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'scratch.txt'), 'utf8')).toBe('unsaved\n');
  });

  // THE load-bearing guard. ws-rm already refuses a dirty workspace; a sweep
  // that overrode that would make the refusal meaningless.
  it('NEVER touches a dirty tracked workspace', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved\n');
    prune();
    expect(fs.existsSync(wt)).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'scratch.txt'), 'utf8')).toBe('unsaved\n');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('NEVER touches a healthy tracked workspace', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    prune();
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('NEVER touches a foreign worktree, at any flag', () => {
    const main = h.makeRepo('demo');
    const elsewhere = path.join(h.home, '.handoff', 'wt', 'demo-something');
    h.git(main, 'worktree', 'add', '-b', 'handoff/something', elsewhere);
    const out = prune();
    expect(fs.existsSync(elsewhere)).toBe(true);
    expect(out).toContain('foreign');
  });

  it('prunes stale git metadata', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.rmSync(wt, { recursive: true, force: true });
    prune();
    const list = h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'list', '--porcelain');
    expect(list).not.toContain('quiet-mesa');
  });

  it('removes a dead registry entry', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'remove', wt);
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    prune();
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBeNull();
  });

  it('reports what it reclaimed and what it declined', () => {
    h.makeRepo('demo');
    addOrphan('demo', 'still-cove');
    const dirty = addWs('demo', 'quiet-mesa');
    fs.writeFileSync(path.join(dirty, 'scratch.txt'), 'x\n');
    const out = prune();
    // Parse the counts rather than substring-matching a digit: `/reclaimed 1/`
    // would also match "reclaimed 12", and removing one orphan produces two
    // reclaimed lines (the worktree, then its merged branch).
    const m = out.match(/reclaimed (\d+), declined (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
    expect(Number(m![2])).toBeGreaterThanOrEqual(1);
  });

  it('still prints the report before acting', () => {
    h.makeRepo('demo');
    addOrphan('demo', 'still-cove');
    const out = prune();
    expect(out).toContain('STATE');
    expect(out.indexOf('STATE')).toBeLessThan(out.indexOf('removed orphan worktree'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-ws-gc.test.ts`
Expected: FAIL — `cmd_ws_gc` dies on `usage: ccd ws-gc` because it rejects every argument.

- [ ] **Step 3: Write the merge test and the per-row action**

Insert into `infra/<server-host>-portability/ccd` between `_ws_gc_scan` and `cmd_ws_gc`:

```bash
_ws_gc_merged() {   # main branch -> 0 when the branch tip is an ancestor of origin/HEAD
  local main="$1" branch="$2" base
  # No origin/HEAD means there is no base to compare against, so "merged" is
  # unprovable — and unprovable returns 1, i.e. NOT merged, i.e. do not remove.
  # Every ambiguous case in this command resolves toward doing nothing.
  base=$(git -C "$main" symbolic-ref --quiet refs/remotes/origin/HEAD) || return 1
  git -C "$main" merge-base --is-ancestor "refs/heads/$branch" "$base" 2>/dev/null
}

# Acts on ONE scanned row. Prints exactly one line per row, whether it acted or
# not: a silent decline reads as "there was nothing there".
_ws_gc_prune_row() {   # state project slug path
  local state="$1" project="$2" slug="$3" p="$4"
  local main="$PROJECTS_ROOT/$project"
  case "$state" in
    stale-meta)
      if git -C "$main" worktree prune 2>/dev/null; then
        echo "  reclaimed  stale metadata for $project/$slug"
      else
        # Metadata, not data — worth saying, not worth failing over.
        echo "  declined   could not prune metadata for $project/$slug"
      fi ;;
    dead-reg)
      rm -f "$REG/$project-$slug".*
      echo "  reclaimed  dead registry entry $project-$slug" ;;
    orphan)
      if _ws_gc_dirty "$p"; then
        echo "  declined   $p has uncommitted changes"; return 0
      fi
      local branch; branch=$(git -C "$p" rev-parse --abbrev-ref HEAD 2>/dev/null)
      if [[ -n "$branch" && "$branch" != HEAD ]] && ! _ws_gc_merged "$main" "$branch"; then
        # The branch would survive `worktree remove`, so nothing is lost either
        # way — but a sweep should only reclaim what is provably finished, and
        # someone may be mid-way through this one.
        echo "  declined   $p is on unmerged branch $branch"; return 0
      fi
      if git -C "$main" worktree remove "$p" 2>/dev/null; then
        echo "  reclaimed  removed orphan worktree $p"
        # No -D: git refuses an unmerged branch and that refusal is wanted.
        if [[ -n "$branch" && "$branch" != HEAD ]] && git -C "$main" branch -d "$branch" 2>/dev/null; then
          echo "  reclaimed  deleted merged branch $branch"
        fi
      else
        echo "  declined   git refused to remove $p"
      fi ;;
    dirty)
      echo "  declined   $p is dirty — never removed, at any flag" ;;
    foreign)
      echo "  declined   $p is foreign — ccd removes only what it created" ;;
    tracked)
      : ;;   # a live workspace: not a finding to act on
  esac
}
```

- [ ] **Step 4: Extend `cmd_ws_gc`**

Replace the first line of `cmd_ws_gc`:

```bash
  [[ -z "${1:-}" ]] || die "usage: ccd ws-gc"
```

with:

```bash
  local prune=0
  case "${1:-}" in
    '')       ;;
    --prune)  prune=1 ;;
    *)        die "usage: ccd ws-gc [--prune]" ;;
  esac
```

and append to the end of `cmd_ws_gc`, after the two `echo` lines that explain the total:

```bash
  (( prune )) || return 0

  echo
  echo "pruning:"
  local reclaimed=0 declined=0 out
  while IFS=$'\t' read -r state project slug bytes age p; do
    out=$(_ws_gc_prune_row "$state" "$project" "$slug" "$p")
    [[ -n "$out" ]] || continue
    echo "$out"
    reclaimed=$(( reclaimed + $(grep -c 'reclaimed' <<< "$out") ))
    declined=$((  declined  + $(grep -c 'declined'  <<< "$out") ))
  done <<< "$rows"
  echo
  echo "reclaimed $reclaimed, declined $declined"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bash -n infra/<server-host>-portability/ccd && cd infra/ccrc/server && npx vitest run test/ccd-ws-gc.test.ts`
Expected: 29 passed (18 from Task 6 + 11 here). A later review-fix round adds one more regression test (anchoring the `reclaimed`/`declined` counts), taking this file to 30 — not reached by this task's steps alone.

- [ ] **Step 6: Prove the dirty guard is load-bearing by mutation**

Temporarily delete the dirty check from `_ws_gc_prune_row`'s `orphan` branch (the `if _ws_gc_dirty "$p"; then … return 0; fi` block) and re-run:

Run: `cd infra/ccrc/server && npx vitest run test/ccd-ws-gc.test.ts`
Expected: **RED** — `'leaves an orphan with uncommitted changes, and says why'` must fail. If the suite stays green, the guard is untested; write a test that fails before restoring the guard.

Restore the guard and re-run. Expected: 29 passed.

- [ ] **Step 7: Full suite and host check**

```bash
cd infra/ccrc/server && npx vitest run && npx tsc --noEmit
cd ../agent && npx vitest run
cd ../pwa && npx vitest run && npx tsc --noEmit
```

Expected: **server 394** (335 baseline + 4 + 5 + 5 + 0 + 16 + 18 + 11), agent 86, pwa 313; typecheck clean. The agent and pwa counts must be *unchanged* — nothing in this plan touches either package, so any movement there means something leaked. (A later review-fix round adds one more regression test on top of this task's work, taking the server suite to 395 — not reached by this task's steps alone.)

Then confirm the test run left the host alone:

```bash
ls ~/.cc-sessions/ | wc -l          # unchanged from before the run
ls ~/worktrees/*/                    # custom-tools/quiet-basin still present
tmux ls | wc -l                      # nine live sessions still there
```

- [ ] **Step 8: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-ws-gc.test.ts
git commit -m "feat(ccd): ws-gc --prune reclaims orphans, stale metadata and dead registry entries

Never a dirty tree, never a foreign worktree, never an unmerged branch's
only checkout. Every decision not to act prints why."
```

---

## Out of scope

Deliberately excluded — do not implement these:

- **Archive on merge.** The spec describes it, but it depends on PR state, which the [fleet hierarchy spec](../specs/2026-07-28-ccrc-fleet-hierarchy-design.md) introduces. This plan builds everything it needs — `ws-gc`'s safety checks, `ws-rm`'s refusals, the disk accounting — except the trigger.
- **Choosing a branch name automatically.** Phase 2, with the agent. `ws-rename` is the mechanism; the policy of who picks the name is not here.
- **Raising or merging PRs.** Phase 2.
- **A scheduled sweep.** `ws-gc` is a command. Wiring a cron to a deleter nobody has watched run is how a reclaimer becomes an incident.
- **Server routes or PWA surfaces for `ws-rename` / `ws-gc`.** They are not in `EXEC_WHITELIST` and must not be added; nothing calls them remotely in this phase.
- **Pruning anything outside `$WORKTREES_ROOT`.** Reported as `foreign`, never touched.

## Known gap, not addressed here

Nothing asserts that the set of `ccd` argv the server constructs is a subset of the agent's `EXEC_WHITELIST`. That omission is how `ws-add`/`ws-rm` reached deployment inert during Phase 1, surviving three green suites. It does not bite this plan — `ws-rename` and `ws-gc` are deliberately not server-reachable — but it is still open and belongs in whichever phase next adds a server-side `ccd` call.
