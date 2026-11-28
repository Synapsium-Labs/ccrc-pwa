// The device's reader layout (X2 P5.1, spec 2026-11-18 4.2, D-8762): the one stored choice of which of the five layouts the Docs
// reader opens in, kept per device in the library's own prefs object (`ccrc:reader:v1:pref:prefs`, the key the frame's `prefs` pref
// uses under `READER_STORE_PREFIX`), beside the fields the library keeps there. Ring L3 adapter: it reads and writes page storage
// (`lib/storage.ts`) and keeps a tiny synchronous list of listeners; every decision about the text is `policy.ts`'s
// (`readerLayoutOfPref`, `withLayoutInPref`).
//
// This file is the ONE writer of the `layout` field. The reader frame writes the library's prefs object back from the snapshot it was
// mounted with (unknown fields included) on any prefs change, so a frame that outlives a choice would put the old layout over the new
// one; the storage port the bridge hands the library therefore keeps the stored `layout` through every frame write
// (`bridge.ts`, `policy.ts#withStoredLayoutKept`), and no frame write can change the field. A choice reaches its listeners in the same
// task as its write: the listener `ReaderFrame` subscribes is called here, by the write itself, so the new mount reads the new value.
// A storage that is absent or throws reads `default` and is not written; the listeners still run, so the page in front of the reader
// still changes layout for this visit.
//
// The module also holds the one fact "a Layout choice ended the visit's variant at this address" (I-2): a `?variant=` names the layout
// of one visit, and a choice made from the Layout row or the palette ends it for the rest of that page. It is the address
// (`location.pathname + location.search`) the latest choice was made at, in module state, so a reload (a new visit) starts empty. The
// Docs screen reads it to derive the page it hands every view (`docsLinkBase.ts#pageAfterVariantEnded`), so no view reads the raw
// address for its links.
import { readKey, writeKey } from '../../lib/storage';
import { READER_PREFS_KEY, readerLayoutOfPref, withLayoutInPref, type ReaderLayout } from './policy';

const listeners = new Set<(layout: ReaderLayout) => void>();
/** The address the latest choice was made at, `null` until this page loads makes one. */
let chosenAt: string | null = null;

/** The device's layout: the prefs object's `layout` when it is one of the five names, else `default` (nothing stored, an unreadable
 *  or foreign object, a name no build knows, or a storage that throws). */
export function readReaderLayout(): ReaderLayout {
  return readerLayoutOfPref(readKey(READER_PREFS_KEY));
}

/** Chooses `layout` for this device: records the address it is made at, writes it into the stored prefs (every other field of the
 *  object kept as it was), then calls every listener, in the order they subscribed, before returning. A refused write is skipped, and
 *  the listeners run anyway. */
export function chooseReaderLayout(layout: ReaderLayout): void {
  chosenAt = window.location.pathname + window.location.search;
  writeKey(READER_PREFS_KEY, withLayoutInPref(readKey(READER_PREFS_KEY), layout));
  for (const listener of [...listeners]) listener(layout);
}

/** The address a Layout choice was last made at on this page load (`pathname` and `search`, as the Docs screen reads its own), or
 *  `null` for none: the visit's variant ended there, and nowhere else. */
export function readerLayoutChosenAt(): string | null {
  return chosenAt;
}

/** Forgets where a choice was made, as a reload does (the module starts empty). For tests of a second visit in one page load. */
export function resetReaderLayoutChoiceForTests(): void {
  chosenAt = null;
}

/** Calls `listener` with each layout chosen from now on; returns the unsubscribe. */
export function onReaderLayout(listener: (layout: ReaderLayout) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
