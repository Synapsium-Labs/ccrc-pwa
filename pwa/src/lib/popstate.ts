// The one `popstate` listener of the page (X2 P5.3, D-8763; parity spec 4.7). Ring L4 delivery: it names `window` and
// `history`, and it decides nothing. On every `popstate` it asks `historyPlaces.ts` (L1) what the pop means, writes the
// tab record the decider's index rule hands back, and acts: the router's pop runs every subscriber, in order, and every
// other answer runs none of them. The decider runs BEFORE any subscriber, so a pop that is the console's own, or a place
// to step over, never reaches a screen. `navigate`, the shell's `useLocation`, the reader's day filter and the release
// gate all subscribe here through `onPop`; nothing else in `pwa/src` adds a `popstate` listener (a source scan pins it).
//
// The window's listener is added when the first subscriber arrives and removed when the last leaves. The reader's places
// module (`docs/reader/places.ts`) registers the mounted frame as the place host (`setPlaceHost`) and reads and writes the
// tab record through `readPlaces` and `writePlaces`: nobody else writes the record.
import {
  PLACES_RECORD_KEY, afterPop, decidePop, parseRecord, seedPage, type PopDecision, type TabRecord,
} from './historyPlaces';
import { readKey, removeKey, tabStorage, UNREADABLE, writeKey } from './storage';

/** What a mounted reader gives the dispatcher for the pops that are the frame's. */
export interface PlaceHost {
  closeOverlay(): void;
  goto(id: string, from?: string): void;
}

interface Subscription {
  readonly listener: () => void;
  active: boolean;
}

let subscribers: Subscription[] = [];
let installed = false;
/** Whether this page has read the entry it loaded on into the record (`seedPage`). */
let seeded = false;
let host: PlaceHost | null = null;
/** The record as this page last wrote it: a store that throws or loses the key still works within the page. */
let memo: TabRecord | null = null;

const copy = (r: TabRecord): TabRecord => ({ ...r, places: r.places.slice() });

/** The tab's record: this page's own copy once the page has written one (a write the store refused never leaves an
 *  older stored record winning), else the stored one, which a reload of the tab finds, else the empty record. */
export function readPlaces(): TabRecord {
  if (memo !== null) return copy(memo);
  const raw = readKey(PLACES_RECORD_KEY, tabStorage, UNREADABLE);
  return parseRecord(typeof raw === 'string' ? raw : null);
}

/** Keep the tab's record: in this page's memory, and in the tab's storage where the store takes it. */
export function writePlaces(rec: TabRecord): void {
  memo = copy(rec);
  writeKey(PLACES_RECORD_KEY, JSON.stringify(rec), tabStorage);
}

/** The mounted reader's: it takes the pops that close the overlay or return from a jump. `null` when none is mounted. */
export function setPlaceHost(next: PlaceHost | null): void {
  host = next;
}

/** Run every subscriber, in subscription order, each one even when an earlier one threw; the first throw is rethrown
 *  after all have run, and every later one is reported as an uncaught error would be, as separate listeners' were. A
 *  subscriber that left while the pass ran is skipped. */
function runSubscribers(): void {
  let failed = false;
  let first: unknown;
  for (const s of subscribers.slice()) {
    if (!s.active) continue;
    try {
      s.listener();
    } catch (e) {
      if (!failed) {
        failed = true;
        first = e;
      } else if (typeof reportError === 'function') {
        reportError(e);
      } else {
        console.error(e);
      }
    }
  }
  if (failed) throw first;
}

/** Act on a decision that is not the router's. A throwing frame changes nothing else. */
function act(d: PopDecision, at: PlaceHost | null): void {
  if (d.kind === 'skip') {
    if (d.dir === 'back') history.back();
    else history.forward();
    return;
  }
  try {
    if (d.kind === 'close-overlay') at?.closeOverlay();
    else if (d.kind === 'goto') at?.goto(d.id, d.from);
  } catch (e) {
    console.warn('ccrc: the reader frame refused a history command', e);
  }
}

function onWindowPop(): void {
  const state: unknown = history.state;
  const rec = readPlaces();
  const d = decidePop(state, {
    visit: rec.visit, places: rec.places, pendingSeq: rec.pendingSeq, lastIdx: rec.lastIdx, skips: rec.skips,
    skipDir: rec.skipDir, host: host !== null,
  });
  const after = afterPop(rec, state, d);
  writePlaces(after.rec);
  if (after.stamp !== null) {
    // The entry keeps its state and its URL; only its number is added. A browser that refuses the history call (one
    // made too fast) leaves the entry unnumbered, and the pop still routes.
    const kept = typeof state === 'object' && state !== null && !Array.isArray(state) ? state : {};
    try {
      history.replaceState({ ...kept, docsIdx: after.stamp }, '');
    } catch (e) {
      console.warn('ccrc: the history entry could not be numbered', e);
    }
  }
  if (d.kind === 'router') runSubscribers();
  else act(d, host);
}

function uninstall(): void {
  if (!installed) return;
  window.removeEventListener('popstate', onWindowPop);
  installed = false;
}

/** Subscribe to the router's pops: `listener` runs synchronously, in subscription order, inside the `popstate` event,
 *  and only when the decider says the pop is the router's. Returns the unsubscribe, which is idempotent. */
export function onPop(listener: () => void): () => void {
  const s: Subscription = { listener, active: true };
  subscribers.push(s);
  if (!seeded) {
    // Once per page, before its first pop: the entry the page loaded on says where the tab stands.
    seeded = true;
    writePlaces(seedPage(readPlaces(), history.state));
  }
  if (!installed) {
    window.addEventListener('popstate', onWindowPop);
    installed = true;
  }
  return () => {
    if (!s.active) return;
    s.active = false;
    subscribers = subscribers.filter((x) => x !== s);
    if (subscribers.length === 0) uninstall();
  };
}

/** Tests only: how many subscriptions are live now. A module mock cannot count a subscriber whose module the test setup
 *  loaded before the mock was registered (the release gate's, loaded with the fleet store), so a test reads this. */
export function popSubscriberCountForTests(): number {
  return subscribers.length;
}

/** Tests only: drop every subscriber, the window listener, the host, this page's copy of the record and the stored one. */
export function resetPopstateForTests(): void {
  for (const s of subscribers) s.active = false;
  subscribers = [];
  uninstall();
  host = null;
  memo = null;
  seeded = false;
  removeKey(PLACES_RECORD_KEY, tabStorage);
}
