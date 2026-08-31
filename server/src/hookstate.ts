import path from 'node:path';
import type { FleetIO } from './io.js';
import type { HookAsk, HookAskQuestion } from '../../shared/api.js';

/** A hookstate file older than this is presumed stale: the writing hook
 *  process may be dead, wedged, or the session may have moved on without a
 *  terminal event (a killed pane, a box reboot). Orca's own constant,
 *  carried over rather than re-derived. */
export const HOOKSTATE_FRESH_MS = 30 * 60 * 1000;

/** Mirrors `session-hook.sh`'s own 64KB write cap — see
 *  `readHookStateMeasured`'s length check for why the reader enforces it independently rather than
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
   *  written it (`ccd/session-hook.sh:96,100`) and this reader has always
   *  thrown it away. Build 7 spends it on exactly one thing: a
   *  `UserPromptSubmit` newer than a delivery's `deliveredAt` is the cheapest
   *  available proof that the injected turn actually STARTED, as opposed to
   *  the text merely leaving the input box — which is all `sendPrompt`'s
   *  `ok:true` can ever mean (`inject/send.ts:98-112`, and note that a BUSY
   *  session satisfies it by queueing the message where the server cannot see
   *  it).
   *
   *  `null`, not a union: the set of hook event names is Claude Code's, it
   *  grows between harness versions, and narrowing it here would make a new
   *  event name reject a whole hookstate read. A string this build does not
   *  recognise is simply not the edge it was looking for. */
  event: string | null;
  ask: HookAsk | null;
  /** The subagent roster, joined with what each one is DOING.
   *
   *  `name` and `startedAt` and `id` come from the hookstate FILE; `description`
   *  does not — it is filled by the watcher from Claude Code's own launch
   *  record, keyed on `id`. So this type describes what the SERVER knows about
   *  a session's subagents, from two sources, and `reviveSubagents` below
   *  always reads `description: null` because the file never carries one. */
  subagents: { name: string; startedAt: number; id: string | null; description: string | null }[];
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
 *  `readHookStateMeasured`'s own boundary — same discipline as `shared/api.ts`'s `reviveFleetSession` /
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

function reviveSubagents(raw: unknown): { name: string; startedAt: number; id: string | null; description: string | null }[] {
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
    // `id` ABSENT is null — no identity, which is what a row written by the
    // pre-agent_id hook genuinely has. A PRESENT non-string is malformed and
    // fails the whole read, the same stance every other field here takes: the
    // file is one write, so one bad field means the write cannot be trusted.
    const rawId = item['id'];
    if (rawId !== undefined && typeof rawId !== 'string') throw new Malformed('subagents[].id');
    return {
      name: item['name'],
      startedAt: item['startedAt'],
      id: rawId === undefined || rawId === '' ? null : rawId,
      // Never in the file — the hook cannot know it. The watcher fills it from
      // the launch record; null here means "not joined yet", which renders as
      // today's behaviour.
      description: null,
    };
  });
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
 * (`limits.ts:126` and `commands.ts:73` are the tree's own precedent for
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
  // `readFileMeasured`, not `readFile`: this seam is the ONLY place the
  // absent-vs-unreadable line still exists as evidence (`io.ts`'s
  // `MeasuredRead`), and folding it here is what D-115 named. A proven
  // ENOENT is the ordinary shape for a workspace whose harness has not
  // written a hookstate yet; anything else is a file this box could not
  // read, which proves nothing about the session and must say so.
  const read = await io.readFileMeasured(path.join(registryDir, `${id}.hookstate.json`));
  if (!read.ok) {
    return { ok: false, reason: read.reason === 'absent' ? 'no-state' : 'unmeasured' };
  }
  const content = read.content;
  // Defense-in-depth against the writer's own cap: check length BEFORE
  // parsing, so a file that somehow grew past it (a skewed writer, a
  // hand-edit) can never reach JSON.parse at all. Measured in actual UTF-8
  // bytes, not `content.length` (UTF-16 code units) — the writer's own bash
  // `${#out}` cap shares that same char-vs-byte imprecision on its side, but
  // this reader is the layer where the constant's name (`_BYTES`) has to
  // tell the truth.
  // Every rejection from here down is NO_STATE, one constant rather than
  // twelve object literals: each is a file this reader successfully looked
  // at and found says nothing about the current turn, and spelling that
  // conclusion once is what stops a later edit from quietly promoting one of
  // them to `unmeasured` — the direction that would refuse dispatches on an
  // ordinary stale file.
  if (Buffer.byteLength(content, 'utf8') > HOOKSTATE_MAX_BYTES) return NO_STATE;

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return NO_STATE;
  }
  if (!isRecord(raw)) return NO_STATE;
  if (raw['v'] !== 1) return NO_STATE;

  const stateRaw = raw['state'];
  if (typeof stateRaw !== 'string' || !STATES.includes(stateRaw)) return NO_STATE;

  if (currentUuid === null) return NO_STATE;
  if (typeof raw['sessionId'] !== 'string' || raw['sessionId'] !== currentUuid) return NO_STATE;

  const updatedAt = raw['updatedAt'];
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return NO_STATE;
  if (now - updatedAt > HOOKSTATE_FRESH_MS) return NO_STATE;

  const interruptedRaw = raw['interrupted'];
  if (interruptedRaw !== undefined && typeof interruptedRaw !== 'boolean') return NO_STATE;

  const eventRaw = raw['event'];
  if (eventRaw !== undefined && eventRaw !== null && typeof eventRaw !== 'string') return NO_STATE;

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
        interrupted: interruptedRaw === true,
      },
    };
  } catch (err) {
    if (err instanceof Malformed) return NO_STATE;
    throw err; // a real bug in here must not read as a corrupt file
  }
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
