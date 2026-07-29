// ccd owns worktree lifecycle beside the tmux and systemd lifecycle it already
// owns. These tests source ccd under an isolated HOME, exactly as
// ccd-limits.test.ts does, so nothing here can touch the real registry.
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

describe('test isolation', () => {
  // The harness overrides HOME and nothing else, so HOME is the ONLY isolation
  // boundary there is (plan: "Never write to the real ~/.cc-sessions from a
  // test... all registry paths derive from it"). An inherited PROJECTS_ROOT or
  // WORKTREES_ROOT would point cmd_ws_rm's `git worktree remove` and
  // `git branch -d` at REAL repositories from a unit test. REG and WRAPPER_DIR
  // already take no override; these two must not either.
  it('derives the project and worktree roots from HOME alone', () => {
    const out = sh('echo "$PROJECTS_ROOT"; echo "$WORKTREES_ROOT"',
      { PROJECTS_ROOT: '/data/projects', WORKTREES_ROOT: '/data/worktrees' });
    expect(out.split('\n')).toEqual([
      path.join(home, 'projects'),
      path.join(home, 'worktrees'),
    ]);
  });
});

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

  it('rejects an invalid CCD_WS_SLUG rather than passing it through', () => {
    expect(sh(`CCD_WS_SLUG=quiet.mesa _ws_slug_new demo || echo REJECTED`)).toBe('REJECTED');
    expect(sh(`CCD_WS_SLUG=feat/thing _ws_slug_new demo || echo REJECTED`)).toBe('REJECTED');
  });
});

describe('ws-add', () => {
  it('creates a worktree on a new branch off origin/HEAD', () => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    const wt = path.join(home, 'worktrees', 'demo', 'quiet-mesa');
    expect(fs.existsSync(path.join(wt, 'README.md'))).toBe(true);
    const branch = execFileSync('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8' }).trim();
    expect(branch).toBe('ws/quiet-mesa');
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
    // wrapper and uuid are what _spawn's own guard demands
    // (`[[ -n "$wrapper" && -n "$workdir" && -n "$uuid" ]] || die ...`, ccd:497-503).
    // _spawn is stubbed to a no-op under every ws-add test, so that guard never
    // runs here — these two assertions are what would catch a dropped
    // `_reg_set` for either field instead of a silent, worktree-already-created
    // "incomplete registry" death in production. No .cc-limits fixtures exist
    // in this test's HOME, so _ws_least_loaded is deterministic: every wrapper
    // scores 0 and the first of VALID_WRAPPERS (claude) wins.
    expect(reg('demo-quiet-mesa', 'wrapper')).toBe('claude');
    expect(reg('demo-quiet-mesa', 'uuid')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
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

describe('_ws_least_loaded', () => {
  it('picks the account with the most headroom, not VALID_WRAPPERS[0]', () => {
    // Same fixture shape _limit_score reads, per ccd-limits.test.ts: {"five":N,"seven":N,"ts":epoch}.
    // claude (first in VALID_WRAPPERS) is made the WORST choice on purpose, so a selector
    // that just returned the first wrapper (ignoring load) would fail this assertion.
    const t = Math.floor(Date.now() / 1000);
    const writeLimits = (wrapper: string, five: number, seven: number): void =>
      fs.writeFileSync(path.join(home, '.cc-limits', `${wrapper}.json`),
        JSON.stringify({ five, seven, ts: t }));
    writeLimits('claude', 80, 40);       // score 80 — worst
    writeLimits('claude2', 5, 3);        // score 5 — cheapest
    writeLimits('claude-corp', 90, 95);  // score 95 — worst of all
    expect(sh('_ws_least_loaded')).toBe('claude2');
  });
});

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

describe('cmd_stop', () => {
  // `ccd stop <wrapper> <project>` recomputes `<wrapper>-<project>`. A workspace
  // id is `<project>-<slug>` and does not reverse into a wrapper, so any caller
  // forced to guess one aims the stop at a DIFFERENT live session. The one-arg
  // form takes the id whole, exactly as `ccd ensure` already does.
  const STOP = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; `
    + `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };`;

  it('takes a workspace id whole rather than reversing it into a wrapper', () => {
    expect(sh(`${STOP} cmd_stop rp-llm-quiet-mesa`)).toBe('stopped rp-llm-quiet-mesa');
    expect(calls()).toEqual([
      'systemctl --user disable --now claude-session@rp-llm-quiet-mesa',
      'tmux kill-session -t cc-rp-llm-quiet-mesa',
    ]);
  });

  it('still recomputes <wrapper>-<project> for the legacy two-argument form', () => {
    expect(sh(`${STOP} cmd_stop claude2 demo`)).toBe('stopped claude2-demo');
    expect(calls()).toEqual([
      'systemctl --user disable --now claude-session@claude2-demo',
      'tmux kill-session -t cc-claude2-demo',
    ]);
  });
});

describe('ws-rm', () => {
  const addOne = (): string => {
    makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    return path.join(home, 'worktrees', 'demo', 'quiet-mesa');
  };
  // Both teardown calls are shadowed AND recorded. `tmux kill-session -t` is
  // the dangerous one: unstubbed it runs against the real host tmux server,
  // where nine live cc-* sessions are, and `-t` does PREFIX and FNMATCH
  // matching — so "no test id exactly equals a real session name" is not the
  // guarantee this needs. Recording (rather than swallowing) also lets the
  // dirty-tree test below prove neither call ran at all.
  const RM = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; }; `
    + `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };`;

  const main = (): string => path.join(home, 'projects', 'demo');
  const branches = (glob: string): string =>
    execFileSync('git', ['-C', main(), 'branch', '--list', glob], { encoding: 'utf8' }).trim();
  const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, HOME: home,
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' });

  it('removes the worktree, the branch and the registry entry', () => {
    const wt = addOne();
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`);
    expect(fs.existsSync(wt)).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    const branches = execFileSync('git',
      ['-C', path.join(home, 'projects', 'demo'), 'branch', '--list', 'ws/quiet-mesa'],
      { encoding: 'utf8' });
    expect(branches.trim()).toBe('');
    // The kill went to the stub — i.e. it was intercepted, not merely aimed at
    // a name no live session happens to use.
    expect(calls()).toEqual([
      'unsupervise demo-quiet-mesa',
      'tmux kill-session -t cc-demo-quiet-mesa',
    ]);
  });

  // FINDING 4: ws-rm reads the branch off HEAD live, at removal time — not off
  // the slug it was created with. A regression that hardcoded `ws/$slug` would
  // stay green against every other test in this file, since none of them ever
  // rename first.
  it('removes the RENAMED branch after ws-rename, leaving no ws/<slug> branch behind', () => {
    const wt = addOne();
    sh(`cmd_ws_rename demo-quiet-mesa feat/renamed`);
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`);
    expect(fs.existsSync(wt)).toBe(false);
    const main = path.join(home, 'projects', 'demo');
    const renamed = execFileSync('git',
      ['-C', main, 'branch', '--list', 'feat/renamed'], { encoding: 'utf8' });
    expect(renamed.trim()).toBe('');
    const slugBranch = execFileSync('git',
      ['-C', main, 'branch', '--list', 'ws/quiet-mesa'], { encoding: 'utf8' });
    expect(slugBranch.trim()).toBe('');
  });

  it('refuses to remove a session that is not a workspace', () => {
    sh(`_reg_set claude2-demo wrapper claude2
        _reg_set claude2-demo project demo
        _reg_set claude2-demo workdir ${path.join(home, 'projects', 'demo')}
        _reg_set claude2-demo uuid abc`);
    expect(() => sh(`${RM} cmd_ws_rm claude2-demo`)).toThrow();
    expect(reg('claude2-demo', 'uuid')).toBe('abc');
  });

  it('refuses a dirty worktree BEFORE it tears anything down', () => {
    const wt = addOne();
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved\n');
    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(fs.existsSync(wt)).toBe(true);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    const branches = execFileSync('git',
      ['-C', path.join(home, 'projects', 'demo'), 'branch', '--list', 'ws/quiet-mesa'],
      { encoding: 'utf8' });
    expect(branches.trim()).not.toBe('');
    // The refusal says "nothing was touched", so that has to be true. Killing
    // the tmux session and disabling the unit first leaves the uncommitted
    // files intact but the session dead and out of supervision — the worst of
    // both: the user loses the session AND still has to clean up by hand.
    expect(calls()).toEqual([]);
  });

  it('refuses an untracked-only worktree — porcelain counts untracked files', () => {
    // `git worktree remove` refuses these too, so the pre-check has to agree
    // with it; a `diff --quiet`-style check would sail past and tear the
    // session down before git said no.
    const wt = addOne();
    fs.writeFileSync(path.join(wt, 'notes.md'), 'draft\n');
    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(fs.existsSync(path.join(wt, 'notes.md'))).toBe(true);
    expect(calls()).toEqual([]);
  });

  it('refuses an unknown id', () => {
    expect(() => sh(`${RM} cmd_ws_rm nope-nothing`)).toThrow();
  });

  it('keeps an unmerged branch and its commit after removing a clean, ahead-of-base workspace', () => {
    const wt = addOne();
    const gitEnv = { ...process.env, HOME: home, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x',
                      GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' };
    // A real commit on the branch, ahead of base, with a CLEAN working tree —
    // this must exercise `git branch -d`'s refusal-on-unmerged-work, not the
    // separate dirty-worktree protection above.
    fs.writeFileSync(path.join(wt, 'unmerged.txt'), 'ahead\n');
    execFileSync('git', ['-C', wt, 'add', 'unmerged.txt'], { encoding: 'utf8', env: gitEnv });
    execFileSync('git', ['-C', wt, 'commit', '-m', 'ahead of base'], { encoding: 'utf8', env: gitEnv });
    const sha = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    sh(`${RM} cmd_ws_rm demo-quiet-mesa`);
    expect(fs.existsSync(wt)).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();

    const main = path.join(home, 'projects', 'demo');
    const branches = execFileSync('git', ['-C', main, 'branch', '--list', 'ws/quiet-mesa'], { encoding: 'utf8' });
    expect(branches.trim()).not.toBe('');
    const containing = execFileSync('git', ['-C', main, 'branch', '--contains', sha], { encoding: 'utf8' });
    expect(containing).toContain('quiet-mesa');
  });

  // THE BUG. A hand-deleted directory left the branch with no worktree, no
  // registry entry and no ws-gc row — invisible forever. git still holds the
  // record (marked `prunable`), which is both where the name comes from and
  // what blocks `branch -d` until `worktree remove` clears it.
  it('deletes the branch when the worktree directory was removed by hand', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(execFileSync('git', ['-C', main(), 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8' })).not.toContain('quiet-mesa');
  });

  // Not "delete more": an unmerged branch still survives on that path — and now
  // says so, instead of being kept in silence by `2>/dev/null || true`.
  it('keeps an unmerged branch when the directory is gone, and says it kept it', () => {
    const wt = addOne();
    fs.writeFileSync(path.join(wt, 'x.txt'), 'ahead\n');
    execFileSync('git', ['-C', wt, 'add', 'x.txt'], { env: gitEnv() });
    execFileSync('git', ['-C', wt, 'commit', '-m', 'ahead of base'], { env: gitEnv() });
    const sha = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    fs.rmSync(wt, { recursive: true, force: true });

    const out = sh(`${RM} cmd_ws_rm demo-quiet-mesa 2>&1`);
    expect(out).toContain('kept branch ws/quiet-mesa');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(execFileSync('git', ['-C', main(), 'branch', '--contains', sha],
      { encoding: 'utf8' })).toContain('quiet-mesa');
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  // The wrong-branch test. A hand `git branch -m` bypasses ws-rename, so the
  // registry keeps the OLD name — and a decoy under that old name is merged,
  // i.e. `branch -d` would happily take it. Git's record wins; the decoy lives.
  // This is what fails loudly if anyone "simplifies" the fix to "use the
  // registry field".
  it('trusts git over the registry when they disagree, and touches nothing else', () => {
    const wt = addOne();
    execFileSync('git', ['-C', wt, 'branch', '-m', 'feat/handmade'], { env: gitEnv() });
    execFileSync('git', ['-C', main(), 'branch', 'ws/quiet-mesa', 'main'], { env: gitEnv() });
    fs.rmSync(wt, { recursive: true, force: true });

    const out = sh(`${RM} cmd_ws_rm demo-quiet-mesa 2>&1`);
    expect(branches('feat/handmade')).toBe('');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(out).toContain("registry recorded 'ws/quiet-mesa'");
  });

  // Rung 3: no worktree record at all. Deleting the wrong branch costs more
  // than leaving the right one, so ws-rm finishes the teardown and hands over
  // the command instead of guessing from an uncorroborated registry field.
  it('will not delete an uncorroborated branch, and names the command instead', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    execFileSync('git', ['-C', main(), 'worktree', 'prune']);
    const out = sh(`${RM} cmd_ws_rm demo-quiet-mesa 2>&1`);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(out).toContain('branch -d ws/quiet-mesa');
  });

  // REFUSE FIRST. Previously this killed the session and the unit, then died on
  // `worktree remove` — the worst of both.
  it('refuses a directory that is not a worktree of the project, before any teardown', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    execFileSync('git', ['-C', main(), 'worktree', 'prune']);
    fs.mkdirSync(wt, { recursive: true });
    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(fs.existsSync(wt)).toBe(true);
    expect(calls()).toEqual([]);
  });

  // The test above hand-picks the one variant of "not our worktree" that the
  // record cannot lie about: it prunes first, so `registered` is 1. Without the
  // prune the record is STALE — git still claims this path, so `registered` is
  // 0 and a guard that only reads the record waves the teardown through and
  // dies on `worktree remove` afterwards. The directory has to be asked which
  // repository it belongs to.
  const recreateWithStaleRecord = (): string => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });   // NO `worktree prune`
    return wt;
  };
  const staleRecordStands = (wt: string): void => {
    expect(execFileSync('git', ['-C', main(), 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8' })).toContain(wt);
  };

  it('refuses a stale record whose directory came back as its own repository', () => {
    const wt = recreateWithStaleRecord();
    staleRecordStands(wt);
    execFileSync('git', ['init', '-b', 'main', wt], { env: gitEnv() });
    // COMMITTED, so `git status --porcelain` in there is clean: the dirty guard
    // must not be what saves this: it is not the reason ccd should refuse, and
    // it does not fire for the empty repo two tests below.
    fs.writeFileSync(path.join(wt, 'PRECIOUS'), 'not ccd’s to remove\n');
    execFileSync('git', ['-C', wt, 'add', 'PRECIOUS'], { env: gitEnv() });
    execFileSync('git', ['-C', wt, 'commit', '-m', 'someone else lives here'], { env: gitEnv() });

    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(calls()).toEqual([]);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(fs.existsSync(path.join(wt, 'PRECIOUS'))).toBe(true);
    expect(branches('ws/quiet-mesa')).not.toBe('');
  });

  it('refuses a stale record whose directory came back as ANOTHER repo’s worktree', () => {
    const wt = recreateWithStaleRecord();
    makeRepo('other');
    execFileSync('git', ['-C', path.join(home, 'projects', 'other'),
      'worktree', 'add', '-b', 'ws/borrowed', wt], { env: gitEnv() });

    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(calls()).toEqual([]);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(fs.existsSync(wt)).toBe(true);
    expect(execFileSync('git', ['-C', path.join(home, 'projects', 'other'),
      'branch', '--list', 'ws/borrowed'], { encoding: 'utf8' }).trim()).not.toBe('');
  });

  // A refusal that kills first is not merely wrong once: every re-run kills
  // again. This is what "nothing was touched" has to mean on attempt two.
  it('kills nothing on a re-run of a refused removal', () => {
    const wt = recreateWithStaleRecord();
    execFileSync('git', ['init', '-b', 'main', wt], { env: gitEnv() });
    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(calls()).toEqual([]);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('deletes no branch for a detached HEAD, and still clears the record', () => {
    const wt = addOne();
    execFileSync('git', ['-C', wt, 'checkout', '--detach'], { env: gitEnv() });
    fs.rmSync(wt, { recursive: true, force: true });
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(execFileSync('git', ['-C', main(), 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8' })).not.toContain('quiet-mesa');
  });

  // ...and saying "no branch to delete" is not the whole truth: the registry
  // named one, it still exists, and after this teardown it has no worktree, no
  // registration and no registry entry — invisible, which is the state this
  // whole change exists to prevent. Same rung-3 rule as the uncorroborated
  // case: name it, hand over the command, delete nothing.
  it('names the registry branch a detached HEAD would otherwise orphan', () => {
    const wt = addOne();
    execFileSync('git', ['-C', wt, 'checkout', '--detach'], { env: gitEnv() });
    fs.rmSync(wt, { recursive: true, force: true });
    const out = sh(`${RM} cmd_ws_rm demo-quiet-mesa 2>&1`);
    expect(out).toContain('detached HEAD');
    expect(out).toContain('ws/quiet-mesa');
    expect(out).toContain(`branch -d ws/quiet-mesa`);
    expect(branches('ws/quiet-mesa')).not.toBe('');
  });
});
