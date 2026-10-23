// DR-16 (D-6628, spec 2026-10-23 §2.3): the orphan census (`ccd ws-audit --orphans`) and the ONE ladder
// (`ccd ws-audit --orphan-hex <hex>`). Both are READ-ONLY. Every case runs under a FIXTURE HOME; no verb here
// removes anything, and none touches a live box. The holder probe, the working-directory probe and the idle
// walk are Linux machinery, so a case that is not about them stubs them (the same seams the collector's suites
// use), and the holder cases read a fake process table.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-orphan-audit-'); });
afterEach(() => { h.cleanup(); });

const real = (p: string): string => fs.realpathSync(p);
const hex = (p: string): string => Buffer.from(p).toString('hex');
const wsroot = (): string => path.join(real(h.home), 'worktrees');

/** The probes this suite is not about: nobody holds anything, and the newest change is `days` old.
 *  `cwd`/`many` replace a probe's stub; `many: false` leaves the REAL holder probe; `days: 'unmeasured'` / `'real'` swap the idle walk. */
const NOW = Math.floor(Date.now() / 1000);   // fixed per run: the same tree must mint the same token twice
interface Stubs { days?: number | 'unmeasured' | 'real'; cwd?: string; many?: boolean | 'unmeasured' }
const stubs = (o: Stubs = {}): string => {
  const days = o.days ?? 8;
  const idle = days === 'real' ? ''
    : days === 'unmeasured' ? '_ws_collect_idle() { _WS_IDLE_DETAIL="the walk timed out"; return 2; };'
      : `_ws_collect_idle() { _WS_IDLE_NEWEST_NS="${NOW - days * 86400}000000000"; _WS_IDLE_COUNT=7; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL=''; return 0; };`;
  const many = o.many === false ? ''
    : '_ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
      + ` for i in "$@"; do _WS_PATH_USERS_RCS+=(${o.many === 'unmeasured' ? 2 : 0}); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=(""); done; return 0; };`;
  return `${o.cwd ?? '_ws_cwd_users() { return 0; };'} ${many} ${idle}`;
};

interface Doc {
  mode: string; pathHex: string; class: string; main: string; branch: string; head: string; verdict: string;
  refusal: string | null; detail: string; token: string | null; rescueToken: string | null;
  newestCtimeNs: string | null; entries: number | null; floorS: number | null;
}
const audit = (p: string, pre: string = stubs()): Doc =>
  JSON.parse(h.sh(`${pre} _ws_orphan_audit ${hex(p)} || true`).trim().split('\n').pop()!) as Doc;

/** A linked worktree of `demo` at `at`, on a branch at origin's tip. */
const tree = (at: string, branch = `ws/${path.basename(at)}`): string => {
  const main = path.join(h.home, 'projects', 'demo');
  fs.mkdirSync(path.dirname(at), { recursive: true });
  h.git(main, 'worktree', 'add', '-b', branch, at);
  return real(at);
};
const ccdRoot = (slug = 'still-cove'): string => tree(path.join(h.home, 'worktrees', 'demo', slug));
const claudeTree = (name = 'agent-a'): string => tree(path.join(h.home, 'projects', 'demo', '.claude', 'worktrees', name), `claude/${name}`);
const superTree = (name = 'plan-a'): string => tree(path.join(h.home, 'projects', 'demo', '.superpowers', 'worktrees', name), `sp/${name}`);

beforeEach(() => { h.makeRepo('demo'); });

describe('the ladder: a passing tree mints a token', () => {
  it('a clean tree on a remote, quiet for 8 days, mints a token and no refusal', () => {
    const t = ccdRoot();
    const d = audit(t);
    expect(d.verdict, d.detail).toBe('token');
    expect(d.refusal).toBeNull();
    expect(d.token).toMatch(/^[0-9a-f]{64}$/);
    expect(d.rescueToken).toBeNull();
    expect(d.class).toBe('ccd-root');
    expect(d.branch).toBe('ws/still-cove');
    expect(d.floorS).toBe(604800);
  }, 60_000);

  it('the same tree twice mints the same token; a changed HEAD mints another', () => {
    const t = claudeTree();
    const a = audit(t); const b = audit(t);
    expect(a.token).toBeTruthy();
    expect(b.token).toBe(a.token);
    fs.writeFileSync(path.join(t, 'f.txt'), 'x\n');
    h.git(t, 'add', 'f.txt'); h.git(t, 'commit', '-m', 'more');
    h.git(t, 'push', 'origin', 'HEAD:refs/heads/claude/agent-a');
    const c = audit(t);
    expect(c.verdict, c.detail).toBe('token');
    expect(c.token).not.toBe(a.token);
  }, 60_000);

  it('is reachable as `ws-audit --orphan-hex`, with the census beside it as `--orphans`', () => {
    const t = superTree();
    const via = JSON.parse(h.sh(`${stubs()} cmd_ws_audit --orphan-hex ${hex(t)}`).trim()) as Doc;
    expect(via.verdict).toBe('token');
    const cen = JSON.parse(h.sh('cmd_ws_audit --orphans').trim()) as { mode: string; rows: { pathHex: string }[] };
    expect(cen.mode).toBe('orphans');
    expect(cen.rows.map((r) => r.pathHex)).toContain(hex(t));
  }, 60_000);
});

describe('the ladder: one case per rung, each red when its rung is deleted', () => {
  it('1 not-a-worktree: a directory no worktree list names', () => {
    const d0 = path.join(wsroot(), 'demo', 'ghost'); fs.mkdirSync(d0, { recursive: true });
    const d = audit(d0);
    expect(d.refusal).toBe('not-a-worktree'); expect(d.token).toBeNull();
  }, 60_000);

  it('1 not-a-worktree: a link to a real worktree is not the worktree', () => {
    const t = claudeTree(); const l = path.join(h.home, 'lnk'); fs.symlinkSync(t, l);
    expect(audit(l).refusal).toBe('not-a-worktree');
  }, 60_000);

  it('2 out-of-scope: a worktree anywhere else', () => {
    const t = tree(path.join(h.home, 'elsewhere', 'x'));
    expect(audit(t).refusal).toBe('out-of-scope');
  }, 60_000);

  it('3 not-a-workspace: the main checkout of a project, found by its own spelling', () => {
    // a project whose main checkout stands in the ccd worktree root (in scope by location), reached through the projects root
    const main = path.join(h.home, 'projects', 'demo'); const inner = path.join(h.home, 'worktrees', 'demo', 'inner');
    fs.mkdirSync(path.dirname(inner), { recursive: true });
    fs.renameSync(main, inner); fs.symlinkSync(inner, main);
    const d = audit(real(inner));
    expect(d.refusal, d.detail).toBe('not-a-workspace');
  }, 60_000);

  it('4 registered: a .uuid row by slug, and a workdir reached through a link', () => {
    const t = ccdRoot('quiet-mesa');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'), 'u\n');
    expect(audit(t).refusal).toBe('registered');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'));
    expect(audit(t).verdict).toBe('token');
    const c = claudeTree(); const lnk = path.join(h.home, 'alias'); fs.symlinkSync(c, lnk);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'sess-a.workspace'), '');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'sess-a.workdir'), path.join(lnk, 'sub'));
    fs.mkdirSync(path.join(c, 'sub'));
    const d = audit(c);
    expect(d.refusal, d.detail).toBe('registered');
  }, 60_000);

  it('5 locked: a worktree git has locked', () => {
    const t = claudeTree(); h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'lock', t);
    expect(audit(t).refusal).toBe('locked');
  }, 60_000);

  it('6 dirty: an untracked file', () => {
    const t = claudeTree(); fs.writeFileSync(path.join(t, 'notes.md'), 'draft\n');
    expect(audit(t).refusal).toBe('dirty');
  }, 60_000);

  it('7 tree-busy: a rebase in progress, and an index.lock', () => {
    const t = claudeTree(); const gd = h.git(t, 'rev-parse', '--absolute-git-dir');
    fs.mkdirSync(path.join(gd, 'rebase-merge'));
    expect(audit(t).refusal).toBe('tree-busy');
    fs.rmSync(path.join(gd, 'rebase-merge'), { recursive: true });
    expect(audit(t).verdict).toBe('token');
    fs.writeFileSync(path.join(gd, 'index.lock'), '');
    const d = audit(t);
    expect(d.refusal, d.detail).toBe('tree-busy');
  }, 60_000);

  it('8 head-unreadable: an unborn HEAD', () => {
    const t = claudeTree();
    h.git(t, 'checkout', '--orphan', 'unborn'); h.git(t, 'rm', '-rf', '.');
    expect(audit(t).refusal).toBe('head-unreadable');
  }, 60_000);

  it('9 head-not-on-remote: a commit no remote has, with a rescue token and no token', () => {
    const t = claudeTree();
    fs.writeFileSync(path.join(t, 'work.txt'), 'w\n'); h.git(t, 'add', 'work.txt'); h.git(t, 'commit', '-m', 'wip');
    const d = audit(t);
    expect(d.refusal, d.detail).toBe('head-not-on-remote');
    expect(d.token).toBeNull();
    expect(d.rescueToken).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it('9 a commit pushed to ANY remote branch counts as on a remote (--remotes, not origin/HEAD ancestry)', () => {
    const t = claudeTree();
    fs.writeFileSync(path.join(t, 'work.txt'), 'w\n'); h.git(t, 'add', 'work.txt'); h.git(t, 'commit', '-m', 'wip');
    h.git(t, 'push', 'origin', 'HEAD:refs/heads/claude/agent-a');
    const d = audit(t);
    expect(d.verdict, d.detail).toBe('token');
  }, 60_000);

  it('9 head-not-on-remote with another refusal behind it carries no rescue token', () => {
    const t = claudeTree();
    fs.writeFileSync(path.join(t, 'work.txt'), 'w\n'); h.git(t, 'add', 'work.txt'); h.git(t, 'commit', '-m', 'wip');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    const d = audit(t);
    expect(d.refusal).toBe('head-not-on-remote');
    expect(d.rescueToken).toBeNull();
  }, 60_000);

  it('10 secrets-ignored: a secret-shaped ignored file', () => {
    const t = claudeTree();
    fs.appendFileSync(path.join(h.home, 'projects', 'demo', '.git', 'info', 'exclude'), '.env\n');
    fs.writeFileSync(path.join(t, '.env'), 'AWS_SECRET_ACCESS_KEY=real\n');
    expect(audit(t).refusal).toBe('secrets-ignored');
  }, 60_000);

  it('11 nested-checkout: a repository inside the tree', () => {
    const t = claudeTree();
    fs.appendFileSync(path.join(h.home, 'projects', 'demo', '.git', 'info', 'exclude'), 'nested/\n');
    execFileSync('git', ['init', '-q', path.join(t, 'nested')]);
    expect(audit(t).refusal).toBe('nested-checkout');
  }, 60_000);

  it('12 in-use: a process that only maps a file under the tree', () => {
    const t = claudeTree();
    const fake = 'CCD_OS=linux; rm -rf "$HOME/fp"; U="$(id -u)"; _fpp() { mkdir -p "$HOME/fp/$1/fd";'
      + ' printf "Name:\\tx\\nPPid:\\t%s\\nUid:\\t%s\\t%s\\t%s\\t%s\\n" "$2" "$3" "$3" "$3" "$3" > "$HOME/fp/$1/status";'
      + ' : > "$HOME/fp/$1/environ"; ln -sfn / "$HOME/fp/$1/cwd"; }; _fpp $$ 1 "$U"; _fpp 4242 1 "$U"; mkdir -p "$HOME/fp/4242/map_files";'
      + ` ln -sfn "${t}/lib.so" "$HOME/fp/4242/map_files/7f00-7f10"; _ws_path_users_proc_root() { printf %s "$HOME/fp"; };`;
    const d = audit(t, `${fake} ${stubs({ many: false })}`);
    expect(d.refusal, d.detail).toBe('in-use');
    expect(d.detail).toContain('4242');
  }, 60_000);

  it('12 in-use: a working directory inside the tree (the identity probe), and an unmeasured probe is never nobody', () => {
    const t = claudeTree();
    const held = audit(t, stubs({ cwd: '_ws_cwd_users() { _WS_CWD_USERS_WHY="process 9 has its working directory inside"; return 1; };' }));
    expect(held.refusal).toBe('in-use');
    const unm = audit(t, stubs({ cwd: '_ws_cwd_users() { _WS_CWD_USERS_WHY="the walk failed"; return 2; };' }));
    expect(unm.verdict).toBe('unmeasured'); expect(unm.token).toBeNull();
  }, 60_000);

  it('12 an unmeasured holder probe is never nobody', () => {
    const t = claudeTree();
    const d = audit(t, stubs({ many: 'unmeasured' }));
    expect(d.verdict).toBe('unmeasured'); expect(d.token).toBeNull(); expect(d.refusal).toBe('unmeasured');
  }, 60_000);

  it('the token binds the tree’s own identity: the same tree recreated under its name mints another', () => {
    const t = claudeTree(); const a = audit(t);
    fs.renameSync(t, `${t}.old`); execFileSync('cp', ['-a', `${t}.old`, t]);
    const b = audit(t);
    fs.rmSync(`${t}.old`, { recursive: true, force: true });
    expect(a.token).toBeTruthy(); expect(b.verdict, b.detail).toBe('token');
    expect(b.token).not.toBe(a.token);
  }, 60_000);

  it('13 changed-recently: a 6-day-old change refuses, an 8-day-old one passes, and the file is read by ctime', () => {
    const t = claudeTree();
    const six = audit(t, stubs({ days: 6 }));
    expect(six.refusal, six.detail).toBe('changed-recently');
    expect(audit(t, stubs({ days: 8 })).verdict).toBe('token');
    const un = audit(t, stubs({ days: 'unmeasured' }));
    expect(un.verdict).toBe('unmeasured');
  }, 60_000);

  it('13 under pressure the floor is 3 days when `_disk_pressure` exists, and 7 days when it does not', () => {
    const t = claudeTree();
    const none = audit(t, stubs({ days: 4 }));
    expect(none.refusal).toBe('changed-recently');
    const under = audit(t, `_disk_pressure() { return 0; }; ${stubs({ days: 4 })}`);
    expect(under.verdict, under.detail).toBe('token');
    expect(under.floorS).toBe(259200);
  }, 60_000);

  it('14 paused: the fleet-wide pause, asked last', () => {
    const t = claudeTree(); fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(audit(t).refusal).toBe('paused');
  }, 60_000);

  it('the real idle walk, where this box has one: a fresh tree is changed-recently', () => {
    if (process.platform !== 'linux') return;
    const t = claudeTree();
    const d = audit(t, stubs({ days: 'real' }));
    expect(d.refusal, d.detail).toBe('changed-recently');
  }, 60_000);

  it('bad hex is a usage error, never an audit of some other path', () => {
    expect(() => h.sh('_ws_orphan_audit zz')).toThrow();
    expect(() => h.sh('_ws_orphan_audit 2f746d70')).not.toThrow();   // "/tmp" is hex-clean; it is simply not a worktree
  }, 60_000);
});

interface Row { pathHex: string; class: string; project: string; branch: string | null; head: string; locked: boolean; prunable: boolean }
const census = (pre = ''): { truncated: boolean; rows: Row[] } =>
  JSON.parse(h.sh(`${pre} _ws_orphan_census`).trim()) as { truncated: boolean; rows: Row[] };

describe('the census', () => {
  it('classes for all three locations and other; a registered ccd-root tree is not listed; a stanza-less directory is not-a-worktree', () => {
    const a = ccdRoot('quiet-mesa'); const b = claudeTree(); const c = superTree(); const o = tree(path.join(h.home, 'elsewhere', 'x'));
    const reg = ccdRoot('live-one'); fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-live-one.uuid'), 'u\n');
    const ghost = path.join(wsroot(), 'demo', 'ghost'); fs.mkdirSync(ghost);
    const rows = census().rows; const cls = (p: string): string | undefined => rows.find((r) => r.pathHex === hex(p))?.class;
    expect(cls(a)).toBe('ccd-root'); expect(cls(b)).toBe('claude'); expect(cls(c)).toBe('superpowers'); expect(cls(o)).toBe('other');
    expect(cls(reg)).toBeUndefined();
    expect(cls(ghost)).toBe('not-a-worktree');
    expect(rows.find((r) => r.pathHex === hex(b))).toMatchObject({ project: 'demo', branch: 'claude/agent-a', locked: false, prunable: false });
    expect(rows.find((r) => r.pathHex === hex(b))!.head).toMatch(/^[0-9a-f]{40}/);
  }, 60_000);

  it('never lists a main checkout, and a detached tree has a null branch', () => {
    const t = claudeTree(); h.git(t, 'checkout', '--detach');
    const rows = census().rows;
    expect(rows.map((r) => r.pathHex)).not.toContain(hex(real(path.join(h.home, 'projects', 'demo'))));
    expect(rows.find((r) => r.pathHex === hex(t))!.branch).toBeNull();
  }, 60_000);

  it('a census past its bound answers truncated', () => {
    claudeTree('a1'); claudeTree('a2');
    const c = census('WS_ORPHAN_CENSUS_ROWS=1;');
    expect(c.truncated).toBe(true);
    expect(c.rows).toHaveLength(1);
    expect(census().truncated).toBe(false);
  }, 60_000);

  it('writes nothing under the registry', () => {
    claudeTree();
    const before = fs.readdirSync(path.join(h.home, '.cc-sessions')).sort();
    census();
    audit(claudeTree('b1'));
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).sort()).toEqual(before);
  }, 60_000);
});
