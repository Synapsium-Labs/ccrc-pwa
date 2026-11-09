// The words and the reader for "Calls made for you" (D-8126; ring L1: no fetch, no store, no component). A call is a
// decision a coordinator made on the operator's behalf and recorded; the console shows the big ones under their
// programme, lets the operator mark one Seen or Overturn it, and never counts one as blocking.
import type { CallView } from '../../../shared/api';
import type { WaitingView } from '../../../shared/ledgers';
import { LEDGER_REFUSAL_TEXT, refusalText } from '../lib/refusalWords';
import { ageWords } from './ledgerWords';

export const OVERTURN_WORD = 'Overturn…';
export const SEEN_WORD = 'Seen';

/** The collapsed group's heading. */
export const CALLS_GROUP_WORDS = (n: number): string => `Calls made for you (${n})`;

/** One programme's calls from the waiting view: those still to see, and those that left the group inside the cleared
 *  window. An older server omits both fields; each then reads as none. */
export function callsOf(view: WaitingView, program: string): { open: CallView[]; cleared: CallView[] } {
  return {
    open: (view.calls ?? []).filter((c) => c.program === program),
    cleared: (view.callsCleared ?? []).filter((c) => c.program === program),
  };
}

/** The line of one call: the question (when it asked one), the option chosen, the reason, and the age. */
export function callLine(c: CallView, now: number): string {
  const parts: string[] = [];
  if (c.question !== null && c.question !== '') parts.push(c.question);
  parts.push(`Chose: ${c.chosen}`);
  if (c.why !== '') parts.push(`Because: ${c.why}`);
  parts.push(ageWords(c.at, now));
  return parts.join(' · ');
}

/** The refusals of the Seen door and of a correction on a call, in the operator's words. Declared a `Record` over its
 *  keys so a code cannot lose its sentence. */
export type CallRefusal = 'not-coordinator' | 'duplicate' | 'not-big';
export const CALL_REFUSAL_TEXT: Readonly<Record<CallRefusal, string>> = {
  'not-coordinator': 'No coordinator decided this call, so there is no one to correct.',
  'duplicate': 'Your last correction on this call has not been read yet.',
  'not-big': LEDGER_REFUSAL_TEXT['not-big'],
};

/** A refusal in words, or `null` for one this table does not own. */
export const callRefusalText = (err: unknown): string | null => refusalText(err, CALL_REFUSAL_TEXT);
