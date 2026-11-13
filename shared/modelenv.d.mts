// shared/modelenv.d.mts — hand-written, `shared/wrapper.d.mts`'s shape and job.
// The `.mjs` beside it is what runs.
import type { Catalogue, ModelWindows, Registry } from './models.js';

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
  // The class ALIAS `registry.subagent` names — ALIAS ONLY, `haiku` or
  // `sonnet`, measured 2026-09-09 on Claude Code 2.1.267 (SUBAGENT_CLASSES,
  // shared/models.mjs). The other two classes are refused at WRITE
  // (`deploy/models-op.mjs`'s `set-subagent`) and at RENDER (this module's
  // `modelEnvBlock`, which is what produces a `ModelEnv` value at all) — NOT
  // at read: a registry already on disk naming either, from before this
  // narrowing, still parses (fix round 2A, N1), it just cannot reach this
  // type.
  CLAUDE_CODE_SUBAGENT_MODEL: string;
  // The eighth key (§6.1, amended 2026-09-08, by the codex-bridge spec §2.7,
  // and replaced by the provider's-promise rule, D-8564):
  // `contextWindowFor(...).tokens` as a string — the smallest window across
  // the lane's class models, each its measured window (never above
  // `windowCeiling`) or else its fresh catalogue `context`; never above the
  // client's 200000 while a class model has neither; absent when none has.
  CLAUDE_CODE_MAX_CONTEXT_TOKENS?: string;
  // Present only when the caller asked for a Codex lane's block
  // (`modelEnvBlock`'s `codexLane` option): the security-guidance plugin's
  // master switch for its LLM reviews (operator ruling 2026-11-12, option b).
  ENABLE_CODE_SECURITY_REVIEW?: '0';
};
export declare class ModelEnvInvalid extends Error {}
/** A lane file's text, type-tested first: throws ENOTREG for anything that is
 *  not a regular file (a FIFO above all), ENOENT for an absent path. */
export declare function readRegular(p: string): string;
export declare const MODEL_ENV_KEYS: readonly string[];
/** The keys a Codex lane's block carries beyond `MODEL_ENV_KEYS`. */
export declare const CODEX_LANE_ENV: Readonly<{ ENABLE_CODE_SECURITY_REVIEW: '0' }>;
/** Every key a lane's settings `env` can carry from this writer. */
export declare const LANE_ENV_KEYS: readonly string[];
/** The client's default window for a model id it does not know (spec §6.1).
 *  A class model with no measured window and no provider promise counts at
 *  this (D-8564). */
export declare const CLIENT_DEFAULT_CONTEXT_TOKENS: number;
/** What decided the eighth key (codex-bridge spec §2.7, D-8564): `tokens` is
 *  what `modelEnvBlock` writes (null: omitted); `unmeasured` is the class models
 *  with no measured window, in CLASSES order; `model` is the class model whose
 *  window decided `tokens` and `source` where that window came from (both null
 *  exactly when `tokens` is). */
export type ContextWindow = {
  tokens: number | null;
  rule: 'measured' | 'default' | 'none';
  unmeasured: string[];
  model: string | null;
  source: 'measured' | 'provider' | 'client' | null;
};
/** The largest window a lane may hold for a model (D-8564): a codex
 *  catalogue's `maxContext` for it, else WINDOW_MAX, never above WINDOW_MAX. */
export declare function windowCeiling(catalogue: Catalogue | null, modelId: string): number;
export declare function contextWindowFor(
  registry: Registry, catalogue: Catalogue | null, windows: ModelWindows | null | undefined,
): ContextWindow;
export declare function modelEnvBlock(
  registry: Registry, catalogue: Catalogue | null, windows?: ModelWindows | null,
  opts?: { codexLane?: boolean },
): ModelEnv;
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
