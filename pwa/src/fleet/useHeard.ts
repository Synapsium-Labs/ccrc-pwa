// useHeard — the fleet rows and runs this console has HEARD, or `null` for each it has not (L4; it reads the store and decides
// nothing). Before a frame lands, `sessions` and `runs` hold the offline snapshot's, which is not a fact the console has
// heard, so a reader handed them would claim a calm it never measured. This is the face's and the ledgers' reader of that
// gate: the Waiting on you routes, the programme's Goals page and the face's mood (`face/useMood.ts`) take their rows and
// runs from here. It is not yet the ONLY reader: `useNavBadges`, the two phone bars and the PR sheet still spell the same
// ternaries. Routing them through this hook is a follow-up (the coordinator carries it).
import type { FleetSession, RunSummary } from '../../../shared/api';
import type { FleetStore } from '../stores/fleet';

export function useHeard(store: FleetStore): { sessions: readonly FleetSession[] | null; runs: readonly RunSummary[] | null } {
  const sessions = store((s) => s.sessions);
  const fleetFrameSeen = store((s) => s.fleetFrameSeen);
  const runs = store((s) => s.runs);
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  return { sessions: fleetFrameSeen ? sessions : null, runs: runsFrameSeen ? runs : null };
}
