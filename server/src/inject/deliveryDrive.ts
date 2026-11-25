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
// Its answer is one JSON line on stdout: `{"send":"ok"}`, or `{"send":"<sendPrompt's refusal word>"}`; or, for a refused
// input, `{"refused":"<word>","detail":"<sentence>"}` with exit status 2. It decides no verdict: the runner does.
import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPDATE_SPAWN_DRAIN_MS } from '../../../shared/agent-protocol.js';
import { CAPTURE_SOCKET, CAPTURE_TMUX_SESSION, captureTmuxDirName } from '../../../shared/claudeBuildCapture.js';
import { deliveryCaseText } from '../../../shared/deliveryCapture.js';
import { isDeliveryCaseId, type DeliveryCaseId } from '../../../shared/deliveryResult.js';
import { boundedSpawn } from '../../../shared/spawn.mjs';
import { RUN_ID } from '../../../shared/testbox.js';
import { tmuxCommand } from '../../../shared/tmux-target.js';
import { Tmux, type ExecResult, type Runner } from '../exec.js';
import { KeyedQueue } from './queue.js';
import { sendPrompt, type SendDeps } from './send.js';

/** Why the driver refuses its input. */
export type DriveRefusal = 'bad-input' | 'capture-dir' | 'tmux-dir' | 'case';

/** A checked input: the capture's scratch directory, its tmux directory, and the case. */
export interface DriveInput { readonly capture: string; readonly tmux: string; readonly case: DeliveryCaseId }

/** Whether `p` is a real directory, read without following a link at its name (`lstat`: a link, even to a directory, is
 *  not one); `false` when it cannot be read. */
export const realDir = (p: string): boolean => {
  try { return lstatSync(p).isDirectory(); } catch { return false; }
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An absolute path written in its one normal form (no `.`, `..`, doubled or trailing separator). */
const normalAbsolute = (p: string): boolean => path.isAbsolute(p) && path.normalize(p) === p && (p === '/' || !p.endsWith('/'));

/** THE input rule: `{capture, tmux, case}` and nothing else, each checked, or the refusal and why. `tmpBase` is this
 *  process's temporary directory, the parent the capture's tmux directory must have. */
export function readDriveInput(raw: unknown, isDir: (p: string) => boolean = realDir, tmpBase: string = os.tmpdir()):
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
  return { ok: true, input: { capture, tmux, case: raw['case'] } };
}

/** The bound of one tmux call. */
export const DRIVE_TMUX_CALL_MS = 5_000;

/** The system path the child's tmux is found on when the driver was given none. */
const SYSTEM_PATH = '/usr/local/bin:/usr/bin:/bin';

/** The capture's own server, as the one socket lookup's setting: its name, never the fleet's file. */
const CAPTURE_SOCKET_SETTING = { kind: 'text', text: CAPTURE_SOCKET } as const;

/** The Runner over the capture's own tmux server: each call through the one socket lookup (`tmuxCommand`, so `-L
 *  ccrc-capture`), with `TMUX_TMPDIR` the capture's tmux directory, in an environment built from empty, each call bounded.
 *  It runs tmux only; any other command is answered not run. */
export function captureTmuxRunner(tmuxDir: string, pathVar: string | undefined, boundMs = DRIVE_TMUX_CALL_MS): Runner {
  const env = { PATH: pathVar !== undefined && pathVar !== '' ? pathVar : SYSTEM_PATH, TMUX_TMPDIR: tmuxDir, LANG: 'C.UTF-8' };
  return async (cmd, args): Promise<ExecResult> => {
    if (cmd !== 'tmux') return { ran: false, reason: 'spawn', detail: `the delivery driver runs tmux only, not ${cmd}`, code: 1, stdout: '', stderr: '' };
    const routed = tmuxCommand(CAPTURE_SOCKET_SETTING, args);
    // The one bounded spawner (`shared/spawn.mjs#boundedSpawn`): its own group, killed at the bound, a drain deadline.
    const r = await boundedSpawn({ spawn, signals: os.constants.signals }, routed.file, routed.args, { env, timeoutMs: boundMs, drainMs: UPDATE_SPAWN_DRAIN_MS });
    if (r.pid === null) return { ran: false, reason: 'spawn', detail: r.stderr.trim() || 'tmux could not start', code: 1, stdout: '', stderr: r.stderr };
    if (r.killed || r.stdout === null) return { ran: false, reason: 'timeout', detail: `tmux did not answer whole within ${boundMs} ms`, code: 1, stdout: r.stdout ?? '', stderr: r.stderr };
    return { ran: true, code: r.code, stdout: r.stdout, stderr: r.stderr, killed: false, signal: null };
  };
}

/** The options the prompt route passes `sendPrompt` for a plain prompt (no `replaceDraft`, no attachments, no `resume`). */
export const ROUTE_PLAIN_PROMPT_OPTIONS = Object.freeze({ onDraft: 'refuse' as const, attachments: Object.freeze([]) as readonly string[] });

/** One case through the product's send, on the capture's session: `ok`, or sendPrompt's refusal word. */
export async function driveCase(input: DriveInput, runner: Runner, sleep?: SendDeps['sleep']): Promise<string> {
  const deps: SendDeps = { tmux: new Tmux(runner), queue: new KeyedQueue(), ...(sleep === undefined ? {} : { sleep }) };
  const res = await sendPrompt(deps, CAPTURE_TMUX_SESSION, deliveryCaseText(input.case), ROUTE_PLAIN_PROMPT_OPTIONS);
  return res.ok ? 'ok' : res.error;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** The entry: one JSON input on stdin, one JSON line out. */
export async function main(): Promise<number> {
  let raw: unknown;
  try { raw = JSON.parse(await readStdin()); } catch { raw = undefined; }
  const read = readDriveInput(raw);
  if (!read.ok) { process.stdout.write(`${JSON.stringify({ refused: read.refusal, detail: read.detail })}\n`); return 2; }
  const send = await driveCase(read.input, captureTmuxRunner(read.input.tmux, process.env['PATH']));
  process.stdout.write(`${JSON.stringify({ send })}\n`);
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e: unknown) => {
    process.stdout.write(`${JSON.stringify({ send: 'driver-failed', detail: e instanceof Error ? e.message : String(e) })}\n`);
    process.exitCode = 1;
  });
}
