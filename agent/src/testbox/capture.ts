// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1, §2.3). L1, pure and
// clock-free: everything the capture decides, before any process runs. The runner (`captureRunner.ts`) and the stand-in
// model (`captureStub.ts`) act on it.
//
// - THE PATHS of one capture, all under `<CCRC_TESTBOX_ROOT>/captures/`: the build's bytes in `builds/<version>` (placed by
//   the admin lane's copy, spec §2.2), and per capture a scratch directory with its home, config directory, tmux
//   directory, work folder and recording. The build runs from the builds store directly; nothing is placed in the home.
// - THE SEEDED CONFIG: onboarding done, the work folder trusted, every hook ccrc installs and the statusline pointed at
//   the recorder.
// - THE ENVIRONMENT, built from empty (the probe desk's rule): the stand-in model's address and a placeholder token, the
//   updater and nonessential traffic off, no fleet `HOME`, `TMUX` or account variable.
// - THE DRIVE: the keys typed at each step and the events that must be recorded before the next.
// - THE STAND-IN'S REPLIES: one rule per request, keyed on what the request carries, never on a model.
import path from 'node:path';
import { TESTBOX_CAPTURE_DEADLINE_MS } from '../../../shared/agent-protocol.js';
import { CAPTURE_EVENTS, CAPTURE_WRITE_COMMAND } from '../../../shared/claudeBuildCapture.js';
import { compareClaudeVersions, isClaudeVersion } from '../../../shared/claudeVersion.js';
import type { HookEvent } from '../../../shared/hook-events.js';
import { SYSTEM_PATH } from './spec.js';

// ── the paths ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The capture's own tmux server's `-L` name: never `default`, the fleet's own server. */
export const CAPTURE_SOCKET = 'ccrc-capture';

/** The tmux session the build runs in, on {@link CAPTURE_SOCKET}. */
export const CAPTURE_TMUX_SESSION = 'capture';

/** The folder the drive's first tool call moves the shell into, inside the work folder. */
export const CAPTURE_CD_DIR = 'sub';

export interface CapturePaths {
  /** `<root>/captures/builds/<build>`: the build's bytes, read-only. */
  readonly buildFile: string;
  /** `<root>/captures/<captureId>`: everything the capture writes. */
  readonly dir: string;
  readonly home: string;
  readonly config: string;
  readonly tmux: string;
  /** The folder the build starts in, trusted in the seeded config. */
  readonly work: string;
  /** `<work>/sub`: a PermissionRequest raised after the drive's `cd` must name it as its `cwd`. */
  readonly cdDir: string;
  /** The recorder's output, one JSON object per line. */
  readonly recording: string;
}

/** The builds store, `<root>/captures/builds`. */
export const captureBuildsDir = (root: string): string => path.join(root, 'captures', 'builds');

export function capturePaths(root: string, captureId: string, build: string): CapturePaths {
  const dir = path.join(root, 'captures', captureId);
  const work = path.join(dir, 'work');
  return {
    buildFile: path.join(captureBuildsDir(root), build), dir, home: path.join(dir, 'home'), config: path.join(dir, 'config'),
    tmux: path.join(dir, 'tmux'), work, cdDir: path.join(work, CAPTURE_CD_DIR), recording: path.join(dir, 'recording.jsonl'),
  };
}

/** Every path the runner writes, for the write guard (`probes.ts#writeRefusal`). */
export const captureWrites = (p: CapturePaths): readonly string[] => [p.dir, p.home, p.config, p.tmux, p.work, p.cdDir, p.recording];

// ── the seeded config ────────────────────────────────────────────────────────────────────────────────────────────

/** The events whose hook entry takes a tool matcher. */
const MATCHED: ReadonlySet<HookEvent> = new Set<HookEvent>(['PreToolUse', 'PostToolUse', 'PermissionRequest']);

/** A shell word, single-quoted. */
const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** `<config>/settings.json`: every event in {@link CAPTURE_EVENTS} and the statusline run the recorder, which is told
 *  what called it by its one last argument. `recorder` is the command that runs it, as argv: the node binary and the
 *  compiled recorder's absolute path in production (`captureRecord.ts#recorderPath`), and in the tests the same with
 *  Node's type-stripping flag before the recorder's source, so nothing is compiled at test time. */
export function captureSettings(recorder: readonly string[]): Record<string, unknown> {
  const cmd = (what: string): string => `${recorder.map(sq).join(' ')} ${what}`;
  const hooks: Record<string, unknown> = {};
  for (const ev of CAPTURE_EVENTS) {
    hooks[ev] = [{ ...(MATCHED.has(ev) ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: cmd(ev) }] }];
  }
  return { hooks, statusLine: { type: 'command', command: cmd('statusline') } };
}

/** `<config>/.claude.json`: onboarding done and the work folder trusted, so the build opens no first-run dialog. */
export function captureClaudeJson(work: string): Record<string, unknown> {
  return { hasCompletedOnboarding: true, projects: { [work]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } };
}

// ── the environment ──────────────────────────────────────────────────────────────────────────────────────────────

/** The placeholder the stand-in is given as its token: not a credential, and no service accepts it. */
export const CAPTURE_TOKEN = 'ccrc-capture-stand-in';

/** The capture's whole environment, built from empty. `toolsPath` is the box's tools directories, put first. */
export function captureEnv(p: CapturePaths, standInPort: number, toolsPath: string | null): readonly (readonly [string, string])[] {
  return [
    ['PATH', toolsPath === null || toolsPath === '' ? SYSTEM_PATH : `${toolsPath}:${SYSTEM_PATH}`],
    ['LANG', 'C.UTF-8'], ['TERM', 'xterm-256color'], ['HOME', p.home], ['CLAUDE_CONFIG_DIR', p.config],
    ['TMUX_TMPDIR', p.tmux], ['ANTHROPIC_BASE_URL', `http://127.0.0.1:${standInPort}`], ['ANTHROPIC_AUTH_TOKEN', CAPTURE_TOKEN],
    ['DISABLE_AUTOUPDATER', '1'], ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1'], ['CCRC_CAPTURE_RECORDING', p.recording],
  ];
}

// ── the drive ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The words the stand-in keys its replies on. Each prompt carries one. */
export const CAPTURE_MARK = {
  one: 'ccrc capture step one', two: 'ccrc capture step two', three: 'ccrc capture step three',
  subagent: 'ccrc capture subagent: answer ok',
} as const;

/** One step: the text typed (then Enter; null types nothing), and the events that must be recorded before the next
 *  step (the drive waits for every one, each after the step began). */
export interface CaptureStep { readonly type: string | null; readonly waitFor: readonly HookEvent[] }

/** The drive (spec Table 1). The build's start raises SessionStart; `/exit` ends it with SessionEnd. */
export const CAPTURE_STEPS: readonly CaptureStep[] = Object.freeze([
  { type: null, waitFor: ['SessionStart'] },
  { type: CAPTURE_MARK.one, waitFor: ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'] },
  { type: CAPTURE_MARK.two, waitFor: ['SubagentStart', 'SubagentStop', 'Stop'] },
  { type: '/compact', waitFor: ['PreCompact', 'PostCompact'] },
  { type: CAPTURE_MARK.three, waitFor: ['StopFailure'] },
  { type: '/exit', waitFor: ['SessionEnd'] },
]);

/** Whether `events` (the recorded hook events since the step began, in order) holds every one the step waits for. */
export function stepDone(step: CaptureStep, events: readonly string[]): boolean {
  return step.waitFor.every((e) => events.includes(e));
}

// ── the stand-in's replies ───────────────────────────────────────────────────────────────────────────────────────

/** The first tool call's command: moves the shell into {@link CAPTURE_CD_DIR}. */
export const CAPTURE_CD_COMMAND = `cd ${CAPTURE_CD_DIR}`;
// The second, the write that raises the permission prompt after the shell moved, is `CAPTURE_WRITE_COMMAND`, in
// `shared/claudeBuildCapture.ts` beside the replay that reads it (review 3226 F5).

/** What the stand-in answers one request with. `tool`: one tool call; `text`: a text reply; `error`: an HTTP error the
 *  build does not retry (400, `invalid_request_error`), which ends the turn with StopFailure. */
export type StandInReply =
  | { readonly kind: 'tool'; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'error'; readonly status: 400; readonly message: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A message's content as blocks (a string is one text block). */
function blocks(m: unknown): Obj[] {
  if (!isObj(m)) return [];
  const c = m['content'];
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c.filter(isObj) : [];
}

const textOf = (bs: readonly Obj[]): string => bs.filter((b) => b['type'] === 'text' && typeof b['text'] === 'string').map((b) => b['text'] as string).join('\n');

/** The names of the tools the request offers. */
function toolNames(body: Obj): Set<string> {
  const t = body['tools'];
  return new Set(Array.isArray(t) ? t.filter(isObj).map((x) => x['name']).filter((n): n is string => typeof n === 'string') : []);
}

/** THE rule for one Messages API request body. Only a request that offers the tool is answered with a call to it, so a
 *  side request (a title, a summary) never gets one. In order:
 *  1. the last user message carries a tool result: after `cd sub`, the write command; otherwise a closing text;
 *  2. its text holds step one's mark and Bash is offered: `cd sub`;
 *  3. step two's mark and an Agent (or Task) tool is offered: a subagent whose prompt is the subagent mark;
 *  4. step three's mark and any tool is offered: the error;
 *  5. anything else (the subagent's own request, a compaction, a title): a short text. */
export function standInReply(body: unknown): StandInReply {
  if (!isObj(body) || !Array.isArray(body['messages'])) return { kind: 'text', text: 'ccrc capture' };
  const messages = body['messages'] as unknown[];
  const tools = toolNames(body);
  const last = messages[messages.length - 1];
  const lastBlocks = isObj(last) && last['role'] === 'user' ? blocks(last) : [];
  if (lastBlocks.some((b) => b['type'] === 'tool_result')) {
    const prev = messages[messages.length - 2];
    const call = blocks(prev).filter((b) => b['type'] === 'tool_use').pop();
    const input = call !== undefined && isObj(call['input']) ? call['input'] : {};
    if (input['command'] === CAPTURE_CD_COMMAND && tools.has('Bash')) {
      return { kind: 'tool', name: 'Bash', input: { command: CAPTURE_WRITE_COMMAND, description: 'ccrc capture: write a mark file' } };
    }
    return { kind: 'text', text: 'ccrc capture: done' };
  }
  const text = textOf(lastBlocks);
  if (text.includes(CAPTURE_MARK.one) && tools.has('Bash')) {
    return { kind: 'tool', name: 'Bash', input: { command: CAPTURE_CD_COMMAND, description: 'ccrc capture: move into sub' } };
  }
  const agent = tools.has('Agent') ? 'Agent' : tools.has('Task') ? 'Task' : null;
  if (text.includes(CAPTURE_MARK.two) && agent !== null) {
    return { kind: 'tool', name: agent, input: { description: 'ccrc capture subagent', prompt: CAPTURE_MARK.subagent, subagent_type: 'general-purpose' } };
  }
  if (text.includes(CAPTURE_MARK.three) && tools.size > 0) {
    return { kind: 'error', status: 400, message: 'ccrc capture stand-in: this request is refused on purpose' };
  }
  return { kind: 'text', text: text.includes(CAPTURE_MARK.subagent) ? 'ok' : 'ccrc capture summary' };
}

// ── the timings (review 3226 F8) ─────────────────────────────────────────────────────────────────────────────────

/** How long each part of one capture may take. The fleet agent waits `TESTBOX_CAPTURE_DEADLINE_MS` for the verdict and then
 *  closes its connection, so a verdict sent after that is lost; these values are chosen so a capture fits that deadline
 *  with one capture ahead of it in the queue ({@link captureWorstCaseMs}, pinned by `testbox-capture-deadline.test.ts`). */
export interface CaptureTimings {
  /** One step's events (the runner's `stepTimeoutMs`). */
  readonly stepMs: number;
  /** The build's exit after the last step (the runner's `exitTimeoutMs`). */
  readonly exitMs: number;
  /** The recording's poll (the runner's `pollMs`). */
  readonly pollMs: number;
  /** One tmux call's bound (`captureRunner.ts#tmuxLauncher`'s `boundMs`). */
  readonly tmuxCallMs: number;
  /** After `stop`, the wait for the build to be gone (the runner's `stopWaitMs`). */
  readonly stopWaitMs: number;
  /** An allowance for the scratch directory, the seeded config and the stand-in's start, which no call bounds. */
  readonly setupMs: number;
}

/** The production timings. A step of the drive against the stand-in takes seconds; 35 s each leaves room on a slow box,
 *  and keeps the pin with one more typed step than today's six (the model-switch step door B2 adds, coordinator's ruling). */
export const CAPTURE_TIMINGS: CaptureTimings = Object.freeze({
  stepMs: 35_000, exitMs: 30_000, pollMs: 500, tmuxCallMs: 5_000, stopWaitMs: 5_000, setupMs: 10_000,
});

/** The slack kept beside the worst case: the frames' travel and the clocks of two processes. */
export const CAPTURE_DEADLINE_MARGIN_MS = 30_000;

/** The longest one capture can take under `t`: the setup and the start (one tmux call); each step's typing (the text and
 *  Enter, two calls, and one liveness call when typing fails) and its wait, which can overrun by one poll; one liveness
 *  call when the drive stops unfinished; the exit wait (each pass a call, overrunning by a call and a poll); and the
 *  cleanup (the kill, then the bounded wait for the build to be gone). */
export function captureWorstCaseMs(t: CaptureTimings, steps: readonly CaptureStep[] = CAPTURE_STEPS): number {
  const call = t.tmuxCallMs;
  const start = t.setupMs + call;
  const drive = steps.reduce((ms, s) => ms + (s.type === null ? 0 : 3 * call) + t.stepMs + t.pollMs, 0) + call;
  const exit = t.exitMs + call + t.pollMs;
  const stop = call + t.stopWaitMs + call + t.pollMs;
  return start + drive + exit + stop;
}

/** What a capture that started too late to answer in time is told: no verdict, and why. */
export const CAPTURE_LATE_DETAIL = 'the capture waited in the queue too long to finish before the fleet agent stops waiting: not run, no verdict';

/** Whether a capture that has waited `waitedMs` since its submission must not start: its worst case and the margin would
 *  end past the fleet agent's deadline, so its verdict would be lost. The desk ends it with {@link CAPTURE_LATE_DETAIL}. */
export function captureStartsLate(waitedMs: number, t: CaptureTimings = CAPTURE_TIMINGS, deadlineMs: number = TESTBOX_CAPTURE_DEADLINE_MS): boolean {
  return waitedMs + captureWorstCaseMs(t) + CAPTURE_DEADLINE_MARGIN_MS > deadlineMs;
}

// ── the tmux socket (review 3226 F8) ─────────────────────────────────────────────────────────────────────────────

/** The longest unix socket path the capture uses, in bytes: under macOS's 104 and Linux's 108 with the terminating byte. */
export const CAPTURE_SOCKET_PATH_MAX = 103;

/** The capture's tmux directory (its `TMUX_TMPDIR`): a directory of its own under `base`, the service's temporary
 *  directory (`/tmp`, private to the unit), named by the whole capture id. Under `<CCRC_TESTBOX_ROOT>/captures/<id>` a long
 *  root made every socket path too long and every capture fail to start. */
export const captureTmuxDir = (base: string, captureId: string): string => path.join(base, `ccrc-capture-${captureId}`);

/** Where tmux puts the capture server's socket: `<TMUX_TMPDIR>/tmux-<uid>/<-L name>`. */
export const captureSocketPath = (base: string, captureId: string, uid: number): string =>
  path.join(captureTmuxDir(base, captureId), `tmux-${uid}`, CAPTURE_SOCKET);

/** Whether every capture's socket path under `base` fits {@link CAPTURE_SOCKET_PATH_MAX} for `uid` (every id is 32
 *  characters, so one stands for all). When it does not, the service wires no runner, so the box answers `no-runner`. */
export function captureSocketFits(base: string, uid: number): boolean {
  return new TextEncoder().encode(captureSocketPath(base, '0'.repeat(32), uid)).length <= CAPTURE_SOCKET_PATH_MAX;
}

// ── the builds store (review 3226 F8) ────────────────────────────────────────────────────────────────────────────

/** How many builds `captures/builds/` keeps beyond those a capture still needs: the newest, which the lane captures first. */
export const CAPTURE_BUILDS_KEPT = 3;

/** Which entries of `captures/builds/` to remove: every build past the `kept` newest (by version order), except a build in
 *  `inUse` (a capture queued or running). A name that is not a build (the copy's stage, anything else) is never one. A
 *  pruned build the lane captures again is copied again after the box's `build-absent`. */
export function buildsToPrune(names: readonly string[], inUse: readonly string[], kept: number = CAPTURE_BUILDS_KEPT): string[] {
  return names.filter((n) => isClaudeVersion(n)).sort((a, b) => compareClaudeVersions(b, a)).slice(kept).filter((b) => !inUse.includes(b));
}
