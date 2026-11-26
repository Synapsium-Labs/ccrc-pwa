// The reader's places (X2 P5.3, D-8763; parity spec 4.7): what a reader body does with the frame's reports of a place, and
// the host it registers for the pops that are the frame's. Ring L4 delivery: it names `history`, `location` and
// `crypto`, and it decides nothing. Every decision (is a place pushed, which number it takes, what Back means, what a
// frame's own close expects) is `lib/historyPlaces.ts`'s, the pure L1 decider; the page's one `popstate` listener and the
// tab's record are `lib/popstate.ts`'s, and this file reads and writes that record only through `readPlaces` and
// `writePlaces`.
//
// A body starts a visit (`startPlaces`, before its frame mounts) for the doc it shows: the page address less its
// fragment. The same doc as the record's visit continues that visit (a remount, a sign-in remount, a reload), another
// starts a new one, whose base entry is the entry the page stands on. The frame then reports: `onPlace('overlay')` and
// a `hash` with `push` each push one entry, tagged with the visit; `onPlace('overlay-closed')` asks the decider whether
// the frame closed its overlay over that entry's place, and if so steps back once. A pushed entry carries the page's
// current URL (a jump's with its id as the fragment instead, D-9117) and the current history state (so the reader's day
// filter survives) and nothing from the frame but the id and the position token it gave: the port's nonce is the
// port's alone and never reaches the state. When the body ends, the visit ends only if the page has moved to another
// doc or to a screen that is not a doc.
import {
  IDX_KEY, PLACE_KEY, beginVisit, closedByFrame, endVisit, jumpEntryUrl, pushPlace, readEntry, visitEnds, visitKey,
  type PlaceKind,
} from '../../lib/historyPlaces';
import { readPlaces, setPlaceHost, writePlaces } from '../../lib/popstate';
import { replaceFragment } from '../../lib/router';
import type { ReaderMountInput } from './bridge';

/** What the frame reports of its full-screen figure (the library's own words, through the mount input's `onPlace`). */
export type FramePlace = Parameters<NonNullable<ReaderMountInput['onPlace']>>[0];

/** What a body gets of its visit. */
export interface Places {
  /** The frame's full-screen figure opened or closed. */
  onPlace(kind: FramePlace): void;
  /** The frame went to the place `id`. A move marked `push` is a place to return to (an entry is pushed); any other
   *  replaces the page's fragment, as the scroll report always has. */
  onHash(id: string, entry?: { readonly push: boolean; readonly from: string | null; readonly inGrammar: boolean }): void;
  /** The mounted frame, for the pops that are its: `null` when it is dropped or fell back. */
  host(mount: { closeOverlay?(): void; goto?(id: string, from?: string): void } | null): void;
  /** The body ended: the visit ends when the page is on another doc or a screen that is not a doc now. */
  end(): void;
}

/** The doc a visit is for: the page address less its fragment. */
export const docNow = (): string => location.pathname + location.search;

/** A fresh visit id. Random and never the port's nonce. Not every context has `randomUUID` (an insecure page does not). */
function randomVisitId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The current history state as an object to copy (any other value copies as no keys). */
const currentState = (): Record<string, unknown> => {
  const s: unknown = history.state;
  return typeof s === 'object' && s !== null && !Array.isArray(s) ? { ...(s as Record<string, unknown>) } : {};
};

/** Starts one body's visit. Reads the tab's record, begins or continues the visit for the body (`o.doc` under `o.scope`:
 *  a doc shown in parts has one scope per part, so each part is a visit of its own), drops an ended visit's place from the
 *  base entry it stands on (a new visit only), numbers that entry when it has no number, and keeps the record. */
export function startPlaces(o: { doc: string; scope?: string; newVisitId?: () => string }): Places {
  const entry = readEntry(history.state);
  const begun = beginVisit(readPlaces(), visitKey(o.doc, o.scope ?? ''), (o.newVisitId ?? randomVisitId)(), { idx: entry.idx });
  writePlaces(begun.rec);
  const strip = !begun.continued && entry.place !== null;
  if (strip || begun.stamp !== null) {
    // The entry keeps its state and its URL: only the ended visit's place goes, and the number is added.
    const next = currentState();
    if (strip) delete next[PLACE_KEY];
    if (begun.stamp !== null) next[IDX_KEY] = begun.stamp;
    try {
      history.replaceState(next, '');
    } catch (e) {
      console.warn('ccrc: the history entry could not be updated for the reader\'s visit', e);
    }
  }
  const visit = begun.rec.visit;
  /** Clears this body's host from the dispatcher, only while that host is still the dispatcher's. */
  let unregister: (() => void) | null = null;

  /** Pushes one place's entry over the current state, at `url` (the page's current URL by default). False when nothing
   *  was pushed (the visit's budget is spent, or the history call was refused). */
  const push = (p: { kind: PlaceKind; id?: string; from?: string }, url: string = location.href): boolean => {
    const rec = readPlaces();
    const pushed = pushPlace(rec, p, { idx: readEntry(history.state).idx });
    if (pushed.push === null) return false;
    try {
      if (pushed.stamp !== null) history.replaceState({ ...currentState(), [IDX_KEY]: pushed.stamp }, '');
      history.pushState({ ...currentState(), [IDX_KEY]: pushed.push.idx, [PLACE_KEY]: pushed.push.place }, '', url);
    } catch (e) {
      console.warn('ccrc: the history entry for a place could not be pushed', e);
      return false;
    }
    writePlaces(pushed.rec);
    return true;
  };

  const host: Places['host'] = (mount) => {
    unregister?.();
    unregister = null;
    if (mount === null) return;
    unregister = setPlaceHost({ closeOverlay: () => mount.closeOverlay?.(), goto: (id, from) => mount.goto?.(id, from) });
  };

  return {
    onPlace(kind) {
      if (kind === 'overlay') {
        push({ kind: 'overlay' });
        return;
      }
      const closed = closedByFrame(readPlaces());
      if (!closed.back) return;
      writePlaces(closed.rec);
      history.back();
    },
    onHash(id, hashEntry) {
      if (hashEntry?.push === true) {
        const place = { kind: 'jump' as const, id, ...(hashEntry.from === null ? {} : { from: hashEntry.from }) };
        // The entry's address is `jumpEntryUrl`'s (D-9117). An id outside the fragment grammar never reaches the address,
        // not even through the fragment replace below, and the frame's report is not swallowed.
        const at = jumpEntryUrl(location, id, hashEntry.inGrammar);
        const pushed = push(place, at.url);
        if (at.report) {
          console.warn(pushed
            ? 'ccrc: a jump\'s id is outside the fragment grammar, so its history entry keeps the current address'
            : 'ccrc: a jump\'s id is outside the fragment grammar, and no history entry was pushed for it');
          return;
        }
        if (pushed) return;
      }
      replaceFragment(id);
    },
    host,
    end() {
      host(null);
      const rec = readPlaces();
      if (visitEnds(rec, visit, docNow())) writePlaces(endVisit(rec));
    },
  };
}
