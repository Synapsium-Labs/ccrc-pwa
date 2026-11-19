// shared/model-aliases.d.mts — hand-written, in `shared/model-advance.d.mts`'s shape: the `.mjs` beside it is what
// runs, and this is what lets a TypeScript caller import it with types. Like the `.mjs`, it spells no class word.
import type { ModelClass } from './models.js';

/** One catalogue row. `efforts` is `null` when the row carries no effort field and `[]` only when the row says the
 *  model takes none (D-8750): the two are never folded. */
export interface AliasRow {
  id: string;
  label: string | null;
  efforts: readonly string[] | null;
  defaultEffort: string | null;
  minVersion: string | null;
}

export type CacheReading =
  | { format: 'current'; fetchedAt: string; aliasTargets: Record<ModelClass, string | null>; rows: Map<string, AliasRow> }
  | { format: 'older'; fetchedAt: string | null }
  | { format: 'invalid'; why: string };

export declare function bareModelId(raw: string): string;
export declare function parseCatalogueCache(json: unknown): CacheReading;
export declare function newestCache(readings: readonly CacheReading[]): Extract<CacheReading, { format: 'current' }> | null;
