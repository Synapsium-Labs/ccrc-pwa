// L4 delivery: the fleet list's doors, as module constants (C9, D-6441): one function each, so a memo'd row or card is
// handed the same callback on every render. Both skins' lists import them: Refined's `FleetScreen` and Instrument's
// `FleetTable` open a session through the one `openSession`, never two copies.
import { navigate } from '../lib/router';
import { runPath, sessionPath } from '../lib/routes';

/** Open a session's page. */
export const openSession = (id: string): void => navigate(sessionPath(id));

const runDoors = new Map<number, () => void>();

/** A row's hold-reason door: the page of the run the session is bound to (`runPath`, the runs rebuild, D-8072). One
 *  function per run, kept, so a memo'd line handed the door of the same run is handed the same callback on every render. */
export function openRunAt(id: number): () => void {
  let door = runDoors.get(id);
  if (door === undefined) {
    door = () => navigate(runPath(id));
    runDoors.set(id, door);
  }
  return door;
}
