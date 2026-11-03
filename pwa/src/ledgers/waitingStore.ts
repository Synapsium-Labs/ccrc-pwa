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
import { ApiError } from '../lib/apiError';
import { onPageVisible } from '../lib/pageClock';
import type { FleetStore } from '../stores/fleet';
import { isWaitingView } from './waitingView';

type Load = () => Promise<{ readonly ok: true; readonly waiting: WaitingView }>;

/** What one read came to: the list was read and put on the store; this box has no coordination database (the route's own
 *  answer, `not-configured`: no list will ever come); or nothing was read (offline, refused, or an answer that is not a
 *  list), the held list staying. Three conditions a caller treats differently, so three words. */
export type WaitingRead = 'read' | 'not-configured' | 'failed';

async function readOnce(store: FleetStore, load: Load): Promise<WaitingRead> {
  try {
    const answer = await load();
    // The frame's own check, the one `isWaitingView`: a read puts on the store exactly what a frame would.
    if (answer.ok === true && isWaitingView(answer.waiting)) { store.getState().setWaiting(answer.waiting); return 'read'; }
    return 'failed';
  } catch (err) {
    // Unreachable or refused: the held list stays, and the next focus asks again.
    const body: unknown = err instanceof ApiError ? err.body : null;
    return typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'not-configured' ? 'not-configured' : 'failed';
  }
}

/** The read that is on the wire for a store, and the one queued behind it (review 1359 F12d). */
interface Flight { readonly running: Promise<WaitingRead>; next: Promise<WaitingRead> | null }
const flights = new WeakMap<FleetStore, Flight>();

function start(store: FleetStore, load: Load): Promise<WaitingRead> {
  const flight: Flight = { running: readOnce(store, load), next: null };
  flights.set(store, flight);
  void flight.running.then(() => { if (flights.get(store) === flight) flights.delete(store); });
  return flight.running;
}

/** Read the list once and put it on the store. ONE READ IS ON THE WIRE PER STORE AT A TIME: a tab that becomes visible and
 *  focused asks twice, and two reads racing could let the older answer overwrite the newer. `join` is for a caller that
 *  wants a recent list (a focus, a first look): it takes the read on the wire. Without it the caller wants a list read
 *  AFTER now (the re-read after a tick or a dismiss must see the move), so its read starts when the one on the wire has
 *  come back, and every such caller shares that one. */
export function refetchWaiting(store: FleetStore, load: Load = api.waiting, join = false): Promise<WaitingRead> {
  const flight = flights.get(store);
  if (flight === undefined) return start(store, load);
  if (join) return flight.running;
  flight.next ??= flight.running.then(() => start(store, load));
  return flight.next;
}

/** Mount once for the whole shell (beside the other fleet-wide planes): read the list when the tab regains focus or the
 *  page becomes visible. Nothing runs between those moments, so a hidden tab polls nothing. */
export function useWaitingRefetch(store: FleetStore, load: Load = api.waiting): void {
  useEffect(() => {
    const again = (): void => { void refetchWaiting(store, load, true); };
    window.addEventListener('focus', again);
    const stop = onPageVisible(again);
    return () => { window.removeEventListener('focus', again); stop(); };
  }, [store, load]);
}
