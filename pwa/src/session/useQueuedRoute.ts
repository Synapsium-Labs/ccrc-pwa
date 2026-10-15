// A ROUTING WRITE IN FLIGHT — the optimistic badge, and the 60-second timer
// that is allowed to give up on it (routing spec §5.3, slice 4, Task 5).
//
// WHY IT IS ITS OWN FILE. `SessionScreen` held three pieces of this (state, a
// timer ref, a manual clear), three effects that each exist only to cancel it
// correctly, and four call sites inside one handler — and every one of its
// comments is about ONE question: when may this badge stop waiting? Together
// they are a timer discipline; scattered down a 654-line screen they read as
// bookkeeping.
//
// THE CARVE-OUTS CAME WITH THE CODE, because each is a measured false toast:
// a timer armed on an unrouted session and left running once `route` rides
// the wire; a timer installed after the `await` and therefore not yet real
// when the read-back lands; a prior pick's handle leaked by a fast second
// tap. Nothing here renders, so the file is `.ts`.
import { useEffect, useRef, useState } from 'react';
import { toast } from '@ccrc/ui';
import type { FleetSession, RouteField } from '../../../shared/api';

/** How long the badge waits for the pane to read a write back before it says
 *  so and stops claiming the write is pending. */
export const QUEUED_ROUTE_MS = 60_000;

export interface QueuedRoute {
  /** The field whose write is still waiting, or `null`. The screen prefers
   *  the WIRE's own answer when `route` rides it; this is the fallback for a
   *  session that record says nothing about yet. */
  field: RouteField | null;
  /** Arm the badge and the timer for a write just sent. */
  arm: (field: RouteField, value: string, readback: string) => void;
  /** Drop the badge and cancel the timer — on a confirmation, a refusal, or a
   *  write whose absence IS the confirmation. */
  clear: () => void;
}

/** @param live the session's live fleet row, which is what reads a write back.
 *  @param routed whether `route` rides the wire for this session. Once it
 *  does, the record is the whole story for every field and this local state
 *  must stop speaking — including any timer already running, which would
 *  otherwise fire a "not confirmed" toast for a write the wire has taken
 *  over. */
export function useQueuedRoute(live: FleetSession | null, routed: boolean): QueuedRoute {
  // `readback` rides along so the agreement effect below never has to
  // re-derive the option list that produced this write.
  const [queued, setQueued] =
    useState<{ field: RouteField; value: string; readback: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const clear = (): void => {
    cancel();
    setQueued(null);
  };
  useEffect(() => cancel, []);

  // The read-back half: a fleet frame that agrees with a queued write clears
  // it (and the timeout that would otherwise clear it at 60s with the
  // unconfirmed toast). `effort` compares the live level directly (or
  // `live.ultracode` for the `ultracode` value, since that is a separate
  // boolean on the wire, not an effort string); `class` compares the queued
  // row's `readback` key against the live model string the same loose way
  // `modelOptions`' own `active` highlight already does.
  useEffect(() => {
    if (queued === null) return;
    const agrees = queued.field === 'effort'
      ? (queued.value === 'ultracode' ? live?.ultracode === true : live?.effort === queued.value)
      : (live?.model ?? '').toLowerCase().includes(queued.readback);
    if (agrees) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, live?.effort, live?.ultracode, live?.model]);

  // Fix wave #4: a tap on a session that had never been routed yet arms the
  // 60s toast, same as always. Once the FIRST routing record for this session
  // lands on any later fleet frame the badge is the wire's, but nothing
  // disarmed that already-running local timer — left alone it fires 60s after
  // the tap and pops a false "not confirmed" toast for a write the wire has
  // since taken over entirely. This clears both the moment `routed` turns on.
  useEffect(() => {
    if (!routed) return;
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routed]);

  return {
    field: queued?.field ?? null,
    arm: (field, value, readback) => {
      setQueued({ field, value, readback });
      timer.current = setTimeout(() => {
        setQueued(null);
        toast('Routing queued; the pane has not confirmed it yet');
      }, QUEUED_ROUTE_MS);
    },
    clear,
  };
}
