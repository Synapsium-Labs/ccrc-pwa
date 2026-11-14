// useMood — the mood the console's character wears now (the Overlord face plan, Task 8; L4: it reads stores and a clock,
// and decides nothing: `moodOf`, `face/mood.ts`, decides).
//
// ONE READER PER FACT. Each `MoodFacts` field has one source, and nothing here re-derives a fact its owner answers:
//
//   | MoodFacts field | source                                                                                  |
//   |-----------------|-----------------------------------------------------------------------------------------|
//   | conn            | the fleet store's `conn`                                                                |
//   | linkLost        | the fleet store's `linkLost`                                                            |
//   | agentDown       | `agentDown(useFleetChrome().health)`, `fleet/agentLink.ts`; false while health is null      |
//   | sessions        | `useHeard(store).sessions` (`fleet/useHeard.ts`: the store's rows once a frame landed)  |
//   | runs            | `useHeard(store).runs` (the same hook, the same gate)                                    |
//   | waitingItems    | `useNavBadges().waitingItems` (its own null rule; never recomputed here)                |
//   | lanes           | `lanesRead(accountsHeard, lanes)`: unread / not-served / served (`face/mood.ts#LanesRead`) |
//   | stallQuietMs    | the store's `stallQuietMs`                                                              |
//   | nowMs           | `Date.now()` at render; one timeout to `next` renders again                             |
//
// The store is the shell's own (`useFleetChrome().store`), the one `useNavBadges` reads, so both agree on a frame.
// Both hooks throw outside `FleetChromeProvider`: every bar renders inside it.
import { useEffect, useState } from 'react';
import type { Mood } from '../../../shared/face';
import { useHeard } from '../fleet/useHeard';
import { agentDown } from '../fleet/agentLink';
import { useFleetChrome } from '../fleet/FleetChrome';
import { useNavBadges } from '../fleet/navBadges';
import { lanesRead, moodOf } from './mood';

export function useMood(): { mood: Mood; cause: string } {
  const chrome = useFleetChrome();
  const useStore = chrome.store;
  const conn = useStore((s) => s.conn);
  const linkLost = useStore((s) => s.linkLost);
  const { sessions, runs } = useHeard(useStore);
  const accountsHeard = useStore((s) => s.accountsHeard);
  const lanes = useStore((s) => s.lanes);
  const stallQuietMs = useStore((s) => s.stallQuietMs);
  const { waitingItems } = useNavBadges();
  const agentIsDown = agentDown(chrome.health);
  const nowMs = Date.now();
  const decided = moodOf({
    conn, linkLost, agentDown: agentIsDown,
    sessions, runs, waitingItems, lanes: lanesRead(accountsHeard, lanes), stallQuietMs, nowMs,
  });
  const { next } = decided;
  // A window's edge changes the mood with no store change: one timeout to the next edge, then render again, which
  // reads a fresh `nowMs` and so a fresh `next`.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (next === null) return undefined;
    const t = setTimeout(() => { setTick((n) => n + 1); }, Math.max(0, next - Date.now()));
    return () => { clearTimeout(t); };
  }, [next]);
  return { mood: decided.mood, cause: decided.cause };
}
