// L3: the connection-bound fleet node identity (path-identity spec 2026-10-12 §5.2): "The current fleet identity
// is not the persisted update-inventory row. The server keeps {connectionEpoch, nodeIdState} in memory. Every
// accepted ready and every close invalidates it synchronously. An inventory read may publish a directly measured
// node id only while the epoch it captured still stands; a result from an earlier connection is discarded."
//
// One small synchronous memory cell, in `presence.ts`'s shape: nothing persisted, no timer, no clock (a
// measurement brings its own `measuredAt`), and no import of any kind. It FAILS SHUT. A server that just started,
// a connection that just changed and a node-id nobody could read all answer `unmeasured`; only a measurement
// published under the epoch it was taken on answers `known`. The temp-root collector's Settings arm binds to this
// answer and never to the inventory row, whose key can be the connection label or a uuid carried from an earlier
// sweep.
//
// WHO WRITES IT. The fleet client (`remote/client.ts`) invalidates it in three places: as the first statement of
// every accepted ready, right after a close's stale-socket guard, and in `close()`. The epoch lives there and never
// on `FleetState`, because a ready can be accepted before index.ts registers any listener. The inventory
// (`update/inventory.ts`) is the one publisher. In local mode nothing invalidates the composition root's cell, so
// its epoch stays 0, and the server row's own sweep publishes this box's node-id, because this box is the fleet node.

/** Why the current node is not known: one word per condition, none folded into another. */
export type FleetIdentityUnmeasuredWhy =
  | 'no-ready'             // constructed: no ready accepted yet
  | 'awaiting-inventory'   // a ready was accepted: nothing measured under its epoch yet
  | 'link-down'            // a close was observed, or the sweep found the link down
  | 'node-id-absent' | 'node-id-unreadable' | 'node-id-too-large' | 'node-id-malformed'
  | 'inventory-refused'    // the sweep's apply was refused or threw: its read is not trusted as identity
  | 'no-identity-source';  // `NO_FLEET_IDENTITY`: a Deps built without a cell

/** What a reader gets. `connectionEpoch` is always the cell's epoch at the moment of reading. A collision carries
 *  no `nodeId`, so nothing that asks `'nodeId' in x` can read it as an identity. */
export type CurrentFleetIdentity =
  | { readonly kind: 'known'; readonly connectionEpoch: number; readonly nodeId: string; readonly measuredAt: number }
  | { readonly kind: 'unmeasured'; readonly connectionEpoch: number; readonly why: FleetIdentityUnmeasuredWhy }
  | { readonly kind: 'collision'; readonly connectionEpoch: number; readonly why: 'node-id-keys-another-live-row' };

/** One measurement, before the cell stamps the epoch it stands under. */
export type FleetNodeMeasured =
  | { readonly kind: 'known'; readonly nodeId: string; readonly measuredAt: number }
  | { readonly kind: 'unmeasured'; readonly why: FleetIdentityUnmeasuredWhy }
  | { readonly kind: 'collision'; readonly why: 'node-id-keys-another-live-row' };

export type FleetIdentityPublish =
  | { readonly kind: 'published' } | { readonly kind: 'stale-epoch'; readonly captured: number; readonly current: number };

/** One answer under `connectionEpoch`, built field by field and frozen: a caller's object that carried more (a
 *  `nodeId` on a collision) never reaches a reader, and no reader can edit the answer in place. */
function stamped(m: FleetNodeMeasured, connectionEpoch: number): CurrentFleetIdentity {
  const s: CurrentFleetIdentity = m.kind === 'known'
    ? { kind: 'known', connectionEpoch, nodeId: m.nodeId, measuredAt: m.measuredAt }
    : m.kind === 'collision'
      ? { kind: 'collision', connectionEpoch, why: m.why }
      : { kind: 'unmeasured', connectionEpoch, why: m.why };
  return Object.freeze(s);
}

export class FleetIdentityCell {
  private epoch = 0;
  private latest: CurrentFleetIdentity = stamped({ kind: 'unmeasured', why: 'no-ready' }, 0);

  /** Synchronous. The epoch rises by one, and the answer becomes `unmeasured` with `why` under the new epoch,
   *  whatever it was before. Returns the new epoch. */
  invalidate(why: 'awaiting-inventory' | 'link-down'): number {
    this.epoch += 1;
    this.latest = stamped({ kind: 'unmeasured', why }, this.epoch);
    return this.epoch;
  }

  /** The epoch now. Capture it before an await; compare it, or publish under it, after. */
  epochNow(): number {
    return this.epoch;
  }

  /** The current answer. `current().connectionEpoch === epochNow()` always: every write stamps the epoch it stands
   *  under, and only `invalidate` moves the epoch, writing a fresh answer as it does. */
  current(): CurrentFleetIdentity {
    return this.latest;
  }

  /** Publishes `measured` only when `captured` is still the epoch. Any other capture, whether an earlier
   *  connection's or a number from nowhere, answers `stale-epoch` and changes nothing. Under one epoch the LATEST
   *  measurement wins, so a node read as known and then as unreadable is unmeasured: fail closed. */
  publish(captured: number, measured: FleetNodeMeasured): FleetIdentityPublish {
    if (captured !== this.epoch) return { kind: 'stale-epoch', captured, current: this.epoch };
    this.latest = stamped(measured, this.epoch);
    return { kind: 'published' };
  }
}

const NO_SOURCE: CurrentFleetIdentity = stamped({ kind: 'unmeasured', why: 'no-identity-source' }, 0);

/** The no-source reader for a Deps built without a cell (a test, a script): epoch 0 for ever and never `known`, so
 *  nothing that needs the current node can arm through it. It has no `publish` and no `invalidate`. */
export const NO_FLEET_IDENTITY: Pick<FleetIdentityCell, 'epochNow' | 'current'> = Object.freeze({
  epochNow: (): number => 0,
  current: (): CurrentFleetIdentity => NO_SOURCE,
});
