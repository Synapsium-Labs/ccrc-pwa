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

// A numeric use, not just a bare import — but `any` is assignable to
// `number` regardless, so this line alone (round 3 re-review, M5, measured)
// does NOT catch a declaration widened to `any`: with
// `export declare const CLIENT_DEFAULT_CONTEXT_TOKENS: any;` in
// shared/modelenv.d.mts, this assignment still type-checks. The `IsAny`
// check below does catch it: `1 & T` simplifies to the literal `1` for any
// real type, so `0 extends (1 & T)` is false — but `any` intersected with
// anything is `any`, and `0 extends any` is true, so `IsAny<any>` alone is
// `true` where `IsAny<number>` is `false`. Measured: with the declaration
// above widened to `any`, this file fails to compile (TS2322, `true` is not
// assignable to `never`); with it left as `number`, `_notAny`'s own type
// checks out and this file compiles clean.
export const clampedBelowClientDefault: number = Math.min(200000, CLIENT_DEFAULT_CONTEXT_TOKENS);

type IsAny<T> = 0 extends (1 & T) ? true : false;
const _notAny: IsAny<typeof CLIENT_DEFAULT_CONTEXT_TOKENS> extends false ? true : never = true;
