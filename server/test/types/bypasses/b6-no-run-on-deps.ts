// PIN (task 13S step 6): `run` is not on `Deps` at all — the half of the
// mechanism that is not the brand. Without this, a route could keep building
// argv through `CCD_ARGV` and still reach a raw runner for anything else.
//
// The brief's spelling of this pin, `(deps as { run?: unknown }).run`, compiles
// BY DESIGN and would have been a decorative pin: an OPTIONAL property is
// satisfied by its absence, so `Deps` really is assignable to `{ run?: unknown }`
// and the assertion is legal. The plain member access is the one that bites.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact error.
import type { Deps } from '../../../src/server.js';

declare const deps: Deps;

void deps.run;
