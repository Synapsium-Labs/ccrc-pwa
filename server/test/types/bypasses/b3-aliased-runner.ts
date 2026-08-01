// HISTORICAL BYPASS 3 (Task 11, fix-round review): alias the runner into a local
// and call THAT, so the literal substrings layer 2b banned (`deps.run(`,
// `this.run(`) appear nowhere in the file. The alias no longer helps because
// there is nothing on `Deps` to alias.
//
// This file MUST NOT compile. `ccdargv-brand.test.ts` asserts the exact error.
import type { Deps } from '../../../src/server.js';

declare const deps: Deps;

const runner = deps.run;
void runner(deps.cfg.ccdBin, ['ws-rm', 'evil']);
