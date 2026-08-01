// HISTORICAL BYPASS 1 (Task 11, review round 1): an inline array literal sitting
// at the runner call site. The original layer 2b was a BLACKLIST — "no array
// literal at a call site" — and this is the shape it was written against; it is
// here to prove the type rejects it without anyone having to name the shape.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact error.
import type { Deps } from '../../../src/server.js';

declare const deps: Deps;

void deps.runCcd(['ws-rm', 'evil']);
