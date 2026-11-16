// The tick diet's differential rows under the UTF-8 locale, part `registry` (E3, E6, E8 and E10, the W1 rows, the share rows and the registry and home readers): one of three files that
// `ccd-tick-diet-equivalence-utf8.test.ts` once ran as a single file of 10.5 minutes (#387, tick-diet spec §9). The
// planner never splits a file, so the blocks are now files it can place on separate workers (D-6767). About 1 minute.
// Each block keeps its title and body in `ccdTickDietRunner.ts`'s `registerLocaleRows`; the table of which blocks is
// `ccd-tick-diet-equivalenceFixture.ts`'s.
//
// The header comment of `ccd-tick-diet-equivalence-static.test.ts` says what each part proves. With no UTF-8 locale this half
// is skipped on Darwin, saying so, and red on Linux, where the supervisors run under one.
import { registerUtf8Parts } from './ccd-tick-diet-equivalenceFixture.js';

registerUtf8Parts('registry');
