// The Waiting on you list's reader (desktop-polish PL5a, D-7712; ring L4: a hook and a store write).
//
// The list itself lives on the fleet store (`waiting`, set by the `waiting` frame: `stores/fleet.ts`'s parse and apply, the
// model being the `delegation` frame), so every screen and the navigation badge read ONE value. This file adds the one
// thing a frame cannot do: the server re-sends the frame only when the fleet changes, so a quiet fleet sends nothing when
// an item crosses its 30 minutes, or when a coordinator confirms one while this tab sleeps (review 1336). `GET
// /api/waiting` is read again whenever the tab regains focus or the page becomes visible. A failed read leaves the held
// view alone: an offline tab keeps the last list it heard, never an empty one.
import { useEffect } from 'react';
import type { WaitingView } from '../../../shared/ledgers';
import { api } from '../lib/api';
import { onPageVisible } from '../lib/pageClock';
import type { FleetStore } from '../stores/fleet';

type Load = () => Promise<{ readonly ok: true; readonly waiting: WaitingView }>;

/** Read the list once and put it on the store; a failure changes nothing. */
export async function refetchWaiting(store: FleetStore, load: Load = api.waiting): Promise<void> {
  try {
    const answer = await load();
    if (answer.ok === true && Array.isArray(answer.waiting?.items)) store.getState().setWaiting(answer.waiting);
  } catch {
    // Unreachable or refused: the held list stays, and the next focus asks again.
  }
}

/** Mount once for the whole shell (beside the other fleet-wide planes): read the list when the tab regains focus or the
 *  page becomes visible. Nothing runs between those moments, so a hidden tab polls nothing. */
export function useWaitingRefetch(store: FleetStore, load: Load = api.waiting): void {
  useEffect(() => {
    const again = (): void => { void refetchWaiting(store, load); };
    window.addEventListener('focus', again);
    const stop = onPageVisible(again);
    return () => { window.removeEventListener('focus', again); stop(); };
  }, [store, load]);
}
