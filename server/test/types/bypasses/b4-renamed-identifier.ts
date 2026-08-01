// HISTORICAL BYPASS 4 (Task 13 review): a ONE-IDENTIFIER RENAME. Layer 2b
// exempted a `ccd()` call whose third argument was spelled with `runCcd`'s own
// declared parameter name, WITHOUT tracing it — and that parameter was really
// named `args`. So naming the local `args` walked an arbitrary argv straight
// through the check that existed to stop exactly this.
//
// Two independent errors now: `deps.run` does not exist, and `args` is not a
// `CcdArgv`. Either alone closes the bypass.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact errors.
import { ccd } from '../../../src/lifecycle.js';
import type { Deps } from '../../../src/server.js';

declare const deps: Deps;

const args = ['ws-rm', 'evil'];
void ccd(deps.run, deps.cfg, args);
