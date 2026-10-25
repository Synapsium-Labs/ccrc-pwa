// The tick's one registry listing, as a value (D-5864; ARCH-51 #786; consolidation spec K13's listing half). `tick`
// lists the registry once (`readRegistryMeasured`), builds this model from that read, and hands it to the lanes that
// choose their rows from the registry, so a steady tick lists once for selection instead of once per lane. A lane
// that ACTS reads again: an executor's late read, the mail lane's fail-shut switch read, the divergence census's
// listing taken after git's records. Those stay fresh and are named in the census (`registryListingSites`).
//
// L1, pure: no clock and no I/O. The model IS the read it was built from (its `listed` arm, `records`, `names` and
// `refused` are that read's, the same objects), plus what the listing says of every marker switch. An unlistable
// registry is `listed: false` with every switch `'unmeasurable'`; each lane keeps its own mapping of that arm (the
// task lane retains, the mail lane fails shut), so nothing here resolves it.
import type { RegistryRead } from './registry.js';
import { readSwitches, type SwitchReading } from '../../shared/switches.js';

export type FleetReadModel = RegistryRead & { readonly switches: SwitchReading };

/** The model of one registry read: the read itself and `readSwitches` over its names (`null` when it did not list). */
export function buildFleetReadModel(read: RegistryRead): FleetReadModel {
  return { ...read, switches: readSwitches(read.listed ? read.names : null) };
}
