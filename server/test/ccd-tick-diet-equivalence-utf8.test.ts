// The tick diet's differential rows under the UTF-8 locale (#387, tick-diet spec §9): the second half of
// `ccd-tick-diet-equivalence.test.ts`, run as a file of its own. One shard carried both halves at a 20.9-minute median
// against a 30-minute bound, and the planner never splits a file, so each locale is now a file the planner can place.
//
// The rows, the runner and the locale probe are `ccdTickDietRunner.ts`'s; the header comment of
// `ccd-tick-diet-equivalence.test.ts` says what each part proves. With no UTF-8 locale this half is skipped on Darwin,
// saying so, and red on Linux, where the supervisors run under one.
import { LOCALES, registerLocaleRows } from './ccdTickDietRunner.js';

registerLocaleRows(LOCALES[1]);
