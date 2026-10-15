// ccd-scope-sweep — dead ccd pane scopes reported, the inert ones stopped, and
// the stop SHADOWED until the operator arms it (session-continuity spec §5.6
// item 2; wave 4). Every run is a FIXTURE: CCRC_PROC_ROOT and CCRC_CGROUP_ROOT
// point at trees this file writes, `systemctl`, `tmux` and `getconf` are stubs
// on PATH that log what they are asked, and HOME and XDG_RUNTIME_DIR are
// fixture directories. No case reaches the live user manager, a real /proc or a
// real tmux server, so the suite runs on any platform. Each case is red when
// its guard is removed (the plan's mutation table is the measurement).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const SWEEP = path.resolve(__dirname, '../../ccd/ccd-scope-sweep');
const SLICE = 'app-claude\\x2dsession.slice';
const UP = 100 * 86400;                  // the fixture box has been up 100 days: /proc/uptime, the sweep's clock
const HOUR = 3600;
const CCD_SERVER = 2000;
const NETNS = 'net:[4026531840]';        // the sweep's own network namespace, and every fixture process's unless it says otherwise

interface Fx { base: string; home: string; xdg: string; proc: string; cg: string; bin: string }
let fx: Fx;

beforeEach(() => {
  const base = mkTmp('ccrc-scope-sweep-');
  fx = { base, home: path.join(base, 'home'), xdg: path.join(base, 'xdg'), proc: path.join(base, 'proc'), cg: path.join(base, 'cg'), bin: path.join(base, 'bin') };
  for (const d of [path.join(fx.home, '.cc-sessions'), fx.xdg, path.join(fx.proc, 'net'), path.join(fx.proc, 'self', 'ns'), fx.cg, fx.bin, path.join(base, 'show')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(fx.proc, 'uptime'), `${UP}.25 1234.00\n`);
  fs.symlinkSync(NETNS, path.join(fx.proc, 'self', 'ns', 'net'));
  fs.writeFileSync(path.join(fx.proc, 'net', 'tcp'), '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n');
  for (const f of ['tcp6', 'udp', 'udp6']) fs.copyFileSync(path.join(fx.proc, 'net', 'tcp'), path.join(fx.proc, 'net', f));
  fs.writeFileSync(path.join(fx.proc, 'net', 'unix'), 'Num       RefCount Protocol Flags    Type St Inode Path\n');
  fs.writeFileSync(path.join(base, 'units'), '');
  const stub = (name: string, body: string): void => { fs.writeFileSync(path.join(fx.bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 }); };
  stub('systemctl', [
    `F=${JSON.stringify(base)}`,
    'echo "$*" >> "$F/calls"',
    '[ "$1" = --user ] || { echo "fixture systemctl: not --user: $*" >&2; exit 90; }',
    'case "$2" in',
    '  list-units) cat "$F/units"; exit 0 ;;',
    '  show) [ -f "$F/show-rc" ] && exit "$(cat "$F/show-rc")"',
    '        if [ -f "$F/show/$3" ]; then cat "$F/show/$3"; else printf "Id=%s\\nDescription=%s\\nSlice=\\nControlGroup=\\n" "$3" "$3"; fi; exit 0 ;;',
    '  stop) [ "$3" = --no-block ] || exit 91; [ -f "$F/stop-rc" ] && exit "$(cat "$F/stop-rc")"; exit 0 ;;',
    'esac',
    'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  stub('tmux', [
    `F=${JSON.stringify(base)}`,
    '[ "$1 $2" = "list-panes -a" ] || { echo "fixture tmux: unexpected argv: $*" >&2; exit 90; }',
    'if [ -f "$F/panes" ]; then cat "$F/panes"; exit 0; fi',
    'echo "no server running on /tmp/tmux-1000/default" >&2; exit 1',
  ].join('\n'));
  stub('getconf', '[ "$1" = CLK_TCK ] && { echo 100; exit 0; }; exit 1');
  server(CCD_SERVER, 10 * 86400);
  fs.writeFileSync(path.join(base, 'panes'), `${CCD_SERVER} 4242\n`);   // ccd's server is up, serving some other session's pane
});
afterEach(() => { removeTmpFixtures(); });

/** A process in the fixture /proc: started `age` seconds ago, in cgroup `cg`, holding `sockets` (inode numbers). */
function proc(pid: number, o: { age: number; comm?: string; ppid?: number; cg?: string; sockets?: number[]; fdUnreadable?: boolean; netns?: string; statUnreadable?: boolean; state?: string }): void {
  const d = path.join(fx.proc, String(pid));
  fs.mkdirSync(path.join(d, 'fd'), { recursive: true });
  fs.mkdirSync(path.join(d, 'ns'));
  const comm = o.comm ?? 'node';
  const ticks = (UP - o.age) * 100;
  const state = o.state ?? 'S';
  if (!/^[A-Z]$/.test(state)) throw new Error(`invalid fixture process state ${state}`);
  // `pid (comm) state ppid …` with the start time as field 22 — the comm carries a space and a paren, as real ones can
  fs.writeFileSync(path.join(d, 'stat'), `${pid} (${comm}) ${state} ${o.ppid ?? 1} ${pid} ${pid} 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 ${ticks} 1000 10 0\n`);
  fs.writeFileSync(path.join(d, 'comm'), `${comm}\n`);
  fs.writeFileSync(path.join(d, 'cgroup'), `0::${o.cg ?? '/elsewhere.scope'}\n`);
  fs.symlinkSync(o.netns ?? NETNS, path.join(d, 'ns', 'net'));
  (o.sockets ?? []).forEach((ino, i) => fs.symlinkSync(`socket:[${ino}]`, path.join(d, 'fd', String(10 + i))));
  fs.symlinkSync('/dev/null', path.join(d, 'fd', '0'));
  if (o.fdUnreadable) fs.chmodSync(path.join(d, 'fd'), 0o000);
  if (o.statUnreadable) fs.chmodSync(path.join(d, 'stat'), 0o000);
}
function server(pid: number, age: number, comm = 'tmux: server'): void { proc(pid, { age, comm, cg: '/ccrc-tmux-server.scope' }); }
const cgOf = (unit: string): string => `/user.slice/user-1000.slice/user@1000.service/app.slice/${SLICE}/${unit}`;
const unitName = (n: number): string => `tmux-spawn-0000000${n}-0000-4000-8000-000000000000.scope`;

/** A pane scope: listed, shown, its cgroup holding `procs`. `bornAgo` (and `monoOffset`, µs) date its
 *  ActiveEnterTimestampMonotonic; `cgShown`, `cpuShown` and `monoShown` replace what `show` answers. */
function scope(n: number, o: {
  pane: number; server?: number; procs: number[]; cpu?: number; mem?: number; bornAgo?: number; monoOffset?: number;
  slice?: string; desc?: string; unit?: string; noProcsFile?: boolean; cgShown?: string; cpuShown?: string; monoShown?: string;
}): string {
  const u = o.unit ?? unitName(n);
  const cg = cgOf(u);
  fs.appendFileSync(path.join(fx.base, 'units'), `${u} loaded active running tmux child pane\n`);
  const mono = (UP - (o.bornAgo ?? 9 * 86400)) * 1_000_000 + (o.monoOffset ?? 475_320);
  fs.writeFileSync(path.join(fx.base, 'show', u), [
    `Id=${u}`, `Slice=${o.slice ?? SLICE}`,
    `Description=${o.desc ?? `tmux child pane ${o.pane} launched by process ${o.server ?? CCD_SERVER}`}`,
    `ControlGroup=${o.cgShown ?? cg}`, `CPUUsageNSec=${o.cpuShown ?? o.cpu ?? 7255660000}`, `MemoryCurrent=${o.mem ?? 20 * 2 ** 20}`,
    `ActiveEnterTimestampMonotonic=${o.monoShown ?? mono}`,
  ].join('\n') + '\n');
  if (!o.noProcsFile) {
    fs.mkdirSync(path.join(fx.cg, cg), { recursive: true });
    fs.writeFileSync(path.join(fx.cg, cg, 'cgroup.procs'), o.procs.map((p) => `${p}\n`).join(''));
  }
  return u;
}
/** A dead ccd scope that passes every predicate, first seen seven hours ago with the same CPU it reads now. */
function inert(n: number, pid = 3000 + n): string {
  proc(pid, { age: 2 * 86400, cg: cgOf(unitName(n)) });
  const u = scope(n, { pane: pid, procs: [pid] });
  seen(u, 7 * HOUR, 7255660000);
  return u;
}
const STATE = (): string => path.join(fx.xdg, 'ccd-scope-sweep.state');
const seenLines: string[] = [];
/** A previous tick's line: first seen dead `ago` seconds ago on the sweep's boot-relative clock. */
function seen(u: string, ago: number, cpu: number, verdict = 'report'): void {
  seenLines.push(`dead ${u} first=${UP - ago} cpu0=${cpu} verdict=${verdict} why=dead-under-6h server=ccd procs=1 mem=1 sockets=0 youngest=1 oldest=1 age=1 pids=1`);
  fs.writeFileSync(STATE(), ['# ccd-scope-sweep v1 tick=1 up=1 mode=shadow', ...seenLines].join('\n') + '\n');
}
beforeEach(() => { seenLines.length = 0; });
const arm = (): void => fs.writeFileSync(path.join(fx.home, '.cc-sessions', 'scope-sweep-live'), '');
const livePanes = (...panes: number[]): void => fs.writeFileSync(path.join(fx.base, 'panes'), [4242, ...panes].map((p) => `${CCD_SERVER} ${p}\n`).join(''));

function run(env: Record<string, string | undefined> = {}): { code: number; out: string; err: string } {
  const r = spawnSync('bash', [SWEEP], {
    encoding: 'utf8', timeout: 30000,   // a sweep that spins (a parent cycle) is a red case, not a hung suite
    env: { PATH: `${fx.bin}:${process.env['PATH'] ?? ''}`, HOME: fx.home, XDG_RUNTIME_DIR: fx.xdg,
      CCRC_PROC_ROOT: fx.proc, CCRC_CGROUP_ROOT: fx.cg, LC_ALL: 'C', ...env },
  });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const stops = (): string[] => (fs.existsSync(path.join(fx.base, 'calls')) ? fs.readFileSync(path.join(fx.base, 'calls'), 'utf8') : '')
  .split('\n').filter((l) => l.startsWith('--user stop'));
const rows = (kind: 'dead' | 'old' | 'carry'): Record<string, Record<string, string>> => {
  const out: Record<string, Record<string, string>> = {};
  if (!fs.existsSync(STATE())) return out;
  for (const l of fs.readFileSync(STATE(), 'utf8').split('\n')) {
    const p = l.split(' ');
    if (p[0] !== kind) continue;
    out[kind === 'old' ? `${p[1]} ${p[2]}` : p[1]!] = Object.fromEntries(p.slice(2).map((kv) => kv.split('=') as [string, string]));
  }
  return out;
};

// ── THE STOP SHIPS SHADOWED ─────────────────────────────────────────────────

describe('the stop is shadowed: recorded `would-stop` until the operator arms scope-sweep-live', () => {
  it('a dead ccd scope inert for six hours, with no scope-sweep-live: would-stop, and NEVER a stop call', () => {
    const u = inert(1);
    const r = run();
    expect(r.code, r.err).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ verdict: 'would-stop', why: 'none', server: 'ccd', sockets: '0', oldest: String(2 * 86400), age: String(9 * 86400) });
    expect(stops()).toEqual([]);
    expect(fs.readFileSync(STATE(), 'utf8').split('\n')[0]).toMatch(new RegExp(`^# ccd-scope-sweep v1 tick=\\d+ up=${UP} mode=shadow$`));
  });

  it('the same scope with scope-sweep-live: one `systemctl --user stop --no-block`, recorded `stopped`', () => {
    const u = inert(1); arm();
    expect(run().code).toBe(0);
    expect(stops()).toEqual([`--user stop --no-block ${u}`]);
    expect(rows('dead')[u]!['verdict']).toBe('stopped');
    expect(fs.readFileSync(STATE(), 'utf8').split('\n')[0]).toMatch(/ mode=live$/);
  });

  it('a stop systemd refuses is recorded `stop-failed`', () => {
    const u = inert(1); arm(); fs.writeFileSync(path.join(fx.base, 'stop-rc'), '1');
    run();
    expect(rows('dead')[u]!['verdict']).toBe('stop-failed');
  });

  it('armed, one tick stops at most three scopes: a fourth inert one is `held` for the next tick', () => {
    const us = [1, 2, 3, 4].map((n) => inert(n)); arm();
    expect(run().code).toBe(0);
    expect(stops()).toHaveLength(3);
    expect(us.map((u) => rows('dead')[u]!['verdict']).sort()).toEqual(['held', 'stopped', 'stopped', 'stopped']);
  });

  it('scope-sweep-paused stops EVERYTHING: nothing measured, recorded or stopped, armed or not', () => {
    inert(1); arm();
    fs.writeFileSync(path.join(fx.home, '.cc-sessions', 'scope-sweep-paused'), '');
    const before = fs.readFileSync(STATE(), 'utf8');
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
    expect(r.err).toBe('');
    expect(stops()).toEqual([]);
    expect(fs.existsSync(path.join(fx.base, 'calls')), 'not even a list-units').toBe(false);
    expect(fs.readFileSync(STATE(), 'utf8')).toBe(before);
  });

  // A scope that started after this tick's /proc/uptime read (or a process forked after it) would age negative; doctor's
  // reader takes `age=${N}`, non-negative only, and would count the whole dead line unreadable. The writer clamps at 0.
  it('a scope (and a process) that started after the tick\'s uptime read: its ages clamp at 0, never a negative the doctor cannot read', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    proc(3002, { age: -3, ppid: 3001, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001, 3002], bornAgo: -2 });
    expect(run().code).toBe(0);
    const line = fs.readFileSync(STATE(), 'utf8').split('\n').find((l) => l.startsWith(`dead ${u} `))!;
    expect(line).toMatch(/ youngest=0 /);
    expect(line).toMatch(/ oldest=\d+ /);
    expect(line).toMatch(/ age=0 /);
    expect(line).not.toMatch(/=-/);
  });
});

// ── EACH PREDICATE ──────────────────────────────────────────────────────────

describe('each stop predicate, one at a time — the scope is reported, never stopped', () => {
  const reportedFor = (u: string, why: string): void => {
    arm();
    expect(run().code).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report' });
    expect(rows('dead')[u]!['why']!.split(',')).toContain(why);
    expect(stops()).toEqual([]);
  };

  it('first seen dead NOW: its clock starts at the box\'s uptime, and it says so once', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] });
    arm();
    const r = run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'dead-under-6h', first: String(UP) });
    expect(r.out).toContain(`${u} is dead`);
    expect(stops()).toEqual([]);
  });

  it('dead for five hours, not six', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 5 * HOUR, 7255660000);
    reportedFor(u, 'dead-under-6h');
  });

  it('dead a minute short of six hours: not yet', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 6 * HOUR - 60, 7255660000);
    reportedFor(u, 'dead-under-6h');
  });

  it('control: dead a minute past six hours, and everything else inert — would-stop', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 6 * HOUR + 60, 7255660000);
    run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'would-stop', why: 'none' });
  });

  it('its CPU moved since it was first seen dead', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001], cpu: 7255660001 }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'cpu-moved');
  });

  it('a process in it started in the last six hours', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) }); proc(3002, { age: 5 * HOUR, cg: cgOf(unitName(1)), ppid: 3001 });
    const u = scope(1, { pane: 3001, procs: [3001, 3002] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'process-started-under-6h');
  });

  it('a process in it started a minute short of six hours ago', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) }); proc(3002, { age: 6 * HOUR - 60, cg: cgOf(unitName(1)), ppid: 3001 });
    const u = scope(1, { pane: 3001, procs: [3001, 3002] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'process-started-under-6h');
  });

  it('control: its youngest process started a minute past six hours ago — would-stop', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) }); proc(3002, { age: 6 * HOUR + 60, cg: cgOf(unitName(1)), ppid: 3001 });
    const u = scope(1, { pane: 3001, procs: [3001, 3002] }); seen(u, 7 * HOUR, 7255660000);
    run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'would-stop', youngest: String(6 * HOUR + 60) });
  });

  it('a process in it holds a TCP socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'tcp'), '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 424242 1 0000000000000000 100 0 0 10 0\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [424242] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'socket');
  });

  it('a process in it holds a TCP6 socket (a server listening on ::)', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'tcp6'), '   0: 00000000000000000000000000000000:1F40 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 535353 1 0000000000000000 100 0 0 10 0\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [535353] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'socket');
  });

  it('a process in it holds a UDP socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'udp6'), '   0: 00000000000000000000000000000000:14E9 00000000000000000000000000000000:0000 07 00000000:00000000 00:00000000 00000000  1000        0 525252 2 0000000000000000 0\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [525252] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'socket');
  });

  it('a process in it holds a LISTENING Unix socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'unix'), '0000000000000000: 00000002 00000000 00010000 0001 01 626262 /tmp/server.sock\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [626262] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'socket');
  });

  it('control: a CONNECTED Unix socket (a client of something) does not hold it — would-stop', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'unix'), '0000000000000000: 00000003 00000000 00000000 0001 03 727272\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [727272] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'would-stop', sockets: '0' });
  });

  it('a process in it is the parent of a process in another cgroup', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    proc(3999, { age: 2 * 86400, ppid: 3001, cg: '/user.slice/user-1000.slice/user@1000.service/app.slice/mekwar-ddb.service' });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'parent-of-a-process-elsewhere');
  });

  it('control: a child in the SAME scope is not elsewhere — would-stop', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) }); proc(3002, { age: 2 * 86400, ppid: 3001, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001, 3002] }); seen(u, 7 * HOUR, 7255660000);
    run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'would-stop' });
  });

  it('a first-seen clock earlier than the scope itself is not believed: first seen now', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, UP - 1, 7255660000);   // first=1: before the scope (born 9 days ago) existed
    reportedFor(u, 'dead-under-6h');
    expect(rows('dead')[u]!['first']).toBe(String(UP));
  });

  it('a first-seen clock later than now is not believed either: first seen now', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, -HOUR, 7255660000);
    reportedFor(u, 'dead-under-6h');
    expect(rows('dead')[u]!['first']).toBe(String(UP));
  });
});

// ── WHAT THE SWEEP MUST NEVER STOP (the coordinator's ruling D) ─────────────

describe('what the sweep never stops, armed and inert or not', () => {
  it('ccd\'s own ccrc-tmux-server.scope, even listed with a pane Description: never recorded, never stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf('ccrc-tmux-server.scope') });
    const u = scope(1, { pane: 3001, procs: [3001], unit: 'ccrc-tmux-server.scope' }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(Object.keys(rows('dead'))).toEqual([]);
    expect(stops()).toEqual([]);
  });

  it('a scope of a LIVE tmux server that is not ccd\'s: never recorded, never stopped', () => {
    server(5000, 30 * 86400);
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, server: 5000, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it('a scope with a live pane of ccd\'s server is LIVE: its old entry drops, nothing stopped', () => {
    const u = inert(1); livePanes(3001);
    arm(); run();
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it('a scope whose server pid now names a process that started AFTER the scope: reported server-pid-reused, never stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    server(5000, 3 * 86400);                                        // a tmux server — but younger than the scope (born 9 days ago)
    const u = scope(1, { pane: 3001, server: 5000, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'server-pid-reused', server: 'reused' });
    expect(stops()).toEqual([]);
  });

  it('a scope whose server pid now names a process that is not a tmux server: reported, never stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    proc(5000, { age: 30 * 86400, comm: 'node' });
    const u = scope(1, { pane: 3001, server: 5000, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'server-pid-reused' });
    expect(stops()).toEqual([]);
  });

  it('ccd\'s server pid itself, recycled after the scope was born: reported, never stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001], bornAgo: 20 * 86400 }); seen(u, 7 * HOUR, 7255660000);
    livePanes(4242);                                                // ccd's server (born 10 days ago) is up, with other panes
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'server-pid-reused' });
    expect(stops()).toEqual([]);
  });

  it('control: ccd\'s server and a scope born in the SAME second, 35 ms apart — the server is ccd\'s, not reused', () => {
    // Pre-flight 5's measurement: a comparison in whole seconds reads ccd's own server as recycled.
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001], bornAgo: 10 * 86400, monoOffset: 35_000 });
    run();
    expect(rows('dead')[u]).toMatchObject({ server: 'ccd', why: 'dead-under-6h' });
  });

  it('a scope outside the session slice is not the sweep\'s', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001], slice: 'app.slice' }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it('control: a scope of a server that no longer runs IS ccd\'s, and an inert one is stopped when armed', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, server: 7777, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'stopped', server: 'gone' });
    expect(stops()).toEqual([`--user stop --no-block ${u}`]);
  });
});

// ── UNMEASURABLE SKIPS THE SCOPE (NOT THE TICK); LIVE RESETS ────────────────

describe('a value it cannot measure skips that scope for the tick — the old line carried, the tick run to its end', () => {
  /** A dead scope beside the unmeasurable one, measurable: first seen this tick (its server is gone). */
  const companion = (): string => {
    proc(3900, { age: 2 * 86400, cg: cgOf(unitName(9)) });
    return scope(9, { pane: 3900, server: 7777, procs: [3900] });
  };
  /** Armed; the tick ends with a fresh header and a carry row for `u` (never a dead row, never a stop) — and, when
   *  there is a companion, the companion judged that same tick (only THAT scope was skipped, not the tick). */
  const carried = (u: string, why: string, state: 'dead' | 'live' | 'unknown', o: { companion?: string } = {}): void => {
    arm();
    const r = run();
    expect(r.code, r.err).toBe(0);
    const text = fs.readFileSync(STATE(), 'utf8');
    expect(text.split('\n')[0]).toMatch(new RegExp(`^# ccd-scope-sweep v1 tick=\\d+ up=${UP} mode=live$`));
    expect(rows('dead')[u]).toBeUndefined();
    expect(rows('carry')[u]).toEqual({ state, first: String(UP - 7 * HOUR), cpu0: '7255660000', why });
    expect(stops()).toEqual([]);
    if (o.companion) expect(rows('dead')[o.companion]).toMatchObject({ verdict: 'report', why: 'dead-under-6h', first: String(UP) });
  };
  const one = (o: Parameters<typeof scope>[1] & { procOpts?: Parameters<typeof proc>[1] }): string => {
    proc(3001, o.procOpts ?? { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, o); seen(u, 7 * HOUR, 7255660000);
    return u;
  };

  it('a Description that does not parse', () => {
    one({ pane: 3001, procs: [3001], desc: unitName(1) });
    const v = companion();
    carried(unitName(1), 'description', 'unknown', { companion: v });
  });

  it('a `systemctl show` that fails (or answers no Slice: a unit that vanished)', () => {
    one({ pane: 3001, procs: [3001] });
    fs.writeFileSync(path.join(fx.base, 'show-rc'), '1');
    carried(unitName(1), 'unit-show', 'unknown');
  });

  it('an empty ControlGroup — never the root cgroup\'s processes', () => {
    one({ pane: 3001, procs: [3001], cgShown: '' });
    fs.writeFileSync(path.join(fx.cg, 'cgroup.procs'), '3001\n');   // what a path built from an empty string would read
    const v = companion();
    carried(unitName(1), 'control-group', 'unknown', { companion: v });
  });

  it('a ControlGroup that names another unit', () => {
    const other = '/user.slice/user-1000.slice/user@1000.service/app.slice/mekwar-ddb.service';
    one({ pane: 3001, procs: [3001], cgShown: other });
    fs.mkdirSync(path.join(fx.cg, other), { recursive: true });
    fs.writeFileSync(path.join(fx.cg, other, 'cgroup.procs'), '3001\n');
    const v = companion();
    carried(unitName(1), 'control-group', 'unknown', { companion: v });
  });

  it('a CPUUsageNSec systemd does not report', () => {
    one({ pane: 3001, procs: [3001], cpuShown: '[not set]' });
    const v = companion();
    carried(unitName(1), 'cpu', 'unknown', { companion: v });
  });

  it('an ActiveEnterTimestampMonotonic of 0', () => {
    one({ pane: 3001, procs: [3001], monoShown: '0' });
    const v = companion();
    carried(unitName(1), 'scope-start', 'unknown', { companion: v });
  });

  it('a cgroup.procs it cannot read — and a scope never seen before records no dead verdict, only a clockless carry', () => {
    const u = scope(1, { pane: 3001, procs: [3001], noProcsFile: true }); seen(u, 7 * HOUR, 7255660000);
    const w = scope(2, { pane: 3002, procs: [3002], noProcsFile: true });
    const v = companion();
    carried(unitName(1), 'procs', 'unknown', { companion: v });
    expect(rows('dead')[w]).toBeUndefined();
    expect(rows('carry')[w]).toEqual({ state: 'unknown', first: 'none', cpu0: 'none', why: 'procs' });
  });

  it('an empty cgroup.procs', () => {
    one({ pane: 3001, procs: [] });
    const v = companion();
    carried(unitName(1), 'procs', 'unknown', { companion: v });
  });

  it('an fd directory it cannot read', () => {
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), fdUnreadable: true } });
    const v = companion();
    try { carried(unitName(1), 'socket-fd', 'dead', { companion: v }); } finally { fs.chmodSync(path.join(fx.proc, '3001', 'fd'), 0o755); }
  });

  it('a process in another network namespace, holding a socket these tables do not list', () => {
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), netns: 'net:[4026532999]', sockets: [999999] } });
    const v = companion();
    carried(unitName(1), 'socket-fd', 'dead', { companion: v });
  });

  it('a process in its cgroup.procs that has no /proc entry any more', () => {
    one({ pane: 3001, procs: [3001, 3002] });
    const v = companion();
    carried(unitName(1), 'socket-fd', 'dead', { companion: v });
  });

  it('a /proc/net/tcp it cannot read, holding the socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'tcp'), '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 424242 1 0000000000000000 100 0 0 10 0\n');
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [424242] } });
    fs.chmodSync(path.join(fx.proc, 'net', 'tcp'), 0o000);
    carried(unitName(1), 'socket-tables', 'dead');
  });

  it('a /proc/net/unix it cannot read, holding the listening socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'unix'), '0000000000000000: 00000002 00000000 00010000 0001 01 626262 /tmp/server.sock\n');
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [626262] } });
    fs.chmodSync(path.join(fx.proc, 'net', 'unix'), 0o000);
    carried(unitName(1), 'socket-tables', 'dead');
  });

  it('a process in it whose stat cannot be read', () => {
    one({ pane: 3001, procs: [3001, 3002] });
    proc(3002, { age: 2 * 86400, cg: cgOf(unitName(1)), statUnreadable: true });
    carried(unitName(1), 'box-stat', 'dead');
  });

  it('a server pid whose comm cannot be read: it cannot be told a tmux server', () => {
    one({ pane: 3001, procs: [3001] });
    fs.chmodSync(path.join(fx.proc, String(CCD_SERVER), 'comm'), 0o000);
    const v = companion();
    carried(unitName(1), 'server-comm', 'unknown', { companion: v });
  });

  it('a server pid whose stat cannot be read', () => {
    one({ pane: 3001, procs: [3001] });
    fs.chmodSync(path.join(fx.proc, String(CCD_SERVER), 'stat'), 0o000);
    carried(unitName(1), 'server-stat', 'unknown');
  });

  it('a process ELSEWHERE on the box whose stat cannot be read: it could be a child of this scope', () => {
    one({ pane: 3001, procs: [3001] });
    proc(3500, { age: 2 * 86400, statUnreadable: true });
    carried(unitName(1), 'box-stat', 'dead');
  });

  it('with no ccd server answering (tmux: no server running), a scope of a server that still RUNS cannot be judged', () => {
    fs.rmSync(path.join(fx.base, 'panes'));
    const u = inert(1); void u;
    const v = companion();
    carried(unitName(1), 'tmux-unknown', 'unknown', { companion: v });
  });

  it('a scope seen live drops its entry, so it dies again from zero', () => {
    const u = inert(1);
    livePanes(3001); run();
    expect(rows('dead')[u]).toBeUndefined();
    fs.writeFileSync(path.join(fx.base, 'panes'), `${CCD_SERVER} 9999\n`);   // the pane is gone again
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'dead-under-6h' });
    expect(stops()).toEqual([]);
  });

  it('with no XDG_RUNTIME_DIR it refuses: no clock can run, nothing is stopped', () => {
    inert(1); arm();
    const r = run({ XDG_RUNTIME_DIR: undefined });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no-runtime-dir/);
    expect(stops()).toEqual([]);
  });

  // ── Task 3's review (scope-sweep-child-cgroups-are-unmeasurable): a stop kills the scope's whole cgroup SUBTREE, and a scope's directory is user-writable ──

  const listener = (): void => {   // a double-forked TCP server (ppid 1), listening: the thing a stop must not kill unseen
    fs.appendFileSync(path.join(fx.proc, 'net', 'tcp'), '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 424242 1 0000000000000000 100 0 0 10 0\n');
    proc(3999, { age: 2 * 86400, ppid: 1, cg: cgOf(unitName(1)) + '/nested', sockets: [424242] });
  };
  const nested = (dir: string): void => {
    const d = path.join(fx.cg, cgOf(unitName(1)), dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'cgroup.procs'), '3999\n');
  };

  it('a scope whose cgroup holds a CHILD cgroup: its processes there are unseen by every predicate, so it is unmeasurable', () => {
    one({ pane: 3001, procs: [3001] });
    listener(); nested('nested');
    const v = companion();
    carried(unitName(1), 'child-cgroup', 'unknown', { companion: v });
  });

  // A scope's owner can chmod its own cgroup directory: cgroup.procs stays readable (the file's own mode), but a glob
  // of the directory sees nothing, which would read as "no child cgroup". A root test run bypasses mode bits.
  it.skipIf(process.getuid?.() === 0)('a cgroup directory the sweep cannot list (mode 0300, cgroup.procs still readable) hides a child cgroup: unmeasurable', () => {
    one({ pane: 3001, procs: [3001] });
    listener(); nested('nested');
    const dir = path.join(fx.cg, cgOf(unitName(1)));
    const v = companion();
    fs.chmodSync(dir, 0o300);
    try { carried(unitName(1), 'cgroup-dir', 'unknown', { companion: v }); } finally { fs.chmodSync(dir, 0o755); }
  });

  it('a child cgroup named like a dotfile is a child cgroup too', () => {
    one({ pane: 3001, procs: [3001] });
    listener(); nested('.hidden');
    const v = companion();
    carried(unitName(1), 'child-cgroup', 'unknown', { companion: v });
  });

  it('a Description whose server pid has a leading zero (process 007): /proc/007 is absent, which must not read as a server that is gone', () => {
    one({ pane: 3001, procs: [3001], desc: 'tmux child pane 3001 launched by process 007' });
    const v = companion();
    carried(unitName(1), 'description', 'unknown', { companion: v });
  });

  it('a socket fd link that exists but cannot be read: not "no socket"', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'tcp'), '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 424242 1 0000000000000000 100 0 0 10 0\n');
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [424242] } });
    // a readlink that fails for that one fd (EACCES on another uid's /proc/<pid>/fd/N) and answers the real one for every other path
    fs.writeFileSync(path.join(fx.bin, 'readlink'), '#!/usr/bin/env bash\ncase "$1" in */3001/fd/10) exit 1 ;; esac\nexec env PATH="${PATH#*:}" readlink "$@"\n', { mode: 0o755 });
    const v = companion();
    carried(unitName(1), 'socket-fd', 'dead', { companion: v });
  });

  it('a parent chain that loops (a recycled pid) in a live scope: capped, and the scope carried — never a spin to the unit\'s deadline', () => {
    proc(3001, { age: 3 * 86400, comm: 'claude', cg: cgOf(unitName(1)) });
    proc(3002, { age: 3 * 86400, ppid: 3003, comm: 'bash', cg: cgOf(unitName(1)) });
    proc(3003, { age: 3 * 86400, ppid: 3002, comm: 'bash', cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001, 3002, 3003] }); seen(u, 7 * HOUR, 7255660000);
    livePanes(3001);
    const v = companion();
    carried(unitName(1), 'parent-hop-cap', 'live', { companion: v });
    expect(Object.keys(rows('old')), 'a scope it could not walk lists nothing').toEqual([]);
  });
});

// ── A RECORD IT CANNOT BELIEVE: the clock starts now, as for an absent line (Task 3's review) ──

describe('a record line whose first=/cpu0= is out of bounds is not believed: the scope is first seen now', () => {
  const forged = (u: string, first: string, cpu0: string): void => {
    fs.writeFileSync(STATE(), `# ccd-scope-sweep v1 tick=1 up=1 mode=shadow\ndead ${u} first=${first} cpu0=${cpu0} verdict=report why=dead-under-6h server=ccd procs=1 mem=1 sockets=0 youngest=1 oldest=1 age=1 pids=1\n`);
  };
  it('a first= past 2^64 that WRAPS into the believable range (2^64 + UP - 30000): not believed, never a stop on the first tick', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] });
    forged(u, String(2n ** 64n + BigInt(UP - 30000)), '7255660000');
    arm();
    const r = run();
    expect(r.code, r.err).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'dead-under-6h', first: String(UP) });
    expect(stops()).toEqual([]);
  });
  it('a first= with a leading zero (08 is not a bash number): not believed, and the tick is not aborted', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] });
    forged(u, '08', '7255660000');
    arm();
    const r = run();
    expect(r.code, r.err).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'dead-under-6h', first: String(UP) });
    expect(stops()).toEqual([]);
  });
});

// ── DOCTOR'S LONG-LIVED PROCESSES IN A LIVE PANE SCOPE ──────────────────────

describe('the record lists every process older than a day in a live pane scope, but the pane\'s own and its MCP servers', () => {
  it('a background shell two hours after the pane, older than a day: listed; the pane and an MCP server (and its child) are not', () => {
    const u = unitName(1); const cg = cgOf(u);
    proc(3001, { age: 3 * 86400, comm: 'claude', cg });                         // the pane's own process
    proc(3002, { age: 3 * 86400 - 30, ppid: 3001, comm: 'npm exec mcp', cg });  // an MCP server: 30 s after the pane
    proc(3003, { age: 3 * 86400 - 30, ppid: 3002, comm: 'node', cg });          // its child
    proc(3004, { age: 3 * 86400 - 2 * HOUR, ppid: 3001, comm: 'bash', cg });    // a background shell, 2 h later
    proc(3005, { age: 3 * HOUR, ppid: 3001, comm: 'sleep', cg });               // younger than a day
    scope(1, { pane: 3001, procs: [3001, 3002, 3003, 3004, 3005] });
    livePanes(3001);
    run();
    expect(Object.keys(rows('old'))).toEqual([`${u} pid=3004`]);
    expect(rows('old')[`${u} pid=3004`]).toMatchObject({ comm: 'bash' });
    expect(rows('dead')[u]).toBeUndefined();
  });
});

// ── THE UNITS' DIRECTIVES ───────────────────────────────────────────────────
// ccrc-install compares the installed unit against the repo's own copy, so a
// changed value there goes unnoticed; these pin the values themselves, on
// tmp-sweep.test.ts's pattern.

describe('ccd-scope-sweep ships a budgeted oneshot on its own activation-anchored timer', () => {
  const SYSTEMD = path.resolve(__dirname, '../../deploy/systemd');
  const directives = (name: string): string[] => fs.readFileSync(path.join(SYSTEMD, name), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  it('the service is a deadline-bounded, memory-capped, nice oneshot running the installed copy', () => {
    const d = directives('ccd-scope-sweep.service');
    expect(d).toContain('Type=oneshot');
    expect(d).toContain('ExecStart=%h/.local/bin/ccd-scope-sweep');
    // The only bound on a hung `tmux list-panes`: systemd disables the start timeout for oneshot by default.
    expect(d).toContain('TimeoutStartSec=45');
    expect(d).toContain('MemoryMax=256M');
    expect(d).toContain('Nice=10');
  });

  it('the timer is every minute and anchored to its own activation, never to boot', () => {
    const d = directives('ccd-scope-sweep.timer');
    expect(d).toContain('OnActiveSec=2min');
    expect(d).toContain('OnUnitActiveSec=60s');
    expect(d.filter((l) => l.startsWith('OnBootSec='))).toEqual([]);
  });
});

describe('wave 4b residue: carries, zombies and complete record writes', () => {
  it('a retained carry clock is read back only after all predicates are measurable', () => {
    const u = inert(1);
    const child = path.join(fx.cg, cgOf(u), 'nested');
    fs.mkdirSync(child);
    arm();
    expect(run().code).toBe(0);
    expect(rows('carry')[u]).toEqual({ state: 'unknown', first: String(UP - 7 * HOUR), cpu0: '7255660000', why: 'child-cgroup' });
    expect(stops()).toEqual([]);
    fs.rmdirSync(child);
    expect(run().code).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ first: String(UP - 7 * HOUR), cpu0: '7255660000', verdict: 'stopped' });
    expect(stops()).toEqual([`--user stop --no-block ${u}`]);
  });

  it('a first-ever unmeasurable scope has no invented clock', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] });
    fs.mkdirSync(path.join(fx.cg, cgOf(u), 'nested'));
    expect(run().code).toBe(0);
    expect(rows('carry')[u]).toEqual({ state: 'unknown', first: 'none', cpu0: 'none', why: 'child-cgroup' });
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it.each(['none cpu0=7', '08 cpu0=7', '99999999999999999 cpu0=7', '123 cpu0=none'])('a malformed carry clock %s is not trusted', (clock) => {
    const u = inert(1);
    fs.writeFileSync(STATE(), `# ccd-scope-sweep v1 tick=1 up=1 mode=shadow\ncarry ${u} state=unknown first=${clock} why=child-cgroup\n`);
    arm();
    expect(run().code).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ first: String(UP), verdict: 'report', why: 'dead-under-6h' });
    expect(stops()).toEqual([]);
  });

  it.each(['Z', 'S'])('an outside child in state %s has the corresponding live-child verdict', (state) => {
    const u = inert(1);
    proc(3500, { age: 2 * 86400, ppid: 3001, state, cg: '/elsewhere.scope' });
    arm();
    expect(run().code).toBe(0);
    expect(rows('dead')[u]).toMatchObject(state === 'Z'
      ? { verdict: 'stopped', why: 'none' }
      : { verdict: 'report', why: 'parent-of-a-process-elsewhere' });
    expect(stops()).toEqual(state === 'Z' ? [`--user stop --no-block ${u}`] : []);
  });

  it('a valid empty replacement succeeds and removes an obsolete prior row', () => {
    fs.writeFileSync(STATE(), '# old complete record\n');
    const r = run();
    expect(r).toMatchObject({ code: 0, out: '', err: '' });
    expect(fs.readFileSync(STATE(), 'utf8')).toMatch(new RegExp(`^# ccd-scope-sweep v1 tick=\\d+ up=${UP} mode=shadow\\n$`));
  });

  it.each(['open', 'header', 'body', 'rename'])('a failed %s preserves the complete prior record and removes its own temporary', (where) => {
    inert(1);
    const before = fs.readFileSync(STATE(), 'utf8');
    const env: Record<string, string> = {};
    if (where === 'open') {
      // mktemp answers a file below a nonexistent fixture parent: open fails
      // even as root, creates no temporary, and never needs recursive cleanup.
      const tmp = path.join(`${STATE()}.open-failure`, 'record');
      fs.writeFileSync(path.join(fx.bin, 'mktemp'), `#!/usr/bin/env bash\nprintf '%s\\n' ${JSON.stringify(tmp)}\n`, { mode: 0o755 });
    } else if (where === 'rename') {
      fs.writeFileSync(path.join(fx.bin, 'mv'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
    } else {
      const file = path.join(fx.base, 'fail-write.bash');
      const pattern = where === 'header' ? "'# ccd-scope-sweep'*" : "'%s\\n'";
      fs.writeFileSync(file, `printf() { case "$1" in ${pattern}) return 1 ;; esac; builtin printf "$@"; }\n`);
      env.BASH_ENV = file;
    }
    const r = run(env);
    expect(r.code).toBe(1);
    expect(r.err).toContain('previous record retained');
    // Each failure says which guard caught it: an open failure also fails the later rename, so without this the open pin
    // would stay green with the write guard deleted (the rename guard alone would catch it).
    expect(r.err).toContain(where === 'rename' ? 'cannot replace verdict record' : 'cannot write verdict record');
    expect(fs.readFileSync(STATE(), 'utf8')).toBe(before);
    expect(fs.readdirSync(fx.xdg).filter((f) => f.startsWith('ccd-scope-sweep.state.'))).toEqual([]);
    expect(stops()).toEqual([]);
  });
});

// ── ROUND TRIP: the record the REAL sweep writes, read by both of its readers ──
// Every reader fixture elsewhere writes `why=none`; the reasons the sweep really emits carry digits
// (`dead-under-6h`, `process-started-under-6h`) and a reader whose reason class is `[a-z-]` rejects its
// own writer's most common row (fix round 1).
describe('the real sweep\'s record is readable by the doctor and the stage-6 instrument', () => {
  const DOCTOR = path.resolve(__dirname, '../../ccd/ccrc-doctor-checks');
  const TOOL = path.resolve(__dirname, '../../deploy/measure-continuity.py');
  /** Two dead scopes, written by the real sweep: one first seen now (`dead-under-6h`), one past six hours whose CPU
   *  moved and which holds a process younger than six hours (`cpu-moved,process-started-under-6h`). */
  const realRecord = (): string => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    scope(1, { pane: 3001, procs: [3001] });
    proc(3011, { age: 2 * 86400, cg: cgOf(unitName(2)) });
    proc(3012, { age: 5 * HOUR, ppid: 3011, cg: cgOf(unitName(2)) });
    const u2 = scope(2, { pane: 3011, procs: [3011, 3012], cpu: 7255660001 });
    seen(u2, 7 * HOUR, 7255660000);
    const r = run();
    expect(r.code, r.err).toBe(0);
    expect(rows('dead')[unitName(1)]).toMatchObject({ why: 'dead-under-6h' });
    expect(rows('dead')[u2]).toMatchObject({ why: 'cpu-moved,process-started-under-6h' });
    return STATE();
  };

  it('the doctor reads both rows as measured dead scopes, not as lines it cannot read', () => {
    const rec = realRecord();
    // The real `_check_scope-sweep`, cut out of the shipped file, with the verdict printers stubbed.
    const src = fs.readFileSync(DOCTOR, 'utf8').split('\n');
    const from = src.findIndex((l) => l.startsWith('_check_scope-sweep() {'));
    const to = src.findIndex((l, i) => i > from && l === '}');
    expect(from).toBeGreaterThan(-1);
    const fn = src.slice(from, to + 1).join('\n');
    const script = [
      '_dr_pass() { echo "PASS $1: $2"; return 0; }',
      '_dr_warn() { echo "WARN $1: $2"; echo "  remedy: $3"; return 2; }',
      '_dr_skip() { echo "SKIP $1: $2"; return 3; }',
      fn,
      '_check_scope-sweep',
    ].join('\n');
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env['PATH'] ?? '', HOME: fx.home, LC_ALL: 'C', CCRC_SCOPE_SWEEP_STATE: rec } });
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/^WARN scope-sweep: 2 dead pane scope\(s\) and 0 long-lived process\(es\)/);
    expect(r.stdout).not.toContain('cannot read');
    expect(r.stdout).toContain('(dead-under-6h)');
    expect(r.stdout).toContain('(cpu-moved,process-started-under-6h)');
  });

  it('the instrument counts both rows, and publishes counts rather than `unreadable`', () => {
    realRecord();
    const r = spawnSync('python3', ['-I', TOOL, '--home', fx.home, '--stage', '6', '--journal', path.join(fx.base, 'no-journal.json'), '--json'],
      { encoding: 'utf8', timeout: 30000, env: { PATH: process.env['PATH'] ?? '', TZ: 'UTC', XDG_RUNTIME_DIR: fx.xdg } });
    expect(r.status, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { stage6: { inert_scopes: unknown } }).stage6.inert_scopes)
      .toEqual({ mode: 'shadow', dead: 2, inert: 0, inert_dead_a_day_or_more: 0, carried_scopes: { dead: 0, live: 0, unknown: 0 } });
  });
});
