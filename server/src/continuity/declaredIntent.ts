// Declared coordinator intent, read from the delegation checkpoint (Overlord W1a; the coordinator's rulings F4 on review 2023
// and F2 on review 2024): the ONE reader of that fact, which the card's gatherer and the launch-profile lane both import.
// The checkpoint's `coordinatorIntentByParent` is the authority; the SQLite projection is written after it and can lag it,
// so it is never read for this. Pure: the caller hands in the checkpoint it holds (`FleetWatcher.
// delegationCheckpointIfReady`, null while the lane has none ready) and the session's registry incarnation.
import { delegationIntentKey } from '../coord/delegation-model.js';

/** Declared coordinator intent on one incarnation of a session: true or false when the checkpoint is ready, `not-ready`
 *  when there is none, which a caller never reads as "no intent". */
export function intentOfCheckpoint(cp: { readonly coordinatorIntentByParent: Readonly<Record<string, string>> } | null,
  id: string, incarnation: string): boolean | 'not-ready' {
  return cp === null ? 'not-ready' : Object.hasOwn(cp.coordinatorIntentByParent, delegationIntentKey(id, incarnation));
}
