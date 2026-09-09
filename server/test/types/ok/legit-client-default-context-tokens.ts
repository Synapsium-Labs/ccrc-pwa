// Item 10 of the final wave's round 2: `CLIENT_DEFAULT_CONTEXT_TOKENS`
// (shared/modelenv.mjs) had a declaration in shared/modelenv.d.mts with no
// probe anywhere in a compiled program — `legit-modelenv-composition.ts`
// exercises `ModelEnv`/`mergeSettingsEnv`/`clearSettingsEnv`/`MODEL_ENV_KEYS`
// but never imports this export, so deleting its declaration line left the
// whole suite green. This file is that measurement: it lives in the same
// `test/types/ok/` positive-control directory, swept into the same
// `test/types/tsconfig.ok.json` project with no new project needed.
//
// This file MUST compile clean.
import { CLIENT_DEFAULT_CONTEXT_TOKENS } from '../../../../shared/modelenv.mjs';

// A numeric use, not just a bare import: a declaration widened to `any`
// would still let the import through, so this line has to type-check the
// value as a number to catch that shape of drift too.
export const clampedBelowClientDefault: number = Math.min(200000, CLIENT_DEFAULT_CONTEXT_TOKENS);
