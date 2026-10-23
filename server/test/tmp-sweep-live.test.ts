// ccd-tmp-sweep's LIVE ARM and its enforcing size budget (fleet disk retention, DR-8, D-6620; spec 2026-10-23
// sections 2.1 and 2.1.1), driven against a FIXTURE HOME. The arm reaches into units the dead pass calls live, so
// every case has a fake claude (this file's own `exec -a` process) publishing the live uuid, exactly as
// tmp-sweep.test.ts does, and `CCD_TMP_SWEEP_CLAUDE_RE` names that fake alone: no real session can lend a case its
// uuid. Holders are asked of the REAL `ccd path-users --json` (a stub script that sources ccd's body), with real
// processes standing for a session's stragglers; the one case that needs ccd to fail swaps in a failing stub.
//
// TIME. `CCD_TMP_SWEEP_NOW` moves the sweep's clock (a test seam; the real script reads the wall clock). A file's
// ctime cannot be set, so the clock is put 30 days AHEAD of the wall and an entry's mtime/atime are set relative to
// that moved clock: its ctime then reads 30 days old, older than every floor under test, while mtime/atime say what
// the case needs. Size: `CCD_TMP_BUDGET_UNIT_BYTES` (test seam) is what one "GiB" is, so 20 and 15 "GiB" are 20 and
// 15 times 64 KiB and a fixture stays small. Pressure: `FAKE_DF_PCT` drives a stand-in `df`.
//
// Linux-only, for the script's own reason (it reads /proc; its timer never installs on the Darwin arm).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
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
const UID_ = process.getuid?.() ?? 0;
const U = {
  live: '11111111-1111-4111-8111-111111111111',
  unmapped: '22222222-2222-4222-8222-222222222222',
  dead: '33333333-3333-4333-8333-333333333333',
};
const PROJ = '-home-fixture-worktrees-project-a-lane-a';
const DAY = 86_400;
const HOUR = 3_600;
const UNIT = 65_536;
const BUDGET = 20 * UNIT;
const TARGET = 15 * UNIT;
const KB = 1024;
const NOW0 = Math.floor(Date.now() / 1000) + 30 * DAY;

let h: CcdHarness;
let procs: ChildProcess[] = [];
let held: Held[] = [];
beforeEach(() => { h = makeCcdHarness('ccrc-tmp-sweep-live-'); procs = []; held = []; });
afterEach(() => {
  for (const p of procs) { try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ } }
  for (const p of held) p.stop();
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
function fakeClaude(extraArgs = ''): number {
  const p = spawn('bash', ['-c', `exec -a ${FAKE_ARGV0} bash -c 'sleep 60; :' ${extraArgs}`],
    { cwd: h.home, env: { ...h.env(), CCD_TMP_SWEEP_CLAUDE_RE: `/${TAG}$` }, stdio: 'ignore', detached: true });
  procs.push(p);
  waitFor('fake claude exec', () => cmdline(p.pid!).startsWith(FAKE_ARGV0));
  return p.pid!;
}
const hold = (o: Parameters<typeof holdProc>[0]): Held => { const p = holdProc(o); held.push(p); return p; };

const home = (): string => h.home;
const root = (): string => path.join(h.home, 'claude-9999');
const unit = (u = U.live): string => path.join(root(), PROJ, u);
const reg = (): string => path.join(h.home, '.cc-sessions');
const censusPath = (): string => path.join(h.home, '.ccrc', 'tmp-sweep.json');
const armPath = (): string => path.join(h.home, '.ccrc', 'tmp-sweep-live-arm');
const quarantine = (): string => path.join(root(), '.ccd-tmp-quarantine');

/** The live fixture: a fake claude publishing U.live, and a registry row (`ws-a`) mapping that uuid to an id. */
function liveSession(): number {
  fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
  fs.mkdirSync(path.join(h.home, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(unit(), 'scratchpad'), { recursive: true });
  fs.mkdirSync(path.join(unit(), 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(reg(), 'ws-a.uuid'), `${U.live}\n`);
  const pid = fakeClaude();
  fs.writeFileSync(path.join(h.home, '.claude', 'sessions', `${pid}.json`),
    JSON.stringify({ pid, sessionId: U.live, cwd: '/home/fixture' }, null, 2));
  return pid;
}

const setTimes = (p: string, whenS: number): void => {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) for (const e of fs.readdirSync(p)) setTimes(path.join(p, e), whenS);
  if (st.isSymbolicLink()) fs.lutimesSync(p, whenS, whenS); else fs.utimesSync(p, whenS, whenS);
};
interface MkOpts { ageS: number; kb?: number; sub?: string; unitDir?: string; atimeAgeS?: number }
/** A top-level entry of a unit's `scratchpad/` (or `tasks/`): a directory holding one file of `kb` KiB (1 by
 *  default), mtime and atime `ageS` before the fixture clock. Returns its path. */
function mk(name: string, o: MkOpts): string {
  const d = path.join(o.unitDir ?? unit(), o.sub ?? 'scratchpad', name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'data'), Buffer.alloc((o.kb ?? 1) * KB, 'x'));
  setTimes(d, NOW0 - o.ageS);
  if (o.atimeAgeS !== undefined) fs.utimesSync(path.join(d, 'data'), NOW0 - o.atimeAgeS, fs.statSync(path.join(d, 'data')).mtimeMs / 1000);
  return d;
}

const stubDir = (): string => path.join(h.home, 'stub');
/** `ccd`'s path-users entry as a stub: it sources ccd's body (as the suite's harness does) and answers the verb. */
function ccdStub(fail = false): string {
  fs.mkdirSync(stubDir(), { recursive: true });
  const f = path.join(stubDir(), fail ? 'ccd-fail' : 'ccd-real');
  fs.writeFileSync(f, fail ? '#!/bin/sh\nexit 1\n'
    : '#!/bin/bash\nexec 2>/dev/null\nverb="$1"; shift; args=("$@"); set --\n. "$CCD_SRC" || exit 1\n[ "$verb" = path-users ] || exit 2\ncmd_path_users "${args[@]}"\n', { mode: 0o755 });
  return f;
}

interface Run { code: number | null; out: string; err: string }
interface Census {
  v: number; at: number; liveAt: number | null; pressure: boolean; arm: string; seq: number;
  roots: { arm: string; path: string; noatime: boolean }[];
  sessions: { id: string; uuid: string; bytes: number; scratchBytes: number; tasksBytes: number; entries: number;
    budget: { state: string; overSince: number | null; enforceAt: number | null; removedBytes: number; kept: { name: string; why: string }[] } }[];
  moved: { seq: number; id: string; uuid: string; name: string; kind: string; bytes: number; at: number; shadow: boolean;
    quarantine: string | null; from: string }[];
  counts: Record<string, number>;
}
function sweep(o: { plusS?: number; env?: NodeJS.ProcessEnv; args?: string[]; stub?: string } = {}): Run {
  const r = spawnSync('bash', [SWEEP, ...(o.args ?? [])], {
    encoding: 'utf8', timeout: 120_000,
    env: {
      ...h.env(), CCD_SRC: CCD, CCD_TMP_SWEEP_ROOT: root(), CCD_TMP_SWEEP_CLAUDE_RE: `/${TAG}$`,
      TMPDIR: fs.realpathSync(path.dirname(h.home)), CCD_TMP_SWEEP_DF: fakeDf(h.home),
      CCD_TMP_SWEEP_TMP_BASE: path.join(h.home, 'no-tmp-base'), CCD_TMP_SWEEP_NOW: String(NOW0 + (o.plusS ?? 0)),
      CCD_TMP_SWEEP_CCD: o.stub ?? ccdStub(), CCD_TMP_BUDGET_UNIT_BYTES: String(UNIT), ...o.env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const census = (): Census => JSON.parse(fs.readFileSync(censusPath(), 'utf8')) as Census;
const arm = (): void => { fs.writeFileSync(armPath(), ''); };
const exists = (p: string): boolean => fs.existsSync(p);
const kids = (p: string): string[] => (exists(p) ? fs.readdirSync(p).sort() : []);
/** The quarantine's entries as `<uuid>/<name-after-the-ns>`. */
const quarantined = (): string[] => kids(quarantine()).flatMap((u) => kids(path.join(quarantine(), u)).map((e) => `${u}/${e.replace(/^\d+\./, '')}`));

describe('the live arm, in shadow and armed', () => {
  it('a live unit\'s old scratchpad entry is listed as would-move in shadow, and stays', () => {
    liveSession();
    const old = mk('old', { ageS: 20 * DAY });
    mk('fresh', { ageS: 1 * DAY });
    const r = sweep();
    expect(r.code, r.err).toBe(0);
    expect(exists(old)).toBe(true);
    const c = census();
    expect(c.arm).toBe('shadow');
    expect(c.moved.map((m) => [m.name, m.kind, m.shadow, m.quarantine])).toEqual([['old', 'scratch', true, null]]);
    expect(c.moved[0]!.id).toBe('ws-a');
    expect(c.moved[0]!.from).toBe(`${PROJ}/${U.live}/scratchpad/old`);
    expect(r.out).toMatch(/live arm \(shadow\): .*wouldMove 1/);
    expect(quarantined()).toEqual([]);
  }, 120_000);

  it('armed, it moves to the quarantine; a pass 24 h later deletes it', () => {
    liveSession();
    const old = mk('old', { ageS: 20 * DAY });
    arm();
    const r = sweep();
    expect(r.code, r.err).toBe(0);
    expect(exists(old), r.out + r.err).toBe(false);
    expect(quarantined()).toEqual([`${U.live}/old`]);
    expect(census().moved[0]).toMatchObject({ name: 'old', kind: 'scratch', shadow: false });
    expect(census().moved[0]!.quarantine).toContain(`${U.live}/`);
    const early = sweep({ plusS: 23 * HOUR });
    expect(early.code, early.err).toBe(0);
    expect(quarantined(), 'not yet: the grace is 24 h').toEqual([`${U.live}/old`]);
    const late = sweep({ plusS: 25 * HOUR });
    expect(late.code, late.err).toBe(0);
    expect(quarantined()).toEqual([]);
  }, 120_000);

  it('a quarantined entry held at the second pass stays', () => {
    liveSession();
    mk('old', { ageS: 20 * DAY });
    arm();
    sweep();
    const [q] = fs.readdirSync(path.join(quarantine(), U.live));
    hold({ cwd: path.join(quarantine(), U.live, q!) });
    const r = sweep({ plusS: 25 * HOUR });
    expect(r.code, r.err).toBe(0);
    expect(quarantined()).toEqual([`${U.live}/old`]);
    expect(census().counts['quarantineHeld']).toBe(1);
  }, 120_000);

  it('a file 1 day old deep under an old directory keeps the directory', () => {
    liveSession();
    const old = mk('old', { ageS: 20 * DAY });
    fs.mkdirSync(path.join(old, 'deep', 'er'), { recursive: true });
    fs.writeFileSync(path.join(old, 'deep', 'er', 'f'), 'x');
    setTimes(path.join(old, 'deep'), NOW0 - 20 * DAY);
    fs.utimesSync(path.join(old, 'deep', 'er', 'f'), NOW0 - DAY, NOW0 - DAY);
    arm();
    sweep();
    expect(exists(old)).toBe(true);
    expect(census().moved).toEqual([]);
  }, 120_000);

  it('a regular file read 2 days ago (atime) keeps it; on a noatime fixture atime is not read and the census says so', () => {
    liveSession();
    const e = mk('read-lately', { ageS: 20 * DAY, atimeAgeS: 2 * DAY });
    arm();
    sweep();
    expect(exists(e), 'atime keeps it').toBe(true);
    expect(census().roots[0]!.noatime).toBe(false);
    const mi = path.join(h.home, 'mountinfo');
    fs.writeFileSync(mi, '1 0 8:1 / / rw,noatime - ext4 /dev/fake rw\n');
    const r = sweep({ env: { CCD_TMP_SWEEP_MOUNTINFO: mi }, plusS: 7 * HOUR });
    expect(r.code, r.err).toBe(0);
    expect(exists(e), 'on a noatime mount only mtime and ctime count').toBe(false);
    expect(census().roots[0]!.noatime).toBe(true);
  }, 120_000);

  it('a metadata change (ctime) is a touch: an entry whose mtime and atime are old but whose inode changed just now stays', () => {
    liveSession();
    const real = Math.floor(Date.now() / 1000);
    const e = path.join(unit(), 'scratchpad', 'chmodded');
    fs.mkdirSync(e, { recursive: true });
    fs.writeFileSync(path.join(e, 'data'), 'x');
    setTimes(e, real - 20 * DAY);
    arm();
    // The clock is the wall clock here, so the ctime the utimes call just set reads as now.
    sweep({ plusS: -30 * DAY });
    expect(exists(e)).toBe(true);
    expect(census().moved).toEqual([]);
  }, 120_000);

  it('a directory\'s own atime is never read', () => {
    liveSession();
    const e = mk('listed-lately', { ageS: 20 * DAY });
    fs.utimesSync(e, NOW0 - HOUR, NOW0 - 20 * DAY);
    arm();
    sweep();
    expect(exists(e)).toBe(false);
  }, 120_000);

  it('an entry held by a file mapping keeps it (through ccd path-users)', () => {
    liveSession();
    const e = mk('mapped', { ageS: 20 * DAY });
    hold({ cwd: h.home, script: 'exec python3 -c "import mmap,sys,time; f=open(sys.argv[1],\'r+b\'); m=mmap.mmap(f.fileno(),0); f.close(); time.sleep(60)" "$1"', args: [path.join(e, 'data')] });
    waitFor('the mapping', () => held.some((x) => fs.readdirSync(`/proc/${x.pid}/map_files`).length > 0));
    arm();
    sweep();
    expect(exists(e)).toBe(true);
    expect(census().counts['held']).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('an entry held by a working directory keeps it, and its idle neighbour moves', () => {
    liveSession();
    const a = mk('held', { ageS: 20 * DAY });
    const b = mk('idle', { ageS: 20 * DAY });
    hold({ cwd: a });
    arm();
    sweep();
    expect(exists(a)).toBe(true);
    expect(exists(b)).toBe(false);
  }, 120_000);

  it('`scratchpad/` itself, `tasks/` itself and the unit are never candidates', () => {
    liveSession();
    mk('only', { ageS: 20 * DAY });
    mk('out.output', { ageS: 20 * DAY, sub: 'tasks' });
    fs.writeFileSync(path.join(unit(), 'stray'), 'x');
    setTimes(unit(), NOW0 - 20 * DAY);
    arm();
    sweep();
    expect(quarantined().sort()).toEqual([`${U.live}/only`, `${U.live}/out.output`]);
    expect(exists(path.join(unit(), 'scratchpad'))).toBe(true);
    expect(exists(path.join(unit(), 'tasks'))).toBe(true);
    expect(exists(path.join(unit(), 'stray'))).toBe(true);
  }, 120_000);

  it('a live unit whose uuid no row holds is live-unmapped, untouched', () => {
    liveSession();
    fakeClaude(`--resume ${U.unmapped}`);
    const e = mk('old', { ageS: 20 * DAY, unitDir: unit(U.unmapped) });
    arm();
    sweep();
    expect(exists(e)).toBe(true);
    expect(census().counts['liveUnmapped']).toBe(1);
    expect(census().sessions.map((s) => s.uuid)).not.toContain(U.unmapped);
  }, 120_000);

  it('`ccd path-users` failing keeps every candidate', () => {
    liveSession();
    const e = mk('old', { ageS: 20 * DAY });
    arm();
    const r = sweep({ stub: ccdStub(true) });
    expect(r.code, r.err).toBe(0);
    expect(exists(e)).toBe(true);
    expect(census().counts['holdersUnmeasured']).toBe(1);
    expect(census().moved).toEqual([]);
  }, 120_000);

  it('a missing ccd keeps every candidate too', () => {
    liveSession();
    const e = mk('old', { ageS: 20 * DAY });
    arm();
    sweep({ stub: path.join(h.home, 'no-such-ccd') });
    expect(exists(e)).toBe(true);
  }, 120_000);

  it('the census has seq rising across passes and keeps 1,000 rows', () => {
    liveSession();
    mk('a', { ageS: 20 * DAY });
    sweep();
    mk('b', { ageS: 20 * DAY });
    sweep({ plusS: 7 * HOUR });
    expect(census().moved.map((m) => m.seq)).toEqual([1, 2, 3].slice(0, census().moved.length));
    const seqs = census().moved.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
    const first = census();
    const rows = Array.from({ length: 1005 }, (_, i) => ({ ...first.moved[0]!, seq: first.seq + 1 + i, at: first.at }));
    fs.writeFileSync(censusPath(), JSON.stringify({ ...first, seq: first.seq + 1005, moved: rows }));
    sweep({ plusS: 14 * HOUR });
    const c = census();
    expect(c.moved.length).toBe(1000);
    expect(c.seq).toBeGreaterThan(first.seq + 1005);
    expect(c.moved.at(-1)!.seq).toBe(c.seq);
  }, 120_000);

  it('the live arm runs at most every 6 hours, and every pass under pressure', () => {
    liveSession();
    sweep();
    const at = census().liveAt;
    mk('later', { ageS: 20 * DAY });
    sweep({ plusS: 5 * HOUR });
    expect(census().liveAt, 'inside the cadence: no scan').toBe(at);
    expect(census().moved).toEqual([]);
    sweep({ plusS: 5 * HOUR + 60, env: { FAKE_DF_PCT: '93' } });
    expect(census().liveAt, 'under pressure every pass scans').not.toBe(at);
    expect(census().moved.map((m) => m.name)).toEqual(['later']);
  }, 120_000);

  it('under a fake df at 93%, the ages are the pressure ages', () => {
    liveSession();
    mk('four-days', { ageS: 4 * DAY });
    mk('two-days', { ageS: 2 * DAY });
    sweep();
    expect(census().moved).toEqual([]);
    sweep({ plusS: 7 * HOUR, env: { FAKE_DF_PCT: '93' } });
    expect(census().pressure).toBe(true);
    expect(census().moved.map((m) => m.name)).toEqual(['four-days']);
  }, 120_000);

  it('pressure is read from the filesystem, not assumed: 91% is not pressure, and an unreadable df is not either', () => {
    liveSession();
    mk('four-days', { ageS: 4 * DAY });
    sweep({ env: { FAKE_DF_PCT: '91' } });
    expect(census().pressure).toBe(false);
    expect(census().moved).toEqual([]);
    const bad = path.join(h.home, 'bad-df');
    fs.writeFileSync(bad, '#!/bin/sh\necho garbage\n', { mode: 0o755 });
    sweep({ plusS: 7 * HOUR, env: { CCD_TMP_SWEEP_DF: bad } });
    expect(census().pressure).toBe(false);
  }, 120_000);

  it('the pause file stops the live arm as it stops today\'s', () => {
    liveSession();
    mk('old', { ageS: 20 * DAY });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'tmp-sweep-paused'), '');
    arm();
    const r = sweep();
    expect(r.out).toMatch(/paused/);
    expect(exists(censusPath())).toBe(false);
    expect(quarantined()).toEqual([]);
  }, 120_000);

  it('--dry-run lists would-move rows and writes nothing', () => {
    liveSession();
    const e = mk('old', { ageS: 20 * DAY });
    arm();
    const r = sweep({ args: ['--dry-run'] });
    expect(r.out).toContain('would-move scratch ./');
    expect(exists(e)).toBe(true);
    expect(exists(censusPath())).toBe(false);
  }, 120_000);

  it('the dead pass leaves the quarantine alone, however old what is inside', () => {
    const pid = liveSession();
    mk('old', { ageS: 20 * DAY });
    arm();
    sweep();
    process.kill(pid, 'SIGKILL');
    fs.rmSync(path.join(h.home, '.claude', 'sessions', `${pid}.json`));
    setTimes(quarantine(), Math.floor(Date.now() / 1000) - 20 * DAY);   // every level of it, so the dead pass would call it stale
    const r = sweep({ plusS: HOUR });
    expect(r.code, r.err).toBe(0);
    expect(quarantined()).toEqual([`${U.live}/old`]);
  }, 120_000);

  it('the dead arm\'s age is the pressure age too, and only under measured pressure', () => {
    liveSession();
    const dead = path.join(unit(U.dead), 'scratchpad');
    fs.mkdirSync(dead, { recursive: true });
    fs.writeFileSync(path.join(dead, 'f'), 'x');
    setTimes(unit(U.dead), Math.floor(Date.now() / 1000) - 3 * DAY);
    const first = sweep();
    expect(first.code, first.err).toBe(0);
    expect(exists(unit(U.dead)), '3 days old is under the 7-day age').toBe(true);
    sweep({ env: { FAKE_DF_PCT: '93' } });
    expect(exists(unit(U.dead)), 'under pressure a dead unit goes at 2 days').toBe(false);
  }, 120_000);

  it('the roots: today\'s, /tmp/claude-<uid> when it differs, and a witnessed child leaf, each named in the census', () => {
    liveSession();
    const tmpRoot = path.join(h.home, 'tmp-base', `claude-${UID_}`);
    fs.mkdirSync(tmpRoot, { recursive: true });
    const leaf = path.join(h.home, '.cc-tmp', 'child-a', `claude-${UID_}`);
    fs.mkdirSync(leaf, { recursive: true });
    fs.mkdirSync(path.join(reg(), 'tmproots'), { recursive: true });
    fs.writeFileSync(path.join(reg(), 'tmproots', 'child-a'), 'v=1 id=child-a\n');
    const unwitnessed = path.join(h.home, '.cc-tmp', 'child-b', `claude-${UID_}`);
    fs.mkdirSync(unwitnessed, { recursive: true });
    const tmpUnit = path.join(tmpRoot, PROJ, U.live);
    const e1 = mk('in-tmp', { ageS: 20 * DAY, unitDir: tmpUnit });
    const e2 = mk('in-leaf', { ageS: 20 * DAY, unitDir: path.join(leaf, PROJ, U.live) });
    const e3 = mk('in-unwitnessed', { ageS: 20 * DAY, unitDir: path.join(unwitnessed, PROJ, U.live) });
    arm();
    const r = sweep({ env: { CCD_TMP_SWEEP_TMP_BASE: path.join(h.home, 'tmp-base') } });
    expect(r.code, r.err).toBe(0);
    const c = census();
    expect(c.roots.map((x) => x.arm)).toEqual(['primary', 'tmp', 'child']);
    expect(exists(e1)).toBe(false);
    expect(exists(e2)).toBe(false);
    expect(exists(e3), 'a leaf with no witness is not a root').toBe(true);
    expect(fs.readdirSync(path.join(leaf, '.ccd-tmp-quarantine', U.live)).length).toBe(1);
  }, 120_000);

  it('a root that is a link, or not ours, is not walked', () => {
    liveSession();
    const real = path.join(h.home, 'real-root');
    fs.mkdirSync(real, { recursive: true });
    fs.mkdirSync(path.join(h.home, 'tmp-base'), { recursive: true });
    fs.symlinkSync(real, path.join(h.home, 'tmp-base', `claude-${UID_}`));
    const e = mk('x', { ageS: 20 * DAY, unitDir: path.join(real, PROJ, U.live) });
    arm();
    sweep({ env: { CCD_TMP_SWEEP_TMP_BASE: path.join(h.home, 'tmp-base') } });
    expect(census().roots.map((x) => x.arm)).toEqual(['primary']);
    expect(exists(e)).toBe(true);
  }, 120_000);
});

describe('the size budget', () => {
  /** A session with entries of `kb` KiB each, ages in hours oldest first; returns their paths. */
  const sizes = (spec: [string, number, number][]): string[] => spec.map(([n, kb, ageH]) => mk(n, { ageS: ageH * HOUR, kb }));
  const session = (c: Census): Census['sessions'][number] => c.sessions.find((s) => s.uuid === U.live)!;

  it('over budget, first sighting: overSince and enforceAt are recorded, and nothing is moved (notice only)', () => {
    liveSession();
    const es = sizes([['a', 400, 6 * 24], ['b', 400, 5 * 24], ['c', 400, 4 * 24], ['d', 400, 3 * 24]]);
    arm();
    sweep();
    const b = session(census()).budget;
    expect(b.state).toBe('over');
    expect(b.overSince).toBeGreaterThan(0);
    expect(b.enforceAt).toBe(b.overSince! + 24 * HOUR * 1000);
    expect(es.every(exists)).toBe(true);
    expect(census().moved).toEqual([]);
  }, 120_000);

  it('still over 24 h later: the oldest unheld entries untouched for 48 h are moved oldest-first until under 15 GiB, and no further', () => {
    liveSession();
    const [a, b, c, d] = sizes([['a', 400, 6 * 24], ['b', 400, 5 * 24], ['c', 400, 4 * 24], ['d', 400, 3 * 24]]) as [string, string, string, string];
    arm();
    sweep();
    const r = sweep({ plusS: 25 * HOUR });
    expect(r.code, r.err).toBe(0);
    expect([a, b, c, d].map(exists)).toEqual([false, false, true, true]);
    const c2 = census();
    expect(c2.moved.map((m) => [m.name, m.kind, m.shadow])).toEqual([['a', 'budget', false], ['b', 'budget', false]]);
    expect(session(c2).bytes).toBeLessThanOrEqual(TARGET);
    expect(c2.moved.every((m) => m.bytes >= 400 * KB)).toBe(true);
    expect(session(c2).budget.removedBytes).toBe(c2.moved[0]!.bytes + c2.moved[1]!.bytes);
    expect(session(c2).budget.state).toBe('enforced');
  }, 120_000);

  it('an entry touched within 48 h is never moved even while the session stays over; the census reads over-unremovable and lists it with why', () => {
    liveSession();
    const [a, r1, r2] = sizes([['a', 400, 5 * 24], ['recent-1', 700, 1], ['recent-2', 700, 2]]) as [string, string, string];
    arm();
    sweep();
    sweep({ plusS: 25 * HOUR });
    expect([a, r1, r2].map(exists)).toEqual([false, true, true]);
    const b = session(census()).budget;
    expect(b.state).toBe('over-unremovable');
    expect(b.kept).toEqual([{ name: 'recent-2', why: 'touched-within-48h' }, { name: 'recent-1', why: 'touched-within-48h' }]);
    expect(b.overSince, 'the episode stays open').not.toBeNull();
  }, 120_000);

  it('a held entry is skipped, and the next-oldest is taken', () => {
    liveSession();
    const [a, b, c, d] = sizes([['a', 400, 6 * 24], ['b', 400, 5 * 24], ['c', 400, 4 * 24], ['d', 400, 3 * 24]]) as [string, string, string, string];
    hold({ cwd: a });
    arm();
    sweep();
    sweep({ plusS: 25 * HOUR });
    expect([a, b, c, d].map(exists)).toEqual([true, false, false, true]);
    expect(session(census()).budget.kept).toEqual([{ name: 'a', why: 'held' }]);
  }, 120_000);

  it('under a fake df at 93%: enforceAt equals overSince (no grace), and entries move on the first sighting', () => {
    liveSession();
    // 52 to 58 hours old: past the budget\'s 48 h floor, inside the 3-day pressure age of the plain arm.
    const es = sizes([['a', 400, 58], ['b', 400, 56], ['c', 400, 54], ['d', 400, 52]]);
    arm();
    const r = sweep({ env: { FAKE_DF_PCT: '93' } });
    expect(r.code, r.err).toBe(0);
    const b = session(census()).budget;
    expect(b.enforceAt).toBe(b.overSince);
    expect(es.map(exists)).toEqual([false, false, true, true]);
    expect(census().moved.every((m) => m.kind === 'budget')).toBe(true);
  }, 120_000);

  it('pressure that starts after the first sighting ends the grace at once', () => {
    liveSession();
    const es = sizes([['a', 400, 58], ['b', 400, 56], ['c', 400, 54], ['d', 400, 52]]);
    arm();
    sweep();
    expect(es.every(exists)).toBe(true);
    sweep({ plusS: HOUR, env: { FAKE_DF_PCT: '93' } });
    expect(es.map(exists)).toEqual([false, false, true, true]);
  }, 120_000);

  it('a child leaf\'s scratch counts toward its session', () => {
    liveSession();
    const leaf = path.join(h.home, '.cc-tmp', 'child-a', `claude-${UID_}`);
    fs.mkdirSync(path.join(reg(), 'tmproots'), { recursive: true });
    fs.writeFileSync(path.join(reg(), 'tmproots', 'child-a'), 'v=1 id=child-a\n');
    mk('p1', { ageS: 3 * DAY, kb: 400 });
    mk('p2', { ageS: 3 * DAY, kb: 400 });
    mk('l1', { ageS: 3 * DAY, kb: 400, unitDir: path.join(leaf, PROJ, U.live) });
    mk('l2', { ageS: 3 * DAY, kb: 400, unitDir: path.join(leaf, PROJ, U.live) });
    sweep();
    const s = session(census());
    expect(s.bytes).toBeGreaterThan(BUDGET);
    expect(s.budget.state, 'neither root alone is over; together they are').toBe('over');
  }, 120_000);

  it('quarantined bytes do not count', () => {
    liveSession();
    sizes([['a', 400, 6 * 24], ['b', 400, 5 * 24], ['c', 400, 4 * 24], ['d', 400, 3 * 24]]);
    arm();
    sweep();
    sweep({ plusS: 25 * HOUR });
    expect(quarantined().length).toBe(2);
    sweep({ plusS: 32 * HOUR });
    const s = session(census());
    expect(s.bytes, 'only the two entries that stayed').toBe(2 * (400 * KB + 4096));
    expect(s.budget.state, 'the 2 kept entries are under the budget: the episode ended').toBe('ok');
  }, 120_000);

  it('an entry holding a repository with an unpushed commit is kept as git-work-unrescued (before DR-20)', () => {
    liveSession();
    const [a] = sizes([['repo', 200, 6 * 24], ['b', 400, 5 * 24], ['c', 400, 4 * 24], ['d', 400, 3 * 24]]) as [string];
    const gitEnv = { ...h.env(), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' };
    execFileSync('git', ['-C', a, 'init', '-q'], { env: gitEnv });
    execFileSync('git', ['-C', a, 'add', '-A'], { env: gitEnv });
    execFileSync('git', ['-C', a, 'commit', '-q', '-m', 'work'], { env: gitEnv });
    setTimes(a, NOW0 - 6 * DAY);
    arm();
    sweep();
    sweep({ plusS: 25 * HOUR });
    expect(exists(a)).toBe(true);
    expect(session(census()).budget.kept[0]).toEqual({ name: 'repo', why: 'git-work-unrescued' });
    expect(census().moved.map((m) => m.name)).toEqual(['b', 'c']);
  }, 120_000);

  it('a repository whose work every remote has is taken like any entry', () => {
    liveSession();
    const [a] = sizes([['repo', 200, 6 * 24], ['b', 400, 5 * 24], ['c', 400, 4 * 24], ['d', 400, 3 * 24]]) as [string];
    const gitEnv = { ...h.env(), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' };
    const remote = path.join(h.home, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', remote], { env: gitEnv });
    execFileSync('git', ['-C', a, 'init', '-q'], { env: gitEnv });
    execFileSync('git', ['-C', a, 'add', '-A'], { env: gitEnv });
    execFileSync('git', ['-C', a, 'commit', '-q', '-m', 'work'], { env: gitEnv });
    execFileSync('git', ['-C', a, 'remote', 'add', 'origin', remote], { env: gitEnv });
    execFileSync('git', ['-C', a, 'push', '-q', 'origin', 'HEAD'], { env: gitEnv });
    execFileSync('git', ['-C', a, 'fetch', '-q', 'origin'], { env: gitEnv });
    setTimes(a, NOW0 - 6 * DAY);
    arm();
    sweep();
    sweep({ plusS: 25 * HOUR });
    expect(exists(a)).toBe(false);
  }, 120_000);

  it('under 15 GiB the episode ends; over 20 GiB again starts a new one', () => {
    liveSession();
    const es = sizes([['a', 400, 3 * 24], ['b', 400, 3 * 24], ['c', 400, 3 * 24], ['d', 400, 3 * 24]]);
    sweep();
    const first = session(census()).budget.overSince;
    expect(first).not.toBeNull();
    for (const e of es.slice(0, 3)) fs.rmSync(e, { recursive: true });
    sweep({ plusS: 7 * HOUR });
    expect(session(census()).budget).toMatchObject({ state: 'ok', overSince: null, enforceAt: null });
    sizes([['e', 400, 3 * 24], ['f', 400, 3 * 24], ['g', 400, 3 * 24]]);
    sweep({ plusS: 14 * HOUR });
    const again = session(census()).budget;
    expect(again.state).toBe('over');
    expect(again.overSince).toBeGreaterThan(first!);
  }, 120_000);

  it('between 15 and 20 GiB an open episode neither ends nor enforces', () => {
    liveSession();
    const es = sizes([['a', 400, 3 * 24], ['b', 400, 3 * 24], ['c', 400, 3 * 24], ['d', 400, 3 * 24]]);
    arm();
    sweep();
    fs.rmSync(es[0]!, { recursive: true });
    sweep({ plusS: 25 * HOUR });
    expect(es.slice(1).every(exists), 'under the budget: nothing is taken').toBe(true);
    expect(session(census()).budget.overSince, 'but above the target: still the same episode').not.toBeNull();
  }, 120_000);

  it('shadow: would-remove (budget) rows, nothing moved', () => {
    liveSession();
    const es = sizes([['a', 400, 6 * 24], ['b', 400, 5 * 24], ['c', 400, 4 * 24], ['d', 400, 3 * 24]]);
    sweep();
    sweep({ plusS: 25 * HOUR });
    expect(es.every(exists)).toBe(true);
    expect(census().moved.map((m) => [m.name, m.kind, m.shadow])).toEqual([['a', 'budget', true], ['b', 'budget', true]]);
    expect(quarantined()).toEqual([]);
  }, 120_000);

  it('an age-rule move comes first: the budget counts what it left', () => {
    liveSession();
    const [a, b] = sizes([['stale-1', 500, 20 * 24], ['stale-2', 500, 20 * 24], ['x', 400, 3 * 24]]) as [string, string, string];
    arm();
    sweep();
    expect([a, b].map(exists)).toEqual([false, false]);
    expect(session(census()).budget.state, '1.4 MB before the age rule, 400 KB after').toBe('ok');
  }, 120_000);

  it('the knobs can only be raised: a lowered budget is ignored, a raised one is honoured', () => {
    liveSession();
    sizes([['a', 400, 3 * 24], ['b', 400, 3 * 24]]);
    sweep({ env: { CCD_TMP_BUDGET_GB: '5', CCD_TMP_BUDGET_TARGET_GB: '1' } });
    expect(session(census()).budget.state, '800 KB is under 20 units; a lowered 5 is read as 20').toBe('ok');
    sizes([['c', 400, 3 * 24], ['d', 400, 3 * 24]]);
    sweep({ plusS: 7 * HOUR, env: { CCD_TMP_BUDGET_GB: '40' } });
    expect(session(census()).budget.state, '1.6 MB is under a raised 40 units').toBe('ok');
    sweep({ plusS: 14 * HOUR });
    expect(session(census()).budget.state).toBe('over');
  }, 120_000);

  it('a budget knob that is not a positive integer refuses the pass', () => {
    liveSession();
    const r = sweep({ env: { CCD_TMP_BUDGET_GB: 'lots' } });
    expect(r.code).toBe(1);
    expect(r.err).toContain('invalid-budget');
  }, 120_000);

  it('the census is replaced whole by a rename: no temp file is left beside it', () => {
    liveSession();
    sweep();
    expect(kids(path.join(h.home, '.ccrc')).filter((n) => n.includes('tmp-sweep.json'))).toEqual(['tmp-sweep.json']);
  }, 120_000);
});
