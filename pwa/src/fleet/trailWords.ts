// A run's trail in words (the runs rebuild, D-8072; spec 2026-11-04 §8.4, F16). Pure (L1): the screen mounts what this
// returns. One row per recorded event, newest first, as time, words and who. Stall observations arrive already folded
// into one row (`RunRecordEvent.folded`) and read as one line: "6 stall checks, 2 to 4 Nov".
import { isRunState, type RunRecordEvent } from '../../../shared/api';
import { RUN_WORD } from './runWords';

/** `causedBy` as the page says it: "you", "ccrc", "the coordinator", and for a session id "a session". */
export function trailBy(by: RunRecordEvent['by']): string {
  if (by === 'operator') return 'you';
  if (by === 'sweep') return 'ccrc';
  if (by === 'coordinator') return 'the coordinator';
  return 'a session';
}

/** "N older events not shown.", or null when the answer holds the whole record. */
export function olderEventsLine(n: number): string | null {
  return n > 0 ? `${n} older events not shown.` : null;
}

const stateWord = (s: string): string => (isRunState(s) ? RUN_WORD[s] : s);

/** The date part of a moment's words: "4 Nov at 15:05" gives "4 Nov". */
const dayOf = (words: string): string => words.split(' at ')[0] ?? words;

/** "2 to 4 Nov" within a month, "30 Oct to 2 Nov" across two, and one day alone when both ends fall on it. */
function spanWords(from: string, until: string): string {
  if (from === until) return from;
  const [fd, ...fm] = from.split(' ');
  const [, ...um] = until.split(' ');
  return fm.join(' ') === um.join(' ') && fd !== undefined ? `${fd} to ${until}` : `${from} to ${until}`;
}

/** One row's words. A folded span carries its own dates, so the row needs no time beside it; every other row is
 *  "from to to", with the stored detail after it, as stored. */
export function trailLine(e: RunRecordEvent, fmt: (ms: number) => string): string {
  if (e.folded !== undefined) {
    return `${e.folded.count} stall checks, ${spanWords(dayOf(fmt(e.at)), dayOf(fmt(e.folded.untilAt)))}`;
  }
  const move = e.from === e.to ? stateWord(e.to) : `${stateWord(e.from)} to ${stateWord(e.to)}`;
  return e.detail === null || e.detail === '' ? move : `${move}: ${e.detail}`;
}
