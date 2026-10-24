// ccd-tmp-sweep's TEST-RUN ARM (fleet disk retention, DR-10, D-6622; spec 2026-10-23 section 2.2), driven against a
// FIXTURE HOME. It removes a dead `ccrc-testrun-XXXXXX` root that no later run revisits: no socket bound at its
// `live.sock`, nothing under it changed (ctime) for 6 hours (1 under pressure), and `ccd path-users` answers nobody.
// It rides the live arm's marker, so every case that removes arms it with the fixture HOME's own marker file.
//
// TIME. A ctime cannot be set, so a fixture's ctime is the wall clock's and the sweep's clock (`CCD_TMP_SWEEP_NOW`)
// is put `quietS` AHEAD of it: the root then reads exactly that quiet. The kernel's socket table is the seam
// `CCD_TMP_SWEEP_UNIX` (a file in /proc/net/unix's shape), because a fixture path is often past a socket path's length.
// Pressure: `FAKE_DF_PCT` drives a stand-in `df`.
//
// Linux-only, for the script's own reason (it reads /proc; its timer never installs on the Darwin arm).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { holdProc, type Held } from './pathUsersFixture.js';
import { fakeDf } from './tmpSweepHelpers.js';

beforeEach((ctx) => { if (process.platform !== 'linux') ctx.skip(); });

const REPO = path.resolve(__dirname, '../..');
const SWEEP = path.join(REPO, 'ccd', 'ccd-tmp-sweep');
const HOUR = 3_600;
const DAY = 86_400;

let h: CcdHarness;
let held: Held[] = [];
beforeEach(() => { h = makeCcdHarness('ccrc-tmp-sweep-runs-'); held = []; fs.mkdirSync(base(), { recursive: true }); fs.mkdirSync(root(), { recursive: true }); });
afterEach(() => { for (const p of held) p.stop(); h.cleanup(); });

const base = (): string => path.join(h.home, 'tb');
const root = (): string => path.join(base(), 'claude-9999');
const reg = (): string => path.join(h.home, '.cc-sessions');
const censusPath = (): string => path.join(h.home, '.ccrc', 'tmp-sweep.json');
const arm = (): void => { fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true }); fs.writeFileSync(path.join(h.home, '.ccrc', 'tmp-sweep-live-arm'), ''); };
const exists = (p: string): boolean => fs.existsSync(p) || (() => { try { fs.lstatSync(p); return true; } catch { return false; } })();

/** A run root as `run-tmp.globalsetup.mjs` lays it out: a socket placeholder, owner.json and tmp/ with a file. */
function mkRun(parent: string, name = 'ccrc-testrun-aB3dE9'): string {
  const d = path.join(parent, name);
  fs.mkdirSync(path.join(d, 'tmp', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(d, 'live.sock'), '');
  fs.writeFileSync(path.join(d, 'owner.json'), '{}');
  fs.writeFileSync(path.join(d, 'tmp', 'fixture', 'f'), 'x'.repeat(2048));
  return d;
}
/** A child leaf: `<home>/.cc-tmp/<id>`, with its witness and (unless `row` is false) its registry row. */
function mkLeaf(id: string, o: { witness?: boolean; row?: boolean } = {}): string {
  const leaf = path.join(h.home, '.cc-tmp', id);
  fs.mkdirSync(leaf, { recursive: true });
  if (o.witness !== false) { fs.mkdirSync(path.join(reg(), 'tmproots'), { recursive: true }); fs.writeFileSync(path.join(reg(), 'tmproots', id), 'w\n'); }
  if (o.row !== false) fs.writeFileSync(path.join(reg(), `${id}.child`), '');
  return fs.realpathSync(leaf);
}
/** A kernel socket table in /proc/net/unix's shape, with one listener bound at each given path. */
let tables = 0;
function unixTable(bound: string[]): string {
  const f = path.join(h.home, `net-unix-${tables += 1}`);
  const rows = bound.map((p, i) => `0000000000000000: 00000002 00000000 00010000 0001 01 ${1000 + i} ${p}`);
  fs.writeFileSync(f, ['Num       RefCount Protocol Flags    Type St Inode Path', ...rows, ''].join('\n'));
  return f;
}
function ccdStub(fail = false): string {
  const f = path.join(h.home, 'stub-ccd');
  fs.writeFileSync(f, fail ? '#!/bin/sh\nexit 1\n'
    : '#!/bin/bash\nexec 2>/dev/null\nverb="$1"; shift; args=("$@"); set --\n. "$CCD_SRC" || exit 1\n[ "$verb" = path-users ] || exit 2\ncmd_path_users "${args[@]}"\n', { mode: 0o755 });
  return f;
}

interface Run { code: number | null; out: string; err: string }
interface Moved { name: string; kind: string; shadow: boolean; bytes: number; root: string; quarantine: string | null }
/** One pass with the sweep's clock `quietS` seconds past the wall clock. */
function sweep(quietS: number, o: { env?: NodeJS.ProcessEnv; stub?: string } = {}): Run {
  const r = spawnSync('bash', [SWEEP], {
    encoding: 'utf8', timeout: 120_000,
    env: {
      ...h.env(), CCD_SRC: CCD, CCD_TMP_SWEEP_ROOT: root(), CCD_TMP_SWEEP_CLAUDE_RE: '/no-such-claude-process$',
      TMPDIR: fs.realpathSync(base()), CCD_TMP_SWEEP_DF: fakeDf(h.home), CCD_TMP_SWEEP_TMP_BASE: path.join(h.home, 'no-tmp-base'),
      CCD_TMP_SWEEP_NOW: String(Math.floor(Date.now() / 1000) + quietS), CCD_TMP_SWEEP_UNIX: unixTable([]),
      CCD_TMP_SWEEP_CCD: o.stub ?? ccdStub(), ...o.env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const moved = (): Moved[] => (JSON.parse(fs.readFileSync(censusPath(), 'utf8')) as { moved: Moved[] }).moved.filter((m) => m.kind === 'test-run');
const counts = (): Record<string, number> => (JSON.parse(fs.readFileSync(censusPath(), 'utf8')) as { counts: Record<string, number> }).counts;

describe('the test-run arm', () => {
  it('a dead run root 7 h quiet goes, armed, and leaves a census row without a quarantine', () => {
    arm();
    const d = mkRun(base());
    const r = sweep(7 * HOUR);
    expect(r.code, r.err).toBe(0);
    expect(exists(d), r.out + r.err).toBe(false);
    expect(exists(`${d}.dead`)).toBe(false);
    expect(moved()).toMatchObject([{ name: 'ccrc-testrun-aB3dE9', kind: 'test-run', shadow: false, quarantine: null }]);
    expect(moved()[0]!.bytes).toBeGreaterThan(0);
    expect(r.out).toMatch(/moved test-run \.\/ccrc-testrun-aB3dE9/);
  }, 120_000);

  it('in shadow it lists the root as would-move and touches nothing', () => {
    const d = mkRun(base());
    const r = sweep(7 * HOUR);
    expect(r.code, r.err).toBe(0);
    expect(exists(path.join(d, 'tmp', 'fixture', 'f'))).toBe(true);
    expect(moved()).toMatchObject([{ name: 'ccrc-testrun-aB3dE9', shadow: true }]);
    expect(r.out).toMatch(/would-move test-run \.\/ccrc-testrun-aB3dE9/);
    expect(counts()['testRunWouldRemove']).toBe(1);
  }, 120_000);

  it('a run whose socket listens stays, under either spelling of its directory', () => {
    arm();
    const d = mkRun(base());
    const r = sweep(7 * HOUR, { env: { CCD_TMP_SWEEP_UNIX: unixTable([path.join(fs.realpathSync(d), 'live.sock')]) } });
    expect(r.code, r.err).toBe(0);
    expect(exists(d)).toBe(true);
    expect(counts()['testRunListening']).toBe(1);
    expect(moved()).toEqual([]);
    const abstract = sweep(7 * HOUR, { env: { CCD_TMP_SWEEP_UNIX: unixTable(['@' + path.join(d, 'live.sock')]) } });
    expect(abstract.code).toBe(0);
    expect(exists(d), 'an abstract-namespace socket is no listener at the path').toBe(false);
  }, 120_000);

  it('a REAL listener at live.sock (the kernel\'s own table) keeps the run; once it dies the run goes', () => {
    arm();
    const d = mkRun(base());
    const sock = path.join(d, 'live.sock');
    if (Buffer.byteLength(sock) > 100) return;   // past sun_path: the table-file case above covers the rule
    fs.rmSync(sock);
    const p: ChildProcess = spawn(process.execPath, ['-e', 'require("net").createServer().listen(process.argv[1]);setTimeout(()=>{},60000)', sock], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 200 && !fs.existsSync(sock); i += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      expect(fs.existsSync(sock), 'the listener bound').toBe(true);
      const r = sweep(7 * HOUR, { env: { CCD_TMP_SWEEP_UNIX: '/proc/net/unix' } });
      expect(r.code, r.err).toBe(0);
      expect(exists(d), r.out).toBe(true);
      expect(counts()['testRunListening']).toBe(1);
    } finally { p.kill('SIGKILL'); }
    for (let i = 0; i < 200 && fs.readFileSync('/proc/net/unix', 'utf8').includes(sock); i += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    sweep(7 * HOUR, { env: { CCD_TMP_SWEEP_UNIX: '/proc/net/unix' } });
    expect(exists(d), 'a dead owner\'s socket file is no listener').toBe(false);
  }, 120_000);

  it('a socket table that cannot be read keeps the run', () => {
    arm();
    const d = mkRun(base());
    sweep(7 * HOUR, { env: { CCD_TMP_SWEEP_UNIX: path.join(h.home, 'no-such-table') } });
    expect(exists(d)).toBe(true);
    expect(counts()['testRunUnmeasured']).toBe(1);
  }, 120_000);

  it('5 h quiet stays; 7 h goes; under pressure 2 h goes', () => {
    arm();
    const d = mkRun(base());
    sweep(5 * HOUR);
    expect(exists(d), '5 h is inside the 6 h window').toBe(true);
    expect(counts()['testRunRecent']).toBe(1);
    sweep(2 * HOUR, { env: { FAKE_DF_PCT: '93' } });
    expect(exists(d), 'the pressure window is 1 h').toBe(false);
  }, 120_000);

  it('an old mtime does not make a root quiet: its ctime is what counts', () => {
    arm();
    const d = mkRun(base());
    const old = Math.floor(Date.now() / 1000) - 20 * DAY;
    const back = (p: string): void => { if (fs.lstatSync(p).isDirectory()) for (const e of fs.readdirSync(p)) back(path.join(p, e)); fs.utimesSync(p, old, old); };
    back(d);
    sweep(5 * HOUR);
    expect(exists(d)).toBe(true);
  }, 120_000);

  it('a held root stays (a working directory inside it)', () => {
    arm();
    const d = mkRun(base());
    held.push(holdProc({ cwd: path.join(d, 'tmp') }));
    sweep(7 * HOUR);
    expect(exists(d)).toBe(true);
    expect(counts()['testRunHeld']).toBe(1);
  }, 120_000);

  it('in shadow a held root is not listed either', () => {
    const d = mkRun(base());
    held.push(holdProc({ cwd: path.join(d, 'tmp') }));
    sweep(7 * HOUR);
    expect(moved()).toEqual([]);
    expect(counts()['testRunHeld']).toBe(1);
  }, 120_000);

  it('the root is renamed to its .dead twin before anything is removed from it', () => {
    arm();
    const d = mkRun(base());
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'rm'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${path.join(h.home, 'rm.log')}'\nexit 0\n`, { mode: 0o755 });
    sweep(7 * HOUR, { env: { PATH: `${shim}:${process.env['PATH'] ?? '/usr/bin:/bin'}` } });
    expect(exists(d), 'the original name is gone at once').toBe(false);
    expect(exists(`${d}.dead`), 'what remains carries the marker an interrupted removal is recognised by').toBe(true);
    expect(fs.readFileSync(path.join(h.home, 'rm.log'), 'utf8')).toContain(`-- ${d}.dead`);
  }, 120_000);

  it('a holder that appears after the first look is caught by the last one', () => {
    arm();
    const d = mkRun(base());
    // The first ask is answered truthfully (nobody); every later ask finds a straggler.
    const f = path.join(h.home, 'stub-ccd-late');
    const n = path.join(h.home, 'asks');
    fs.writeFileSync(f, `#!/bin/bash\nexec 2>/dev/null\nverb="$1"; shift; args=("$@"); set --\n[ "$verb" = path-users ] || exit 2\n`
      + `echo x >> '${n}'\nif [ "$(wc -l < '${n}')" -gt 1 ]; then for a in "\${args[@]}"; do [ "$a" = --json ] || printf '{"path":"%s","verdict":"held"}\\n' "$a"; done; exit 0; fi\n`
      + `. "$CCD_SRC" || exit 1\ncmd_path_users "\${args[@]}"\n`, { mode: 0o755 });
    sweep(7 * HOUR, { stub: f });
    expect(exists(d)).toBe(true);
    expect(counts()['testRunHeld']).toBe(1);
  }, 120_000);

  it('ccd path-users failing keeps the root', () => {
    arm();
    const d = mkRun(base());
    sweep(7 * HOUR, { stub: ccdStub(true) });
    expect(exists(d)).toBe(true);
    expect(counts()['testRunUnmeasured']).toBe(1);
  }, 120_000);

  it('a mid-removal .dead twin goes the same way, and a name that only looks close is untouched', () => {
    arm();
    const twin = mkRun(base(), 'ccrc-testrun-zZ9aB1.dead');
    const looks = ['ccrc-testrun-abc', 'ccrc-testrun-abcdefg', 'xccrc-testrun-abcdef', 'ccrc-testrun-abcdef.deadx', 'ccrc-testrun-abc_ef', 'ccrc-testrun-abcdef.dead.dead']
      .map((n) => mkRun(base(), n));
    sweep(7 * HOUR);
    expect(exists(twin)).toBe(false);
    for (const l of looks) expect(exists(l), l).toBe(true);
  }, 120_000);

  it('a link or a file named like a run is not followed or removed', () => {
    arm();
    const target = path.join(h.home, 'elsewhere');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep'), 'x');
    fs.symlinkSync(target, path.join(base(), 'ccrc-testrun-lnk123'));
    fs.writeFileSync(path.join(base(), 'ccrc-testrun-fil123'), 'x');
    sweep(7 * HOUR);
    expect(exists(path.join(target, 'keep'))).toBe(true);
    expect(exists(path.join(base(), 'ccrc-testrun-lnk123'))).toBe(true);
    expect(exists(path.join(base(), 'ccrc-testrun-fil123'))).toBe(true);
  }, 120_000);

  it('a witnessed child leaf with a row is swept; a leaf with no row, or no witness, is not this arm\'s', () => {
    arm();
    const live = mkRun(mkLeaf('ws-live'));
    const norow = mkRun(mkLeaf('ws-norow', { row: false }));
    const nowit = mkRun(mkLeaf('ws-nowit', { witness: false, row: false }));
    const r = sweep(7 * HOUR);
    expect(r.code, r.err).toBe(0);
    expect(exists(live), 'the leaf with a row').toBe(false);
    expect(exists(norow), 'ws-collect takes a leaf whose row is gone').toBe(true);
    expect(exists(nowit)).toBe(true);
  }, 120_000);

  it('the pause file stops it, as it stops the rest of the pass', () => {
    arm();
    const d = mkRun(base());
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'tmp-sweep-paused'), '');
    sweep(7 * HOUR);
    expect(exists(d)).toBe(true);
  }, 120_000);
});
