import { CALL_CLASSES, CALL_WAKES, type CallWake, type CallWakeCondition, type CoordCallClass } from '../../../shared/api.js';
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
