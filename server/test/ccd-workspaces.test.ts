// ccd owns worktree lifecycle beside the tmux and systemd lifecycle it already
// owns. These tests source ccd under an isolated HOME, exactly as
// ccd-limits.test.ts does, so nothing here can touch the real registry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, ghContainedEnv, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

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

// Round-3 verification P1. `_reg_purge` removes `.archived` and `.reaping` LAST
// (round-2 P4, so `reaping` can never outlive `archived`), which makes both of
// them outlive `.uuid` BY CONSTRUCTION. `_ws_slug_free` used to ask only about
// `.uuid`, so a SIGKILL or an OOM in that window freed the slug while leaving
// the state markers, and the next workspace to draw the slug inherited them:
// `ws-archive` answering `already archived` at exit 0, the reap archived gate
// passing on a workspace nobody archived, and — with `.reaping` — the reap
// resume fork, which does not check the token and does not re-run the merged-PR
// proof. The property is not "the two markers are noticed": it is that a
// PARTIALLY-PURGED ID IS NEVER REUSED AS A CLEAN ONE, wherever the interruption
// landed. So the residue is constructed directly, at every interruption point
// the purge has.
describe('a partially purged registry never frees the slug', () => {
  // Every field `_reg_set`/`_reg_get` names in ccd today. The purge's own
  // comment keeps this list; it is repeated here so the fixture is a full
  // registry entry rather than a plausible subset.
  const FIELDS = ['archived', 'archivedreason', 'archivemanifest', 'base', 'branch',
    'home', 'hookstate.json', 'lastcompact', 'lastswap', 'pool', 'prnumber', 'project',
    'reaping', 'setup', 'started', 'uuid', 'workdir', 'workspace', 'wrapper'];

  const seedFullEntry = (): string => {
    const regdir = path.join(home, '.cc-sessions');
    for (const f of fs.readdirSync(regdir)) {
      fs.rmSync(path.join(regdir, f), { recursive: true, force: true });
    }
    for (const f of FIELDS) fs.writeFileSync(path.join(regdir, `demo-quiet-mesa.${f}`), 'x\n');
    return regdir;
  };

  it('holds at EVERY interruption point of _reg_purge, not just the disclosed one', () => {
    // A SIGKILL is modelled where it actually bites: the unlink. `rm` is
    // shadowed by a function with a budget, so run k performs the first k
    // unlinks of the purge and no more — which is exactly the on-disk residue a
    // kill after k unlinks leaves. k runs past the purge's last unlink so the
    // terminal state (nothing left, slug genuinely free) is covered too, and
    // the assertion is keyed off the MEASURED residue rather than off a
    // hardcoded expectation of which field goes when.
    const verdicts: string[] = [];
    for (let k = 0; k <= FIELDS.length + 2; k++) {
      seedFullEntry();
      const out = sh(
        `rm() { if (( RMBUDGET-- > 0 )); then command rm "$@"; fi; }
         RMBUDGET=${k}
         _reg_purge demo-quiet-mesa
         unset -f rm
         _ws_slug_free demo quiet-mesa && echo FREE || echo TAKEN
         _ws_slug_residue demo quiet-mesa`);
      const [verdict, residue] = [out.split('\n')[0], out.split('\n').slice(1).join('\n')];
      verdicts.push(`${k}:${verdict}`);
      if (residue === '') {
        expect(verdict, `k=${k}: the registry is empty, so the slug IS free`).toBe('FREE');
      } else {
        expect(verdict, `k=${k}: registry still holds {${residue}}`).toBe('TAKEN');
      }
    }
    // The enumeration only means something if it reached both ends: at least
    // one interruption that left residue, and the completed purge.
    expect(verdicts.filter((v) => v.endsWith('TAKEN')).length,
      'the budget never actually interrupted anything').toBeGreaterThan(0);
    expect(verdicts[verdicts.length - 1],
      'the purge never ran to completion, so FREE was never proved reachable')
      .toBe(`${FIELDS.length + 2}:FREE`);
  });

  it('refuses ws-add on the residue the purge is documented to leave', () => {
    // The one-field residue fix3-ccd.md disclosed and called harmless: an empty
    // `<id>.archived` and nothing else. Pre-fix ws-add built a workspace on it.
    makeRepo('demo');
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-mesa.archived'), '');

    // The operator path: `ccd ws-add <project> <slug>`, i.e. the slug given
    // positionally, which is the arm that reports WHY it refused.
    const out = sh(`${WS_ADD} ( cmd_ws_add demo quiet-mesa ) 2>&1 || echo REFUSED`);

    expect(out, 'the refusal happened').toContain('REFUSED');
    expect(out, 'and it names the files holding the slug, which is the reclaim step')
      .toContain('slug in use: quiet-mesa');
    expect(out).toContain('demo-quiet-mesa.{archived}');
    // Nothing was created: no worktree, no branch, no registry entry.
    expect(fs.existsSync(path.join(home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid'), 'no new session inherited the marker').toBeNull();
    expect(sh(`git -C "$HOME/projects/demo" branch --format='%(refname:short)'`))
      .not.toContain('ws/quiet-mesa');
  });

  it('keeps the generator off a residue slug as well as the explicit one', () => {
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-mesa.reaping'), 'clips\n');
    expect(sh(`CCD_WS_SLUG=quiet-mesa _ws_slug_new demo || echo EXHAUSTED`)).toBe('EXHAUSTED');
  });

  it('does not let ANOTHER session id wedge this slug', () => {
    // `_reg_purge`'s hazard in the mirror: `demo-quiet-mesa.x-y.uuid` is the id
    // `demo-quiet-mesa.x-y` (project `demo-quiet-mesa.x`, slug `y`) — legal,
    // because project DIRECTORY names may hold dots. A prefix match would read
    // it as a field of `demo-quiet-mesa` and refuse slug `quiet-mesa` in
    // project `demo` for ever. The two-dot skip is what stops that.
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-mesa.x-y.uuid'), 'x');
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-mesa.x-y.archived'), '');
    expect(sh(`_ws_slug_free demo quiet-mesa && echo FREE || echo TAKEN`)).toBe('FREE');
    expect(sh(`_ws_slug_residue demo quiet-mesa`)).toBe('');
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

  const excludeOf = (repo: string): string => {
    const p = path.join(repo, '.git', 'info', 'exclude');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };

  it('excludes .ccrc/ so a draft file can never be committed', () => {
    const main = makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(excludeOf(main)).toContain('.ccrc/');
  });

  // ...and the environment does not get to redirect that write. The test above
  // pins the normal path and can only ever pass, because it never runs under a
  // hostile environment: the line it is the control for could be reverted and it
  // would stay green. `$common` is resolved from `--git-common-dir`, which
  // answers with a bare `.git` here (this IS the repo's own checkout), and ccd
  // then WRITES through it — so the two ways a captured `cd` can prepend its own
  // print to that path are the two ways this line silently stops ignoring
  // `.ccrc/` in every worktree of the repo. Both shapes below are red if the
  // resolution goes back to `$(cd "$main" && cd -- "$(git rev-parse
  // --git-common-dir)" && pwd -P)`; the second is red for the `CDPATH=`-prefixed
  // version too, which is why the line asks git instead.
  it('writes the exclude to the project itself when the environment shadows cd', () => {
    // Shape 1: a real repository on CDPATH, so bash's own `cd .git` lands there
    // and prints it. Measured on the unhardened line: `$common` comes back TWO
    // lines, so `mkdir -p` creates a junk directory whose name ends in a newline
    // and `.ccrc/` is written inside that — neither repo's exclude gets the line.
    const decoy = path.join(home, 'cdp');
    execFileSync('git', ['init', '-b', 'main', decoy]);
    const main = makeRepo('demo');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`, { CDPATH: decoy });
    expect(excludeOf(main)).toContain('.ccrc/');
    expect(excludeOf(decoy)).not.toContain('.ccrc/');

    // Shape 2: `cd` itself replaced by an exported shell function that echoes.
    // No assignment on the `cd` line can stop this one — the function is not
    // bash's cd. Second project so the `grep -qxF` short-circuit above cannot
    // make this half pass for free.
    const two = makeRepo('two');
    sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add two`,
      { 'BASH_FUNC_cd%%': '() { builtin cd "$@" && echo "[cd hook] now in $PWD"; }' });
    expect(excludeOf(two)).toContain('.ccrc/');
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

// R-3, wave review: `_reg_purge` unlinks `"$REG/$id".*` for every dot-free
// suffix, and ids are `<project>-<slug>`. Project validation
// (`^[A-Za-z0-9._-]+$`) permits a LEADING DOT, so a project named
// `.prstate-demo` with slug `quiet-basin` mints the id
// `.prstate-demo-quiet-basin` — whose purge glob matches
// `$REG/.prstate-demo-quiet-basin.lock`, the pr-state lock of the UNRELATED
// session `demo-quiet-basin`. Unlinking a lock while another process holds it
// is exactly how two processes come to hold "the lock" on two different
// inodes — the double compare-and-set this branch's lock migration closed.
// A dot-leading project thereby aliases every `$REG/.<name>.<dot-free-suffix>`
// file ccd owns: `.prstate-<id>.lock` (new this wave), `.reap-<id>.lock`,
// `.ws-add-<project>.lock`, and `.tmux-server.lock` (the last three pre-date
// this wave); only the creation sites are fixed here.
describe('a leading-dot project cannot alias ccd\'s own hidden registry files', () => {
  const shFail = (snippet: string): { code: number; stdout: string; stderr: string } => {
    try { return { code: 0, stdout: sh(snippet), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  it('cmd_ws_add refuses a project with a leading dot, and creates no registry row', () => {
    makeRepo('.prstate-demo');
    const r = shFail(`${WS_ADD} cmd_ws_add .prstate-demo quiet-basin`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('invalid project');
    expect(r.stderr).toContain('.prstate-demo');
    // The aliasing consequence, prevented at the root: no row for the
    // dot-leading id exists to alias anything with.
    expect(reg('.prstate-demo-quiet-basin', 'uuid')).toBeNull();
    expect(fs.existsSync(path.join(home, '.cc-sessions', '.prstate-demo-quiet-basin.uuid'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'worktrees', '.prstate-demo', 'quiet-basin'))).toBe(false);
  });

  it('cmd_start refuses the same project shape, and creates no registry row', () => {
    makeRepo('.prstate-demo');
    const r = shFail(`${WS_ADD} cmd_start claude .prstate-demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('invalid project');
    expect(r.stderr).toContain('.prstate-demo');
    expect(reg('claude-.prstate-demo', 'uuid')).toBeNull();
  });

  it('pins the mechanism directly: _reg_purge on a dot-leading id WOULD unlink an unrelated session\'s pr-state lock', () => {
    // Demonstration, not a regression: this is the reason the guard above
    // exists, written down as an executable fact rather than left to the
    // comment alone. `demo-quiet-basin` is an ordinary, unrelated session;
    // its pr-state lock is `$REG/.prstate-demo-quiet-basin.lock`. A session
    // with id `.prstate-demo-quiet-basin` (project `.prstate-demo`, slug
    // `quiet-basin`) purges to the exact same glob.
    //
    // This test calls `_reg_purge` ALONE, bypassing `_ws_project_valid`
    // entirely, so it deliberately CANNOT go red when the dot line in
    // `_ws_project_valid` is deleted — it asserts the dangerous unlink still
    // happens for an id that passes the guard, which is exactly the fact the
    // guard exists to keep unreachable. Only a future hardening of
    // `_reg_purge` ITSELF would turn this test red, and that failure must be
    // read as that hardening working, not as a regression.
    const lockPath = path.join(home, '.cc-sessions', '.prstate-demo-quiet-basin.lock');
    fs.writeFileSync(lockPath, '');
    expect(fs.existsSync(lockPath), 'the fixture lock must exist before the purge').toBe(true);
    sh(`_reg_purge .prstate-demo-quiet-basin`);
    expect(fs.existsSync(lockPath),
      '_reg_purge on the aliasing id unlinked the UNRELATED session\'s pr-state lock')
      .toBe(false);
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
    writeLimits('claude-dev0', 70, 70);  // score 70 — priced, so it cannot win by silence
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
        { encoding: 'utf8',
          env: ghContainedEnv(home, { ...process.env, HOME: home, CCD_DISK_FLOOR_GB: '999999' },
            { systemd: true, tmux: true }) });
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

describe('ws-add propagates a failed spawn', () => {
  // The plan-level gap Task 4's reviewer found: cmd_ws_add discarded _spawn's
  // rc entirely, so a stubbed vanished-session spawn (rc 3) still printed the
  // success line — `workspace demo-quiet-mesa on claude — …` — over a session
  // that never came up. M6's silent success, surviving on the workspace path.
  const shFail = (snippet: string): { code: number; stdout: string; stderr: string } => {
    try { return { code: 0, stdout: sh(snippet), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };
  const WS_ADD_SPAWN_FAIL = (rc: number): string =>
    `_spawn() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; return ${rc}; };`
    + ` _spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; SPAWN_FROMSWAP=0; };`
    + ` _spawn_settle() { echo "spawn_settle $1" >> "$HOME/ccd-calls"; return ${rc}; };`
    + ` _ws_supervise() { :; }; tmux() { :; };`;

  it('refuses the success line and returns the rc on a vanished-session spawn (rc 3)', () => {
    makeRepo('demo');
    const r = shFail(`${WS_ADD_SPAWN_FAIL(3)} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).toBe(3);
    expect(r.stdout).not.toMatch(/^workspace /);
    // The worktree and registry row are KEPT — a failed spawn is a row worth
    // retrying (the unit is still enabled), not a reason to unwind what
    // ws-add already created.
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('does the same on rc 4 (startup window expired)', () => {
    makeRepo('demo');
    const r = shFail(`${WS_ADD_SPAWN_FAIL(4)} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).toBe(4);
    expect(r.stdout).not.toMatch(/^workspace /);
  });

  it('still prints the success line and returns 0 on a healthy spawn', () => {
    makeRepo('demo');
    const out = sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(out).toMatch(/^workspace demo-quiet-mesa /);
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
    sh(`cmd_ws_rename --session demo-quiet-mesa --branch feat/renamed`);
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

  // The `|| die` on the dirty read is load-bearing and nothing was failing when
  // it was removed. It is reachable: truncate the workspace's PRIVATE index —
  // what a crash or a full disk leaves behind — and `git status --porcelain`
  // exits 128 while `rev-parse --git-common-dir` still answers, so the identity
  // guard above passes and this line is the only thing between a session that is
  // still running and the kill-then-die. "A status we could not read is not a
  // clean one", same rule as `_ws_gc_dirty`.
  it('refuses a worktree whose status cannot be read, before any teardown', () => {
    const wt = addOne();
    fs.writeFileSync(path.join(main(), '.git', 'worktrees', 'quiet-mesa', 'index'), 'GARBAGE');
    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow(/could not read/);
    expect(calls()).toEqual([]);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(fs.existsSync(wt)).toBe(true);
    expect(branches('ws/quiet-mesa')).not.toBe('');
  });

  // THE OTHER HALF OF "could not read" — final-round verification P2, and the
  // same shape already closed at `_ws_reap_eval` and `_ws_archive_manifest`
  // while this destructive verb kept the rc-only form three lines under the
  // comment describing the fix. A `chmod 000` on a TRACKED directory holding a
  // MODIFIED file is not an error to git: measured on git 2.43, `git status
  // --porcelain` exits 0 with EMPTY stdout and writes `warning: could not open
  // directory 'tracked/'` to stderr. So the guard above read CLEAN, the run
  // went on to `_ws_unsupervise` and `tmux kill-session`, and only `git
  // worktree remove` refused — leaving the session dead, out of supervision,
  // and a refusal message about unlocking a tree that says nothing about the
  // uncommitted work still in it.
  it('refuses a worktree it could only PARTIALLY read, before any teardown', () => {
    const wt = addOne();
    const tracked = path.join(wt, 'tracked');
    fs.mkdirSync(path.join(tracked, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'committed\n');
    execFileSync('git', ['-C', wt, 'add', '-A'], { env: gitEnv() });
    execFileSync('git', ['-C', wt, 'commit', '-m', 'the work'], { env: gitEnv() });
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'UNCOMMITTED\n');
    fs.chmodSync(tracked, 0o000);
    try {
      // The premise, measured rather than assumed: rc 0, empty stdout, a
      // diagnostic on stderr. Without this the test could be passing on the
      // exit-code rung that was already there.
      const probe = sh(`git -C "${wt}" status --porcelain 2>"$HOME/probe-err"; echo "rc=$?"; `
        + `echo "out=[$(git -C "${wt}" status --porcelain 2>/dev/null)]"; `
        + `echo "err=[$(cat "$HOME/probe-err")]"`);
      expect(probe, probe).toContain('rc=0');
      expect(probe, probe).toContain('out=[]');
      expect(probe, probe).toContain('Permission denied');

      expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow(/could not read/);
      expect(calls(), 'REFUSE FIRST: neither the unit nor the pane may be touched').toEqual([]);
      expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
      expect(fs.existsSync(wt)).toBe(true);
      expect(branches('ws/quiet-mesa')).not.toBe('');
    } finally {
      // rmSync cannot recurse into a 0o000 directory: without this the
      // harness's own cleanup throws and leaks the fixture HOME.
      fs.chmodSync(tracked, 0o755);
    }
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

  // CDPATH — `export CDPATH=.` is an ordinary .bashrc line, and the guard above
  // is resolved with `cd`. `rev-parse --git-common-dir` prints a RELATIVE `.git`
  // from a repo's own checkout — i.e. always for $main — and bash's `cd` searches
  // a relative operand through CDPATH and PRINTS the directory it landed on. So
  // the resolution has to opt out of CDPATH, not merely redirect stderr.
  // Both tests are ONE fixture each away from the two already above; what is new
  // is only the environment ccd is run in.
  it('removes a healthy workspace with CDPATH exported', () => {
    const wt = addOne();
    // `CDPATH=.` finds `./.git` and echoes it, so $main's side comes back as the
    // right path TWICE while the worktree's (absolute `--git-common-dir`) side
    // comes back once: the guard's own comparison fails and ws-rm refuses a
    // perfectly healthy workspace, offering only "delete the directory by hand".
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`, { CDPATH: '.' });
    expect(fs.existsSync(wt)).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(calls()).toEqual([
      'unsupervise demo-quiet-mesa',
      'tmux kill-session -t cc-demo-quiet-mesa',
    ]);
  });

  it('refuses the squatter even when CDPATH holds a decoy .git', () => {
    const wt = recreateWithStaleRecord();
    execFileSync('git', ['init', '-b', 'main', wt], { env: gitEnv() });
    fs.writeFileSync(path.join(wt, 'PRECIOUS'), 'not ccd’s to remove\n');
    execFileSync('git', ['-C', wt, 'add', 'PRECIOUS'], { env: gitEnv() });
    execFileSync('git', ['-C', wt, 'commit', '-m', 'someone else lives here'], { env: gitEnv() });
    // The dangerous direction. Both the squatter and $main answer with a relative
    // `.git`, so under this CDPATH BOTH resolutions land on the decoy: two wrong
    // answers that compare EQUAL, the guard passes, and the session is killed and
    // the unit disabled before `worktree remove` dies — verbatim the kill-then-die
    // the guard exists to close. Requiring a non-empty $main side does not help;
    // only never consulting CDPATH does.
    const decoy = path.join(home, 'cdp');
    fs.mkdirSync(path.join(decoy, '.git'), { recursive: true });

    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`, { CDPATH: decoy })).toThrow();
    expect(calls()).toEqual([]);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(fs.existsSync(path.join(wt, 'PRECIOUS'))).toBe(true);
    expect(branches('ws/quiet-mesa')).not.toBe('');
  });

  // The OTHER stdout channel into the same guard, and the reason the fix is a
  // replacement rather than another prefix: a `CDPATH=` assignment stops bash's
  // OWN cd from printing, and stops nothing else. A `cd` defined as a shell
  // function and exported with `export -f` is imported by every bash child
  // through the environment (as BASH_FUNC_cd%%), so it reaches `bash ccd` no
  // matter what the script puts on the `cd` line; the classic wrapper — the
  // shape zoxide, direnv and a hundred .bashrc snippets have — echoes on every
  // call, straight onto the captured stdout. There is nothing ccd can add to a
  // `cd` it captures that makes that safe. Not capturing a `cd` at all is what
  // is safe, so both resolutions now ask git and `_ws_realpath` discards cd's
  // stdout instead of merely its stderr.
  const CHATTY_CD = { 'BASH_FUNC_cd%%': '() { builtin cd "$@" && echo "[cd hook] now in $PWD"; }' };

  it('removes a healthy workspace when cd itself is shadowed and chatty', () => {
    const wt = addOne();
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`, CHATTY_CD);
    expect(fs.existsSync(wt)).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(calls()).toEqual([
      'unsupervise demo-quiet-mesa',
      'tmux kill-session -t cc-demo-quiet-mesa',
    ]);
  });

  // Same shadow, on the layout the fleet actually runs: $HOME/worktrees is a
  // symlink (-> /data/worktrees -> /mnt/...). That is what makes _ws_realpath
  // load-bearing — git records the resolved path while the registry holds the
  // one ccd wrote, so `$cur == $path` cannot match and only the resolved `$real`
  // can. Fixing just the two --git-common-dir call sites leaves THIS red:
  // measured, a chatty cd still refused a healthy workspace here (rc=1,
  // directory and registry intact) until _ws_realpath stopped capturing cd too.
  it('removes a healthy workspace under a symlinked worktree root with cd chatty', () => {
    fs.mkdirSync(path.join(home, 'real-worktrees'));
    fs.symlinkSync(path.join(home, 'real-worktrees'), path.join(home, 'worktrees'));
    const wt = addOne();
    expect(fs.existsSync(path.join(home, 'real-worktrees', 'demo', 'quiet-mesa'))).toBe(true);
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`, CHATTY_CD);
    expect(fs.existsSync(wt)).toBe(false);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(calls()).toEqual([
      'unsupervise demo-quiet-mesa',
      'tmux kill-session -t cc-demo-quiet-mesa',
    ]);
  });

  it('refuses the squatter when cd itself is shadowed and chatty', () => {
    const wt = recreateWithStaleRecord();
    execFileSync('git', ['init', '-b', 'main', wt], { env: gitEnv() });
    fs.writeFileSync(path.join(wt, 'PRECIOUS'), 'not ccd’s to remove\n');
    execFileSync('git', ['-C', wt, 'add', 'PRECIOUS'], { env: gitEnv() });
    execFileSync('git', ['-C', wt, 'commit', '-m', 'someone else lives here'], { env: gitEnv() });

    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`, CHATTY_CD)).toThrow();
    expect(calls()).toEqual([]);
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(fs.existsSync(path.join(wt, 'PRECIOUS'))).toBe(true);
    expect(branches('ws/quiet-mesa')).not.toBe('');
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

describe('makeGhRepo — the fixture the PR verbs need', () => {
  it('reads as github.com/o/r and fetches from the local bare repo', () => {
    const main = h.makeGhRepo('demo');
    const origin = path.join(h.home, 'origins', 'demo.git');
    // What _gh_repo_slug will read: the raw config value, NOT the rewritten one.
    expect(h.git(main, 'config', '--get', 'remote.origin.url')).toBe('https://github.com/o/r');
    // What git will actually contact. Both directions must be the bare repo, or
    // this suite talks to the real GitHub: fetch via insteadOf, push via
    // pushurl. If either of these ever comes back as an https url, stop —
    // every fetch in ws-add and every reap Phase C is then a network call.
    expect(h.git(main, 'remote', 'get-url', 'origin')).toBe(origin);
    expect(h.git(main, 'remote', 'get-url', '--push', 'origin')).toBe(origin);
    // Rewritten, so this touches no network. It is also fast: a fetch that
    // starts taking seconds means insteadOf stopped applying.
    expect(h.git(main, 'fetch', 'origin', '--quiet')).toBe('');
    // ...and a push really lands in $HOME/origins/demo.git.
    h.git(main, 'push', 'origin', 'main');
    expect(h.git(origin, 'rev-parse', '--verify', 'refs/heads/main')).toMatch(/^[0-9a-f]{40}$/);
  });

  it('makes _gh_repo_slug resolve, which makeRepo does NOT', () => {
    // The reason this builder exists. `makeRepo`'s origin is a local bare
    // path, so the slug regex rejects it and every PR verb answers no-remote.
    h.makeGhRepo('demo');
    h.makeRepo('plain');
    expect(h.sh('_gh_repo_slug "$HOME/projects/demo"')).toBe('o/r');
    expect(() => h.sh('_gh_repo_slug "$HOME/projects/plain"')).toThrow();
  });
});

describe('gh containment is the harness\'s, not the caller\'s', () => {
  // Task 3 put `makeGhRepo` — the fixture that makes every PR verb functional —
  // into the BASE harness while leaving the poisoned `gh` in `makePrHarness`
  // only, so containment became a rule to remember (use the PR harness) rather
  // than a property of the harness. /usr/bin/gh is installed on this box and
  // ~/.config/gh/hosts.yml holds a real `gho_` token with repo WRITE scope: one
  // test in ANY of the six ccd files that grows a gh call is otherwise a live
  // call to the real github.com, or a write to it. HOME is isolated by
  // construction here and so is this.
  it('answers every gh from the base harness with the poison, never the host', () => {
    h.makeGhRepo('demo');
    const out = h.sh('_gh_pr_list o/r || true');
    expect(JSON.parse(out)).toEqual({ phase: 'unknown', reason: 'error' });
    expect(h.ghPoison()).toHaveLength(1);
    expect(h.ghPoison()[0]).toContain('pr list --repo o/r');
  });

  it('routes EVERY bash call site in every ccd test file through BOTH poisons', () => {
    // A behavioural test can only pin the call sites that exist today, and the
    // failure mode this whole boundary exists for is the one written tomorrow:
    // four sites already built their own env (`ccd-limits` and `ccd-clip`
    // predate `makeCcdHarness` entirely, and `ccd-archive`'s `runCcd` supplies a
    // PATH of its own, which would have DISPLACED the poison). So the invariant
    // is checked in the source: a bash spawn in a ccd test file goes through
    // `ghContainedEnv`, which prepends and therefore cannot be displaced.
    //
    // THE SECOND CLAUSE IS THE SYSTEMD ONE, and it is here because that poison
    // became OPT-IN: a ccd runner now has to ask for it, and "every test that
    // can reach `_supervised_start` is contained" would otherwise be a claim
    // about the fifteen call sites that happened to be edited on the day. This
    // is where a sixteenth one is caught. The behavioural half lives in
    // `ccd-harness-containment.test.ts`; this half is the coverage.
    const dir = __dirname;
    const files = fs.readdirSync(dir).filter((f) => /^ccd.*\.ts$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(7);
    let asked = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      src.forEach((ln, i) => {
        // All four spawn idioms this suite uses, not just the one this scan was
        // born matching. `spawnSync` is how a file that EXPECTS a nonzero exit
        // spawns (`ccd-start-id`, `ccd-roster-preamble`), and a pre-resolved
        // `BASH` is how a file whose child PATH holds no system directory has to
        // spawn at all — both were invisible here, so two real ccd runners sat
        // outside a guard whose whole claim is "every bash call site".
        if (!/(?:execFileSync|spawnSync)\((?:'bash'|BASH)[,)]/.test(ln)) return;
        // Either side of the call: `ccd-archive`'s `runCcd` builds its `opts`
        // object several lines above the spawn.
        const window = src.slice(Math.max(0, i - 12), i + 8).join('\n');
        expect(window, `${f}:${i + 1} spawns bash without ghContainedEnv`).toContain('ghContainedEnv(');
        // ONE deliberate exception, and it has to say so in the source it is
        // read from: the negative control that proves the opt-in is real must
        // spawn bash with the systemd poison ABSENT. `gh` is asserted above for
        // it like everything else — opting out of one boundary is not a way out
        // of the other.
        if (window.includes('SYSTEMD-OPT-OUT IS THE ASSERTION')) return;
        // Substring, not the exact `{ systemd: true }` literal: `ccdWsHelpers.ts`'s
        // own two call sites now ask `{ systemd: true, tmux: true }` (wave 2's
        // tmux poison), and the invariant this scan checks is "did this call
        // site ask for systemd containment", not "does it ask for ONLY that".
        expect(window, `${f}:${i + 1} runs ccd without asking for systemd containment`)
          .toContain('systemd: true');
        asked++;
      });
    }
    // The scan is only worth anything if it is scanning something: a refactor
    // that renamed the spawn helper would otherwise pass by matching nothing.
    expect(asked, 'the scan matched no ccd bash spawn at all').toBeGreaterThanOrEqual(12);
  });

  it('puts the harness bin FIRST on PATH, whatever the caller passes', () => {
    // A caller-supplied PATH must not be able to displace it — the ordering is
    // what makes this structural rather than advisory.
    expect(h.sh('command -v gh')).toBe(path.join(h.home, '.local', 'bin', 'gh'));
    expect(h.sh('command -v gh', { PATH: '/usr/bin:/bin' })).toBe(path.join(h.home, '.local', 'bin', 'gh'));
  });
});
