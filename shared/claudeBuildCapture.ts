// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md; the D-8289 plan's Open
// item). L0: imports only `shared/` siblings (the PWA bundles this file). The capture is a test box job kind: the lane sends
// `capture.submit` for one Claude Code build, the box drives that build against a scripted stand-in model in a scratch home,
// records its hook payloads, live status file and statusline JSON, and replays the recording against the grammar below.
// The verdict travels back as `capture.state` and is read by `readBuildCaptureResult` (`shared/claudeBuildTrust.ts`), the
// verdict's one reader. The frames' reader is `shared/testbox.ts#readTestboxFrame`, the frame family's one reader.
//
// ONE GRAMMAR. The tables below state what ccrc's readers rely on, per source: the hook payloads `ccd/session-hook.sh`
// reads, the live status file `server/src/livestate.ts` reads and the statusline JSON `ccd/statusline-command.sh` and
// `server/src/pane/statusline.ts` read. `replayCapture` is the replay suite: it checks a recording against them and answers
// the `BuildCaptureResult` the record stores. A build that started and did not finish the drive FAILS here
// (`finished: false`, departure `stalled-build-fails`); only a capture that could not start is no verdict, and the lane keeps
// that build queued.
import { readBuildCaptureResult, type BuildCaptureResult } from './claudeBuildTrust.js';
import type { DeliveryCaptureResult } from './deliveryResult.js';
import type { FramesCaptureResult } from './framesResult.js';
import { HOOK_EVENTS, hookEventIs, isHookEvent, type HookEvent } from './hook-events.js';

// ── the job kind's words ─────────────────────────────────────────────────────────────────────────────────────────

/** Why the box takes no capture. `not-test-box`: the node's install config is not a test box's (`probeRole`).
 *  `no-runner`: the box has no capture runner wired to its desk. `build-absent`: the box does not hold the build's bytes
 *  (the admin lane's copy has not placed them). `path-refused`: a path the capture would write is, or is inside, a fleet
 *  account's config directory (the probe desk's write guard). `capture-id-used`: that capture id is already queued,
 *  running or ended. */
export type CaptureRefusal = 'not-test-box' | 'no-runner' | 'build-absent' | 'path-refused' | 'capture-id-used';
export const CAPTURE_REFUSAL_MAP: Record<CaptureRefusal, true> = {
  'not-test-box': true, 'no-runner': true, 'build-absent': true, 'path-refused': true, 'capture-id-used': true,
};
export const CAPTURE_REFUSALS: readonly CaptureRefusal[] = Object.keys(CAPTURE_REFUSAL_MAP) as CaptureRefusal[];

/** Each refusal in one sentence, sent as the refused frame's `detail`. */
export const CAPTURE_REFUSAL_SENTENCE: Readonly<Record<CaptureRefusal, string>> = Object.freeze({
  'not-test-box': 'this node is not the configured test box: builds are captured on the test box only, never on the fleet',
  'no-runner': 'no capture runner is wired to the test box',
  'build-absent': 'the test box does not hold this build yet',
  'path-refused': "a path the capture would write is, or is inside, a fleet account's config directory",
  'capture-id-used': 'that capture id is already used',
});

/** Where a capture is: refused (never queued), waiting, running, or ended. An ended capture carries its verdict, or none
 *  when the capture could not start or the runner failed, which the lane reads as no verdict (a build that started and
 *  stalled carries a failing verdict). */
export type CaptureStateWord = 'refused' | 'queued' | 'running' | 'ended';
export const CAPTURE_STATE_WORD_MAP: Record<CaptureStateWord, true> = { refused: true, queued: true, running: true, ended: true };

/** Which recipe a capture runs on the one runner (Desktop polish wave 178). `build-trust`: the drive of the spec's Table 1,
 *  whose replay is the build's trust verdict (`result`). `delivery`: the fixed paste delivery cases sent through the
 *  product's own send (`shared/deliveryCapture.ts`), whose result (`delivery`) never reads or writes the build-trust
 *  record. `frames` (Desktop polish wave 187, the capture owner's calls 1549 and 1558): one case of the fixed box frames
 *  (`shared/framesCapture.ts`) at one pane size, whose result (`frames`) is one REDUCED frame and never reads or writes
 *  the build-trust or the delivery record. ADDITIVE: a submission with no `recipe` is build trust, its one spelling, so
 *  every sender before the delivery recipe is unchanged, and a box that predates a recipe refuses its `recipe` field as it
 *  refuses any extra field. */
export type CaptureRecipe = 'build-trust' | 'delivery' | 'frames';
export const CAPTURE_RECIPE_MAP: Record<CaptureRecipe, true> = { 'build-trust': true, delivery: true, frames: true };

/** The job: capture one build, under a fresh id. */
export interface CaptureSubmit {
  readonly t: 'capture.submit';
  /** 32 lowercase hex characters, drawn at random by the sender. */
  readonly captureId: string;
  /** The Claude Code build, `isClaudeVersion`. */
  readonly build: string;
  /** Absent: build trust. Present only as `delivery` or `frames` (see {@link CaptureRecipe}). */
  readonly recipe?: 'delivery' | 'frames';
  /** Present exactly when `recipe` is: which part of that recipe this capture runs, an index into
   *  `deliveryResult.ts#deliveryParts` (the capture owner's call 1148) or `framesResult.ts#FRAMES_PARTS` (one case at one
   *  pane size). Each part is a capture of its own. */
  readonly part?: number;
}

/** The recipe a submission names: absence is build trust. */
export const captureRecipeOf = (f: Pick<CaptureSubmit, 'recipe'>): CaptureRecipe => f.recipe ?? 'build-trust';

// ── the capture's own terminal server (moved from agent/src/testbox/capture.ts, which re-exports them) ─────────────
// The names a capture's private tmux server goes by, here so that the delivery driver (`server/src/inject/deliveryDrive.ts`,
// in another package) can refuse to address anything else: a fixed `-L` name, a fixed session, and a tmux directory named
// by the whole capture id, never the fleet's server or socket.

/** The capture's own tmux server (`-L`), on the capture's own `TMUX_TMPDIR`: never `default`, the fleet's. */
export const CAPTURE_SOCKET = 'ccrc-capture';

/** The tmux session the build runs in, on {@link CAPTURE_SOCKET}. */
export const CAPTURE_TMUX_SESSION = 'capture';

/** The base name of one capture's tmux directory (its `TMUX_TMPDIR`), named by the whole capture id. */
export const captureTmuxDirName = (captureId: string): string => `ccrc-capture-${captureId}`;

/** Where a capture is. `refusal` only on `refused`; `detail` on `refused` (the refusal's sentence) and on an `ended`
 *  capture with no verdict (why); `position` (1-based) only on `queued`; `result` only on `ended`, null when there is no
 *  verdict. */
export interface CaptureAnswer {
  readonly t: 'capture.state';
  readonly captureId: string;
  readonly build: string;
  readonly state: CaptureStateWord;
  readonly refusal: CaptureRefusal | null;
  readonly detail: string | null;
  readonly position: number | null;
  readonly result: BuildCaptureResult | null;
  /** A delivery capture's frames only, and every one of them (absent on build trust's): its result on `ended`, null
   *  there when there is no verdict and on every other state. A delivery capture's `result` is always null. */
  readonly delivery?: DeliveryCaptureResult | null;
  /** A frames capture's frames only, and every one of them (absent on the other recipes'): its result on `ended`, null
   *  there when there is no result and on every other state. A frames capture's `result` is always null, and a frame
   *  names `delivery` or `frames`, never both. */
  readonly frames?: FramesCaptureResult | null;
}

// ── the recording ────────────────────────────────────────────────────────────────────────────────────────────────

/** The drive's write (spec Table 1, step 2): the Bash command the stand-in asks for after `cd sub`. It writes a file, so
 *  the build raises a permission prompt for it, and that prompt is the one that proves the `cwd` fact and the approval
 *  wait's output side. The stand-in (`agent/src/testbox/capture.ts#standInReply`) and the replay read this one value. */
export const CAPTURE_WRITE_COMMAND = 'touch ccrc-capture-mark';

/** One line of the recording, as the recorder writes it: what a hook or the statusline command was given on its stdin,
 *  and a copy of the live status file taken at that moment (null when none could be read). A hook line that the
 *  recorder answered carries `answer`, the decision it printed (`allow` for a PermissionRequest). */
export type CaptureRecord =
  | { readonly kind: 'hook'; readonly event: string; readonly payload: unknown; readonly status: unknown; readonly answer?: string }
  | { readonly kind: 'statusline'; readonly payload: unknown; readonly status: unknown };

/** A whole recording: its lines, the directory the drive's `cd` moved into (the PermissionRequest's expected `cwd`), and
 *  whether the drive ran every step and the build exited. Lines the reader could not read are counted, never dropped. */
export interface CaptureRecording {
  readonly records: readonly CaptureRecord[];
  readonly unreadable: number;
  readonly cdDir: string;
  readonly finished: boolean;
}

/** The recording file's ONE reader: one JSON object per line. A line that is not a record is counted in `unreadable`. */
export function readCaptureRecords(text: string): { readonly records: CaptureRecord[]; readonly unreadable: number } {
  const records: CaptureRecord[] = [];
  let unreadable = 0;
  for (const l of text.split('\n')) {
    if (l.trim() === '') continue;
    let v: unknown;
    try { v = JSON.parse(l); } catch { unreadable++; continue; }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) { unreadable++; continue; }
    const o = v as Record<string, unknown>;
    // Every shape below names `status` among its exact keys, so a record without one is unreadable, never `null` here.
    const status = o['status'];
    const keys = Object.keys(o).sort().join();
    if (o['kind'] === 'hook' && typeof o['event'] === 'string' && keys === 'event,kind,payload,status') {
      records.push({ kind: 'hook', event: o['event'], payload: o['payload'], status });
    } else if (o['kind'] === 'hook' && typeof o['event'] === 'string' && typeof o['answer'] === 'string' && keys === 'answer,event,kind,payload,status') {
      records.push({ kind: 'hook', event: o['event'], payload: o['payload'], status, answer: o['answer'] });
    } else if (o['kind'] === 'statusline' && Object.keys(o).sort().join() === 'kind,payload,status') {
      records.push({ kind: 'statusline', payload: o['payload'], status });
    } else {
      unreadable++;
    }
  }
  return { records, unreadable };
}

// ── the grammar ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Every hook event ccrc installs (`ccd/install-session-hooks.sh`'s `EVENTS_JSON`, plus `PreToolUse`, which gets its own
 *  matcher entry): the one vocabulary, `shared/hook-events.ts#HOOK_EVENTS`, not a second list. Every one must be recorded
 *  for a pass. */
export const CAPTURE_EVENTS: readonly HookEvent[] = HOOK_EVENTS;

/** A JSON value's kind, as a rule names it. `present` admits any value but `undefined`. */
export type CaptureFieldType = 'string' | 'number' | 'boolean' | 'object' | 'present';
export const CAPTURE_FIELD_TYPE_MAP: Record<CaptureFieldType, true> = { string: true, number: true, boolean: true, object: true, present: true };
export const CAPTURE_FIELD_TYPES: readonly CaptureFieldType[] = Object.keys(CAPTURE_FIELD_TYPE_MAP) as CaptureFieldType[];

/** One field a reader relies on: its dotted path, its kind, and whether the reader needs it (an optional field is checked
 *  only for its kind when present). */
export interface CaptureFieldRule { readonly path: string; readonly type: CaptureFieldType; readonly required: boolean }

const req = (path: string, type: CaptureFieldType): CaptureFieldRule => ({ path, type, required: true });
const opt = (path: string, type: CaptureFieldType): CaptureFieldRule => ({ path, type, required: false });

/** What `ccd/session-hook.sh` reads from every hook payload. `hook_event_name` must also name the event recorded. */
export const HOOK_COMMON_RULES: readonly CaptureFieldRule[] = Object.freeze([
  req('session_id', 'string'), req('transcript_path', 'string'), req('cwd', 'string'), req('hook_event_name', 'string'),
]);

/** What `ccd/session-hook.sh` reads from each event's payload beyond the common fields. */
export const HOOK_EVENT_RULES: Readonly<Record<HookEvent, readonly CaptureFieldRule[]>> = Object.freeze({
  SessionStart: [req('source', 'string'), opt('model', 'present')],
  UserPromptSubmit: [req('prompt', 'string')],
  PreToolUse: [req('tool_name', 'string'), req('tool_input', 'object'), opt('tool_use_id', 'string')],
  PermissionRequest: [req('tool_name', 'string'), req('tool_input', 'object')],
  PostToolUse: [req('tool_name', 'string'), req('tool_input', 'object'), req('tool_response', 'present'), opt('tool_use_id', 'string')],
  Stop: [],
  SubagentStart: [req('agent_id', 'string'), req('agent_type', 'string')],
  SubagentStop: [req('agent_id', 'string'), req('agent_type', 'string'), opt('agent_transcript_path', 'string')],
  PreCompact: [req('trigger', 'string')],
  PostCompact: [req('trigger', 'string')],
  StopFailure: [opt('error', 'present')],
  SessionEnd: [opt('reason', 'string')],
  PreModelSwitch: [req('from_model', 'present'), req('to_model', 'present')],
  PostModelSwitch: [req('from_model', 'present'), req('to_model', 'present')],
});

/** What `server/src/livestate.ts` reads from Claude Code's live status file (`<config>/sessions/<pid>.json`). */
export const STATUS_FILE_RULES: readonly CaptureFieldRule[] = Object.freeze([
  req('pid', 'number'), req('sessionId', 'string'), req('cwd', 'string'), req('status', 'string'), req('version', 'string'),
  opt('name', 'string'), opt('nameSource', 'string'), opt('statusUpdatedAt', 'number'), opt('startedAt', 'number'),
  opt('waitingFor', 'string'),
]);

/** What `ccd/statusline-command.sh` and `server/src/pane/statusline.ts` read from the statusline JSON. The rate-limit
 *  fields appear only for a signed-in subscription account, so they are optional (spec §2.6). */
export const STATUSLINE_RULES: readonly CaptureFieldRule[] = Object.freeze([
  req('session_id', 'string'), req('model', 'object'), req('model.id', 'string'), req('workspace', 'object'),
  req('workspace.current_dir', 'string'), req('cost', 'object'),
  opt('model.display_name', 'string'), opt('cwd', 'string'), opt('cost.total_cost_usd', 'number'),
  opt('context_window', 'object'), opt('context_window.used_percentage', 'number'), opt('rate_limits', 'object'),
]);

function at(v: unknown, path: string): unknown {
  let cur: unknown = v;
  for (const k of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function fits(v: unknown, type: CaptureFieldType): boolean {
  switch (type) {
    case 'present': return v !== undefined;
    case 'object': return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    default: return typeof v === type;
  }
}

/** Each rule `v` breaks, as one clause naming the field. */
export function ruleBreaks(v: unknown, rules: readonly CaptureFieldRule[]): string[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return ['not an object'];
  const out: string[] = [];
  for (const r of rules) {
    const x = at(v, r.path);
    if (x === undefined) { if (r.required) out.push(`${r.path}: missing`); continue; }
    if (!fits(x, r.type)) out.push(`${r.path}: not ${r.type === 'object' ? 'an object' : `a ${r.type}`}`);
  }
  return out;
}

// ── the replay ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether a hook payload is the drive's write: Bash, running {@link CAPTURE_WRITE_COMMAND}. */
const isWrite = (payload: unknown): boolean => at(payload, 'tool_name') === 'Bash' && at(payload, 'tool_input.command') === CAPTURE_WRITE_COMMAND;

/** The recorder's answer to a permission prompt that lets the tool run. */
const ALLOW = 'allow';

/** What the drive's ONE write proves, or the first reason it proves nothing (review 3316 A1, A2). */
interface WriteEvidence { readonly broken: string | null; readonly cwd: boolean }

/** THE WRITE'S EVIDENCE, tied to one tool call: the same intended write must supply its `cwd`, the recorder's `allow` and
 *  its later completion, so an approval or a completion of another call never stands in for it. A PermissionRequest
 *  carries no `tool_use_id`, so the call is named by the write's PreToolUse, which the build raises before the prompt.
 *  In order: exactly one PermissionRequest for the write (none: no prompt; more: no one write); that prompt's own line
 *  answered `allow`; a PostToolUse of the write after it; and exactly one PreToolUse of the write, before the prompt,
 *  and exactly one PostToolUse of the write, after it, both naming the same `tool_use_id`. Evidence that is missing or
 *  cannot be tied fails closed. `cwd` is that one prompt's own `cwd`. */
function writeEvidence(records: readonly CaptureRecord[], cdDir: string): WriteEvidence {
  const of = (event: HookEvent): number[] =>
    records.flatMap((r, i) => (r.kind === 'hook' && hookEventIs(r.event, event) && isWrite(r.payload) ? [i] : []));
  const prompts = of('PermissionRequest');
  if (prompts.length === 0) return { broken: 'approval: the write raised no permission prompt', cwd: false };
  if (prompts.length > 1) return { broken: `approval: ${prompts.length} permission prompts for the write, so no one write carries the evidence`, cwd: false };
  const asked = prompts[0]!;
  const prompt = records[asked]!;
  const answer = prompt.kind === 'hook' ? prompt.answer : undefined;
  if (answer !== ALLOW) return { broken: "approval: the hook's allow answer to the write's prompt was not recorded", cwd: false };
  const calls = of('PreToolUse');
  const runs = of('PostToolUse');
  if (!runs.some((i) => i > asked)) return { broken: 'approval: the write never ran after the hook answered allow', cwd: false };
  const call = calls.length === 1 && calls[0]! < asked ? at(records[calls[0]!]!.payload, 'tool_use_id') : undefined;
  const ran = runs.length === 1 ? at(records[runs[0]!]!.payload, 'tool_use_id') : undefined;
  if (typeof call !== 'string' || ran !== call) {
    return { broken: "approval: the write that ran cannot be tied to its prompt's tool call (tool_use_id)", cwd: false };
  }
  return { broken: null, cwd: at(prompt.payload, 'cwd') === cdDir };
}

/** THE replay suite: the recording checked against the grammar, as the verdict the record stores. It passes when the
 *  drive finished, no line was unreadable, every event in {@link CAPTURE_EVENTS} was recorded, every hook payload,
 *  statusline JSON and status file copy fits its rules, at least one statusline JSON and one status file copy were
 *  recorded, a status file names `build` as its `version`, and the approval wait's output side held: the drive's one
 *  write was asked, answered `allow` by the recorder and then run, all as one tool call ({@link writeEvidence}; spec
 *  §2.6, review 3226 F7, review 3316 A1), so the build obeyed the hook's answer. It proves the `cwd` fact only when that
 *  same write's PermissionRequest names the drive's `cd` directory as its `cwd` (review 3226 F5): any other prompt
 *  naming it proves nothing. The output names every break, one per line, and ends with the verdict. */
export function replayCapture(rec: CaptureRecording, build: string): BuildCaptureResult {
  const lines: string[] = [];
  if (!rec.finished) lines.push('drive: did not finish every step');
  if (rec.unreadable > 0) lines.push(`recording: ${rec.unreadable} unreadable line(s)`);
  const seen = new Set<string>();
  let statuslines = 0;
  let statuses = 0;
  let versionSeen = false;
  rec.records.forEach((r, i) => {
    const where = r.kind === 'hook' ? `#${i + 1} ${r.event}` : `#${i + 1} statusline`;
    if (r.kind === 'hook') {
      seen.add(r.event);
      const rules = isHookEvent(r.event) ? HOOK_EVENT_RULES[r.event] : undefined;
      if (rules === undefined) lines.push(`${where}: not an event ccrc installs`);
      for (const b of ruleBreaks(r.payload, [...HOOK_COMMON_RULES, ...(rules ?? [])])) lines.push(`${where}: ${b}`);
      if (at(r.payload, 'hook_event_name') !== undefined && at(r.payload, 'hook_event_name') !== r.event) {
        lines.push(`${where}: hook_event_name does not name ${r.event}`);
      }
    } else {
      statuslines++;
      for (const b of ruleBreaks(r.payload, STATUSLINE_RULES)) lines.push(`${where}: ${b}`);
    }
    if (r.status !== null && r.status !== undefined) {
      statuses++;
      for (const b of ruleBreaks(r.status, STATUS_FILE_RULES)) lines.push(`${where} status file: ${b}`);
      if (at(r.status, 'version') === build) versionSeen = true;
    }
  });
  for (const e of CAPTURE_EVENTS) if (!seen.has(e)) lines.push(`event ${e}: never recorded`);
  const write = writeEvidence(rec.records, rec.cdDir);
  if (write.broken !== null) lines.push(write.broken);
  if (statuslines === 0) lines.push('statusline: never recorded');
  if (statuses === 0) lines.push('status file: never recorded');
  else if (!versionSeen) lines.push(`status file: no copy names version ${build}`);
  const pass = lines.length === 0;
  lines.push(`cwd: ${write.cwd ? "the write's permission prompt names the directory the shell moved into" : 'not proved'}`);
  lines.push(pass ? `verdict: pass (${rec.records.length} records)` : 'verdict: fail');
  // Through the verdict's one reader, so what the box sends is what the lane will accept (the output keeps its tail).
  return readBuildCaptureResult({ build, pass, cwd: pass && write.cwd, output: lines.join('\n') }, build)!;
}
