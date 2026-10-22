// The navigation's two counts (W2 Task S4b, D-5471): the feed's unread count and the open runs, ONE function each,
// read by every door that shows one: the fleet head's mail door, Refined's Inbox and Runs tabs, and the shells that
// follow (the plan's "one derived value, one function"). A door that counted for itself could disagree with the
// fleet's own count on the same screen.
import { useSyncExternalStore } from 'react';
import type { NotifyEvent, RunSummary } from '../../../shared/api';
import { raisesUnread } from '../lib/feed';
import { acksSnapshot, FEED_ACK_KEY, isUnseenAt, subscribeAcks, type Acks } from '../lib/seen';
import { useFleetChrome } from './FleetChrome';
import { isRunClosed } from './runWords';

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
