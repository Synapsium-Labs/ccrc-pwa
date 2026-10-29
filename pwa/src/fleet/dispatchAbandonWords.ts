// D-7319: the Settings card "Dispatches that never came back", its pure half (L1): the wire guard for the switch's view,
// and the card's lines. The words themselves are L0's (`DISPATCH_ABANDON_TEXT`,
// `shared/dispatch-abandon.ts`); nothing here retypes one.
import {
  DISPATCH_ABANDON_TEXT, isDispatchAbandonChoice, type DispatchAbandonChoice, type DispatchAbandonView,
} from '../../../shared/dispatch-abandon';
import { stallDurationText } from '../../../shared/stall-watch';
import { isRecord } from '../lib/wire';

const STORED: readonly DispatchAbandonView['stored'][] = ['on', 'off', 'unknown', 'absent', 'unreadable'];

/** The view, whole, or null: every field the card reads, each of its own type. */
export function asDispatchAbandonView(raw: unknown): DispatchAbandonView | null {
  if (!isRecord(raw)) return null;
  const { stored, detail, armed, boundMs, updatedAt } = raw;
  if (typeof stored !== 'string' || !(STORED as readonly string[]).includes(stored)) return null;
  if (detail !== null && typeof detail !== 'string') return null;
  if (typeof armed !== 'boolean' || typeof boundMs !== 'number' || !Number.isFinite(boundMs)) return null;
  if (updatedAt !== null && (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt))) return null;
  return { stored: stored as DispatchAbandonView['stored'], detail, armed, boundMs, updatedAt };
}

/** The radio the server's answer checks: its stored choice, or neither for a token it does not know, a lost row or an
 *  unreadable one (so either tap can replace it). */
export function dispatchAbandonChecked(view: DispatchAbandonView): DispatchAbandonChoice | null {
  return isDispatchAbandonChoice(view.stored) ? view.stored : null;
}

/** The card's lines under its choice: what stands when the server holds no usable choice, then the bound and the pause. */
export function dispatchAbandonLines(view: DispatchAbandonView): { text: string; tone: 'note' | 'warn' }[] {
  const out: { text: string; tone: 'note' | 'warn' }[] = [];
  if (view.stored === 'unknown') out.push({ text: DISPATCH_ABANDON_TEXT.unknown, tone: 'warn' });
  if (view.stored === 'absent') out.push({ text: DISPATCH_ABANDON_TEXT.absent, tone: 'warn' });
  if (view.stored === 'unreadable') {
    out.push({ text: view.detail === null ? DISPATCH_ABANDON_TEXT.unreadable : `${DISPATCH_ABANDON_TEXT.unreadable} (${view.detail})`, tone: 'warn' });
  }
  out.push({ text: DISPATCH_ABANDON_TEXT.bound(stallDurationText(view.boundMs)), tone: 'note' });
  out.push({ text: DISPATCH_ABANDON_TEXT.pauseNote, tone: 'note' });
  return out;
}
