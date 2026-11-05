// D-7994: the Settings card "Leftover processes", its pure half: the card's words, the wire guard for the switches' view
// and the radio it checks. `ScopeSweepSection.tsx` has no words of its own.
import { isMarkerState } from '../../../shared/api';
import type { ScopeSweepView } from '../../../shared/scope-sweep';
import { isRecord } from '../lib/wire';
import { VERB_WRITE_TEXT } from './verbWriteFailure';

/** The busy arm's two choices, as the card's radios spell them; `POST /api/coord/scope-sweep` takes `{on}`. */
export type ScopeSweepBusyChoice = 'off' | 'on';

export const SCOPE_SWEEP_TEXT = {
  title: 'Leftover processes',
  purpose: 'What happens to the processes a session leaves running after its pane is gone. The fleet box checks every '
    + 'minute, and stops the leftovers of at most three panes a minute.',
  idleLead: 'Idle leftovers',
  idleOn: 'Stopped after six hours.',
  idleOff: 'Recorded only. Nothing is stopped.',
  idleUnread: 'Could not be read.',
  legend: 'Busy leftovers',
  off: 'Record only',
  offNote: 'Loops and servers left by a dead session are listed by ccrc doctor, with what would be stopped. Nothing is stopped.',
  on: 'Stop them',
  onNote: 'Busy leftovers are stopped once their session has been stopped or gone for six hours. A session that is running '
    + 'or asleep is left alone. So is a leftover with an outside connection over loopback TCP, or one that accepted a client '
    + 'on a named Unix socket. Any other connection, including its own as a client of a Unix socket, is not seen, and the '
    + 'stop cuts it.',
  when: 'Read the scope-sweep lines in ccrc doctor for about a week before turning this on.',
  needsIdle: 'This has no effect until idle leftovers are being stopped.',
  unmeasured: 'The server could not read the switches, so this card cannot say which choice stands. Choose one to set it.',
  unread: 'This could not be read.',
  stale: 'This may be out of date: the last read failed.',
  ...VERB_WRITE_TEXT,
} as const;

/** The view, whole, or null: both switches, each a marker state. */
export function asScopeSweepView(raw: unknown): ScopeSweepView | null {
  if (!isRecord(raw)) return null;
  const { stop, busy } = raw;
  return isMarkerState(stop) && isMarkerState(busy) ? { stop, busy } : null;
}

/** The radio the server's answer checks: neither for a registry it could not list, so either tap can replace it. */
export function scopeSweepChecked(view: ScopeSweepView): ScopeSweepBusyChoice | null {
  return view.busy === 'set' ? 'on' : view.busy === 'clear' ? 'off' : null;
}

/** The idle switch's line: it has no control here (`scope-sweep-live` has no writer), so this sentence is all of it. */
export function scopeSweepIdleLine(view: ScopeSweepView): string {
  const T = SCOPE_SWEEP_TEXT;
  const state = view.stop === 'set' ? T.idleOn : view.stop === 'clear' ? T.idleOff : T.idleUnread;
  return `${T.idleLead}: ${state}`;
}

/** Whether a switch could not be read, so the card cannot say what stands. */
export const scopeSweepUnmeasured = (view: ScopeSweepView): boolean =>
  view.busy === 'unmeasurable' || view.stop === 'unmeasurable';
