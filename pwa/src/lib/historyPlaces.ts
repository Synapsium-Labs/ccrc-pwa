// Back places, the decision (X2 P5.3, D-8763; parity spec 4.7). Ring L1 policy: pure. It takes everything as parameters
// and names no browser global, no storage and no clock, so every rule here is a table row in a test. `popstate.ts` (L4)
// asks it on every `popstate` before any subscriber runs and acts on the answer; `reader/places.ts` (L4) asks it for
// the entries it pushes.
//
// What it decides. The console keeps one history entry per place the reader frame reports (the figure overlay, and a
// jump marked to return from), tagged with the visit it belongs to. Every entry the tab visits is also numbered
// (`docsIdx`, only ever growing), so a pop can tell Back from Forward by comparing the popped entry's number with the
// entry last shown. A pop is then one of: the router's (a page move: every subscriber runs), the frame's (close the
// overlay, or go back to where a jump left from), consumed (the console's own `history.back()` landing, or a place with
// no command to give), or a skip (a place of an ended visit, or one the console cannot act on: step history once more,
// in the direction of travel, and run nothing).
import { isCount, isRecord } from './wire';

/** The most places one doc visit pushes; the next is not pushed (the frame still works, Back just leaves the doc). A
 *  full budget is well under the browsers' own session-history cap (SKIPS_MAX below), so a visit that spends it leaves
 *  the tab most of its earlier entries (D-9139); a tab already near the cap still loses its oldest. */
export const PLACES_MAX = 20;
/** The most stale entries a skip loop steps over in one direction before it routes instead. A session history holds at
 *  most about this many entries (the browsers keep 50 and drop the oldest past that), so no honest run of stale entries
 *  is longer; it is the loop's bound, not a places budget. */
export const SKIPS_MAX = 50;
/** The top-level key of a history entry's state that numbers the entry. */
export const IDX_KEY = 'docsIdx';
/** The top-level key of a history entry's state that tags a place's entry. */
export const PLACE_KEY = 'docsPlace';
/** The key of the tab record in the tab's storage. */
export const PLACES_RECORD_KEY = 'ccrc:docs:v1:places';

export type PlaceKind = 'overlay' | 'jump';

/** One place of the visit, as the tab record keeps it. `idx` is the `docsIdx` of its entry. */
export interface Place {
  readonly seq: number;
  readonly kind: PlaceKind;
  readonly idx: number;
  readonly id?: string;
  readonly from?: string;
}

/** What a place's entry carries in its state under `docsPlace`. */
export interface EntryPlace {
  readonly visit: string;
  readonly seq: number;
  readonly kind: PlaceKind;
  readonly id?: string;
  readonly from?: string;
}

/** The tab's record: where the visit stands and the tab's entry counter. */
export interface TabRecord {
  /** The current visit's id, or null when no reader is in a visit. */
  visit: string | null;
  /** The visit's doc: its page address less the fragment. */
  doc: string | null;
  /** The visit's places, in push order. */
  places: Place[];
  /** Places pushed in this visit: the budget's count, never down within a visit. */
  seq: number;
  /** The seq the console's own `history.back()` expects to land on (0 is the visit's base entry), or null. */
  pendingSeq: number | null;
  /** The `docsIdx` of the entry last shown, or -1 when none yet. */
  lastIdx: number;
  /** The next `docsIdx` to hand out. */
  next: number;
  /** Consecutive skips so far in one direction: the skip loop's bound. */
  skips: number;
  /** The direction of those skips, or null: a skip the other way starts the count again. */
  skipDir: 'back' | 'forward' | null;
  /** The `docsIdx` of the newest entry this tab's history holds, as far as the console knows (set by every push it
   *  makes, and by a page loaded on an unnumbered entry), or null when unknown (an older record): a Forward skip over a
   *  stale place that is this entry has nothing above it to step to. */
  top: number | null;
  /** The release gate's mark that a full-page replace of the entry numbered `idx` is about to load `to` (a path and
   *  query), or null: the page that loads there takes the number back. */
  carry: { idx: number; to: string } | null;
}

/** What the dispatcher does with one pop. A `goto` with no `from` and `toTop` goes to the top of the doc (the library
 *  answers no anchor at the very top); `close` says an overlay place of the visit is also in the span left, so the
 *  figure closes first. */
export type PopDecision =
  | { readonly kind: 'close-overlay' }
  | { readonly kind: 'goto'; readonly id: string; readonly from?: string; readonly toTop?: true; readonly close?: true }
  | { readonly kind: 'consume' }
  | { readonly kind: 'skip'; readonly dir: 'back' | 'forward' }
  | { readonly kind: 'router' };

/** The record of a tab that has seen nothing. Frozen: a function that needs a record of its own copies it. */
export const EMPTY_RECORD: TabRecord = Object.freeze({
  visit: null,
  doc: null,
  places: Object.freeze([] as Place[]) as Place[],
  seq: 0,
  pendingSeq: null,
  lastIdx: -1,
  next: 0,
  skips: 0,
  skipDir: null,
  top: null,
  carry: null,
});

/** A record of its own with the empty record's values. */
const fresh = (): TabRecord => ({ ...EMPTY_RECORD, places: [] });

const isKind = (v: unknown): v is PlaceKind => v === 'overlay' || v === 'jump';

/** The index and the place of a history entry's state. Tolerant: anything that is not the exact shape reads null for
 *  its half. `idx` is a non-negative safe integer; a place is `{visit: string, seq >= 1, kind, id?, from?}` with each
 *  optional key a string when present, and any other shape of `docsPlace` is no place at all. */
export function readEntry(state: unknown): { idx: number | null; place: EntryPlace | null } {
  if (!isRecord(state)) return { idx: null, place: null };
  const rawIdx = state[IDX_KEY];
  const idx = isCount(rawIdx) ? rawIdx : null;
  const p = state[PLACE_KEY];
  if (!isRecord(p)) return { idx, place: null };
  const { visit, seq, kind, id, from } = p;
  if (typeof visit !== 'string' || visit === '' || !isCount(seq) || seq < 1 || !isKind(kind)) return { idx, place: null };
  if (id !== undefined && typeof id !== 'string') return { idx, place: null };
  if (from !== undefined && typeof from !== 'string') return { idx, place: null };
  return {
    idx,
    place: {
      visit, seq, kind,
      ...(id !== undefined ? { id } : {}),
      ...(from !== undefined ? { from } : {}),
    },
  };
}

/** The state a replaced entry is written with (D-9116): the replaced entry's own valid `docsIdx` carried alone, so the
 *  entry keeps its place in the tab's numbering; `null` when it has none, exactly as a replace wrote before. Its place,
 *  and every other key, are not carried. */
export function replacedState(prev: unknown): { docsIdx: number } | null {
  const { idx } = readEntry(prev);
  return idx === null ? null : { [IDX_KEY]: idx };
}

/** The address a jump's entry is pushed at (D-9117): the doc's path and query unchanged and the jump's id as the
 *  fragment, joined as a fragment replace joins it, when the id is in the fragment grammar (`inGrammar`, the library's
 *  own check, asked by the bridge). An id outside it never reaches the address: the entry keeps the current one, and
 *  `report` says the caller tells the console so. An overlay's entry always keeps the current address. */
export function jumpEntryUrl(
  here: { readonly pathname: string; readonly search: string; readonly href: string }, id: string, inGrammar: boolean,
): { url: string; report: boolean } {
  return inGrammar ? { url: `${here.pathname}${here.search}#${id}`, report: false } : { url: here.href, report: true };
}

function readStoredPlace(v: unknown): Place | null {
  if (!isRecord(v)) return null;
  const { seq, kind, idx, id, from } = v;
  if (!isCount(seq) || seq < 1 || !isKind(kind) || !isCount(idx)) return null;
  if (id !== undefined && typeof id !== 'string') return null;
  if (from !== undefined && typeof from !== 'string') return null;
  return { seq, kind, idx, ...(id !== undefined ? { id } : {}), ...(from !== undefined ? { from } : {}) };
}

/** The tab record from its stored text. Tolerant: absent, unparsable or any field of the wrong shape reads as the empty
 *  record, whole, never as a half-read one. */
export function parseRecord(raw: string | null): TabRecord {
  if (raw === null) return fresh();
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return fresh();
  }
  if (!isRecord(v)) return fresh();
  const { visit, doc, places, seq, pendingSeq, lastIdx, next, skips, skipDir } = v;
  // An older record has neither of these: absent reads as unknown / no mark. A present one of the wrong shape is no record.
  const top = v.top === undefined ? null : v.top;
  if (top !== null && !isCount(top)) return fresh();
  let carry: TabRecord['carry'] = null;
  if (v.carry !== undefined && v.carry !== null) {
    const c = v.carry;
    if (!isRecord(c) || !isCount(c.idx) || typeof c.to !== 'string') return fresh();
    carry = { idx: c.idx, to: c.to };
  }
  if (skipDir !== null && skipDir !== 'back' && skipDir !== 'forward') return fresh();
  if (visit !== null && typeof visit !== 'string') return fresh();
  if (doc !== null && typeof doc !== 'string') return fresh();
  if (!Array.isArray(places)) return fresh();
  const read: Place[] = [];
  for (const q of places) {
    const p = readStoredPlace(q);
    if (p === null) return fresh();
    read.push(p);
  }
  if (!isCount(seq) || !isCount(next) || !isCount(skips)) return fresh();
  if (pendingSeq !== null && !isCount(pendingSeq)) return fresh();
  if (typeof lastIdx !== 'number' || !Number.isSafeInteger(lastIdx) || lastIdx < -1) return fresh();
  return { visit, doc, places: read, seq, pendingSeq, lastIdx, next, skips, skipDir, top, carry };
}

/** `top` never below an entry the tab is seen to hold: a numbered entry above the recorded `top` (a store that refused
 *  the write that raised it, then a reload) raises it. Unknown stays unknown. */
const atLeast = (top: number | null, idx: number): number | null => (top === null ? null : Math.max(top, idx));

/** The page has just loaded on an entry whose state is `state` (once per page, before its first pop). The record may be
 *  lost, or its `lastIdx` older than the entry the page loaded on (Back from another site can cross several entries), so
 *  the entry decides: a numbered one is the entry last shown, and the counter rises above it; an unnumbered one is newer
 *  than every entry the tab has numbered, so it takes the next number now (`next` rises above it, `top` is it) and the
 *  caller stamps it into the entry (`stamp`), so the first push after it takes a number above it. The one exception is
 *  the release gate's full-page replace (`markReplace`): a loaded entry with no number whose `here` (path and query) is
 *  the mark's target takes the replaced entry's number back, and `top` stays. The mark is cleared whatever it said. A
 *  numbered entry above the recorded `top` raises it (`atLeast`). */
export function seedPage(rec: TabRecord, state: unknown, here: string): { rec: TabRecord; stamp: number | null } {
  const { idx } = readEntry(state);
  const base: TabRecord = { ...rec, places: rec.places.slice(), carry: null };
  if (idx !== null) {
    return { rec: { ...base, lastIdx: idx, next: Math.max(rec.next, idx + 1), top: atLeast(rec.top, idx) }, stamp: null };
  }
  if (rec.carry !== null && rec.carry.to === here) {
    const n = rec.carry.idx;
    return { rec: { ...base, lastIdx: n, next: Math.max(rec.next, n + 1) }, stamp: n };
  }
  const stamp = rec.next;
  return { rec: { ...base, lastIdx: stamp, next: stamp + 1, top: stamp }, stamp };
}

/** The release gate is about to load `href` as a full page in place of the current entry (`state`): leave the mark the
 *  new page's seed reads, so its entry takes this entry's number and not one above the entries ahead of it. An entry
 *  with no number leaves no mark (and clears an older one). `href` is a path with an optional search; a fragment is not
 *  part of the target. */
export function markReplace(rec: TabRecord, state: unknown, href: string): TabRecord {
  const { idx } = readEntry(state);
  const out: TabRecord = { ...rec, places: rec.places.slice(), carry: null };
  if (idx === null) return out;
  const cut = href.indexOf('#');
  out.carry = { idx, to: cut < 0 ? href : href.slice(0, cut) };
  return out;
}

/** What `decidePop` reads of the tab. `host` is whether a mounted reader has registered to take close and goto. */
export interface PopTab {
  readonly visit: string | null;
  readonly places: readonly Place[];
  readonly pendingSeq: number | null;
  readonly lastIdx: number;
  readonly skips: number;
  readonly skipDir: 'back' | 'forward' | null;
  readonly host: boolean;
  /** The record's `top`; absent reads as unknown (null). */
  readonly top?: number | null;
}

/** What one `popstate` means, decided before any subscriber runs. `popped` is the state of the entry landed on. The
 *  rules, in order:
 *  1. No `docsIdx` on the entry: the router's (`navigate`'s synthetic pop lands on a fresh unnumbered entry). A pending
 *     back is not consumed by it: nothing counts "ignore the next pop".
 *  2. The entry is the one last shown: the router's.
 *  3. Back when its index is below the last shown, else Forward.
 *  4. A pending back (the console's own `history.back()` after the frame closed the overlay itself) that lands on the
 *     entry it expected (seq 0 is the visit's base entry, with no place; seq k is the visit's place k): consumed.
 *  5. A place of another visit, or of none now: stale. Skip toward the direction of travel, unless `SKIPS_MAX` skips
 *     in a row in that direction have run, which routes instead; and a Forward skip over a stale place that is the
 *     newest entry the tab holds (`top`) has nothing above it to step to, so it routes too, and the screen follows the
 *     address.
 *  6. A place of this visit with no host registered: stale, as 5.
 *  7. Back, this visit: the places being left (the visit's places above the landing, up to the entry last shown) are the
 *     frame's to undo, and the lowest of them says how: an overlay closes, a jump goes back to its `from` (so a Back of
 *     several entries at once lands where the first of them left; a jump with no `from` was left from the very top, so
 *     it goes to the top), and with no host the pop is consumed. A jump answer also closes the figure first (`close`)
 *     when an overlay place of the visit is in the span too. When no place of the visit is left and the landing is a
 *     place, consumed.
 *  8. Forward onto a place of this visit that the record holds: a jump goes to its id again (no `from`), an overlay is
 *     consumed (nothing reopens it). A place the record does not hold is stale, as 5.
 *  9. Anything else (a base entry, no place): the router's. */
export function decidePop(popped: unknown, tab: PopTab): PopDecision {
  const { idx, place } = readEntry(popped);
  if (idx === null) return { kind: 'router' };
  if (idx === tab.lastIdx) return { kind: 'router' };
  const dir = idx < tab.lastIdx ? 'back' : 'forward';
  if (tab.pendingSeq !== null && dir === 'back') {
    const expected = tab.pendingSeq === 0
      ? place === null
      : place !== null && place.visit === tab.visit && place.seq === tab.pendingSeq;
    if (expected) return { kind: 'consume' };
  }
  const run = tab.skipDir === dir ? tab.skips : 0;
  const top = tab.top ?? null;
  const stale = (): PopDecision => {
    if (run >= SKIPS_MAX) return { kind: 'router' };
    if (dir === 'forward' && top !== null && idx >= top) return { kind: 'router' };
    return { kind: 'skip', dir };
  };
  if (place !== null && (tab.visit === null || place.visit !== tab.visit)) return stale();
  if (place !== null && !tab.host) return stale();
  if (dir === 'back') {
    let left: Place | undefined;
    for (const p of tab.places) {
      if (p.idx > idx && p.idx <= tab.lastIdx && (left === undefined || p.idx < left.idx)) left = p;
    }
    if (left !== undefined) {
      if (!tab.host) return { kind: 'consume' };
      if (left.kind === 'overlay') return { kind: 'close-overlay' };
      if (left.id === undefined) return { kind: 'consume' };
      const closes = tab.places.some((p) => p.kind === 'overlay' && p.idx > idx && p.idx <= tab.lastIdx);
      return {
        kind: 'goto', id: left.id,
        ...(left.from !== undefined ? { from: left.from } : { toTop: true as const }),
        ...(closes ? { close: true as const } : {}),
      };
    }
    if (place !== null) return { kind: 'consume' };
    return { kind: 'router' };
  }
  if (place !== null) {
    const held = tab.places.find((p) => p.seq === place.seq);
    if (held === undefined) return stale();
    if (held.kind === 'jump' && held.id !== undefined) return { kind: 'goto', id: held.id };
    return { kind: 'consume' };
  }
  return { kind: 'router' };
}

/** The record after one pop, and the index the entry landed on must be stamped with (null for none). The index rule:
 *  - every decision sets `lastIdx` to the popped entry's index when it has one: a skip too, so a skip at the top of
 *    history that cannot step does not trap the next Back;
 *  - a skip counts one more consecutive skip in its direction (a skip the other way starts at one), and anything else
 *    resets the count;
 *  - everything but a skip clears `pendingSeq` (a real landing ends the wait);
 *  - the router on an entry with no index stamps it with `next`, so every routed entry is numbered, and it is the
 *    newest entry the tab holds (`top`): `navigate`'s push is such a pop;
 *  - `next` never falls to or below an index already shown: it rises to one above the popped entry's, so a lost record
 *    never hands out a number already in use. */
export function afterPop(rec: TabRecord, popped: unknown, d: PopDecision): { rec: TabRecord; stamp: number | null } {
  const { idx } = readEntry(popped);
  const out: TabRecord = {
    ...rec,
    places: rec.places.slice(),
    skips: d.kind === 'skip' ? (rec.skipDir === d.dir ? rec.skips : 0) + 1 : 0,
    skipDir: d.kind === 'skip' ? d.dir : null,
    pendingSeq: d.kind === 'skip' ? rec.pendingSeq : null,
  };
  if (idx !== null) {
    out.lastIdx = idx;
    out.next = Math.max(rec.next, idx + 1);
    out.top = atLeast(rec.top, idx);
    return { rec: out, stamp: null };
  }
  if (d.kind === 'router') {
    const stamp = rec.next;
    out.lastIdx = stamp;
    out.next = stamp + 1;
    out.top = stamp;
    return { rec: out, stamp };
  }
  return { rec: out, stamp: null };
}

/** A reader body starts on the entry `current`. The same doc as the record's visit continues that visit (a remount, a
 *  sign-in remount, a reload), the record untouched except that its counter rises above the entry's index. Any other
 *  doc starts a new visit under `newVisitId` with no places and no budget spent; the entry the visit stands on is its
 *  base entry, stamped when it has no index, and `lastIdx` is that entry's. The caller strips an ended visit's
 *  `docsPlace` from a base entry when `continued` is false. */
export function beginVisit(
  rec: TabRecord, doc: string, newVisitId: string, current: { idx: number | null },
): { rec: TabRecord; continued: boolean; stamp: number | null } {
  const seeded = current.idx === null ? rec.next : Math.max(rec.next, current.idx + 1);
  if (rec.visit !== null && rec.doc === doc) {
    return { rec: { ...rec, places: rec.places.slice(), next: seeded }, continued: true, stamp: null };
  }
  const base: TabRecord = {
    ...rec, visit: newVisitId, doc, places: [], seq: 0, pendingSeq: null, skips: 0, skipDir: null, next: seeded,
  };
  if (current.idx !== null) return { rec: { ...base, lastIdx: current.idx }, continued: false, stamp: null };
  return { rec: { ...base, lastIdx: seeded, next: seeded + 1 }, continued: false, stamp: seeded };
}

/** The reader's body ended for another doc or a screen that is not a doc: the visit is over, its places with it. The
 *  entry counter and the entry last shown are the tab's, and stay. */
export function endVisit(rec: TabRecord): TabRecord {
  return { ...rec, visit: null, doc: null, places: [], seq: 0, pendingSeq: null };
}

/** The key of one body's visit: its address, then a NUL, then its scope (a body shown in parts has one scope per part, so
 *  each part is a visit of its own; a body with no parts has the empty scope). */
export const visitKey = (address: string, scope: string): string => `${address}\u0000${scope}`;

/** Whether a body's end ends the visit: the visit is still the record's, and the record's address (the key's text before
 *  its first NUL, or the whole key when it has none) is not `address`, the address the page is on now. A change of scope
 *  on the same address (the next part of a doc) ends nothing: the next body's start sees another key. */
export function visitEnds(rec: TabRecord, visit: string | null, address: string): boolean {
  if (visit === null || rec.visit !== visit) return false;
  const doc = rec.doc ?? '';
  const cut = doc.indexOf('\u0000');
  return (cut < 0 ? doc : doc.slice(0, cut)) !== address;
}

/** The frame reported a place. With no visit, or with `PLACES_MAX` places already pushed in this one, nothing is
 *  pushed (`push` null). Otherwise the current entry is numbered first when it has no index, then the new place takes the
 *  next one: `seq` is one above the count, `lastIdx` is the new entry's, and `push` is what the caller writes into the
 *  new entry's state. The push removes every entry above the current one from history, so the places recorded above it
 *  leave the record too: the record holds only places that are still entries.
 *  `strip` is true when the entry pushed from holds a place of another visit (`current.place`): the caller rewrites it
 *  without that place before pushing, as a new visit's start does, so the entry below the new place is never stale and
 *  one Back undoes the place. `numbered` is the record after the numbering alone (null when the entry already had a
 *  number): the caller writes it when the push is refused after the numbering was written, so the number stays taken. */
export function pushPlace(
  rec: TabRecord, p: { kind: PlaceKind; id?: string; from?: string },
  current: { idx: number | null; place?: EntryPlace | null },
): {
  rec: TabRecord; push: { idx: number; place: EntryPlace } | null; stamp: number | null; strip: boolean; numbered: TabRecord | null;
} {
  if (rec.visit === null || rec.seq >= PLACES_MAX) return { rec, push: null, stamp: null, strip: false, numbered: null };
  let next = current.idx === null ? rec.next : Math.max(rec.next, current.idx + 1);
  let stamp: number | null = null;
  if (current.idx === null) {
    stamp = next;
    next += 1;
  }
  const here = current.idx ?? (stamp as number);
  const idx = next;
  const seq = rec.seq + 1;
  const extra = { ...(p.id !== undefined ? { id: p.id } : {}), ...(p.from !== undefined ? { from: p.from } : {}) };
  const place: Place = { seq, kind: p.kind, idx, ...extra };
  const kept = rec.places.filter((q) => q.idx <= here);
  return {
    rec: { ...rec, places: [...kept, place], seq, lastIdx: idx, next: idx + 1, top: idx },
    push: { idx, place: { visit: rec.visit, seq, kind: p.kind, ...extra } },
    stamp,
    strip: current.place !== undefined && current.place !== null && current.place.visit !== rec.visit,
    numbered: stamp === null ? null : { ...rec, places: rec.places.slice(), lastIdx: stamp, next: stamp + 1 },
  };
}

/** The frame closed its overlay itself (Esc or Close). When the entry last shown is this visit's overlay place, the
 *  overlay's entry is still on top of its base: answer `back: true` so the console steps back once, and expect that
 *  landing (`pendingSeq` is the seq of the place pushed just before it, or 0, the base entry, when it is the first), so
 *  the pop is consumed and nothing else. Anything else changes nothing. */
export function closedByFrame(rec: TabRecord): { rec: TabRecord; back: boolean } {
  const i = rec.places.findIndex((p) => p.idx === rec.lastIdx);
  const left = rec.places[i];
  if (left === undefined || left.kind !== 'overlay') return { rec, back: false };
  const before = rec.places[i - 1];
  return { rec: { ...rec, places: rec.places.slice(), pendingSeq: before === undefined ? 0 : before.seq }, back: true };
}
