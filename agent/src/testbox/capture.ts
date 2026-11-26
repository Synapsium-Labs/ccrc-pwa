// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1, §2.3). L1, pure and
// clock-free: everything the capture decides, before any process runs. The runner (`captureRunner.ts`) and the stand-in
// model (`captureStub.ts`) act on it.
//
// - THE PATHS of one capture, all under `<CCRC_TESTBOX_ROOT>/captures/`: the build's bytes in `builds/<version>` (placed by
//   the admin lane's copy, spec §2.2), and per capture a scratch directory with its home, config directory, temporary
//   directory, work folder and recording; its tmux directory alone sits under the service's temporary directory. The build runs from the builds store directly; nothing is placed in the home.
// - THE SEEDED CONFIG: onboarding done, the work folder trusted, every hook ccrc installs and the statusline pointed at
//   the recorder.
// - THE ENVIRONMENT, built from empty (the probe desk's rule): the stand-in model's address and a placeholder token, the
//   updater and nonessential traffic off, no fleet `HOME`, `TMUX` or account variable.
// - THE DRIVE: the keys typed at each step and the events that must be recorded before the next.
// - THE STAND-IN'S REPLIES: one rule per request, keyed on what the request carries, never on a model.
import path from 'node:path';
import { TESTBOX_CAPTURE_DEADLINE_MS, UPDATE_SPAWN_DRAIN_MS } from '../../../shared/agent-protocol.js';
import { CAPTURE_EVENTS, CAPTURE_SOCKET, CAPTURE_TMUX_SESSION, CAPTURE_WRITE_COMMAND, captureTmuxDirName } from '../../../shared/claudeBuildCapture.js';
import { compareClaudeVersions, isClaudeVersion } from '../../../shared/claudeVersion.js';
import type { HookEvent } from '../../../shared/hook-events.js';
import { SYSTEM_PATH } from './spec.js';

// ── the paths ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The capture's own tmux server's `-L` name, and the session the build runs in on it: never `default`, the fleet's own
 *  server. Their one definition is the capture contract's (`shared/claudeBuildCapture.ts`, Desktop polish wave 178), so the
 *  delivery driver in the server package can refuse anything else; re-exported here for this package's readers. */
export { CAPTURE_SOCKET, CAPTURE_TMUX_SESSION };

/** The folder the drive's first tool call moves the shell into, inside the work folder. */
export const CAPTURE_CD_DIR = 'sub';

export interface CapturePaths {
  /** `<root>/captures/builds/<build>`: the build's bytes, read only. */
  readonly buildFile: string;
  /** `<root>/captures/<captureId>`: everything the capture writes. */
  readonly dir: string;
  readonly home: string;
  readonly config: string;
  /** The capture's tmux directory (its `TMUX_TMPDIR`), OUTSIDE `dir`: {@link captureTmuxDir} under the service's temporary
   *  directory, so the socket path fits under any box root (review 3226 F8). */
  readonly tmux: string;
  /** The build's `TMPDIR`: its temporary files stay inside the scratch directory the runner removes. */
  readonly tmp: string;
  /** The folder the build starts in, trusted in the seeded config. */
  readonly work: string;
  /** `<work>/sub`: a PermissionRequest raised after the drive's `cd` must name it as its `cwd`. */
  readonly cdDir: string;
  /** The recorder's output, one JSON object per line. */
  readonly recording: string;
}

/** `<root>/captures`: the builds store and every capture's scratch directory. */
export const captureDirsRoot = (root: string): string => path.join(root, 'captures');

/** The builds store, `<root>/captures/builds`. */
export const captureBuildsDir = (root: string): string => path.join(captureDirsRoot(root), 'builds');

/** One capture's paths. `tmuxBase` is the service's temporary directory, where the capture's tmux directory goes. */
export function capturePaths(root: string, captureId: string, build: string, tmuxBase: string): CapturePaths {
  const dir = path.join(captureDirsRoot(root), captureId);
  const work = path.join(dir, 'work');
  return {
    buildFile: path.join(captureBuildsDir(root), build), dir, home: path.join(dir, 'home'), config: path.join(dir, 'config'),
    tmux: captureTmuxDir(tmuxBase, captureId), tmp: path.join(dir, 'tmp'), work, cdDir: path.join(work, CAPTURE_CD_DIR), recording: path.join(dir, 'recording.jsonl'),
  };
}

/** What the desk reads of the build's file: its own kind (never through a link), its hard-link count, and its path with
 *  every link resolved. `null` when it cannot be read. */
export interface BuildFileFacts { readonly regular: boolean; readonly link: boolean; readonly links: number; readonly real: string }

/** Whether the build's file is one the capture may run (review 3623, carried by PR 2's note): a regular file, not a link,
 *  with no second hard link, reached through no link on its path below the box root's real path (`realBuildFile`, the
 *  builds store under the box root with only the root resolved). Any
 *  other answer reads as the build absent, so the lane's next pass copies a fresh one, which the copy's writer places as a
 *  file of its own. Without this, a link or a hard link would let the capture run, and a build under capture write, the
 *  bytes of another version. */
export function capturedBuildUsable(f: BuildFileFacts | null, realBuildFile: string): boolean {
  return f !== null && f.regular && !f.link && f.links === 1 && f.real === realBuildFile;
}

/** Every path the runner writes, for the write guard (`probes.ts#writeRefusal`). */
export const captureWrites = (p: CapturePaths): readonly string[] => [p.dir, p.home, p.config, p.tmux, p.tmp, p.work, p.cdDir, p.recording];

/** The 32 lowercase hex characters of a capture id: the grammar of `shared/claudeBuildCapture.ts#CaptureSubmit`'s
 *  `captureId`, which the frame reader holds in `shared/testbox.ts` (not exported there). */
const CAPTURE_ID = /^[0-9a-f]{32}$/;

/** Which entries of `<root>/captures/` are stale capture directories at the service's start: a capture id, never the
 *  builds store or any other name. The runner removes its own directory at the end, so one found at start is the
 *  leftover of a service that died mid-capture. The act (the removals) is `main.ts#sweepStaleCaptures`'s. */
export const staleCaptureDirs = (names: readonly string[]): string[] => names.filter((n) => CAPTURE_ID.test(n));

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
    ['TMUX_TMPDIR', p.tmux], ['TMPDIR', p.tmp], ['ANTHROPIC_BASE_URL', `http://127.0.0.1:${standInPort}`], ['ANTHROPIC_AUTH_TOKEN', CAPTURE_TOKEN],
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
  { type: '/model haiku', waitFor: ['PreModelSwitch', 'PostModelSwitch'] },   // before any turn, so no cache dialog (W0-12); door process B2
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

// ── the timing contract (review 3226 F8; review 3316 F1, A3; gate G1) ─────────────────────────────────────────────
//
// ONE CONTRACT, READ BY EVERY BOUND OF A CAPTURE. The entry point builds the runner and the launcher from
// `CAPTURE_TIMINGS` (`main.ts#captureRunnerFor`): the runner's step, exit and poll timeouts, its stop wait and the stand-in's
// close bound, and the launcher's bound per tmux call, and the delivery recipe's driver, kill grace, settle and quiet bounds
// (`captureDelivery.ts#deliveryWorstCaseMs`). The desk's late check reads the same object, for either recipe. `captureWorstCaseMs`
// is the worst case of one capture by that runner, and `testbox-capture-deadline.test.ts` runs the composed runner on a
// virtual clock, every tmux call at its bound, to hold that the runner never takes longer than it says.

/** The timings of one capture. The fleet agent waits `TESTBOX_CAPTURE_DEADLINE_MS` for the verdict and then closes its
 *  connection, so a verdict sent after that is lost; the timings are chosen so that two captures, one waiting behind the
 *  other, fit that deadline under {@link captureWorstCaseMs} (pinned by `testbox-capture-deadline.test.ts`). */
export interface CaptureTimings {
  /** The runner's `stepTimeoutMs`: how long one step may take to raise its events. */
  readonly stepMs: number;
  /** The runner's `exitTimeoutMs`: how long the build may take to exit after the last step. */
  readonly exitMs: number;
  /** The runner's `pollMs`: the recording's poll, and the poll of every wait on the build. */
  readonly pollMs: number;
  /** The bound of one tmux call, `tmuxLauncher`'s `boundMs`. A call answers within its bound plus the bounded spawner's
   *  drain (`exec.ts#boundedExec`, `UPDATE_SPAWN_DRAIN_MS`). */
  readonly tmuxCallMs: number;
  /** The runner's `stopWaitMs` (PR 2's stop wait): how long, after `stop`, it waits for the build to be gone. */
  readonly stopWaitMs: number;
  /** The runner's `standInCloseMs`: how long it waits for the stand-in model to close. */
  readonly standInCloseMs: number;
  /** An ALLOWANCE, not a bound: the scratch directory, the seeded config and the stand-in's start, which nothing bounds. */
  readonly setupMs: number;
  /** An ALLOWANCE, not a bound: the removal of the scratch directory and the tmux directory at the end. */
  readonly removeMs: number;
  /** The delivery recipe's (Desktop polish wave 178): how long the driver child may take for one case (its node start, and
   *  `sendPrompt` with its own echo, clear and submit budgets); past it the child is killed and the capture answers no
   *  verdict. */
  readonly deliveryDriveMs: number;
  /** The delivery recipe's: how long the driver child's process group has between SIGTERM and SIGKILL once its bound has
   *  passed (then one drain), so a case's driver can take its bound, this grace and the drain (the capture owner's call
   *  1208). */
  readonly deliveryKillGraceMs: number;
  /** The delivery recipe's: how long, after a case's send, its turn may take to end (a Stop recorded). */
  readonly deliverySettleMs: number;
  /** The delivery recipe's: how long a case's window stays open after its turn ended (or the settle bound passed), so a
   *  late second submit still falls in that case's window. */
  readonly deliveryQuietMs: number;
}

/** The contract. A step of the drive against the stand-in takes seconds; 35 s each leaves room on a slow box. */
export const CAPTURE_TIMINGS: CaptureTimings = Object.freeze({
  stepMs: 35_000, exitMs: 30_000, pollMs: 500, tmuxCallMs: 5_000, stopWaitMs: 5_000, standInCloseMs: 2_000, setupMs: 10_000, removeMs: 5_000,
  deliveryDriveMs: 25_000, deliveryKillGraceMs: 1_000, deliverySettleMs: 15_000, deliveryQuietMs: 2_000,
});

/** The slack kept beside the worst case: the frames' travel and the clocks of two processes. */
export const CAPTURE_DEADLINE_MARGIN_MS = 30_000;

/** The worst case of ONE capture by the runner the entry point wires (`captureRunner.ts#CaptureRunner` with
 *  `#tmuxLauncher`), under `t`, each tmux call counted at its bound plus the drain: the setup allowance; the start (one
 *  call, which also reads the build's process); each typed step's two calls (the text, then Enter); each step's wait, which
 *  can overrun by one poll; the exit wait, which can overrun by one poll (the build's life is read from its process, not by
 *  a tmux call); the stop (one call, the kill of the private server), then the stop wait, which can overrun by one poll;
 *  the stand-in's close bound; and the removal allowance. The setup and the removal are allowances, not bounds. */
export function captureWorstCaseMs(t: CaptureTimings, steps: readonly CaptureStep[] = CAPTURE_STEPS): number {
  const call = t.tmuxCallMs + UPDATE_SPAWN_DRAIN_MS;
  const start = t.setupMs + call;
  const drive = steps.reduce((ms, s) => ms + (s.type === null ? 0 : 2 * call) + t.stepMs + t.pollMs, 0);
  const exit = t.exitMs + t.pollMs;
  const teardown = call + t.stopWaitMs + t.pollMs + t.standInCloseMs + t.removeMs;
  return start + drive + exit + teardown;
}

/** What a capture that started too late to answer in time is told: no verdict, and why. */
export const CAPTURE_LATE_DETAIL = 'the capture waited in the queue too long to finish before the fleet agent stops waiting: not run, no verdict';

/** What a capture that waited while the box admits no work is told (gate G2): no verdict, and why. */
export const CAPTURE_CLOSED_DETAIL = 'the test box admits no work now (a tool sync is taking over, or a drain stands): not run, no verdict';

/** Whether a capture that has waited `waitedMs` since its submission must not start: its worst case under `t` and the
 *  margin would end past the fleet agent's deadline, so its verdict would be lost. The desk ends it with
 *  {@link CAPTURE_LATE_DETAIL}. */
export function captureStartsLate(waitedMs: number, t: CaptureTimings = CAPTURE_TIMINGS, deadlineMs: number = TESTBOX_CAPTURE_DEADLINE_MS): boolean {
  return waitedMs + captureWorstCaseMs(t) + CAPTURE_DEADLINE_MARGIN_MS > deadlineMs;
}

// ── the tmux socket (review 3226 F8) ─────────────────────────────────────────────────────────────────────────────

/** The longest unix socket path the capture uses, in bytes: under macOS's 104 and Linux's 108 with the terminating byte. */
export const CAPTURE_SOCKET_PATH_MAX = 103;

/** The capture's tmux directory (its `TMUX_TMPDIR`): a directory of its own under `base`, the service's temporary
 *  directory (`/tmp`, private to the unit), named by the whole capture id. Under `<CCRC_TESTBOX_ROOT>/captures/<id>` a long
 *  root made every socket path too long and every capture fail to start. */
export const captureTmuxDir = (base: string, captureId: string): string => path.join(base, captureTmuxDirName(captureId));

/** Where tmux puts the capture server's socket: `<TMUX_TMPDIR>/tmux-<uid>/<-L name>`. */
export const captureSocketPath = (base: string, captureId: string, uid: number): string =>
  path.join(captureTmuxDir(base, captureId), `tmux-${uid}`, CAPTURE_SOCKET);

/** Whether every capture's socket path under `base` fits {@link CAPTURE_SOCKET_PATH_MAX} for `uid` (every id is 32
 *  characters, so one stands for all). When it does not, the entry point wires no runner, so the box answers `no-runner`. */
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
