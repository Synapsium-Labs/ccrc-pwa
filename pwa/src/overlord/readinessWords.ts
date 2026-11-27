// The Overlord's readiness word, in the console's words (Overlord W1 home B, Task 4; plan question 5): L1, pure, no store, no
// React, no DOM, no clock (`now` is an argument), no `lib/api.ts`. One row per word of Table 6.4a (`READINESS_WORDS`) with its
// sentence and its status tone, and the deciders that turn one read of the word (`ReadState<ReadinessWire>`) into what the three
// rows draw (the place's part, the Fleet's health row and Waiting on you's head). Nothing unmeasured reads as a value.
//
// The sentences follow Table 6.4a's meanings (`READINESS_WORD_MAP`'s `meaning`), written for the operator. `Record` over
// `ReadinessWord`, so a word without a row is a compile error here, and `overlord-words.test.ts` holds the table total.
//
// WHERE QUESTIONS GO is rendered FROM the wire's `questionsGo` and never decided from the word (plan question 5): W1 always
// answers `operator`, and W3 adds `overlord` for `ready`. A value this build does not know is drawn raw.
import {
  STRAND_CAUSE_MAP, isReadinessWord, isStrandCause, type ReadinessWire, type ReadinessWord,
} from '../../../shared/overlord-readiness';
import { isPlaceableInstant } from '../lib/format';
import type { ReadState } from './readState';

/** The status tone a word is drawn in: `ok` is ready, `dead` is the one word that says it has stopped, `quiet` is a word that
 *  needs nothing from the operator, and `attention` is every word that may. */
export type ReadinessTone = 'ok' | 'quiet' | 'attention' | 'dead';

export interface ReadinessWordRow {
  readonly sentence: string;
  readonly tone: ReadinessTone;
}

/** Table 6.4a, one row per word. */
export const readinessWords: Readonly<Record<ReadinessWord, ReadinessWordRow>> = {
  absent: { sentence: 'No Overlord is bound', tone: 'quiet' },
  off: { sentence: 'The Overlord is switched off', tone: 'quiet' },
  unmeasured: { sentence: 'The Overlord\'s state could not be measured', tone: 'attention' },
  dead: { sentence: 'The Overlord has stopped', tone: 'dead' },
  restarting: { sentence: 'The Overlord is restarting', tone: 'attention' },
  renewing: { sentence: 'The Overlord is renewing its session', tone: 'quiet' },
  degraded: { sentence: 'The Overlord is limited to chat only', tone: 'attention' },
  stranded: { sentence: 'The Overlord cannot run: no account can serve it', tone: 'dead' },
  'dialog-open': { sentence: 'A dialog has been open in the Overlord\'s pane for 30 seconds', tone: 'attention' },
  wedged: { sentence: 'The Overlord looks stuck in a turn', tone: 'attention' },
  deaf: { sentence: 'The Overlord has not picked up your message', tone: 'attention' },
  saturated: { sentence: 'The Overlord\'s inbox is too full to be served in time', tone: 'attention' },
  unproved: { sentence: 'The Overlord has not proved itself since it last left ready', tone: 'quiet' },
  ready: { sentence: 'The Overlord is ready', tone: 'ok' },
};

/** What a word the console does not know says, beside the raw word. */
export const UNKNOWN_WORD_SENTENCE = 'unknown word';
/** What `questionsGo: 'operator'` says. */
export const QUESTIONS_GO_YOU = 'Questions go to you';
/** What a read that could not be taken says: never a value. */
export const READINESS_UNMEASURED = 'unmeasured';
export const READINESS_LOADING = 'Loading…';
export const READINESS_ABSENT = 'No Overlord is bound';

/** A read that could not be taken, in words: it says `unmeasured` and why, never "quiet" or a value. */
export const readinessUnmeasuredWords = (error: string): string =>
  `The Overlord's readiness is ${READINESS_UNMEASURED}: the word could not be read (${error})`;

/** Where questions go, from the wire's own field: `operator` is "you", any other value is drawn raw. */
export function questionsGoWords(questionsGo: string): string {
  return questionsGo === 'operator' ? QUESTIONS_GO_YOU : `Questions go to: ${questionsGo}`;
}

/** A local `HH:MM` for an epoch-milliseconds instant, or a dash for one this build's `Date` cannot place. */
export function clockOf(ms: number): string {
  if (typeof ms !== 'number' || !isPlaceableInstant(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The time left until `until`, in words. */
export function timeLeftWords(until: number, now: number): string {
  const ms = until - now;
  if (!(ms > 0)) return 'due now';
  if (ms < 60_000) return 'under a minute left';
  const min = Math.ceil(ms / 60_000);
  return min < 120 ? `${min} min left` : `${Math.ceil(min / 60)} h left`;
}

/** The words `until` is shown for: `renewing` (the generation's deadline) and `restarting` (the first sighting plus the bound). */
const UNTIL_WORDS: ReadonlySet<string> = new Set(['renewing', 'restarting']);
/** The words whose `why` is the operator's to read. */
const WHY_WORDS: ReadonlySet<string> = new Set(['unmeasured', 'dead']);

/** What the parts draw of one answered word. */
export interface ReadinessLines {
  /** The word as the server sent it: raw, even when the console does not know it. */
  readonly word: string;
  readonly known: boolean;
  readonly sentence: string;
  readonly tone: ReadinessTone;
  /** A clock, `HH:MM`. */
  readonly since: string;
  readonly timeLeft: string | null;
  readonly why: string | null;
  readonly strand: string | null;
  readonly questions: string;
}

export function readinessLines(w: ReadinessWire, now: number): ReadinessLines {
  const word: string = w.word;
  const known = isReadinessWord(word);
  const row = known ? readinessWords[word] : null;
  const cause: string | null = w.strandCause;
  return {
    word,
    known,
    sentence: row === null ? UNKNOWN_WORD_SENTENCE : row.sentence,
    tone: row === null ? 'attention' : row.tone,
    since: clockOf(w.since),
    timeLeft: UNTIL_WORDS.has(word) && typeof w.until === 'number' ? timeLeftWords(w.until, now) : null,
    why: WHY_WORDS.has(word) && typeof w.why === 'string' && w.why.length > 0 ? w.why : null,
    strand: word === 'stranded' && cause !== null ? (isStrandCause(cause) ? STRAND_CAUSE_MAP[cause] : cause) : null,
    questions: questionsGoWords(w.questionsGo),
  };
}

/** One read of the word, as the parts draw it. `answered` carries a `lastRead` clock only for a stale read. */
export type ReadinessView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unmeasured'; readonly error: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'answered'; readonly lines: ReadinessLines; readonly lastRead: string | null };

export function readinessViewOf(read: ReadState<ReadinessWire>, now: number): ReadinessView {
  switch (read.state) {
    case 'loading': return { kind: 'loading' };
    case 'unmeasured': return { kind: 'unmeasured', error: read.error };
    case 'absent': return { kind: 'absent' };
    case 'answered': return { kind: 'answered', lines: readinessLines(read.value, now), lastRead: null };
    case 'stale': return { kind: 'answered', lines: readinessLines(read.value, now), lastRead: `last read ${clockOf(read.at)}` };
  }
}

/** The one-line form, for the Fleet's health row and Waiting on you's head: null when nothing is drawn (still loading, an older
 *  server, or the word `absent`: no Overlord is bound). A failed read says `unmeasured`, never a value. */
export function readinessOneLine(view: ReadinessView): string | null {
  switch (view.kind) {
    case 'loading':
    case 'absent': return null;
    case 'unmeasured': return readinessUnmeasuredWords(view.error);
    case 'answered': {
      const l = view.lines;
      if (l.word === 'absent') return null;
      // A word this build does not know is drawn raw, beside "unknown word".
      const parts = [l.known ? l.sentence : `${l.word} (${l.sentence})`, `since ${l.since}`, l.questions];
      if (view.lastRead !== null) parts.push(view.lastRead);
      return parts.join(' · ');
    }
  }
}
