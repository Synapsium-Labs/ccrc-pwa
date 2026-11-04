// D-7994: the Settings card "Leftover processes", its pure half (L1): the wire guard for the switches' view and the radio
// it checks. The words themselves are L0's (`SCOPE_SWEEP_TEXT`, `shared/scope-sweep.ts`); nothing here retypes one.
import { isMarkerState } from '../../../shared/api';
import { SCOPE_SWEEP_TEXT, type ScopeSweepBusyChoice, type ScopeSweepView } from '../../../shared/scope-sweep';
import { isRecord } from '../lib/wire';

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

/** The lines under the choice: what the switches mean together, when they say something the radios do not. */
export function scopeSweepLines(view: ScopeSweepView): { text: string; tone: 'note' | 'warn' }[] {
  const T = SCOPE_SWEEP_TEXT;
  if (view.busy === 'unmeasurable' || view.stop === 'unmeasurable') return [{ text: T.unmeasured, tone: 'warn' }];
  if (view.busy === 'set' && view.stop === 'clear') return [{ text: T.needsIdle, tone: 'warn' }];
  return view.busy === 'clear' ? [{ text: T.when, tone: 'note' }] : [];
}
