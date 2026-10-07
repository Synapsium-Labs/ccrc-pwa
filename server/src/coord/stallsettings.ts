import {
  STALL_FOLLOW_LABEL, STALL_LEVELS, STALL_LEVEL_TEXT, STALL_NOTICE_TEXT, STALL_SECTION_TEXT, STALL_STAGES, isStallLevelChoice,
} from '../../../shared/api.js';
import type {
  StallHeld, StallLevel, StallLevelChoice, StallNextStep, StallNoticeCount, StallStage, StallStored, StallWatchRequest,
  StallWatchStages, StallWriteEffect,
} from '../../../shared/api.js';
import { STALL_QUIET_MS, parseStallDetail, rungRecipient, stallArmHasRung, stallArmingOf } from './stall.js';
import type { StallArming, StallRecipient } from './stall.js';
import { mailTurnModeOf, mailTurnReadsMark } from '../turnidle.js';
import type { MailTurnMode } from '../turnidle.js';
/**
 * STALL WATCH SETTINGS, the pure half (design 2026-10-05 §5, §6, §7, §10, §12). L1: no clock, no I/O, no `node:`
 * import, no fastify, no store handle and no `db.js`. `stall-settings.test.ts` pins that, in `stall-vocabulary.test.ts`'s
 * idiom: value imports come only from L0 (`shared/api.ts`), `./stall.js` and `../turnidle.js`.
 *
 * What lives here, once:
 * - the ladder's flag and mail-mode columns (`STALL_LADDER`), keyed by L0's `StallLevel`, whose labels and texts are
 *   L0's (`STALL_LEVEL_TEXT`), so a level added to one Record and not the other is a compile error;
 * - the quiet time's bounds and step, and the notice-count window, shipped on the reply so the PWA has no copy;
 * - `isStallQuietMs`, the one validity predicate for the write and the read (L0's `isStallLevelChoice` is the level's);
 * - the settings row's port (`StallSettingsRow`, `StallSettingsRead`), declared BY THE CONSUMER as `stall.ts` declares
 *   `StallRunRow`; `store.ts` implements it, and `parseStallSettings` decides what every stored value means;
 * - the resolver both sweeps and the view call, and the readers the view composes;
 * - the write path the POST composes: the body's decision, the projection of the row a write leaves, the write's
 *   effect, the confirm and its key, and the feed body; and the notice counts by role.
 *
 * No marker name is spelled here. The box arming composes `stall.ts`'s `stallArmingOf` and `turnidle.ts`'s
 * `mailTurnModeOf`, each of which spells its own names, and `mail-disabled` arrives as a boolean the caller measured
 * with its own constant. `stallUnheldBoxOf` finds the strict file by asking `mailTurnModeOf` about each name alone.
 *
 * `mail-routes.test.ts` scans `server/src/coord` for quoted kebab words: every one this file, the settings store and
 * the settings routes spell is declared through `isStallSettingsKebab`, one more union beside `isStallKebab`.
 */

// ── the ladder ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One ladder row. `off` carries no flags and no mode: the resolver reads it as "stop the lane, leave the box's
 *  mode". Narrowing the key does not narrow the value, so every reader narrows on `row.disabled` before it reads a
 *  flag or the mode. */
export type StallLadderRow =
  | { readonly disabled: true }
  | { readonly disabled: false; readonly live: boolean; readonly escalate: boolean; readonly w2Live: boolean; readonly mailMode: 'busy-shadow' | 'busy' };
type StallRunningRow = Extract<StallLadderRow, { readonly disabled: false }>;

/** §5's table. Log only, Check and Alert keep the busy gate (`busy-shadow`), as approved (§19 Q6); Deliver and
 *  Everything deliver on busy. */
export const STALL_LADDER: Readonly<Record<StallLevel, StallLadderRow>> = {
  off: { disabled: true },
  log: { disabled: false, live: false, escalate: false, w2Live: false, mailMode: 'busy-shadow' },
  check: { disabled: false, live: true, escalate: false, w2Live: false, mailMode: 'busy-shadow' },
  alert: { disabled: false, live: true, escalate: true, w2Live: false, mailMode: 'busy-shadow' },
  deliver: { disabled: false, live: true, escalate: true, w2Live: false, mailMode: 'busy' },
  all: { disabled: false, live: true, escalate: true, w2Live: true, mailMode: 'busy' },
};

/** A running row as an arming with no held flag: what the level does on a box with no kill file, no strict gate and
 *  mail on. The resolver's `free` and `stallNextStep`'s next level both read a row through it (§20's conversion). */
function stallRowArming(run: StallRunningRow): StallBoxArming {
  return { disabled: false, live: run.live, escalate: run.escalate, w2Live: run.w2Live, mailDisabled: false, mailMode: run.mailMode };
}

// ── the quiet time and the window ────────────────────────────────────────────────────────────────────────────────

/** The quiet time's range, inclusive, and its step (§7, departure `quiet-half-hour-steps` (D-4026)). The built-in,
 *  `STALL_QUIET_MS`, stays in `stall.ts` and is one of the steps. */
export const STALL_QUIET_MIN_MS = 30 * 60_000;
export const STALL_QUIET_MAX_MS = 12 * 3_600_000;
export const STALL_QUIET_STEP_MS = 30 * 60_000;
/** The notice-count window (§11). The reply carries it, and the counts heading takes it from there. */
export const STALL_NOTICE_WINDOW_MS = 48 * 3_600_000;

/** The one validity predicate for a quiet time, called by the write's decision and by the read's parse, so the read
 *  never accepts a value the write would refuse. A value outside it is refused, or read unreadable, never clamped. */
export function isStallQuietMs(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v % STALL_QUIET_STEP_MS === 0
    && v >= STALL_QUIET_MIN_MS && v <= STALL_QUIET_MAX_MS;
}

// ── the stored row: port and parse ───────────────────────────────────────────────────────────────────────────────

/** The settings row as the store reads it, every value `unknown`: the parse decides what each means, `updatedAt`
 *  included. The store reads with `setReadBigInts(true)`, so an INTEGER column may arrive as a `bigint`. */
export interface StallSettingsRow { readonly level: unknown; readonly quietMs: unknown; readonly updatedAt: unknown }
/** The store's read: a row, no row, or a read that failed (a missing table, a driver throw). Three words, never one
 *  `null`. */
export type StallSettingsRead =
  | { readonly kind: 'row'; readonly row: StallSettingsRow }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** Each field parsed on its own, so the wire can report each field's own state. When `stored` is not `'row'`, both
 *  fields parse `unreadable` (with `undefined` as the raw value: there is none) and `updatedAt` parses `null`;
 *  `stored` tells the two cases apart. Neither absent nor unreadable ever folds into `follow` or `default`. */
export interface StallSettingsParsed {
  readonly stored: StallStored;
  readonly level: { readonly kind: 'follow' } | { readonly kind: 'chosen'; readonly level: StallLevel } | { readonly kind: 'unreadable'; readonly token: unknown };
  readonly quiet: { readonly kind: 'default' } | { readonly kind: 'set'; readonly ms: number } | { readonly kind: 'unreadable'; readonly value: unknown };
  readonly updatedAt: number | null;
}

const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
/** A `bigint` inside the safe-integer range becomes a `number`; any other `bigint` stays one, which every predicate
 *  below refuses, so it reads unreadable. Every other value passes through as read. */
function fromStore(v: unknown): unknown {
  if (typeof v !== 'bigint') return v;
  return v >= SAFE_MIN && v <= SAFE_MAX ? Number(v) : v;
}

/** The read's one parse (§6.1). The level goes through `isStallLevelChoice` before anything indexes `STALL_LADDER`;
 *  the quiet time through `isStallQuietMs` after the `bigint` conversion, with SQL `NULL` the built-in; `updatedAt` is
 *  a safe integer or `null`. A field that fails is `unreadable`, carrying the raw value, never clamped or guessed. */
export function parseStallSettings(read: StallSettingsRead): StallSettingsParsed {
  if (read.kind !== 'row') {
    return { stored: read.kind, level: { kind: 'unreadable', token: undefined }, quiet: { kind: 'unreadable', value: undefined }, updatedAt: null };
  }
  const { level: rawLevel, quietMs: rawQuiet, updatedAt: rawAt } = read.row;
  const level: StallSettingsParsed['level'] = !isStallLevelChoice(rawLevel) ? { kind: 'unreadable', token: rawLevel }
    : rawLevel === 'follow' ? { kind: 'follow' } : { kind: 'chosen', level: rawLevel };
  const q = fromStore(rawQuiet);
  const quiet: StallSettingsParsed['quiet'] = rawQuiet === null ? { kind: 'default' }
    : isStallQuietMs(q) ? { kind: 'set', ms: q } : { kind: 'unreadable', value: rawQuiet };
  const at = fromStore(rawAt);
  return { stored: 'row', level, quiet, updatedAt: typeof at === 'number' && Number.isSafeInteger(at) ? at : null };
}

// ── the box arming ───────────────────────────────────────────────────────────────────────────────────────────────

/** A resolved arming: `StallArming` with `mailDisabled` and `mailMode` always set. Every branch of the resolver keeps
 *  or sets both. */
export type StallBoxArming = StallArming & { readonly mailDisabled: boolean; readonly mailMode: MailTurnMode };

/** The fleet box's files alone, from one registry listing: exactly the expression `sweepStalls` builds inline today.
 *  `mailDisabled` is the caller's measurement with its own constant, so this file never spells that name. */
export function stallBoxArmingOf(names: readonly string[], mailDisabled: boolean): StallBoxArming {
  return { ...stallArmingOf(names), mailDisabled, mailMode: mailTurnModeOf(names) };
}

/** What a stored choice arms with no kill file, no strict gate and mail on (§10's unheld reading): the files with
 *  those three cleared, so the mail mode is the one the files give below strict. The strict file is found by asking
 *  `mailTurnModeOf` about each name alone; the two kill files are cleared as flags. */
export function stallUnheldBoxOf(names: readonly string[]): StallBoxArming {
  return { ...stallBoxArmingOf(names.filter((n) => mailTurnModeOf([n]) !== 'strict'), false), disabled: false };
}

// ── the readers ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The stages a resolved arming has on (§12). `busyDelivery` and `busyGate` read false while mail is switched off,
 *  because the mail gate does not run then; `busyGate` is the turn-marker read `busy` and `busy-shadow` share, asked
 *  of `mailTurnReadsMark` so the rule is the gate's own (departure `stages-on-the-wire-not-modes` (D-4032)). */
export function stallStages(a: StallArming): StallWatchStages {
  const runs = !a.disabled;
  const mode = a.mailMode ?? 'shell';
  const mailOn = a.mailDisabled !== true;
  return {
    runs,
    checks: runs && a.live,
    alerts: runs && a.live && a.escalate,
    busyDelivery: mode === 'busy' && mailOn,
    busyGate: mailTurnReadsMark(mode) && mailOn,
    wave2: runs && a.w2Live === true,
  };
}

/** The stages with mail switched off read as on: a stored choice arms them for the moment mail returns (§5.1). Every
 *  comparison of two readings goes through this, never through `stallStages`. */
export function armedStages(a: StallArming): StallWatchStages {
  return stallStages({ ...a, mailDisabled: false });
}

/** `runs` and the five confirm stages, compared one by one. */
function sameStages(a: StallWatchStages, b: StallWatchStages): boolean {
  return a.runs === b.runs && STALL_STAGES.every((s) => a[s] === b[s]);
}

/** Reading a level back (§6.4). The kill file with busy delivery on is `custom`, because `off` must not stand for
 *  both. Otherwise the one step, among the levels other than `off`, whose flags match and whose "delivers on busy"
 *  matches; `shell`, `busy-shadow` and `strict` all count as not delivering on busy, so the busy gate never splits a
 *  level (departure `files-level-match-ignores-the-busy-gate` (D-4022)). Anything else is `custom`. */
export function stallLevelOf(a: StallArming): StallLevel | 'custom' {
  const deliversOnBusy = (a.mailMode ?? 'shell') === 'busy';
  if (a.disabled) return deliversOnBusy ? 'custom' : 'off';
  for (const level of STALL_LEVELS) {
    const row = STALL_LADDER[level];
    if (row.disabled) continue;
    if (row.live === a.live && row.escalate === a.escalate && row.w2Live === (a.w2Live === true)
      && (row.mailMode === 'busy') === deliversOnBusy) return level;
  }
  return 'custom';
}

// ── the resolver ─────────────────────────────────────────────────────────────────────────────────────────────────

/** One resolution: what the sweeps apply (`arming`, `quietMs`) and what the view reads. `chosen` is the level that
 *  applies, or `null` under Follow or a row that does not apply whole. `effective` is what the watch actually does,
 *  `files` what the fleet box's files alone say. */
export interface StallResolved {
  readonly arming: StallBoxArming;
  readonly quietMs: number;
  readonly quietSource: 'chosen' | 'default';
  readonly chosen: StallLevel | null;
  readonly levelSource: 'chosen' | 'files' | 'held';
  readonly effective: StallLevel | 'custom';
  readonly files: StallLevel | 'custom';
  readonly held: StallHeld;
}

/** The one resolver both sweeps and the view call (§6.2), over flags only.
 *  - **Whole-row fallback** (§19 Q11): a row that is absent or unreadable, or has either field unreadable, applies
 *    nothing; then the arming is the box object ITSELF, today's behaviour exactly, and the quiet time the built-in.
 *  - **Precedence** (§6.3): the lane's kill file returns the box wholesale, mail mode included; a chosen `off` stops
 *    the lane and keeps the box's mode; otherwise the chosen row decides every flag and the mode, except that
 *    `mail-disabled` passes through untouched and strict keeps the mail gate and holds the wave-2 step off, because
 *    that step needs busy delivery (departure `strict-holds-the-wave-2-step` (D-4023)).
 *  - **`held` is causal:** set only when a held flag changed what the chosen running level does, judged by comparing
 *    its stages with no held flag (`free`) against the resolved ones, both with mail off read as on. A chosen `off`
 *    is never `held`. */
export function resolveStallWatch(box: StallBoxArming, settings: StallSettingsParsed): StallResolved {
  const applies = settings.stored === 'row' && settings.level.kind !== 'unreadable' && settings.quiet.kind !== 'unreadable';
  const quietMs = applies && settings.quiet.kind === 'set' ? settings.quiet.ms : STALL_QUIET_MS;
  const quietSource = applies && settings.quiet.kind === 'set' ? 'chosen' : 'default';
  const chosen = applies && settings.level.kind === 'chosen' ? settings.level.level : null;
  const strict = box.mailMode === 'strict';
  const row = chosen === null ? null : STALL_LADDER[chosen];
  const run = row !== null && row.disabled === false ? row : null;
  let arming: StallBoxArming;
  if (chosen === null) arming = box;
  else if (box.disabled) arming = box;
  else if (run === null) arming = { ...box, disabled: true };
  else {
    arming = {
      disabled: false,
      live: run.live,
      escalate: run.escalate,
      w2Live: run.w2Live && !strict,
      mailDisabled: box.mailDisabled,
      mailMode: strict ? 'strict' : run.mailMode,
    };
  }
  const free = run === null ? null : stallRowArming(run);
  const heldBack = free !== null && !sameStages(armedStages(arming), armedStages(free));
  return {
    arming,
    quietMs,
    quietSource,
    chosen,
    levelSource: chosen === null ? 'files' : heldBack ? 'held' : 'chosen',
    effective: stallLevelOf(arming),
    files: stallLevelOf(box),
    held: { watchOff: box.disabled, mailOff: box.mailDisabled === true, gateStrict: strict, wave2HeldByStrict: run !== null && run.w2Live && strict },
  };
}

/** The Next step (§10). `none` for `custom`, and whenever a chosen level reads as something else (held lower, or a
 *  chosen `off` over a busy file); `top` at Everything; otherwise the next level, waiting on the stages its own row
 *  turns on that the current arming has off, both read through `armedStages`, in §5.1's order, leaving out the busy
 *  gate, which has no gate. */
export function stallNextStep(arming: StallArming, chosen: StallLevel | null): StallNextStep {
  const level = stallLevelOf(arming);
  if (level === 'custom' || (chosen !== null && level !== chosen)) return { kind: 'none' };
  const next = STALL_LEVELS[STALL_LEVELS.indexOf(level) + 1];
  if (next === undefined) return { kind: 'top' };
  const row = STALL_LADDER[next];
  if (row.disabled) return { kind: 'step', level: next, waitsOn: [] };
  const now = armedStages(arming);
  const then = armedStages(stallRowArming(row));
  return { kind: 'step', level: next, waitsOn: STALL_STAGES.filter((s) => then[s] && !now[s] && s !== 'busyGate') };
}

/** The stages that send something or deliver mail. The busy gate only holds mail longer, so it is never compared. */
const STALL_SENDING_STAGES: readonly StallStage[] = STALL_STAGES.filter((s) => s !== 'busyGate');

/** Whether the fleet box's files arm more than the choice (§10): never while the files decide; otherwise true when a
 *  sending stage is on in the box's own stages and off in the resolved ones, both read through `armedStages`. */
export function stallFilesExceed(box: StallArming, resolved: StallResolved): boolean {
  if (resolved.levelSource === 'files') return false;
  const files = armedStages(box);
  const now = armedStages(resolved.arming);
  return STALL_SENDING_STAGES.some((s) => files[s] && !now[s]);
}

// ── the busy clock ───────────────────────────────────────────────────────────────────────────────────────────────

/** The stall sweep's judged mail mode and mail-stuck's busy start (§9, `busy-clock-starts-when-busy-delivery-starts`
 *  (D-4024)). `lastApplied` and `busySince` are the watcher's two fields, written only by the mail sweep: the mode it
 *  last applied (`null` before its first), and when it moved into busy delivery from a known non-busy mode (`null`
 *  when no such move has been seen since the server started). Three answers:
 *  - `busy` resolved over a known non-busy applied mode: busy delivery has not happened yet, so busy is judged as the
 *    busy gate is (`busy-shadow`), and nothing reads stuck during the first busy pass;
 *  - `busy` resolved with a measured `busySince`: `busy`, bounded from that moment (`stallIdleStart`'s max);
 *  - otherwise the resolved mode as it stands: today's expression, with no `busySince` key. At boot `lastApplied` is
 *    `null`, so this is what the stall sweep judges until busy delivery begins again while the server runs. */
export function stallBusyClock(resolvedMode: MailTurnMode, lastApplied: MailTurnMode | null, busySince: number | null): { readonly mailMode: MailTurnMode; readonly busySince?: number } {
  if (resolvedMode !== 'busy') return { mailMode: resolvedMode };
  if (lastApplied !== null && lastApplied !== 'busy') return { mailMode: 'busy-shadow' };
  if (busySince !== null) return { mailMode: 'busy', busySince };
  return { mailMode: resolvedMode };
}

// ── the write path ───────────────────────────────────────────────────────────────────────────────────────────────

/** What a write asks the store to change. An omitted field keeps its stored value; `quiet` `default` is SQL `NULL`,
 *  the built-in. The store takes it as decided and validates nothing (the `setCaps` division of labour). */
export interface StallSettingsPatch {
  readonly level?: StallLevelChoice;
  readonly quiet?: { readonly kind: 'default' } | { readonly kind: 'set'; readonly ms: number };
}
/** The POST body, decided: the patch and the confirm key it carried (`null` when it carried none), or a refusal whose
 *  detail names the field. Two shapes, never one nullable field. */
export type StallSettingsDecision =
  | { readonly ok: true; readonly patch: StallSettingsPatch; readonly confirm: string | null }
  | { readonly ok: false; readonly detail: string };

/** The keys a write may name, each a `StallWatchRequest` field, enumerated once. */
const STALL_REQUEST_KEYS = ['level', 'quietMs', 'confirm'] as const satisfies readonly (keyof StallWatchRequest)[];
const listed = (words: readonly string[]): string =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** §10 step 2. Refuses, never clamps: a body that is not an object; an unknown key, named, so a newer page sending a
 *  knob this server lacks hears that it was not applied (departure `unknown-keys-refused` (D-4029), the update-intent
 *  rule over the caps one); a body naming neither field; a level that is not a `StallLevelChoice`; a quiet time that is
 *  neither `'default'` nor whole 30-minute steps in range (`isStallQuietMs`, departure `quiet-half-hour-steps`
 *  (D-4026)); a confirm that is not a string. */
export function decideStallSettings(body: unknown): StallSettingsDecision {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, detail: 'body must be an object' };
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(STALL_REQUEST_KEYS as readonly string[]).includes(k)) {
      return { ok: false, detail: `unknown key ${k}: a write names only ${listed(STALL_REQUEST_KEYS)}` };
    }
  }
  const has = (k: (typeof STALL_REQUEST_KEYS)[number]): boolean => Object.prototype.hasOwnProperty.call(o, k);
  if (!has('level') && !has('quietMs')) return { ok: false, detail: 'at least one of level or quietMs must be given' };
  const patch: { level?: StallLevelChoice; quiet?: StallSettingsPatch['quiet'] } = {};
  if (has('level')) {
    const level = o.level;
    if (!isStallLevelChoice(level)) return { ok: false, detail: `level must be follow or one of ${STALL_LEVELS.join(', ')}` };
    patch.level = level;
  }
  if (has('quietMs')) {
    const q = o.quietMs;
    if (q === 'default') patch.quiet = { kind: 'default' };
    else if (isStallQuietMs(q)) patch.quiet = { kind: 'set', ms: q };
    else {
      return { ok: false,
        detail: `quietMs must be 'default' or a whole number of milliseconds from ${STALL_QUIET_MIN_MS} to ${STALL_QUIET_MAX_MS} in steps of ${STALL_QUIET_STEP_MS}` };
    }
  }
  const confirm = o.confirm;
  if (has('confirm') && typeof confirm !== 'string') return { ok: false, detail: 'confirm must be a string' };
  return { ok: true, patch, confirm: typeof confirm === 'string' ? confirm : null };
}

/** The migration's seed: today's behaviour. The insert arm of the store's write starts from it. */
export const STALL_SETTINGS_SEED = { level: 'follow', quietMs: null } as const;

/** Whether a patch changes nothing in a stored row: every named field already equals its stored value, the level
 *  token as stored and the quiet time after the parse's `bigint` conversion, with SQL `NULL` for `default`. A plain
 *  `===` against a stored `bigint` never matches, so the conversion is not optional. The store's no-op skip and the
 *  projection below both ask this (departure `no-op-write-records-no-feed-event` (D-4031)). */
export function stallPatchIsNoOp(row: StallSettingsRow, patch: StallSettingsPatch): boolean {
  const levelSame = patch.level === undefined || row.level === patch.level;
  const quietSame = patch.quiet === undefined
    || (patch.quiet.kind === 'default' ? row.quietMs === null : fromStore(row.quietMs) === patch.quiet.ms);
  return levelSame && quietSame;
}

/** The read the store's write will leave (§8), so the route can measure what a write does before it writes:
 *  - an unreadable read is returned as it is, because nothing is written over it;
 *  - a row the patch does not change is returned as it is, `updatedAt` included (the no-op skip);
 *  - an absent row takes the insert arm: the seed, overridden by the named fields;
 *  - a row takes the update arm: the named fields over the stored ones, the other kept as stored, an unreadable
 *    value included, so a quiet-only write leaves an unreadable level unreadable.
 *  Both written arms stamp `updatedAt` with the write's `at`. */
export function stallSettingsAfter(before: StallSettingsRead, patch: StallSettingsPatch, at: number): StallSettingsRead {
  if (before.kind === 'unreadable') return before;
  if (before.kind === 'row' && stallPatchIsNoOp(before.row, patch)) return before;
  const base: StallSettingsRow = before.kind === 'row' ? before.row : { ...STALL_SETTINGS_SEED, updatedAt: at };
  return {
    kind: 'row',
    row: {
      level: patch.level ?? base.level,
      quietMs: patch.quiet === undefined ? base.quietMs : patch.quiet.kind === 'default' ? null : patch.quiet.ms,
      updatedAt: at,
    },
  };
}

/** A measured write effect: what the route computes once the registry listed. */
export type StallMeasuredEffect = Extract<StallWriteEffect, { readonly measured: true }>;

/** What a write does (§10; departures `server-decides-the-confirm` (D-4033) and `confirm-on-stage-diff` (D-4034)).
 *  Each read is parsed and resolved against the same box, so each side gets the whole-row fallback. Stages are
 *  compared through `armedStages`, so `mail-disabled` never enters the diff (a stored choice arms its stages for the
 *  moment mail returns), and in two readings: the resolved one, and the unheld one, against `unheld` (no kill file, no
 *  strict gate, mail on), so a stage the fleet box holds is confirmed when the write arms it, not when the hold lifts.
 *  - `turnsOn`: off before and on after in either reading; `turnsOff`: on before and off after in the resolved one;
 *    both in §5.1's order.
 *  - `leavesWave2`: the further checks on before and off after, in either reading.
 *  - `heldByBox`: a stage in `turnsOn`, or `leavesWave2`, comes from the unheld reading alone.
 *  - `quietLowered`: the effective quiet time after the write is strictly lower than the one before. A raise never
 *    sets it, even one that stays below the built-in (departure `quiet-raise-asks-nothing` (D-4037)).
 *  - `filesExceed`: over the resolution the write leaves. */
export function stallWriteEffect(box: StallBoxArming, unheld: StallBoxArming, beforeRead: StallSettingsRead, afterRead: StallSettingsRead): StallMeasuredEffect {
  const beforeSettings = parseStallSettings(beforeRead);
  const afterSettings = parseStallSettings(afterRead);
  const was = resolveStallWatch(box, beforeSettings);
  const now = resolveStallWatch(box, afterSettings);
  const before = armedStages(was.arming);
  const after = armedStages(now.arming);
  const freeBefore = armedStages(resolveStallWatch(unheld, beforeSettings).arming);
  const freeAfter = armedStages(resolveStallWatch(unheld, afterSettings).arming);
  const onNow = (s: StallStage): boolean => !before[s] && after[s];
  const turnsOn = STALL_STAGES.filter((s) => onNow(s) || (!freeBefore[s] && freeAfter[s]));
  const turnsOff = STALL_STAGES.filter((s) => before[s] && !after[s]);
  const leavesNow = before.wave2 && !after.wave2;
  const leavesWave2 = leavesNow || (freeBefore.wave2 && !freeAfter.wave2);
  const heldByBox = turnsOn.some((s) => !onNow(s)) || (leavesWave2 && !leavesNow);
  const quietLowered = now.quietMs < was.quietMs;
  return {
    measured: true,
    turnsOn,
    turnsOff,
    leavesWave2,
    heldByBox,
    quietLowered,
    filesExceed: stallFilesExceed(box, now),
    before,
    after,
    quietMs: { before: was.quietMs, after: now.quietMs },
    mailOff: box.mailDisabled,
  };
}

/** Whether a write needs the operator's confirm: always for the unmeasured effect; otherwise exactly when a stage
 *  turns on in either reading, the further checks are left, or the quiet time is brought lower. A pure lowering of
 *  the level needs none. */
export function stallNeedsConfirm(effect: StallWriteEffect): boolean {
  if (!effect.measured) return true;
  return effect.turnsOn.length > 0 || effect.leavesWave2 || effect.quietLowered;
}

/** The confirm key: eight hex characters of a 32-bit FNV-1a over the effect's JSON and the before-row's `updatedAt`
 *  (`none` when it parsed `null`), in plain JavaScript, so no `node:crypto`. The builders return literals, so the key
 *  order is fixed. A staleness check, not a credential: the session gate guards the door. Because `updatedAt` is in
 *  it, a write between the 409 and the re-POST fails the match even when the effect reads the same. */
export function stallEffectKey(effect: StallWriteEffect, updatedAt: number | null): string {
  const s = `${JSON.stringify(effect)}@${updatedAt === null ? 'none' : String(updatedAt)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A quiet time as the feed body writes it: `30 min`, `2 h`, `2 h 30 min`. */
function stallQuietWords(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
function stallLevelChangeWords(p: StallSettingsParsed): string {
  if (p.level.kind === 'follow') return STALL_FOLLOW_LABEL;
  if (p.level.kind === 'chosen') return STALL_LEVEL_TEXT[p.level.level].label;
  return p.stored === 'absent' ? 'no stored choice' : 'unreadable stored level';
}
function stallQuietChangeWords(p: StallSettingsParsed): string {
  if (p.quiet.kind === 'default') return STALL_SECTION_TEXT.builtIn.replace('{value}', stallQuietWords(STALL_QUIET_MS));
  if (p.quiet.kind === 'set') return stallQuietWords(p.quiet.ms);
  return p.stored === 'absent' ? 'no stored choice' : 'unreadable stored quiet time';
}

/** The feed body for a write (§10 step 6), or `null` when the level and the quiet time read the same before and
 *  after; `updatedAt` never counts, so a no-op records nothing (D-4031). It names only what changed, with the L0
 *  labels, and names a `before` that was not a readable row explicitly, so a write that restores a lost row is
 *  recorded and never prints `undefined`. The route appends the actor. */
export function stallSettingsChange(before: StallSettingsRead, after: StallSettingsRead): string | null {
  const was = parseStallSettings(before);
  const now = parseStallSettings(after);
  const parts: string[] = [];
  const levelWas = stallLevelChangeWords(was);
  const levelNow = stallLevelChangeWords(now);
  if (levelWas !== levelNow) parts.push(`level: ${levelWas} → ${levelNow}`);
  const quietWas = stallQuietChangeWords(was);
  const quietNow = stallQuietChangeWords(now);
  if (quietWas !== quietNow) parts.push(`quiet time: ${quietWas} → ${quietNow}`);
  return parts.length === 0 ? null : parts.join('; ');
}

// ── the notice counts ────────────────────────────────────────────────────────────────────────────────────────────

/** One `run_events` row as the count reads it (§11): the store returns the window's rows and spells no detail head;
 *  the classification happens here, in L1. */
export interface StallObservationRow { readonly at: number; readonly detail: string | null }
type StallNoticeRow = StallNoticeCount['row'];
/** The four rows, in L0 key order, derived. */
const STALL_NOTICE_ROWS = Object.keys(STALL_NOTICE_TEXT) as StallNoticeRow[];
/** Each rung's row from its table recipient, with one arm named: `quiet` rung 1, the checks the kill rule reads. The
 *  observation records no recipient and the verdict can override the table, so no row claims a recipient (departure
 *  `counts-by-role` (D-4027)). */
const STALL_ROLE_ROW: Readonly<Record<StallRecipient, StallNoticeRow>> = { worker: 'wakes', coordinator: 'reports', operator: 'pushes' };

/** The notice counts by role, live (`sent`) and shadow apart, over rows the store already windowed. A row that is not
 *  exactly a stall detail of this build is skipped, and so is a rung its arm does not have (`stallArmHasRung` asks
 *  before `rungRecipient` would throw). Always the four rows, zeros included, in L0 key order. */
export function stallNoticeCounts(rows: readonly StallObservationRow[]): StallNoticeCount[] {
  const sent = new Map<StallNoticeRow, number>();
  const shadow = new Map<StallNoticeRow, number>();
  for (const r of rows) {
    const n = parseStallDetail(r.detail);
    if (n === null || !stallArmHasRung(n.arm, n.rung)) continue;
    const row = n.arm === 'quiet' && n.rung === 1 ? 'checks' : STALL_ROLE_ROW[rungRecipient(n.arm, n.rung)];
    const column = n.mode === 'live' ? sent : shadow;
    column.set(row, (column.get(row) ?? 0) + 1);
  }
  return STALL_NOTICE_ROWS.map((row) => ({ row, sent: sent.get(row) ?? 0, shadow: shadow.get(row) ?? 0 }));
}

// ── the kebab words ──────────────────────────────────────────────────────────────────────────────────────────────

/** Every quoted kebab word this file, the settings store and the settings routes spell: a mail-gate mode in the
 *  ladder, the POST's refusal code, and the feed actor when the auth gate is unarmed. None is a mail rejection or a
 *  run refusal. `mail-routes.test.ts`'s scan admits them through this guard, never through its allowlist. */
const STALL_SETTINGS_KEBABS: readonly string[] = ['busy-shadow', 'confirm-required', 'flag-off'];
export function isStallSettingsKebab(token: string): boolean {
  return STALL_SETTINGS_KEBABS.includes(token);
}
