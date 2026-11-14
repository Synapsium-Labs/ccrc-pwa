// The tick diet's differential rows under the UTF-8 locale, part `route-2` (D-6767): block `E9-2`, E9x and E9a over
// share 2 of the runner's `ROUTE_CHAIN_SHARES` shares of the route chain's records, which `-utf8-route` once ran in
// one batch of about 6 minutes. The table of which blocks each file runs is `ccd-tick-diet-equivalenceFixture.ts`'s.
//
// The header comment of `ccd-tick-diet-equivalence-static.test.ts` says what each part proves. With no UTF-8 locale this half
// is skipped on Darwin, saying so, and red on Linux, where the supervisors run under one.
import { registerUtf8Parts } from './ccd-tick-diet-equivalenceFixture.js';

registerUtf8Parts('route-2');
