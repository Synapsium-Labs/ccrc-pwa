// Which chat events are THE SAME EVENT (desktop polish wave 175): the one rule the session store merges every frame by,
// a live `events` frame appended and an older page prepended alike, so a row the two both carry is shown once.
//
// WHAT THE PARSER GIVES, AND WHY ITS IDS ALONE DO NOT PROVE ONE EVENT (`server/src/transcript/parse.ts`,
// `parseTranscriptLine`). One transcript record parses to one or more events, and every event of a record carries the
// record's `uuid` and `ts`: an assistant record with prose and a call is an `assistant` event and a `tool_use` event, both
// with the record's uuid; a user record with two text blocks is two `user` events with one uuid. A `tool_result` carries
// no uuid at all, only its call's `toolId`, and a record can carry several. So a uuid names a RECORD, not an event, and a
// toolId names a CALL, not a result; separate records can share either (a missing id is the empty string). The merge the
// store used before keyed every event on its uuid (a result on its toolId), so the second event of a record arriving
// with the first was taken for a copy of it and dropped.
//
// THE IDENTITY is everything the parser gives an event: its kind, its source id (the uuid, or a result's toolId), its
// time, and what it shows (text; a call's name and input; a result's error flag and text; a system row's origin and
// reset; a compaction mark; a cut's byte count). Two events with the same identity are the same event, read twice.
//
// MULTIPLICITY, NOT PRESENCE (`freshOf`, the one merge, for a live frame and an older page alike). A record can carry two
// blocks that parse to the very same event (two equal text blocks), and those are two rows. So the merge counts: an
// incoming event is a copy only while the rows held already carry that identity as often as the frame has carried it so
// far. A frame never splits a record (the backlog and every page begin at a record start, and the tailer sends whole
// lines), so a record's equal blocks always arrive together, are counted together, and both stay.
//
// THE ONE LIMIT. Two SEPARATE records that are equal in every field the parser gives (the same uuid, time and words) are
// one identity. Inside one frame they are counted and both appear; across two frames (one held, one arriving) the second
// is taken for a copy of the first. Nothing the parser gives can tell them apart there.
//
// Local rows the store mints itself (`localDivider.ts`: a rotation's divider, a notice, a page's gap marker) are never
// transcript events: they are never copies of anything and are never counted.
//
// L1: pure, no I/O, no React. The memo below is a cache of a pure function, keyed by the event object, which the store
// never mutates.
import type { ChatEvent } from '../../../shared/api';
import { isLocalDivider } from './localDivider';

/** The content an event shows, every field of it, as one unambiguous string (a JSON array). */
function contentOf(e: ChatEvent): string {
  switch (e.kind) {
    case 'user':
    case 'assistant':
      return JSON.stringify([e.compaction === true, e.text]);
    case 'tool_use':
      return JSON.stringify([e.name, e.truncatedBytes ?? null, e.input]);
    case 'tool_result':
      return JSON.stringify([e.isError, e.truncatedBytes ?? null, e.text]);
    case 'system':
      return JSON.stringify([e.origin ?? null, e.resetsAt ?? null, e.text]);
  }
}

/** cyrb53, a 53-bit string hash: the content's fingerprint, beside its exact length. A content of the same length and the
 *  same 53-bit hash as another is taken for the same; at this list's sizes (tens of thousands of rows) that is a chance
 *  below one in a billion. */
function hash53(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const memo = new WeakMap<ChatEvent, string>();

/** The identity of one parsed event (see the header): equal exactly when every field the parser gives is equal. */
export function eventIdentity(e: ChatEvent): string {
  const known = memo.get(e);
  if (known !== undefined) return known;
  const content = contentOf(e);
  const source = e.kind === 'tool_result' ? e.toolId : e.uuid;
  const id = JSON.stringify([e.kind, source, e.ts, content.length, hash53(content)]);
  memo.set(e, id);
  return id;
}

/** How often each identity is held among `events`, local rows left out. */
function countsOf(events: readonly ChatEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (isLocalDivider(e)) continue;
    const id = eventIdentity(e);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** The events of `incoming` that are not copies of rows `held` carries, in order (see MULTIPLICITY in the header). */
export function freshOf(held: readonly ChatEvent[], incoming: readonly ChatEvent[]): ChatEvent[] {
  if (incoming.length === 0) return [];
  const heldCounts = countsOf(held);
  const seen = new Map<string, number>();
  const fresh: ChatEvent[] = [];
  for (const e of incoming) {
    if (isLocalDivider(e)) { fresh.push(e); continue; }
    const id = eventIdentity(e);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > (heldCounts.get(id) ?? 0)) fresh.push(e);
  }
  return fresh;
}
