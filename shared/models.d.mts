// shared/models.d.mts — hand-written, in `shared/wrapper.d.mts`'s shape and for
// its job: the `.mjs` beside it is what runs, and this is what lets a
// TypeScript caller import it with types. The names and the shape are
// `shared/models.ts`'s exactly.
import type {
  Catalogue, CatalogueModel, DerivedModels, ModelClass, Registry,
} from './models.js';

export type { Catalogue, CatalogueModel, DerivedModels, ModelClass, Registry };
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
