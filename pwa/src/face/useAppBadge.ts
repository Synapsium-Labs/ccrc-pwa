// useAppBadge — the count on the installed icon (the Overlord face plan, Task 10; L4: it holds what it last wrote and the
// stopped latch, calls the navigator, and decides nothing: `badgeAct`, `face/badgeAct.ts`, decides).
//
// The count is `useNavBadges().waitingItems`, the one source (never recomputed here). The API is used only when both
// `setAppBadge` and `clearAppBadge` exist. A refusal (a rejection such as `NotAllowedError`, or a synchronous throw) warns
// once and stops the writes for the page's life.
import { useEffect } from 'react';
import { useNavBadges } from '../fleet/navBadges';
import { badgeAct } from './badgeAct';

/** The count last written to the badge; null before any write. Module state: one icon per page. */
let last: number | null = null;
/** Set by the first refusal; nothing is written after it, for the page's life. */
let stopped = false;

/** Test-only: the state of a fresh page. */
export function resetAppBadgeForTests(): void {
  last = null;
  stopped = false;
}

function stop(e: unknown): void {
  if (stopped) return;
  stopped = true;
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.warn(`ccrc: app badge refused: ${detail}`);
}

export function useAppBadge(): void {
  const { waitingItems } = useNavBadges();
  useEffect(() => {
    if (stopped) return;
    const nav = navigator as Navigator & { setAppBadge?: unknown; clearAppBadge?: unknown };
    if (typeof nav.setAppBadge !== 'function' || typeof nav.clearAppBadge !== 'function') return;
    const act = badgeAct(waitingItems, last);
    if (act.kind === 'leave') return;
    try {
      const p = act.kind === 'set'
        ? (nav.setAppBadge as (n: number) => Promise<void>).call(navigator, act.n)
        : (nav.clearAppBadge as () => Promise<void>).call(navigator);
      last = act.kind === 'set' ? act.n : 0;
      void Promise.resolve(p).catch(stop);
    } catch (e) {
      stop(e);
    }
  }, [waitingItems]);
}
