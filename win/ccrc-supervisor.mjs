#!/usr/bin/env node
// ccrc-supervisor — what stands in for `systemd --user` on a box that has none.
//
// It exists because `ccd` does not merely *use* systemd, it DEPENDS ON FOUR
// BEHAVIOURS of it, spelled out in `ccd/claude-session@.service`:
//
//   ExecStart=%h/.local/bin/ccd supervise %i   one process per session id
//   Restart=always, RestartSec=3               a died pane comes back
//   StartLimitIntervalSec=120, Burst=5         ...but a crash loop STOPS, and
//                                              the unit goes `failed`, because
//                                              §4.3 classifies a heartbeat-less
//                                              row as `orphan` and that is the
//                                              signal an operator acts on
//   KillMode=process                           stop kills the supervise process
//                                              ONLY — the tmux server is the
//                                              durable substrate and must
//                                              survive a supervisor restart
//
// A shim that implements the first two and drops the third turns a crash loop
// into an invisible one; drop the fourth and every stop takes the whole fleet's
// panes with it. All four are implemented here and pinned by
// `server/test/win-supervisor.test.ts`.
//
// Dependency-free and OS-agnostic on purpose: it is the Windows port's engine,
// but nothing in it needs Windows, so CI on ubuntu exercises the same code the
// Windows box runs.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, chmodSync, openSync, writeSync, closeSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.CCRC_HOME || os.homedir();
const STATE_DIR = path.join(HOME, '.ccrc', 'supervisor');
const JOURNAL_DIR = path.join(STATE_DIR, 'journal');

/**
 * The manager's OWN journal — `supervisor.log` beside the units' journals.
 * Every unit start/stop/restart, every process the subtree kill touches (pid
 * and name), every signal this process receives, and how it exits. It exists
 * because the manager died once with nothing to read: launched under a hidden
 * console, its stdout went nowhere, and the only evidence was a timer that
 * stopped ticking. A manager that cannot say how it died cannot be trusted to
 * be restarted.
 */
function slog(line) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeSync(openSync(path.join(STATE_DIR, 'supervisor.log'), 'a'),
      `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never take the manager down */ }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => slog(`signal ${sig} received`)); } catch { /* not on this platform */ }
}
process.on('exit', (code) => slog(`exit code=${code}`));
process.on('uncaughtException', (err) => { slog(`uncaughtException ${err?.stack ?? err}`); process.exit(70); });
process.on('unhandledRejection', (err) => slog(`unhandledRejection ${err?.stack ?? err}`));
slog(`start pid=${process.pid} ppid=${process.ppid} node=${process.version} home=${HOME}`);
/** The enabled set — the directory `systemctl enable` (win/bin/systemctl) writes
 *  a file into and `_ws_unit_state` (ccd) stats. One path, read by both. */
const WANTS_DIR = path.join(HOME, '.config', 'systemd', 'user', 'default.target.wants');

// The unit file's numbers, in one place. Overridable so a test can drive the
// start limiter without spending 120 real seconds — the same seam idiom as
// `CCRC_ACCOUNTS` in `server/src/config.ts`, and for the same reason: a fixture
// must not need a real box to be true.
const RESTART_SEC = num(process.env.CCRC_SUPERVISOR_RESTART_SEC, 3);
// Unset (null) on a real box: each unit's own StartLimit*= lines then decide, see `Unit.withinStartLimit`.
const START_LIMIT_INTERVAL = num(process.env.CCRC_SUPERVISOR_LIMIT_INTERVAL, null);
const START_LIMIT_BURST = num(process.env.CCRC_SUPERVISOR_LIMIT_BURST, null);

/** What a unit runs. `%i` is the instance name and `%h` the home, exactly as
 *  systemd spells them. The template's default is the unit file's own
 *  ExecStart; a test points it at a stub. */
const EXEC_TEMPLATE = process.env.CCRC_SUPERVISOR_EXEC
  || `${path.join(HOME, '.local', 'bin', 'ccd')} supervise %i`;

/**
 * The NON-template units `ccrc install` enables, with the ExecStart their unit
 * files carry — read from `deploy/ccrc.service` and `deploy/systemd/*.service`
 * and spelled here because this manager reads no unit files.
 *
 * A name that is neither `claude-session@<id>` nor in this table is REFUSED
 * (409), not run: a manager that answered "started" to a unit it has no
 * command for would report `active` for something that never existed, and
 * `ccrc status` reads that column. The `.timer` is the honest gap — this
 * manager has no scheduler, so `ccd-cap-scopes.timer` stays refused and
 * `ccrc install` says DEGRADED for it, which is true.
 */
const SHELL = process.env.CCRC_SUPERVISOR_SHELL || 'bash';

/**
 * The PATH every child gets: the shell's own bin directory FIRST, then whatever
 * this process inherited.
 *
 * Measured failure without it: the supervisor was launched from a shell whose
 * PATH had WinGet's `Links` but not `C:\msys64\usr\bin`; `ccd supervise`
 * inherited that PATH, resolved `tmux` to the psmux shim (`client tmux 3.3`),
 * and the session's substrate row read "tmux exited 1 with no message (server
 * unreachable)" — a pane that never came up, for a reason nothing in the
 * registry could name. Putting `dirname(SHELL)` first gives children the
 * runtime the shell itself was built against: real tmux, flock, git, uuidgen.
 */
function childEnv(name = '') {
  const env = { ...process.env, HOME };
  // Nothing about WHOEVER LAUNCHED THIS MANAGER may reach a session it runs.
  // Every `CLAUDE*` variable in the inherited environment describes the
  // launcher — a Claude Code session that happened to start the supervisor —
  // and Claude Code inside a pane reads them as facts about ITSELF. Measured:
  // launched from within a Claude Code session, the pane inherited
  // CLAUDE_CODE_CHILD_SESSION and answered "Transcript saving is off —
  // inherited CLAUDE_CODE_CHILD_SESSION marker", i.e. it stopped persisting
  // the conversation. Twenty-four such variables were present. At a real logon
  // there are none, so this changes nothing there; it makes a manager started
  // from a terminal, a test, or another agent behave the same as one started
  // by the OS. `CLAUDE_CONFIG_DIR` is set BY ccd for its own children, never
  // inherited from here, so it is not affected.
  for (const k of Object.keys(env)) if (/^CLAUDE/i.test(k)) delete env[k];
  if (process.platform === 'win32') {
    // HOME is the ONLY isolation boundary ccd has (CLAUDE.md), and on Windows
    // it is not one unless USERPROFILE follows it: a native Win32 program —
    // Claude Code included — resolves `~` through USERPROFILE and never reads
    // HOME. Measured: a session spawned under a fixture HOME ran its
    // SessionEnd hook out of `C:\Users\<user>\.claude`, the REAL account's
    // config, and `--resume <uuid>` looked for the conversation there too
    // ("No conversation found with session ID"). Same value, both names; on a
    // real box HOME and USERPROFILE already agree, so this changes nothing
    // there and everything under a fixture.
    const win = HOME.replace(/\//g, '\\');
    env.USERPROFILE = win;
    const m = /^([A-Za-z]:)(.*)$/.exec(win);
    if (m) { env.HOMEDRIVE = m[1]; env.HOMEPATH = m[2] || '\\'; }
  }
  if (path.isAbsolute(SHELL)) {
    // The server runs `ccd` through bash, and on Windows the BARE NAME is a
    // trap: `C:\Windows\System32\bash.exe` is the WSL launcher and wins the
    // PATH lookup on every box that has WSL. Inside it the ccd tree does not
    // exist (`/mnt/c/...` there), so the PWA's "create workspace" failed with
    // `/bin/bash: C:/Users/…/.local/bin/ccd: No such file or directory`.
    // Naming the shell explicitly is the fix; `resolveBash` (server/src/exec.ts)
    // reads this and only falls back to probing when it is unset.
    env.CCRC_BASH = SHELL;
    const bin = path.dirname(SHELL);
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    env[key] = `${bin}${path.delimiter}${env[key] ?? ''}`;
  }
  // What systemd gives every unit and this manager did not: the runtime directory (ccd-scope-sweep exited 1 on every
  // run without it, measured 2,982 times) and the unit's own `EnvironmentFile=`/`Environment=` (ccrc.service booted
  // with none of ccrc.env, so `CCRC_AUTH=on` could never arm the sign-in gate on Windows).
  if (RUNTIME_DIR) env.XDG_RUNTIME_DIR = RUNTIME_DIR;
  if (name) {
    const own = unitEnv(name);
    // A unit's PATH= is a POSIX list (`%h/.local/bin:/usr/local/bin:/usr/bin:/bin`, ccrc-models.service). Handed to a
    // Windows child as is it replaced PATH with directories Windows cannot read, and lost node and git, which live
    // outside the MSYS tree there (measured: `ccrc models refresh` exited 1). So on Windows its directories are spelled
    // for Windows and put FIRST, ahead of the box's own PATH, rather than replacing it.
    if (process.platform === 'win32' && typeof own.PATH === 'string' && path.isAbsolute(SHELL)) {
      const root = path.dirname(path.dirname(path.dirname(SHELL)));   // <msys2>\usr\bin\bash.exe -> <msys2>
      const dirs = own.PATH.split(':').filter(Boolean).flatMap((d, i, all) => {
        if (/^[A-Za-z]$/.test(d) && all[i + 1]?.startsWith('\\')) return [];                    // `C` of `C:\...`
        if (i > 0 && /^[A-Za-z]$/.test(all[i - 1]) && d.startsWith('\\')) return [`${all[i - 1]}:${d}`];
        return [d.startsWith('/') ? path.join(root, d) : d];
      });
      const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      delete own.PATH;
      env[key] = [...dirs, env[key] ?? ''].join(path.delimiter);
    }
    Object.assign(env, own);
  }
  const tr = TRANSIENT.get(name);
  if (tr?.envFile) {
    try { for (const [k, v] of envFile(tr.envFile)) env[k] = v; } catch (e) { slog(`${name}: EnvironmentFile ${tr.envFile} not read (${e?.code ?? e})`); }
  }
  if (tr) Object.assign(env, tr.env ?? {});
  return env;
}

/** The unit file for a name: `claude-session@x.service` is read from `claude-session@.service`. */
function unitFileFor(name) {
  const at = name.indexOf('@'), dot = name.lastIndexOf('.');
  return at > 0 && dot > at ? `${name.slice(0, at + 1)}${name.slice(dot)}` : name;
}
/** The instance of a template unit (`%i`): `lane-a` of `ccrc-codex-usage@lane-a.timer`, else ''. */
function instOf(name) {
  const at = name.indexOf('@'), dot = name.lastIndexOf('.');
  return at > 0 && dot > at ? name.slice(at + 1, dot) : '';
}

/** One `Environment=` value: space-separated assignments, each optionally double-quoted (systemd's own rule). */
function envAssignments(v) {
  const out = [];
  for (const m of v.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
    const a = m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2];
    const eq = a.indexOf('=');
    if (eq > 0) out.push([a.slice(0, eq), a.slice(eq + 1)]);
  }
  return out;
}

/** An `EnvironmentFile=`: `KEY=VALUE` lines, `#`/`;` comments, one pair of surrounding quotes removed. */
function envFile(file) {
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let v = line.slice(eq + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    out.push([line.slice(0, eq).trim(), v]);
  }
  return out;
}

/** The unit file's text, then its `<file>.d/*.conf` drop-ins by name: systemd's reading order. [] with no unit file. */
function unitTexts(name) {
  const file = unitFileFor(name);
  const texts = [];
  try { texts.push(readFileSync(path.join(UNIT_DIR, file), 'utf8')); } catch { return []; }
  try {
    const dir = path.join(UNIT_DIR, `${file}.d`);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.conf')).sort()) texts.push(readFileSync(path.join(dir, f), 'utf8'));
  } catch { /* no drop-ins */ }
  return texts;
}

const SIZE_UNIT = { '': 1, B: 1, K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40, P: 2 ** 50, E: 2 ** 60 };
/** `MemoryMax=` in bytes, as systemd reads it: the last assignment across the unit file and its drop-ins wins, the
 *  suffixes are 1024-based. `infinity`, an empty reset and a percentage (of RAM, which this manager does not measure)
 *  are no cap: null. */
function memoryMax(name) {
  let v = null;
  for (const text of unitTexts(name)) {
    for (const raw of text.split(/\r?\n/)) { const m = /^MemoryMax=(.*)$/.exec(raw.trim()); if (m) v = m[1].trim(); }
  }
  const m = /^(\d+(?:\.\d+)?)([KMGTPE]?)$/.exec(v ?? '');
  return m ? Math.floor(Number(m[1]) * SIZE_UNIT[m[2]]) : null;
}

/**
 * MemoryMax= ON WINDOWS: a Job Object with JOB_OBJECT_LIMIT_JOB_MEMORY, the nearest thing to a cgroup's ceiling. A
 * job caps a whole process TREE (a child created inside a job is in it), so an allocation that would take the unit's
 * committed memory past the limit fails, and the unit fails with it, as an OOM-killed one does under systemd.
 *
 * ONE long-lived PowerShell helper, started at the first capped unit (Add-Type compiles once, about a second), reads
 * `<pid> <bytes>` lines and answers `ok <pid>` or `err <pid> <reason>`. Its job handle is closed after the assign: a
 * job lives while any process is in it, so nothing here holds one per unit.
 */
const JOB_HELPER_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CcrcJob {
  [StructLayout(LayoutKind.Sequential)] public struct Basic { public long A; public long B; public uint LimitFlags; public UIntPtr C; public UIntPtr D; public uint E; public UIntPtr F; public uint G; public uint H; }
  [StructLayout(LayoutKind.Sequential)] public struct Io { public ulong A, B, C, D, E, F; }
  [StructLayout(LayoutKind.Sequential)] public struct Ext { public Basic Basic; public Io Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcess; public UIntPtr PeakJob; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attrs, IntPtr name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref Ext info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Cap(int pid, ulong bytes) {
    IntPtr job = CreateJobObject(IntPtr.Zero, IntPtr.Zero);
    if (job == IntPtr.Zero) return "CreateJobObject error " + Marshal.GetLastWin32Error();
    try {
      Ext x = new Ext();
      x.Basic.LimitFlags = 0x200;   // JOB_OBJECT_LIMIT_JOB_MEMORY
      x.JobMemoryLimit = new UIntPtr(bytes);
      if (!SetInformationJobObject(job, 9, ref x, (uint)Marshal.SizeOf(typeof(Ext)))) return "SetInformationJobObject error " + Marshal.GetLastWin32Error();
      IntPtr p = OpenProcess(0x0101, false, pid);   // PROCESS_SET_QUOTA | PROCESS_TERMINATE, what AssignProcessToJobObject needs
      if (p == IntPtr.Zero) return "OpenProcess error " + Marshal.GetLastWin32Error();
      try { if (!AssignProcessToJobObject(job, p)) return "AssignProcessToJobObject error " + Marshal.GetLastWin32Error(); }
      finally { CloseHandle(p); }
      return null;
    } finally { CloseHandle(job); }
  }
}
'@
while ($null -ne ($l = [Console]::In.ReadLine())) {
  $w = $l.Trim() -split '\\s+'
  if ($w.Count -ne 2) { continue }
  try { $e = [CcrcJob]::Cap([int]$w[0], [uint64]$w[1]) } catch { $e = ($_.Exception.Message -replace '\\s+', ' ') }
  if ($e) { [Console]::Out.WriteLine("err $($w[0]) $e") } else { [Console]::Out.WriteLine("ok $($w[0])") }
  [Console]::Out.Flush()
}
`;
let jobHelper = null;
const jobWaiters = new Map();   // pid -> resolve(null | reason)
/** Put `pid` in a new job capped at `bytes`. Resolves null when it is in, else the reason it is not; never rejects. */
function capMemory(pid, bytes) {
  return new Promise((resolve) => {
    if (!jobHelper) {
      const h = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(JOB_HELPER_PS, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      jobHelper = h;
      let buf = '';
      h.stdout.setEncoding('utf8');
      h.stdout.on('data', (d) => {
        buf += d;
        for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
          const m = /^(ok|err) (\d+) ?(.*)$/.exec(buf.slice(0, i).trim());
          if (!m) continue;
          jobWaiters.get(Number(m[2]))?.(m[1] === 'ok' ? null : m[3] || 'failed');
          jobWaiters.delete(Number(m[2]));
        }
      });
      const gone = (why) => {
        if (jobHelper === h) jobHelper = null;
        for (const r of jobWaiters.values()) r(`job helper ${why}`);
        jobWaiters.clear();
      };
      h.on('exit', (code) => gone(`exited ${code}`));
      h.on('error', (e) => gone(`did not start: ${e.message}`));
      h.stdin.on('error', () => { /* a dead helper: its exit answers the waiters */ });
    }
    jobWaiters.set(pid, resolve);
    jobHelper.stdin.write(`${pid} ${bytes}\n`);
    setTimeout(() => {
      if (jobWaiters.get(pid) !== resolve) return;
      jobWaiters.delete(pid); resolve('job helper did not answer within 30s');
    }, 30_000).unref?.();
  });
}

/** THE UNIT'S ENVIRONMENT, in systemd's order: the unit file, then its `<file>.d/*.conf` drop-ins by name, each line
 *  as it comes; a later assignment wins. `EnvironmentFile=-path` is optional (absent is fine), without the `-` an
 *  unreadable file is skipped and logged (systemd would refuse the start; refusing the console here would leave the
 *  operator nothing to fix it with). `%h` is the home, `%i` the instance. */
function unitEnv(name) {
  const inst = instOf(name);
  const texts = unitTexts(name);
  const env = {};
  const spec = (v) => v.replaceAll('%h', HOME).replaceAll('%i', inst).replaceAll('%%', '%');
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const m = /^(EnvironmentFile|Environment)=(.*)$/.exec(raw.trim());
      if (!m) continue;
      if (m[1] === 'Environment') { for (const [k, v] of envAssignments(spec(m[2]))) env[k] = v; continue; }
      const optional = m[2].startsWith('-');
      const f = spec(optional ? m[2].slice(1) : m[2]);
      try { for (const [k, v] of envFile(f)) env[k] = v; } catch (e) {
        if (!optional || e?.code !== 'ENOENT') slog(`${name}: EnvironmentFile ${f} not read (${e?.code ?? e})`);
      }
    }
  }
  return env;
}

/**
 * ARGV ARRAYS, NOT COMMAND LINES, and never through `bash -c`. The reason is
 * a property of the MSYS runtime that cost two rounds to measure: `exec` of a
 * NATIVE Win32 program from MSYS2's bash does not replace the process — the
 * runtime keeps a bash stub alive waiting on the child. So the direct child
 * this manager holds is still bash, `stop` kills the stub, node keeps
 * 127.0.0.1:7788, and the next start is `EADDRINUSE` until the limiter marks
 * the unit failed. Spawning `node` directly makes node the child. A bash
 * SCRIPT is spawned as `bash <script> <args>` — bash is then genuinely the
 * process running it, and killing it ends the supervise loop it runs.
 */
const STATIC_UNITS = {
  'ccrc.service': ['node', [path.join(HOME, 'ccrc', 'server', 'dist', 'server', 'src', 'index.js')]],
  'ccd-cap-scopes.service': [SHELL, [path.join(HOME, '.local', 'bin', 'ccd-cap-scopes')]],
};

/** `Type=oneshot` units: they exit when done, and that exit is SUCCESS, not a
 *  death to restart. `Restart=always` applied to one would run
 *  `ccd-cap-scopes` in a tight loop until the start limiter marked it failed —
 *  a crash loop manufactured out of a unit that did exactly what it should. */
const ONESHOT = new Set(['ccd-cap-scopes.service']);

/** Units whose whole job is a Linux-cgroup operation with no Windows meaning.
 *  Enabled (so `list-units`/doctor see them) but never spawned here — see
 *  `Unit.start`. `ccd-cap-scopes` is the memory-ceiling capper; there are no
 *  tmux-spawn cgroup scopes on Windows to cap. */
const INERT_ON_WIN = new Set(['ccd-cap-scopes.service']);

/** The timers `ccrc install` enables, with the schedule their unit files carry
 *  (`deploy/systemd/ccd-cap-scopes.timer`: OnBootSec=45s, OnUnitActiveSec=60s).
 *  A timer here is a `setInterval` that starts its service; `active (waiting)`
 *  is systemd's own wording for a timer with nothing due. */
const TIMERS = {
  'ccd-cap-scopes.timer': { unit: 'ccd-cap-scopes.service', onBootSec: 45, onUnitActiveSec: 60 },
};

const DESCRIPTIONS = {
  'ccrc.service': 'ccrc server (PWA + API)',
  'ccd-cap-scopes.service': 'Cap uncapped tmux pane scopes',
  'ccd-cap-scopes.timer': 'Run ccd-cap-scopes every minute',
};

/** THE INSTALLED UNIT FILES, for every timer the tables above do not name. `ccrc install` places
 *  `~/.config/systemd/user/<name>.timer` and its oneshot `.service` for every sweep (history, tmp, account health,
 *  the update watchdog, ...); reading them here keeps one writer of each schedule and each command, rather than a
 *  second hand-kept table. Modelled: `OnBootSec`/`OnActiveSec` (the first run) and `OnUnitActiveSec` (each one after),
 *  `OnCalendar` in the shapes `calendarSec` reads, a `Type=oneshot` service with its `ExecCondition`/`ExecStart`, and
 *  a template's instance, and a long-running node service (`nodeServiceFor`: ccrc-agent.service). Anything else (another
 *  calendar, another long-running service) is not, and stays refused (409). */
const UNIT_DIR = path.join(HOME, '.config', 'systemd', 'user');

/** THE RUNTIME DIRECTORY AND /tmp, AS A BOOT LEAVES THEM. On Linux `/run/user/<uid>` is a tmpfs emptied at logout, and
 *  `/tmp` is emptied at boot, so a dead tmux server's socket never outlives a reboot. MSYS2's `/tmp` is
 *  `<msys2>\tmp` on disk: a socket left by the last boot's tmux made every tmux call wait 2 s for "no server running"
 *  (Cygwin's AF_UNIX emulation), and the console's tick took 6.1 s, over its interval on every tick (measured). So
 *  the FIRST start after a boot empties the runtime directory and removes each tmux socket no server answers; a
 *  manager restarted later in the same boot touches neither. The runtime directory is MSYS's `/run/user/<uid>`,
 *  where doctor looks when the variable is unset, handed to children in its Windows spelling (bash and node both
 *  read that one). */
function bootPrep() {
  if (process.platform !== 'win32' || !path.isAbsolute(SHELL)) return null;
  // A preset XDG_RUNTIME_DIR (a test's fixture) is used as it is; so is tmux's own TMUX_TMPDIR. Both default to the
  // box-wide MSYS paths, which a fixture must never empty.
  let dir;
  try {
    dir = execFileSync(SHELL, ['-c', 'd=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}; mkdir -p "$d" && cygpath -w "$d"'],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
  } catch (e) { slog(`runtime dir not prepared: ${e?.message ?? e}`); return null; }
  const bootAt = String(Math.round((Date.now() - os.uptime() * 1000) / 60000));   // the boot, to the minute
  const stamp = path.join(STATE_DIR, 'boot');
  let seen = '';
  try { seen = readFileSync(stamp, 'utf8').trim(); } catch { /* first start ever */ }
  if (seen !== bootAt) {
    try { for (const f of readdirSync(dir)) rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { /* empty */ }
    try {
      execFileSync(SHELL, ['-c', 't=$(cygpath -u "${TMUX_TMPDIR:-/tmp}"); for s in "$t"/tmux-$(id -u)/*; do [ -S "$s" ] || continue; '
        + 'tmux -S "$s" ls 2>&1 | grep -q "^no server running on" && rm -f -- "$s"; done; exit 0'],
      { windowsHide: true, timeout: 120000 });
    } catch (e) { slog(`stale tmux sockets not swept: ${e?.message ?? e}`); }
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(stamp, bootAt + '\n');
    slog(`first start since boot: runtime dir ${dir} emptied, stale tmux sockets swept`);
  }
  return dir;
}
/** A path in MSYS form (`/c/Users/...`) for anything a shell hands on: MSYS2's python reads `C:/...` as a RELATIVE
 *  path, so the D-3696 launcher at ~/.local/bin/ccd could not find itself. Twin of `shellArgv`'s (server/src/exec.ts):
 *  this manager is dependency-free and another process. */
const msys = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):(?=\/|$)/, (_m, d) => `/${d.toLowerCase()}`);
const SPAN_UNIT = { '': 1, s: 1, sec: 1, m: 60, min: 60, h: 3600, hr: 3600, hour: 3600, d: 86400, day: 86400 };
/** A systemd time span as these unit files write one (`45s`, `7min`, `1h`, `24h`) in seconds, or null. */
function spanSec(v) {
  const m = /^(\d+)\s*([a-z]*)$/.exec(String(v ?? '').trim());
  return m && m[2] in SPAN_UNIT ? Number(m[1]) * SPAN_UNIT[m[2]] : null;
}
/** `OnCalendar=` as an interval in seconds, for the shapes the shipped timers use: `*:0/N` (every N minutes, N a
 *  divisor of 60, so the steps are even) and the `minutely`/`hourly`/`daily` shorthands. Else null (refused). */
const CALENDAR = { minutely: 60, hourly: 3600, daily: 86400 };
function calendarSec(v) {
  const s = String(v ?? '').trim();
  if (s in CALENDAR) return CALENDAR[s];
  const m = /^\*:0{0,2}\/(\d+)$/.exec(s);
  const n = m ? Number(m[1]) : 0;
  return n > 0 && 60 % n === 0 ? n * 60 : null;
}
/** The `Key=value` lines of an installed unit file (first one wins), or null when there is none. A template
 *  instance (`x@lane-a.timer`) reads its template's file (`x@.timer`), as systemd does. */
function unitKeys(name) {
  let text;
  try { text = readFileSync(path.join(UNIT_DIR, unitFileFor(name)), 'utf8'); } catch { return null; }
  const k = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z]+)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in k)) k[m[1]] = m[2];
  }
  return k;
}
/** A oneshot service's command: its ExecStart (or, with `key`, its ExecCondition) through the shell (`%h` is the
 *  home, `%i` the instance, `$$` a literal `$`). */
function serviceFor(name, key = 'ExecStart') {
  if (!name.endsWith('.service')) return null;
  const k = unitKeys(name);
  if (k === null || k.Type !== 'oneshot' || !k.ExecStart || !k[key]) return null;
  const line = k[key].replaceAll('%h', msys(HOME)).replaceAll('%i', instOf(name)).replaceAll('$$', '$');
  return [SHELL, ['-c', `exec ${line}`]];
}
/** A LONG-RUNNING unit-file service whose ExecStart is node (`ccrc-agent.service`, the fleet role's unit): `Type=simple`
 *  (systemd's default) with `Restart=always`, its ExecStart `node ...` or `/usr/bin/env node ...`. Spawned as node
 *  ITSELF, never through bash (the MSYS `exec` stub, see STATIC_UNITS), `%h` the home and such a path in this OS's
 *  spelling. A quote, `$` or backslash in the line means systemd would parse more than words here: refused (409). */
function nodeServiceFor(name) {
  if (!name.endsWith('.service')) return null;
  const k = unitKeys(name);
  if (k === null || (k.Type ?? 'simple') !== 'simple' || k.Restart !== 'always' || !k.ExecStart || /["'$\\]/.test(k.ExecStart)) return null;
  const words = k.ExecStart.trim().split(/\s+/);
  if (words[0] === '/usr/bin/env') words.shift();
  if (words[0] !== 'node') return null;
  const inst = instOf(name);
  return ['node', words.slice(1).map((w) => {
    const v = w.replaceAll('%h', HOME).replaceAll('%i', inst).replaceAll('%%', '%');
    return w.startsWith('%h') ? path.normalize(v) : v;
  })];
}
/** Persistent=true's memory: each persistent timer's last trigger (epoch ms), as systemd keeps a stamp file per timer. */
const STAMPS = path.join(STATE_DIR, 'timer-stamps.json');
function readStamps() {
  try { const s = JSON.parse(readFileSync(STAMPS, 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
function stampTimer(name, at = Date.now()) {
  try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(STAMPS, JSON.stringify({ ...readStamps(), [name]: at }) + '\n'); }
  catch (e) { slog(`${name}: last trigger not recorded (${e?.code ?? e})`); }
}
/** Persistent=true: did a calendar boundary pass since the last trigger, i.e. was a run missed while nothing ran this
 *  timer? Never triggered here, the reference is when it was enabled (its wants entry); not enabled either, no. */
function missedRun(name, periodSec, now = Date.now()) {
  let last = readStamps()[name];
  if (typeof last !== 'number') { try { last = statSync(path.join(WANTS_DIR, name)).mtimeMs; } catch { return false; } }
  const p = periodSec * 1000;
  const local = last - new Date(last).getTimezoneOffset() * 60_000;   // the boundaries are local, as `timerFor`'s
  return last - (local % p) + p <= now;
}
/** A timer: the static table's entry, else the installed `.timer` file's schedule over a oneshot it can run. */
function timerFor(name) {
  if (name in TIMERS) return TIMERS[name];
  if (!name.endsWith('.timer')) return null;
  const k = unitKeys(name);
  if (k === null) return null;
  let onBootSec, onUnitActiveSec, persistent = false;
  if (k.OnCalendar !== undefined) {
    // A calendar is run as its interval, first at the next local boundary; `Persistent=` (systemd: it only acts on a
    // calendar) catches up a run missed while the manager was down, once, at the timer's start (`missedRun`).
    persistent = /^(true|yes|on|1)$/i.test(k.Persistent ?? '');
    onUnitActiveSec = calendarSec(k.OnCalendar);
    if (onUnitActiveSec === null) return null;
    const local = Date.now() / 1000 - new Date().getTimezoneOffset() * 60;
    onBootSec = onUnitActiveSec - (local % onUnitActiveSec);
  } else {
    onBootSec = spanSec(k.OnBootSec ?? k.OnActiveSec);
    // shortcut: OnUnitInactiveSec (the graph sweep's) is counted from each start, not each end; a tick that lands on a
    // run still going is skipped (`start` returns while a child lives), so a long run only moves the next one.
    onUnitActiveSec = spanSec(k.OnUnitActiveSec ?? k.OnUnitInactiveSec);
  }
  const target = (k.Unit ?? name.replace(/\.timer$/, '.service')).replaceAll('%i', instOf(name));
  if (onBootSec === null || onUnitActiveSec === null || serviceFor(target) === null) return null;
  return { unit: target, onBootSec, onUnitActiveSec, persistent };
}
/** TRANSIENT UNITS: `systemd-run --unit=<name> ...` (win/bin/systemd-run) registers one here, so `systemctl
 *  is-active/stop <name>` answer for it as systemd's would. The account sign-in helper (`ccrc account auth-start`)
 *  and `_svc_run_supervised` (the Codex tiers) start named units and then ask after them by name; detached through
 *  `setsid`, no name ever answered, and sign-in refused `no-user-manager`. Spec: argv (MSYS spelling), env,
 *  cwd, restart (Restart=always), runtimeMaxSec, out (`null`, `append:<path>`, or the journal). Collected when it ends,
 *  as `--collect` asks, unless it restarts. */
const TRANSIENT = new Map();
/** PROCESSES ASKED TO STOP whose exit is not measured yet, by unit name: `{ pid, past, ended }`, `ended` resolving true at
 *  the exit, false at the stop's bound (`past` then set; the entry stays until the real exit). Keyed by name, not held on
 *  the Unit, because a stopped transient's Unit is collected at once. A start of that name waits behind it, as systemd
 *  queues a start job behind a running stop job (`Unit.behindStop`): spawned beside it, a `ccd supervise` stopped by a
 *  swap or revive ran twice (measured: a 2 s TERM handler and a stop-then-start gave two live copies). */
const STOPPING = new Map();
const isOneshot = (name) => ONESHOT.has(name) || serviceFor(name) !== null;
const runsOnce = (name) => isOneshot(name) || (TRANSIENT.has(name) && !TRANSIENT.get(name).restart);

/** The command line for a unit name, or null for one this manager cannot run. */
function execFor(name) {
  if (name in STATIC_UNITS) return STATIC_UNITS[name];
  if (TRANSIENT.has(name)) return [SHELL, ['-c', 'exec "$0" "$@"', ...TRANSIENT.get(name).argv]];
  if (timerFor(name) !== null) return ['', []];   // runnable — by scheduling, not by spawning
  const at = name.indexOf('@');
  if (at > 0 && name.startsWith('claude-session@')) {
    const dot = name.lastIndexOf('.');
    const inst = name.slice(at + 1, dot < at ? undefined : dot);
    if (!inst) return null;
    // The test seam is a COMMAND LINE (`sleep 300`, `exit 1`) and goes through
    // `bash -c`; the real unit is the ccd script, spawned as `bash ccd supervise
    // <id>` so bash is the process and not a stub in front of one.
    if (process.env.CCRC_SUPERVISOR_EXEC) {
      return [SHELL, ['-c', EXEC_TEMPLATE.replaceAll('%i', inst).replaceAll('%h', HOME)]];
    }
    // Through `exec`: ~/.local/bin/ccd is the D-3696 Python launcher, which `bash <file>` would read as shell.
    return [SHELL, ['-c', 'exec "$0" "$@"', msys(path.join(HOME, '.local', 'bin', 'ccd')), 'supervise', inst]];
  }
  return serviceFor(name) ?? nodeServiceFor(name);
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/** One unit. `state` is what `list-units` reports in the ACTIVE column, and the
 *  vocabulary is systemd's because `_ws_unit_state`'s caller renders it. */
class Unit {
  constructor(name) {
    this.name = name;              // claude-session@<id>.service
    this.child = null;
    this.state = 'inactive';       // inactive | active | failed
    this.starts = [];              // epoch ms of each start, for the limiter
    this.restarts = 0;             // automatic restarts (Restart=always): systemd's NRestarts
    this.runs = 0;                 // spawns so far, so a stale TimeoutStartSec deadline knows it is stale
    this.timer = null;
    this.wanted = false;           // should it be running?
    this.queued = null;            // a start waiting behind a stopping process: { done, answer } (`behindStop`)
  }

  get instance() {
    const at = this.name.indexOf('@');
    const dot = this.name.lastIndexOf('.');
    return at < 0 ? '' : this.name.slice(at + 1, dot < at ? undefined : dot);
  }

  /** The start limiter, and the one behaviour a naive shim drops. Returns false
   *  when this start would exceed Burst starts within Interval seconds — at
   *  which point systemd stops trying and leaves the unit `failed`. */
  withinStartLimit(now) {
    // The unit's own StartLimitIntervalSec=/StartLimitBurst=, else systemd's defaults (10 s, 5). One fixed 120 s/5 for
    // every unit left ccrc.service (RestartSec=3, no limit lines) failed after five crashes in two minutes, where
    // systemd keeps restarting it. claude-session@ keeps its declared 120 s even when its file is not installed.
    const k = unitKeys(this.name) ?? {};
    const interval = START_LIMIT_INTERVAL ?? spanSec(k.StartLimitIntervalSec)
      ?? (this.name.startsWith('claude-session@') ? 120 : 10);
    const burst = START_LIMIT_BURST ?? num(k.StartLimitBurst, 5);
    const cutoff = now - interval * 1000;
    this.starts = this.starts.filter((t) => t > cutoff);
    return this.starts.length < burst;
  }

  /** Starts the unit. Returns undefined, or, for a start held behind a stopping process, a promise of null (it ran) or
   *  the reason it did not; it never rejects. */
  start(now = Date.now()) {
    if (this.child) return;
    const stopping = STOPPING.get(this.name);
    if (stopping) return this.behindStop(stopping);
    // INERT ON WINDOWS. `ccd-cap-scopes` caps the memory of tmux's per-pane
    // cgroup SCOPES — a Linux-cgroup concept that does not exist here, so on
    // Windows it finds nothing to cap and does nothing useful. What it DID do
    // was flash a console window every 60s when its timer fired (an MSYS
    // bash child allocates its own console, which `windowsHide` cannot
    // suppress once the child is detached), which is the "windows opening and
    // closing" an operator sees. So on Windows it is not spawned at all: the
    // service is reported inactive/dead (a finished oneshot's normal state)
    // and its timer keeps ticking active/waiting, exactly as before — only the
    // pointless flashing process is gone.
    if (process.platform === 'win32' && INERT_ON_WIN.has(this.name)) {
      this.state = 'inactive';
      if (!this._inertLogged) { slog(`inert on Windows: ${this.name} (no cgroups to cap) — not spawned`); this._inertLogged = true; }
      return;
    }
    if (!this.withinStartLimit(now)) {
      this.state = 'failed';
      this.wanted = false;
      return;
    }
    this.starts.push(now);
    const t = timerFor(this.name);
    if (t !== null) {
      // A timer never spawns; it schedules. First run after OnBootSec, then
      // every OnUnitActiveSec — each one a `start` of the target unit through
      // the same path a `systemctl start` would take.
      const fire = () => {
        if (t.persistent) stampTimer(this.name);
        const target = unit(t.unit); target.wanted = true; target.start();
      };
      if (t.persistent && missedRun(this.name, t.onUnitActiveSec)) { slog(`${this.name}: Persistent=true, a run was missed: running now`); fire(); }
      this.timer = setTimeout(() => {
        fire();
        this.timer = setInterval(fire, t.onUnitActiveSec * 1000);
        this.timer.unref?.();
      }, t.onBootSec * 1000);
      this.timer.unref?.();
      this.state = 'active';
      return;
    }
    const argv = execFor(this.name);
    if (argv === null) { this.state = 'inactive'; this.wanted = false; return; }
    // stdout+stderr go to a per-unit journal file, appended, because this
    // manager IS the journal: there is no journald here, and a service that
    // died with its stderr in `stdio: 'ignore'` is a service nobody can
    // diagnose. `verify-service.sh` reads it through the `journalctl` shim.
    // No shell in between (see STATIC_UNITS for the MSYS `exec` stub problem):
    // the process spawned here IS the one `stop` kills.
    // DETACHED IS PER-UNIT, and the split is the whole fix. Measured, both ways:
    //
    //   - `ccd supervise` (a claude-session@ unit) drives the MSYS tmux server,
    //     which NEEDS a console: spawned detached (CREATE_NEW_PROCESS_GROUP,
    //     no console) it dies in ~3s writing nothing, and the pane never
    //     appears. So a session unit inherits the supervisor's console.
    //   - `ccrc.service` is plain node and needs no console. It was the VICTIM
    //     of the cascade: when tmux daemonises it calls FreeConsole, which
    //     broadcasts CTRL_CLOSE to every process sharing that console, and the
    //     node server beside it died with 0xC000013A every ~24s, taking the
    //     fleet down in a loop. Detached, it shares no console with tmux and is
    //     immune.
    //
    // So: console-less units (the server, the timer's oneshot) run detached and
    // out of the blast radius; the session unit stays attached because tmux
    // requires it, and it survives its OWN tmux's FreeConsole (proven by a
    // 5-minute stable run). The supervisor itself only logs the SIGHUP that
    // reaches its hidden console and keeps running.
    // A unit-file oneshot (a sweep) shares the manager's hidden console too: detached, its MSYS bash would open a
    // console window of its own on every tick (what `INERT_ON_WIN` was for). A tmux FreeConsole can end one such run;
    // the next tick runs it again.
    const tr = TRANSIENT.get(this.name);
    const wantsConsole = this.name.startsWith('claude-session@') || serviceFor(this.name) !== null || tr !== undefined;
    this.state = 'active';
    const run = ++this.runs;
    // TimeoutStartSec= for a oneshot (systemd's default 90 s when the unit names none, `infinity` for none at all): a
    // hung run is stopped and marked failed, so its timer's next tick runs again. Unbounded, a hung sweep held its
    // child for ever and `start` returned early on every tick after it. It covers the ExecCondition run too.
    if (isOneshot(this.name) || tr?.runtimeMaxSec) {
      const tk = unitKeys(this.name)?.TimeoutStartSec;
      const secs = tr ? tr.runtimeMaxSec : tk === 'infinity' ? null : (spanSec(tk) ?? 90);
      if (secs) {
        this.deadline = setTimeout(() => {
          if (!this.child || this.runs !== run) return;
          slog(`timeout ${this.name}: TimeoutStartSec=${secs}s passed, stopping it`);
          // Failed, unless a start has run or queued since: that start owns the state now.
          this.stop().then(() => { if (!this.child && !this.queued) this.state = 'failed'; });
        }, secs * 1000);
        this.deadline.unref?.();
      }
    }
    const cond = serviceFor(this.name, 'ExecCondition');
    if (cond === null) { this.spawnMain(argv, tr, wantsConsole); return; }
    // ExecCondition= (systemd.service(5)): 0 runs ExecStart; 1-254 skips this run and is no failure, the unit stays
    // inactive; 255 or a signal fails it. ccrc-settings and the update watchdog skip this way over an older tree.
    const c = this.spawnLogged(cond, 'condition', tr, wantsConsole);
    this.child = c;
    c.on('exit', (code, signal) => {
      slog(`condition ${this.name} code=${code} signal=${signal}`);
      if (this.child !== c) return;   // stopped meanwhile
      this.child = null;
      if (code === 0) { this.spawnMain(argv, tr, wantsConsole); return; }
      if (this.deadline) { clearTimeout(this.deadline); this.deadline = null; }
      this.state = code !== null && code >= 1 && code <= 254 ? 'inactive' : 'failed';
      this.wanted = false;
    });
  }

  /** THE ONE DECISION for a start whose unit's last process is still stopping: queued behind that exit while the stop's
   *  bound runs, then started; refused past the bound, failed, with its pid named. Never spawned beside it. A second start
   *  joins the first (one spawn); a stop cancels it (`stop`). Every start funnels here: the verbs, `restart`, a transient,
   *  a timer's tick, Restart=, default.target. */
  behindStop(s) {
    if (this.queued) return this.queued.done;
    const refuse = () => {
      this.state = 'failed'; this.wanted = false;
      const why = `start ${this.name}: refused, its pid=${s.pid} still runs past its stop's bound; never started beside it`;
      slog(why);
      return why;
    };
    if (s.past) return Promise.resolve(refuse());
    const q = {};
    q.done = new Promise((r) => { q.answer = r; });
    this.queued = q;
    slog(`start ${this.name}: queued behind its pid=${s.pid}, still stopping`);
    s.ended.then((exited) => {
      if (this.queued !== q) return;   // cancelled by a stop
      this.queued = null;
      if (!exited) { q.answer(refuse()); return; }
      this.start();
      q.answer(null);
    });
    return q.done;
  }

  /** One process of this unit, its stdout+stderr in the unit's journal (or where a transient unit's StandardOutput=
   *  says). `ipc` adds a message channel: ccrc.service's, which `stop` asks to shut down. */
  spawnLogged([cmd, args], label, tr, wantsConsole, ipc = false) {
    mkdirSync(JOURNAL_DIR, { recursive: true });
    const log = openSync(path.join(JOURNAL_DIR, `${this.name}.log`), 'a');
    writeSync(log, `--- ${new Date().toISOString()} ${label} #${this.starts.length}: ${[cmd, ...args].join(' ')}\n`);
    let out = log;
    if (tr?.out === 'null') out = 'ignore';
    else if (tr?.out?.startsWith('append:')) { try { out = openSync(tr.out.slice(7), 'a'); } catch { out = log; } }
    // MemoryMax= (see JOB_HELPER_PS). The process is HELD until it is in its job: it starts as a shell waiting for one
    // line on stdin, and only then execs the unit's command, so nothing it forks or allocates escapes the cap. A cap
    // that fails is logged and the unit runs uncapped: a sweep that does not run is worse than one with no ceiling.
    // NOT claude-session@ (its drop-in's MemoryMax=10G): here the tmux server and the panes are not children of
    // `ccd supervise` (the shim has the manager start tmux), so its job would hold only supervise's own few MB.
    // Not a transient unit either: none has a unit file, and the fleet's tmux server is one (`ccrc-tmux-server.scope`).
    const cap = process.platform === 'win32' && !ipc && !this.name.startsWith('claude-session@') ? memoryMax(this.name) : null;
    if (cap !== null) [cmd, args] = [SHELL, ['-c', 'read -r _; exec "$0" "$@"', path.isAbsolute(cmd) ? msys(cmd) : cmd, ...args]];
    const child = spawn(cmd, args, {
      env: childEnv(this.name),
      stdio: [cap !== null ? 'pipe' : 'ignore', out, out, ...(ipc ? ['ipc'] : [])],
      detached: !wantsConsole,
      windowsHide: true,
      ...(tr?.cwd ? { cwd: tr.cwd } : {}),
    });
    if (out !== log && typeof out === 'number') child.on('spawn', () => closeSync(out));
    child.on('spawn', () => closeSync(log));
    child.on('error', () => { try { closeSync(log); } catch { /* closed on spawn */ } });
    if (cap !== null) {
      child.stdin.on('error', () => { /* it ended before its release */ });
      child.on('spawn', () => capMemory(child.pid, cap).then((err) => {
        slog(err ? `memory cap ${this.name} pid=${child.pid} MemoryMax=${cap}: NOT applied, running uncapped (${err})`
          : `memory cap ${this.name} pid=${child.pid} MemoryMax=${cap}`);
        child.stdin.end('\n');
      }));
    }
    return child;
  }

  /** The unit's ExecStart, and what its end means: done for a oneshot, a restart (Restart=always) for the rest. */
  spawnMain(argv, tr, wantsConsole) {
    const child = this.spawnLogged(argv, 'start', tr, wantsConsole, this.name === 'ccrc.service');
    this.child = child;
    slog(`start ${this.name} #${this.starts.length} pid=${child.pid ?? '?'}`);
    child.on('exit', (code, signal) => {
      slog(`exit ${this.name} code=${code} signal=${signal} wanted=${this.wanted}`);
      // A child this unit no longer holds (stopped, then replaced by a restart) decides nothing: its late exit once set
      // `child` to null under the NEW server and scheduled a restart, which looped on EADDRINUSE while the new one
      // served (measured: a restart whose old server outlived the stop's bound).
      if (this.child !== child) return;
      this.child = null;
      if (this.deadline) { clearTimeout(this.deadline); this.deadline = null; }
      if (runsOnce(this.name)) {
        if (TRANSIENT.has(this.name)) { TRANSIENT.delete(this.name); units.delete(this.name); }
        // Done is done: no restart. systemd reports a oneshot that exited 0 as `inactive (dead)` and any other end as
        // `failed`, which doctor's services check and `list-units --state=failed` read. Every exit read `inactive`
        // here, so three sweeps failed on every run for days with nothing red anywhere (measured).
        this.state = code === 0 ? 'inactive' : 'failed'; this.wanted = false; return;
      }
      if (!this.wanted) { this.state = 'inactive'; return; }
      // Restart=always: the exit code does not matter, only whether anything
      // still wants this unit up and whether the limiter has been spent.
      this.state = 'inactive';
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.wanted) { this.restarts += 1; this.start(); }
      }, RESTART_SEC * 1000);
      this.timer.unref?.();
    });
  }

  /** KillMode=process: the direct child and NOTHING ELSE. Killing the tree
   *  here is what takes the tmux server — and with it every pane on the box —
   *  down on an ordinary restart. */
  /** Resolves when the child has actually EXITED (or 3s later, if it will
   *  not) — not when the signal was sent. `systemctl restart` waits for the
   *  stop before the start, and a manager that does not gets `EADDRINUSE`
   *  from a socket the old process has not released yet. */
  stop() {
    this.wanted = false;
    // A start queued behind an earlier stop is cancelled, and whoever waits on it is answered.
    if (this.queued) { this.queued.answer(`start ${this.name}: cancelled by a stop`); this.queued = null; }
    // `clearInterval` clears a timeout too (they share the timer table), so
    // one call covers a timer unit's interval and a service's restart delay.
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const c = this.child;
    this.child = null;
    this.state = 'inactive';
    slog(`stop ${this.name} pid=${c?.pid ?? 'none'}`);
    // A transient unit is gone once stopped (systemd unloads a `--collect` one): `is-active` then answers inactive.
    if (TRANSIENT.has(this.name)) { TRANSIENT.delete(this.name); units.delete(this.name); }
    // Only a process that is there to wait for: a failed spawn (no pid) or one already ended would hold the name for good.
    if (!c?.pid || c.exitCode !== null || c.signalCode !== null) return Promise.resolve();
    const entry = { pid: c.pid, past: false };
    STOPPING.set(this.name, entry);
    const ended = () => { if (STOPPING.get(this.name) === entry) STOPPING.delete(this.name); };
    entry.ended = new Promise((done) => {
      // Past the bound the process still runs: the entry stays, so every start of this name is refused until it ends.
      const bound = () => { entry.past = true; done(false); };
      // A child with a channel (ccrc.service) is ASKED to stop: on Windows SIGTERM is TerminateProcess, so the
      // server's shutdown handler (server/src/shutdownseal.ts) never ran and the breaker seal was never written.
      // One that has not exited within the bound is then killed as before.
      let asked = false;
      if (c.connected) { try { c.send({ type: 'shutdown' }); asked = true; } catch { /* channel gone: kill */ } }
      // An asked child gets past the server's own seal bound (SHUTDOWN_SEAL_BOUND_MS, 5 s) before it is killed: cut at
      // 3 s, a seal still in flight was never written.
      const t = setTimeout(() => {
        if (!asked) { bound(); return; }
        // Killed past the bound: wait for the exit (up to 3 s more) so a restart starts after the port is free.
        try { c.kill('SIGTERM'); } catch { /* already gone */ }
        setTimeout(bound, 3000).unref?.();
      }, asked ? 6000 : 3000);
      // Released after the descendants' kill, so a start queued behind it never overlaps what this process left.
      c.once('exit', () => { clearTimeout(t); killDescendantsExceptTmux(c.pid); ended(); done(true); });
      if (!asked) { try { c.kill('SIGTERM'); } catch { clearTimeout(t); ended(); done(true); } }
    });
    return entry.ended;
  }

  /** Resolves null once the new process is started, or with the reason it was not (refused past the stop's bound). */
  async restart() {
    await this.stop();
    this.wanted = true;
    return (await this.start()) ?? null;
  }

  resetFailed() {
    if (this.state === 'failed') { this.state = 'inactive'; this.starts = []; }
  }

  /** The `list-units --plain --no-legend` row shape: UNIT LOAD ACTIVE SUB DESC. */
  row() {
    const timer = timerFor(this.name) !== null;
    const sub = this.state === 'active' ? (timer ? 'waiting' : 'running')
      : this.state === 'failed' ? 'failed' : 'dead';
    const desc = DESCRIPTIONS[this.name] ?? unitKeys(this.name)?.Description?.replaceAll('%i', this.instance) ?? `Durable Claude Code session ${this.instance}`;
    return `${this.name} loaded ${this.state} ${sub} ${desc}`;
  }
}

const units = new Map();
const unit = (name) => {
  let u = units.get(name);
  if (!u) { u = new Unit(name); units.set(name, u); }
  return u;
};

/** A start's reply: the unit's row, or 409 with why it did not start (the shim then exits non-zero). */
function answerStart(res, u, why) {
  if (why) res.writeHead(409, { 'content-type': 'text/plain' }).end(why + '\n');
  else res.writeHead(200, { 'content-type': 'text/plain' }).end(u.row() + '\n');
}

const token = randomBytes(24).toString('hex');

const server = createServer((req, res) => {
  if (req.headers['x-ccrc-sup-token'] !== token) {
    res.writeHead(401).end('unauthorized\n');
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  const seg = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && seg[0] === 'units' && seg.length === 1) {
    const rows = [...units.values()].map((u) => u.row()).join('\n');
    res.writeHead(200, { 'content-type': 'text/plain' }).end(rows ? rows + '\n' : '');
    return;
  }
  if (req.method === 'GET' && seg[0] === 'units' && seg.length === 3) {
    const u = units.get(decodeURIComponent(seg[1]));
    if (seg[2] === 'props') {
      // `systemctl show` properties, the few that are measured here. MainPID is
      // the live child's pid or 0, exactly as systemd reports a stopped unit;
      // KillMode=process is a description of `Unit.stop`, not a chosen value.
      const pid = u?.child?.pid ?? 0;
      const st = u?.state ?? 'inactive';
      // ExecStart in systemd's struct form, which `ccrc versions` reads to learn which kept tree a running unit uses
      // (`_ver_running_names`); its paths in MSYS form, as `$HOME/ccrc` is spelled there.
      const argv = execFor(decodeURIComponent(seg[1]));
      const words = argv === null || argv[0] === '' ? [] : [argv[0], ...argv[1]].map((w) => (/^[A-Za-z]:[\\/]/.test(w) ? msys(w) : w));
      const exec = words.length === 0 ? '' : `ExecStart={ path=${words[0]} ; argv[]=${words.join(' ')} ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=${pid} ; code=(null) ; status=0/0 }\n`;
      res.writeHead(200, { 'content-type': 'text/plain' })
        .end(`MainPID=${pid}\nActiveState=${st}\nKillMode=process\nLoadState=${u ? 'loaded' : 'not-found'}\nNRestarts=${u?.restarts ?? 0}\n${exec}`);
      return;
    }
    if (seg[2] === 'journal') {
      const n = Number(url.searchParams.get('n') ?? 60);
      let text = '';
      try { text = readFileSync(path.join(JOURNAL_DIR, `${decodeURIComponent(seg[1])}.log`), 'utf8'); }
      catch { text = ''; }
      let lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const since = Number(url.searchParams.get('since'));
      if (since > 0) {
        // shortcut: a line carries no time of its own, only each run's `--- <iso> start` header does, so the run that
        // was going at `since` is kept whole (older lines may show; none newer is dropped).
        let from = 0;
        lines.forEach((l, i) => { const t = Date.parse(/^--- (\S+) /.exec(l)?.[1] ?? ''); if (t <= since * 1000) from = i; });
        lines = lines.slice(from);
      }
      const g = url.searchParams.get('grep');
      if (g) {
        let re;
        // journalctl's smart case: an all-lowercase pattern matches either case.
        try { re = new RegExp(g, g === g.toLowerCase() ? 'i' : ''); } catch { res.writeHead(400).end('bad --grep pattern\n'); return; }
        lines = lines.filter((l) => re.test(l));
      }
      lines = lines.slice(Math.max(0, lines.length - n));
      res.writeHead(200, { 'content-type': 'text/plain' }).end(lines.length ? lines.join('\n') + '\n' : '');
      return;
    }
    res.writeHead(404).end('unknown query\n');
    return;
  }
  if (req.method === 'GET' && seg[0] === 'environment' && seg.length === 1) {
    const env = childEnv();
    res.writeHead(200, { 'content-type': 'text/plain' })
      .end(Object.keys(env).sort().map((k) => `${k}=${env[k]}`).join('\n') + '\n');
    return;
  }
  if (req.method === 'POST' && seg[0] === 'transient' && seg.length === 1) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let spec;
      try { spec = JSON.parse(body); } catch { res.writeHead(400).end('not JSON\n'); return; }
      const name = String(spec.unit ?? '');
      if (!/^[\w@.:-]+\.(service|scope)$/.test(name) || !Array.isArray(spec.argv) || spec.argv.length === 0) {
        res.writeHead(400).end('a transient unit needs a .service or .scope name and an argv\n'); return;
      }
      const live = units.get(name);
      if (live?.child || live?.queued) { res.writeHead(409).end(`Unit ${name} was already loaded or has a fragment file.\n`); return; }
      TRANSIENT.set(name, {
        argv: spec.argv.map(String), env: spec.env ?? {}, cwd: spec.cwd || undefined, restart: spec.restart === true,
        runtimeMaxSec: Number(spec.runtimeMaxSec) > 0 ? Number(spec.runtimeMaxSec) : null, out: spec.out || undefined,
        envFile: spec.envFile || undefined,
      });
      const u = unit(name);
      u.resetFailed();
      u.wanted = true;
      const reply = (why) => {
        // `wait: true` is `systemd-run --scope`, which runs in the foreground: the answer is the unit's exit code, sent
        // when it ends (the shim exits with it; ccd reads the rc of the tmux server's creation).
        if (spec.wait === true) {
          const c = u.child;
          if (!c) { res.writeHead(500).end(`${name} did not start (${why ?? u.state})\n`); return; }
          const done = (code) => { if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/plain' }).end(`${code ?? 1}\n`); };
          c.once('exit', done);
          c.once('error', () => done(1));
          return;
        }
        answerStart(res, u, why);
      };
      // Held behind a stopping process of this name: answered once that start has run or been refused, never left
      // hanging. Otherwise answered at once, so a `wait` reply hooks the child before any event of it can fire.
      const held = u.start();
      if (held) held.then(reply); else reply(null);
    });
    return;
  }
  if (req.method === 'POST' && seg[0] === 'units' && seg.length === 3) {
    const name = decodeURIComponent(seg[1]);
    const verb = seg[2];
    if (verb === 'start' && execFor(name) === null) {
      // Refused, not faked: see STATIC_UNITS. The shim turns this into a
      // non-zero exit, which is what `ccrc install`'s degraded arm reads.
      res.writeHead(409, { 'content-type': 'text/plain' })
        .end(`no ExecStart known to this manager for ${name}\n`);
      return;
    }
    const u = unit(name);
    if (verb === 'restart') {
      // Awaited: the reply goes out only once the old process has exited and
      // the new one is spawned, which is the contract `verify-service.sh`
      // measures 3s later.
      u.restart().then((why) => answerStart(res, u, why));
      return;
    }
    if (verb === 'start') {
      u.wanted = true;
      // Held behind a stopping process: answered once it has started, or with why it did not (as `systemctl start` waits
      // for its job, and fails when that job is refused or cancelled).
      const held = u.start();
      if (held) { held.then((why) => answerStart(res, u, why)); return; }
    }
    else if (verb === 'stop') u.stop();
    else if (verb === 'reset-failed') u.resetFailed();
    else if (verb === 'load') { /* the manager now knows it; nothing runs */ }
    else { res.writeHead(404).end('unknown verb\n'); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }).end(u.row() + '\n');
    return;
  }
  res.writeHead(404).end('not found\n');
});

/**
 * KillMode=process, spelled for a runtime where killing a process leaves its
 * children running. `TerminateProcess` on the direct child (MSYS2's bash running
 * `ccd supervise`) does not touch that bash's own forks — `$(…)` subshells,
 * `sleep`, a `timeout` — and they outlive it. Measured: one supervisor stop left
 * 41 `bash … ccd supervise` processes behind, 14 of them with a dead parent,
 * and an orphaned supervise loop is not inert: it heartbeats `.supervised` and
 * RESPAWNS a pane it reads as gone, racing the manager that replaced it.
 *
 * So the direct child's descendants are killed too — EXCEPT the tmux server and
 * everything under it. That exception is the whole meaning of KillMode=process
 * in `claude-session@.service`: "the tmux server is the durable substrate and
 * must survive a supervisor restart". Here it is a child of supervise (it was
 * created by the pane spawn), so a naive tree-kill would take every pane on the
 * box with it. `tmux.exe` and its subtree (Claude Code in the panes) are left
 * alone by name.
 *
 * PowerShell/CIM is the enumerator because `wmic` is gone from current
 * Windows; a stop is rare enough that the ~1s it costs does not matter.
 */
function killDescendantsExceptTmux(rootPid) {
  if (process.platform !== 'win32' || !rootPid) return;
  let rows = '';
  try {
    rows = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }'],
      { encoding: 'utf8', timeout: 15000 });
  } catch { return; }
  const kids = new Map();
  const name = new Map();
  for (const line of rows.split(/\r?\n/)) {
    const m = /^(\d+) (\d+) (.+)$/.exec(line.trim());
    if (!m) continue;
    name.set(Number(m[1]), m[3]);
    if (!kids.has(Number(m[2]))) kids.set(Number(m[2]), []);
    kids.get(Number(m[2])).push(Number(m[1]));
  }
  const queue = [...(kids.get(rootPid) ?? [])];
  while (queue.length) {
    const pid = queue.shift();
    if (/^tmux(\.exe)?$/i.test(name.get(pid) ?? '')) { slog(`tree-kill root=${rootPid}: keep ${pid} ${name.get(pid)} (substrate)`); continue; }
    for (const k of kids.get(pid) ?? []) queue.push(k);
    slog(`tree-kill root=${rootPid}: kill ${pid} ${name.get(pid) ?? '?'}`);
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * What systemd does at `default.target`: start every unit somebody enabled.
 * The enabled set IS the wants directory — the same files `systemctl enable`
 * writes and `_ws_unit_state` stats — so nothing here keeps a second list that
 * could drift from it. Without this the manager came back at logon knowing
 * nothing: `ccrc.service` stayed down and every session an operator had
 * enabled stayed dead until somebody typed `ccd start` for each one, which is
 * precisely what `enable` promised they would not have to do.
 *
 * Runs AFTER the endpoint is written, not before: a unit's own first action
 * may be a `systemctl` call back into this manager (`ccd supervise` runs
 * `systemctl --user enable` on entry), and that call must find the socket.
 */
function startEnabledUnits() {
  let names = [];
  try { names = readdirSync(WANTS_DIR); } catch { return; }
  for (const name of names) {
    if (execFor(name) === null) {
      console.warn(`ccrc-supervisor: ${name} is enabled but this manager has no ExecStart for it — skipped`);
      continue;
    }
    const u = unit(name);
    u.wanted = true;
    u.start();
  }
}

/**
 * Refuse to become the SECOND manager. `endpoint.json` is a single-writer file
 * and the shim's only way to find whoever is in charge, so a second start does
 * not merely duplicate a process: it overwrites the port and token of the
 * manager that owns the running units, and every `systemctl` after that talks
 * to the newcomer — which supervises nothing. The first manager keeps running,
 * keeps the server as its child, and becomes unaddressable; its units can no
 * longer be stopped, only killed by pid.
 *
 * Measured, by doing it: `node ccrc-supervisor.mjs --help` (there is no such
 * flag — it just starts one) moved the endpoint from 57952 to 62490, and when
 * that instance exited the live manager was left with no way in.
 *
 * A LIVE PROBE, not the file's presence: a stale endpoint from a manager that
 * died without cleaning up must not block the next start forever, and the only
 * honest way to tell "stale" from "in charge" is to ask.
 */
async function anotherManagerAnswers() {
  let ep;
  try { ep = JSON.parse(readFileSync(path.join(STATE_DIR, 'endpoint.json'), 'utf8')); }
  catch { return null; }
  if (!ep || typeof ep.port !== 'number') return null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${ep.port}/units`,
      { headers: { 'x-ccrc-sup-token': String(ep.token ?? '') }, signal: ac.signal });
    clearTimeout(t);
    return r.ok ? ep.port : null;
  } catch { return null; }
}

const incumbent = await anotherManagerAnswers();
if (incumbent !== null) {
  console.error(`ccrc-supervisor: another manager is already running on 127.0.0.1:${incumbent} — refusing to start a second one.`);
  console.error('ccrc-supervisor: stop it first (systemctl --user stop <unit>, then end its process) if you meant to replace it.');
  process.exit(3);
}

const RUNTIME_DIR = bootPrep();

server.listen(0, '127.0.0.1', () => {
  mkdirSync(STATE_DIR, { recursive: true });
  const endpoint = path.join(STATE_DIR, 'endpoint.json');
  // Written LAST and with the port already bound: the shim treats this file's
  // presence as "the manager answers", and a file that appears before the
  // socket does would make the shim exit 0 with nothing behind it — the exact
  // collapse of the empty answer this whole mechanism exists to prevent.
  writeFileSync(endpoint, JSON.stringify({ port: server.address().port, token }) + '\n');
  try { chmodSync(endpoint, 0o600); } catch { /* best effort on Windows ACLs */ }
  startEnabledUnits();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    // Awaited: the server's shutdown is a message now, and exiting first could drop it and orphan the server.
    Promise.all([...units.values()].map((u) => u.stop())).then(() => server.close(() => process.exit(0)));
  });
}
