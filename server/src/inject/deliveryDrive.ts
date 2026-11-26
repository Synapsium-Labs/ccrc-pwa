// The paste delivery recipe's driver (Desktop polish wave 178; task note docs/superpowers/programs/desktop-polish/paste-delivery.md).
// An ENTRY POINT of its own, never imported: the test box's capture runner runs it compiled, as a bounded child, from the
// release tree it is installed from (`<tree>/server/dist/server/src/inject/deliveryDrive.js`), names it by path and never
// imports it (the recorder's precedent). Nothing in the server imports it and no route reaches it; a test pins both.
//
// WHY IT IS A SERVER FILE (legitimately different, recorded in the task note): the recipe measures the product's own send,
// so it must run that code, not a copy of it. It joins the console's send at `sendPrompt` (`./send.ts`), with the options
// the prompt route passes for a plain prompt (`server.ts`'s `POST /api/sessions/:id/prompt`: `onDraft: 'refuse'`, no
// attachments), over the real `Tmux` adapter (`../exec.ts`) and the real `KeyedQueue`. Only the Runner differs: the
// fleet's goes through the agent link and the fleet's socket lookup; this one runs tmux on the capture's own server.
//
// WHAT IT REFUSES, before any tmux call (each pinned by `delivery-drive.test.ts`): anything but a capture's own scratch
// directory (`<root>/captures/<capture id>`, a real directory, not a link), anything but THAT capture's own tmux directory
// (exactly `<this process's temporary directory>/<captureTmuxDirName(the same id)>`, a real directory, not a link; the
// runner keeps it outside the scratch directory, under the test service's temporary directory, so the socket's path
// fits, and starts this child with that directory as its `TMPDIR`), and anything but a case id. There is no default
// socket: every tmux call goes through the one socket lookup (`shared/tmux-target.ts#tmuxCommand`) with the capture's own
// name as its setting, so it is always `-L ccrc-capture` on the given `TMUX_TMPDIR`; the child's environment is built from
// empty, so no `TMUX` or fleet socket setting reaches it. No free text travels: the text is built here from the shared
// cases (`shared/deliveryCapture.ts#deliveryCaseText`).
//
// Its answer is one JSON line on stdout: `{"send":"ok"}`, or `{"send":"<sendPrompt's refusal word>"}`, with exit status 0;
// for a refused input, `{"refused":"<word>","detail":"<sentence>"}` with exit status 2; and for a FAULT OF THE BOX,
// `{"fault":"<the runner's reason>","send":"<the word the send then answered>","detail":"<sentence>"}` with exit status 3
// (`DRIVE_FAULT_EXIT`): a tmux call its own runner could not complete (the per-call bound, a spawn that failed, a signal
// not the bound's) is never
// read as the product's send word (review 3882 F2, the coordinator's ruling), and once one has failed no later call of the
// case runs, so nothing more is typed into a pane that may hold a half-typed draft. It decides no verdict: the runner does,
// and reads any non-zero status as a fault of the box, which ends the part with no verdict.
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPDATE_SPAWN_DRAIN_MS } from '../../../shared/agent-protocol.js';
import { CAPTURE_SOCKET, CAPTURE_TMUX_SESSION, captureTmuxDirName } from '../../../shared/claudeBuildCapture.js';
import {
  FRAMES_HOLD_TEXT, FRAMES_NUDGE_ID, FRAMES_PERSON, FRAMES_TURN_ONE, FRAMES_VIEW_KEY_PAUSE_MS, framesDraftLines, framesViewKeys, readFramesStepWord,
  type FramesDriveStep,
} from '../../../shared/framesCapture.js';
import { FRAMES_PARTS } from '../../../shared/framesResult.js';
import { deliveryCaseText } from '../../../shared/deliveryCapture.js';
import { isDeliveryCaseId, type DeliveryCaseId } from '../../../shared/deliveryResult.js';
import { boundedSpawn } from '../../../shared/spawn.mjs';
import { RUN_ID } from '../../../shared/testbox.js';
import { tmuxCommand, tmuxTarget } from '../../../shared/tmux-target.js';
import { renderMailNudge } from '../coord/envelope.js';
import { Tmux, type ExecResult, type Runner } from '../exec.js';
import { KeyedQueue } from './queue.js';
import { STASH_KEY, sendPrompt, typeComposedLines, type SendDeps } from './send.js';

/** Why the driver refuses its input. */
export type DriveRefusal = 'bad-input' | 'capture-dir' | 'tmux-dir' | 'case' | 'step';

/** A checked input: the capture's scratch directory, its tmux directory, and the case. */
export interface DriveInput { readonly capture: string; readonly tmux: string; readonly case: DeliveryCaseId }

/** Whether `p` is a real directory, read without following a link at its name (`lstat`: a link, even to a directory, is
 *  not one); `false` when it cannot be read. */
export const realDir = (p: string): boolean => {
  try { return lstatSync(p).isDirectory(); } catch { return false; }
};

/** Whether a directory's owner and mode keep it to `uid`: owned by it, and writable by neither group nor other. */
export const privateTo = (st: { readonly uid: number; readonly mode: number }, uid: number): boolean => st.uid === uid && (st.mode & 0o022) === 0;

/** Whether `p` is a real directory (read as {@link realDir} reads it) that this process's own user owns and that neither
 *  group nor other can write: the capture's tmux directory, which the runner makes 0700, must be. `false` when it cannot
 *  be read. */
export const ownPrivateDir = (p: string): boolean => {
  try { const st = lstatSync(p); return st.isDirectory() && privateTo(st, process.getuid?.() ?? -1); } catch { return false; }
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An absolute path written in its one normal form (no `.`, `..`, doubled or trailing separator). */
const normalAbsolute = (p: string): boolean => path.isAbsolute(p) && path.normalize(p) === p && (p === '/' || !p.endsWith('/'));

/** THE input rule: `{capture, tmux, case}` and nothing else, each checked, or the refusal and why. `tmpBase` is this
 *  process's temporary directory, the parent the capture's tmux directory must have; `isOwn` reads that the tmux directory
 *  is this user's and private (the capture owner's call 1145). */
export function readDriveInput(raw: unknown, isDir: (p: string) => boolean = realDir, tmpBase: string = os.tmpdir(), isOwn: (p: string) => boolean = ownPrivateDir):
  { readonly ok: true; readonly input: DriveInput } | { readonly ok: false; readonly refusal: DriveRefusal; readonly detail: string } {
  const no = (refusal: DriveRefusal, detail: string) => ({ ok: false as const, refusal, detail });
  if (!isObj(raw) || Object.keys(raw).sort().join() !== 'capture,case,tmux') return no('bad-input', 'the input is not exactly {capture, tmux, case}');
  const { capture, tmux } = raw;
  if (typeof capture !== 'string' || typeof tmux !== 'string') return no('bad-input', 'capture and tmux are not strings');
  if (!isDeliveryCaseId(raw['case'])) return no('case', 'not a delivery case id');
  const id = path.basename(capture);
  if (!normalAbsolute(capture) || !RUN_ID.test(id) || path.basename(path.dirname(capture)) !== 'captures') {
    return no('capture-dir', 'not a capture\'s scratch directory (<root>/captures/<capture id>)');
  }
  if (!isDir(capture)) return no('capture-dir', 'the capture\'s scratch directory is not a real directory (absent, a file or a link)');
  if (!normalAbsolute(tmux) || tmux !== path.join(tmpBase, captureTmuxDirName(id))) {
    return no('tmux-dir', 'not this capture\'s own tmux directory (its capture id\'s, under this process\'s temporary directory)');
  }
  if (!isDir(tmux)) return no('tmux-dir', 'the capture\'s tmux directory is not a real directory (absent, a file or a link)');
  if (!isOwn(tmux)) return no('tmux-dir', 'the capture\'s tmux directory is not this user\'s own, or group or other can write it');
  return { ok: true, input: { capture, tmux, case: raw['case'] } };
}

/** The bound of one tmux call. */
export const DRIVE_TMUX_CALL_MS = 5_000;

/** The system path the child's tmux is found on when the driver was given none. */
const SYSTEM_PATH = '/usr/local/bin:/usr/bin:/bin';

/** The capture's own server, as the one socket lookup's setting: its name, never the fleet's file. */
const CAPTURE_SOCKET_SETTING = { kind: 'text', text: CAPTURE_SOCKET } as const;

/** The status at or above which a tmux client that exited on its own was ended by a signal (`shared/spawn.mjs#boundedSpawn`
 *  answers a signal end as `128 + signo`; tmux's own statuses are 0 and 1). */
export const DRIVE_SIGNAL_EXIT_MIN = 128;

/** The Runner over the capture's own tmux server: each call through the one socket lookup (`tmuxCommand`, so `-L
 *  ccrc-capture`), with `TMUX_TMPDIR` the capture's tmux directory, in an environment built from empty, each call bounded.
 *  It runs tmux only; any other command is answered not run.
 *
 *  WHAT IS A FAULT OF THE BOX (not run, so the case halts and no verdict is given): a tmux that could not start; a call
 *  killed at its bound, or whose output did not arrive whole; and a tmux client ended by a signal that was not the bound's
 *  own kill (an exit of {@link DRIVE_SIGNAL_EXIT_MIN} or more, wave 184's ruling F5). A tmux that ran and exited non-zero
 *  on its own (1: no such session, a key it refused) is the product's own answer: the send reads it, as it does on the
 *  fleet. */
export function captureTmuxRunner(tmuxDir: string, pathVar: string | undefined, boundMs = DRIVE_TMUX_CALL_MS): Runner {
  const env = { PATH: pathVar !== undefined && pathVar !== '' ? pathVar : SYSTEM_PATH, TMUX_TMPDIR: tmuxDir, LANG: 'C.UTF-8' };
  return async (cmd, args): Promise<ExecResult> => {
    if (cmd !== 'tmux') return { ran: false, reason: 'spawn', detail: `the delivery driver runs tmux only, not ${cmd}`, code: 1, stdout: '', stderr: '' };
    const routed = tmuxCommand(CAPTURE_SOCKET_SETTING, args);
    // The one bounded spawner (`shared/spawn.mjs#boundedSpawn`): its own group, killed at the bound, a drain deadline.
    const r = await boundedSpawn({ spawn, signals: os.constants.signals }, routed.file, routed.args, { env, timeoutMs: boundMs, drainMs: UPDATE_SPAWN_DRAIN_MS });
    if (r.pid === null) return { ran: false, reason: 'spawn', detail: r.stderr.trim() || 'tmux could not start', code: 1, stdout: '', stderr: r.stderr };
    if (r.killed || r.stdout === null) return { ran: false, reason: 'timeout', detail: `tmux did not answer whole within ${boundMs} ms`, code: 1, stdout: r.stdout ?? '', stderr: r.stderr };
    if (r.code >= DRIVE_SIGNAL_EXIT_MIN) return { ran: false, reason: 'spawn', detail: `tmux was ended by a signal that was not the bound's kill (exit ${r.code})`, code: 1, stdout: r.stdout, stderr: r.stderr };
    return { ran: true, code: r.code, stdout: r.stdout, stderr: r.stderr, killed: false, signal: null };
  };
}

/** A runner that stops at its first fault: the first call `inner` answers not run (its bound, a spawn that failed) is
 *  recorded, and every later call is answered not run without reaching `inner`, so no key follows a call that may have
 *  half-typed. `fault()` reads the first such answer, or null when every call ran. */
export function haltingRunner(inner: Runner): { readonly run: Runner; readonly fault: () => { readonly reason: string; readonly detail: string } | null } {
  let first: { reason: string; detail: string } | null = null;
  const run: Runner = async (cmd, args) => {
    if (first !== null) return { ran: false, reason: 'spawn', detail: 'not run: an earlier tmux call of this case could not complete', code: 1, stdout: '', stderr: '' };
    const r = await inner(cmd, args);
    if (!r.ran) first = { reason: r.reason, detail: r.detail ?? '' };
    return r;
  };
  return { run, fault: () => first };
}

/** One case's outcome: the send's word (`ok`, or sendPrompt's refusal word), when every tmux call ran; or a fault of the
 *  box, the first call the runner could not complete, beside the word the send then answered (never read as the product's). */
export type DriveOutcome =
  | { readonly kind: 'sent'; readonly send: string }
  | { readonly kind: 'fault'; readonly reason: string; readonly detail: string; readonly send: string };

/** The exit status of a fault of the box. */
export const DRIVE_FAULT_EXIT = 3;

/** The driver's one stdout line and exit status for an outcome. */
export function driveAnswer(o: DriveOutcome): { readonly code: number; readonly line: string } {
  if (o.kind === 'sent') return { code: 0, line: JSON.stringify({ send: o.send }) };
  return { code: DRIVE_FAULT_EXIT, line: JSON.stringify({ fault: o.reason, send: o.send, detail: o.detail.slice(0, 200) }) };
}

/** The options the prompt route passes `sendPrompt` for a plain prompt (no `replaceDraft`, no attachments, no `resume`). */
export const ROUTE_PLAIN_PROMPT_OPTIONS = Object.freeze({ onDraft: 'refuse' as const, attachments: Object.freeze([]) as readonly string[] });

/** One case through the product's send, on the capture's session: the send's word, or a fault of the box. */
export async function driveCase(input: DriveInput, runner: Runner, sleep?: SendDeps['sleep']): Promise<DriveOutcome> {
  const halt = haltingRunner(runner);
  const deps: SendDeps = { tmux: new Tmux(halt.run), queue: new KeyedQueue(), ...(sleep === undefined ? {} : { sleep }) };
  // The route's own options, `onDraft` spelled at the call: `lane-draft-never-blocks.test.ts` reads each call's policy there.
  const res = await sendPrompt(deps, CAPTURE_TMUX_SESSION, deliveryCaseText(input.case),
    { onDraft: ROUTE_PLAIN_PROMPT_OPTIONS.onDraft, attachments: ROUTE_PLAIN_PROMPT_OPTIONS.attachments });
  const send = res.ok ? 'ok' : res.error;
  const fault = halt.fault();
  return fault === null ? { kind: 'sent', send } : { kind: 'fault', reason: fault.reason, detail: fault.detail, send };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// ── the box frames recipe's form (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md
// section 4.2) ──────────────────────────────────────────────────────────────────────────────────────────────────────
// The same entry point, the same directory refusals and the same runner: the capture's own tmux server only, through the
// one socket lookup, halting at the first call that could not complete. Its input names ONE step by its word
// (`shared/framesCapture.ts#framesStepWord`), never text: the driver builds every text from the shared case file at the
// part's own pane. Every key it types is the product's (`typeComposedLines`, `sendPrompt`, `STASH_KEY`), except the
// recipe's two named shapes, `person` and the view keys. It decides nothing: the runner reduces and judges.

/** A checked frames input: the capture's scratch directory, its tmux directory, and one step. */
export interface FramesDriveInput { readonly capture: string; readonly tmux: string; readonly step: FramesDriveStep }

/** The frames input rule: `{capture, tmux, frames}` and nothing else, the directories checked by the case form's own rule
 *  (`readDriveInput`, asked with a fixed case so its checks run unchanged), and the step a word the grammar reads. */
export function readFramesDriveInput(raw: unknown, isDir: (p: string) => boolean = realDir, tmpBase: string = os.tmpdir(), isOwn: (p: string) => boolean = ownPrivateDir):
  { readonly ok: true; readonly input: FramesDriveInput } | { readonly ok: false; readonly refusal: DriveRefusal; readonly detail: string } {
  if (!isObj(raw) || Object.keys(raw).sort().join() !== 'capture,frames,tmux') return { ok: false, refusal: 'bad-input', detail: 'the input is not exactly {capture, tmux, frames}' };
  const step = readFramesStepWord(raw['frames']);
  if (step === null) return { ok: false, refusal: 'step', detail: 'not a frames step word' };
  const dirs = readDriveInput({ capture: raw['capture'], tmux: raw['tmux'], case: 'c0' }, isDir, tmpBase, isOwn);
  if (!dirs.ok) return dirs;
  return { ok: true, input: { capture: dirs.input.capture, tmux: dirs.input.tmux, step } };
}

/** How long the frame step waits for two equal reads, and the pause between two reads. */
export const FRAMES_FRAME_SETTLE_MS = 10_000;
export const FRAMES_FRAME_READ_PAUSE_MS = 500;

/** One frames step's outcome: a send word, a typing step's answer, a frame, or a fault of the box. */
export type FramesDriveOutcome =
  | { readonly kind: 'sent'; readonly send: string }
  | { readonly kind: 'typed'; readonly typed: boolean }
  | { readonly kind: 'frame'; readonly frame: string | null; readonly cursor: readonly [number, number] | null; readonly settled: boolean }
  | { readonly kind: 'fault'; readonly reason: string; readonly detail: string };

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One frames step on the capture's session, through a runner that stops at its first fault. */
export async function driveFramesStep(input: FramesDriveInput, runner: Runner, sleep: (ms: number) => Promise<void> = realSleep, now: () => number = Date.now): Promise<FramesDriveOutcome> {
  const halt = haltingRunner(runner);
  const tmux = new Tmux(halt.run);
  const deps: SendDeps = { tmux, queue: new KeyedQueue(), sleep };
  const S = CAPTURE_TMUX_SESSION;
  // The route's own options, `onDraft` spelled at the call: `lane-draft-never-blocks.test.ts` reads each call's policy there.
  const send = async (text: string): Promise<string> => {
    const res = await sendPrompt(deps, S, text, { onDraft: ROUTE_PLAIN_PROMPT_OPTIONS.onDraft, attachments: ROUTE_PLAIN_PROMPT_OPTIONS.attachments });
    return res.ok ? 'ok' : res.error;
  };
  const step = input.step;
  let out: FramesDriveOutcome;
  if (step.kind === 'turn') out = { kind: 'sent', send: await send(step.which === 1 ? FRAMES_TURN_ONE : renderMailNudge(FRAMES_NUDGE_ID)) };
  else if (step.kind === 'held') out = { kind: 'sent', send: await send(FRAMES_HOLD_TEXT) };
  else if (step.kind === 'stash') out = { kind: 'typed', typed: await tmux.sendKey(S, STASH_KEY) };
  else if (step.kind === 'frame') {
    let prev = await tmux.captureAnsi(S);
    let settled = false;
    const deadline = now() + FRAMES_FRAME_SETTLE_MS;
    while (prev !== null && now() < deadline) {
      await sleep(FRAMES_FRAME_READ_PAUSE_MS);
      const next = await tmux.captureAnsi(S);
      if (next === prev) { settled = true; break; }
      prev = next;
    }
    const cur = prev === null ? null : await halt.run('tmux', ['display-message', '-p', '-t', tmuxTarget(S), '#{cursor_x} #{cursor_y}']);
    const m = cur !== null && cur.ran && cur.code === 0 ? /^(\d+) (\d+)\s*$/.exec(cur.stdout) : null;
    out = { kind: 'frame', frame: prev, cursor: m === null ? null : [Number(m[1]), Number(m[2])], settled };
  } else {
    const p = FRAMES_PARTS[step.part]!;
    const lines = framesDraftLines(p.case, p.pane);
    if (step.kind === 'send' || step.kind === 'queued') out = { kind: 'sent', send: await send(lines.join('\n')) };
    else if (step.kind === 'type') out = { kind: 'typed', typed: await typeComposedLines(tmux, S, lines) };
    else if (step.kind === 'keys') {
      let ok = true;
      for (const k of framesViewKeys(p.case)) { if (!(await tmux.sendKey(S, k))) { ok = false; break; } await sleep(FRAMES_VIEW_KEY_PAUSE_MS); }
      out = { kind: 'typed', typed: ok };
    } else {
      // The person's shape, the recipe's own: each line as plain literal bursts, a pause between, the Enter-free newline.
      let ok = true;
      for (const [i, line] of lines.entries()) {
        if (i > 0 && !(await tmux.sendKey(S, FRAMES_PERSON.newline))) { ok = false; break; }
        for (let at = 0; ok && at < line.length; at += FRAMES_PERSON.burst) {
          if (!(await tmux.sendLiteral(S, line.slice(at, at + FRAMES_PERSON.burst)))) ok = false;
          else await sleep(FRAMES_PERSON.pauseMs);
        }
        if (!ok) break;
      }
      out = { kind: 'typed', typed: ok };
    }
  }
  const fault = halt.fault();
  return fault === null ? out : { kind: 'fault', reason: fault.reason, detail: fault.detail };
}

/** The frames step's one stdout line and exit status: 0 with the answer, or the fault exit. The frame line carries the
 *  RAW frame, which never leaves the test box: the runner reads it from this pipe, reduces it and lets it go. */
export function framesDriveAnswer(o: FramesDriveOutcome): { readonly code: number; readonly line: string } {
  if (o.kind === 'fault') return { code: DRIVE_FAULT_EXIT, line: JSON.stringify({ fault: o.reason, detail: o.detail.slice(0, 200) }) };
  if (o.kind === 'sent') return { code: 0, line: JSON.stringify({ send: o.send }) };
  if (o.kind === 'typed') return { code: 0, line: JSON.stringify({ typed: o.typed }) };
  return { code: 0, line: JSON.stringify({ frame: o.frame, cursor: o.cursor, settled: o.settled }) };
}

/** The entry: one JSON input on stdin, one JSON line out. The input's keys pick the form: `case` the delivery recipe's,
 *  `frames` the box frames recipe's. */
export async function main(): Promise<number> {
  let raw: unknown;
  try { raw = JSON.parse(await readStdin()); } catch { raw = undefined; }
  if (isObj(raw) && Object.prototype.hasOwnProperty.call(raw, 'frames')) {
    const fr = readFramesDriveInput(raw);
    if (!fr.ok) { process.stdout.write(`${JSON.stringify({ refused: fr.refusal, detail: fr.detail })}\n`); return 2; }
    const answer = framesDriveAnswer(await driveFramesStep(fr.input, captureTmuxRunner(fr.input.tmux, process.env['PATH'])));
    process.stdout.write(`${answer.line}\n`);
    return answer.code;
  }
  const read = readDriveInput(raw);
  if (!read.ok) { process.stdout.write(`${JSON.stringify({ refused: read.refusal, detail: read.detail })}\n`); return 2; }
  const answer = driveAnswer(await driveCase(read.input, captureTmuxRunner(read.input.tmux, process.env['PATH'])));
  process.stdout.write(`${answer.line}\n`);
  return answer.code;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e: unknown) => {
    process.stdout.write(`${JSON.stringify({ send: 'driver-failed', detail: e instanceof Error ? e.message : String(e) })}\n`);
    process.exitCode = 1;
  });
}
