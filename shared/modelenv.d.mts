// shared/modelenv.d.mts — hand-written, `shared/wrapper.d.mts`'s shape and job.
// The `.mjs` beside it is what runs.
import type { Catalogue, Registry } from './models.js';

// A `type` alias, not an `interface`: fix round 1, finding 1. An `interface`
// carries no implicit index signature, so the module's own canonical
// composition — `mergeSettingsEnv(p, modelEnvBlock(reg, cat))`, whose second
// parameter is `Record<string, string>` — failed to compile (TS2345, "Index
// signature for type 'string' is missing in type 'ModelEnv'"), measured with
// a standalone `tsc --strict --module NodeNext`. A type-literal alias gets
// that index signature implicitly and the same probe compiles clean, so
// `mergeSettingsEnv`'s signature stays `Record<string, string>` unchanged —
// see `server/test/types/ok/legit-modelenv-composition.ts` for the pin, which
// is the only place in this tree's compiler programs this file's types are
// ever actually checked (`server/tsconfig.json` has no `*.d.mts` glob, and
// nothing under `src/` imports `shared/modelenv.mjs` to pull the companion
// declaration file in on its own).
export type ModelEnv = {
  ANTHROPIC_DEFAULT_HAIKU_MODEL: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL: string;
  ANTHROPIC_DEFAULT_FABLE_MODEL: string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_SMALL_FAST_MODEL: string;
  CLAUDE_CODE_SUBAGENT_MODEL: string;
  // §6.1, amended 2026-09-08: present only when `catalogue` is non-null, not
  // stale, and names ANTHROPIC_MODEL's resolved model with a numeric context.
  CLAUDE_CODE_MAX_CONTEXT_TOKENS?: string;
};
export declare class ModelEnvInvalid extends Error {}
export declare const MODEL_ENV_KEYS: readonly string[];
export declare function modelEnvBlock(registry: Registry, catalogue: Catalogue | null): ModelEnv;
export declare function mergeSettingsEnv(
  settingsPath: string, block: Record<string, string>,
): { changed: boolean };
export declare function clearSettingsEnv(
  settingsPath: string, keys: readonly string[],
): { changed: boolean };
export declare function effortFile(
  registry: Registry, catalogue: Catalogue | null,
): { byModel: Record<string, string> };
export declare function classesTsv(registry: Registry, catalogue: Catalogue | null): string;
