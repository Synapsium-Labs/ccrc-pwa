// L1, context C3 (Session Conversation): the session hook's report, narrowed (Overlord spec §3.6 H1, Table 11.1e "The hook's
// reports"; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`, Task 7). Pure: the body arrives as an
// argument; nothing reads a clock, a file or the store.
//
// `hookReportOf` is the report door's one narrowing: it bounds every string, refuses an unknown kind (unlike the loads report,
// a kind is the whole of a report, so there is nothing to drop), and names the first field that does not narrow. Optional
// fields the body leaves out read as null, never as an empty string. The hook's clock `at` is kept as sent; every window the
// server reads uses its own `receivedAt` (the store's column), so a hook with a wrong clock moves no window.
import {
  AGENT_ID_RE, AGENT_TYPE_MAX, DOOR_TOOL_NAME_RE, DOOR_TOOL_PREFIX, REPORT_MODEL_MAX, WITNESS_KEY_SHAPE, isHookReportKind,
  isModelSwitchHow, READER_STALE_MS, WITNESS_WINDOW_MS, type HookReport, type ModelSwitchHow,
} from '../../../shared/continuity-reports.js';
import type { WitnessVerdict } from '../coord/overlordGate.js';

export type HookReportVerdict = { readonly ok: true; readonly report: HookReport } | { readonly ok: false; readonly field: string };

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
/** A bounded printable string: 1 to `max` characters, no control character. */
const text = (max: number) => (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
/** An optional field: absent or null reads null; a present value must narrow, else `undefined` (the caller refuses it). */
const opt = <T>(v: unknown, ok: (x: unknown) => x is T): T | null | undefined => (v === null || v === undefined ? null : ok(v) ? v : undefined);
const isAgentId = (v: unknown): v is string => typeof v === 'string' && AGENT_ID_RE.test(v);
const isTool = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith(DOOR_TOOL_PREFIX) && DOOR_TOOL_NAME_RE.test(v.slice(DOOR_TOOL_PREFIX.length));
const isKey = (v: unknown): v is string => typeof v === 'string' && WITNESS_KEY_SHAPE.test(v);

const no = (field: string): HookReportVerdict => ({ ok: false, field });

export function hookReportOf(body: Record<string, unknown>): HookReportVerdict {
  const kind = body['kind'];
  if (!isHookReportKind(kind)) return no('kind');
  const at = body['at'];
  if (!isCount(at)) return no('at');
  switch (kind) {
    case 'witness': {
      const key = body['key'];
      const tool = body['tool'];
      if (!isKey(key)) return no('key');
      if (!isTool(tool)) return no('tool');
      const agentId = opt(body['agentId'], isAgentId);
      if (agentId === undefined) return no('agentId');
      return { ok: true, report: { kind, key, tool, agentId, at } };
    }
    case 'reader-start': {
      const agentId = body['agentId'];
      if (!isAgentId(agentId)) return no('agentId');
      const agentType = opt(body['agentType'], text(AGENT_TYPE_MAX));
      if (agentType === undefined) return no('agentType');
      return { ok: true, report: { kind, agentId, agentType, at } };
    }
    case 'reader-stop': {
      const agentId = body['agentId'];
      if (!isAgentId(agentId)) return no('agentId');
      return { ok: true, report: { kind, agentId, at } };
    }
    case 'readers-clear':
      return { ok: true, report: { kind, at } };
    case 'model-switch': {
      const how = body['how'];
      if (!isModelSwitchHow(how)) return no('how');
      const from = opt(body['from'], text(REPORT_MODEL_MAX));
      if (from === undefined) return no('from');
      const to = opt(body['to'], text(REPORT_MODEL_MAX));
      if (to === undefined) return no('to');
      return { ok: true, report: { kind, how, from, to, at } };
    }
    case 'picked-up': {
      const messageId = body['messageId'];
      if (!isPos(messageId)) return no('messageId');
      return { ok: true, report: { kind, messageId, at } };
    }
  }
}

// THE READINGS (Overlord W1 door process B1, plan Task 9; spec §3.3.11, §7.5, Table 7.5a). Each answers `Read<>`: a value, or
// why it could not be measured. No unmeasured input is ever folded into `false` or `0`. The reads they take (the switches, the
// reader events) are the hook report store's, passed in structurally, so this file imports nothing outward.
//
// CLASS WORDS: one vocabulary. The status line sidecar's `class` (`usage.ts`, `familyClassOf`), a model id's class
// (`familyClassOf` again, applied by the composition to a start's or a switch's model id) and the designation's model class
// (`OverlordModelClass`, `fable` or `opus`, a subset of `ModelClass`) are the same words, so they compare as strings. A model
// id that names no class is `null`: unknown, never a class of its own.

/** A read's answer, in the hook report store's own shape (`HookStoreRead`): the value, or the read's failure. */
export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };
/** The status line sidecar's latest reading as the readings take it. `stale` and `absent` are no evidence of the model: a
 *  stale reading was true once, and an absent one says nothing. A fresh reading that names no class says nothing either. */
export type SidecarClass =
  | { readonly kind: 'fresh'; readonly class: string | null }
  | { readonly kind: 'stale' }
  | { readonly kind: 'absent' };
/** One reported model switch, its target model already classed by the composition (`null`: the id names no class). */
export interface SwitchReading { readonly how: ModelSwitchHow; readonly toClass: string | null }
/** One reader event, as `readerEventsSince` reads it (oldest first), narrowed to what the reading uses. */
export type ReaderEventIn =
  | { readonly kind: 'reader-start'; readonly agentId: string; readonly receivedAt: number }
  | { readonly kind: 'reader-stop'; readonly agentId: string; readonly receivedAt: number }
  | { readonly kind: 'readers-clear'; readonly receivedAt: number };

export interface OffModelInput {
  readonly designatedClass: string;
  /** The live generation's start model, as a class; `null` when the start's model is unknown. */
  readonly startClass: string | null;
  /** The model switches reported since the generation's start. */
  readonly switches: Read<readonly SwitchReading[]>;
  readonly sidecarClass: SidecarClass;
}

/** The off-model condition's input (Table 7.5a): is the designated generation running a class other than the designation's?
 *  True when the start's class, any `switched` report since the start (a `typed-refused` one changed nothing) or a FRESH
 *  sidecar's class differs. A STALE or ABSENT sidecar is not evidence either way: it neither makes the answer true nor
 *  unmeasured on its own. Unmeasured when nothing measured says true and the start class is unknown, the switches could not
 *  be read, or a reported switch names no known class. A measured difference outranks an unmeasured input: the answer then
 *  is true, as `any ... differs` reads. */
export function offModelOf({ designatedClass, startClass, switches, sidecarClass }: OffModelInput): Read<boolean> {
  let unmeasuredWhy: string | undefined;
  if (startClass !== null && startClass !== designatedClass) return { ok: true, value: true };
  if (startClass === null) unmeasuredWhy = 'the generation start model class is unknown';
  if (!switches.ok) unmeasuredWhy ??= `the model switches could not be read: ${switches.detail}`;
  for (const s of switches.ok ? switches.value : []) {
    if (s.how !== 'switched') continue;
    if (s.toClass === null) unmeasuredWhy ??= 'a reported switch names no known class';
    if (s.toClass !== null && s.toClass !== designatedClass) return { ok: true, value: true };
  }
  if (sidecarClass.kind === 'fresh' && sidecarClass.class !== null && sidecarClass.class !== designatedClass) return { ok: true, value: true };
  return unmeasuredWhy === undefined ? { ok: true, value: false } : { ok: false, detail: unmeasuredWhy };
}

export interface ModelDriftInput {
  readonly startClass: string | null;
  readonly switches: Read<readonly SwitchReading[]>;
  readonly sidecarClass: SidecarClass;
}

/** A renewal reading, for the renewal readings piece to wire: did the generation's model change since its start? True on a
 *  reported switch other than `typed-refused`, or a fresh sidecar class that differs from the start's. A stale or absent
 *  sidecar with no switch report is UNMEASURED: whether Claude Code's own switch fires a hook event is itself unmeasured
 *  (W0-12 calls it inconclusive), so only the sidecar is sure to see it. An unknown start class, or a switches read that
 *  failed, is unmeasured too unless something measured already says true. */
export function modelDriftOf({ startClass, switches, sidecarClass }: ModelDriftInput): Read<boolean> {
  if (switches.ok) {
    const moved = switches.value.some((s) => s.how === 'switched');
    if (moved) return { ok: true, value: true };
  }
  if (sidecarClass.kind === 'fresh' && sidecarClass.class !== null && startClass !== null && sidecarClass.class !== startClass) return { ok: true, value: true };
  if (!switches.ok) return { ok: false, detail: `the model switches could not be read: ${switches.detail}` };
  if (startClass === null) return { ok: false, detail: 'the generation start model class is unknown' };
  if (sidecarClass.kind !== 'fresh' || sidecarClass.class === null) return { ok: false, detail: 'no fresh sidecar class and no switch report: a switch Claude Code makes itself may fire no event' };
  return { ok: true, value: false };
}

export interface ReadersRunningInput {
  readonly events: Read<readonly ReaderEventIn[]>;
  /** The live generation's start, on the server's clock (the events' `receivedAt`'s). */
  readonly generationStartedAt: number;
  readonly now: number;
}

/** A renewal reading, for the renewal readings piece to wire: how many readers run now. The starts since the generation's
 *  start, or since its latest `readers-clear` (a quiet turn's end: no background work, so a lost stop heals), with no stop. A
 *  start older than `READER_STALE_MS` with no stop or clear makes the whole answer unmeasured, naming that agent id, never a
 *  count that leaves it out. A failed events read is unmeasured, never zero. */
export function readersRunning({ events, generationStartedAt, now }: ReadersRunningInput): Read<number> {
  if (!events.ok) return { ok: false, detail: events.detail };
  const open = new Map<string, number>();
  const ordered = events.value.map((e, i) => ({ e, i })).sort((a, b) => a.e.receivedAt - b.e.receivedAt || a.i - b.i);
  for (const { e } of ordered) {
    if (e.receivedAt < generationStartedAt) continue;
    if (e.kind === 'reader-start') open.set(e.agentId, e.receivedAt);
    else if (e.kind === 'reader-stop') open.delete(e.agentId);
    else if (e.kind === 'readers-clear') open.clear();
  }
  for (const [agentId, startedAt] of open) {
    if (now - startedAt > READER_STALE_MS) return { ok: false, detail: `reader ${agentId} started over ${READER_STALE_MS} ms ago and no stop or clear was reported` };
  }
  return { ok: true, value: open.size };
}

// THE WITNESS (Overlord W1 door process B1, plan Task 9 "The witness", ruled F5; gates B's step 7a asks it). A witness is the
// session hook's `PreToolUse` report of a door call's digest (`key`), received by the server (`receivedAt`, the server's
// clock: a hook with a wrong clock moves no window). The verdict is gates B's `WitnessVerdict`, imported, never redeclared.
//
// It takes the NEWEST (by `receivedAt`, then the higher id) main-thread witness, no agent id, received at most
// `WITNESS_WINDOW_MS` before `now` (exactly the window counts, one ms past does not) and at or after the generation's start,
// that is not already used. A missing key is `none`. When nothing qualifies the reason names the NEAREST miss, one precedence
// for every mixture: `used` (it would have stood), then `before-generation`, then `stale`, then `reader-scope` (a reader's
// call, never the main thread's). Each witness is classed by its FIRST failing test, in that order of cause: reader scope,
// then stale, then before the generation, then used. No witness at all is `none`. A failed read of either input is
// `unmeasured` and counts nothing (gates B refuses 502); a missing key is decided before any read is consulted.

/** One witness row, as `witnessesFor` reads it, narrowed to what the verdict uses. */
export interface Witness { readonly id: number; readonly agentId: string | null; readonly receivedAt: number }

type WitnessMiss = Extract<WitnessVerdict, { kind: 'unwitnessed' }>['why'];

const newer = (a: Witness, b: Witness): boolean =>
  a.receivedAt > b.receivedAt || (a.receivedAt === b.receivedAt && a.id > b.id);

export function witnessVerdict(i: {
  readonly witnesses: Read<readonly Witness[]>; readonly used: Read<ReadonlySet<number>>;
  readonly key: string | null; readonly generationStartedAt: number; readonly now: number;
}): WitnessVerdict {
  if (i.key === null) return { kind: 'unwitnessed', why: 'none' };
  if (!i.witnesses.ok) return { kind: 'unmeasured', why: i.witnesses.detail };
  if (!i.used.ok) return { kind: 'unmeasured', why: i.used.detail };
  const miss = new Set<WitnessMiss>();
  let best: Witness | null = null;
  for (const w of i.witnesses.value) {
    if (w.agentId !== null) { miss.add('reader-scope'); continue; }
    if (w.receivedAt < i.now - WITNESS_WINDOW_MS) { miss.add('stale'); continue; }
    if (w.receivedAt < i.generationStartedAt) { miss.add('before-generation'); continue; }
    if (i.used.value.has(w.id)) { miss.add('used'); continue; }
    if (best === null || newer(w, best)) best = w;
  }
  if (best !== null) return { kind: 'witnessed', witnessId: best.id };
  for (const why of ['used', 'before-generation', 'stale', 'reader-scope'] as const) {
    if (miss.has(why)) return { kind: 'unwitnessed', why };
  }
  return { kind: 'unwitnessed', why: 'none' };
}

// THE UNWITNESSED LATCH (plan Task 9 "The latch", ruled F27; Table 7.5a, cause `unwitnessed-third`, cap `advise`): the third
// unwitnessed write in a day raises it. `count` is `unwitnessedSince` over `latchWindowStart`, the later of a day ago and the
// operator's last clear of this latch (so a clear starts the count again); no latch of the cause standing.
export const UNWITNESSED_LATCH_AT = 3;
export const UNWITNESSED_WINDOW_MS = 24 * 3_600_000;

export function unwitnessedLatchDue(i: { readonly count: number; readonly latchStanding: boolean }): boolean {
  return !i.latchStanding && i.count >= UNWITNESSED_LATCH_AT;
}

/** Where the count starts: a day before `now`, or the operator's last clear of the latch when that is later (`null`: never cleared). */
export function latchWindowStart(i: { readonly now: number; readonly clearedAt: number | null }): number {
  return Math.max(i.now - UNWITNESSED_WINDOW_MS, i.clearedAt ?? -Infinity);
}
