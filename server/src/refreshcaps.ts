import type { FleetIdentityCell } from './fleetidentity.js';
import type { FleetClient, FleetState } from './remote/client.js';

/** Composition-root factory: binds `fleet.client`/`fleet.state` into the
 *  `Deps.refreshCaps` seam `FleetWatcher`'s 60s lane calls. Pulled into its
 *  own file — same reason `ccdRunner` lives in `lifecycle.ts` rather than
 *  inline in `index.ts` — so the one piece of independent logic here (the
 *  `null`-means-no-evidence guard) is unit-testable without importing
 *  `index.ts` itself, which loads real config, opens a real `connectFleet`,
 *  and binds a real port as side effects of module load alone. */
//
// THE EPOCH (path-identity spec 2026-10-12 §5.2). `ccdVerbs` survives a close, so a `caps` answer asked on one
// connection and landing after a close (and perhaps a fresh ready) would describe another connection's agent to
// every reader of this one. It is written only when the connection epoch is the one it was asked under. Otherwise
// it is dropped: the next ready's frame and the next minute's refresh measure the current agent.
export function makeRefreshCaps(
  client: Pick<FleetClient, 'caps'>, state: FleetState, identity: Pick<FleetIdentityCell, 'epochNow'>,
): () => Promise<void> {
  return async () => {
    const asked = identity.epochNow();
    const verbs = await client.caps();
    if (verbs !== null && identity.epochNow() === asked) state.ccdVerbs = verbs;
  };
}
