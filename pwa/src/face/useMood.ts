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
//   | sessions        | the store's `sessions` once `fleetFrameSeen`, else null                                 |
//   | runs            | the store's `runs` once `runsFrameSeen`, else null                                      |
//   | waitingItems    | `useNavBadges().waitingItems` (its own null rule; never recomputed here)                |
//   | lanes           | the store's `lanes` (already null before the first accounts read)                       |
//   | stallQuietMs    | the store's `stallQuietMs`                                                              |
//   | nowMs           | `Date.now()` at render; one timeout to `next` renders again                             |
//
// The store is the shell's own (`useFleetChrome().store`), the one `useNavBadges` reads, so both agree on a frame.
// Both hooks throw outside `FleetChromeProvider`: every bar renders inside it.
import { useEffect, useState } from 'react';
import type { Mood } from '../../../shared/face';
import { agentDown } from '../fleet/agentLink';
import { useFleetChrome } from '../fleet/FleetChrome';
import { useNavBadges } from '../fleet/navBadges';
import { moodOf } from './mood';

export function useMood(): { mood: Mood; cause: string } {
  const chrome = useFleetChrome();
  const useStore = chrome.store;
  const conn = useStore((s) => s.conn);
  const linkLost = useStore((s) => s.linkLost);
  const sessions = useStore((s) => s.sessions);
  const fleetFrameSeen = useStore((s) => s.fleetFrameSeen);
  const runs = useStore((s) => s.runs);
  const runsFrameSeen = useStore((s) => s.runsFrameSeen);
  const lanes = useStore((s) => s.lanes);
  const stallQuietMs = useStore((s) => s.stallQuietMs);
  const { waitingItems } = useNavBadges();
  const agentIsDown = agentDown(chrome.health);
  const nowMs = Date.now();
  const decided = moodOf({
    conn, linkLost, agentDown: agentIsDown,
    sessions: fleetFrameSeen ? sessions : null,
    runs: runsFrameSeen ? runs : null,
    waitingItems, lanes, stallQuietMs, nowMs,
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
