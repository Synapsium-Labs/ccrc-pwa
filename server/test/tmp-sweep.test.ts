// ccd-tmp-sweep — the per-uid temp-dir reaper, driven against a FIXTURE root.
//
// Every run points CCD_TMP_SWEEP_ROOT at a mkTmp directory and HOME at a
// fixture home, so no case here can reach a real /tmp/claude-<uid> — the one
// directory on a box running this suite that must never be swept by a test.
// The "claude" processes are this file's own: `exec -a` renames a `sleep` to a
// unique argv[0], and CCD_TMP_SWEEP_CLAUDE_RE is pointed at that name alone, so
// a real Claude Code session on the same box can neither make a case refuse nor
// lend it a live session id.
//
// Linux-only, for the script's own reason (it reads /proc; its timer never
// installs on the Darwin arm) — the carve-out graph-sweep.test.ts makes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

beforeEach((ctx) => { if (process.platform !== 'linux') ctx.skip(); });

const REPO = path.resolve(__dirname, '../..');
const SWEEP = path.join(REPO, 'ccd', 'ccd-tmp-sweep');
const TAG = `fakeclaude-${randomBytes(4).toString('hex')}`;
const FAKE_ARGV0 = `/opt/${TAG}`;
const OLD = new Date(Date.now() - 10 * 86_400_000);

const U = {
  live: '11111111-1111-4111-8111-111111111111',
  cwd: '22222222-2222-4222-8222-222222222222',
  fd: '33333333-3333-4333-8333-333333333333',
  recent: '44444444-4444-4444-8444-444444444444',
  stale1: '55555555-5555-4555-8555-555555555555',
  stale2: '66666666-6666-4666-8666-666666666666',
  stale3: '77777777-7777-4777-8777-777777777777',
  argv: '88888888-8888-4888-8888-888888888888',
};
const PROJ = '-home-fixture-worktrees-ccrc-pwa-amber-summit';
const PROJ2 = '-home-fixture-projects-other';

// Every fixture process leads its OWN process group (`detached`), and is killed
// as a group: the fake claude and the lock holder each fork a child `sleep`,
// and killing only the parent would orphan it.
let procs: ChildProcess[] = [];
afterEach(() => {
  for (const p of procs) { try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ } }
  procs = [];
  removeTmpFixtures();
});

function pause(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function waitFor(what: string, pred: () => boolean): void {
  for (let i = 0; i < 200; i += 1) { if (pred()) return; pause(25); }
  throw new Error(`fixture process never reached: ${what}`);
}
function cmdline(pid: number): string {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return ''; }
}
/** A process whose argv[0] is this file's fake claude name. */
function fakeClaude(env: NodeJS.ProcessEnv, cwd: string, extraArgs = ''): number {
  const p = spawn('bash', ['-c', `exec -a ${FAKE_ARGV0} bash -c 'sleep 60; :' ${extraArgs}`],
    { cwd, env, stdio: 'ignore', detached: true });
  procs.push(p);
  waitFor('fake claude exec', () => cmdline(p.pid!).startsWith(FAKE_ARGV0));
  return p.pid!;
}

/** Everything at and under `p` set 10 days old, links as themselves. */
function ageTree(p: string, keep: Set<string>): void {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) for (const e of fs.readdirSync(p)) ageTree(path.join(p, e), keep);
  if (keep.has(p)) return;
  if (st.isSymbolicLink()) fs.lutimesSync(p, OLD, OLD); else fs.utimesSync(p, OLD, OLD);
}

interface Fixture { base: string; home: string; root: string; outside: string; env: NodeJS.ProcessEnv }

function fixture(): Fixture {
  const base = mkTmp('ccrc-tmp-sweep-');
  const home = path.join(base, 'home');
  const root = path.join(base, 'claude-9999');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'must survive\n');

  const sess = (proj: string, id: string, sub = 'scratchpad'): string => {
    const d = path.join(root, proj, id, sub);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'work.txt'), `${id}\n`);
    return d;
  };
  sess(PROJ, U.live);
  sess(PROJ, U.cwd);
  const fdDir = sess(PROJ, U.fd, 'tasks');
  fs.writeFileSync(path.join(fdDir, 'bg.output'), 'streaming\n');
  const recentDir = sess(PROJ, U.recent, 'tasks');
  sess(PROJ, U.stale1);
  sess(PROJ, U.stale2, 'tasks');
  sess(PROJ, U.argv);
  sess(PROJ2, U.stale3);
  // Loose entries straight in the root, two of them named like options — the
  // exact trap a manual run of these rules fell into.
  fs.writeFileSync(path.join(root, '-rf'), 'x\n');
  fs.writeFileSync(path.join(root, '--help'), 'x\n');
  fs.writeFileSync(path.join(root, 'loose-old.txt'), 'x\n');
  fs.mkdirSync(path.join(root, 'loosedir', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'loosedir', 'nested', 'f'), 'x\n');
  // A link out of the root: it goes, what it points at does not.
  fs.symlinkSync(outside, path.join(root, 'escape'));
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: home, CCD_TMP_SWEEP_ROOT: root,
    CCD_TMP_SWEEP_CLAUDE_RE: `/${TAG}$`, TMPDIR: fs.realpathSync(os.tmpdir()),
  };
  delete env['CCD_TMP_SWEEP_MAX_AGE_DAYS'];

  // Age everything, THEN write the two recent things, so the recent session's
  // DIRECTORIES stay 10 days old while one file deep inside is fresh: dir mtime
  // alone would call that session stale, which is the lie the script refuses.
  ageTree(root, new Set());
  ageTree(outside, new Set());
  const fresh = path.join(recentDir, 'still-writing.output');
  fs.writeFileSync(fresh, 'new\n');
  fs.utimesSync(recentDir, OLD, OLD);
  fs.writeFileSync(path.join(root, 'loose-recent.txt'), 'new\n');
  fs.utimesSync(root, OLD, OLD);
  return { base, home, root, outside, env };
}

/** The live/in-use half: a fake claude publishing U.live, a process sitting
 *  in U.cwd, and one holding an fd open inside U.fd. */
function occupy(f: Fixture): void {
  const pid = fakeClaude(f.env, f.home);
  // Pretty-printed on purpose: the reader must not depend on compact JSON.
  fs.writeFileSync(path.join(f.home, '.claude', 'sessions', `${pid}.json`),
    JSON.stringify({ pid, sessionId: U.live, cwd: '/home/fixture' }, null, 2));
  const inCwd = spawn('sleep', ['60'], { cwd: path.join(f.root, PROJ, U.cwd, 'scratchpad'), stdio: 'ignore', detached: true });
  procs.push(inCwd);
  const held = path.join(f.root, PROJ, U.fd, 'tasks', 'bg.output');
  const inFd = spawn('bash', ['-c', 'exec 3<"$1"; exec sleep 60', '_', held], { stdio: 'ignore', detached: true });
  procs.push(inFd);
  waitFor('cwd holder', () => cmdline(inCwd.pid!).startsWith('sleep'));
  waitFor('fd holder', () => cmdline(inFd.pid!).startsWith('sleep')
    && (() => { try { return fs.readlinkSync(`/proc/${inFd.pid}/fd/3`) === held; } catch { return false; } })());
  // The argv belt: a claude whose sessions file is absent but whose command
  // line names the session it resumed.
  fakeClaude(f.env, f.home, `--resume ${U.argv}`);
}

function run(f: Fixture, args: string[] = [], env: NodeJS.ProcessEnv = {}): { code: number; out: string; err: string } {
  const r = spawnSync('bash', [SWEEP, ...args], { encoding: 'utf8', env: { ...f.env, ...env } });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const exists = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch { return false; } };
const STALE = [
  `${PROJ}/${U.stale1}`, `${PROJ}/${U.stale2}`, `${PROJ2}/${U.stale3}`,
  '-rf', '--help', 'loose-old.txt', 'loosedir', 'escape',
];
const KEPT = [
  `${PROJ}/${U.live}`, `${PROJ}/${U.cwd}`, `${PROJ}/${U.fd}`, `${PROJ}/${U.recent}`, `${PROJ}/${U.argv}`,
  'loose-recent.txt',
];

describe('ccd-tmp-sweep: what a pass removes', () => {
  it('removes exactly the stale units — not the live, the in-use or the recent', () => {
    const f = fixture(); occupy(f);
    const r = run(f);
    expect(r.code, r.err).toBe(0);
    for (const u of STALE) expect(exists(path.join(f.root, u)), `${u} survived`).toBe(false);
    for (const u of KEPT) expect(exists(path.join(f.root, u)), `${u} was removed`).toBe(true);
    // The fresh file deep in the recent session is untouched, and so is
    // everything the escaping symlink pointed at.
    expect(exists(path.join(f.root, PROJ, U.recent, 'tasks', 'still-writing.output'))).toBe(true);
    expect(fs.readFileSync(path.join(f.outside, 'precious.txt'), 'utf8')).toBe('must survive\n');
    // PROJ2 lost its only session, so the pass rmdir'd it; PROJ still has five.
    expect(exists(path.join(f.root, PROJ2))).toBe(false);
    expect(exists(path.join(f.root, PROJ))).toBe(true);
    // ONE summary line, carrying the counts.
    const lines = r.out.trim().split('\n');
    expect(lines, r.out).toHaveLength(1);
    expect(lines[0]).toMatch(/^tmp-sweep: removed 8 unit\(s\) \(3 session dir\(s\), 5 loose\), freed \d+ MB; skipped 2 live, 2 in-use, 2 recent, 0 unreadable; 1 empty project dir\(s\) removed; 0 failed; max age 7d; root /);
  });

  it('--dry-run names exactly the stale units and removes nothing', () => {
    const f = fixture(); occupy(f);
    const r = run(f, ['--dry-run']);
    expect(r.code, r.err).toBe(0);
    const would = r.out.split('\n').filter((l) => l.startsWith('would-remove '))
      .map((l) => l.split(' ')[2]!.replace(/^\.\//, '')).sort();
    expect(would).toEqual([...STALE].sort());
    for (const u of [...STALE, ...KEPT]) expect(exists(path.join(f.root, u)), `${u} vanished in a dry run`).toBe(true);
    expect(r.out).toMatch(/^tmp-sweep: dry run: would remove 8 unit\(s\)/m);
  });

  it('the max age is a knob: at 30 days a 10-day-old unit is recent, and nothing goes', () => {
    const f = fixture(); occupy(f);
    const r = run(f, [], { CCD_TMP_SWEEP_MAX_AGE_DAYS: '30' });
    expect(r.code, r.err).toBe(0);
    for (const u of STALE) expect(exists(path.join(f.root, u)), `${u} was removed at 30 days`).toBe(true);
    expect(r.out).toMatch(/removed 0 unit\(s\)/);
  });

  it('with no claude running, an unreadable sessions dir is no reason to refuse', () => {
    const f = fixture();
    fs.rmSync(path.join(f.home, '.claude'), { recursive: true });
    const r = run(f);
    expect(r.code, r.err).toBe(0);
    expect(exists(path.join(f.root, PROJ, U.stale1))).toBe(false);
  });
});

describe('ccd-tmp-sweep: refusals and brakes', () => {
  it('FAILS CLOSED: claude is running and no sessions dir is readable, so nothing is removed', () => {
    const f = fixture();
    fs.rmSync(path.join(f.home, '.claude'), { recursive: true });
    fakeClaude(f.env, f.home);
    const r = run(f);
    expect(r.code).toBe(1);
    expect(r.err).toContain('no-sessions-dir');
    for (const u of STALE) expect(exists(path.join(f.root, u)), `${u} was removed by a refused pass`).toBe(true);
  });

  it('the pause file short-circuits the pass', () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.home, '.ccrc', 'tmp-sweep-paused'), '');
    const r = run(f);
    expect(r.code).toBe(0);
    expect(r.out).toContain('paused');
    for (const u of STALE) expect(exists(path.join(f.root, u))).toBe(true);
  });

  it('a pass holding the lock makes the next one stand down', () => {
    const f = fixture();
    const lock = path.join(f.home, '.ccrc', 'tmp-sweep.lock');
    const holder = spawn('flock', [lock, 'sleep', '60'], { stdio: 'ignore', detached: true });
    procs.push(holder);
    waitFor('lock holder', () => spawnSync('flock', ['-n', lock, 'true']).status !== 0);
    const r = run(f);
    expect(r.code).toBe(0);
    expect(r.out).toContain('another pass holds');
    for (const u of STALE) expect(exists(path.join(f.root, u))).toBe(true);
  });

  it('an invalid max age is a named refusal, not a guess', () => {
    const f = fixture();
    for (const v of ['abc', '0', '-3', '1.5', '']) {
      const r = run(f, [], { CCD_TMP_SWEEP_MAX_AGE_DAYS: v });
      if (v === '') { expect(r.code, 'an empty knob falls back to the default').toBe(0); continue; }
      expect(r.code, v).toBe(1);
      expect(r.err, v).toContain('invalid-max-age');
    }
    expect(exists(path.join(f.root, PROJ, U.stale1))).toBe(false);
  });

  it('a root that resolves outside /tmp and $TMPDIR is refused', () => {
    const f = fixture();
    const link = path.join(f.base, 'claude-link');
    fs.symlinkSync('/usr', link);
    const r = run(f, [], { CCD_TMP_SWEEP_ROOT: link });
    expect(r.code).toBe(1);
    expect(r.err).toContain('root-outside-tmp');
  });

  it('an absent root is a quiet no-op', () => {
    const f = fixture();
    const r = run(f, [], { CCD_TMP_SWEEP_ROOT: path.join(f.base, 'never-created') });
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
    expect(r.err).toBe('');
  });

  it('an unknown argument is a usage error', () => {
    const f = fixture();
    const r = run(f, ['--force']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('usage');
  });
});

describe('ccd-tmp-sweep ships the way ccd-graph-sweep does', () => {
  const SYSTEMD = path.join(REPO, 'deploy', 'systemd');
  const directives = (name: string): string[] => fs.readFileSync(path.join(SYSTEMD, name), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const deploySh = fs.readFileSync(path.join(REPO, 'deploy', 'deploy.sh'), 'utf8');
  const code = deploySh.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));


  it('the service is a budgeted, idle-priority oneshot running the installed copy', () => {
    const d = directives('ccd-tmp-sweep.service');
    expect(d).toContain('Type=oneshot');
    expect(d).toContain('ExecStart=%h/.local/bin/ccd-tmp-sweep');
    expect(d.some((l) => /^TimeoutStartSec=\d+$/.test(l)), 'no TimeoutStartSec').toBe(true);
    expect(d.some((l) => /^MemoryMax=\d+[KMG]$/.test(l)), 'no MemoryMax').toBe(true);
    expect(d).toContain('IOSchedulingClass=idle');
  });

  it('the timer is hourly and anchored to its own activation', () => {
    const d = directives('ccd-tmp-sweep.timer');
    expect(d).toContain('OnUnitActiveSec=1h');
    expect(d).toContain('OnActiveSec=10min');
    expect(d.filter((l) => l.startsWith('OnBootSec='))).toEqual([]);
  });

  it('deploy.sh installs it once, inside the agent branch, before the agent restart', () => {
    expect(code.filter((l) => l === 'install_atomic ccd/ccd-tmp-sweep .local/bin/ccd-tmp-sweep 755')).toHaveLength(1);
    const agentStart = deploySh.indexOf('if [ "$TARGET" = "agent" ]');
    const branch = deploySh.slice(agentStart, deploySh.indexOf('\nelse', agentStart));
    const restartAt = branch.indexOf('"${SSH[@]}" "$BOX" "$AGENT_CMD"');
    for (const needle of [
      'install_atomic ccd/ccd-tmp-sweep .local/bin/ccd-tmp-sweep 755',
      '_unit_atomic ~/ccrc/deploy/systemd/ccd-tmp-sweep.service ~/.config/systemd/user/ccd-tmp-sweep.service',
      '_unit_atomic ~/ccrc/deploy/systemd/ccd-tmp-sweep.timer ~/.config/systemd/user/ccd-tmp-sweep.timer',
      'systemctl --user enable --now ccd-tmp-sweep.timer',
    ]) {
      const at = branch.indexOf(needle);
      expect(at, `${needle} is not in the agent branch`).toBeGreaterThan(-1);
      expect(at, `${needle} must land before the agent restart`).toBeLessThan(restartAt);
    }
  });
});
