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
// group killed at the bound) with the explicit environment `{HOME, PATH, LANG}` and `TESTBOX_PROBE_DEADLINE_MS`.
//
// THE READS: `~/.ccrc/build.json` (a node file, for the release the fleet host runs) and the token file
// `CCRC_TESTBOX_TOKEN_FILE` names. Nothing else is opened.
//
// THE BOX CALL: one WebSocket to `CCRC_TESTBOX_URL`, the `hello` with the token, and the status answer the service
// sends in reply (D-7501), all within `CCRC_TESTBOX_STATUS_DEADLINE`. The tools sync sends one `tools.sync` frame on the
// same connection after that answer, carrying the release in `build.json` and the versions just measured.
import { closeSync, constants as fsConstants, openSync, readSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TESTBOX_PROBE_DEADLINE_MS, updateLauncherPath,
  type TestboxBoxRead, type TestboxHostMeasure, type TestboxHostTools, type TestboxOpReply, type TestboxToolsSyncReply,
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
  readonly now: () => number;
}

export const realTestboxSeams = (): TestboxOpSeams => ({
  exec: boundedExec, agentPath: process.env.PATH ?? '/usr/bin:/bin', now: Date.now,
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

/** The user manager's environment, the settings and the six probes. Never throws. */
async function readHost(home: string, s: TestboxOpSeams): Promise<HostRead> {
  const shown = await s.exec({ HOME: home, PATH: s.agentPath, LANG: 'C' }, TESTBOX_PROBE_DEADLINE_MS)('systemctl', SHOW_ENV_ARGV)
    .catch(() => null);
  const userEnv = shown !== null && shown.status === 0 && !shown.killed ? parseShowEnvironment(shown.stdout) : new Map<string, string>();
  const userPath = userEnv.get('PATH') ?? null;
  // The settings printer needs a shell's PATH of its own; with the user manager's unknown it has the agent's.
  // The launcher every fixed spawn of the update, token-sync and account ops starts from (`updateLauncherPath`).
  const knobRun = await Promise.resolve().then(() => s.exec({ HOME: home, PATH: userPath ?? s.agentPath, LANG: 'C' }, TESTBOX_PROBE_DEADLINE_MS)(
    updateLauncherPath(home), KNOBS_ARGV,
  )).catch((e: unknown) => ({ status: 1, stdout: '', stderr: String(e), killed: false }));
  let knobs: HostRead['knobs'];
  if (knobRun.status !== 0 || knobRun.killed) knobs = { ok: false, why: firstLine(knobRun.stderr) || `exit ${knobRun.status}` };
  else {
    try { knobs = { ok: true, lines: parseKnobLines(knobRun.stdout) }; } catch (e) { knobs = { ok: false, why: e instanceof Error ? e.message : String(e) }; }
  }
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
