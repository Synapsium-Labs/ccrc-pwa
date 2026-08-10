import path from 'node:path';
import type { FleetIO } from './io.js';
import type { HookAsk, HookAskQuestion } from '../../shared/api.js';

/** A hookstate file older than this is presumed stale: the writing hook
 *  process may be dead, wedged, or the session may have moved on without a
 *  terminal event (a killed pane, a box reboot). Orca's own constant,
 *  carried over rather than re-derived. */
export const HOOKSTATE_FRESH_MS = 30 * 60 * 1000;

/** Mirrors `session-hook.sh`'s own 64KB write cap — see `readHookState`'s
 *  length check for why the reader enforces it independently rather than
 *  trusting the writer never to have skewed. */
const HOOKSTATE_MAX_BYTES = 65536;

/** `~/.cc-sessions/<id>.hookstate.json`, validated and narrowed to the shape
 *  the fleet wire and the per-session stream actually consume. See
 *  `readHookState` for the freshness and identity gates that decide whether a
 *  file on disk is even trusted enough to become one of these. */
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
  subagents: { name: string; startedAt: number }[];
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

/** Thrown by the revive helpers below, caught once at `readHookState`'s own
 *  boundary — same discipline as `shared/api.ts`'s `reviveFleetSession` /
 *  `reviveWsAudit`: one bad field anywhere in `ask` or `subagents`
 *  invalidates the WHOLE read, never a partial `HookState` with a field
 *  silently defaulted or dropped. */
class Malformed extends Error {}

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

/**
 * `~/.cc-sessions/<id>.hookstate.json` → `HookState`, or null when the file
 * is missing, oversized, malformed, version-skewed, in an unrecognised
 * state, stale, or — the identity gate — was written by a session this
 * registry entry no longer is.
 *
 * The uuid gate: a restarted session must not inherit the old file's state —
 * the registry's uuid advances via `_sync_uuid` the moment the new process
 * publishes, and that advance is what invalidates this file (the
 * restoredUnconfirmed idea on existing plumbing). `currentUuid === null`
 * means the registry itself has no uuid on record — fail-null too, the same
 * as any other mismatch: there is nothing here to gate identity against, so
 * trusting the file would be trusting a stranger.
 */
export async function readHookState(
  io: FleetIO,
  registryDir: string,
  id: string,
  currentUuid: string | null,
  now: number,
): Promise<HookState | null> {
  const content = await io.readFile(path.join(registryDir, `${id}.hookstate.json`));
  if (content === null) return null;
  // Defense-in-depth against the writer's own cap: check length BEFORE
  // parsing, so a file that somehow grew past it (a skewed writer, a
  // hand-edit) can never reach JSON.parse at all. Measured in actual UTF-8
  // bytes, not `content.length` (UTF-16 code units) — the writer's own bash
  // `${#out}` cap shares that same char-vs-byte imprecision on its side, but
  // this reader is the layer where the constant's name (`_BYTES`) has to
  // tell the truth.
  if (Buffer.byteLength(content, 'utf8') > HOOKSTATE_MAX_BYTES) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (raw['v'] !== 1) return null;

  const stateRaw = raw['state'];
  if (typeof stateRaw !== 'string' || !STATES.includes(stateRaw)) return null;

  if (currentUuid === null) return null;
  if (typeof raw['sessionId'] !== 'string' || raw['sessionId'] !== currentUuid) return null;

  const updatedAt = raw['updatedAt'];
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
  if (now - updatedAt > HOOKSTATE_FRESH_MS) return null;

  const interruptedRaw = raw['interrupted'];
  if (interruptedRaw !== undefined && typeof interruptedRaw !== 'boolean') return null;

  const eventRaw = raw['event'];
  if (eventRaw !== undefined && eventRaw !== null && typeof eventRaw !== 'string') return null;

  try {
    const askRaw = raw['ask'];
    const ask = askRaw === null || askRaw === undefined ? null : reviveAsk(askRaw);
    const subagents = reviveSubagents(raw['subagents']);
    return {
      state: stateRaw as HookState['state'],
      updatedAt,
      event: typeof eventRaw === 'string' && eventRaw !== '' ? eventRaw : null,
      ask,
      subagents,
      interrupted: interruptedRaw === true,
    };
  } catch (err) {
    if (err instanceof Malformed) return null;
    throw err; // a real bug in here must not read as a corrupt file
  }
}
