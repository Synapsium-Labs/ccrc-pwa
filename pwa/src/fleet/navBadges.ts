// The navigation's two counts (W2 Task S4b, D-5471): the feed's unread count and the open runs, ONE function each,
// read by every door that shows one: the fleet head's mail door, Refined's Inbox and Runs tabs, and the shells that
// follow (the plan's "one derived value, one function"). A door that counted for itself could disagree with the
// fleet's own count on the same screen.
import { useSyncExternalStore } from 'react';
import type { FleetSession, NotifyEvent, RunSummary } from '../../../shared/api';
import { ACTIVE_RUN_STATES } from '../../../shared/api';
import { raisesUnread } from '../lib/feed';
import { acksSnapshot, FEED_ACK_KEY, isUnseenAt, subscribeAcks, type Acks } from '../lib/seen';
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

/** The feed's unread count: past the feed's ack, through the SAME comparison the bucket chips use (`isUnseenAt`), and
 *  never an `interrupt` record (`raisesUnread`, D-5431). */
export function unreadMailCount(feed: readonly NotifyEvent[], acks: Acks): number {
  return feed.filter((ev) => raisesUnread(ev) && isUnseenAt(FEED_ACK_KEY, ev.at, acks)).length;
}

/** The runs still open (`isRunClosed`, the split `RunsScreen` and the fleet's runs line use). */
export function openRunCount(runs: readonly RunSummary[]): number {
  return runs.filter((r) => !isRunClosed(r)).length;
}

export interface NavBadges {
  readonly unreadMail: number;
  /** Null until a runs frame has landed: "no runs" and "not heard yet" are different facts. */
  readonly openRuns: number | null;
}

/** The two counts, from the shell's fleet store and the per-device acks. */
export function useNavBadges(): NavBadges {
  const useStore = useFleetChrome().store;
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  const feed = useStore((s) => s.feed);
  const runs = useStore((s) => s.runs);
  const runsFrameSeen = useStore((s) => s.runsFrameSeen);
  return { unreadMail: unreadMailCount(feed, acks), openRuns: runsFrameSeen ? openRunCount(runs) : null };
}
