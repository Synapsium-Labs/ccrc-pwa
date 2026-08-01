// PIN (task 13S step 6): aliasing the `CCD_ARGV` namespace buys nothing. What is
// checked is not the SPELLING of the callee but the TYPE of the argument, so a
// raw argv smuggled in beside a legitimate-looking alias is still rejected.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact error.
import { CCD_ARGV } from '../../../src/ccdargv.js';
import type { Deps } from '../../../src/server.js';

declare const deps: Deps;

const alias = CCD_ARGV;
void alias;
void deps.runCcd(['ws-rm', 'evil'] as string[]);
