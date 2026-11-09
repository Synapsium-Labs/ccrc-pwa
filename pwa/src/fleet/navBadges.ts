// The navigation's counts are what waits on the operator (T2d, D-6330), ONE function each, read by every door that shows
// one through `placeBadge`: Refined's desk tabs, Instrument's top bar doors and the phone's bottom bar (the plan's "one derived value,
// one function"; desktop-polish PL10, D-7952, which retired the fleet head's mail door). A door that counted for itself could disagree with
// the fleet's own count on the same screen. The Inbox's own rows keep their unread mark (`raisesUnread`, D-5431), so
// the door and the rows never claim the same number.
import type { FleetSession, RunSummary } from '../../../shared/api';
import { ACTIVE_RUN_STATES } from '../../../shared/api';
import type { WaitingView } from '../../../shared/ledgers';
import { needsYou, needsYouCount, runsNeedingYou } from '../ledgers/needsYou';
import { useFleetChrome } from './FleetChrome';
import { operatorAsk } from './rollup';
import { isRunClosed, runState } from './runWords';

/** A badge's printed cap, the one definition every badge reads (R32's F1): the accessible name carries the real number. */
export const BADGE_PRINT_CAP = 99;

/** What a badge prints for `n`: the number, or the cap and a plus past it.
 *
 *  By design, in all three skins (Instrument's top bar, Refined's tabs, the phone bar): at a count of 100 or more the pill
 *  prints "99+" while the door's accessible name carries the real count ("Runs, 120 needs you"), so a pill never grows past
 *  three characters and the name stays exact. Label in name is then read on the door's word, not on its pill: the word
 *  is in the name and the printed "99" is not, and the label-in-name cases of each skin pin exactly that (review 1643 F5;
 *  desktop-polish Task C14, D-8110). */
export function badgePrint(n: number): string {
  return n > BADGE_PRINT_CAP ? `${BADGE_PRINT_CAP}+` : String(n);
}

/** What every Inbox door's count says it counts, and what the Runs door's says (T2d, D-6330). */
export const INBOX_BADGE_UNIT = 'waiting for you';
export const RUNS_BADGE_UNIT = 'needs you';
/** What the Waiting on you door's count says it counts (desktop-polish PL5a). */
export const WAITING_BADGE_UNIT = 'waiting on you';

/** The sessions waiting on the operator: `operatorAsk` (rollup.ts, the attention bucket that `fleetSummary.waiting`
 *  counts). A child whose question its coordinator holds reads `working` and is not counted until it is handed to the
 *  operator. `null` sessions (no fleet frame yet: the offline snapshot's rows are not a fact) answers `null`. */
export function waitingOnYou(sessions: readonly FleetSession[] | null): number | null {
  return sessions === null ? null : sessions.filter(operatorAsk).length;
}

/** The open runs that need the operator: each run once, read off the one needs-you source
 *  (`runsNeedingYou`, D-8075): a session asking (`operatorAsk`) counts its OPEN bound run and every open run it claims.
 *  No run state itself waits on the operator (D-6170). A recycled worker id whose binding names another run counts
 *  nothing (D-8049). `null` when either input is `null` (no runs frame, or no fleet frame). */
export function runsNeedYou(runs: readonly RunSummary[] | null, sessions: readonly FleetSession[] | null): number | null {
  if (runs === null || sessions === null) return null;
  return runsNeedingYou(sessions, runs);
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

/** What the Waiting on you door counts (PL5a, spec §2): the open items (sent-back ones are open again) plus the sessions
 *  asking a question; an item being checked is the coordinator's and does not count. `null` before the waiting frame or
 *  before the fleet frame: "not heard yet" is not zero. `runs` may be `null` (no runs frame yet): a question's programme is
 *  then unknown, which changes no count. */
export function waitingItemsCount(
  view: WaitingView | null, sessions: readonly FleetSession[] | null, runs: readonly RunSummary[] | null,
): number | null {
  if (view === null || sessions === null) return null;
  return needsYouCount(needsYou(view.items, sessions, runs ?? []));
}

export interface NavBadges {
  /** The sessions waiting on the operator (`waitingOnYou`); null until the first fleet frame has landed. */
  readonly waiting: number | null;
  /** The open runs that need the operator (`runsNeedYou`); null until a runs frame and a fleet frame have landed: "none"
   *  and "not heard yet" are different facts. */
  readonly runsNeedYou: number | null;
  /** The Waiting on you door's count (`waitingItemsCount`); null until the waiting frame and a fleet frame have landed. */
  readonly waitingItems: number | null;
}

/** A place's badge (`lib/places.ts`): its count and the word its accessible name says after the count ("Inbox, 2 waiting
 *  for you"). The one decision of which place counts what, read by Refined's desk bar, Instrument's top bar doors and the
 *  phone's bottom bar (desktop-polish PL10, D-7952; review 1466 F4); a place that counts nothing, or a count not heard yet, answers 0. */
export function placeBadge(id: string, badges: NavBadges): { count: number; word: string } {
  if (id === 'inbox') return { count: badges.waiting ?? 0, word: INBOX_BADGE_UNIT };
  if (id === 'runs') return { count: badges.runsNeedYou ?? 0, word: RUNS_BADGE_UNIT };
  if (id === 'waiting') return { count: badges.waitingItems ?? 0, word: WAITING_BADGE_UNIT };
  return { count: 0, word: '' };
}

/** The three counts, from the shell's fleet store. */
export function useNavBadges(): NavBadges {
  const useStore = useFleetChrome().store;
  const sessions = useStore((s) => s.sessions);
  const fleetFrameSeen = useStore((s) => s.fleetFrameSeen);
  const runs = useStore((s) => s.runs);
  const runsFrameSeen = useStore((s) => s.runsFrameSeen);
  const waiting = useStore((s) => s.waiting);
  return {
    waiting: waitingOnYou(fleetFrameSeen ? sessions : null),
    runsNeedYou: runsNeedYou(runsFrameSeen ? runs : null, fleetFrameSeen ? sessions : null),
    waitingItems: waitingItemsCount(waiting, fleetFrameSeen ? sessions : null, runsFrameSeen ? runs : null),
  };
}
