// The tsc probe for `shared/model-aliases.d.mts` (`types/ok/model-advance.ts`'s idiom): a `.d.mts` enters a compiler
// program only when something imports the `.mjs`, so this file puts the declarations in front of tsc. It MUST compile
// clean, and it carries no cast.
import {
  ALIASES_VERSION, AliasesInvalid, CACHE_STALE_AFTER_MS, aliasesSourceCause, bareModelId, newestCache, parseAliases,
  parseCatalogueCache, resolveAliases, serializeAliases,
} from '../../../../shared/model-aliases.mjs';
import type {
  AliasClass, AliasRow, AliasSourceCause, Aliases, CacheReading, CacheSkip, Launch, ResolveInput,
} from '../../../../shared/model-aliases.mjs';
import type { ModelClass } from '../../../../shared/models.js';

declare const json: unknown;
declare const cls: ModelClass;
declare const input: ResolveInput;
declare const launch: Launch;

export const reading: CacheReading = parseCatalogueCache(json);
export const newest: ReturnType<typeof newestCache> = newestCache([reading]);
export const bare: string = bareModelId('x[1m]');
export const aliases: Aliases = resolveAliases(input);
export const parsed: Aliases = parseAliases(json);
export const text: string = serializeAliases(aliases);
export const cause: AliasSourceCause | null = aliasesSourceCause(aliases);
export const one: AliasClass = aliases.classes[cls];
export const rowOf: AliasRow | null = one.row;
export const efforts: readonly string[] | null = rowOf === null ? [] : rowOf.efforts;
export const version: 1 = ALIASES_VERSION;
export const window: 604_800_000 = CACHE_STALE_AFTER_MS;
export const field: string = new AliasesInvalid('v', 'v is wrong').field;
export const born: string = launch.bornAt;
export const tag: 'current' | 'older' | 'invalid' = reading.format;
export const skips: readonly CacheSkip[] = reading.format === 'current' ? reading.skipped : [];
