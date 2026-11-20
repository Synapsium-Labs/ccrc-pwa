// shared/model-advance.d.mts — hand-written, in `shared/models.d.mts`'s shape: the `.mjs` beside it is what
// runs, and this is what lets a TypeScript caller import it with types. Like the `.mjs`, it spells no class word.
import type { Catalogue, ModelClass, ModelWindows, Registry } from './models.js';

export declare const BLOCKED_CAUSES: readonly [
  'advance-file-unreadable', 'advance-file-invalid', 'registry-unreadable', 'registry-invalid',
  'catalogue-unreadable', 'catalogue-invalid', 'windows-unreadable', 'pin-grammar', 'shared-family',
  'lane-not-codex-kind', 'lock-unwritable',
  'alias-source-absent', 'alias-cache-stale', 'aliases-file-unreadable', 'aliases-file-invalid',
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
export declare function chooseCandidate(
  a: { registry: Registry; catalogue: Catalogue | null; cls: ModelClass; family: string | null },
): Choice;
export declare function resolveEffort(
  a: { stored: string | undefined; oldEfforts: readonly string[] | null; newEfforts: readonly string[] },
): string | undefined;
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

export declare class AdvanceInvalid extends Error {
  readonly field: string;
  constructor(field: string, message: string);
}

/** `model` is the id an Anthropic lane's hold holds (Task A2.3); absent on a Codex lane's. */
export interface Hold { at: string; by: HoldBy; model?: string }
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
