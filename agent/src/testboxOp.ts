// D-7411, D-7427, D-7430, D-7555 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB9; spec 2026-10-28
// test box §2.7, §2.10). L3: the fleet agent's `testbox` and `testbox-tools-sync` ops. Neither takes an argument, so no
// field of the wire reaches a spawn, a path or a frame: everything here is the fleet host's own.
//
// THE FIXED SPAWNS (D-7430), the fourth class of wire-triggered spawn outside the exec whitelist (agent/CLAUDE.md):
//   1. `systemctl --user show-environment`, found on the agent's own PATH: the user manager's environment, whose PATH
//      every session unit inherits (D-7427; neither the session unit nor the agent's sets one) and whose CCRC_CHROME
//      names the Chrome a session's tests run.
//   2. `<home>/.local/bin/ccrc test --testbox-knobs host`: the fleet host's test box settings, validated by the
//      wrapper's own printer (TB1), because the agent unit reads no `ccrc.env`.
//   3. The six version probes, `node --version`, `npm --version`, `"$CCRC_CHROME" --version`, `python3 --version`,
//      `git --version` and `tmux -V`, each resolved on the user manager's PATH.
// Every one runs through the bounded spawner (`testbox/exec.ts#boundedExec`, no shell, its own process group, the whole
// group killed at the bound) with the explicit environment `{HOME, PATH, LANG}` and `TESTBOX_PROBE_DEADLINE_MS`; the
// first also carries `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` (`userBusEnv`), without which `systemctl --user`
// cannot reach the user manager and nothing is measured.
//
// THE READS: `~/.ccrc/build.json` (a node file, for the release the fleet host runs) and the token file
// `CCRC_TESTBOX_TOKEN_FILE` names. Nothing else is opened.
//
// THE BOX CALL: one WebSocket to `CCRC_TESTBOX_URL`, the `hello` with the token, and the status answer the service
// sends in reply (D-7501), all within `CCRC_TESTBOX_STATUS_DEADLINE`. The tools sync sends one `tools.sync` frame on the
// same connection after that answer, carrying the release in `build.json` and the versions just measured.
//
// THE CAPTURE OP (build capture runner, spec 2026-11-22 §2.5): `captureTestbox` reads the same settings through the same
// fixed settings spawn (no user manager environment, no probe), opens the same connection, and after the status answer
// sends ONE `capture.submit` for the one build the request named, then waits up to `TESTBOX_CAPTURE_DEADLINE_MS` for that
// capture's `refused` or `ended` state. The build is used only inside that frame: it reaches no spawn and no path.
import { randomBytes } from 'node:crypto';
import { closeSync, constants as fsConstants, openSync, readSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TESTBOX_CAPTURE_DEADLINE_MS, TESTBOX_PROBE_DEADLINE_MS, readTestboxCaptureReply, updateLauncherPath,
  type TestboxBoxRead, type TestboxCaptureReply, type TestboxHostMeasure, type TestboxHostTools, type TestboxOpReply, type TestboxToolsSyncReply,
} from '../../shared/agent-protocol.js';
import { isReleaseTag } from '../../shared/api.js';
import { parseBuildInfo } from '../../shared/buildinfo.js';
import { readTestboxFrame, TESTBOX_TOOLS, type StatusAnswer, type TestboxTool, type ToolsSync } from '../../shared/testbox.js';
import { absPath, durationMs, parseKnobLines, type KnobLine } from './testbox/config.js';
import { boundedExec, type Exec } from './testbox/exec.js';

/** The settings printer's fixed argv after the launcher (TB1's flag). */
export const KNOBS_ARGV: readonly string[] = Object.freeze(['test', '--testbox-knobs', 'host']);
/** The user manager's environment's fixed argv. */
export const SHOW_ENV_ARGV: readonly string[] = Object.freeze(['--user', 'show-environment']);
/** Each tool's probe: the command (CCRC_CHROME's value for `chrome`) and its fixed argv. */
export const PROBES: Readonly<Record<TestboxTool, { readonly file: string | 'CCRC_CHROME'; readonly args: readonly string[] }>> = {
  node: { file: 'node', args: ['--version'] },
  npm: { file: 'npm', args: ['--version'] },
  tmux: { file: 'tmux', args: ['-V'] },
  git: { file: 'git', args: ['--version'] },
  python3: { file: 'python3', args: ['--version'] },
  chrome: { file: 'CCRC_CHROME', args: ['--version'] },
};
/** The longest a token or build stamp read may be. */
const SMALL_FILE_MAX = 64 * 1024;
/** The WebSocket close code of a frame the service will not take (the service's `POLICY_CLOSE_CODE`). */
const POLICY_CLOSE_CODE = 1008;

export interface TestboxOpSeams {
  /** The bounded spawner, given the child's whole environment and its bound. */
  readonly exec: (env: Readonly<Record<string, string>>, timeoutMs: number) => Exec;
  /** The agent's own PATH, used to find `systemctl` and nothing else. */
  readonly agentPath: string;
  /** The user bus `systemctl --user` reaches the user manager over (`userBusEnv`), given to that spawn and no other. */
  readonly userBus: Readonly<Record<string, string>>;
  readonly now: () => number;
}

/** `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` from `env`, each defaulted as ccd's `ccrc` defaults them
 *  (`/run/user/<uid>`, then `unix:path=<that>/bus`): the agent unit may carry neither. Empty with no uid. */
export function userBusEnv(env: Readonly<Record<string, string | undefined>>, uid: number | null): Record<string, string> {
  const runtime = env.XDG_RUNTIME_DIR || (uid === null ? '' : `/run/user/${uid}`);
  if (runtime === '') return {};
  return { XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtime}/bus` };
}

export const realTestboxSeams = (): TestboxOpSeams => ({
  exec: boundedExec, agentPath: process.env.PATH ?? '/usr/bin:/bin',
  userBus: userBusEnv(process.env, typeof process.getuid === 'function' ? process.getuid() : null), now: Date.now,
});

const VERSION = /^\d+(?:\.\d+)*[a-z]?$/;
const VERSION_WORD = /\d+(?:\.\d+)*[a-z]?/g;

/** A version out of a probe's first line: its first version-shaped word, Chrome's last; `null` for none. */
export function versionOf(tool: TestboxTool, out: string): string | null {
  const words = (out.split('\n').find((l) => l.trim() !== '') ?? '').match(VERSION_WORD) ?? [];
  const w = tool === 'chrome' ? words[words.length - 1] : words[0];
  return w !== undefined && w.length <= 64 && VERSION.test(w) ? w : null;
}

/** `systemctl show-environment`'s lines to their values. A value systemd printed escaped (`$'…'`) is not read. */
export function parseShowEnvironment(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m === null || m[2]!.startsWith("$'")) continue;
    out.set(m[1]!, m[2]!);
  }
  return out;
}

const utcSecond = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;

/** One small file, opened non-blocking (a FIFO cannot hang the op) and read to at most `SMALL_FILE_MAX` bytes; `null` on
 *  any fault or a longer file. */
function readSmall(p: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(p, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    const buf = Buffer.alloc(SMALL_FILE_MAX + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return n > SMALL_FILE_MAX ? null : buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* closed */ }
  }
}

/** The release the fleet host runs: `build.json`'s version when it is a release tag, else `null`. */
export function hostRelease(home: string): string | null {
  const raw = readSmall(path.join(home, '.ccrc', 'build.json'));
  const v = raw === null ? null : parseBuildInfo(raw)?.version;
  return isReleaseTag(v) ? v : null;
}

interface HostRead {
  readonly measure: TestboxHostMeasure;
  /** The settings, or why they could not be read. */
  readonly knobs: { readonly ok: true; readonly lines: ReadonlyMap<string, KnobLine> } | { readonly ok: false; readonly why: string };
}

const firstLine = (s: string): string => s.split('\n').find((l) => l.trim() !== '')?.trim().slice(0, 200) ?? '';

/** The fleet host's test box settings: the fixed `ccrc test --testbox-knobs host` spawn on `pathEnv`, validated by the
 *  wrapper's own printer. The settings printer needs a shell's PATH of its own; the `testbox` ops give it the user
 *  manager's, the capture op the agent's. Never throws. */
async function readKnobs(home: string, pathEnv: string, s: TestboxOpSeams): Promise<HostRead['knobs']> {
  // The launcher every fixed spawn of the update, token-sync and account ops starts from (`updateLauncherPath`).
  const knobRun = await Promise.resolve().then(() => s.exec({ HOME: home, PATH: pathEnv, LANG: 'C' }, TESTBOX_PROBE_DEADLINE_MS)(
    updateLauncherPath(home), KNOBS_ARGV,
  )).catch((e: unknown) => ({ status: 1, stdout: '', stderr: String(e), killed: false }));
  if (knobRun.status !== 0 || knobRun.killed) return { ok: false, why: firstLine(knobRun.stderr) || `exit ${knobRun.status}` };
  try { return { ok: true, lines: parseKnobLines(knobRun.stdout) }; } catch (e) { return { ok: false, why: e instanceof Error ? e.message : String(e) }; }
}

/** The user manager's environment, the settings and the six probes. Never throws. */
async function readHost(home: string, s: TestboxOpSeams): Promise<HostRead> {
  const shown = await s.exec({ ...s.userBus, HOME: home, PATH: s.agentPath, LANG: 'C' }, TESTBOX_PROBE_DEADLINE_MS)('systemctl', SHOW_ENV_ARGV)
    .catch(() => null);
  const userEnv = shown !== null && shown.status === 0 && !shown.killed ? parseShowEnvironment(shown.stdout) : new Map<string, string>();
  const userPath = userEnv.get('PATH') ?? null;
  const knobs = await readKnobs(home, userPath ?? s.agentPath, s);
  const tools = {} as Record<TestboxTool, string | null>;
  // No PATH from the user manager: nothing is measured, because a version found on another PATH is not the one the
  // sessions run (D-7427).
  const chrome = userEnv.get('CCRC_CHROME') ?? '';
  await Promise.all(TESTBOX_TOOLS.map(async (t) => {
    const p = PROBES[t];
    const file = p.file === 'CCRC_CHROME' ? chrome : p.file;
    if (userPath === null || file === '' || (p.file === 'CCRC_CHROME' && !path.isAbsolute(file))) { tools[t] = null; return; }
    const r = await s.exec({ HOME: home, PATH: userPath, LANG: 'C' }, TESTBOX_PROBE_DEADLINE_MS)(file, p.args).catch(() => null);
    tools[t] = r !== null && r.status === 0 && !r.killed ? versionOf(t, `${r.stdout}\n${r.stderr}`) : null;
  }));
  const ordered = Object.fromEntries(TESTBOX_TOOLS.map((t) => [t, tools[t]])) as unknown as TestboxHostTools;
  return { measure: { tools: ordered, release: hostRelease(home), measuredAt: utcSecond(s.now()) }, knobs };
}

interface BoxTarget { readonly url: string; readonly token: string; readonly deadlineMs: number }

const knob = (lines: ReadonlyMap<string, KnobLine>, key: string): string | null => lines.get(key)?.value ?? null;

/** The settings to the box to call, or the op's failure. */
function boxTarget(home: string, knobs: HostRead['knobs']): BoxTarget | Extract<TestboxBoxRead, { ok: false }> {
  if (!knobs.ok) return { ok: false, failure: 'unreachable', detail: `the test box settings cannot be read: ${knobs.why}` };
  const url = knob(knobs.lines, 'CCRC_TESTBOX_URL');
  if (url === null) return { ok: false, failure: 'unreachable', detail: 'the settings printer gave no CCRC_TESTBOX_URL' };
  if (url === '') return { ok: false, failure: 'unconfigured', detail: null };
  try {
    const deadlineMs = durationMs('CCRC_TESTBOX_STATUS_DEADLINE', knob(knobs.lines, 'CCRC_TESTBOX_STATUS_DEADLINE') ?? '');
    const tokenFile = absPath('CCRC_TESTBOX_TOKEN_FILE', knob(knobs.lines, 'CCRC_TESTBOX_TOKEN_FILE') ?? '', home);
    const token = (readSmall(tokenFile) ?? '').trim();
    if (token === '') return { ok: false, failure: 'unreachable', detail: 'no token in the test box token file' };
    return { url, token, deadlineMs };
  } catch (e) {
    return { ok: false, failure: 'unreachable', detail: e instanceof Error ? e.message : String(e) };
  }
}

const wsUrl = (u: string): string => u.replace(/^http(s?):\/\//, 'ws$1://');

/** One connection: the hello, the status answer, and (for the sync) the frame after it, within the deadline. */
export function callBox(t: BoxTarget, frame: ToolsSync | null): Promise<TestboxBoxRead> {
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket;
    const finish = (r: TestboxBoxRead): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* closed */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, failure: 'unreachable', detail: `no status answer within ${t.deadlineMs} ms` }), t.deadlineMs);
    try { ws = new WebSocket(wsUrl(t.url)); } catch (e) {
      finish({ ok: false, failure: 'unreachable', detail: `bad URL: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: t.token })));
    ws.addEventListener('message', (e) => {
      const text = typeof e.data === 'string' ? e.data : Buffer.from(e.data as ArrayBuffer).toString('utf8');
      const r = readTestboxFrame(text);
      if (!r.ok || r.value.t !== 'status') {
        finish({ ok: false, failure: 'bad-answer', detail: r.ok ? `a ${r.value.t} frame in place of the status` : r.reason });
        return;
      }
      const status: StatusAnswer = r.value;
      if (frame !== null) ws.send(JSON.stringify(frame));
      finish({ ok: true, status });
    });
    ws.addEventListener('close', (e) => finish({
      ok: false, failure: 'unreachable',
      detail: e.code === POLICY_CLOSE_CODE ? `refused: ${e.reason}` : `the connection closed (code ${e.code}${e.reason === '' ? '' : `: ${e.reason}`})`,
    }));
    ws.addEventListener('error', () => finish({ ok: false, failure: 'unreachable', detail: 'the connection failed' }));
  });
}

/** CCRC_TESTBOX_POLL as the printer validated it, or `null`. */
function pollMs(knobs: HostRead['knobs']): number | null {
  if (!knobs.ok) return null;
  try { return durationMs('CCRC_TESTBOX_POLL', knob(knobs.lines, 'CCRC_TESTBOX_POLL') ?? ''); } catch { return null; }
}

/** The `testbox` op: the fleet host's measurement and the box's status answer, or the typed failure. Never throws. */
export async function measureTestbox(home: string = os.homedir(), seams: Partial<TestboxOpSeams> = {}): Promise<TestboxOpReply> {
  const s = { ...realTestboxSeams(), ...seams };
  const host = await readHost(home, s);
  const target = boxTarget(home, host.knobs);
  const box = 'url' in target ? await callBox(target, null) : target;
  return { host: host.measure, pollMs: pollMs(host.knobs), box };
}

/** The `testbox-tools-sync` op: one `tools.sync` frame carrying the release in `build.json` and the versions just
 *  measured, sent after the box's status answer. Nothing in it comes from the request. Never throws. */
export async function syncTestboxTools(home: string = os.homedir(), seams: Partial<TestboxOpSeams> = {}): Promise<TestboxToolsSyncReply> {
  const s = { ...realTestboxSeams(), ...seams };
  const host = await readHost(home, s);
  const target = boxTarget(home, host.knobs);
  if (!('url' in target)) return { outcome: target.failure, detail: target.detail, frame: null };
  const missing = TESTBOX_TOOLS.filter((t) => host.measure.tools[t] === null);
  if (host.measure.release === null || missing.length > 0) {
    const what = [...(host.measure.release === null ? ['the release'] : []), ...missing];
    return { outcome: 'unmeasured', detail: `not measured on the fleet host: ${what.join(', ')}`, frame: null };
  }
  const built = readTestboxFrame(JSON.stringify({
    t: 'tools.sync', release: host.measure.release, versions: host.measure.tools, measuredAt: host.measure.measuredAt,
  }));
  if (!built.ok || built.value.t !== 'tools.sync') return { outcome: 'unmeasured', detail: built.ok ? 'not a tools.sync frame' : built.reason, frame: null };
  const frame = built.value;
  const r = await callBox(target, frame);
  return r.ok ? { outcome: 'sent', detail: null, frame } : { outcome: r.failure, detail: r.detail, frame };
}

/** What the capture op's tests may replace: the id's source and the wait. */
export interface TestboxCaptureSeams {
  /** A fresh capture id: 32 lowercase hex characters. */
  readonly randomId?: () => string;
  /** How long to wait, after the submit, for the capture's `refused` or `ended` state. */
  readonly deadlineMs?: number;
}

const freshCaptureId = (): string => randomBytes(16).toString('hex');

/** One connection for a capture: the hello, the status answer, one `capture.submit`, then that capture's states until
 *  `refused` or `ended`. Frames of another type or for another capture id are not this call's and are ignored. */
function callBoxCapture(t: BoxTarget, build: string, captureId: string, deadlineMs: number): Promise<TestboxCaptureReply> {
  return new Promise((resolve) => {
    let done = false;
    let submitted = false;
    let ws: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (outcome: TestboxCaptureReply['outcome'], rest: Partial<Omit<TestboxCaptureReply, 'outcome'>> = {}): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* closed */ }
      const reply: TestboxCaptureReply = { outcome, refusal: rest.refusal ?? null, result: rest.result ?? null, detail: rest.detail ?? null };
      // The server's reader is the judge of a reply: one it would refuse is an unanswered capture, never sent on.
      if (readTestboxCaptureReply(reply, build) === null) {
        resolve({ outcome: submitted ? 'unanswered' : 'bad-answer', refusal: null, result: null, detail: 'the reply was off its shape' });
        return;
      }
      resolve(reply);
    };
    timer = setTimeout(() => finish('unreachable', { detail: `no status answer within ${t.deadlineMs} ms` }), t.deadlineMs);
    try { ws = new WebSocket(wsUrl(t.url)); } catch (e) {
      finish('unreachable', { detail: `bad URL: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: t.token })));
    ws.addEventListener('message', (e) => {
      const text = typeof e.data === 'string' ? e.data : Buffer.from(e.data as ArrayBuffer).toString('utf8');
      if (!submitted) {
        const r = readTestboxFrame(text);
        if (!r.ok || r.value.t !== 'status') {
          finish('bad-answer', { detail: r.ok ? `a ${r.value.t} frame in place of the status` : r.reason });
          return;
        }
        submitted = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish('unanswered', { detail: `no verdict within ${deadlineMs} ms` }), deadlineMs);
        ws.send(JSON.stringify({ t: 'capture.submit', captureId, build }));
        return;
      }
      // Whether a frame is this capture's is read off its own fields, so a frame the reader refuses is still told apart.
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { return; }
      if (typeof raw !== 'object' || raw === null || (raw as { t?: unknown }).t !== 'capture.state' || (raw as { captureId?: unknown }).captureId !== captureId) return;
      const r = readTestboxFrame(text);
      if (!r.ok) { finish('unanswered', { detail: `a frame for this capture was refused: ${r.reason}` }); return; }
      if (r.value.t !== 'capture.state') return;
      const f = r.value;
      if (f.build !== build) { finish('unanswered', { detail: 'a state for another build' }); return; }
      if (f.state === 'refused') finish('refused', { refusal: f.refusal, detail: f.detail });
      else if (f.state === 'ended') finish('answered', { result: f.result, detail: f.detail });
    });
    ws.addEventListener('close', (e) => {
      if (!submitted) {
        finish('unreachable', {
          detail: e.code === POLICY_CLOSE_CODE ? `refused: ${e.reason}` : `the connection closed (code ${e.code}${e.reason === '' ? '' : `: ${e.reason}`})`,
        });
      } else if (e.code === POLICY_CLOSE_CODE) finish('not-taken', { detail: `the box refused the frame: ${e.reason}` });
      else finish('unanswered', { detail: `the connection closed (code ${e.code}${e.reason === '' ? '' : `: ${e.reason}`})` });
    });
    ws.addEventListener('error', () => {
      finish(submitted ? 'unanswered' : 'unreachable', { detail: 'the connection failed' });
    });
  });
}

/** The `testbox-capture` op: one `capture.submit` for `build` on the box named by the fleet host's settings, and the
 *  capture's verdict, refusal or silence. Spawns only the settings printer; reads only the token file. Never throws. */
export async function captureTestbox(
  build: string, seams: TestboxOpSeams & TestboxCaptureSeams, home: string = os.homedir(),
): Promise<TestboxCaptureReply> {
  const knobs = await readKnobs(home, seams.agentPath, seams);
  const target = boxTarget(home, knobs);
  if (!('url' in target)) {
    return { outcome: target.failure, refusal: null, result: null, detail: target.detail };
  }
  return callBoxCapture(target, build, (seams.randomId ?? freshCaptureId)(), seams.deadlineMs ?? TESTBOX_CAPTURE_DEADLINE_MS);
}
