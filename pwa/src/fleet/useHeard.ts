// useHeard — the fleet rows and runs this console has HEARD, or `null` for each it has not (L4; it reads the store and decides
// nothing). Before a frame lands, `sessions` and `runs` hold the offline snapshot's, which is not a fact the console has
// heard, so a reader handed them would claim a calm it never measured. The flags are sticky: once a frame landed, a lost
// link leaves its rows heard (the last the console heard), so the three states are not heard yet (null), heard and link
// lost (both the rows). This is the one rule, and every surface that asks "heard yet?" asks it here: the Waiting on you
// routes, the programme's Goals page, the face's mood (`face/useMood.ts`), the navigation's counts (`useNavBadges`),
// Instrument's status bar, Refined's phone header, the PR sheet, the programme box's Spec link and waiting chip, the fleet
// screen's runs line, the mail screen's Lift cap door, the run page's Resume and the runs board. A census
// (`test/use-heard.test.tsx`) refuses a hand-written gate on either frame flag anywhere else, and lists no holder.
//
// One subscription per half: each half is one selector that answers the rows or null, so a surface that reads only the
// runs (`useHeardRuns`) is not rendered again by a fleet frame, and none subscribes to a flag and its rows separately. A
// surface that shows a primitive computed from the heard rows (the programme box's waiting count and Spec link) calls the
// pickers, `heardSessions` and `heardRuns`, inside its own one selector instead, so it is rendered again only when that
// primitive changes, never by a frame that changes nothing it shows.
import type { FleetSession, RunSummary } from '../../../shared/api';
import type { FleetStore } from '../stores/fleet';

/** The fleet's rows once a fleet frame has landed, else null: the rule, for a selector. */
export function heardSessions(s: { fleetFrameSeen: boolean; sessions: readonly FleetSession[] }): readonly FleetSession[] | null {
  return s.fleetFrameSeen ? s.sessions : null;
}

/** The runs once a runs frame has landed, else null: the rule, for a selector. */
export function heardRuns(s: { runsFrameSeen: boolean; runs: readonly RunSummary[] }): readonly RunSummary[] | null {
  return s.runsFrameSeen ? s.runs : null;
}

/** The fleet's rows once a fleet frame has landed, else null. */
export function useHeardSessions(store: FleetStore): readonly FleetSession[] | null {
  return store(heardSessions);
}

/** The runs once a runs frame has landed, else null. */
export function useHeardRuns(store: FleetStore): readonly RunSummary[] | null {
  return store(heardRuns);
}

export function useHeard(store: FleetStore): { sessions: readonly FleetSession[] | null; runs: readonly RunSummary[] | null } {
  return { sessions: useHeardSessions(store), runs: useHeardRuns(store) };
}
