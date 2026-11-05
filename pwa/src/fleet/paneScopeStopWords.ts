// D-7902: the Settings card "Stop leftovers", its pure half: the card's words, the ONE reader of the coord frame's
// `paneScopeStop` and the radio that reading checks. `PaneScopeStopSection.tsx` has no words of its own.
import { isMarkerState, type MarkerState } from '../../../shared/api';
import { DISPATCH_ABANDON_TEXT } from '../../../shared/dispatch-abandon';

/** ccd's own vocabulary, as `POST /api/coord/pane-scope-stop` takes it. */
export type PaneScopeStopState = 'live' | 'shadow';

export const PANE_SCOPE_STOP_TEXT = {
  title: 'Stop leftovers',
  purpose: 'When a session is stopped on purpose, what it started in the background keeps running until the sweep finds '
    + 'it hours later. With this on, the stop takes those processes with it.',
  legend: 'When a session is stopped',
  shadow: 'Log only',
  shadowNote: 'Each stop writes what it would have stopped to the swap log on the fleet box, and stops nothing.',
  live: 'Stop what is left',
  liveNote: 'Once the session has exited and ten seconds have passed, what is left in its pane is stopped. A pane that '
    + 'another live session shares is held and stays running.',
  when: 'Turn it on once the swap log\'s "would stop" lines name only what you want gone. A stop, a hibernation, a '
    + 'finished worker and a roll all count; an account swap is not a stop.',
  asked: 'Asked the fleet box; this card changes when the fleet confirms it.',
  unconfirmed: 'The fleet has not confirmed the change yet, so the choice above is the last one it reported.',
  unmeasurable: 'The server could not read the switch, so this card cannot say which choice stands. Choose one to set it.',
  refused: DISPATCH_ABANDON_TEXT.refused,
  unanswered: 'No answer from the server, so the choice may have been saved; this card changes if the fleet confirms it.',
} as const;

/** THE ONE READER of `CoordStatus.paneScopeStop`, `childReclaimMarker`'s posture. Null: the frame carries no such field,
 *  a server older than the switch. A word this build does not know degrades to `unmeasurable`, never to `clear`. */
export function paneScopeStopMarker(coord: unknown): MarkerState | null {
  if (typeof coord !== 'object' || coord === null) return null;
  const v = (coord as { paneScopeStop?: unknown }).paneScopeStop;
  if (v === undefined) return null;
  return isMarkerState(v) ? v : 'unmeasurable';
}

/** The radio the frame's reading checks: neither for a registry it could not list, so either tap can replace it. */
export function paneScopeStopChecked(marker: MarkerState): PaneScopeStopState | null {
  return marker === 'set' ? 'live' : marker === 'clear' ? 'shadow' : null;
}

/** `fleetFailed` carries two answers, and only `stderr` tells them apart. With it, ccd ran and died before moving the
 *  marker. Without it, the route's not-ran arm: its `detail` says the verb went unanswered, so whether the marker moved
 *  is unknown. */
export const isPaneScopeStopNotRan = (body: Readonly<Record<string, unknown>>): boolean =>
  body.error === 'fleetFailed' && typeof body.stderr !== 'string';

/** The answers that prove the verb moved nothing, spelled once. Any other failure proves nothing about the write. */
const PANE_SCOPE_STOP_REFUSALS: readonly unknown[] = ['bad-request', 'unsupported', 'fleetFailed'];
export const isPaneScopeStopRefusal = (body: Readonly<Record<string, unknown>>): boolean =>
  PANE_SCOPE_STOP_REFUSALS.includes(body.error) && !isPaneScopeStopNotRan(body);
