// The tick diet's differential rows under `C`, the `route` part (D-6767): E9 over the first of the runner's
// `ROUTE_CHAIN_SHARES` shares of the chain records, with E9b and the non-vacuity pins; `-route-2` to `-route-4` run the
// other shares. See `ccd-tick-diet-equivalenceFixture.ts` for which blocks each file runs and why the `C` rows are
// several files. What each block proves is in the header comment of `ccd-tick-diet-equivalence-static.test.ts`; the
// runner and the rows are `ccdTickDietRunner.ts`'s.
import { registerCParts } from './ccd-tick-diet-equivalenceFixture.js';

registerCParts('route');
