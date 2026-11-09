import { CALL_CLASSES, CALL_WAKES, type CallView, type CallWake, type CallWakeCondition, type CoordCallClass } from '../../../shared/api.js';
import { redactCommand } from './redact.js';
import { cutWhole } from './reviewcap.js';

/**
 * THE COORDINATOR CALL RECORD'S PURE CORE (D-8126, coordinator-autonomy-default plan Task A3-1, spec §8.2). L1: pure,
 * no store, no clock (the callers hand `now`), no reply.
 *
 * A coordinator that takes a decision in the operator's name records it: `routine` for the run record, `big` for the
 * operator's Seen door, `block` when a thread waits on a condition. This file reads the body a coordinator sends
 * (`callBodyOf`), words the wake a block waits on (`parseWake`, `blockExpiresAt`), and holds the three predicates the
 * store and the digest share (`isLiveBlock`, `callIsForOperator`/`callClearedAt`, `callDecision`).
 */

export const CALL_TEXT_MAX = 600;
export const CALL_WHY_MAX = 300;
export const CALL_OPTION_MAX = 300;
export const CALL_OPTIONS_MAX = 8;
/** A condition wake that nothing woke lapses after a day (§8.2), so a block can never silence a thread for good (F5). */
export const BLOCK_CONDITION_TTL_MS = 24 * 3_600_000;
/** A big call is the operator's to see for a week; after that it has aged out of the group. */
export const CALL_SEEN_WINDOW_MS = 7 * 86_400_000;
/** The furthest a `time:` wake may lie ahead. */
const BLOCK_TIME_WAKE_MAX_MS = 7 * 86_400_000;

/** A call as a coordinator names it. `runId` is null when it names no run. */
export interface NewCall {
  class: CoordCallClass;
  runId: number | null;
  question: string | null;
  options: string[] | null;
  chosen: string;
  why: string;
  reversible: boolean;
  wakeOn: CallWake | null;
}

/** A stored call: `NewCall` plus the columns the store writes. */
export interface CallRow extends NewCall {
  id: number;
  program: string;
  madeBy: string;
  expiresAt: number | null;
  at: number;
  seenAt: number | null;
  overturnedAt: number | null;
  overturnNote: string | null;
  wokenAt: number | null;
  build: string | null;
}

/** A condition word, or `time:<epoch ms>` with a positive safe integer; anything else is null. */
export function parseWake(s: string): CallWake | null {
  if ((CALL_WAKES as readonly string[]).includes(s)) return s as CallWakeCondition;
  const m = /^time:([1-9]\d*)$/.exec(s);
  if (!m || !Number.isSafeInteger(Number(m[1]))) return null;
  return s as CallWake;
}

/** When a block lapses on its own: a time wake at its time, a condition wake a day after the call (§8.2). */
export function blockExpiresAt(wake: CallWake, at: number): number {
  return wake.startsWith('time:') ? Number(wake.slice(5)) : at + BLOCK_CONDITION_TTL_MS;
}

/** P4: a block that still holds its thread: not woken, not yet expired. */
export const isLiveBlock = (row: CallRow, now: number): boolean =>
  row.class === 'block' && row.wokenAt === null && row.expiresAt !== null && row.expiresAt > now;

/** What `blockWakeDue` answers: tell the coordinator, end the block quietly, or wait. */
export const BLOCK_WAKE_VERDICTS = ['wake-mail', 'wake-quiet', 'none'] as const;
export type BlockWakeVerdict = (typeof BLOCK_WAKE_VERDICTS)[number];
/** The two kebab words of a measured fact that is not yet the condition (`disk` not `ok`, `memory` not `clear`). */
export const BLOCK_WAKE_FACT_WORDS = ['not-ok', 'not-clear'] as const;
/** Whether a quoted kebab token is one of the wake words, the wake conditions included (the source-scan pin admits them through this, never NOT_CODES). */
export const isBlockWakeKebab = (tok: string): boolean =>
  (BLOCK_WAKE_VERDICTS as readonly string[]).includes(tok) || (BLOCK_WAKE_FACT_WORDS as readonly string[]).includes(tok)
  || (CALL_WAKES as readonly string[]).includes(tok);

/** The facts a block's wake is judged on (the caller measures them; `unknown` is a fact that could not be read). */
export interface BlockWakeFacts {
  now: number;
  disk: 'ok' | (typeof BLOCK_WAKE_FACT_WORDS)[0] | 'unknown';
  memory: 'clear' | (typeof BLOCK_WAKE_FACT_WORDS)[1] | 'unknown';
  /** The running server's build stamp, or null when it has none. */
  build: string | null;
  /** The coordinator ran a turn after the row was made. */
  turnSince: boolean;
  /** The row's own condition (`disk` or `memory`) read not-ok at some sweep after the row was made. A condition that was
   *  never seen failing has not cleared: it reads ok because it was ok all along. */
  sawNotOk: boolean;
}

/**
 * P7: whether a parked thread's wake is due, judged on the lane facts that already watch its condition (spec §8.2).
 * `wake-mail` tells the coordinator; `wake-quiet` ends the block without a mail (the resumed session is the wake itself);
 * `none` waits. A `disk` or `memory` wake is a clearing, so it needs a not-ok reading after the row (`sawNotOk`) before an ok one counts. Doubt waits for the lapse: an `unknown` fact, a null build on either side, a `capacity` wake (wave A8)
 * and a wake word that no longer reads are all `none`. A woken row, a non-block and a condition row past its expiry
 * (it lapsed, and the coord-ball rung may fire again) are never woken.
 */
export function blockWakeDue(row: CallRow, f: BlockWakeFacts): BlockWakeVerdict {
  if (row.class !== 'block' || row.wokenAt !== null || row.wakeOn === null) return 'none';
  if (row.wakeOn.startsWith('time:')) return f.now >= Number(row.wakeOn.slice(5)) ? 'wake-mail' : 'none';
  if (row.expiresAt === null || row.expiresAt <= f.now) return 'none';
  switch (row.wakeOn) {
    case 'disk': return f.disk === 'ok' && f.sawNotOk ? 'wake-mail' : 'none';
    case 'memory': return f.memory === 'clear' && f.sawNotOk ? 'wake-mail' : 'none';
    case 'update': return f.build !== null && row.build !== null && f.build !== row.build ? 'wake-mail' : 'none';
    case 'account-room': return f.turnSince ? 'wake-quiet' : 'none';
    default: return 'none';
  }
}

/** A big call the operator has yet to see: not Seen, not overturned, inside the Seen window. */
export const callIsForOperator = (row: CallRow, now: number): boolean =>
  row.class === 'big' && row.seenAt === null && row.overturnedAt === null && row.at > now - CALL_SEEN_WINDOW_MS;

/** When a big call left the operator's group (the earliest of Seen, overturned and aged out), or null while it is in
 *  the group, and for a call that was never in it. */
export function callClearedAt(row: CallRow, now: number): number | null {
  if (row.class !== 'big') return null;
  const agedAt = row.at + CALL_SEEN_WINDOW_MS;
  const times = [row.seenAt, row.overturnedAt, agedAt <= now ? agedAt : null].filter((t): t is number => t !== null);
  return times.length === 0 ? null : Math.min(...times);
}

/** A call as it leaves the server (D-8126): the wire shape, with every text masked once more (F3). The store masks on the
 *  way in; a row stored before a mask learned a shape, or written by another door, is still masked on every read. */
export function callViewOf(row: CallRow): CallView {
  const mask = (t: string): string => redactCommand(t);
  return {
    id: row.id, program: row.program, runId: row.runId, madeBy: row.madeBy, class: row.class,
    question: row.question === null ? null : mask(row.question), options: row.options === null ? null : row.options.map(mask),
    chosen: mask(row.chosen), why: mask(row.why), reversible: row.reversible, wakeOn: row.wakeOn, at: row.at,
    seenAt: row.seenAt, overturnedAt: row.overturnedAt, overturnNote: row.overturnNote === null ? null : mask(row.overturnNote),
  };
}

/** The digest's predicate for the call table: only a `big` call is a line (R4). */
export const callDecision = (row: CallRow): { kind: 'big-call'; at: number } | null =>
  row.class === 'big' ? { kind: 'big-call', at: row.at } : null;

type Refuse = { ok: false; detail: string };
const refuse = (detail: string): Refuse => ({ ok: false, detail });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One text, 1 to `max` characters as sent, then masked and cut whole (F3). Null when it is not a string of that size
 *  or the mask and the cut leave nothing. `oneLine` refuses a line break. */
function text(v: unknown, max: number, oneLine = false): string | null {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) return null;
  if (oneLine && /[\r\n]/.test(v)) return null;
  const out = cutWhole(redactCommand(v), max).trim();
  return out === '' ? null : out;
}

/** The body of `POST /api/coord/programmes/:slug/calls`, read. Never throws. */
export function callBodyOf(raw: unknown, now: number): { ok: true; call: NewCall } | { ok: false; detail: string } {
  if (!isRecord(raw)) return refuse('the body must be a JSON object');
  const klass = raw.class;
  if (typeof klass !== 'string' || !(CALL_CLASSES as readonly string[]).includes(klass)) {
    return refuse(`class must be one of ${CALL_CLASSES.join(', ')}`);
  }
  const callClass = klass as CoordCallClass;
  if (typeof raw.reversible !== 'boolean') return refuse('reversible must be true or false');
  const why = text(raw.why, CALL_WHY_MAX, true);
  if (why === null) return refuse(`why must be one line of 1 to ${CALL_WHY_MAX} characters`);
  let runId: number | null = null;
  if (raw.runId !== undefined) {
    if (typeof raw.runId !== 'number' || !Number.isSafeInteger(raw.runId) || raw.runId <= 0) return refuse('runId must be a positive integer');
    runId = raw.runId;
  }

  if (callClass === 'block') {
    if (raw.question !== undefined) return refuse('a block call takes no question');
    if (raw.options !== undefined) return refuse('a block call takes no options');
    const chosen = text(raw.chosen, CALL_TEXT_MAX);
    if (chosen === null) return refuse(`chosen must be 1 to ${CALL_TEXT_MAX} characters`);
    const wake = typeof raw.wakeOn === 'string' ? parseWake(raw.wakeOn) : null;
    if (wake === null) return refuse(`wakeOn must be one of ${CALL_WAKES.join(', ')} or time:<epoch ms>`);
    if (wake.startsWith('time:')) {
      const when = Number(wake.slice(5));
      if (when <= now || when > now + BLOCK_TIME_WAKE_MAX_MS) return refuse('a time wakeOn must be in the future and at most 7 days out');
    }
    return { ok: true, call: { class: callClass, runId, question: null, options: null, chosen, why, reversible: raw.reversible, wakeOn: wake } };
  }

  if (raw.wakeOn !== undefined) return refuse('wakeOn belongs to a block call only');
  const question = text(raw.question, CALL_TEXT_MAX);
  if (question === null) return refuse(`question must be 1 to ${CALL_TEXT_MAX} characters`);
  const opts = raw.options;
  if (!Array.isArray(opts) || opts.length < 2 || opts.length > CALL_OPTIONS_MAX) {
    return refuse(`options must be 2 to ${CALL_OPTIONS_MAX} strings`);
  }
  if (typeof raw.chosen !== 'string' || !opts.includes(raw.chosen)) return refuse('chosen must be one of the options');
  const options: string[] = [];
  for (const o of opts) {
    const t = text(o, CALL_OPTION_MAX);
    if (t === null) return refuse(`each of the options must be 1 to ${CALL_OPTION_MAX} characters`);
    options.push(t);
  }
  const chosen = options[opts.indexOf(raw.chosen)]!;
  return { ok: true, call: { class: callClass, runId, question, options, chosen, why, reversible: raw.reversible, wakeOn: null } };
}
