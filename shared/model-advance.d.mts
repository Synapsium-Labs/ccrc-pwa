// shared/model-advance.d.mts — hand-written, in `shared/models.d.mts`'s shape: the `.mjs` beside it is what
// runs, and this is what lets a TypeScript caller import it with types. Like the `.mjs`, it spells no class word.
import type { Catalogue, ModelClass, ModelWindows, Registry } from './models.js';

export declare const BLOCKED_CAUSES: readonly [
  'advance-file-unreadable', 'advance-file-invalid', 'registry-unreadable', 'registry-invalid',
  'catalogue-unreadable', 'catalogue-invalid', 'windows-unreadable', 'pin-grammar', 'shared-family',
  'lane-not-codex-kind', 'lock-unwritable',
  'alias-source-absent', 'alias-cache-stale', 'aliases-file-unreadable', 'aliases-file-invalid',
  'pin-missing', 'effort-dropped', 'effort-fallback',
];
export type BlockedCause = (typeof BLOCKED_CAUSES)[number];
export declare const REASON_MAX: 200;
export declare const CANDIDATE_REASONS: readonly ['newer', 'retired', 'empty'];
export type CandidateReason = (typeof CANDIDATE_REASONS)[number];

export interface ParsedModelId { vendor: string; version: number[]; family: string }

export interface Choice {
  candidate: string | null;
  reason: CandidateReason | null;
  blocked: 'pin-grammar' | 'shared-family' | null;
}

export declare function parseModelId(id: string): ParsedModelId | null;
export declare function familyOf(id: string | null): string | null;
export declare function compareVersions(a: readonly number[], b: readonly number[]): -1 | 0 | 1;
export declare function eligibleIds(registry: Registry, catalogue: Catalogue | null): string[];
/** Programme wave 3 (D-8838): the shortest run of continuous fresh sightings of a missing pin before `retired`. */
export declare const RETIRE_GRACE_MS: 21600000;
/** The longest gap between two sightings that still continues a run (D-8838). */
export declare const RETIRE_GAP_MS: 5400000;
/** A class's run of sightings of its missing pin (`markMissing`); `seen` is absent on a record of the first shape. */
export interface MissingMark { model: string; since: string; seen?: string }
/** A fresh catalogue's observation time in the advance file's time form, or null. */
export declare function observedAt(catalogue: Catalogue | null | undefined): string | null;
export declare function chooseCandidate(
  a: { registry: Registry; catalogue: Catalogue | null; cls: ModelClass; family: string | null;
    missing?: MissingMark | unknown; nowMs?: number },
): Choice;
export interface PinMissing { model: string; since: string | null; until: string | null; older: string }
export declare function pinMissing(
  a: { registry: Registry; catalogue: Catalogue | null; cls: ModelClass; missing?: MissingMark | unknown; nowMs: number },
): PinMissing | null;
export interface Candidate extends Choice { effortTo: string | null; canaryEffort: string | null }
export declare function candidateFor(
  a: { registry: Registry; catalogue: Catalogue | null; cls: ModelClass; family: string | null;
    missing?: MissingMark | unknown; nowMs?: number },
): Candidate;
export declare function markMissing(
  adv: Advance, registry: Registry, catalogue: Catalogue | null, nowMs: number,
): { advance: Advance; changed: boolean };
/** One class's stored effort level replaced by its fallback because its model no longer offers it (D-8842). */
export interface EffortFallback { class: ModelClass; model: string; from: string; to: string }
export declare function effortFallbacks(
  json: unknown, catalogue: Catalogue | null,
): { registry: Registry; fallbacks: EffortFallback[] } | null;
export declare function resolveEffort(
  a: { stored: string | undefined; oldEfforts: readonly string[] | null; newEfforts: readonly string[] },
): string | undefined;
/** A class's effort level set in (or, for null, removed from) a registry copy, edited in place and returned. */
export declare function withEffort<R extends Registry>(next: R, cls: ModelClass, level: string | null): R;
/** A history reason as `parseAdvance` accepts it: printable ASCII, at most `REASON_MAX` characters. */
export declare const historyReason: (text: unknown) => string;
export declare function canaryEffort(efforts: readonly string[]): string | null;

// ── the advance file (§2.1, D13, D21) ──
export declare const ADVANCE_VERSION: 1;
export declare const HISTORY_CAP: 10;
export declare const HOWS: readonly ['advance', 'revert', 'hand'];
export declare const CANARY_RESULTS: readonly ['passed', 'failed', 'not-run'];
export declare const HOLD_BY: readonly ['hand', 'revert'];
export type How = (typeof HOWS)[number];
export type CanaryResult = (typeof CANARY_RESULTS)[number];
export type HoldBy = (typeof HOLD_BY)[number];

/** A stored time's one form, `YYYY-MM-DDTHH:MM:SSZ`, and its test (`shared/model-aliases.mjs` imports both). */
export declare const AT_RE: RegExp;
export declare function isAt(v: unknown): v is string;
export declare class AdvanceInvalid extends Error {
  readonly field: string;
  constructor(field: string, message: string);
}

/** `model` is the id an Anthropic lane's hold holds (Task A2.3); absent on a Codex lane's. `from` is the id a Revert moved
 *  the class away from (revert-ends-itself): the hold ends once something newer than it comes (`holdEnds`); absent on a
 *  hand hold and on a revert hold an older build wrote, which `holdFrom` derives. */
export interface Hold { at: string; by: HoldBy; model?: string; from?: string }
export interface Previous { model: string | null; effort: string | null }
export interface HistoryEntry {
  at: string;
  how: How;
  from: string | null;
  to: string | null;
  ok: boolean;
  canary: CanaryResult;
  effort?: { from: string | null; to: string | null };
  reason?: string;
  tries?: number;
  lastAt?: string;
  recovered?: boolean;
  /** The time of the evidence an Anthropic lane's move rests on (Task A2.3), kept as data. */
  evidenceAt?: string;
  /** Why an advance moved (D-8384): absent on an entry written before the field, which `causeOf` reads as unknown. */
  cause?: CandidateReason;
  [key: string]: unknown;
}
export interface ClassAdvance {
  family: string | null;
  hold: Hold | null;
  previous: Previous | null;
  history: HistoryEntry[];
  /** When an Anthropic lane's hold on the class was last released (Task A2.3); no history entry is made for it. */
  releasedAt?: string;
  /** The id the class was held at when that release lifted the hold, and the release's time (review 2964 F4, D-8857):
   *  present only until the hourly refresh records the alias move the release lifted, or finds there was none. */
  releasedHold?: { model: string; at: string };
  /** Programme wave 3: the run of sightings of a missing pin (`markMissing`). */
  missing?: MissingMark;
  /** Programme wave 3: the effort fallback the refresh last wrote on this class (`recordEffortFallbacks`). */
  effortFallback?: { at: string; model: string; from: string; to: string };
  [key: string]: unknown;
}
/** An automatic advance's intent (W2's `advance-commit`): it carries no `how`. */
export interface AdvancePending {
  how?: undefined;
  class: ModelClass;
  from: string | null;
  to: string;
  effortFrom: string | null;
  effortTo: string | null;
  at: string;
  /** The candidate's reason, carried onto the history entry the intent becomes (D-8384). */
  cause?: CandidateReason;
  /** The move ends the class's hold (revert-ends-itself): `reconcilePending` clears it with the move it records. */
  endsHold?: true;
}
/** A hand `set-class`'s intent: the class it named, that class's pin before and after (`null` for none), the other
 *  classes one model, one class empties (each pinned `to` before), and the act's time. */
export interface HandPending {
  how: 'hand';
  class: ModelClass;
  from: string | null;
  to: string | null;
  emptied: ModelClass[];
  at: string;
}
export type Pending = AdvancePending | HandPending;
export interface Advance {
  v: 1;
  classes: Record<ModelClass, ClassAdvance>;
  pending: Pending | null;
  [key: string]: unknown;
}

export declare function parseAdvance(json: unknown): Advance;
export declare function serializeAdvance(adv: Advance): string;
export declare function backfillAdvance(
  a: { registry: Registry; seedFamilies: Readonly<Record<ModelClass, string | null>> | null },
): Advance;
/** An Anthropic lane's advance file: every class's family its own class word, nothing else set. */
export declare function seedAnthropicAdvance(): Advance;
export declare function recordMove(adv: Advance, cls: ModelClass, e: HistoryEntry): Advance;
export declare function recordFailure(
  adv: Advance, cls: ModelClass, f: { at: string; from: string | null; to: string; reason: string },
): { advance: Advance; isNew: boolean };
export declare function reconcilePending(adv: Advance, registry: Registry): { advance: Advance; recovered: boolean };
export declare function heldBackOf(c: ClassAdvance, candidate: string | null): HistoryEntry | null;

// ── the end of a hold (revert-ends-itself) ──
/** Whether a held class's id is unobserved against the hold standing now: a hold stands, and the id rests on no evidence
 *  or on evidence older than the hold (the resolver's `unobserved` rule, asked again by `holdEnds` and the health reading). */
export declare function heldUnobserved(evidenceAt: string | null, hold: { at: string } | null | undefined): boolean;
/** The id a class's standing hold waits to be passed (its `from`, else the newest revert entry to the held id, else the
 *  held id), or null with no hold. The one reader of a hold's `from`. */
export declare function holdFrom(c: ClassAdvance, heldId: string | null): string | null;
/** Why a hold ended: a model newer than `from`, the held pin retired by the grace, or a third alias id. */
export type HoldEndWhy = 'newer' | 'retired' | 'alias-moved';
export interface HoldEnd { ends: boolean; why: HoldEndWhy | null; from: string | null }
/** The one row of an aliases file `holdEnds` reads. */
export interface HoldEndAliasRow { id: string | null; evidenceAt: string | null; unlaunchable: unknown; unobserved?: boolean }
/** Whether a class's standing hold ends now (revert-ends-itself), on a Codex lane from its candidate this hour, on an
 *  Anthropic lane from its alias row. */
export declare function holdEnds(input:
  | { arm: 'codex'; c: ClassAdvance; pin: string | null; choice: Choice }
  | { arm: 'alias'; c: ClassAdvance; row: HoldEndAliasRow | null }): HoldEnd;
/** The longest a hold whose end has come may stand before the health reading reports it: `RETIRE_GAP_MS`. */
export declare const HOLD_END_WAIT_MS: 5400000;
/** Whether a hold whose end came at `sinceAt` has stood past `HOLD_END_WAIT_MS` by `nowMs`. */
export declare function holdEndDue(sinceAt: string | null, nowMs: number): boolean;
/** The hold a Codex revert writes, naming what it moved the class away from. */
export declare function revertHold(c: ClassAdvance, from: string | null, to: string | null, at: string): Hold;
/** `advance-commit`'s hold question: null with no hold, else `holdEnds`' answer, ending only on the planned candidate. */
export declare function holdEndFor(a: { c: ClassAdvance; pin: string | null; choice: Choice; to: string }): HoldEnd | null;
/** The `reason` a move that ended a hold records on its history entry (`{}` for any other move). */
export declare function holdEndEntry(end: HoldEnd | null, pin: string | null, to: string): { reason?: string };
export interface HoldWaitingRow { class: ModelClass; pin: string | null; hold: { at: string; by: HoldBy }; from: string | null }
export interface HeldBehindRow {
  class: ModelClass; pin: string | null; newer: string | null; reason: CandidateReason | null; hold: { at: string; by: HoldBy };
  from: string | null; since: string | null; due: boolean;
}
/** One held Codex class's `advance-health` row: waiting, or behind (its end has come). */
export declare function holdReading(a: { c: ClassAdvance; cls: ModelClass; pin: string | null; choice: Choice;
  sinceAt: string | null; nowMs: number }): { waiting: HoldWaitingRow; behind?: undefined } | { behind: HeldBehindRow; waiting?: undefined };
/** The class's hold cleared (a copy), as the writer that moves it records the move; an Anthropic lane's (`alias`) records
 *  `releasedAt` and drops `releasedHold`. */
export declare function endHold(adv: Advance, cls: ModelClass, at: string, o?: { alias?: boolean }): Advance;
export declare function recordEffortFallbacks(adv: Advance, fallbacks: readonly EffortFallback[], at: string): Advance;
export declare function effortFallbackOf(
  c: ClassAdvance | null, registry: Registry, cls: ModelClass, catalogue: Catalogue | null,
): { at: string; model: string; from: string; to: string } | null;
export declare function clearEffortFallback(adv: Advance, cls: ModelClass): { advance: Advance; changed: boolean };
/** One class's wave 3 rows for `advance-health`'s blocked list (D-8838, D-8842). */
export declare function classWaits(
  a: { registry: Registry; catalogue: Catalogue | null; cls: ModelClass; c: ClassAdvance | null; nowMs: number },
): { cause: 'pin-missing' | 'effort-fallback'; detail: string }[];
/** `advance-health`'s detail for a registry still refused for a dropped level. */
export declare const effortDroppedDetail: (f: EffortFallback, onDisk?: boolean) => string;
/** Why the automatic advance does not act on a lane with a class registry, or null when it does (D-5198; moved here from
 *  deploy/models-op.mjs, D-8866). */
export declare function advanceIneligible(account: { exec?: unknown }, registry: { probe: string }):
  'lane-not-codex-kind' | 'probe-not-codex' | null;
export declare function refreshRecord(
  adv: Advance,
  a: { registry: Registry; catalogue: Catalogue | null; fallbacks: readonly EffortFallback[]; nowMs: number },
): { advance: Advance; changed: boolean };
export declare function lastMoveOf(c: ClassAdvance): HistoryEntry | null;

// ── the move that lowered a lane's window (D-8384, D-8564) ──
export declare function causeOf(e: HistoryEntry | null): CandidateReason | 'unknown';
export interface UnmeasuredMove {
  class: ModelClass;
  from: string;
  to: string;
  fromTokens: number;
  how: How;
  cause: CandidateReason | 'unknown' | null;
}
export declare function unmeasuredMoves(a: {
  registry: Registry;
  advance: Advance | null;
  windows: ModelWindows | null;
  rule: 'measured' | 'default' | 'none';
  tokens: number | null;
}): UnmeasuredMove[];
export declare function unmeasuredMoveNotice(lane: string, m: UnmeasuredMove, tokens: number | null): string;
export declare function clientWindowNotice(lane: string, registry: Registry, stale: boolean, room: { tokens: number | null; source: 'measured' | 'provider' | 'client' | null; model: string | null } | null): string | null;
// ── sessions behind a move (plan W3 Task 14) ──
export declare const BEHIND_AFTER_MS: 86400000;
/** The largest usage-sidecar `ts`, in whole seconds, that is still a time in seconds (a larger one is milliseconds). */
export declare const SIDECAR_TS_MAX_S: 99999999999;
export declare function isoSeconds(ms: number): string | null;
/** One session still on a model a move replaced: the class whose history holds the move, the model it replaced and
 *  what replaced it (null: the class was emptied), the move's time, and the evidence (the turn and the render). */
export interface SessionBehind {
  class: ModelClass;
  from: string;
  to: string | null;
  movedAt: string;
  turnAt: string;
  renderAt: string;
}
export declare function sessionBehind(a: {
  advance: Advance; registry: Registry; nowMs: number; turn: unknown; usage: unknown;
}): SessionBehind | null;
