import { STALL_LEVELS, STALL_STAGES, isStallLevelChoice } from '../../../shared/api.js';
import type { StallHeld, StallLevel, StallNextStep, StallStage, StallStored, StallWatchStages } from '../../../shared/api.js';
import { STALL_QUIET_MS, stallArmingOf } from './stall.js';
import type { StallArming } from './stall.js';
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
 * - the resolver both sweeps and the view call, and the readers the view composes.
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

// ── the kebab words ──────────────────────────────────────────────────────────────────────────────────────────────

/** Every quoted kebab word this file, the settings store and the settings routes spell: a mail-gate mode in the
 *  ladder, the POST's refusal code, and the feed actor when the auth gate is unarmed. None is a mail rejection or a
 *  run refusal. `mail-routes.test.ts`'s scan admits them through this guard, never through its allowlist. */
const STALL_SETTINGS_KEBABS: readonly string[] = ['busy-shadow', 'confirm-required', 'flag-off'];
export function isStallSettingsKebab(token: string): boolean {
  return STALL_SETTINGS_KEBABS.includes(token);
}
