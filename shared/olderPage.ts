// L0 (desktop polish wave 171): the session socket's older chat pages, on the wire. The server's side is
// `server/src/sessionws.ts#olderPage` (with `server/src/transcript/olderPage.ts` and `continuation.ts`); the PWA's one
// reader is `pwa/src/stores/session.ts#applySessionMsg`. ADDITIVE: an older client never sends the request and drops
// the answer as an unknown frame; an older server ignores the request and never sends `backlog.older`.
import type { ChatEvent } from './api.js';
import type { ReadFailure } from './agent-protocol.js';

/** Desktop polish wave 171: the PWA asks for the page of chat records before the last one it was given, on the session
 *  socket. `continuation` is the opaque value the server last sent (`backlog.older`, or an `OlderPageAnswer`'s); it is the
 *  frame's only content. An older server's parser reads it as null and ignores it. Parsed by
 *  `server/src/server.ts#asSessionClientMsg`. */
export interface OlderPageRequest { type: 'older-page'; continuation: string }

/** How an older page ends, one word each, never two collapsed (desktop polish wave 171). `more`: older records remain, and
 *  the answer carries the continuation for them. `start`: the page reached the start of the file, measured. `changed`: the
 *  file is not the one the continuation was issued for (its identity, its witness bytes, or the stream now serves another
 *  file). `absent`, `unreadable`: the read's own words. `unmeasured`: a step could not be measured (no identity token on a
 *  read, or a stream that cannot offer paging). `invalid`: the continuation is not one this server issued for this
 *  session. `expired`: it was issued by an earlier server process. `busy`: a page is already in flight on this stream; this
 *  request did nothing. An empty page is never by itself the end: only `start` is. */
export type OlderPageEnd = 'more' | 'start' | 'changed' | ReadFailure | 'unmeasured' | 'invalid' | 'expired' | 'busy';
const OLDER_PAGE_END_MAP: Record<OlderPageEnd, true> = {
  more: true, start: true, changed: true, absent: true, unreadable: true, unmeasured: true, invalid: true, expired: true,
  busy: true,
};
export const OLDER_PAGE_ENDS: readonly OlderPageEnd[] = Object.keys(OLDER_PAGE_END_MAP) as OlderPageEnd[];

/** The server's answer to an `OlderPageRequest`: the page's events, oldest first, from the parser the backlog and the
 *  tailer use; `gap` when the page skipped a record too long to frame or to send; `end`, and `continuation` exactly when
 *  `end` is `more`. Display only: no helper facts, question, approval, notification or status rides it.
 *  `for` (desktop polish wave 175): the continuation the request sent, echoed, so a client applies an answer only to the
 *  request it has outstanding (a request can cross a new backlog on the wire and be answered after it). Present only when
 *  that value had a continuation's length and grammar (`server/src/transcript/continuation.ts#continuationShaped`); an
 *  over-long or malformed one is never reflected. ADDITIVE: absent from the wave 171 server, where the client falls back
 *  to dropping the first answer after a void. One reader: `pwa/src/session/olderPages.ts#answerPaging`. */
export interface OlderPageAnswer {
  type: 'older-page';
  events: ChatEvent[];
  gap: boolean;
  end: OlderPageEnd;
  continuation?: string;
  for?: string;
}
