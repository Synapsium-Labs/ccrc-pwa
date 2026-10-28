// `ccd ws-shed-deps` — the box's half of the deps-shed arm (D-7278; design note 2026-10-28 §4). The server decides
// that a sleeping session's work is finished; this verb re-proves what the box can see and removes ONLY the git-ignored,
// untracked dependency directories of its worktree. Every case builds the real child (`makeChild`, through the real
// `cmd_ws_add --child`) in a fixture HOME, with the unit and pane calls answered by the reclaim suites' models
// (`CHILD_STUBS`), never made; what is asserted is the one JSON line and what is left on disk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, CHILD_STUBS, makeChild, plantTmux, type Child } from './childReclaimFixture.js';

let h: PrHarness;
let c: Child;
const reg = (f: string): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.${f}`);
const now = (): number => Math.floor(Date.now() / 1000);
/** Nobody uses any path (the process walk is the box's; `in-use` cases redefine it after this). */
const NO_USERS = '_ws_path_users_many() { _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
  + ' local p; for p in "$@"; do _WS_PATH_USERS_RCS+=(0); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=(""); done; };';
const asleep = (secondsAgo: number): void => { fs.writeFileSync(reg('stopped'), `${now() - secondsAgo} agent`); };
const write = (rel: string, body = 'x\n'): void => {
  const p = path.join(c.wt, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
/** The worktree's dependency dirs: an ignored root one and an ignored nested one. */
const deps = (): void => {
  write('.gitignore', 'node_modules/\ndist/\n');
  h.git(c.wt, 'add', '.gitignore');
  h.git(c.wt, 'commit', '-m', 'ignore');
  write('node_modules/pkg/index.js');
  write('pwa/node_modules/other/index.js');
  write('pwa/src/app.ts');
  h.git(c.wt, 'add', 'pwa/src/app.ts');
  h.git(c.wt, 'commit', '-m', 'pwa');
};
const exists = (rel: string): boolean => fs.existsSync(path.join(c.wt, rel));
const shed = (flags = '', pre = ''): { code: number; doc: Record<string, unknown>; stderr: string } => {
  const r = h.run(`${CHILD_STUBS} ${NO_USERS} ${pre} cmd_ws_shed_deps --session ${CHILD_ID} --class child ${flags}`);
  const line = r.stdout.trim().split('\n').pop() ?? '';
  let doc: Record<string, unknown> = {};
  try { doc = JSON.parse(line) as Record<string, unknown>; } catch { doc = { unparsed: r.stdout }; }
  return { code: r.code, doc, stderr: r.stderr };
};
const journal = (): Array<Record<string, unknown>> => {
  const dir = path.join(h.home, '.cc-sessions', '.lifecycle');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>))
    .filter((e) => e['act'] === 'shed-deps');
};
/** A listing seam that names one more directory than git does (the real listing, then `extra`). */
const widen = (extra: string): string => '_ws_shed_listing() { command git -C "$1" ls-files -z --others --ignored'
  + ` --exclude-standard --directory; printf '%s\\0' '${extra}'; };`;
const status = (): string => h.git(c.wt, 'status', '--porcelain=v1', '--untracked-files=all');

beforeEach(() => { h = makePrHarness('ccrc-shed-deps-'); c = makeChild(h); deps(); asleep(7200); });
afterEach(() => { h.cleanup(); });

describe('ws-shed-deps sheds a sleeping child\'s ignored dependency directories', () => {
  it('CONTROL: removes both node_modules, keeps every git fact, stamps the sleep and journals the act', () => {
    write('notes.txt', 'untracked, not ignored\n');
    const before = status();
    const head = h.git(c.wt, 'rev-parse', 'HEAD');
    const r = shed();
    expect(r.code, r.stderr).toBe(0);
    expect(r.doc).toMatchObject({ shed: true, session: CHILD_ID, class: 'child', dirs: 2 });
    expect(r.doc['bytes']).toEqual(expect.any(Number));
    expect(exists('node_modules')).toBe(false);
    expect(exists('pwa/node_modules')).toBe(false);
    expect(exists('pwa/src/app.ts')).toBe(true);
    expect(exists('notes.txt')).toBe(true);
    expect(status()).toBe(before);
    expect(h.git(c.wt, 'rev-parse', 'HEAD')).toBe(head);
    expect(fs.readFileSync(reg('depsshed'), 'utf8')).toMatch(/^\d+ \d+$/);
    const j = journal();
    expect(j.map((e) => e['outcome'])).toEqual(['done']);
    expect(j[0]).toMatchObject({ verb: 'ws-shed-deps', meas: expect.objectContaining({ mode: 'child' }) });
  });

  it('--dry-run answers what it would remove and removes, stamps and journals nothing', () => {
    const r = shed('--dry-run');
    expect(r.code, r.stderr).toBe(0);
    expect(r.doc).toMatchObject({ wouldShed: true, session: CHILD_ID, class: 'child', dirs: 2 });
    expect(exists('node_modules/pkg/index.js')).toBe(true);
    expect(exists('pwa/node_modules/other/index.js')).toBe(true);
    expect(fs.existsSync(reg('depsshed'))).toBe(false);
    expect(journal()).toEqual([]);
  });

  it('a coordinator sheds with no child marker; a worker without one refuses `not-a-child`', () => {
    fs.rmSync(reg('child'));
    expect(shed().doc).toMatchObject({ refused: 'not-a-child' });
    expect(exists('node_modules')).toBe(true);
    const r = h.run(`${CHILD_STUBS} ${NO_USERS} cmd_ws_shed_deps --session ${CHILD_ID} --class coordinator`);
    expect(JSON.parse(r.stdout)).toMatchObject({ shed: true, class: 'coordinator', dirs: 2 });
    expect(exists('node_modules')).toBe(false);
  });

  it('a tracked file under node_modules keeps that directory; the other still goes', () => {
    write('pwa/node_modules/vendored/keep.js');
    h.git(c.wt, 'add', '-f', 'pwa/node_modules/vendored/keep.js');
    h.git(c.wt, 'commit', '-m', 'vendor');
    const r = shed();
    expect(r.doc).toMatchObject({ shed: true, dirs: 1 });
    expect(exists('node_modules')).toBe(false);
    expect(exists('pwa/node_modules/vendored/keep.js')).toBe(true);
  });

  it('the index is asked too: a listing that names a directory holding a tracked file never removes it', () => {
    write('pwa/node_modules/vendored/keep.js');
    h.git(c.wt, 'add', '-f', 'pwa/node_modules/vendored/keep.js');
    h.git(c.wt, 'commit', '-m', 'vendor');
    // A git whose listing collapses that directory anyway: the second fence, `git ls-files -- <dir>`, still keeps it.
    const wide = widen('pwa/node_modules/');
    expect(shed('', wide).doc).toMatchObject({ shed: true, dirs: 1 });
    expect(exists('pwa/node_modules/vendored/keep.js')).toBe(true);
  });

  it('a non-ignored untracked file and an ignored directory of another name survive', () => {
    write('scratch/todo.md');
    write('dist/bundle.js');
    expect(shed().doc).toMatchObject({ shed: true, dirs: 2 });
    expect(exists('scratch/todo.md')).toBe(true);
    expect(exists('dist/bundle.js')).toBe(true);
  });

  it('CCD_DEPS_SHED_NAMES names the directories; a name that is not one plain component is dropped', () => {
    write('dist/bundle.js');
    const r = h.run(`${CHILD_STUBS} ${NO_USERS} CCD_DEPS_SHED_NAMES='dist ../x .git a/b' cmd_ws_shed_deps --session ${CHILD_ID} --class child`);
    expect(JSON.parse(r.stdout)).toMatchObject({ shed: true, dirs: 1 });
    expect(exists('dist')).toBe(false);
    expect(exists('node_modules')).toBe(true);
  });

  it('a nested repository\'s node_modules is left', () => {
    const nested = path.join(c.wt, 'nested');
    fs.mkdirSync(nested);
    h.git(nested, 'init', '-q');
    fs.writeFileSync(path.join(nested, '.gitignore'), 'node_modules/\n');
    write('nested/node_modules/n/index.js');
    expect(shed().doc).toMatchObject({ shed: true, dirs: 2 });
    expect(exists('nested/node_modules/n/index.js')).toBe(true);
  });

  it('a node_modules that is a repository of its own is left', () => {
    h.git(path.join(c.wt, 'pwa', 'node_modules'), 'init', '-q');
    expect(shed().doc).toMatchObject({ shed: true, dirs: 1 });
    expect(exists('pwa/node_modules/other/index.js')).toBe(true);
    expect(exists('node_modules')).toBe(false);
  });

  it('a repository deeper inside a node_modules keeps that whole directory, uncommitted work included', () => {
    const dep = path.join(c.wt, 'node_modules', 'gitdep');
    fs.mkdirSync(dep, { recursive: true });
    h.git(dep, 'init', '-q');
    fs.writeFileSync(path.join(dep, 'wip.txt'), 'uncommitted\n');
    const r = shed();
    expect(r.doc).toMatchObject({ shed: true, dirs: 1 });
    expect(exists('node_modules/gitdep/wip.txt')).toBe(true);
    expect(exists('node_modules/pkg/index.js')).toBe(true);
    expect(exists('pwa/node_modules')).toBe(false);
  });

  it('a names override never reaches a worktree under an ignored directory: `.worktrees/feat` keeps its work', () => {
    write('.gitignore', 'node_modules/\ndist/\n.worktrees/\n');
    h.git(c.wt, 'commit', '-qam', 'ignore worktrees');
    h.git(c.wt, 'worktree', 'add', '-q', '-b', 'feat', path.join(c.wt, '.worktrees', 'feat'));
    write('.worktrees/feat/wip.txt', 'uncommitted\n');
    const r = h.run(`${CHILD_STUBS} ${NO_USERS} CCD_DEPS_SHED_NAMES='.worktrees' cmd_ws_shed_deps --session ${CHILD_ID} --class child`);
    expect(JSON.parse(r.stdout)).toMatchObject({ refused: 'nothing-to-shed' });
    expect(exists('.worktrees/feat/wip.txt')).toBe(true);
    expect(h.git(c.wt, 'worktree', 'list')).toContain('.worktrees/feat');
  });

  it('a repository walk that cannot finish refuses `unmeasured` and removes nothing', () => {
    expect(shed('', '_ws_shed_repos() { return 124; };').doc).toMatchObject({ refused: 'unmeasured' });
    expect(exists('node_modules/pkg/index.js')).toBe(true);
    expect(exists('pwa/node_modules/other/index.js')).toBe(true);
  });

  it('a node_modules that is a link is never followed, and what it points at survives', () => {
    fs.rmSync(path.join(c.wt, 'node_modules'), { recursive: true });
    const outside = path.join(h.home, 'outside-deps');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'precious.js'), 'x\n');
    fs.symlinkSync(outside, path.join(c.wt, 'node_modules'));
    // git lists a link as a file, so the listing is widened to name it as a directory: the physical-path re-proof keeps it.
    const wide = widen('node_modules/');
    expect(shed('', wide).doc).toMatchObject({ shed: true, dirs: 1 });
    expect(fs.existsSync(path.join(outside, 'precious.js'))).toBe(true);
    expect(fs.lstatSync(path.join(c.wt, 'node_modules')).isSymbolicLink()).toBe(true);
  });

  it('a second ask during the same sleep refuses `already-shed`; a new sleep may shed again', () => {
    expect(shed().doc).toMatchObject({ shed: true });
    write('node_modules/pkg/index.js');
    expect(shed().doc).toMatchObject({ refused: 'already-shed' });
    expect(exists('node_modules/pkg/index.js')).toBe(true);
    fs.writeFileSync(reg('depsshed'), `${now() - 9000} 10`);
    expect(shed().doc).toMatchObject({ shed: true });
  });
});

describe('ws-shed-deps refuses, touching nothing', () => {
  const kept = (): void => {
    expect(exists('node_modules/pkg/index.js')).toBe(true);
    expect(exists('pwa/node_modules/other/index.js')).toBe(true);
    expect(fs.existsSync(reg('depsshed'))).toBe(false);
  };
  it('`paused` first, while reclamation is paused fleet-wide', () => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    fs.rmSync(reg('stopped'));
    expect(shed().doc).toMatchObject({ refused: 'paused' });
    kept();
    expect(journal().map((e) => [e['outcome'], e['refusal']])).toEqual([['refused', 'paused']]);
  });
  it('`no-such-session` for an id no row names', () => {
    const r = h.run(`${CHILD_STUBS} ${NO_USERS} cmd_ws_shed_deps --session project-a-nobody --class child`);
    expect(JSON.parse(r.stdout)).toMatchObject({ refused: 'no-such-session' });
    kept();
  });
  it('`not-a-workspace` for a main checkout', () => {
    fs.rmSync(reg('workspace'));
    expect(shed().doc).toMatchObject({ refused: 'not-a-workspace' });
    kept();
  });
  it('`not-asleep` with no stop stamp, with a pane up, and with a unit that is not stopped', () => {
    fs.rmSync(reg('stopped'));
    expect(shed().doc).toMatchObject({ refused: 'not-asleep' });
    asleep(7200);
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`] });
    expect(shed().doc).toMatchObject({ refused: 'not-asleep' });
    fs.rmSync(path.join(h.home, 'tmux-sessions'));
    expect(shed('', '_svc_is_active() { printf active; };').doc).toMatchObject({ refused: 'not-asleep' });
    expect(shed('', '_svc_is_active() { :; };').doc, 'an empty unit answer refuses').toMatchObject({ refused: 'not-asleep' });
    kept();
  });
  it('`asleep-too-recently` under the box floor, which the environment can raise and never lower, and no argument names', () => {
    asleep(60);
    expect(shed().doc).toMatchObject({ refused: 'asleep-too-recently' });
    expect(shed('', 'CCD_DEPS_SHED_MIN_ASLEEP_S=1;').doc).toMatchObject({ refused: 'asleep-too-recently' });
    const usage = h.run(`${CHILD_STUBS} ${NO_USERS} cmd_ws_shed_deps --session ${CHILD_ID} --class child --min-asleep 1`);
    expect(usage.code).not.toBe(0);
    expect(usage.stdout).toBe('');
    asleep(7200);
    expect(shed('', 'CCD_DEPS_SHED_MIN_ASLEEP_S=99999;').doc).toMatchObject({ refused: 'asleep-too-recently' });
    kept();
  });
  it('`in-progress` while another verb holds the id\'s reap lock', () => {
    const lock = path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`);
    const r = h.run(`${CHILD_STUBS} ${NO_USERS} exec 9>>'${lock}'; flock -n 9 || exit 99;`
      + ` cmd_ws_shed_deps --session ${CHILD_ID} --class child`);
    expect(JSON.parse(r.stdout)).toMatchObject({ refused: 'in-progress' });
    kept();
    expect(journal().map((e) => e['refusal'])).toEqual(['in-progress']);
  });
  it('a wake and a shed exclude each other: while the reap lock is held no pane is created for a row that is not archived', () => {
    const lock = path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`);
    const gate = `_ws_expire_spawn_gate ${CHILD_ID}; echo "rc=$? why=$_WS_EXPIRE_SPAWN_WHY"`;
    // No lock file: the gate answers free and creates none.
    expect(h.run(`${CHILD_STUBS} ${gate}`).stdout).toContain('rc=0');
    expect(fs.existsSync(lock)).toBe(false);
    // The file stands, nobody holds it: free, and the gate let it go (a second process can take it).
    fs.writeFileSync(lock, '');
    expect(h.run(`${CHILD_STUBS} ${gate}; exec 8>>'${lock}'; flock -n 8 && echo retaken`).stdout).toMatch(/rc=0[\s\S]*retaken/);
    // Held (a shed in progress): refused, and `ccd ensure` dies before it clears the stop stamp.
    const held = `exec 9>>'${lock}'; flock -n 9 || exit 99; (exec 9>&-; ${gate});`;
    const r = h.run(`${CHILD_STUBS} ${held}`);
    expect(r.stdout).toMatch(/rc=1 why=.*reap lock.*shed/);
    const ens = h.run(`${CHILD_STUBS} exec 9>>'${lock}'; flock -n 9 || exit 99; (exec 9>&-; cmd_ensure ${CHILD_ID}) 2>&1; echo "ens=$?"`);
    expect(ens.stdout).toMatch(/reap lock[\s\S]*ens=1/);
    expect(fs.existsSync(reg('stopped'))).toBe(true);
  });
  it('no reap lock is made for an id no row names', () => {
    h.run(`${CHILD_STUBS} ${NO_USERS} cmd_ws_shed_deps --session project-a-nobody --class child`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reap-project-a-nobody.lock'))).toBe(false);
  });
  it('`unmeasured` for a shed stamp that does not read as an epoch', () => {
    fs.writeFileSync(reg('depsshed'), 'garbage');
    expect(shed().doc).toMatchObject({ refused: 'unmeasured' });
    expect(exists('node_modules/pkg/index.js')).toBe(true);
  });
  it('`nothing-to-shed` when no candidate stands', () => {
    fs.rmSync(path.join(c.wt, 'node_modules'), { recursive: true });
    fs.rmSync(path.join(c.wt, 'pwa', 'node_modules'), { recursive: true });
    expect(shed().doc).toMatchObject({ refused: 'nothing-to-shed' });
  });
  it('`in-use` when a process holds a candidate, and `unmeasured` when the walk could not answer', () => {
    const holder = '_ws_path_users_many() { _WS_PATH_USERS_RCS=(0 1); _WS_PATH_USERS_PIDS_OF=("" "4242"); _WS_PATH_USERS_WHY_OF=("" "cwd"); };';
    expect(shed('', holder).doc).toMatchObject({ refused: 'in-use' });
    kept();
    const blind = '_ws_path_users_many() { _WS_PATH_USERS_RCS=(2 2); _WS_PATH_USERS_PIDS_OF=("" ""); _WS_PATH_USERS_WHY_OF=("walk timed out" ""); };';
    expect(shed('', blind).doc).toMatchObject({ refused: 'unmeasured' });
    kept();
  });
  it('a wake during the walks refuses `not-asleep` just before the act: a pane, an active unit, a cleared stop stamp', () => {
    // The wake paths (`ccd ensure` from the PWA's route or the mail lane, `ccd start`) take no lock this verb holds, so the
    // verb asks again, after every walk: `_ws_shed_gap` stands between rung 4's answer and the last facts.
    const wakes: Array<[string, string]> = [
      ['a pane came up', `_ws_shed_gap() { printf 'cc-${CHILD_ID}\\n' > "$HOME/tmux-sessions"; };`],
      ['the unit started', '_ws_shed_gap() { _svc_is_active() { printf active; }; };'],
      ['a wake cleared the stop stamp', `_ws_shed_gap() { rm -f "${reg('stopped')}"; };`],
      ['a wake re-stamped it', `_ws_shed_gap() { printf '%s agent' "$(( $(date +%s) - 1 ))" > "${reg('stopped')}"; };`],
    ];
    for (const [why, gap] of wakes) {
      for (const flags of ['', '--dry-run']) {
        const r = shed(flags, gap);
        expect(r.doc, `${why} ${flags}`).toMatchObject({ refused: 'not-asleep' });
        kept();
        fs.rmSync(path.join(h.home, 'tmux-sessions'), { force: true });
        asleep(7200);
      }
    }
    // A holder that appeared during the walks refuses `in-use` there too, with nothing removed.
    const lateHolder = '_ws_shed_gap() { _ws_path_users_many() { _WS_PATH_USERS_RCS=(1 0); _WS_PATH_USERS_PIDS_OF=("77" "");'
      + ' _WS_PATH_USERS_WHY_OF=("cwd" ""); }; };';
    expect(shed('', lateHolder).doc).toMatchObject({ refused: 'in-use' });
    kept();
    expect(journal().every((e) => e['outcome'] === 'refused')).toBe(true);
    // CONTROL: the same gap seam with nothing woken still sheds.
    expect(shed('', '_ws_shed_gap() { :; };').doc).toMatchObject({ shed: true });
  });
  it('the dry run refuses the same way and journals nothing', () => {
    asleep(60);
    expect(shed('--dry-run').doc).toMatchObject({ refused: 'asleep-too-recently' });
    expect(journal()).toEqual([]);
  });
  it('a usage error prints nothing on stdout: a missing or unknown class, a dash-led id', () => {
    for (const tail of ['', '--class worker', `--class child --session x`]) {
      const r = h.run(`${CHILD_STUBS} cmd_ws_shed_deps --session ${CHILD_ID} ${tail}`);
      expect(r.code, tail).not.toBe(0);
      expect(r.stdout, tail).toBe('');
    }
    const dash = h.run(`${CHILD_STUBS} cmd_ws_shed_deps --session --class --class child`);
    expect(dash.code).not.toBe(0);
    expect(dash.stdout).toBe('');
  });
});

describe('ws-shed-deps fails, after the act began, on a doubt it finds there', () => {
  it('`git-state-changed` when git status moved across the removal', () => {
    const r = shed('', `_ws_shed_gap() { echo edit >> "${c.wt}/pwa/src/app.ts"; };`);
    expect(r.code).toBe(1);
    expect(r.doc).toMatchObject({ failed: 'git-state-changed' });
    expect(fs.existsSync(reg('depsshed'))).toBe(false);
    expect(journal().map((e) => e['outcome'])).toEqual(['failed']);
  });
  it('`shed-incomplete` when a removal could not finish; a retry once it can finishes', () => {
    const locked = path.join(c.wt, 'node_modules', 'pkg');
    fs.chmodSync(locked, 0o555);
    try {
      const r = shed();
      expect(r.code).toBe(1);
      expect(r.doc).toMatchObject({ failed: 'shed-incomplete' });
      expect(fs.existsSync(reg('depsshed'))).toBe(false);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
    expect(shed().doc).toMatchObject({ shed: true });
  });
});

describe('ws-shed-deps is bounded', () => {
  it('CCD_DEPS_SHED_SCAN_S lowers the walks\' bound and never raises it past the default', () => {
    expect(h.sh('_ws_shed_scan')).toBe('30');
    expect(h.sh('CCD_DEPS_SHED_SCAN_S=5 _ws_shed_scan')).toBe('5');
    expect(h.sh('CCD_DEPS_SHED_SCAN_S=9999 _ws_shed_scan')).toBe('30');
  });
  it('a size that cannot be measured answers `bytes: null` and still sheds', () => {
    const r = shed('', '_ws_shed_size() { return 124; };');
    expect(r.doc).toMatchObject({ shed: true, dirs: 2, bytes: null });
    expect(fs.readFileSync(reg('depsshed'), 'utf8')).toMatch(/^\d+$/);
  });
});

describe('ws-shed-deps on the wire', () => {
  it('cmd_caps lists shed-deps-v1 and the verb', () => {
    const caps = h.sh('cmd_caps').split('\n');
    expect(caps).toContain('shed-deps-v1');
    expect(caps).toContain('ws-shed-deps');
  });
});
