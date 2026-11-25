// Older chat pages, as the session store keeps them (desktop polish wave 175): what the stream offered, what this
// client asked, and what each answer does. The wire is `shared/olderPage.ts` (wave 171); its task note is
// `docs/superpowers/programs/desktop-polish/chat-paging.md`, and this wave's is `chat-history-screen.md`.
//
// THE CONTINUATION. A backlog frame carries `older` only when the stream can page; the request sends it back and nothing
// else; a `more` answer carries the next one. It is opaque here: never parsed, never compared except for equality.
//
// ONE REQUEST AT A TIME, per stream. A request is sent only when none is outstanding, and only from the continuation the
// last backlog or the last applied answer gave.
//
// WHAT VOIDS A REQUEST. A new backlog on the same socket (a rotation, a re-point, a registry move, a shrink) starts paging
// again from its own continuation. A socket that leaves `open` takes every outstanding request with it: the client's
// socket drops the old socket's frames (`lib/ws.ts`, its identity guard), so no answer to it can ever arrive; the
// continuation stays, because a resumed stream reads no backlog and a continuation is good on any socket of the session.
// A voided request is never waited for. Its answer may still come on the same socket, though: a request still on the
// wire when the server sent the backlog is read after it and answered against the new file (the task note's case B).
//
// WHICH REQUEST AN ANSWER IS FOR (the coordinator's ruling on this wave's question). An answer names the request it
// answers (`for`, the continuation it was asked with, echoed), and it is applied only when that equals the continuation
// of the request outstanding; every other answer is dropped. An answer with no echo (the wave 171 server, which never
// echoes) is decided by the fallback rule: the first answer that is not `busy` after a void is dropped, whichever request
// it answers (`voided`), and a request outstanding then is given up and offered again; an answer that arrives with no
// request outstanding is dropped too; a `busy` answer applies nothing and drops nothing.
//
// DISPLAY ONLY. A page's events are rows to read: this module returns them for the store to prepend, and nothing else of
// the store's state reads an answer.
//
// L1: pure, no I/O, no React.
import type { ChatEvent } from '../../../shared/api';
import type { OlderPageAnswer, OlderPageEnd } from '../../../shared/olderPage';
import { freshOf } from './eventIdentity';
import { isLocalDivider } from './localDivider';

/** What the top of the chat says about older messages, one word each, never two collapsed:
 *  - `none`: there is nothing to offer (no continuation: an older server, a stream that cannot page, or a continuation
 *    the server no longer accepts, dropped quietly). The view is today's, with no control;
 *  - `more`: older messages can be loaded (the Load older control);
 *  - `loading`: a request is outstanding;
 *  - `start`: the oldest message available here is shown;
 *  - `busy`: the server was already reading a page for this stream; this request did nothing (Try again);
 *  - `changed`, `absent`: older messages cannot be loaded now, and asking again cannot help until a new backlog;
 *  - `unreadable`, `unmeasured`: older messages cannot be loaded now, and asking again may help (Try again).
 *  The wire's end words less the two a page never shows (`invalid`, `expired`: dropped quietly, `none`), plus `none` and
 *  `loading`: derived, so the read failure pair keeps its one home (`shared/agent-protocol.ts`). */
export type OlderEdge = 'none' | 'loading' | Exclude<OlderPageEnd, 'invalid' | 'expired'>;

/** The edges that offer the control: a load, or a retry of the last request. */
const ASKABLE: ReadonlySet<OlderEdge> = new Set<OlderEdge>(['more', 'busy', 'unreadable', 'unmeasured']);

export interface OlderPaging {
  /** The continuation the next request sends, or null when there is none to send. */
  readonly next: string | null;
  /** The continuation of the request outstanding on this stream, or null when none is. */
  readonly asked: string | null;
  /** How many answers to drop before any is applied: one per request a new backlog voided while it was outstanding. */
  readonly voided: number;
  readonly edge: OlderEdge;
  /** How many pages were applied since the last backlog. */
  readonly pages: number;
  /** How many rows the pages put before the backlog's (their events and gap markers): the rows from `rowsFrom(events)` on,
   *  this many, are older rows, and display only. */
  readonly rows: number;
}

export const NO_PAGING: OlderPaging =
  Object.freeze({ next: null, asked: null, voided: 0, edge: 'none', pages: 0, rows: 0 });

/** A new backlog on this stream: paging starts again from its continuation, and an outstanding request is voided. */
export function pagingOfBacklog(p: OlderPaging, older: string | undefined): OlderPaging {
  const next = typeof older === 'string' && older !== '' ? older : null;
  return {
    next, asked: null, voided: p.voided + (p.asked === null ? 0 : 1), edge: next === null ? 'none' : 'more', pages: 0, rows: 0,
  };
}

/** A `rotated` frame: the file on screen is gone, and so is its continuation; the backlog that follows brings the next. */
export function pagingOfRotated(p: OlderPaging): OlderPaging {
  return { next: null, asked: null, voided: p.voided + (p.asked === null ? 0 : 1), edge: 'none', pages: 0, rows: 0 };
}

/** The socket left `open`: its outstanding request can never be answered on the next one, and the continuation stays. */
export function pagingOfDrop(p: OlderPaging): OlderPaging {
  if (p.asked === null && p.voided === 0) return p;
  return { ...p, asked: null, voided: 0, edge: p.edge === 'loading' ? 'more' : p.edge };
}

/** The continuation to ask with now, or null: nothing outstanding, a continuation in hand, and an edge that offers it. */
export function requestOf(p: OlderPaging): string | null {
  return p.asked === null && p.next !== null && ASKABLE.has(p.edge) ? p.next : null;
}

/** The request for `continuation` was sent. */
export function pagingAsked(p: OlderPaging, continuation: string): OlderPaging {
  return { ...p, asked: continuation, edge: 'loading' };
}

/** What an answer does: the paging after it, and the page to prepend, if any. */
export interface Answered {
  readonly paging: OlderPaging;
  readonly page: { readonly events: readonly ChatEvent[]; readonly gap: boolean } | null;
}

/** Decide one `older-page` answer (see WHICH REQUEST AN ANSWER IS FOR in the header). */
export function answerPaging(p: OlderPaging, a: OlderPageAnswer): Answered {
  if (typeof a.for === 'string') {
    // The echo: exactly the request outstanding, or nothing.
    if (p.asked === null || a.for !== p.asked) return { paging: p, page: null };
  } else {
    if (a.end === 'busy') {
      return { paging: p.asked === null ? p : { ...p, asked: null, edge: 'busy' }, page: null };
    }
    if (p.voided > 0) {
      // Possibly a voided request's answer: dropped. A request outstanding now may have been the one it answered, so it
      // is given up and the control offers it again.
      return { paging: { ...p, voided: p.voided - 1, asked: null, edge: p.asked === null ? p.edge : 'more' }, page: null };
    }
    if (p.asked === null) return { paging: p, page: null };
  }
  const done = { ...p, asked: null };
  if (a.end === 'busy') return { paging: { ...done, edge: 'busy' }, page: null };
  switch (a.end) {
    case 'more':
      // `more` always carries the next continuation. One without it is not applied: its page has no next to follow it,
      // so the same request is asked again (unmeasured), never a page past a hole.
      return typeof a.continuation === 'string' && a.continuation !== ''
        ? { paging: { ...done, next: a.continuation, edge: 'more', pages: p.pages + 1 }, page: pageOf(a) }
        : { paging: { ...done, edge: 'unmeasured' }, page: null };
    case 'start':
      return { paging: { ...done, next: null, edge: 'start', pages: p.pages + 1 }, page: pageOf(a) };
    case 'changed':
    case 'absent':
      return { paging: { ...done, next: null, edge: a.end }, page: null };
    case 'unreadable':
    case 'unmeasured':
      // The same request can be made again: `next` is still the continuation it sent.
      return { paging: { ...done, edge: a.end }, page: null };
    case 'invalid':
    case 'expired':
      // A continuation the server no longer accepts: dropped quietly; the next backlog brings one.
      return { paging: { ...done, next: null, edge: 'none' }, page: null };
    default:
      // An end word this build does not know (a newer server): nothing is applied, and nothing is asked again.
      return { paging: { ...done, next: null, edge: 'none' }, page: null };
  }
}

const pageOf = (a: OlderPageAnswer): Answered['page'] =>
  ({ events: Array.isArray(a.events) ? a.events : [], gap: a.gap === true });

/** A gap marker's uuid prefix, inside the local-divider namespace (`localDivider.ts`). */
export const GAP_PREFIX = 'local-gap-';

export const isGapMarker = (e: ChatEvent): boolean => e.kind === 'system' && e.uuid.startsWith(GAP_PREFIX);

/** Where a page goes: after the leading local rows a rotation left on top ("Session context reset"), which mark where
 *  the file on screen began, and before everything else. A gap marker is not one of them: it belongs to the pages. */
export function rowsFrom(events: readonly ChatEvent[]): number {
  let i = 0;
  while (i < events.length && isLocalDivider(events[i]!) && !isGapMarker(events[i]!)) i += 1;
  return i;
}

/** The rows with a page prepended: its events that are not copies of rows already held, oldest first, then a gap marker
 *  when the page skipped a record, at the page's newer edge (the server keeps the records nearest the boundary and skips
 *  the one it cannot send there, so the gap sits between the page and the rows held). Two gaps with nothing between are
 *  one marker. `gap` is the marker to use, minted by the caller (it carries the store's own local id and words); its
 *  time is set to the row it sits above, so it draws no time divider of its own. */
export function prependPage(
  events: readonly ChatEvent[], page: NonNullable<Answered['page']>, gap: (ts: string) => ChatEvent,
): ChatEvent[] {
  const at = rowsFrom(events);
  const head = events.slice(0, at);
  const held = events.slice(at);
  const fresh = freshOf(held, page.events);
  const below = held[0];
  const marker = page.gap && !(below !== undefined && isGapMarker(below) && fresh.length === 0)
    ? [gap(below?.ts ?? fresh[fresh.length - 1]?.ts ?? new Date(0).toISOString())]
    : [];
  if (fresh.length === 0 && marker.length === 0) return events as ChatEvent[];
  return [...head, ...fresh, ...marker, ...held];
}

/** The rows an item is drawn from, as `chatItems.ts` builds them: a message, mail or task card its event, a tool card its
 *  call; a time divider, a pending send and the working pulse none. */
type Sourced =
  | { readonly kind: 'message' | 'mail' | 'task'; readonly event: ChatEvent }
  | { readonly kind: 'tool'; readonly use: ChatEvent }
  | { readonly kind: 'divider' | 'pending' | 'working' };

/** The index of the first item drawn from a live row (one after the older rows, `OlderPaging.rows`), which the
 *  tool-activity fold takes as `liveFrom`: every item before it is an older page's, display only. 0 when no older row is
 *  held; the item count when no item is drawn from a live row. A pending send and the working pulse are live. */
export function liveFromOf(items: readonly Sourced[], events: readonly ChatEvent[], p: OlderPaging): number {
  if (p.rows === 0) return 0;
  const live = new Set<ChatEvent>(events.slice(rowsFrom(events) + p.rows));
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]!;
    switch (it.kind) {
      case 'pending':
      case 'working':
        return i;
      case 'divider':
        break;
      case 'tool':
        if (live.has(it.use)) return i;
        break;
      default:
        if (live.has(it.event)) return i;
    }
  }
  return items.length;
}
