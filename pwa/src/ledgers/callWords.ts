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

/** One programme's calls still to see, from the waiting view. An older server omits the field, which reads as none. */
export function openCallsOf(view: WaitingView, program: string): CallView[] {
  return (view.calls ?? []).filter((c) => c.program === program);
}

/** The list's filter as the calls read it: the sessions in no programme (which hold no calls), one programme, or every one. */
export interface CallFilter { readonly noProgramme: boolean; readonly programme: string | null }

/** The programmes that draw their calls apart (review 2792 F7): those with calls still to see and no row of their own, each
 *  once, in the order its first call is listed, under the filter that shows them. A call never makes a group on the rows'
 *  account. */
export function callsApartOf(view: WaitingView, rowPrograms: readonly (string | null)[], filter: CallFilter): string[] {
  if (filter.noProgramme) return [];
  return [...new Set((view.calls ?? []).map((c) => c.program))]
    .filter((p) => !rowPrograms.includes(p) && (filter.programme === null || filter.programme === p));
}

/** The cleared calls the Recently cleared trail is given under the filter (review 2792 F7). */
export function clearedCallsOf(view: WaitingView, filter: CallFilter): CallView[] {
  if (filter.noProgramme) return [];
  return (view.callsCleared ?? []).filter((c) => filter.programme === null || c.program === filter.programme);
}

/** What a call's address (`?call=<id>`, D-8808, D-8809) names on the list: the call still to see (`open`), the call on the
 *  Recently cleared trail (`cleared`), or neither (`gone`: a call addressed by a link was a real call, so one in neither list has
 *  left the 48-hour trail). An older view with no `calls` fields reads as `gone`. */
export type CallTarget = { at: 'open'; call: CallView } | { at: 'cleared'; call: CallView } | { at: 'gone' };

export function callTargetOf(view: WaitingView, id: number): CallTarget {
  const open = (view.calls ?? []).find((c) => c.id === id);
  if (open !== undefined) return { at: 'open', call: open };
  const cleared = (view.callsCleared ?? []).find((c) => c.id === id);
  return cleared !== undefined ? { at: 'cleared', call: cleared } : { at: 'gone' };
}

/** The one-line notices over the list for a call whose address is not an open call (D-8808). */
export const CALL_TARGET_WORDS = {
  cleared: 'That call has cleared. It is marked below, in Recently cleared.',
  gone: 'That call has cleared and is no longer on this list.',
} as const;

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
export type CallRefusal = 'not-coordinator' | 'duplicate' | 'not-big' | 'unknown-call';
export const CALL_REFUSAL_TEXT: Readonly<Record<CallRefusal, string>> = {
  'not-coordinator': 'No coordinator decided this call, so there is no one to correct.',
  'duplicate': 'Your last correction on this call has not been read yet.',
  'not-big': LEDGER_REFUSAL_TEXT['not-big'],
  // The Seen door and the correction both answer it for a call the server no longer holds.
  'unknown-call': 'The server has no such call any more. The list will update.',
};

/** A refusal in words, or `null` for one this table does not own. */
export const callRefusalText = (err: unknown): string | null => refusalText(err, CALL_REFUSAL_TEXT);
