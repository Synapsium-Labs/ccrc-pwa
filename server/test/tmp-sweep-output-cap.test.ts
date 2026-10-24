// ccd-tmp-sweep's OUTPUT CAP (fleet disk retention, DR-9, D-6621; spec 2026-10-23 section 2.1): on the live arm, a
// finished `tasks/*.output` file over the cap is rewritten as its head, one marker line and its tail. Driven against a
// FIXTURE HOME with the same fake claude, stub `ccd` and moved clock as tmp-sweep-live.test.ts (read its header).
//
// SCALE. `CCD_TMP_BUDGET_UNIT_BYTES` (the live arm's test seam) is what one "GiB" is: the cap is one unit and the kept
// head and tail are a sixteenth of a unit each (1 GiB and 64 MiB in production), so a "1.5 GiB" output is 96 KiB.
//
// Linux-only, for the script's own reason (it reads /proc; its timer never installs on the Darwin arm).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { holdProc, type Held } from './pathUsersFixture.js';
import { fakeDf } from './tmpSweepHelpers.js';

beforeEach((ctx) => { if (process.platform !== 'linux') ctx.skip(); });

const REPO = path.resolve(__dirname, '../..');
const SWEEP = path.join(REPO, 'ccd', 'ccd-tmp-sweep');
const TAG = `fakeclaude-${randomBytes(4).toString('hex')}`;
const FAKE_ARGV0 = `/opt/${TAG}`;
const LIVE_UUID = '11111111-1111-4111-8111-111111111111';
const PROJ = '-home-fixture-worktrees-project-a-lane-a';
const DAY = 86_400;
const HOUR = 3_600;
const UNIT = 65_536;
const KEEP = UNIT / 16;
const NOW0 = Math.floor(Date.now() / 1000) + 30 * DAY;

let h: CcdHarness;
let procs: ChildProcess[] = [];
let held: Held[] = [];
beforeEach(() => { h = makeCcdHarness('ccrc-tmp-sweep-cap-'); procs = []; held = []; });
afterEach(() => {
  for (const p of procs) { try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ } }
  for (const p of held) p.stop();
  try { fs.chmodSync(tasksDir(), 0o755); } catch { /* not made */ }
  h.cleanup();
});

function pause(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function waitFor(what: string, pred: () => boolean): void {
  for (let i = 0; i < 200; i += 1) { if (pred()) return; pause(25); }
  throw new Error(`fixture process never reached: ${what}`);
}
function cmdline(pid: number): string {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return ''; }
}
const root = (): string => path.join(h.home, 'claude-9999');
const unit = (): string => path.join(root(), PROJ, LIVE_UUID);
const tasksDir = (): string => path.join(unit(), 'tasks');
const censusPath = (): string => path.join(h.home, '.ccrc', 'tmp-sweep.json');

/** A fake claude publishing the live uuid, and a registry row (`ws-a`) mapping that uuid to an id. */
function liveSession(): void {
  fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
  fs.mkdirSync(path.join(h.home, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(unit(), 'scratchpad'), { recursive: true });
  fs.mkdirSync(tasksDir(), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.cc-sessions', 'ws-a.uuid'), `${LIVE_UUID}\n`);
  const p = spawn('bash', ['-c', `exec -a ${FAKE_ARGV0} bash -c 'sleep 60; :'`],
    { cwd: h.home, env: { ...h.env(), CCD_TMP_SWEEP_CLAUDE_RE: `/${TAG}$` }, stdio: 'ignore', detached: true });
  procs.push(p);
  waitFor('fake claude exec', () => cmdline(p.pid!).startsWith(FAKE_ARGV0));
  fs.writeFileSync(path.join(h.home, '.claude', 'sessions', `${p.pid}.json`),
    JSON.stringify({ pid: p.pid, sessionId: LIVE_UUID, cwd: '/home/fixture' }, null, 2));
}

/** `tasks/<name>`: `head` x KEEP bytes of 'a', the middle of 'm' up to `size`, and KEEP bytes of 'z' at the end;
 *  mtime and atime `ageS` before the fixture clock. */
function output(name: string, size: number, ageS: number): string {
  const f = path.join(tasksDir(), name);
  const buf = Buffer.alloc(size, 'm');
  buf.fill('a', 0, KEEP);
  buf.fill('z', size - KEEP);
  fs.writeFileSync(f, buf);
  fs.utimesSync(f, NOW0 - ageS, NOW0 - ageS);
  return f;
}

function ccdStub(fail = false): string {
  const d = path.join(h.home, 'stub');
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, fail ? 'ccd-fail' : 'ccd-real');
  fs.writeFileSync(f, fail ? '#!/bin/sh\nexit 1\n'
    : '#!/bin/bash\nexec 2>/dev/null\nverb="$1"; shift; args=("$@"); set --\n. "$CCD_SRC" || exit 1\n[ "$verb" = path-users ] || exit 2\ncmd_path_users "${args[@]}"\n',
  { mode: 0o755 });
  return f;
}

interface Census { moved: { name: string; kind: string; bytes: number; shadow: boolean; quarantine: string | null; from: string }[]; counts: Record<string, number> }
function sweep(o: { stub?: string } = {}): { code: number | null; out: string; err: string } {
  const r = spawnSync('bash', [SWEEP], {
    encoding: 'utf8', timeout: 120_000,
    env: {
      ...h.env(), CCD_SRC: CCD, CCD_TMP_SWEEP_ROOT: root(), CCD_TMP_SWEEP_CLAUDE_RE: `/${TAG}$`,
      TMPDIR: fs.realpathSync(path.dirname(h.home)), CCD_TMP_SWEEP_DF: fakeDf(h.home),
      CCD_TMP_SWEEP_TMP_BASE: path.join(h.home, 'no-tmp-base'), CCD_TMP_SWEEP_NOW: String(NOW0),
      CCD_TMP_SWEEP_CCD: o.stub ?? ccdStub(), CCD_TMP_BUDGET_UNIT_BYTES: String(UNIT),
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const census = (): Census => JSON.parse(fs.readFileSync(censusPath(), 'utf8')) as Census;
const arm = (): void => { fs.writeFileSync(path.join(h.home, '.ccrc', 'tmp-sweep-live-arm'), ''); };

describe('the output cap', () => {
  it('a 1.5 GiB finished output becomes head + marker + tail', () => {
    liveSession();
    const f = output('b1.output', 1.5 * UNIT, 2 * HOUR);
    const before = fs.statSync(f);
    arm();
    const r = sweep();
    expect(r.code, r.err).toBe(0);
    const got = fs.readFileSync(f);
    const cut = 1.5 * UNIT - 2 * KEEP;
    const text = got.toString('latin1');
    expect(text.slice(0, KEEP)).toBe('a'.repeat(KEEP));
    expect(text.slice(-KEEP)).toBe('z'.repeat(KEEP));
    const middle = text.slice(KEEP, -KEEP);
    expect(middle).toMatch(new RegExp(`^\\n\\[ccd-tmp-sweep: ${cut} bytes cut at \\d{4}-\\d\\d-\\d\\dT[\\d:]+Z\\]\\n$`));
    expect(middle.trim().split('\n')).toHaveLength(1);
    expect(got.length).toBeLessThan(before.size / 4);
    expect(Math.floor(fs.statSync(f).mtimeMs / 1000), 'a rewrite is not a touch').toBe(NOW0 - 2 * HOUR);
    expect(fs.readdirSync(tasksDir())).toEqual(['b1.output']);
    const c = census();
    expect(c.moved.map((m) => [m.name, m.kind, m.shadow, m.quarantine, m.bytes])).toEqual([['b1.output', 'output-capped', false, null, cut]]);
    expect(c.counts['capped']).toBe(1);
    expect(r.out).toMatch(/live arm \(live\): .*capped 1/);
    // a capped output is under the cap: the next pass leaves it alone
    sweep();
    expect(fs.readFileSync(f).equals(got)).toBe(true);
  }, 120_000);

  it('a held output is untouched', () => {
    liveSession();
    const f = output('held.output', 1.5 * UNIT, 2 * HOUR);
    const before = fs.readFileSync(f);
    held.push(holdProc({ cwd: h.home, holdOpen: f }));
    arm();
    const r = sweep();
    expect(r.code, r.err).toBe(0);
    expect(fs.readFileSync(f).equals(before)).toBe(true);
    expect(census().counts['held']).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('a holder probe that fails keeps the output', () => {
    liveSession();
    const f = output('doubt.output', 1.5 * UNIT, 2 * HOUR);
    const before = fs.readFileSync(f);
    arm();
    sweep({ stub: ccdStub(true) });
    expect(fs.readFileSync(f).equals(before)).toBe(true);
  }, 120_000);

  it('an output written 10 minutes ago is untouched', () => {
    liveSession();
    const f = output('busy.output', 1.5 * UNIT, 10 * 60);
    const before = fs.readFileSync(f);
    arm();
    sweep();
    expect(fs.readFileSync(f).equals(before)).toBe(true);
    expect(census().moved).toEqual([]);
  }, 120_000);

  it('a 900 MiB output is untouched', () => {
    liveSession();
    const f = output('small.output', Math.floor(0.9 * UNIT), 2 * HOUR);
    const before = fs.readFileSync(f);
    arm();
    sweep();
    expect(fs.readFileSync(f).equals(before)).toBe(true);
    expect(census().moved).toEqual([]);
  }, 120_000);

  it('only a regular file named *.output directly under tasks/ is capped', () => {
    liveSession();
    const other = output('big.log', 1.5 * UNIT, 2 * HOUR);
    const real = output('real.output', 1.5 * UNIT, 2 * HOUR);
    fs.rmSync(path.join(tasksDir(), 'link.output'), { force: true });
    fs.symlinkSync(real, path.join(tasksDir(), 'link.output'));
    fs.mkdirSync(path.join(tasksDir(), 'sub'));
    const nested = path.join(tasksDir(), 'sub', 'deep.output');
    fs.writeFileSync(nested, Buffer.alloc(1.5 * UNIT, 'm'));
    fs.utimesSync(nested, NOW0 - 2 * HOUR, NOW0 - 2 * HOUR);
    fs.utimesSync(path.join(tasksDir(), 'sub'), NOW0 - 2 * HOUR, NOW0 - 2 * HOUR);
    arm();
    sweep();
    expect(fs.statSync(other).size).toBe(1.5 * UNIT);
    expect(fs.statSync(nested).size).toBe(1.5 * UNIT);
    // (the symlink itself is an old scratch entry the age rule moves: not this arm, and it is never capped)
    expect(census().moved.filter((m) => m.kind === 'output-capped').map((m) => m.name)).toEqual(['real.output']);
  }, 120_000);

  it('shadow lists it and changes nothing', () => {
    liveSession();
    const f = output('b1.output', 1.5 * UNIT, 2 * HOUR);
    const before = fs.readFileSync(f);
    const r = sweep();
    expect(r.code, r.err).toBe(0);
    expect(fs.readFileSync(f).equals(before)).toBe(true);
    const c = census();
    expect(c.moved.map((m) => [m.name, m.kind, m.shadow])).toEqual([['b1.output', 'output-capped', true]]);
    expect(c.counts['wouldCap']).toBe(1);
    expect(r.out).toMatch(/would-move output-capped /);
  }, 120_000);

  it('a failed rewrite leaves the original byte-identical', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    liveSession();
    const f = output('b1.output', 1.5 * UNIT, 2 * HOUR);
    const before = fs.readFileSync(f);
    fs.chmodSync(tasksDir(), 0o555);   // the temp file cannot be made beside it, and an in-place write would still work
    arm();
    const r = sweep();
    expect(r.code, r.err).toBe(0);
    fs.chmodSync(tasksDir(), 0o755);
    expect(fs.readFileSync(f).equals(before)).toBe(true);
    expect(fs.readdirSync(tasksDir())).toEqual(['b1.output']);
    expect(census().counts['failed']).toBe(1);
    expect(census().counts['capped']).toBeUndefined();
  }, 120_000);
});
