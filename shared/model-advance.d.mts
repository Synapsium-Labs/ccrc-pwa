// shared/model-advance.d.mts — hand-written, in `shared/models.d.mts`'s shape: the `.mjs` beside it is what
// runs, and this is what lets a TypeScript caller import it with types. Like the `.mjs`, it spells no class word.
import type { Catalogue, ModelClass, Registry } from './models.js';

export declare const BLOCKED_CAUSES: readonly [
  'advance-file-unreadable', 'advance-file-invalid', 'registry-unreadable', 'registry-invalid',
  'catalogue-unreadable', 'catalogue-invalid', 'windows-unreadable', 'pin-grammar', 'shared-family',
  'lane-not-codex-kind',
];
export type BlockedCause = (typeof BLOCKED_CAUSES)[number];
export declare const REASON_MAX: 200;

export interface ParsedModelId { vendor: string; version: number[]; family: string }

export interface Choice {
  candidate: string | null;
  reason: 'newer' | 'retired' | 'empty' | null;
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

export interface Hold { at: string; by: HoldBy }
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
  [key: string]: unknown;
}
export interface ClassAdvance {
  family: string | null;
  hold: Hold | null;
  previous: Previous | null;
  history: HistoryEntry[];
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
export declare function recordMove(adv: Advance, cls: ModelClass, e: HistoryEntry): Advance;
export declare function recordFailure(
  adv: Advance, cls: ModelClass, f: { at: string; from: string | null; to: string; reason: string },
): { advance: Advance; isNew: boolean };
export declare function reconcilePending(adv: Advance, registry: Registry): { advance: Advance; recovered: boolean };
export declare function heldBackOf(c: ClassAdvance, candidate: string | null): HistoryEntry | null;
export declare function lastMoveOf(c: ClassAdvance): HistoryEntry | null;
