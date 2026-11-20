// What the programme page does with each answer of the plan read, decided once (programme work map WM4, D-8823; spec 2026-11-16
// §5.1: "the programme page, not the card, keeps the view it last drew and says the read failed"; review 2268 F15). Ring L1: pure,
// no store, no route, no component; `useWorkRead` (L4) holds the state and calls these.
//
// FIVE CONDITIONS, NONE FOLDED INTO ANOTHER: nothing read yet (no card), a view, an absent `work` (an older server: no card), an
// unreadable `work` (the server's own word, over the last view) and a failed read (the refusal's word, over the last view). A
// failed read and an unreadable work KEEP the last view and the time of the last good read, so the source line never calls an old
// view fresh; a good read replaces both. An absent `work` drops the held view: an older server draws no card.
import type { RunSummary } from '../../../shared/api';
import type { WaitingView } from '../../../shared/ledgers';
import type { WorkMapView, WorkUnreadable } from '../../../shared/plan';
import { isOneOf, isRecord } from '../lib/wire';
import { UNREADABLE_WORDS, type WorkCardAnswer } from './workMapWords';

/** What the last read came to, beside the programme it was for and the view the page last drew. */
export interface WorkRead {
  readonly slug: string;
  /** The last `WorkMapView` a good read drew for this programme, or null when none has been. */
  readonly last: WorkMapView | null;
  /** When that view was read; the source line's clock. Meaningless while `last` is null. */
  readonly at: number;
  readonly outcome:
    | { readonly kind: 'view' }
    | { readonly kind: 'absent' }
    | { readonly kind: 'unreadable'; readonly why: WorkUnreadable }
    | { readonly kind: 'failed'; readonly word: string };
}

/** One event of the read: an answer that arrived, or the word a failed read gave. */
export type WorkReadEvent = { readonly answer: unknown } | { readonly failed: string };


/** The word of a refused or odd answer: its `error` when it has one. */
const WORD_UNREADABLE_ANSWER = 'unreadable answer';
const wordOf = (answer: unknown): string =>
  isRecord(answer) && typeof answer.error === 'string' && answer.error !== '' ? answer.error : WORD_UNREADABLE_ANSWER;

/** A view the card can draw: every list it walks is a list, and `counts` is an object. An answer that is anything less (a partial object from a
 *  newer or broken server) is a failed read, never a render that throws (review 2922 F3). */
const VIEW_LISTS = ['items', 'phases', 'notInPhase', 'epics', 'initiatives', 'doneWhen'] as const;
const isViewShape = (v: unknown): v is WorkMapView => isRecord(v) && isRecord(v.counts) && VIEW_LISTS.every((k) => Array.isArray(v[k]));

/** The state after an event. A state held for another programme is not carried into this one's read. */
export function workReadNext(prev: WorkRead | null, slug: string, event: WorkReadEvent, now: number): WorkRead {
  const held = prev !== null && prev.slug === slug ? prev : null;
  const last = held?.last ?? null;
  const at = held?.at ?? now;
  const failed = (word: string): WorkRead => ({ slug, last, at, outcome: { kind: 'failed', word } });
  if ('failed' in event) return failed(event.failed);
  const answer = event.answer;
  if (!isRecord(answer) || answer.ok !== true) return failed(wordOf(answer));
  const work = answer.work;
  if (work === undefined) return { slug, last: null, at: now, outcome: { kind: 'absent' } };
  if (isRecord(work) && isOneOf(UNREADABLE_WORDS, work.unreadable)) return { slug, last, at, outcome: { kind: 'unreadable', why: work.unreadable } };
  if (isViewShape(work)) return { slug, last: work, at: now, outcome: { kind: 'view' } };
  return failed(WORD_UNREADABLE_ANSWER);
}

/** What the page hands the card: its answer and the time the view it holds was read, or null when no card is drawn (nothing read
 *  yet, an absent `work`, or a state held for another programme). */
export function workCardOf(read: WorkRead | null, slug: string): { answer: WorkCardAnswer; readAt: number } | null {
  if (read === null || read.slug !== slug) return null;
  const o = read.outcome;
  switch (o.kind) {
    case 'absent': return null;
    case 'view': return read.last === null ? null : { answer: read.last, readAt: read.at };
    case 'unreadable': return { answer: { unreadable: o.why, last: read.last }, readAt: read.at };
    case 'failed': return { answer: { readFailed: o.word, last: read.last }, readAt: read.at };
  }
}

/** The key that moves when the plan's work may have: this programme's runs as `id:state:stuck` and its items as `id:state`, from the frames the
 *  store already holds (plan Task WM4). The items are the list's open ones and its cleared ones, so an item that closes moves the key. Sorted,
 *  so a frame that reorders the same rows moves nothing. Which items count is decided here, never by the screen (review 2922 A5). */
export function planKey(slug: string, runs: readonly RunSummary[], waiting: Pick<WaitingView, 'items' | 'cleared'> | null): string {
  const r = runs.filter((x) => x.program === slug).map((x) => `${x.id}:${x.state}:${x.stuck === undefined || x.stuck === null ? 0 : 1}`);
  const i = [...(waiting?.items ?? []), ...(waiting?.cleared ?? [])].filter((x) => x.program === slug).map((x) => `${x.id}:${x.state}`);
  return `${r.sort().join(',')}|${i.sort().join(',')}`;
}
