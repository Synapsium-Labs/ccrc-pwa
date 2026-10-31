// The navigation's counts are what waits on the operator (T2d, D-6330), ONE function each, read by every door that shows
// one: Refined's Inbox and Runs tabs and phone doors, Instrument's rail Inbox door, and the fleet head's mail door
// through FleetScreen (the plan's "one derived value, one function"). A door that counted for itself could disagree with
// the fleet's own count on the same screen. The Inbox's own rows keep their unread mark (`raisesUnread`, D-5431), so
// the door and the rows never claim the same number.
import type { FleetSession, RunSummary } from '../../../shared/api';
import { ACTIVE_RUN_STATES } from '../../../shared/api';
import { useFleetChrome } from './FleetChrome';
import { operatorAsk } from './rollup';
import { isRunClosed, runState } from './runWords';

/** A badge's printed cap, the one definition every badge reads (R32's F1): the accessible name carries the real number. */
export const BADGE_PRINT_CAP = 99;

/** What a badge prints for `n`: the number, or the cap and a plus past it. */
export function badgePrint(n: number): string {
  return n > BADGE_PRINT_CAP ? `${BADGE_PRINT_CAP}+` : String(n);
}

/** What every Inbox door's count says it counts, and what the Runs door's says (T2d, D-6330). */
export const INBOX_BADGE_UNIT = 'waiting for you';
export const RUNS_BADGE_UNIT = 'needs you';

/** The sessions waiting on the operator: `operatorAsk` (rollup.ts, the attention bucket that `fleetSummary.waiting`
 *  counts). A child whose question its coordinator holds reads `working` and is not counted until it is handed to the
 *  operator. `null` sessions (no fleet frame yet: the offline snapshot's rows are not a fact) answers `null`. */
export function waitingOnYou(sessions: readonly FleetSession[] | null): number | null {
  return sessions === null ? null : sessions.filter(operatorAsk).length;
}

/** The open runs (`!isRunClosed`) whose worker (`sessionId`) or coordinator (`claimedBy`) session is `operatorAsk`; no
 *  run state itself waits on the operator (D-6170). A run counts once even when both are waiting. `null` when either
 *  input is `null` (no runs frame, or no fleet frame). Sessions are matched by `FleetSession.id`. */
export function runsNeedYou(runs: readonly RunSummary[] | null, sessions: readonly FleetSession[] | null): number | null {
  if (runs === null || sessions === null) return null;
  const asking = new Set(sessions.filter(operatorAsk).map((s) => s.id));
  const waits = (id: string | null): boolean => id !== null && asking.has(id);
  return runs.filter((r) => !isRunClosed(r) && (waits(r.sessionId) || waits(r.claimedBy))).length;
}

/** The fleet's runs line, after "Runs · ": `—` before the runs frame (`null`), "N active" counting the runs whose state
 *  is in `ACTIVE_RUN_STATES` (dispatched, working, unknown), "N open" when none is active but some are open
 *  (`!isRunClosed`), and "none active" when none is open. */
export function runsLineLabel(runs: readonly Pick<RunSummary, 'state'>[] | null): string {
  if (runs === null) return '—';
  const active = runs.filter((r) => (ACTIVE_RUN_STATES as readonly string[]).includes(runState(r))).length;
  if (active > 0) return `${active} active`;
  const open = runs.filter((r) => !isRunClosed(r)).length;
  return open > 0 ? `${open} open` : 'none active';
}

export interface NavBadges {
  /** The sessions waiting on the operator (`waitingOnYou`); null until the first fleet frame has landed. */
  readonly waiting: number | null;
  /** The open runs that need the operator (`runsNeedYou`); null until a runs frame and a fleet frame have landed: "none"
   *  and "not heard yet" are different facts. */
  readonly runsNeedYou: number | null;
}

/** The two counts, from the shell's fleet store. */
export function useNavBadges(): NavBadges {
  const useStore = useFleetChrome().store;
  const sessions = useStore((s) => s.sessions);
  const fleetFrameSeen = useStore((s) => s.fleetFrameSeen);
  const runs = useStore((s) => s.runs);
  const runsFrameSeen = useStore((s) => s.runsFrameSeen);
  return {
    waiting: waitingOnYou(fleetFrameSeen ? sessions : null),
    runsNeedYou: runsNeedYou(runsFrameSeen ? runs : null, fleetFrameSeen ? sessions : null),
  };
}
