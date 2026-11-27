// The session hook's parity seam (Go core wave 2): `runHook` starts ccd/session-hook.sh under bash or the Go core's
// `ccrc-core hook`, the same way, with the payload on stdin, a fixture HOME and the caller's env. Every test that runs
// the hook moves onto it as its arms are ported (wave 2 inventory §5, "the harness gap").
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import { HARNESS_BASH } from './ccdWsHelpers.js';
import { coreBinary } from './coreBuild.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { assertFencedEnv, fenceEnv } from './pathFence.js';
import type { Impl } from './ccdTwin.js';

import { IMPLS as BOTH } from './ccdTwin.js';
export type { Impl } from './ccdTwin.js';

/** CCRC_HOOK_ONLY=go runs the hook suites in go mode alone (the 9b gate's Windows run, where a bash hook call costs
 *  seconds): IMPLS is the Go hook only, and hookBoth runs the Go hook in the case's own HOME and answers with its result,
 *  so the case's assertions read Go's effects. Logic parity stays the Linux bench's both-mode runs. */
export const HOOK_ONLY_GO = process.env['CCRC_HOOK_ONLY'] === 'go';
export const IMPLS: readonly Impl[] = HOOK_ONLY_GO ? ['go'] : BOTH;

export const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh').split(path.sep).join('/');

// The Windows fence (PATH and home variables) is pathFence.ts's, applied to every hook start's env below.

/** A fixture to run the hook in: its HOME, and the env built for it (a `CcdHarness` is one). */
export interface HookFixture {
  home: string;
  env(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
}

/** What names the session a hook run belongs to. Tests run inside real Claude Code sessions and tmux panes, so these
 *  never pass through from the fixture's env: a test that wants a pane or a job directory sets it in `env`. */
const SESSION_IDENTITY = ['TMUX', 'TMUX_PANE', 'CLAUDE_JOB_DIR', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID'] as const;
/** The rest of a caller session's environment the hook branches on (wave 2 inventory §1, "Environment"), cleared the
 *  same way; every `CCRC_APPROVAL_*` knob too. */
const CALLER_SESSION_ENV = ['CCRC_SESSION_GENERATION', 'CCRC_DOOR_NONCE_SHA256', 'CLAUDE_CODE_EXECPATH',
  'CCRC_LAUNCH_PROFILE', 'CCRC_LAUNCH_RC', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
  'CLAUDE_CONFIG_DIR', 'TMUX_TMPDIR'] as const;
const callerSession = (k: string): boolean => (SESSION_IDENTITY as readonly string[]).includes(k)
  || (CALLER_SESSION_ENV as readonly string[]).includes(k) || k.startsWith('CCRC_APPROVAL_');

/** The env a hook run gets: the fixture's, less every caller-session name above, then the test's own `env`, which may
 *  set any of them. */
export function hookEnv(h: HookFixture, env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const out = h.env(env);
  for (const k of Object.keys(out)) if (callerSession(k) && !Object.hasOwn(env, k)) delete out[k];
  // Many suites put their stand-ins first as `${bin}:${PATH}`, a POSIX join. On Windows MSYS2's bash still reads that
  // first entry (it splits its converted PATH on `:`), but a native program it starts gets `<fixture-bin>:C:/...` as ONE entry
  // (measured), so the core never saw a stand-in there: fenceEnv reads such a `:` as the separator it was meant as.
  return fenceEnv(out);
}

/** The Go hook with an env its caller built whole (a moved suite's own `hookEnv()`, its session names included), handed
 *  over as is: what that suite's bash runner hands bash. Exit 0 is asserted by the caller, as its `execFileSync` did. */
export function runGoHook(home: string, payload: object | string | Buffer, env: NodeJS.ProcessEnv) {
  return runHook({ home, env: (e = {}) => e }, 'go', payload, env);
}

/** p as the bash hook spells it: on Windows MSYS2's (`cygpath -u`: `/c/...`, or `/tmp/...` under the usertemp mount),
 *  which is what a bash on the box (ccd-graph-sweep's realpath of a common dir) writes and the hook compares; p elsewhere. */
export function bashSpelling(p: string): string {
  return process.platform === 'win32' ? execFileSync('cygpath', ['-u', '--', p], { encoding: 'utf8' }).trimEnd() : p;
}

/** The command that runs the hook in `impl` (`at`: another copy of the bash hook, or of the core), as Claude Code starts
 *  the registered command. On Windows that is through MSYS2's bash (CLAUDE_CODE_GIT_BASH_PATH, ccd's `_pane_shell_env`)
 *  in both modes, so the core arrives with the environment MSYS2 hands a native program (HOME, TMPDIR and PATH in
 *  Windows form), never a node-spawned one; elsewhere the core is started directly. */
export function hookArgv(impl: Impl, at?: string): [string, string[]] {
  if (impl === 'bash') return [HARNESS_BASH, [at ?? HOOK]];
  const core = at ?? coreBinary();
  return process.platform === 'win32' ? [HARNESS_BASH, ['-c', 'exec "$0" hook', core.split(path.sep).join('/')]] : [core, ['hook']];
}

/** Run the hook once in `impl` (`at`: another copy of the bash hook, or of the core, to run). `payload` is the stdin: an object as JSON, or a string or bytes as given (so `1.0` reaches the
 *  hook as written). The hook's contract is exit 0 on every path; the status is returned, not asserted. */
export function runHook(h: HookFixture, impl: Impl, payload: object | string | Buffer, env: NodeJS.ProcessEnv = {}, at?: string) {
  recordGuard(typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : JSON.stringify(payload));
  const [cmd, args] = hookArgv(impl, at);
  const e = hookEnv(h, env);
  assertFencedEnv(e);
  const r = spawnSyncGroup(cmd, args, {
    cwd: h.home, env: e, encoding: 'utf8', timeout: 120_000,
    input: typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The hook through the Go core and the bash, each in its own fixture HOME (Go core wave 2, Task 5, review F4): the
 *  case's HOME is copied to a twin of the same path length before either runs, and every mention of the HOME in the
 *  payload, the env, a link's target and a text file's content names the twin for the Go run. Their status, their stdout (the twin read back as
 *  the HOME) and the files the hook keeps (the mail hold's seen files and shadow log, the start report's pending files,
 *  the anchor's mark, the roster card's shadow log, each with its clock numbers compared as offsets from its own run's
 *  start; `watch`: more files, such as a stub's log; `tree`: every file name under the HOME) must be the same.
 *  The bash run is the answer: its stderr, its `ms` and the files it left in the case's HOME are what the case reads
 *  (`goStderr` is the Go run's stderr, for a case that holds it too). What cannot be copied (an unreadable file or
 *  directory, a FIFO) is made again in the twin, empty, with its mode. */
export function hookBoth(home: string, payload: object | string | Buffer, env: NodeJS.ProcessEnv,
  at: { hook?: string; core?: string; watch?: string[]; tree?: boolean; tol?: number } = {}) {
  if (HOOK_ONLY_GO) {
    const p0 = performance.now();
    const g = runHook({ home, env: (e = {}) => e }, 'go', payload, env, at.core);
    const ms = Math.round(performance.now() - p0);
    return { ...g, ms, goMs: ms, goStderr: g.stderr };
  }
  const twin = twinOf(home);
  try {
    // the HOME as written, and as JSON spells it (a Windows path's backslashes are doubled in a payload or a JSON file)
    const json = (p: string): string => JSON.stringify(p).slice(1, -1);
    // and on Windows as a bash on the box spells it (a fixture written in MSYS2's spelling, as ccd's files are)
    const [bh, bt] = process.platform === 'win32' ? [bashSpelling(home), bashSpelling(twin)] : [home, twin];
    const swap = (s: string): string => s.split(home).join(twin).split(json(home)).join(json(twin)).split(bh).join(bt);
    twinCopy(home, twin, '', swap);
    const text = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : JSON.stringify(payload);
    const genv: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === undefined ? v : swap(v)]));
    // Elapsed times on the monotonic clock (performance.now): the bench's wall clock steps back about 650 ms every 31 s
    // (Task 8a F5), which read as a Go cut half a second early (final review finding 4). The wall-clock starts stay for
    // sameFiles, which compares the clock numbers the hooks wrote against them.
    const t0g = Date.now();
    const p0g = performance.now();
    const g = runHook({ home: twin, env: (e = {}) => e }, 'go', swap(text), genv, at.core);
    const goMs = Math.round(performance.now() - p0g);
    const t0b = Date.now();
    const p0b = performance.now();
    const b = runHook({ home, env: (e = {}) => e }, 'bash', payload, env, at.hook);
    const ms = Math.round(performance.now() - p0b);
    expect({ status: g.status, stdout: g.stdout.split(twin).join(home).split(json(twin)).join(json(home)) }, 'the Go hook answers as the bash does')
      .toEqual({ status: b.status, stdout: b.stdout });
    sameFiles(keptFiles(twin, at.watch ?? [], twin, at.tree === true), keptFiles(home, at.watch ?? [], home, at.tree === true), t0g, t0b, Math.max(at.tol ?? 2500, goMs, ms));
    return { ...b, ms, goMs, goStderr: g.stderr };
  } finally {
    fs.rmSync(twin, { recursive: true, force: true });
  }
}

/** A new directory beside `home` whose path has the same length (so a length the hook measures, such as the payload's
 *  against APF_ACCT_STRIP_MAX, is the same in both runs). */
function twinOf(home: string): string {
  const dir = path.dirname(home);
  const base = path.basename(home);
  for (const c of 'zyxwvutsrqponmlkjihgfedcba0123456789') {
    const t = path.join(dir, base.slice(0, -1) + c);
    if (t === home) continue;
    try { fs.mkdirSync(t); return t; } catch { /* taken: the next one */ }
  }
  throw new Error(`no twin for ${home}`);
}

/** Copies `src/rel` into `dst/rel`: files, directories and links (a link's target through `swap`); what cannot be read,
 *  or is no file, directory or link, is made again empty with its mode (a FIFO as a FIFO). */
function twinCopy(src: string, dst: string, rel: string, swap: (s: string) => string): void {
  const ents = fs.readdirSync(path.join(src, rel), { withFileTypes: true });
  for (const d of ents) {
    const r = path.join(rel, d.name);
    const from = path.join(src, r);
    const to = path.join(dst, r);
    const mode = fs.lstatSync(from).mode & 0o7777;
    if (d.isSymbolicLink()) { fs.symlinkSync(swap(fs.readlinkSync(from)), to); continue; }
    if (d.isDirectory()) {
      fs.mkdirSync(to);
      try { twinCopy(src, dst, r, swap); } catch { /* unreadable: empty */ }
      fs.chmodSync(to, mode);
      continue;
    }
    if (d.isFIFO()) { spawnSync('mkfifo', ['-m', mode.toString(8), to]); continue; }
    // a file naming the HOME (a stub script that logs to a file in it) names the twin in the twin
    try {
      const b = fs.readFileSync(from);
      const t = b.toString('utf8');
      fs.writeFileSync(to, Buffer.from(t, 'utf8').equals(b) ? swap(t) : b);
    } catch { fs.writeFileSync(to, ''); }
    fs.chmodSync(to, mode);
  }
}

/** The files the hook keeps that a case compares across the two runs: the mail hold's shadow log (and its `.1`), epochs
 *  masked, and its seen files; the start report's pending files, the anchor's mark and the roster card's shadow log;
 *  `watch` (relative paths), and with `tree` every file name under the HOME (a pid at a name's end masked); absent ones are absent. */
function keptFiles(home: string, watch: string[], root: string, tree: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const read = (rel: string, mask: boolean): void => {
    try {
      const st = fs.lstatSync(path.join(home, rel));
      if (!st.isFile()) { // a FIFO would block a read; a link's target is the link's own content
        out[rel] = st.isSymbolicLink() ? `<link to ${fs.readlinkSync(path.join(home, rel)).split(root).join('<HOME>')}>` : `<${st.isFIFO() ? 'fifo' : st.isDirectory() ? 'directory' : 'special'}>`;
        return;
      }
      const t = fs.readFileSync(path.join(home, rel), 'utf8');
      out[rel] = (mask ? t.replace(/^[0-9]+\t/gm, 'T\t') : t).split(root).join('<HOME>');
    } catch { /* absent */ }
  };
  read('.ccrc/mail-hold-shadow.log', true);
  read('.ccrc/mail-hold-shadow.log.1', true);
  read('.ccrc/roster-card-shadow.log', false);
  const d = path.join(home, '.ccrc', 'mail-hold-shadow.d');
  let names: string[] = [];
  try { names = fs.readdirSync(d).sort(); } catch { /* none */ }
  for (const n of names) read(path.join('.ccrc', 'mail-hold-shadow.d', n), false);
  try {
    for (const n of fs.readdirSync(path.join(home, '.cc-sessions')).sort()) {
      if (/\.(startpending|loadpending|loadlast|anchor-owed)$/.test(n)) read(path.join('.cc-sessions', n), false);
    }
  } catch { /* none */ }
  for (const w of watch) read(w, false);
  if (tree) {
    const walk = (rel: string): void => {
      for (const e of fs.readdirSync(path.join(home, rel), { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
        const r = path.join(rel, e.name);
        if (e.isDirectory()) { out[`tree:${r}/`] = ''; walk(r); } else out[`tree:${r.replace(/\d+$/, '<pid>')}`] = '';
      }
    };
    try { walk(''); } catch { /* none */ }
  }
  return out;
}

/** Two runs' kept files are the same: equal after every clock number (13 digits) is set aside, and each pair of those
 *  numbers either equal or the same distance from its own run's start (within `tol`, 2.5 s by default: the runs differ by scheduling). */
/** `tol` bounds how far apart two runs' clock numbers may sit, each measured from its own run's start; a caller passes at
 *  least the longer run's duration, since a stamp taken anywhere inside a run is a correct one (a fixed 2500 ms could not
 *  hold for Windows bash runs of 4 to 14 s; final review finding 6). */
function sameFiles(g: Record<string, string>, b: Record<string, string>, t0g: number, t0b: number, tol: number): void {
  expect(Object.keys(g), 'the Go hook leaves the files the bash does').toEqual(Object.keys(b));
  const NUM = /\b1\d{12}\b/g;
  const RID = /\b(1\d{12})-\d+-\d+\b/g;
  const shape = (s: string): string => s.replace(RID, '$1-P-R').replace(NUM, 'T');
  for (const k of Object.keys(b)) {
    const gn = [...g[k]!.matchAll(NUM)].map((m) => Number(m[0]));
    const bn = [...b[k]!.matchAll(NUM)].map((m) => Number(m[0]));
    expect(shape(g[k]!), `${k}: the Go hook keeps what the bash does`).toEqual(shape(b[k]!));
    expect(gn.length, `${k}: the same clock numbers`).toBe(bn.length);
    gn.forEach((n, i) => {
      const m = bn[i]!;
      if (n !== m) expect(Math.abs((n - t0g) - (m - t0b)), `${k}: clock number ${i} (${n} against ${m}) is the same distance from its run's start`).toBeLessThan(tol);
    });
  }
}

/** With CCRC_GUARD_CORPUS set, each payload a guard suite hands the hook or the hook's cut jq programs is appended to that
 *  file, one JSON string a line: the suites' own cases for core/internal/domain/attention/testdata/gen-guard-cases.mjs. */
export function recordGuard(payload: string): void {
  const f = process.env['CCRC_GUARD_CORPUS'];
  if (f) fs.appendFileSync(f, `${JSON.stringify(payload)}\n`);
}

/** The Go hook spawned without waiting (a suite's parallel runner): its exit code, stdout and stderr, from `input` and the
 *  env as given (the same object the suite hands its bash run). */
export function goHookAsync(input: string, env: NodeJS.ProcessEnv): Promise<[number | null, string, string]> {
  recordGuard(input);
  return new Promise((resolve, reject) => {
    // the same fence as runHook's (a deny suite's pool builds its own env): no operator PATH entry reaches the hook
    const fenced = hookEnv({ home: '', env: (x = {}) => x }, env);
    assertFencedEnv(fenced);
    const p = spawn(...hookArgv('go'), { env: fenced });
    let o = ''; let e = '';
    p.stdout.on('data', (d: Buffer) => { o += d.toString(); });
    p.stderr.on('data', (d: Buffer) => { e += d.toString(); });
    p.on('error', reject);
    p.on('close', (c) => resolve([c, o, e]));
    p.stdin.end(input);
  });
}
