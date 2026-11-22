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

/** The job: capture one build, under a fresh id. */
export interface CaptureSubmit {
  readonly t: 'capture.submit';
  /** 32 lowercase hex characters, drawn at random by the sender. */
  readonly captureId: string;
  /** The Claude Code build, `isClaudeVersion`. */
  readonly build: string;
}

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
}

// ── the recording ────────────────────────────────────────────────────────────────────────────────────────────────

/** One line of the recording, as the recorder writes it: what a hook or the statusline command was given on its stdin,
 *  and a copy of the live status file taken at that moment (null when none could be read). */
export type CaptureRecord =
  | { readonly kind: 'hook'; readonly event: string; readonly payload: unknown; readonly status: unknown }
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
    const status = Object.prototype.hasOwnProperty.call(o, 'status') ? o['status'] : null;
    if (o['kind'] === 'hook' && typeof o['event'] === 'string' && Object.keys(o).sort().join() === 'event,kind,payload,status') {
      records.push({ kind: 'hook', event: o['event'], payload: o['payload'], status });
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

/** THE replay suite: the recording checked against the grammar, as the verdict the record stores. It passes when the
 *  drive finished, no line was unreadable, every event in {@link CAPTURE_EVENTS} was recorded, every hook payload,
 *  statusline JSON and status file copy fits its rules, at least one statusline JSON and one status file copy were
 *  recorded, and a status file names `build` as its `version`. It proves the `cwd` fact when a PermissionRequest's `cwd`
 *  is the drive's `cd` directory. The output names every break, one per line, and ends with the verdict. */
export function replayCapture(rec: CaptureRecording, build: string): BuildCaptureResult {
  const lines: string[] = [];
  if (!rec.finished) lines.push('drive: did not finish every step');
  if (rec.unreadable > 0) lines.push(`recording: ${rec.unreadable} unreadable line(s)`);
  const seen = new Set<string>();
  let statuslines = 0;
  let statuses = 0;
  let versionSeen = false;
  let cwd = false;
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
      if (hookEventIs(r.event, 'PermissionRequest') && at(r.payload, 'cwd') === rec.cdDir) cwd = true;
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
  if (statuslines === 0) lines.push('statusline: never recorded');
  if (statuses === 0) lines.push('status file: never recorded');
  else if (!versionSeen) lines.push(`status file: no copy names version ${build}`);
  const pass = lines.length === 0;
  lines.push(`cwd: ${cwd ? 'the permission prompt names the directory the shell moved into' : 'not proved'}`);
  lines.push(pass ? `verdict: pass (${rec.records.length} records)` : 'verdict: fail');
  // Through the verdict's one reader, so what the box sends is what the lane will accept (the output keeps its tail).
  return readBuildCaptureResult({ build, pass, cwd: pass && cwd, output: lines.join('\n') }, build)!;
}
