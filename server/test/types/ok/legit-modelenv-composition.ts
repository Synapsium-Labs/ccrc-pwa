// Fix round 1, finding 1: `shared/modelenv.d.mts` was in NO compiler program.
// `server/tsconfig.json`'s include is `["src/**/*.ts", "../shared/**/*.ts",
// "../shared/**/*.mjs"]` — no `*.d.mts` glob — so a `.d.mts` only enters a
// program when something INSIDE it imports the sibling `.mjs` and TypeScript
// pulls the companion declaration file in to type it. Nothing under `src/`
// imports `shared/modelenv.mjs` yet (Task 6, `deploy/models-op.mjs`, is not
// landed), so `npx tsc --noEmit` from `server/` never touched this file, and
// the `ModelEnv` interface's missing index signature — which broke the
// module's own canonical composition below — went unmeasured.
//
// This file is that measurement. It lives in `test/types/ok/`, this repo's
// existing "must compile clean" positive-control directory (see
// `ccdargv-brand.test.ts`'s `positive` check, which already spawns tsc over
// `test/types/tsconfig.ok.json` and asserts exit code 0 — that project's
// `include` is `ok/**/*.ts`, so this file is swept in with no new project
// needed). `modelenv-types.test.ts` additionally asserts THIS file specifically
// still contains the two compositions the ruling named, so emptying it could
// not make the pin pass by accident.
//
// This file MUST compile clean.
import {
  MODEL_ENV_KEYS, clearSettingsEnv, mergeSettingsEnv, modelEnvBlock,
} from '../../../../shared/modelenv.mjs';
import type { Catalogue, Registry } from '../../../../shared/models.js';

declare const reg: Registry;
declare const cat: Catalogue | null;
declare const settingsPath: string;

// The module's own canonical composition: `modelEnvBlock`'s return value —
// `ModelEnv`, up to eight keys, the eighth optional — handed straight to
// `mergeSettingsEnv`'s `Record<string, string>` parameter, no cast anywhere.
export const merged = mergeSettingsEnv(settingsPath, modelEnvBlock(reg, cat));

// `ccrc models <id> rm`'s whole settings step (Task 6): `MODEL_ENV_KEYS`
// handed straight to `clearSettingsEnv`, no respelling.
export const cleared = clearSettingsEnv(settingsPath, MODEL_ENV_KEYS);
