// The tick diet's differential rows under `C`, the `route-3` part (D-6767): block `E9-3`, E9x and E9a over share 3 of
// the runner's `ROUTE_CHAIN_SHARES` shares of the route chain's records. See `ccd-tick-diet-equivalenceFixture.ts` for
// which blocks each file runs and why the `C` rows are several files. What each block proves is in the header comment
// of `ccd-tick-diet-equivalence-static.test.ts`; the runner and the rows are `ccdTickDietRunner.ts`'s.
import { registerCParts } from './ccd-tick-diet-equivalenceFixture.js';

registerCParts('route-3');
