# Workspaces Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make a project able to hold more than one session — each in its own git worktree on its own branch — and make the fleet screen able to tell them apart.

**Architecture:** free the session id (today `<wrapper>-<project>`, a singleton) by writing `home` explicitly at creation, so nothing has to parse the id any more. Add `ccd ws-add` / `ccd ws-rm` to own worktree lifecycle beside the tmux and systemd lifecycle ccd already owns. Surface `workspace` on the wire, and group the fleet list by project **only when a project holds two or more sessions**.

**Tech Stack:** bash, TypeScript, Fastify, React 19, vitest.

**Spec:** [`docs/superpowers/specs/2026-07-28-ccrc-workspaces-design.md`](../specs/2026-07-28-ccrc-workspaces-design.md)

## Global Constraints

- Repo `/srv/projects/OpenClawHetzner`, branch `ccrc/workspaces-phase1`.
- Suites run from the package dir: `cd infra/ccrc/{server,agent,pwa} && npx vitest run`. Single file: `npx vitest run test/x.test.ts`.
- Baseline to preserve: **server 292, agent 84, pwa 270**. Typecheck (`npx tsc --noEmit`) clean in all three. Contrast gate `node infra/ccrc/pwa/design/contrast-check.mjs` → **ALL 78 PASS**.
- No new runtime dependencies.
- `bash -n infra/<server-host>-portability/ccd` must pass after every ccd change.
- Workspace slugs match `^[a-z0-9][a-z0-9-]{1,30}$` — **no dots** (tmux `-t` reads `session:window.pane`), **no slashes** (systemd instance names escape `/`).
- ccd is sourced by tests (`source "${CCD}"`), so **every new top-level statement must be inside a function**. A bare command at file scope runs on import and breaks the harness.
- Never write to the real `~/.cc-sessions` from a test. The harness sets `HOME` to a temp dir; all registry paths derive from it.
- Destructive operations refuse rather than force. `git worktree remove` without `--force`, `git branch -d` without `-D`.

---

### Task 1: `cmd_start` writes `home` explicitly

This is what frees the id. Measured on the live registry, 2 of 9 sessions have no `.home` file, so `_home_for` falls back to parsing the id prefix — which is wrong for 3 of 9 ids today.

**Files:**
- Modify: `infra/<server-host>-portability/ccd:449-466` (`cmd_start`)
- Test: `infra/ccrc/server/test/ccd-workspaces.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the guarantee that every session created from now on has a `home` field. Tasks 3 and 5 rely on it.

- [ ] **Step 1: Write the failing test**

Create `infra/ccrc/server/test/ccd-workspaces.test.ts`:

```ts
// ccd owns worktree lifecycle beside the tmux and systemd lifecycle it already
// owns. These tests source ccd under an isolated HOME, exactly as
// ccd-limits.test.ts does, so nothing here can touch the real registry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const CCD = path.resolve(__dirname, '../../../<server-host>-portability/ccd');
let home: string;

const sh = (snippet: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
    { encoding: 'utf8', env: { ...process.env, HOME: home } }).trim();

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-ccd-ws-'));
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude2', 'claude-corp']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }
});

afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (id: string, field: string): string | null => {
  const p = path.join(home, '.cc-sessions', `${id}.${field}`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
};

describe('home is explicit at creation', () => {
  it('writes home when cmd_start registers a new session', () => {
    fs.mkdirSync(path.join(home, 'projects', 'demo'), { recursive: true });
    // _spawn needs tmux; register only, then assert the field.
    sh(`_reg_set claude2-demo wrapper claude2
        _reg_set claude2-demo project demo
        _ws_seed_home claude2-demo claude2`);
    expect(reg('claude2-demo', 'home')).toBe('claude2');
  });

  it('does not overwrite a home that was already chosen', () => {
    sh(`_reg_set claude2-demo home claude-corp
        _ws_seed_home claude2-demo claude2`);
    expect(reg('claude2-demo', 'home')).toBe('claude-corp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: FAIL — `_ws_seed_home: command not found`

- [ ] **Step 3: Write minimal implementation**

In `infra/<server-host>-portability/ccd`, add beside the other registry helpers (after `_reg_get`, around line 95):

```bash
_ws_seed_home() {   # id wrapper — set home once; never clobber a deliberate choice
  [[ -f "$REG/$1.home" ]] || _reg_set "$1" home "$2"
}
```

Then in `cmd_start`, immediately after the existing `_reg_set "$id" workdir …; _reg_set "$id" uuid …` line:

```bash
  _ws_seed_home "$id" "$wrapper"
```

The guard is the point: re-running `ccd start` on an existing session must not
undo a home chosen by `ccd prefer`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: PASS, 2 tests

Run: `bash -n infra/<server-host>-portability/ccd`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-workspaces.test.ts
git commit -m "feat(ccd): write home explicitly at session creation

Frees the id from having to encode the account: _home_for's prefix
fallback is load-bearing for 2 of 9 live sessions and wrong for 3."
```

---

### Task 2: slug generation and validation

**Files:**
- Modify: `infra/<server-host>-portability/ccd` (helpers, after `_ws_seed_home`)
- Test: `infra/ccrc/server/test/ccd-workspaces.test.ts`

**Interfaces:**
- Consumes: `_reg_set`/`_reg_get` and `$REG` from Task 1's neighbourhood.
- Produces: `_ws_slug_valid <slug>` (exit status only) and `_ws_slug_new <project>` (echoes a free slug, non-zero on exhaustion). Task 3 calls both.

- [ ] **Step 1: Write the failing test**

Append to `infra/ccrc/server/test/ccd-workspaces.test.ts`:

```ts
describe('slug rules', () => {
  const ok = (s: string): boolean =>
    sh(`_ws_slug_valid '${s}' && echo yes || echo no`) === 'yes';

  it('accepts lowercase alphanumeric and hyphens', () => {
    expect(ok('quiet-mesa')).toBe(true);
    expect(ok('a1')).toBe(true);
  });

  it('rejects dots, because tmux -t reads session:window.pane', () => {
    expect(ok('quiet.mesa')).toBe(false);
  });

  it('rejects slashes, because systemd instance names escape them', () => {
    expect(ok('feat/thing')).toBe(false);
  });

  it('rejects a leading hyphen, uppercase, and over-length', () => {
    expect(ok('-mesa')).toBe(false);
    expect(ok('Quiet-Mesa')).toBe(false);
    expect(ok('a'.repeat(32))).toBe(false);
  });

  it('generates a slug that is itself valid', () => {
    const slug = sh(`_ws_slug_new demo`);
    expect(sh(`_ws_slug_valid '${slug}' && echo yes || echo no`)).toBe('yes');
  });

  it('never collides with an existing registry entry', () => {
    // Pin the generator to one candidate, then occupy it.
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-mesa.uuid'), 'x');
    const slug = sh(`CCD_WS_SLUG=quiet-mesa _ws_slug_new demo || echo EXHAUSTED`);
    expect(slug).toBe('EXHAUSTED');
  });

  it('honours CCD_WS_SLUG when the name is free', () => {
    expect(sh(`CCD_WS_SLUG=quiet-mesa _ws_slug_new demo`)).toBe('quiet-mesa');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: FAIL — `_ws_slug_valid: command not found`

- [ ] **Step 3: Write minimal implementation**

```bash
# ── workspace slugs ────────────────────────────────────────────────────
# No dots: tmux -t parses `session:window.pane`. No slashes: systemd
# instance names escape them. Lowercase only, so a slug is never ambiguous
# on a case-insensitive filesystem.
WS_ADJ=(quiet swift amber still brisk clear plain warm bright calm keen soft)
WS_NOUN=(mesa river ridge harbor meadow canyon summit hollow prairie basin cove delta)

_ws_slug_valid() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]]; }

_ws_slug_free() { [[ ! -f "$REG/$1-$2.uuid" ]]; }   # project slug

_ws_slug_new() {   # project -> echo a free, valid slug (or fail)
  local project="$1" slug i
  if [[ -n "${CCD_WS_SLUG:-}" ]]; then             # tests and manual naming
    _ws_slug_valid "$CCD_WS_SLUG" || return 1
    _ws_slug_free "$project" "$CCD_WS_SLUG" || return 1
    echo "$CCD_WS_SLUG"; return 0
  fi
  for ((i = 0; i < 60; i++)); do
    slug="${WS_ADJ[RANDOM % ${#WS_ADJ[@]}]}-${WS_NOUN[RANDOM % ${#WS_NOUN[@]}]}"
    _ws_slug_free "$project" "$slug" && { echo "$slug"; return 0; }
  done
  return 1
}
```

`CCD_WS_SLUG` is deliberately not a silent override — it still has to pass
validation and the collision check, so a test cannot fabricate an id that
production could not produce.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: PASS, 9 tests

Run: `bash -n infra/<server-host>-portability/ccd`

- [ ] **Step 5: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-workspaces.test.ts
git commit -m "feat(ccd): workspace slug generation and validation"
```

---

### Task 3: `ccd ws-add`

**Files:**
- Modify: `infra/<server-host>-portability/ccd` (new `cmd_ws_add`, dispatch case)
- Test: `infra/ccrc/server/test/ccd-workspaces.test.ts`

**Interfaces:**
- Consumes: `_ws_slug_new`, `_ws_slug_valid`, `_ws_seed_home` (Tasks 1-2); `_limit_score` (`ccd:135`), `VALID_WRAPPERS` (`ccd:9`), `$REG`, `$PROJECTS_ROOT`.
- Produces: `ccd ws-add <project> [slug]`, registering id `<project>-<slug>` with fields `wrapper project workdir uuid workspace base home`. Tasks 5 and 6 read `workspace`.

- [ ] **Step 1: Write the failing test**

Append to `infra/ccrc/server/test/ccd-workspaces.test.ts`:

```ts
/** A real git repo with one commit and an origin, so worktree/base logic is
 *  exercised for real rather than mocked. */
const makeRepo = (name: string): string => {
  const origin = path.join(home, 'origins', `${name}.git`);
  const main = path.join(home, 'projects', name);
  execFileSync('git', ['init', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-b', 'main', main]);
  const g = (...a: string[]): void => {
    execFileSync('git', ['-C', main, ...a], {
      env: { ...process.env, HOME: home, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x',
             GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' },
    });
  };
  fs.writeFileSync(path.join(main, 'README.md'), 'hi\n');
  g('add', 'README.md');
  g('commit', '-m', 'init');
  g('remote', 'add', 'origin', origin);
  g('push', '-u', 'origin', 'main');
  g('remote', 'set-head', 'origin', '-a');
  return main;
};

/** ws-add spawns a session; tmux is not available under test, so stub _spawn
 *  and the systemd call. Everything else runs for real. */
const WS_ADD = `_spawn() { :; }; _ws_supervise() { :; };`;

describe('ws-add', () => {
  it('creates a worktree on a new branch off origin/HEAD', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-mesa');
    expect(fs.existsSync(path.join(wt, 'README.md'))).toBe(true);
    const branch = execFileSync('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8' }).trim();
    expect(branch).toBe('quiet-mesa');
  });

  it('registers the workspace with every field the wire needs', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(reg('demo-quiet-mesa', 'project')).toBe('demo');
    expect(reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    expect(reg('demo-quiet-mesa', 'base')).toBe('origin/main');
    expect(reg('demo-quiet-mesa', 'workdir'))
      .toBe(path.join(home, 'worktrees', 'demo', 'quiet-mesa'));
    expect(reg('demo-quiet-mesa', 'home')).not.toBeNull();
  });

  it('excludes .ccrc/ so a draft file can never be committed', () => {
    const main = makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const exclude = fs.readFileSync(path.join(main, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('.ccrc/');
  });

  it('runs .ccrc/workspace.sh with MAIN and WT set', () => {
    const main = makeRepo('demo');
    fs.mkdirSync(path.join(main, '.ccrc'));
    fs.writeFileSync(path.join(main, '.ccrc', 'workspace.sh'),
      '#!/bin/sh\nprintf "%s\\n%s\\n" "$MAIN" "$WT" > "$WT/setup-ran"\n', { mode: 0o755 });
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-mesa');
    expect(fs.readFileSync(path.join(wt, 'setup-ran'), 'utf8')).toBe(`${main}\n${wt}\n`);
  });

  it('records setup failure without destroying the workspace', () => {
    const main = makeRepo('demo');
    fs.mkdirSync(path.join(main, '.ccrc'));
    fs.writeFileSync(path.join(main, '.ccrc', 'workspace.sh'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(reg('demo-quiet-mesa', 'setup')).toBe('failed');
    expect(fs.existsSync(path.join(home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(true);
  });

  it('refuses a project that is not a git repo', () => {
    fs.mkdirSync(path.join(home, 'projects', 'bare'), { recursive: true });
    expect(() => sh(`${WS_ADD} cmd_ws_add bare`)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: FAIL — `cmd_ws_add: command not found`

- [ ] **Step 3: Write minimal implementation**

Add `WORKTREES_ROOT` beside the other roots near the top of ccd (inside no function; it is an assignment, which is safe to source):

```bash
WORKTREES_ROOT="${WORKTREES_ROOT:-$HOME/worktrees}"
```

Then the command:

```bash
_ws_least_loaded() {   # -> the home-able account with the most headroom
  local best="" bs=1000 w sc
  for w in "${VALID_WRAPPERS[@]}"; do
    sc=$(_limit_score "$w"); [[ -z "$sc" ]] && sc=0
    (( sc < bs )) && { bs=$sc; best="$w"; }
  done
  echo "$best"
}

cmd_ws_add() {   # project [slug] — new worktree + session for an existing project
  local project="${1:?usage: ccd ws-add <project> [slug]}" slug="${2:-}"
  [[ "$project" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid project '$project'"
  local main="$PROJECTS_ROOT/$project"
  [[ -d "$main/.git" ]] || die "not a git repo: $main"

  [[ -n "$slug" ]] && { _ws_slug_valid "$slug" || die "invalid slug '$slug'"; \
                        _ws_slug_free "$project" "$slug" || die "slug in use: $slug"; }
  [[ -z "$slug" ]] && { slug=$(CCD_WS_SLUG="${CCD_WS_SLUG:-}" _ws_slug_new "$project") \
                        || die "could not find a free slug for $project"; }

  git -C "$main" fetch origin --quiet 2>/dev/null || echo "warn: fetch failed; basing on the last known origin" >&2
  local base
  base=$(git -C "$main" symbolic-ref --quiet refs/remotes/origin/HEAD) \
    || die "no origin/HEAD — run: git -C '$main' remote set-head origin -a"
  base="${base#refs/remotes/}"

  local wt="$WORKTREES_ROOT/$project/$slug"
  [[ "$wt" != *\'* ]] || die "path must not contain a single quote: $wt"
  mkdir -p "$WORKTREES_ROOT/$project"
  git -C "$main" worktree add -b "$slug" "$wt" "$base" --quiet \
    || die "git worktree add failed for $wt"

  # Shared across every worktree of this repo, local only, never committed.
  local common; common=$(cd "$main" && cd "$(git rev-parse --git-common-dir)" && pwd -P)
  mkdir -p "$common/info"
  grep -qxF '.ccrc/' "$common/info/exclude" 2>/dev/null || echo '.ccrc/' >> "$common/info/exclude"

  local id="$project-$slug"
  local uuid; uuid=$(cat /proc/sys/kernel/random/uuid)
  local hw; hw=$(_ws_least_loaded)
  _reg_set "$id" wrapper "$hw";   _reg_set "$id" project "$project"
  _reg_set "$id" workdir "$wt";   _reg_set "$id" uuid "$uuid"
  _reg_set "$id" workspace "$slug"; _reg_set "$id" base "$base"
  _ws_seed_home "$id" "$hw"

  # A failed setup hook leaves a usable-but-unscaffolded workspace. Say so;
  # never remove work on the strength of a hook's exit code.
  if [[ -x "$main/.ccrc/workspace.sh" ]]; then
    if MAIN="$main" WT="$wt" "$main/.ccrc/workspace.sh"; then
      _reg_set "$id" setup ok
    else
      _reg_set "$id" setup failed
      echo "warn: .ccrc/workspace.sh failed for $id — workspace kept, not scaffolded" >&2
    fi
  fi

  _spawn "$id" new; _reg_set "$id" started 1
  _ws_supervise "$id"
  echo "workspace $id on $hw — $wt (branch $slug, from $base)"
}
```

**The systemd calls must live in their own functions**, added beside
`_ws_seed_home`, so the test harness can stub them. Without this, sourcing ccd
and calling `cmd_ws_add` under vitest would enable a real
`claude-session@demo-quiet-mesa` unit on the host:

```bash
_ws_supervise()   { systemctl --user enable  --now "claude-session@$1" 2>/dev/null \
                      || echo "warn: could not enable unit claude-session@$1" >&2; }
_ws_unsupervise() { systemctl --user disable --now "claude-session@$1" 2>/dev/null || true; }
```

Add to the dispatch `case` near `ccd:685`:

```bash
  ws-add)  shift; cmd_ws_add "$@" ;;
```

and extend the usage line to include `ws-add|ws-rm`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: PASS, 15 tests

Run: `bash -n infra/<server-host>-portability/ccd`

- [ ] **Step 5: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-workspaces.test.ts
git commit -m "feat(ccd): ws-add creates a worktree, scaffolds it, and spawns a session"
```

---

### Task 4: `ccd ws-rm`

**Files:**
- Modify: `infra/<server-host>-portability/ccd` (new `cmd_ws_rm`, dispatch case)
- Test: `infra/ccrc/server/test/ccd-workspaces.test.ts`

**Interfaces:**
- Consumes: `_reg_get`, `_tmux`, `$REG`, `$PROJECTS_ROOT` and the registry shape Task 3 writes.
- Produces: `ccd ws-rm <id>`. Task 6 exposes it over HTTP.

- [ ] **Step 1: Write the failing test**

```ts
describe('ws-rm', () => {
  const addOne = (): string => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    return path.join(home, 'worktrees', 'demo', 'quiet-mesa');
  };
  const RM = `_ws_unsupervise() { :; };`;

  it('removes the worktree, the branch and the registry entry', () => {
    const wt = addOne();
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`);
    expect(fs.existsSync(wt)).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    const branches = execFileSync('git',
      ['-C', path.join(home, 'projects', 'demo'), 'branch', '--list', 'quiet-mesa'],
      { encoding: 'utf8' });
    expect(branches.trim()).toBe('');
  });

  it('refuses to remove a session that is not a workspace', () => {
    sh(`_reg_set claude2-demo wrapper claude2
        _reg_set claude2-demo project demo
        _reg_set claude2-demo workdir ${path.join(home, 'projects', 'demo')}
        _reg_set claude2-demo uuid abc`);
    expect(() => sh(`${RM} cmd_ws_rm claude2-demo`)).toThrow();
    expect(reg('claude2-demo', 'uuid')).toBe('abc');
  });

  it('refuses a dirty worktree and leaves everything in place', () => {
    const wt = addOne();
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved\n');
    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(fs.existsSync(wt)).toBe(true);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('refuses an unknown id', () => {
    expect(() => sh(`${RM} cmd_ws_rm nope-nothing`)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: FAIL — `cmd_ws_rm: command not found`

- [ ] **Step 3: Write minimal implementation**

```bash
cmd_ws_rm() {   # id — tear a workspace down. Refuses anything it might destroy.
  local id="${1:?usage: ccd ws-rm <id>}"
  [[ -f "$REG/$id.uuid" ]] || die "no such session: $id"
  local ws project workdir
  ws=$(_reg_get "$id" workspace); project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir)
  # The absence of a workspace field is what distinguishes a main checkout.
  [[ -n "$ws" ]] || die "$id is not a workspace — refusing to remove a main checkout"
  [[ -n "$project" && -n "$workdir" ]] || die "incomplete registry for '$id'"
  local main="$PROJECTS_ROOT/$project"

  # Read the branch while the worktree still exists; it may have been renamed
  # since creation, so the slug is not a safe substitute.
  local branch=""
  [[ -d "$workdir" ]] && branch=$(git -C "$workdir" rev-parse --abbrev-ref HEAD 2>/dev/null)

  _ws_unsupervise "$id"
  tmux kill-session -t "$(_tmux "$id")" 2>/dev/null || true

  if [[ -d "$workdir" ]]; then
    # No --force: a dirty tree must stop this, not be bulldozed by it.
    git -C "$main" worktree remove "$workdir" \
      || die "worktree not removed (uncommitted changes?) — nothing else was touched"
  fi
  # No -D: an unmerged branch must survive.
  [[ -n "$branch" && "$branch" != HEAD ]] && git -C "$main" branch -d "$branch" 2>/dev/null \
    || true
  rm -f "$REG/$id".*
  echo "removed workspace $id"
}
```

Dispatch:

```bash
  ws-rm)   shift; cmd_ws_rm "$@" ;;
```

Note the ordering: systemd and tmux come down **before** the worktree is
touched, so nothing is writing into the directory as it is removed — but the
`die` on a dirty tree still leaves a recoverable state, because the registry
entry survives and `ccd ensure <id>` brings the session back.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run test/ccd-workspaces.test.ts`
Expected: PASS, 19 tests

Run: `bash -n infra/<server-host>-portability/ccd`

- [ ] **Step 5: Commit**

```bash
git add infra/<server-host>-portability/ccd infra/ccrc/server/test/ccd-workspaces.test.ts
git commit -m "feat(ccd): ws-rm tears down a workspace, refusing anything destructive"
```

---

### Task 5: carry `workspace` onto the wire

**Files:**
- Modify: `infra/ccrc/shared/api.ts` (`FleetSession`)
- Modify: `infra/ccrc/server/src/registry.ts` (`SessionRecord`, `readRegistry`)
- Modify: `infra/ccrc/server/src/fleet.ts:62-63`
- Test: `infra/ccrc/server/test/registry.test.ts` (extend if present, else create)

**Interfaces:**
- Consumes: the registry fields Task 3 writes.
- Produces: `FleetSession.workspace: string | null`. Tasks 7-9 read it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readRegistry } from '../src/registry.js';

describe('workspace on the wire', () => {
  it('reads the workspace field when present', async () => {
    const io = memIO({
      'demo-quiet-mesa.uuid': 'u1', 'demo-quiet-mesa.wrapper': 'claude2',
      'demo-quiet-mesa.project': 'demo', 'demo-quiet-mesa.workdir': '/w/demo/quiet-mesa',
      'demo-quiet-mesa.workspace': 'quiet-mesa',
    });
    const [rec] = await readRegistry(io, cfg);
    expect(rec.workspace).toBe('quiet-mesa');
  });

  it('leaves workspace null for a legacy main-checkout session', async () => {
    const io = memIO({
      'claude2-demo.uuid': 'u1', 'claude2-demo.wrapper': 'claude2',
      'claude2-demo.project': 'demo', 'claude2-demo.workdir': '/p/demo',
    });
    const [rec] = await readRegistry(io, cfg);
    expect(rec.workspace).toBeNull();
  });
});
```

Build `memIO`/`cfg` with the same helpers the existing server tests use for
`FleetIO`; if none exists, a minimal in-memory `FleetIO` whose `readdir`
returns the keys and whose `readFile` returns the values by basename.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/registry.test.ts`
Expected: FAIL — `Property 'workspace' does not exist on type 'SessionRecord'`

- [ ] **Step 3: Write minimal implementation**

`shared/api.ts`, in `FleetSession` after `workdir`:

```ts
  /** The worktree slug when this session is a workspace; null for a project's
   *  main checkout. Grouping and ws-rm both key off its presence. */
  workspace: string | null;
```

`server/src/registry.ts` — add to the interface:

```ts
  workspace: string | null;
```

add `'workspace'` to the destructured `Promise.all` batch, and to the pushed
object:

```ts
    const [wrapper, project, workdir, uuid, started, home, pool, lastswap, workspace] =
      await Promise.all([
        …,
        field(io, cfg.registryDir, id, 'workspace'),
      ]);
    …
    out.push({ …, workspace });
```

`server/src/fleet.ts:62-63` — add `workspace: r.workspace,` to the emitted
session object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run && npx tsc --noEmit`
Expected: PASS, 292 + 2 tests; typecheck clean

Run: `cd infra/ccrc/pwa && npx tsc --noEmit`
Expected: clean — the PWA imports `FleetSession`, and an added optional-shaped
field must not break its fixtures. **If PWA test fixtures fail to typecheck,
add `workspace: null` to them in this task**, not later.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/shared/api.ts infra/ccrc/server/src infra/ccrc/server/test infra/ccrc/pwa
git commit -m "feat(ccrc): carry workspace slug onto the fleet wire"
```

---

### Task 6: HTTP routes for workspace create and remove

**Files:**
- Modify: `infra/ccrc/server/src/server.ts` (beside `/api/sessions/:id/ensure`, line 298)
- Modify: `infra/ccrc/pwa/src/lib/api.ts` (client methods)
- Test: `infra/ccrc/server/test/workspaces-route.test.ts` (create)

**Interfaces:**
- Consumes: `runCcd(reply, args)` — the existing helper every mutating route uses; `ccd ws-add` / `ccd ws-rm` from Tasks 3-4.
- Produces: `POST /api/projects/:project/workspaces`, `DELETE /api/sessions/:id/workspace`, and `api.workspaceAdd(project)` / `api.workspaceRemove(id)`. Task 9 calls the client methods.

- [ ] **Step 1: Write the failing test**

Model this on `accounts-route.test.ts`, driving the real handler through
`buildServer(testDeps(home))` and `app.inject`:

```ts
describe('workspace routes', () => {
  it('POST /api/projects/:project/workspaces runs ccd ws-add', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({ method: 'POST', url: '/api/projects/demo/workspaces' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-add', 'demo']);
  });

  it('DELETE /api/sessions/:id/workspace runs ccd ws-rm', async () => {
    const { app, calls } = await appWithCcdSpy();
    const res = await app.inject({ method: 'DELETE', url: '/api/sessions/demo-quiet-mesa/workspace' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-rm', 'demo-quiet-mesa']);
  });

  it('passes a URL-encoded project through intact', async () => {
    const { app, calls } = await appWithCcdSpy();
    await app.inject({ method: 'POST', url: '/api/projects/expoAI-assistant/workspaces' });
    expect(calls).toContainEqual(['ws-add', 'expoAI-assistant']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/workspaces-route.test.ts`
Expected: FAIL — 404 on both routes

- [ ] **Step 3: Write minimal implementation**

In `server.ts`, immediately after the `ensure` route:

```ts
  app.post('/api/projects/:project/workspaces', async (req, reply) => {
    const { project } = req.params as { project: string };
    return runCcd(reply, ['ws-add', project]);
  });

  app.delete('/api/sessions/:id/workspace', async (req, reply) => {
    const { id } = req.params as { id: string };
    return runCcd(reply, ['ws-rm', id]);
  });
```

In `pwa/src/lib/api.ts`, alongside `ensure`:

```ts
  workspaceAdd: (project: string): Promise<unknown> =>
    post(`/api/projects/${encodeURIComponent(project)}/workspaces`),
  workspaceRemove: (id: string): Promise<unknown> =>
    del(`/api/sessions/${encodeURIComponent(id)}/workspace`),
```

Match the module's existing request helper names and error handling exactly —
read `api.ensure` first and mirror it. If no `del` helper exists, add one in the
same shape as the existing `post`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run && npx tsc --noEmit`
Run: `cd infra/ccrc/pwa && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/server infra/ccrc/pwa/src/lib/api.ts
git commit -m "feat(ccrc): HTTP routes for workspace create and remove"
```

---

### Task 7: `groupFleet()` — grouping that earns its space

**Files:**
- Create: `infra/ccrc/pwa/src/fleet/groupFleet.ts`
- Test: `infra/ccrc/pwa/test/groupFleet.test.ts`

**Interfaces:**
- Consumes: `sortFleet` (`fleet/sortFleet.ts`), `FleetSession`.
- Produces:
  ```ts
  export interface FleetGroup {
    project: string;
    sessions: FleetSession[];   // sortFleet order within the group
    grouped: boolean;           // false => render bare, exactly as today
    attention: boolean;         // any member has dialogPending
    busy: number;               // members currently working
  }
  export function groupFleet(sessions: FleetSession[]): FleetGroup[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { groupFleet } from '../src/fleet/groupFleet';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: null, name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, tasks: null, ...over,
});

describe('groupFleet', () => {
  it('leaves a one-session project ungrouped, so the screen is unchanged today', () => {
    const g = groupFleet([s({ id: 'a', project: 'alpha' })]);
    expect(g).toHaveLength(1);
    expect(g[0].grouped).toBe(false);
  });

  it('groups a project holding two or more sessions', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha' }),
      s({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].grouped).toBe(true);
    expect(g[0].sessions).toHaveLength(2);
  });

  it('orders groups by their most urgent member, not alphabetically', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'z', project: 'zeta', dialogPending: true }),
    ]);
    expect(g.map((x) => x.project)).toEqual(['zeta', 'alpha']);
  });

  it('surfaces attention on the group, so collapsing cannot hide it', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha' }),
      s({ id: 'b', project: 'alpha', dialogPending: true }),
    ]);
    expect(g[0].attention).toBe(true);
  });

  it('counts busy members for the collapsed header', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'b', project: 'alpha', status: 'busy' }),
      s({ id: 'c', project: 'alpha', status: 'idle' }),
    ]);
    expect(g[0].busy).toBe(2);
  });

  it('sorts within a group by the fleet rule', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'b', project: 'alpha', dialogPending: true }),
    ]);
    expect(g[0].sessions.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('is pure — it does not reorder its argument', () => {
    const input = [s({ id: 'a', project: 'zeta' }), s({ id: 'b', project: 'alpha' })];
    const copy = [...input];
    groupFleet(input);
    expect(input).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/groupFleet.test.ts`
Expected: FAIL — cannot resolve `../src/fleet/groupFleet`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { FleetSession } from '../../../shared/api';
import { sortFleet } from './sortFleet';

export interface FleetGroup {
  project: string;
  sessions: FleetSession[];
  /** False for a project holding one session: it renders bare, with no header
   *  and no chevron. Most projects hold one and always will; the screen must
   *  not pay for worktrees it does not have. */
  grouped: boolean;
  /** Any member is waiting on you. A collapsed header wears this, so folding a
   *  project away can never hide the one thing this screen exists to surface. */
  attention: boolean;
  busy: number;
}

/**
 * Group the fleet by project, preserving the flat list's urgency ordering:
 * groups sort by their most urgent member, members sort by the fleet rule.
 * Pure — returns new arrays.
 */
export function groupFleet(sessions: FleetSession[]): FleetGroup[] {
  const byProject = new Map<string, FleetSession[]>();
  for (const s of sortFleet(sessions)) {
    const list = byProject.get(s.project);
    if (list) list.push(s);
    else byProject.set(s.project, [s]);
  }

  // sortFleet already ordered the flat list, and Map preserves insertion
  // order — so the first session of each group IS its most urgent member, and
  // group order follows from it with no second comparator to drift.
  const groups: FleetGroup[] = [];
  for (const [project, members] of byProject) {
    groups.push({
      project,
      sessions: members,
      grouped: members.length > 1,
      attention: members.some((m) => m.status !== 'dead' && m.dialogPending),
      busy: members.filter((m) => m.status === 'busy').length,
    });
  }
  return groups;
}
```

The insertion-order property is the whole design: deriving group order from the
already-sorted flat list means there is exactly one ordering rule in the
codebase, so grouping cannot drift away from `sortFleet`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run test/groupFleet.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/groupFleet.ts infra/ccrc/pwa/test/groupFleet.test.ts
git commit -m "feat(pwa): groupFleet — group by project only when it earns the space"
```

---

### Task 8: render groups on the fleet screen

**Files:**
- Create: `infra/ccrc/pwa/src/fleet/ProjectGroup.tsx`
- Modify: `infra/ccrc/pwa/src/screens/FleetScreen.tsx:117-121`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css`
- Test: `infra/ccrc/pwa/test/project-group.test.tsx` (create), `test/fleet-screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `groupFleet`, `FleetGroup` (Task 7); `SessionCard`.
- Produces: `<ProjectGroup group onOpen selectedId onAddWorkspace />`. Task 9 supplies `onAddWorkspace`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectGroup } from '../src/fleet/ProjectGroup';

describe('ProjectGroup', () => {
  it('renders an ungrouped project as bare cards, with no header', () => {
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: /collapse|expand/i })).toBeNull();
  });

  it('renders a header with a session count when grouped', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2] })} onOpen={() => {}} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('collapses and expands', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2] })} onOpen={() => {}} />);
    const toggle = screen.getByRole('button', { name: /alpha/i });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(toggle);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('shows attention on a COLLAPSED header — folding must not hide it', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2], attention: true })}
                         onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /alpha/i }));
    expect(screen.getByLabelText(/waiting on you/i)).toBeInTheDocument();
  });
});
```

Define `s1`/`s2` with the same `s()` factory as Task 7's test, and
`g(over)` returning a `FleetGroup` with `project: 'alpha'`, `attention: false`,
`busy: 0` defaults.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/project-group.test.tsx`
Expected: FAIL — cannot resolve `../src/fleet/ProjectGroup`

- [ ] **Step 3: Write minimal implementation**

```tsx
// A project's sessions. One session renders bare — no header, no chevron, no
// indent — so the common case looks exactly as it did before workspaces
// existed. Two or more grow a header that carries the group's state even when
// collapsed: this screen's job is answering "what needs me?", and a fold must
// never be able to hide that answer.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetGroup } from './groupFleet';
import { SessionCard } from './SessionCard';
import './fleet.css';

export function ProjectGroup({
  group,
  onOpen,
  selectedId = null,
  onAddWorkspace,
}: {
  group: FleetGroup;
  onOpen: (id: string) => void;
  selectedId?: string | null;
  onAddWorkspace?: (project: string) => void;
}): ReactNode {
  const [collapsed, setCollapsed] = useState(false);

  const cards = group.sessions.map((s) => (
    <SessionCard key={s.id} session={s} onOpen={onOpen} selected={s.id === selectedId} />
  ));

  if (!group.grouped) return <>{cards}</>;

  return (
    <section className="proj-group" data-collapsed={collapsed || undefined}>
      <div className="proj-group-head">
        <button
          type="button"
          className="proj-group-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="proj-group-chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="proj-group-name">{group.project}</span>
          <span className="proj-group-count">{group.sessions.length}</span>
          {group.attention && (
            <span className="proj-group-attn" aria-label="waiting on you" role="img">
              ●
            </span>
          )}
        </button>
        {onAddWorkspace && (
          <button
            type="button"
            className="proj-group-add"
            aria-label={`New workspace on ${group.project}`}
            onClick={() => onAddWorkspace(group.project)}
          >
            <span aria-hidden="true">+</span>
          </button>
        )}
      </div>
      {!collapsed && <div className="proj-group-body">{cards}</div>}
    </section>
  );
}
```

In `FleetScreen.tsx`, replace lines 117-121:

```tsx
          <div className="fleet-list">
            {groupFleet(sessions).map((g) => (
              <ProjectGroup
                key={g.project}
                group={g}
                onOpen={open}
                selectedId={selectedId}
              />
            ))}
          </div>
```

with `import { groupFleet } from '../fleet/groupFleet';` and
`import { ProjectGroup } from '../fleet/ProjectGroup';` added, and the now-unused
`sortFleet` import removed.

In `fleet.css`, append:

```css
/* Project group — a header only when a project holds more than one session. */
.proj-group { display: flex; flex-direction: column; gap: var(--space-2); }
.proj-group-head { display: flex; align-items: center; gap: var(--space-2); }
.proj-group-toggle {
  flex: 1; display: flex; align-items: center; gap: var(--space-2);
  min-height: 44px; padding: 0 var(--space-2);
  background: none; border: 0; color: var(--ink-secondary);
  font: inherit; text-align: left; cursor: pointer;
}
.proj-group-chevron { width: 1em; color: var(--ink-tertiary); }
.proj-group-name { font-weight: 600; color: var(--ink-primary); }
.proj-group-count {
  padding: 0 var(--space-1); border-radius: var(--radius-pill);
  background: var(--bg-raised); color: var(--ink-secondary);
  font-variant-numeric: tabular-nums;
}
.proj-group-attn { color: var(--status-attention); }
.proj-group-add {
  min-width: 44px; min-height: 44px;
  background: none; border: 0; color: var(--ink-secondary);
  font-size: 1.25rem; cursor: pointer;
}
.proj-group-body { display: flex; flex-direction: column; gap: var(--space-2); }
```

Use the token names this stylesheet already uses. **Read `fleet.css` first and
substitute the real token names** — if `--status-attention`, `--radius-pill`,
`--ink-tertiary` or the `--space-*` scale differ, use what exists. Do not invent
tokens; the contrast gate enumerates them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit`
Expected: PASS, 270 + 11 tests; typecheck clean

Run: `node infra/ccrc/pwa/design/contrast-check.mjs`
Expected: ALL 78 PASS (or more, if new pairs became measurable — never fewer)

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa
git commit -m "feat(pwa): render project groups, with state that survives collapse"
```

---

### Task 9: the per-project `+`

**Files:**
- Modify: `infra/ccrc/pwa/src/screens/FleetScreen.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/ProjectGroup.tsx` (wire the prop through — already accepted in Task 8)
- Test: `infra/ccrc/pwa/test/fleet-screen.test.tsx`

**Interfaces:**
- Consumes: `api.workspaceAdd(project)` (Task 6), `onAddWorkspace` (Task 8).
- Produces: nothing downstream — this closes Phase 1.

- [ ] **Step 1: Write the failing test**

```tsx
it('creates a workspace on the tapped project', async () => {
  const calls: string[] = [];
  vi.spyOn(api, 'workspaceAdd').mockImplementation(async (p: string) => {
    calls.push(p);
    return {};
  });
  render(<FleetScreen store={storeWith([
    s({ id: 'a', project: 'alpha' }),
    s({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
  ])} />);
  fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
  await waitFor(() => expect(calls).toEqual(['alpha']));
});

it('surfaces a failure as a toast rather than a silent no-op', async () => {
  vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new Error('no origin/HEAD'));
  render(<FleetScreen store={storeWith([
    s({ id: 'a', project: 'alpha' }),
    s({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
  ])} />);
  fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
  await waitFor(() => expect(screen.getByText(/no origin\/HEAD/)).toBeInTheDocument());
});
```

Reuse `storeWith` from the existing `fleet-screen.test.tsx`; if it has a
different name there, use that one.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/fleet-screen.test.tsx`
Expected: FAIL — no button named "New workspace on alpha"

- [ ] **Step 3: Write minimal implementation**

In `FleetScreen.tsx`, add above the return:

```tsx
  const addWorkspace = async (project: string): Promise<void> => {
    try {
      await api.workspaceAdd(project);
    } catch (err) {
      toast(`Couldn't create workspace — ${apiErrorText(err)}`, 'error');
    }
  };
```

with `import { api } from '../lib/api';` and
`import { toast } from '../components/Toast';` added, and pass it through:

```tsx
              <ProjectGroup
                key={g.project}
                group={g}
                onOpen={open}
                selectedId={selectedId}
                onAddWorkspace={(p) => void addWorkspace(p)}
              />
```

The new session appears on the next fleet snapshot — the socket is the source of
truth, so nothing here optimistically inserts a row that ccd might have refused
to create.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit`
Run: `cd infra/ccrc/server && npx vitest run && npx tsc --noEmit`
Run: `cd infra/ccrc/agent && npx vitest run && npx tsc --noEmit`
Run: `node infra/ccrc/pwa/design/contrast-check.mjs`
Run: `bash -n infra/<server-host>-portability/ccd`

Expected: server ≥292+, agent 84, pwa ≥270+, three clean typechecks, ALL PASS,
no bash syntax output.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa
git commit -m "feat(pwa): per-project + creates a workspace"
```

---

### Task 10: a card inside a group must name the workspace, not the project

Without this, both cards in a two-session group are titled with the same project name (`SessionCard.tsx:169` renders `session.project`), so the group is unreadable — the exact problem grouping was supposed to solve.

**Files:**
- Modify: `infra/ccrc/pwa/src/fleet/SessionCard.tsx:155-175`
- Modify: `infra/ccrc/pwa/src/fleet/ProjectGroup.tsx` (pass the new prop)
- Test: `infra/ccrc/pwa/test/session-card.test.tsx` (extend if present, else create)

**Interfaces:**
- Consumes: `FleetSession.workspace` (Task 5), `FleetGroup.grouped` (Task 7).
- Produces: `<SessionCard … inGroup?: boolean />`.

- [ ] **Step 1: Write the failing test**

```tsx
describe('card title', () => {
  it('titles on the project when standalone, exactly as before', () => {
    render(<SessionCard session={s({ project: 'alpha' })} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'alpha' })).toBeInTheDocument();
  });

  it('titles on the workspace inside a group', () => {
    render(<SessionCard session={s({ project: 'alpha', workspace: 'quiet-mesa' })}
                        onOpen={() => {}} inGroup />);
    expect(screen.getByRole('button', { name: 'quiet-mesa' })).toBeInTheDocument();
  });

  it('prefers the live display name over the slug', () => {
    render(<SessionCard session={s({ project: 'alpha', workspace: 'quiet-mesa',
                                     name: 'fix the C-u under-press' })}
                        onOpen={() => {}} inGroup />);
    expect(screen.getByRole('button', { name: 'fix the C-u under-press' })).toBeInTheDocument();
  });

  it('falls back to the branch, then to main for a grouped main checkout', () => {
    render(<SessionCard session={s({ project: 'alpha', branch: 'ccrc/thing' })}
                        onOpen={() => {}} inGroup />);
    expect(screen.getByRole('button', { name: 'ccrc/thing' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-card.test.tsx`
Expected: FAIL — the grouped cases all render "alpha"

- [ ] **Step 3: Write minimal implementation**

In `SessionCard.tsx`, add `inGroup = false` to the props (typed `inGroup?: boolean`,
documented as "inside a project group — the header already says the project, so
the card names the workspace instead"), and above the return:

```tsx
  // Standalone, the project IS the identity. Inside a group the header already
  // carries the project, so repeating it renders every sibling identical.
  const title = inGroup
    ? (session.name ?? session.workspace ?? session.branch ?? session.id)
    : session.project;
```

Replace `{session.project}` on line 169 with `{title}`.

In `ProjectGroup.tsx`, pass `inGroup={group.grouped}` to every `SessionCard`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit`
Expected: PASS; the existing card tests still assert the standalone behaviour

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa
git commit -m "feat(pwa): a grouped card names its workspace, not its project"
```

---

### Task 11: remove a workspace from the PWA

Phase 1 without this is a trap: you could create workspaces from your phone and only delete them by SSH-ing to the box.

**Files:**
- Modify: `infra/ccrc/pwa/src/fleet/SessionCard.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css`
- Test: `infra/ccrc/pwa/test/session-card.test.tsx`

**Interfaces:**
- Consumes: `api.workspaceRemove(id)` (Task 6), `FleetSession.workspace` (Task 5).
- Produces: nothing downstream — this closes Phase 1.

- [ ] **Step 1: Write the failing test**

```tsx
describe('remove workspace', () => {
  it('is absent on a main checkout — it can never be removed', () => {
    render(<SessionCard session={s({ workspace: null })} onOpen={() => {}} inGroup />);
    expect(screen.queryByRole('button', { name: /remove workspace/i })).toBeNull();
  });

  it('calls the API for a workspace', async () => {
    const spy = vi.spyOn(api, 'workspaceRemove').mockResolvedValue({});
    render(<SessionCard session={s({ id: 'alpha-quiet-mesa', workspace: 'quiet-mesa' })}
                        onOpen={() => {}} inGroup />);
    fireEvent.click(screen.getByRole('button', { name: /remove workspace/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('alpha-quiet-mesa'));
  });

  it("surfaces ccd's refusal instead of pretending it worked", async () => {
    vi.spyOn(api, 'workspaceRemove')
      .mockRejectedValue(new Error('worktree not removed (uncommitted changes?)'));
    render(<SessionCard session={s({ id: 'alpha-quiet-mesa', workspace: 'quiet-mesa' })}
                        onOpen={() => {}} inGroup />);
    fireEvent.click(screen.getByRole('button', { name: /remove workspace/i }));
    await waitFor(() =>
      expect(screen.getByText(/uncommitted changes/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-card.test.tsx`
Expected: FAIL — no button named "Remove workspace"

- [ ] **Step 3: Write minimal implementation**

In `SessionCard.tsx`, beside the existing `restart` handler:

```tsx
  const [removing, setRemoving] = useState(false);
  const removeWorkspace = async (): Promise<void> => {
    if (removing) return;
    setRemoving(true);
    try {
      await api.workspaceRemove(session.id);
    } catch (err) {
      toast(`Couldn't remove — ${apiErrorText(err)}`, 'error');
    } finally {
      setRemoving(false);
    }
  };
```

and, rendered after the tasks block:

```tsx
      {/* No confirm dialog: ccd ws-rm refuses on a dirty tree or an unmerged
          branch and says why, so the guard lives where the facts are rather
          than in a prompt the user learns to dismiss. */}
      {session.workspace !== null && (
        <button
          type="button"
          className="btn-ghost card-remove"
          aria-label="Remove workspace"
          onClick={() => void removeWorkspace()}
          disabled={removing}
        >
          {removing ? 'Removing…' : 'Remove workspace'}
        </button>
      )}
```

Add to `fleet.css`:

```css
.card-remove { align-self: flex-start; color: var(--ink-secondary); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit`
Run: `node infra/ccrc/pwa/design/contrast-check.mjs`
Expected: PASS; ALL PASS

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa
git commit -m "feat(pwa): remove a workspace from the card, with ccd's refusal surfaced"
```

---

## Manual verification before merge

Automated tests never exercise a real worktree against a real remote. Before
finishing the branch, on openclaw:

1. `ccd ws-add OpenClawHetzner` — expect a new worktree under
   `~/worktrees/OpenClawHetzner/<slug>`, a session in `ccd ls`, and a `home`
   field naming the least-loaded account.
2. Confirm `.ccrc/` is in `.git/info/exclude` and that `git status` in the
   worktree is clean.
3. Open the PWA: `OpenClawHetzner` now holds two sessions and renders a group
   header with a count of 2; every other project still renders bare.
4. Collapse the group. Trigger a dialog in the workspace session and confirm the
   collapsed header shows the attention dot.
5. Confirm the two cards in the group are distinguishable — the main checkout
   and the workspace must not both read `OpenClawHetzner`.
6. Tap **Remove workspace** in the PWA — worktree gone, branch gone, row gone.
7. Recreate one, drop a stray file in the worktree, and tap Remove again:
   expect a toast quoting ccd's refusal, with the worktree still present.
8. Repeat step 7 from the shell (`ccd ws-rm OpenClawHetzner-<slug>`) to confirm
   the refusal is ccd's, not the PWA's.

## Out of scope for Phase 1

PR state, badges, draft prompts, merge and archive — all Phase 2 and 3. Nothing
in this plan calls `gh`.
