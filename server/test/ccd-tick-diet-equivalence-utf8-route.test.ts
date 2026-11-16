// The tick diet's differential rows under the UTF-8 locale, part `route` (E9, the route chain): one of three files that
// `ccd-tick-diet-equivalence-utf8.test.ts` once ran as a single file of 10.5 minutes (#387, tick-diet spec §9). The
// planner never splits a file, so the blocks are now files it can place on separate workers (D-6767). E9 was one batch
// of rows that ran about 6 minutes, which no move of a block could cut, so its chain records are split into the
// runner's `ROUTE_CHAIN_SHARES` shares: this file runs E9 over the first, with E9b and the non-vacuity pins, and
// `-utf8-route-2` to `-utf8-route-4` the others.
// Each block keeps its title and body in `ccdTickDietRunner.ts`'s `registerLocaleRows`; the table of which blocks is
// `ccd-tick-diet-equivalenceFixture.ts`'s.
//
// The header comment of `ccd-tick-diet-equivalence-static.test.ts` says what each part proves. With no UTF-8 locale this half
// is skipped on Darwin, saying so, and red on Linux, where the supervisors run under one.
import { registerUtf8Parts } from './ccd-tick-diet-equivalenceFixture.js';

registerUtf8Parts('route');
