// Whether a row is put away, and whether its Restore is Restart's request (D-7573, ARCH-05): the two pure predicates
// the ⋯ menu and the actions sheet gate Archive and Restore by. Moved out of `ArchiveSheet.tsx` so the menu, an L1
// module, reads them without loading a component file; the sheet's `restoreSession` routes by the second one here.
import { inArchivedFold, type FleetSession } from '../../../shared/api';

/** Whether a session is already put away, so its menu and its actions sheet offer Restore where every other session
 *  offers Archive (spec §5.2). Every row the Archived fold holds (`inArchivedFold`, the ONE predicate — never
 *  `archivedAt` or `workspace` alone), plus a `cleanup` row: an archived workspace whose merge keeps it in the live
 *  list (`groupFleet`'s `archived` doc), archived all the same. ONE spelling, two callers. */
export const isPutAway = (s: FleetSession): boolean => inArchivedFold(s) || s.bucket === 'cleanup';

/** Whether this row's Restore is the SAME request as Restart session — `POST /ensure`, which a standing substrate
 *  fault refuses (spec §4): a main checkout. A workspace's Restore is `ws-restore`, a different verb, and stays
 *  ungated. The ONE spelling of that rule: the actions sheet's and the header's Restore gates both read it, and
 *  `ArchiveSheet.tsx#restoreSession` routes by it, so the gate and the route cannot drift. */
export const restoreReachesEnsure = (s: Pick<FleetSession, 'workspace'>): boolean => s.workspace === null;
