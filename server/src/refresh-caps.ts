import type { FleetClient, FleetState } from './remote/client.js';

/** Composition-root factory: binds `fleet.client`/`fleet.state` into the
 *  `Deps.refreshCaps` seam `FleetWatcher`'s 60s lane calls. Pulled into its
 *  own file — same reason `ccdRunner` lives in `lifecycle.ts` rather than
 *  inline in `index.ts` — so the one piece of independent logic here (the
 *  `null`-means-no-evidence guard) is unit-testable without importing
 *  `index.ts` itself, which loads real config, opens a real `connectFleet`,
 *  and binds a real port as side effects of module load alone. */
export function makeRefreshCaps(client: Pick<FleetClient, 'caps'>, state: FleetState): () => Promise<void> {
  return async () => {
    const verbs = await client.caps();
    if (verbs !== null) state.ccdVerbs = verbs;
  };
}
