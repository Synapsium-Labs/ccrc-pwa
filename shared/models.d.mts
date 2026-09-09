// shared/models.d.mts — hand-written, in `shared/wrapper.d.mts`'s shape and for
// its job: the `.mjs` beside it is what runs, and this is what lets a
// TypeScript caller import it with types. The names and the shape are
// `shared/models.ts`'s exactly.
import type {
  Catalogue, CatalogueModel, DerivedModels, ModelClass, ProbeKind, Registry,
} from './models.js';

export type { Catalogue, CatalogueModel, DerivedModels, ModelClass, ProbeKind, Registry };
// Fix round 1, finding 3 (2026-09-08): the runtime twin of `shared/models.ts`'s
// own `as const` `CLASSES`/`PROBE_KINDS` — see `shared/models.mjs` for why
// that file keeps a separate export rather than this one re-exporting it.
export declare const CLASSES: readonly ModelClass[];
export declare const PROBE_KINDS: readonly ProbeKind[];
export declare const MODEL_ID_RE: RegExp;
export declare class RegistryInvalid extends Error { readonly field: string }
export declare class CatalogueInvalid extends Error {}
export declare function parseCatalogue(json: unknown): Catalogue;
export declare function parseRegistry(json: unknown, catalogue?: Catalogue | null): Registry;
export declare function resolveDiscovery(reg: Registry, catalogue: Catalogue | null): string[];
export declare function deriveModels(reg: Registry | null, catalogue: Catalogue | null): DerivedModels;
export declare function availableFor(
  reg: Registry | null, catalogue: Catalogue | null, anthropic: boolean,
): ModelClass[];
export declare function familyClassOf(anthropicModelId: string): ModelClass | null;
export declare function classOfModel(reg: Registry, modelId: string): ModelClass | null;
export declare const UNAVAILABLE_PREFIX: string;
