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
// request outstanding is dropped too; a `busy` answer applies nothing and drops nothing. And an answer whose `more`
// continuation is the continuation of the request outstanding answers the request BEFORE it (a page already applied: the
// given-up request's own answer, arriving after its re-ask was answered), so it is dropped and the request kept (fix round
// 1, A3). Counting the given-up request as voided instead would stall paging: a voided request's answer usually never
// comes (the server drops a page read across a backlog), so the count would never come back to zero.
//
// BUSY IS ASKED AGAIN ON ITS OWN (fix round 1, A6). A `busy` answer means the server was still reading another page for
// this stream (one it may never answer: a page read across a backlog is dropped by the server). The same request is asked
// again after a pause, BUSY_RETRIES times in a row, one request at a time, the top still saying it is loading; only then is
// Try again offered.
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
 *  - `none`: there is nothing to offer (no continuation: an older server, or a stream that cannot page). The view is
 *    today's, with no control;
 *  - `more`: older messages can be loaded (the Load older control);
 *  - `loading`: a request is outstanding, or a `busy` one is about to be asked again;
 *  - `start`: the oldest message available here is shown;
 *  - `busy`: the server was already reading a page for this stream; this request did nothing (Try again);
 *  - `changed`, `absent`: older messages cannot be loaded now, and asking again cannot help until a new backlog;
 *  - `unreadable`, `unmeasured`: older messages cannot be loaded now, and asking again may help (Try again);
 *  - `expired`: the server no longer accepts the continuation (`expired`, or `invalid`: a restart, a moved file). Older
 *    messages are there, and reopening the chat loads them; asking again cannot help, and a resumed stream brings no new
 *    continuation, so it stands until a backlog brings one (fix round 1, A5).
 *  The wire's end words less `invalid` (said as `expired`), plus `none` and `loading`: derived, so the read failure pair
 *  keeps its one home (`shared/agent-protocol.ts`). */
export type OlderEdge = 'none' | 'loading' | Exclude<OlderPageEnd, 'invalid'>;

/** How many `busy` answers in a row are asked again on their own before Try again is offered (fix round 1, A6). */
export const BUSY_RETRIES = 3;
/** The pause before each of them, ms. */
export const BUSY_PAUSE_MS = 800;

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
  /** How many `busy` answers came in a row for the request being asked (`BUSY_RETRIES`). */
  readonly busy: number;
}

export const NO_PAGING: OlderPaging =
  Object.freeze({ next: null, asked: null, voided: 0, edge: 'none', pages: 0, rows: 0, busy: 0 });

/** A new backlog on this stream: paging starts again from its continuation, and an outstanding request is voided. */
export function pagingOfBacklog(p: OlderPaging, older: string | undefined): OlderPaging {
  const next = typeof older === 'string' && older !== '' ? older : null;
  return {
    next, asked: null, voided: p.voided + (p.asked === null ? 0 : 1), edge: next === null ? 'none' : 'more', pages: 0, rows: 0,
    busy: 0,
  };
}

/** A `rotated` frame: the file on screen is gone, and so is its continuation; the backlog that follows brings the next. */
export function pagingOfRotated(p: OlderPaging): OlderPaging {
  return { next: null, asked: null, voided: p.voided + (p.asked === null ? 0 : 1), edge: 'none', pages: 0, rows: 0, busy: 0 };
}

/** The socket left `open`: its outstanding request can never be answered on the next one, and the continuation stays. A
 *  `busy` request waiting to be asked again is given up with it: the control offers it. */
export function pagingOfDrop(p: OlderPaging): OlderPaging {
  if (p.asked === null && p.voided === 0 && p.edge !== 'loading') return p;
  return { ...p, asked: null, voided: 0, edge: p.edge === 'loading' ? 'more' : p.edge, busy: 0 };
}

/** A `busy` request is due to be asked again, after `BUSY_PAUSE_MS` (the store's timer). */
export const retryDue = (p: OlderPaging): boolean => p.edge === 'loading' && p.asked === null && p.busy > 0 && p.next !== null;

/** The continuation to ask with now, or null: nothing outstanding, a continuation in hand, and an edge that offers it, or
 *  a `busy` request due again. */
export function requestOf(p: OlderPaging): string | null {
  return p.asked === null && p.next !== null && (ASKABLE.has(p.edge) || retryDue(p)) ? p.next : null;
}

/** The request for `continuation` was sent. Sent from Try again after `busy`, the retries start over. */
export function pagingAsked(p: OlderPaging, continuation: string): OlderPaging {
  return { ...p, asked: continuation, edge: 'loading', busy: p.edge === 'busy' ? 0 : p.busy };
}

/** A `busy` answer to the request outstanding: asked again on its own while retries are left, then Try again. */
const busyOf = (p: OlderPaging): OlderPaging =>
  ({ ...p, asked: null, busy: p.busy + 1, edge: p.busy + 1 <= BUSY_RETRIES ? 'loading' : 'busy' });

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
    if (a.end === 'busy') return { paging: p.asked === null ? p : busyOf(p), page: null };
    if (p.voided > 0) {
      // Possibly a voided request's answer: dropped. A request outstanding now may have been the one it answered, so it
      // is given up and the control offers it again (its own answer, if still to come, is dropped by the check below).
      return { paging: { ...p, voided: p.voided - 1, asked: null, edge: p.asked === null ? p.edge : 'more' }, page: null };
    }
    if (p.asked === null) return { paging: p, page: null };
    // The answer to the request before (fix round 1, A3). Sound because a continuation names a place: a page's next
    // continuation is where that page ends, strictly before the place it was asked from (`server/src/transcript/
    // olderRange.ts`: every record a page frames ends at or before its cursor), so it is never the continuation it
    // answers; and two different places' pages end at different places (the same record count, or the same chunk budget,
    // back from each), so only the request whose page ended here can carry it.
    if (a.end === 'more' && a.continuation === p.asked) return { paging: p, page: null };
  }
  if (a.end === 'busy') return { paging: busyOf(p), page: null };
  const done = { ...p, asked: null, busy: 0 };
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
      // A continuation the server no longer accepts: said, never silent (a resumed stream brings no backlog, so the
      // control vanishing would read as nothing older); the next backlog brings one.
      return { paging: { ...done, next: null, edge: 'expired' }, page: null };
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
 *  time is the row it sits BELOW, the page's newest, so it draws no time divider of its own (`chatItems.ts` measures a
 *  row's gap from the newest time above it, and never counts a local row's): the row below it draws the one divider the
 *  gap needs (fix round 1, A4). With no row of the page above it, the list drops the repeat (`ChatList.tsx#itemsOf`). */
export function prependPage(
  events: readonly ChatEvent[], page: NonNullable<Answered['page']>, gap: (ts: string) => ChatEvent,
): ChatEvent[] {
  const at = rowsFrom(events);
  const head = events.slice(0, at);
  const held = events.slice(at);
  const fresh = freshOf(held, page.events);
  const below = held[0];
  const marker = page.gap && !(below !== undefined && isGapMarker(below) && fresh.length === 0)
    ? [gap(fresh[fresh.length - 1]?.ts ?? below?.ts ?? new Date(0).toISOString())]
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
