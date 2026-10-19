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
