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
function proc(pid: number, o: { age: number; comm?: string; ppid?: number; cg?: string; sockets?: number[]; fdUnreadable?: boolean; netns?: string; statUnreadable?: boolean }): void {
  const d = path.join(fx.proc, String(pid));
  fs.mkdirSync(path.join(d, 'fd'), { recursive: true });
  fs.mkdirSync(path.join(d, 'ns'));
  const comm = o.comm ?? 'node';
  const ticks = (UP - o.age) * 100;
  // `pid (comm) state ppid …` with the start time as field 22 — the comm carries a space and a paren, as real ones can
  fs.writeFileSync(path.join(d, 'stat'), `${pid} (${comm}) S ${o.ppid ?? 1} ${pid} ${pid} 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 ${ticks} 1000 10 0\n`);
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
    encoding: 'utf8',
    env: { PATH: `${fx.bin}:${process.env['PATH'] ?? ''}`, HOME: fx.home, XDG_RUNTIME_DIR: fx.xdg,
      CCRC_PROC_ROOT: fx.proc, CCRC_CGROUP_ROOT: fx.cg, LC_ALL: 'C', ...env },
  });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const stops = (): string[] => (fs.existsSync(path.join(fx.base, 'calls')) ? fs.readFileSync(path.join(fx.base, 'calls'), 'utf8') : '')
  .split('\n').filter((l) => l.startsWith('--user stop'));
const rows = (kind: 'dead' | 'old'): Record<string, Record<string, string>> => {
  const out: Record<string, Record<string, string>> = {};
  if (!fs.existsSync(STATE())) return out;
  for (const l of fs.readFileSync(STATE(), 'utf8').split('\n')) {
    const p = l.split(' ');
    if (p[0] !== kind) continue;
    out[kind === 'dead' ? p[1]! : `${p[1]} ${p[2]}`] = Object.fromEntries(p.slice(2).map((kv) => kv.split('=') as [string, string]));
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
    expect(r.out).toMatch(/paused/);
    expect(stops()).toEqual([]);
    expect(fs.existsSync(path.join(fx.base, 'calls')), 'not even a list-units').toBe(false);
    expect(fs.readFileSync(STATE(), 'utf8')).toBe(before);
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
  /** Armed; the tick ends with a fresh header, `line` byte for byte, nothing stopped — and, when there is
   *  a companion, the companion judged that same tick (only THAT scope was skipped, not the tick). */
  const carried = (line: string, o: { companion?: string } = {}): void => {
    arm();
    const r = run();
    expect(r.code, r.err).toBe(0);
    const text = fs.readFileSync(STATE(), 'utf8').split('\n');
    expect(text[0], 'the tick ran to its end and rewrote the record').toMatch(new RegExp(`^# ccd-scope-sweep v1 tick=\\d{10} up=${UP} mode=live$`));
    expect(text).toContain(line);
    if (o.companion) expect(rows('dead')[o.companion]).toMatchObject({ verdict: 'report', why: 'dead-under-6h', first: String(UP) });
    expect(stops()).toEqual([]);
  };
  const one = (o: Parameters<typeof scope>[1] & { procOpts?: Parameters<typeof proc>[1] }): string => {
    proc(3001, o.procOpts ?? { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, o); seen(u, 7 * HOUR, 7255660000);
    return u;
  };

  it('a Description that does not parse', () => {
    one({ pane: 3001, procs: [3001], desc: unitName(1) });
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('a `systemctl show` that fails (or answers no Slice: a unit that vanished)', () => {
    one({ pane: 3001, procs: [3001] });
    fs.writeFileSync(path.join(fx.base, 'show-rc'), '1');
    carried(seenLines[0]!);
  });

  it('an empty ControlGroup — never the root cgroup\'s processes', () => {
    one({ pane: 3001, procs: [3001], cgShown: '' });
    fs.writeFileSync(path.join(fx.cg, 'cgroup.procs'), '3001\n');   // what a path built from an empty string would read
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('a ControlGroup that names another unit', () => {
    const other = '/user.slice/user-1000.slice/user@1000.service/app.slice/mekwar-ddb.service';
    one({ pane: 3001, procs: [3001], cgShown: other });
    fs.mkdirSync(path.join(fx.cg, other), { recursive: true });
    fs.writeFileSync(path.join(fx.cg, other, 'cgroup.procs'), '3001\n');
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('a CPUUsageNSec systemd does not report', () => {
    one({ pane: 3001, procs: [3001], cpuShown: '[not set]' });
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('an ActiveEnterTimestampMonotonic of 0', () => {
    one({ pane: 3001, procs: [3001], monoShown: '0' });
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('a cgroup.procs it cannot read — and a scope never seen before records nothing', () => {
    const u = scope(1, { pane: 3001, procs: [3001], noProcsFile: true }); seen(u, 7 * HOUR, 7255660000);
    const w = scope(2, { pane: 3002, procs: [3002], noProcsFile: true });
    const v = companion();
    carried(seenLines[0]!, { companion: v });
    expect(rows('dead')[w]).toBeUndefined();
  });

  it('an empty cgroup.procs', () => {
    one({ pane: 3001, procs: [] });
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('an fd directory it cannot read', () => {
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), fdUnreadable: true } });
    const v = companion();
    try { carried(seenLines[0]!, { companion: v }); } finally { fs.chmodSync(path.join(fx.proc, '3001', 'fd'), 0o755); }
  });

  it('a process in another network namespace, holding a socket these tables do not list', () => {
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), netns: 'net:[4026532999]', sockets: [999999] } });
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('a process in its cgroup.procs that has no /proc entry any more', () => {
    one({ pane: 3001, procs: [3001, 3002] });
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('a /proc/net/tcp it cannot read, holding the socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'tcp'), '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 424242 1 0000000000000000 100 0 0 10 0\n');
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [424242] } });
    fs.chmodSync(path.join(fx.proc, 'net', 'tcp'), 0o000);
    carried(seenLines[0]!);
  });

  it('a /proc/net/unix it cannot read, holding the listening socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'unix'), '0000000000000000: 00000002 00000000 00010000 0001 01 626262 /tmp/server.sock\n');
    one({ pane: 3001, procs: [3001], procOpts: { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [626262] } });
    fs.chmodSync(path.join(fx.proc, 'net', 'unix'), 0o000);
    carried(seenLines[0]!);
  });

  it('a process in it whose stat cannot be read', () => {
    one({ pane: 3001, procs: [3001, 3002] });
    proc(3002, { age: 2 * 86400, cg: cgOf(unitName(1)), statUnreadable: true });
    carried(seenLines[0]!);
  });

  it('a server pid whose comm cannot be read: it cannot be told a tmux server', () => {
    one({ pane: 3001, procs: [3001] });
    fs.chmodSync(path.join(fx.proc, String(CCD_SERVER), 'comm'), 0o000);
    const v = companion();
    carried(seenLines[0]!, { companion: v });
  });

  it('a server pid whose stat cannot be read', () => {
    one({ pane: 3001, procs: [3001] });
    fs.chmodSync(path.join(fx.proc, String(CCD_SERVER), 'stat'), 0o000);
    carried(seenLines[0]!);
  });

  it('a process ELSEWHERE on the box whose stat cannot be read: it could be a child of this scope', () => {
    one({ pane: 3001, procs: [3001] });
    proc(3500, { age: 2 * 86400, statUnreadable: true });
    carried(seenLines[0]!);
  });

  it('with no ccd server answering (tmux: no server running), a scope of a server that still RUNS cannot be judged', () => {
    fs.rmSync(path.join(fx.base, 'panes'));
    const u = inert(1); void u;
    const v = companion();
    carried(seenLines[0]!, { companion: v });
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
