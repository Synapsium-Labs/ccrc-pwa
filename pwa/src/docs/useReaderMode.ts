// Reader mode's hook (native Docs reader, reader-mode plan Task XR1.2 as amended 2026-11-24, D-8975; spec 2026-11-20 sections
// 4.1, 4.2, 6.3 and 6.5). Ring L4 delivery: it OWNS the things a browser makes real (the reading container's attribute, element
// full screen, the console's hiding, the frame's `reading` op, the live region, the Docs screen's one `fullscreenchange`
// subscription, the settle timer, the wake lock and its idle timer) and it DECIDES NOTHING. Every decision is `reader/readerMode.ts`'s:
// each event runs `readerModeStep` over the current state, the next state is stored at once (a ref, so an act that re-enters
// sees it), the acts are applied in the order handed over, and only then does React hear of the new state. What is offered is
// `readerModeOffered`'s, read at each call; when the screen wants the wake lock is `wakeLockWanted`'s, re-read on every state
// change, on activity, on the idle timer and on the page clock's visible and hidden (`lib/pageClock.ts`, never a
// `visibilitychange` of this file's own).
//
// The reader place (XR1.3): the default port is `READER_PLACES`, the history half's own functions (`reader/places.ts`), and the
// hook registers its host with the pop dispatcher (`setReaderPlaceHost`, through the port's `register`) for its whole life. The hook is the one writer of
// `exitPending` true on its paths: it marks before it steps back (or before it arms the settle) and unmarks when nothing was
// stepped; the pop decider clears the mark when the landing is consumed.
//
// The frame (XR1.4 with XR2.1, D-8975): `ReaderFrame` hands the hook its ready frame (`setFrame`, which steps `frame-ready` so the
// frame is brought to the reading in force), asks it which reading a mount is made under (`readingFor`), and reports the frame's
// own `reader` acts (`menu`, `frameExit`, `frameToggle`) and its activity. The hook subscribes to no window blur. The overlay
// (`ReaderModeOverlay`, drawn by `DocsReading`) reads the stored frame's title and progress from the context and acts through
// `exit`, `aa`, `dismiss`, `escOverlay` and `activity`; `aa` hides the overlay first, then sends `command('settings')`. What is
// left to the later task: the stored turn (XR2.2).
import { createContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { hideAsPage, releaseAsPage, type PageHiding } from '@ccrc/ui';
import { useAuthLost } from '../lib/auth';
import { onPageHidden, onPageVisible } from '../lib/pageClock';
import { setReaderPlaceHost, type ReaderPlaceHost } from '../lib/popstate';
import { useFleetStore } from '../stores/fleet';
import type { ReaderCommand } from './reader/policy';
import type { ReaderProgress } from './readerBar';
import {
  landedBelowReaderPlace, markReaderExitPending, pushReaderPlace, readerPlaceFreeNow, standingOnDeadReaderEntry,
  stepBelowReaderPlace,
} from './reader/places';
import {
  READER_EXIT_SETTLE_MS, READER_MODE_OFF, READER_WAKE_IDLE_MS, readerModeOffered, readerModeStep, wakeLockWanted,
  type ReaderModeAct, type ReaderModeEvent, type ReaderModeHow, type ReaderModeState, type ReaderReading, type ReaderTurn,
} from './reader/readerMode';
import { READER_MODE_TEXT } from './reader/readerModeWords';

/** The frame, as reader mode needs it: ready or not, whether its mount was made under a reading (sent `setReading` before its
 *  ready, which `frame-ready` reads), focus, the `reading` op, and, for the overlay, the document's title, how far it has been
 *  read and the frame's own commands (`command('settings')`). No remount and no layout (D-8975). */
export interface ReaderModeFrame {
  readonly ready: boolean;
  readonly planned: boolean;
  focus(): void;
  setReading(mode: ReaderReading): void;
  command(name: ReaderCommand): void;
  readonly title: string;
  readonly progress: ReaderProgress;
}

/** The history port reader mode acts through (consumer-declared; `READER_PLACES` is the real one). `placeFree`: the place budget has
 *  room. `push`: push the reader place, true when it was pushed. `stepBack`: undo the pushed place once, answering how many
 *  entries it stepped over. `landedBelow`: a pop already landed below the reader place. `markExitPending`: tell the pop
 *  dispatcher an exit is waiting on a settle, or that it no longer is. `register`: give the pop dispatcher the hook's host,
 *  returning the unregister. `standingOnDead`: the tab stands on a dead reader entry (reader mode off), asked once right after
 *  registering. The hook names nothing of the dispatcher or the record but through this port. */
export interface ReaderModePlaces {
  placeFree(): boolean;
  push(): boolean;
  stepBack(): number;
  landedBelow(): boolean;
  markExitPending(on: boolean): void;
  register(host: ReaderPlaceHost): () => void;
  standingOnDead(): boolean;
}

/** Places nothing, steps nothing and lands nowhere: a port for a test that wants no history. With it `placeFree` is false, so
 *  reader mode enters unplaced and an exit has no place to undo. */
export const NO_READER_PLACES: ReaderModePlaces = Object.freeze({
  placeFree: () => false,
  push: () => false,
  stepBack: () => 0,
  landedBelow: () => false,
  markExitPending: () => undefined,
  register: () => () => undefined,
  standingOnDead: () => false,
});

/** The real port: the history half's own functions (`reader/places.ts`) and the dispatcher's host slot, the default of the
 *  hook. */
export const READER_PLACES: ReaderModePlaces = Object.freeze({
  placeFree: readerPlaceFreeNow,
  push: pushReaderPlace,
  stepBack: stepBelowReaderPlace,
  landedBelow: landedBelowReaderPlace,
  markExitPending: markReaderExitPending,
  register: setReaderPlaceHost,
  standingOnDead: () => standingOnDeadReaderEntry(false),
});

/** What the head, the frame's mount and the overlay see of reader mode. */
export interface ReaderModeContextValue {
  readonly state: ReaderModeState;
  /** Whether the entry is drawn: a ready frame outside the plain view. The modal-layer test is read at each `enter`. */
  readonly offered: boolean;
  readonly turn: ReaderTurn;
  enter(by: 'button' | 'key'): void;
  exit(cause: 'exit-tap' | 'key'): void;
  menu(): void;
  escOverlay(): void;
  activity(): void;
  dismiss(): void;
  /** The overlay's Aa (X6 XR2.1, D-8803): hides the overlay and its layer FIRST (`dismiss`), then sends the frame's
   *  `command('settings')`, so its settings menu is never under the layer; counted as activity. */
  aa(): void;
  /** The frame stored now (title, progress and commands for the overlay); `null` while none is stored. */
  readonly frame: ReaderModeFrame | null;
  /** A ready frame is stored and brought to the reading in force (`frame-ready`); `null` clears the stored one, as `dropFrame` does. */
  setFrame(f: ReaderModeFrame | null): void;
  /** Clears the stored frame only when it is `f`: a body that ends never clears the frame of the body that replaced it. A frame
   *  that goes while the overlay shows hides the overlay (reader mode stays on). */
  dropFrame(f: ReaderModeFrame): void;
  setFallback(): void;
  /** The reading a mount made now for the document `doc` is made under: the turn when reader mode is on for that document and it is
   *  still the screen's current one, else `off`. */
  readingFor(doc: string | null): ReaderReading;
  /** The frame's own `exit` act. */
  frameExit(): void;
  /** The frame's own `toggle` act (`r` in the frame): enters or exits, read as `enter` reads its facts. */
  frameToggle(): void;
}

/** Null outside a Docs screen. */
export const ReaderModeContext = createContext<ReaderModeContextValue | null>(null);

/** What `DocsReading` needs from the hook: the container's ref, the attribute and the live text to render, and the one act the
 *  focus guards take. */
export interface ReaderModeContainer {
  setContainer(el: HTMLElement | null): void;
  readonly on: boolean;
  /** The attribute's value: `undefined` (absent) when reader mode is off. */
  readonly how: ReaderModeHow | undefined;
  readonly live: string;
  focusFrame(): void;
}

/** The outside door's face of the same hook (`readerModeHandle.ts`): read at the moment of the act, never a render's copy. */
export interface ReaderModeControls {
  offered(): boolean;
  /** `offered()` without the modal-layer clause (the context's render-time offer, read now): what a listing asks, since the
   *  listing may itself be a layer. */
  available(): boolean;
  on(): boolean;
  toggle(): void;
}

/** How the reader turns the page. XR2.2 stores it per device; until then every reading is screens. */
const READER_TURN: ReaderTurn = 'screens';

const noop = (): void => undefined;

interface Sink {
  state(s: ReaderModeState): void;
  live(text: string): void;
  frame(f: ReaderModeFrame | null): void;
}

/** The mutable half of the hook: refs and handles, in closures. One per mount of the hook, never rebuilt by a render. */
function createController(sink: Sink) {
  let state: ReaderModeState = READER_MODE_OFF;
  let container: HTMLElement | null = null;
  let frame: ReaderModeFrame | null = null;
  let input: { doc: string | null; plainView: boolean; places: ReaderModePlaces } = { doc: null, plainView: false, places: READER_PLACES };
  let hiding: PageHiding | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActivity = 0;
  let sentinel: WakeLockSentinel | null = null;
  let requesting = false;
  let alive = true;

  // ── the wake lock (spec 6.3) ──
  const wantedNow = (): boolean => wakeLockWanted({
    on: state.on, visible: document.visibilityState === 'visible', lastActivityMs: lastActivity, nowMs: Date.now(),
  });
  const releaseSentinel = (s: WakeLockSentinel): void => {
    try { void Promise.resolve(s.release()).catch(noop); } catch { /* a release that throws changes nothing */ }
  };
  const requestWake = (): void => {
    const api: WakeLock | undefined = navigator.wakeLock;
    if (api === undefined || typeof api.request !== 'function') return;
    requesting = true;
    let pending: Promise<WakeLockSentinel>;
    try { pending = api.request('screen'); } catch { requesting = false; return; }
    Promise.resolve(pending).then((s) => {
      requesting = false;
      // No longer wanted by the time it was granted: let it go at once.
      if (!alive || !wantedNow()) { releaseSentinel(s); return; }
      sentinel = s;
      s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    }, () => { requesting = false; });
  };
  const syncWake = (): void => {
    if (wantedNow()) {
      if (sentinel === null && !requesting) requestWake();
      return;
    }
    const s = sentinel;
    sentinel = null;
    if (s !== null) releaseSentinel(s);
  };
  const clearIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };
  /** The one idle timer: it fires at the last activity plus the idle time and re-reads `wakeLockWanted`. */
  const armIdle = (): void => {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      syncWake();
      if (state.on && wantedNow()) armIdle();
    }, Math.max(0, lastActivity + READER_WAKE_IDLE_MS - Date.now()));
  };

  // ── the acts ──
  /** Marks the exit's landing as expected, then steps below the reader place; the mark is cleared again when nothing was
   *  stepped (no landing is coming). The one path of `step-back` and of `leaveDead`. */
  const stepBelow = (): void => {
    input.places.markExitPending(true);
    if (input.places.stepBack() === 0) input.places.markExitPending(false);
  };
  const requestFullScreen = (): void => {
    const c = container;
    if (c === null) return;
    let pending: Promise<void> | undefined;
    try { pending = c.requestFullscreen({ navigationUI: 'hide' }); } catch { step({ kind: 'full-screen-refused' }); return; }
    Promise.resolve(pending).then(
      () => { if (alive) step({ kind: 'full-screen-granted' }); },
      () => { if (alive) step({ kind: 'full-screen-refused' }); },
    );
  };
  const perform = (act: ReaderModeAct): void => {
    const c = container;
    switch (act) {
      case 'draw-fill':
        // Written here, synchronously, so it is set before the full-screen request resolves (spec 4.1); React renders the same
        // value from the state.
        c?.setAttribute('data-reader-mode', 'fill');
        break;
      case 'push-place':
        input.places.push();
        break;
      case 'request-full-screen':
        requestFullScreen();
        break;
      case 'exit-full-screen':
        if (c !== null && document.fullscreenElement === c) {
          try { void Promise.resolve(document.exitFullscreen()).catch(noop); } catch { /* a throw is ignored like a rejection */ }
        }
        break;
      case 'clear-fill':
        c?.removeAttribute('data-reader-mode');
        break;
      case 'hide-console':
        if (c !== null) {
          if (hiding !== null) releaseAsPage(hiding);
          hiding = hideAsPage(c);
        }
        break;
      case 'show-console':
        if (hiding !== null) releaseAsPage(hiding);
        hiding = null;
        break;
      case 'start-reading':
        frame?.setReading(READER_TURN);
        break;
      case 'stop-reading':
        frame?.setReading('off');
        break;
      case 'focus-frame':
        frame?.focus();
        break;
      case 'announce':
        // Cleared first, so a repeat of the same sentence is announced again.
        sink.live('');
        queueMicrotask(() => { if (alive) sink.live(READER_MODE_TEXT.live); });
        break;
      case 'step-back':
        stepBelow();
        break;
      case 'await-settle':
        input.places.markExitPending(true);
        if (settleTimer !== null) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          const landedBelow = input.places.landedBelow();
          if (landedBelow) input.places.markExitPending(false);
          step({ kind: 'settled', landedBelow });
        }, READER_EXIT_SETTLE_MS);
        break;
    }
  };

  /** The one step: decide (L1), store, act in order, tell React, re-read the wake lock. */
  function step(event: ReaderModeEvent): void {
    const before = state;
    const answer = readerModeStep(before, event);
    state = answer.state;
    if (!before.on && answer.state.on) {
      lastActivity = Date.now();   // entering counts as activity
      // An entry during an exit's settle (by `enter` or by the frame's toggle): the old settle must not run into the new reading,
      // it would step back its place.
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
        input.places.markExitPending(false);
      }
    }
    for (const act of answer.acts) perform(act);
    if (alive) sink.state(answer.state);
    if (state.on) armIdle(); else clearIdle();
    syncWake();
  }

  /** Clears the stored frame only when it is `f`. A frame that goes while the overlay shows takes the overlay with it (`dismiss`,
   *  stepped after the frame is cleared so it focuses nothing): reader mode stays on, and the next frame's ready never draws the
   *  overlay again, which would pull focus to Exit unasked. */
  function dropFrame(f: ReaderModeFrame): void {
    if (frame !== f) return;
    frame = null;
    sink.frame(null);
    step({ kind: 'dismiss' });
  }

  const offered = (): boolean => readerModeOffered({
    frameReady: frame?.ready === true,
    plainView: input.plainView,
    modalMounted: document.querySelector('[role="dialog"]') !== null,
  });
  /** The offer less the modal-layer clause, the context's render-time answer read now: a listing (the shortcut sheet is a
   *  dialog itself) asks this, never `offered`. */
  const available = (): boolean => readerModeOffered({ frameReady: frame?.ready === true, plainView: input.plainView, modalMounted: false });
  const exit = (cause: 'exit-tap' | 'key'): void => step({ kind: cause });
  const enter = (_by: 'button' | 'key'): void => {
    const c = container;
    const doc = input.doc;
    // The offer is read now, every time: a modal layer can mount between a render and a tap.
    if (c === null || doc === null || !offered()) return;
    step({
      kind: 'enter', doc,
      activation: navigator.userActivation?.isActive ?? true,
      fullscreenEnabled: document.fullscreenEnabled === true && typeof c.requestFullscreen === 'function',
      placeFree: input.places.placeFree(),
    });
  };
  /** Whether the active element of the document is the frame's iframe, inside the reader host. */
  const frameFocused = (): boolean => {
    const a = document.activeElement;
    return container !== null && a !== null && a.tagName === 'IFRAME' && container.contains(a) && a.closest('.docs-reader') !== null;
  };
  /** The frame's `r`: the facts are read now, as `enter` reads them, and the decider rules (it refuses an entry unless reader
   *  mode is offered and the frame holds focus). Nothing to enter with (no container or document) is no event. */
  const frameToggle = (): void => {
    const c = container;
    const doc = input.doc;
    if (!state.on && (c === null || doc === null)) return;
    step({
      kind: 'frame-toggle', doc: doc ?? '',
      activation: navigator.userActivation?.isActive ?? false,
      fullscreenEnabled: c !== null && document.fullscreenEnabled === true && typeof c.requestFullscreen === 'function',
      placeFree: input.places.placeFree(),
      offered: offered(),
      frameFocused: frameFocused(),
    });
  };

  /** A tap on ccrc's own controls, or the frame's `active` act: the wake lock's idle timer starts again. */
  const activity = (): void => {
    if (!state.on) return;
    lastActivity = Date.now();
    armIdle();
    syncWake();
  };
  /** The overlay's Aa: the decider's `dismiss` runs FIRST (state stored at once, the overlay and its layer leave the next
   *  render), and only then the frame's settings command, so the frame's menu is never opened under the layer. */
  const aa = (): void => {
    step({ kind: 'dismiss' });
    frame?.command('settings');
    activity();
  };

  return {
    setInput(doc: string | null, plainView: boolean, places: ReaderModePlaces): void { input = { doc, plainView, places }; },
    setContainer(el: HTMLElement | null): void { container = el; },
    setFrame(f: ReaderModeFrame | null): void {
      // `null` clears the stored frame through the same guard as `dropFrame`: nothing stored, nothing to do.
      if (f === null) {
        if (frame !== null) dropFrame(frame);
        return;
      }
      frame = f;
      sink.frame(f);
      // A frame that is ready is brought to the reading in force, however it was mounted: the decider answers (L1).
      if (f.ready) step({ kind: 'frame-ready', planned: f.planned });
    },
    dropFrame,
    /** What a mount for `doc` is made under: the turn only while reader mode is on for `doc` and `doc` is still the screen's
     *  current document, so a new document's frame never inherits the old document's reading. */
    readingFor(doc: string | null): ReaderReading {
      return doc !== null && state.on && state.doc === doc && input.doc === doc ? READER_TURN : 'off';
    },
    frameExit: (): void => step({ kind: 'frame-exit' }),
    frameToggle,
    focusFrame(): void { frame?.focus(); },
    offered,
    available,
    on: (): boolean => state.on,
    enter,
    exit,
    toggle: (): void => { if (state.on) exit('key'); else enter('key'); },
    menu: (): void => step({ kind: 'menu' }),
    escOverlay: (): void => step({ kind: 'esc' }),
    dismiss: (): void => step({ kind: 'dismiss' }),
    setFallback: (): void => step({ kind: 'fallback' }),
    block: (): void => step({ kind: 'block' }),
    docChanged(doc: string | null): void { if (state.on) step({ kind: 'doc-changed', doc: doc ?? '' }); },
    fullScreenChanged: (): void => { if (state.on && document.fullscreenElement !== container) step({ kind: 'full-screen-lost' }); },
    activity,
    aa,
    pageVisible: (): void => syncWake(),
    /** The browser drops the lock when the page is hidden: forget the sentinel, then re-read. */
    pageHidden: (): void => { sentinel = null; syncWake(); },
    /** Registers this hook's host with the pop dispatcher for its whole life, and returns the unregister. `exitReader` is the
     *  landing of a pop that crossed the reader place (a no-op while off: the landing of the hook's own step-back);
     *  `leaveDead` steps below a reader entry whose reader mode is over. Right after registering, the reload check: reader
     *  mode is always off at a mount, so a tab standing on a dead reader entry is stepped below it once. */
    registerHost(): () => void {
      const places = input.places;
      const unregister = places.register({
        on: (): boolean => state.on,
        exitReader: (_closeOverlay: boolean): void => step({ kind: 'place-popped' }),
        leaveDead: stepBelow,
      });
      if (places.standingOnDead()) stepBelow();
      return unregister;
    },
    start: (): void => { alive = true; },
    /** The screen unmounting: the decider's `leave` (the console back, the fill cleared, full screen left; no step back, no
     *  focus), then the hook's own teardown: its timers and the wake lock. */
    teardown(): void {
      const answer = readerModeStep(state, { kind: 'leave' });
      state = answer.state;
      for (const act of answer.acts) perform(act);
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      clearIdle();
      const s = sentinel;
      sentinel = null;
      if (s !== null) releaseSentinel(s);
      alive = false;
    },
  };
}

/** Reader mode for one Docs screen: the container part for `DocsReading`, the context value for the head and the body, and
 *  the outside door's controls. `doc` is the document's key (`null` where the page is no leaf), `places` the history port. */
export function useReaderMode(o: { doc: string | null; plainView: boolean; places?: ReaderModePlaces }): {
  value: ReaderModeContextValue; container: ReaderModeContainer; controls: ReaderModeControls;
} {
  const [state, setState] = useState<ReaderModeState>(READER_MODE_OFF);
  const [live, setLive] = useState('');
  const [frame, setFrameState] = useState<ReaderModeFrame | null>(null);
  const [ctl] = useState(() => createController({ state: setState, live: setLive, frame: setFrameState }));
  const { doc, plainView } = o;
  const places = o.places ?? READER_PLACES;

  useLayoutEffect(() => { ctl.setInput(doc, plainView, places); });
  // Layout, so the container is still attached when the screen leaves while on (a ref detaches after its owner's cleanup).
  useLayoutEffect(() => {
    ctl.start();
    return () => ctl.teardown();
  }, [ctl]);
  useEffect(() => { ctl.docChanged(doc); }, [ctl, doc]);

  // The block screen and the sign-in screen draw over the fill but not over element full screen: either appearing ends it.
  const blocked = useFleetStore((s) => s.blocked);
  const { lost } = useAuthLost();
  const stopped = blocked || lost;
  const on = state.on;
  useEffect(() => { if (stopped && on) ctl.block(); }, [ctl, stopped, on]);

  // The reader place's host, for the hook's whole life (the pops that cross or stand on the reader place are its).
  useEffect(() => ctl.registerHost(), [ctl]);

  // The Docs screen's one `fullscreenchange` subscription.
  useEffect(() => {
    document.addEventListener('fullscreenchange', ctl.fullScreenChanged);
    return () => document.removeEventListener('fullscreenchange', ctl.fullScreenChanged);
  }, [ctl]);
  useEffect(() => {
    const stops = [onPageVisible(ctl.pageVisible), onPageHidden(ctl.pageHidden)];
    return () => { for (const stop of stops) stop(); };
  }, [ctl]);

  const value = useMemo<ReaderModeContextValue>(() => ({
    // `readerModeOffered` owns the rule. The modal-layer test is read at each `enter` and in the handle, not at render.
    state, offered: readerModeOffered({ frameReady: frame?.ready === true, plainView, modalMounted: false }), turn: READER_TURN,
    enter: ctl.enter, exit: ctl.exit, menu: ctl.menu, escOverlay: ctl.escOverlay, activity: ctl.activity, dismiss: ctl.dismiss,
    aa: ctl.aa, frame,
    setFrame: ctl.setFrame, dropFrame: ctl.dropFrame, setFallback: ctl.setFallback, readingFor: ctl.readingFor,
    frameExit: ctl.frameExit, frameToggle: ctl.frameToggle,
  }), [ctl, state, frame, plainView]);
  const container = useMemo<ReaderModeContainer>(() => ({
    setContainer: ctl.setContainer, on: state.on, how: state.on ? state.how : undefined, live, focusFrame: ctl.focusFrame,
  }), [ctl, state, live]);
  const controls = useMemo<ReaderModeControls>(() => ({ offered: ctl.offered, available: ctl.available, on: ctl.on, toggle: ctl.toggle }), [ctl]);
  return { value, container, controls };
}
