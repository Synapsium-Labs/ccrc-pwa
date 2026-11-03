// The pane-scope box: one FIXTURE a pane-scope act runs over (D-7303; ARCH-72, Task C5l; plan
// 2026-10-29-consolidation-k16-panescope-reader.md). Moved here from `scope-sweep.test.ts`, which imports it unchanged
// in meaning, so `cap-scopes.test.ts` and `pane-scope-acts.test.ts` run `ccd-cap-scopes` and `ccd-scope-sweep` over
// the same listed units. Every run is a FIXTURE: CCRC_PROC_ROOT and CCRC_CGROUP_ROOT point at trees this file
// writes, `systemctl`, `tmux` and `getconf` are stubs on PATH that log what they are asked, and HOME and
// XDG_RUNTIME_DIR are fixture directories. No case reaches the live user manager, a real /proc or a real tmux server.
//
// `makePaneScopeBox()` registers the `beforeEach` that builds a fresh tree and the `afterEach` that removes it, and
// returns the helpers over that tree; `fx` is one object whose fields each `beforeEach` re-points.
//
// THE STUB'S ANSWERS. `scope-sweep.test.ts` uses the first three; the rest answer the cap and are used by no case
// there:
//   - `list-units`: the fixture's `units` file, every line, WHATEVER the pattern argument, unless the box was made with
//     `honourPattern` (then only lines whose unit name matches the pattern). Off by default because the sweep's
//     `ccrc-tmux-server.scope` row needs a list that names that unit whatever the pattern. A `list-rc` file makes it
//     fail with that rc and a line on stderr;
//   - `show <u> -p … -p …` (the sweep's form): the fixture's `show/<u>`, or an empty-Slice answer; `show-rc` fails it;
//   - `stop --no-block <u>`: rc from `stop-rc`, default 0;
//   - `--plain`: a listed line's leading `● ` or two spaces are dropped; without it they stay;
//   - `show <u> -p MemoryMax --value`: the fixture's `memmax/<u>`, or the manager default `infinity` for a unit
//     marked `gone/<u>`, or nothing for a unit marked `empty/<u>`; a unit with none of those is born uncapped:
//     `infinity`;
//   - `set-property --runtime <u> …`: logged; rc from `setprop-rc/<u>`, default 0, and 1 for a `gone/<u>` unit. A
//     successful one records its `MemoryMax=` (in bytes) as `memmax/<u>`, so a second run sees the scope capped.
// Any other argv exits 90.
import { beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

export const SWEEP = path.resolve(__dirname, '../../ccd/ccd-scope-sweep');
export const CAP = path.resolve(__dirname, '../../ccd/ccd-cap-scopes');
export const SLICE = 'app-claude\\x2dsession.slice';
export const UP = 100 * 86400;                  // the fixture box has been up 100 days: /proc/uptime, the sweep's clock
export const HOUR = 3600;
export const CCD_SERVER = 2000;
export const NETNS = 'net:[4026531840]';        // the sweep's own network namespace, and every fixture process's unless it says otherwise

export interface Fx { base: string; home: string; xdg: string; proc: string; cg: string; bin: string }
export interface ProcOpts { age: number; comm?: string; ppid?: number; cg?: string; sockets?: number[]; fdUnreadable?: boolean; netns?: string; statUnreadable?: boolean; state?: string; threads?: number }
export interface ScopeOpts {
  pane: number; server?: number; procs: number[]; cpu?: number; mem?: number; bornAgo?: number; monoOffset?: number;
  slice?: string; desc?: string; unit?: string; noProcsFile?: boolean; cgShown?: string; cpuShown?: string; monoShown?: string;
}
export interface RunResult { code: number; out: string; err: string }

const SYSTEMCTL_STUB = (base: string): string => [
  `F=${JSON.stringify(base)}`,
  'echo "$*" >> "$F/calls"',
  '[ "$1" = --user ] || { echo "fixture systemctl: not --user: $*" >&2; exit 90; }',
  'case "$2" in',
  '  list-units)',
  '    [ -f "$F/list-rc" ] && { echo "Failed to list units: fixture" >&2; exit "$(cat "$F/list-rc")"; }',
  '    plain=0 pat=""',
  '    for a in "${@:3}"; do case "$a" in --plain) plain=1 ;; --*) ;; *) pat="$a" ;; esac; done',
  '    while IFS= read -r l || [ -n "$l" ]; do',
  '      n="${l#● }"; n="${n#  }"; n="${n%% *}"',
  '      if [ -f "$F/honour-pattern" ] && [ -n "$pat" ]; then [[ "$n" == $pat ]] || continue; fi',
  '      if [ "$plain" = 1 ]; then l="${l#● }"; l="${l#  }"; fi',
  '      echo "$l"   # not printf: a case\'s BASH_ENV may override printf in every bash child, this stub included',
  '    done < "$F/units"; exit 0 ;;',
  '  show) [ -f "$F/show-rc" ] && exit "$(cat "$F/show-rc")"',
  '        if [ "$#" = 6 ] && [ "$4 $5 $6" = "-p MemoryMax --value" ]; then',
  '          if [ -f "$F/memmax/$3" ]; then cat "$F/memmax/$3"; elif [ -f "$F/empty/$3" ]; then :; else echo infinity; fi; exit 0',
  '        fi',
  '        if [ -f "$F/show/$3" ]; then cat "$F/show/$3"; else printf "Id=%s\\nDescription=%s\\nSlice=\\nControlGroup=\\n" "$3" "$3"; fi; exit 0 ;;',
  '  stop) [ "$3" = --no-block ] || exit 91; [ -f "$F/stop-rc" ] && exit "$(cat "$F/stop-rc")"; exit 0 ;;',
  '  set-property)',
  '    [ "$3" = --runtime ] && [ -n "${4:-}" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
  '    if [ -f "$F/setprop-rc/$4" ]; then rc=$(cat "$F/setprop-rc/$4"); elif [ -f "$F/gone/$4" ]; then rc=1; else rc=0; fi',
  '    [ "$rc" = 0 ] || { echo "Failed to set unit properties on $4: fixture" >&2; exit "$rc"; }',
  '    for a in "${@:5}"; do case "$a" in MemoryMax=[0-9]*G) v="${a#MemoryMax=}"; mkdir -p "$F/memmax"; echo "$(( ${v%G} * 1073741824 ))" > "$F/memmax/$4" ;; esac; done',
  '    exit 0 ;;',
  'esac',
  'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
].join('\n');

/** One fixture box, rebuilt before every case of the file that makes it. `honourPattern` makes `list-units` answer
 *  its pattern argument (the cap's two suites); `scope-sweep.test.ts` leaves it off. */
export function makePaneScopeBox(opts: { honourPattern?: boolean } = {}) {
  const fx = {} as Fx;
  const seenLines: string[] = [];

  beforeEach(() => {
    const base = mkTmp('ccrc-scope-sweep-');
    Object.assign(fx, { base, home: path.join(base, 'home'), xdg: path.join(base, 'xdg'), proc: path.join(base, 'proc'), cg: path.join(base, 'cg'), bin: path.join(base, 'bin') });
    for (const d of [path.join(fx.home, '.cc-sessions'), fx.xdg, path.join(fx.proc, 'net'), path.join(fx.proc, 'self', 'ns'), fx.cg, fx.bin, path.join(base, 'show')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(fx.proc, 'uptime'), `${UP}.25 1234.00\n`);
    fs.symlinkSync(NETNS, path.join(fx.proc, 'self', 'ns', 'net'));
    fs.writeFileSync(path.join(fx.proc, 'net', 'tcp'), '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n');
    for (const f of ['tcp6', 'udp', 'udp6']) fs.copyFileSync(path.join(fx.proc, 'net', 'tcp'), path.join(fx.proc, 'net', f));
    fs.writeFileSync(path.join(fx.proc, 'net', 'unix'), 'Num       RefCount Protocol Flags    Type St Inode Path\n');
    fs.writeFileSync(path.join(base, 'units'), '');
    if (opts.honourPattern) fs.writeFileSync(path.join(base, 'honour-pattern'), '');
    const stub = (name: string, body: string): void => { fs.writeFileSync(path.join(fx.bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 }); };
    stub('systemctl', SYSTEMCTL_STUB(base));
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
  function proc(pid: number, o: ProcOpts): void {
    const d = path.join(fx.proc, String(pid));
    fs.mkdirSync(path.join(d, 'fd'), { recursive: true });
    fs.mkdirSync(path.join(d, 'ns'));
    const comm = o.comm ?? 'node';
    const ticks = (UP - o.age) * 100;
    const state = o.state ?? 'S';
    const threads = o.threads ?? 1;   // stat field 20, `num_threads`: a `Z` thread-group leader whose other threads still run reads more than 1
    // `t` is Linux's tracing stop (a process under ptrace): readable, yet outside the sweep's `[A-Z]` states.
    if (!/^[A-Z]$/.test(state) && state !== 't') throw new Error(`invalid fixture process state ${state}`);
    // `pid (comm) state ppid …` with the start time as field 22 — the comm carries a space and a paren, as real ones can
    fs.writeFileSync(path.join(d, 'stat'), `${pid} (${comm}) ${state} ${o.ppid ?? 1} ${pid} ${pid} 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 ${threads} 0 ${ticks} 1000 10 0\n`);
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
  function scope(n: number, o: ScopeOpts): string {
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
  /** A previous tick's line: first seen dead `ago` seconds ago on the sweep's boot-relative clock. */
  function seen(u: string, ago: number, cpu: number, verdict = 'report'): void {
    seenLines.push(`dead ${u} first=${UP - ago} cpu0=${cpu} verdict=${verdict} why=dead-under-6h server=ccd procs=1 mem=1 sockets=0 youngest=1 oldest=1 age=1 pids=1`);
    fs.writeFileSync(STATE(), ['# ccd-scope-sweep v1 tick=1 up=1 mode=shadow', ...seenLines].join('\n') + '\n');
  }
  beforeEach(() => { seenLines.length = 0; });
  const arm = (): void => fs.writeFileSync(path.join(fx.home, '.cc-sessions', 'scope-sweep-live'), '');
  const livePanes = (...panes: number[]): void => fs.writeFileSync(path.join(fx.base, 'panes'), [4242, ...panes].map((p) => `${CCD_SERVER} ${p}\n`).join(''));

  /** `script` run over the box: the stubs first on PATH, the fixture's HOME, XDG_RUNTIME_DIR, /proc and cgroup roots;
   *  `cwd` is the working directory (a fixture directory, never the caller's). */
  function runScript(script: string, env: Record<string, string | undefined> = {}, cwd?: string): RunResult {
    const r = spawnSync('bash', [script], {
      encoding: 'utf8', timeout: 30000,   // a sweep that spins (a parent cycle) is a red case, not a hung suite
      env: { PATH: `${fx.bin}:${process.env['PATH'] ?? ''}`, HOME: fx.home, XDG_RUNTIME_DIR: fx.xdg,
        CCRC_PROC_ROOT: fx.proc, CCRC_CGROUP_ROOT: fx.cg, LC_ALL: 'C', ...env },
      ...(cwd === undefined ? {} : { cwd }),
    });
    return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
  }
  function run(env: Record<string, string | undefined> = {}): RunResult { return runScript(SWEEP, env); }
  /** Every argv the systemctl stub was asked, in order. */
  const calls = (): string[] => (fs.existsSync(path.join(fx.base, 'calls')) ? fs.readFileSync(path.join(fx.base, 'calls'), 'utf8') : '')
    .split('\n').filter((l) => l !== '');
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

  // ── the cap's answers (used by no `scope-sweep.test.ts` case) ──────────────────────────────────────────────────
  const marker = (dir: string, u: string, body = ''): void => {
    fs.mkdirSync(path.join(fx.base, dir), { recursive: true });
    fs.writeFileSync(path.join(fx.base, dir, u), body);
  };
  /** A raw `list-units` line, as written (`● ` or two spaces leading it, or neither). */
  const listLine = (line: string): void => fs.appendFileSync(path.join(fx.base, 'units'), `${line}\n`);
  /** What `show <u> -p MemoryMax --value` prints for `u`. */
  const memoryMax = (u: string, value: string): void => marker('memmax', u, `${value}\n`);
  /** A unit that is not loaded any more: `show` answers the manager default `infinity`, `set-property` fails. */
  const gone = (u: string): void => marker('gone', u);
  /** A unit whose `show -p MemoryMax --value` answers nothing. */
  const emptyShow = (u: string): void => marker('empty', u);
  /** The rc of `set-property --runtime u …`. */
  const setPropertyRc = (u: string, rc: number): void => marker('setprop-rc', u, String(rc));
  /** The rc of `list-units`. */
  const listRc = (rc: number): void => fs.writeFileSync(path.join(fx.base, 'list-rc'), String(rc));
  /** Clears the argv log, so a second run's calls read alone. */
  const clearCalls = (): void => fs.rmSync(path.join(fx.base, 'calls'), { force: true });

  return {
    fx, proc, server, cgOf, unitName, scope, inert, STATE, seen, arm, livePanes, run, runScript, calls, stops, rows,
    listLine, memoryMax, gone, emptyShow, setPropertyRc, listRc, clearCalls,
  };
}
export type PaneScopeBox = ReturnType<typeof makePaneScopeBox>;
