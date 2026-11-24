// L1 policy (C3 Session Conversation): the session stream's older-page decisions (desktop polish wave 171). No I/O: the
// stream (`sessionws.ts#olderPage`, L4) acts on what these answer, and the page itself reads through the FleetIO port
// (`olderPage.ts`, L3). The continuation's MAC and tags are computations under the process key (`continuation.ts`), not I/O.
import type { ChatEvent } from '../../../shared/api.js';
import type { OlderPageAnswer, OlderPageEnd } from '../../../shared/olderPage.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';
import type { ContinuationKey, OpenedContinuation } from './continuation.js';
import type { OlderPageBinding, OlderPageRead } from './olderPage.js';
import type { BacklogRead } from './tail.js';

/** What a stream serves, for an older page's checks. `ok`: the file the stream serves now, and the identity token its
 *  backlog's reads carried (`null` when no backlog measured one: a resumed stream, or a read that carried none; every
 *  page read then carries the check). Any other word: the stream's last backlog could not measure the file. */
export type Serving = { state: 'ok'; file: string; ident: string | null } | { state: ReadFailure | 'unmeasured' };

/** An answer to `older-page` that carries no event: a refusal, or `busy`. */
export function olderAnswer(end: OlderPageEnd, events: ChatEvent[] = [], gap = false): OlderPageAnswer {
  return { type: 'older-page', events, gap, end };
}

/** What a stream serves after this backlog read. A measured file is `ok`, with the identity token its reads carried, if
 *  one; a proven absence is `absent`; an unreadable file `unreadable`; a stat that measured nothing `unmeasured`. */
export function servingOf(file: string, read: BacklogRead): Serving {
  if (read.measured && !read.missing) return { state: 'ok', file, ident: read.older?.ident ?? null };
  if (read.measured) return { state: 'absent' };
  return { state: read.missing ? 'unmeasured' : 'unreadable' };
}

/** The backlog's continuation: issued only when the read measured every fact a page binds to (`BacklogRead.older`). Its
 *  first page ends at the anchor, the oldest record the backlog covers. */
export function olderOf(key: ContinuationKey, session: string, file: string, read: BacklogRead): string | undefined {
  const b = read.older;
  if (b === undefined) return undefined;
  return key.issue({
    session, path: file, ident: b.ident,
    cursor: { kind: 'line-start', before: b.anchor },
    witness: { at: b.anchor, len: b.witness.len, sha256: b.witness.sha256 },
  });
}

export type OlderPageGate =
  | { go: false; answer: OlderPageAnswer }
  | { go: true; file: string; c: OpenedContinuation };

/** Every check that needs no I/O, in order: one page in flight (`busy`), the continuation's grammar, key and MAC
 *  (`invalid`, `expired`), its session (`invalid`), what this stream serves now (its own word, `unmeasured` before any),
 *  the file's tag and, when the backlog measured one, the identity's tag (`changed`). `go` names the file THIS stream
 *  serves, never anything the continuation names. */
export function gateOlderPage(
  key: ContinuationKey, token: string, session: string, serving: Serving | null, inFlight: boolean,
): OlderPageGate {
  const no = (end: OlderPageEnd): OlderPageGate => ({ go: false, answer: olderAnswer(end) });
  if (inFlight) return no('busy');
  const opened = key.open(token);
  if (!opened.ok) return no(opened.reason);
  const c = opened.value;
  if (c.session !== session) return no('invalid');
  if (serving === null) return no('unmeasured');
  if (serving.state !== 'ok') return no(serving.state);
  if (!key.matches('path', serving.file, c.pathTag)) return no('changed');
  if (serving.ident !== null && !key.matches('ident', serving.ident, c.identTag)) return no('changed');
  return { go: true, file: serving.file, c };
}

/** What every read of the page is checked against: the continuation's identity and witness tags, each compared in constant
 *  time under the key, and the stream's masker. */
export function pageBinding(key: ContinuationKey, c: OpenedContinuation, mask: <T>(v: T) => T): OlderPageBinding {
  return {
    identOk: (ident) => key.matches('ident', ident, c.identTag), witness: { at: c.witness.at, len: c.witness.len },
    witnessOk: (sha256) => key.matches('witness', sha256, c.witness.tag), mask,
  };
}

/** The frame a finished page answers: a refusal's word, `start`, or `more` with the next continuation (every bound field
 *  kept, only the cursor moved). */
export function pageAnswer(key: ContinuationKey, c: OpenedContinuation, page: OlderPageRead): OlderPageAnswer {
  if (!page.ok) return olderAnswer(page.reason);
  if (page.next.kind === 'start') return olderAnswer('start', page.events, page.gap);
  return { ...olderAnswer('more', page.events, page.gap), continuation: key.reissue(c, page.next.cursor) };
}
