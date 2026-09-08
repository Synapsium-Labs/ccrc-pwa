// shared/modelenv.d.mts — hand-written, `shared/wrapper.d.mts`'s shape and job.
// The `.mjs` beside it is what runs.
import type { Catalogue, Registry } from './models.js';

export interface ModelEnv {
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
}
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
