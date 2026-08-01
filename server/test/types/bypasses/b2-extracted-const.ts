// HISTORICAL BYPASS 2 (Task 11, review round 1): the same array, extracted to a
// const one line earlier. There is then no literal AT the call site at all, so
// the blacklist form of layer 2b saw nothing — a trivial refactor away from the
// exact ws-add/ws-rm defect, with every suite green.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact error.
import type { Deps } from '../../../src/server.js';

declare const deps: Deps;

const argv = ['ensure', 'demo-quiet-basin'];
void deps.runCcd(argv);
