// A MARKER SWITCH, and the one behaviour both of them have.
//
// WHY IT IS ITS OWN FILE. `CoordBanner` and `ChildReclaimBanner` each hold a
// switch over a FILE on the fleet box, and `ChildReclaimBanner`'s own header
// says so out loud: "`CoordBanner`'s shape, deliberately, because an operator
// reading two switches in one place must not have to learn two behaviours."
// That sentence is a REQUEST that the next copy also be a copy. What was
// actually copied is seventy lines of state machine — `phase`, the wanted-ref,
// the timer, the settle effect, the give-up arm, the failure arm and three of
// the four label arms — byte for byte, which no census on this branch could
// see: there is no markup in it and no stylesheet rule.
//
// THE BEHAVIOUR, stated once because it is one behaviour:
//
//   • THE TAP IS NOT OPTIMISTIC. It moves the button's own label and nothing
//     else. The switch settles only when a LATER frame reports the value the
//     tap asked for; a frame that arrives still disagreeing changes nothing.
//   • `COORD_CONFIRM_MS` BOUNDS THE WAIT with an honest `unconfirmed`, and
//     only if THIS tap is still the outstanding one — a later tap, or an
//     already-landed confirmation, owns the phase by then.
//   • A FAILED WRITE DROPS STRAIGHT BACK TO IDLE. There is nothing left to
//     wait for, so sitting in `pausing…` until a timeout that was never going
//     to resolve would be a second lie after the first.
//   • A NEW MARKER VALUE RETIRES AN INLINE REFUSAL. The refusal describes the
//     tap that produced it, and a fresh reading of the very thing it was about
//     is what ends it — keyed on the marker's own VALUE, never on the frame
//     that carried it, because one `coord` frame carries both switches' facts
//     plus an attention list that ticks on its own.
//   • A 501 or 502 renders INLINE (`inlinePauseError`); anything else goes to
//     the ordinary toast.
import { useEffect, useRef, useState } from 'react';
import { toast } from '@ccrc/ui';
import type { MarkerState } from '../../../shared/api';
import { apiErrorText } from '../lib/api';
import { COORD_CONFIRM_MS } from './coordWords';
import { inlinePauseError } from './CoordBanner';

export type TogglePhase = 'idle' | 'pausing' | 'resuming' | 'unconfirmed';

export interface MarkerToggle {
  phase: TogglePhase;
  /** A write is in flight and unconfirmed — the button is disabled. */
  busy: boolean;
  /** The inline refusal, or null. */
  error: string | null;
  /** The button's text. The three non-resting arms are this switch's own
   *  vocabulary and live here; the resting pair is the ROW's copy, because
   *  "Pause" and "Pause cleanup" are two different sentences about two
   *  different things. */
  label: (resting: { set: string; clear: string }) => string;
  toggle: () => void;
}

/** @param marker this row's own reading, already narrowed from the frame.
 *  `null` is a server that predates the field; the caller renders nothing for
 *  it and this hook never settles.
 *  @param write the POST. `true` sets the marker, `false` clears it — each
 *  caller adapts its own route's spelling (`boolean`, `'on' | 'off'`). */
export function useMarkerToggle(
  marker: MarkerState | null,
  write: (set: boolean) => Promise<void>,
): MarkerToggle {
  const [phase, setPhase] = useState<TogglePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  // The marker value that would CONFIRM the outstanding tap — 'set' for a
  // pause, 'clear' for a resume — or null when nothing is outstanding. A ref,
  // not state: it is read inside the timer callback and the settle effect
  // below, never rendered itself.
  const wantedRef = useRef<MarkerState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    setError(null);
    if (wantedRef.current !== null && marker === wantedRef.current) {
      wantedRef.current = null;
      clearTimer();
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker]);

  useEffect(() => () => clearTimer(), []);

  const toggle = (): void => {
    setError(null);
    const wantSet = marker !== 'set';
    const wanted: MarkerState = wantSet ? 'set' : 'clear';
    wantedRef.current = wanted;
    setPhase(wantSet ? 'pausing' : 'resuming');
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (wantedRef.current === wanted) setPhase('unconfirmed');
    }, COORD_CONFIRM_MS);

    write(wantSet).catch((err: unknown) => {
      wantedRef.current = null;
      clearTimer();
      setPhase('idle');
      const inline = inlinePauseError(err);
      if (inline !== null) { setError(inline); return; }
      toast(apiErrorText(err), 'error');
    });
  };

  return {
    phase,
    busy: phase === 'pausing' || phase === 'resuming',
    error,
    label: (resting) =>
      phase === 'pausing' ? 'pausing…'
      : phase === 'resuming' ? 'resuming…'
      : phase === 'unconfirmed' ? 'unconfirmed — check /runs'
      : marker === 'set' ? resting.set : resting.clear,
    toggle,
  };
}
