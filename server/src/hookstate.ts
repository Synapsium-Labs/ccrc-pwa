import path from 'node:path';
import type { FleetIO } from './io.js';
import type { HookAsk, HookAskQuestion } from '../../shared/api.js';

/** A hookstate file older than this is presumed stale: the writing hook
 *  process may be dead, wedged, or the session may have moved on without a
 *  terminal event (a killed pane, a box reboot). Orca's own constant,
 *  carried over rather than re-derived. */
export const HOOKSTATE_FRESH_MS = 30 * 60 * 1000;

/** Mirrors `session-hook.sh`'s own 64KB write cap — see
 *  `readHookStateRawMeasured`'s length check for why the reader enforces it independently rather than
 *  trusting the writer never to have skewed. */
const HOOKSTATE_MAX_BYTES = 65536;

/** `~/.cc-sessions/<id>.hookstate.json`, validated and narrowed to the shape
 *  the fleet wire and the per-session stream actually consume. See
 *  `readHookStateMeasured` for the freshness and identity gates that decide
 *  whether a file on disk is even trusted enough to become one of these. */
export interface HookState {
  state: 'working' | 'waiting' | 'done';
  updatedAt: number;
  /** The hook event that produced this write — `session-hook.sh` has always
   *  written it (the hookstate write in `session-hook.sh`'s tail) and this reader has always
   *  thrown it away. Build 7 spends it on exactly one thing: a
   *  `UserPromptSubmit` newer than a delivery's `deliveredAt` is the cheapest
   *  available proof that the injected turn actually STARTED, as opposed to
   *  the text merely leaving the input box — which is all `sendPrompt`'s
   *  `ok:true` can ever mean (`inject/send.ts:102-116`, and note that a BUSY
   *  session satisfies it by queueing the message where the server cannot see
   *  it).
   *
   *  `null`, not a union: the set of hook event names is Claude Code's, it
   *  grows between harness versions, and narrowing it here would make a new
   *  event name reject a whole hookstate read. A string this build does not
   *  recognise is simply not the edge it was looking for. */
  event: string | null;
  ask: HookAsk | null;
  subagents: { name: string; startedAt: number }[];
  /** How many `graphify query` / `path` / `explain` calls this session has
   *  made since it last started or cleared, as the hook counted them
   *  (`ccd/session-hook.sh`'s `GRAPH_QUERY_RE`). R4 of the read-side design:
   *  the whole case for retiring the account-wide block is that its effect
   *  measured zero, and this is the number that keeps that claim honest.
   *
   *  `null` is NO FIELD — a hookstate written by a hook that predates the
   *  counter. `0` is a MEASUREMENT: this session reported, and it has read
   *  nothing. Folding the first into the second is exactly the narrowing an
   *  adapter may not do, and it would make an un-upgraded fleet box look like
   *  a fleet that ignores its graphs. */
  graphQueries: number | null;
  /** How many search calls (`Grep`, `Glob`, a `Bash` command that HEADS with
   *  a search) the `PreToolUse` gate has denied this session since it last
   *  started or cleared — R5 of the read-side design, D-1613. It is counted
   *  in the same hookstate write as `graphQueries` and it resets with it, and
   *  it is bounded: after `GRAPH_GATE_MAX_DENIALS` the gate opens anyway, so
   *  this number never exceeds that bound and a session that cannot run the
   *  engine at all still gets through.
   *
   *  Two counters, not one, because they answer two different questions —
   *  how often this session ASKED the graph, and how often the gate had to
   *  tell it to. R5's own next reading is the second beside the first.
   *
   *  `null` is NO FIELD, exactly as for `graphQueries`: a hookstate written
   *  by a hook that predates the gate — which, on the day R5 ships, is every
   *  hookstate on the fleet. `0` is a MEASUREMENT: the gate is live in this
   *  session and has not had to fire. Folding the first into the second is
   *  the narrowing an adapter may not do, and here it would report a fleet
   *  that has never met the gate as a fleet the gate never had to stop. */
  graphGateDenials: number | null;
  interrupted: boolean;
}

// Typed `readonly string[]`, not `readonly HookState['state'][]`, on purpose —
// same reasoning as shared/api.ts's `STATUSES`/`CHECKS`: validating an
// untrusted string against a readonly literal-union array needs a cast on the
// value being checked, which asserts the very thing the check is asking. Cast
// the CONSTANT's declared type down to `string[]`; cast the INPUT only once,
// after `.includes()` has proved it belongs.
const STATES: readonly string[] = ['working', 'waiting', 'done'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Thrown by the revive helpers below, caught once at
 *  `readHookStateRawMeasured`'s own boundary — same discipline as `shared/api.ts`'s `reviveFleetSession` /
 *  `reviveWsAudit`: one bad field anywhere in `ask` or `subagents`
 *  invalidates the WHOLE read, never a partial `HookState` with a field
 *  silently defaulted or dropped. */
class Malformed extends Error {}

/** One frozen value for the eight-conditions-into-one arm below — see
 *  `HookStateRead`. A constant rather than a literal per gate so the fold is
 *  visibly ONE decision taken once, not twelve that happen to agree today. */
const NO_STATE: HookStateRead = { ok: false, reason: 'no-state' };

function reviveOption(raw: unknown): { label: string; description?: string } {
  if (!isRecord(raw) || typeof raw['label'] !== 'string') throw new Malformed('ask.option');
  const description = raw['description'];
  if (description === undefined) return { label: raw['label'] };
  if (typeof description !== 'string') throw new Malformed('ask.option.description');
  return { label: raw['label'], description };
}

function reviveQuestion(raw: unknown): HookAskQuestion {
  if (!isRecord(raw) || typeof raw['question'] !== 'string') throw new Malformed('ask.question');
  const optionsRaw = raw['options'];
  if (!Array.isArray(optionsRaw)) throw new Malformed('ask.question.options');
  const question: HookAskQuestion = { question: raw['question'], options: optionsRaw.map(reviveOption) };

  const header = raw['header'];
  if (header !== undefined) {
    if (typeof header !== 'string') throw new Malformed('ask.question.header');
    question.header = header;
  }
  const multiSelect = raw['multiSelect'];
  if (multiSelect !== undefined) {
    if (typeof multiSelect !== 'boolean') throw new Malformed('ask.question.multiSelect');
    question.multiSelect = multiSelect;
  }
  return question;
}

function reviveAsk(raw: unknown): HookAsk {
  if (!isRecord(raw)) throw new Malformed('ask');
  if ('questions' in raw) {
    const questionsRaw = raw['questions'];
    if (!Array.isArray(questionsRaw)) throw new Malformed('ask.questions');
    return { questions: questionsRaw.map(reviveQuestion) };
  }
  if ('approval' in raw) {
    const approvalRaw = raw['approval'];
    if (!isRecord(approvalRaw) || typeof approvalRaw['tool'] !== 'string' || typeof approvalRaw['summary'] !== 'string') {
      throw new Malformed('ask.approval');
    }
    return { approval: { tool: approvalRaw['tool'], summary: approvalRaw['summary'] } };
  }
  throw new Malformed('ask');
}

function reviveSubagents(raw: unknown): { name: string; startedAt: number }[] {
  // Absent (a file written before this field existed) or explicit null both
  // read as "no subagents", never a crash — the writer always includes the
  // field today, but the reader must not assume every file on disk agrees.
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Malformed('subagents');
  return raw.map((item) => {
    if (!isRecord(item) || typeof item['name'] !== 'string' ||
        typeof item['startedAt'] !== 'number' || !Number.isFinite(item['startedAt'])) {
      throw new Malformed('subagents[]');
    }
    return { name: item['name'], startedAt: item['startedAt'] };
  });
}

/** The two hook-written counters — `graphQueries` (R4) and `graphGateDenials`
 *  (R5, D-1613). Absent or explicitly null reads as `null` (the writer did
 *  not carry the field), any non-integer or negative number rejects the whole
 *  read. Same split `reviveSubagents` takes: degrade for a field an older
 *  writer never wrote, reject a value this build cannot parse.
 *
 *  ONE ladder, parameterised by the field it is reading, rather than a second
 *  copy for the second counter — `io.ts`'s own rule beside `readFileMeasured`:
 *  two hand-kept ladders over the same gates drift, and the one that drifts is
 *  always the one nobody is reading. It takes the RECORD and the key, not the
 *  value, so each counter's key is spelled exactly once at the call site: a
 *  copy-paste that read `graphQueries` twice would report the query count as
 *  the denial count, which typechecks and would make R5's own reading —
 *  denials beside queries — unfalsifiable. `Malformed` still names the field
 *  that was bad, so a corrupt file's reason survives the sharing. */
function reviveGraphCount(
  raw: Record<string, unknown>,
  field: 'graphQueries' | 'graphGateDenials',
): number | null {
  const v = raw[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new Malformed(field);
  }
  return v;
}

/**
 * What `~/.cc-sessions/<id>.hookstate.json` had to say about THIS session's
 * turn — and, on the `false` arm, whether anything was said at all.
 *
 * `no-state` is a MEASUREMENT that came back empty-handed: the reader looked
 * at the file (or proved there is none) and it does not describe the current
 * session's turn. Absent, oversized, malformed, version-skewed, an
 * unrecognised state word, stale, no registry uuid to gate identity against,
 * a sessionId from a process this entry no longer is — eight conditions, one
 * arm, deliberately. Every one of them means the same actionable thing, and
 * an arm no consumer branches on is a wider type, not a finer measurement
 * (`limits.ts:310` and `commands.ts:73` are the tree's own precedent for
 * leaving an indifferent fold alone).
 *
 * `unmeasured` is the ninth condition and it is not a measurement at all:
 * the READ failed. The file is there — EACCES, a dropped agent-WS round trip,
 * a device error — and it may say `working`. D-115: folding this into the
 * other eight is what let `dispatch.ts`'s busy gate read "I could not look"
 * as "I looked, and nobody is home", and go on to `/clear` a session that
 * might have been mid-turn.
 */
export type HookStateRead =
  | { ok: true; state: HookState }
  | { ok: false; reason: 'no-state' }
  | { ok: false; reason: 'unmeasured' };

/**
 * `~/.cc-sessions/<id>.hookstate.json` → `HookStateRead`. See that type for
 * what separates its two `false` arms, and why eight of the nine conditions
 * share one of them.
 *
 * The uuid gate: a restarted session must not inherit the old file's state —
 * the registry's uuid advances via `_sync_uuid` the moment the new process
 * publishes, and that advance is what invalidates this file (the
 * restoredUnconfirmed idea on existing plumbing). `currentUuid === null`
 * means the registry itself has no uuid on record — `no-state` too, the same
 * as any other mismatch: there is nothing here to gate identity against, so
 * trusting the file would be trusting a stranger. It is emphatically NOT
 * `unmeasured`: the read may have succeeded perfectly; it is the REGISTRY
 * that declined to name whose turn this file describes.
 */
export async function readHookStateMeasured(
  io: FleetIO,
  registryDir: string,
  id: string,
  currentUuid: string | null,
  now: number,
): Promise<HookStateRead> {
  return foldHookStateRead(await readHookStateRawMeasured(io, registryDir, id, currentUuid), now);
}

/**
 * `~/.cc-sessions/<id>.hookstate.json`, parsed and NOT gated (worker stall watch wave 2, spec 2026-09-29 §5.1;
 * slug `raw-read-replaces-the-private-parse` (D-3620)). Every parse gate runs here. The identity and age cuts do not:
 * the file's identity is REPORTED instead, and the age is left to the caller. The stall watch's frozen and
 * delegates arms need `updatedAt` and `event` from a file the aged read has already dropped, and need to know
 * whose file it is.
 *
 * The three `false` arms are three conditions, never folded together:
 * - `absent` is a proven ENOENT;
 * - `unmeasured` means the READ failed (EACCES, a dropped agent round trip), and the file may say `working`
 *   (D-115);
 * - `malformed` means the file was read and this build cannot parse it: oversize, not JSON, version skew, an
 *   unknown state word, a non-string `sessionId`, or a bad field anywhere.
 *
 * `identity` keeps the aged read's own gate exactly: `unregistered` when the registry names no uuid
 * (`currentUuid === null`), `current` when `sessionId === currentUuid` (including the `'' === ''` case that
 * read has always passed), and `foreign` otherwise. `empty-uuid-is-foreign` (D-3619) is the turn marker's rule, not
 * this file's.
 */
export type HookStateRawRead =
  | { ok: true; state: HookState; sessionId: string; identity: 'current' | 'foreign' | 'unregistered' }
  | { ok: false; reason: 'absent' | 'unmeasured' | 'malformed' };

/** The raw read's one parse-failure answer, spelled once: each rejection below is a file this reader DID look at (the
 *  aged fold then answers `NO_STATE`), and one constant stops a later edit quietly promoting one to `unmeasured`. */
const MALFORMED: HookStateRawRead = { ok: false, reason: 'malformed' };

/** THE ONE PARSE in this module. `readHookStateMeasured` is a fold over it (`foldHookStateRead`, below), never a
 *  copy: `io.ts`'s own rule, that two hand-kept ladders over the same gates drift. The stall watch reads it whole:
 *  hold 2a correlates an ask by time, so it needs one the age cut drops, and it makes its own identity cut. */
export async function readHookStateRawMeasured(io: FleetIO, registryDir: string, id: string, currentUuid: string | null): Promise<HookStateRawRead> {
  // `readFileMeasured`, not `readFile`: this seam is the ONLY place the
  // absent-vs-unreadable line still exists as evidence (`io.ts`'s
  // `MeasuredRead`). A proven ENOENT is the ordinary shape for a workspace
  // whose harness has not written a hookstate yet; anything else is a file
  // this box could not read, which proves nothing about the session.
  const read = await io.readFileMeasured(path.join(registryDir, `${id}.hookstate.json`));
  if (!read.ok) return { ok: false, reason: read.reason === 'absent' ? 'absent' : 'unmeasured' };
  const content = read.content;
  // Defense-in-depth against the writer's own cap: length BEFORE parsing,
  // so a file that somehow grew past it (a skewed writer, a hand-edit) never
  // reaches the parse at all. Measured in UTF-8 bytes, not `content.length`
  // (UTF-16 code units): this reader is where the constant's name (`_BYTES`)
  // has to tell the truth.
  if (Buffer.byteLength(content, 'utf8') > HOOKSTATE_MAX_BYTES) return MALFORMED;

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return MALFORMED;
  }
  if (!isRecord(raw)) return MALFORMED;
  if (raw['v'] !== 1) return MALFORMED;

  const stateRaw = raw['state'];
  if (typeof stateRaw !== 'string' || !STATES.includes(stateRaw)) return MALFORMED;

  // A non-string `sessionId` names nobody, so it is a parse failure and never
  // an identity. The aged read folded it to `no-state` beside a mismatch, and
  // `malformed` folds to that same answer (the gated-door FOLD PARITY row pins it).
  const sessionId = raw['sessionId'];
  if (typeof sessionId !== 'string') return MALFORMED;

  const updatedAt = raw['updatedAt'];
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return MALFORMED;

  const interruptedRaw = raw['interrupted'];
  if (interruptedRaw !== undefined && typeof interruptedRaw !== 'boolean') return MALFORMED;

  const eventRaw = raw['event'];
  if (eventRaw !== undefined && eventRaw !== null && typeof eventRaw !== 'string') return MALFORMED;

  try {
    const askRaw = raw['ask'];
    const ask = askRaw === null || askRaw === undefined ? null : reviveAsk(askRaw);
    const subagents = reviveSubagents(raw['subagents']);
    return {
      ok: true,
      state: {
        state: stateRaw as HookState['state'],
        updatedAt,
        event: typeof eventRaw === 'string' && eventRaw !== '' ? eventRaw : null,
        ask,
        subagents,
        graphQueries: reviveGraphCount(raw, 'graphQueries'),
        graphGateDenials: reviveGraphCount(raw, 'graphGateDenials'),
        interrupted: interruptedRaw === true,
      },
      sessionId,
      identity: currentUuid === null ? 'unregistered' : sessionId === currentUuid ? 'current' : 'foreign',
    };
  } catch (err) {
    if (err instanceof Malformed) return MALFORMED;
    throw err; // a real bug in here must not read as a corrupt file
  }
}

/** The aged door's ONE decision over the raw read (`readHookStateMeasured`): the identity cut, the age cut, and the
 *  fold of `absent`/`malformed` into `no-state`. `unmeasured` stays `unmeasured` (D-115). The unaged door that once
 *  shared it is gone (worker stall watch wave 2): the lane reads the raw read and makes its own cut. */
function foldHookStateRead(raw: HookStateRawRead, now: number): HookStateRead {
  if (!raw.ok) return raw.reason === 'unmeasured' ? { ok: false, reason: 'unmeasured' } : NO_STATE;
  if (raw.identity !== 'current') return NO_STATE;
  if (now - raw.state.updatedAt > HOOKSTATE_FRESH_MS) return NO_STATE;
  return { ok: true, state: raw.state };
}

/**
 * The folded form, unchanged in signature and in every answer it gives: null
 * for all nine conditions the measured read tells apart. Its callers
 * (`watch.ts`'s dialog sweep and mail gate, `sessionws.ts`'s stream,
 * `server.ts`'s ask route) all want the same thing from a `null` — there is
 * no fresh turn to report — and widening them to carry a distinction they do
 * not act on is the defect this task removes, one type over.
 *
 * Derived, not duplicated, for the reason `io.ts`'s own `readFile` states
 * beside `readFileMeasured`: two hand-kept ladders over the same nine gates
 * drift, and the one that drifts is always the one nobody is reading.
 */
export async function readHookState(
  io: FleetIO,
  registryDir: string,
  id: string,
  currentUuid: string | null,
  now: number,
): Promise<HookState | null> {
  const read = await readHookStateMeasured(io, registryDir, id, currentUuid, now);
  return read.ok ? read.state : null;
}
