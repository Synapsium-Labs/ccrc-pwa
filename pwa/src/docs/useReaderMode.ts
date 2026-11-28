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
// `exit`, `aa`, `dismiss`, `escOverlay`, `setTurn` and `activity`; `aa` hides the overlay first, then sends `command('settings')`.
// The turn (XR2.2): how the reader turns the page is the device's remembered choice (`READER_TURN_STORAGE_KEY`; `setTurn` is its one
// writer), `screens` until one is made. `perform('start-reading')`, `readingFor` and the context's `turn` all read that one value, and
// a frame's `planned` is the reading its mount was last sent, which `frame-ready` compares with it.
import { createContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { hideAsPage, releaseAsPage, type PageHiding } from '@ccrc/ui';
import { useAuthLost } from '../lib/auth';
import { onPageHidden, onPageVisible } from '../lib/pageClock';
import { setReaderPlaceHost, type ReaderPlaceHost } from '../lib/popstate';
import { readKey, writeKey } from '../lib/storage';
import { focusShownLandmark } from '../skins/frame';
import { useFleetStore } from '../stores/fleet';
import type { ReaderCommand, ReaderLayout } from './reader/policy';
import type { ReaderProgress } from './readerBar';
import {
  landedBelowReaderPlace, markReaderExitPending, pushReaderPlace, readerPlaceFreeNow, standingOnDeadReaderEntry,
  stepBelowReaderPlace,
} from './reader/places';
import {
  READER_EXIT_LANDING_MS, READER_EXIT_SETTLE_MS, READER_LAYOUT_RULE, READER_MODE_OFF, READER_WAKE_IDLE_MS, readerLayoutRowDrawn,
  readerModeDrawn, readerModeExitFocus, readerModeOffered, readerModeStep, readerTurnOf, wakeLockWanted,
  type ReaderModeAct, type ReaderModeEvent, type ReaderModeHow, type ReaderModeState, type ReaderReading, type ReaderTurn,
} from './reader/readerMode';
import { READER_MODE_TEXT, readerModeLayoutNote } from './reader/readerModeWords';
import { readerLayoutHandle, setReaderLayoutHandle } from './readerLayoutHandle';

/** The frame, as reader mode needs it: ready or not, the reading its mount was last sent (`planned`, `off` when it was sent none:
 *  `frame-ready` compares it with the turn in force), focus, the `reading` op, and, for the overlay, the document's title, how
 *  far it has been read, its reading time in minutes (absent when the library gave none) and the frame's own commands
 *  (`command('settings')`). `layout` is the layout the live mount carries (X2 P5.1): reader mode is offered, and the Layout row and its
 *  note read, by it. */
export interface ReaderModeFrame {
  readonly ready: boolean;
  readonly layout: ReaderLayout;
  readonly planned: ReaderReading;
  focus(): void;
  setReading(mode: ReaderReading): void;
  command(name: ReaderCommand): void;
  readonly title: string;
  readonly progress: ReaderProgress;
  readonly readingMinutes?: number;
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
  /** Whether the entry is drawn (`readerModeDrawn`): a ready frame outside the plain view, no figure open. The modal-layer test
   *  and an exit's own step back still landing are read at each `enter` (wave 62 fix round 1, review 4192 F6: the action stays
   *  drawn while the step lands, so a focus it holds is not dropped, and a press is refused). */
  readonly offered: boolean;
  /** The sentence Page details draws beside the Layout row when the layout rule keeps reader mode from the layout in use
   *  (`readerModeLayoutNote`, X2 P5.1); `null` has one meaning: nothing to say (reader mode is offered in this layout, or no frame
   *  stands). */
  readonly layoutNote: string | null;
  /** The same note in the desk's words (D-9180): the desk head has no Layout control, so its note is a line under the head's row and
   *  names the palette command. The one rule is `layoutNote`'s (`readerModeLayoutNote`, `place: 'desk'`); drawn only while
   *  `layoutRowDrawn`. */
  readonly layoutDeskNote: string | null;
  /** Whether the Layout row is drawn, at its one spot, Page details (`readerLayoutRowDrawn`, X2 P5.1; D-9180 took the desk's row
   *  from it), and whether the palette offers its Layout commands: a reader frame is ready for a Markdown leaf, and reader mode is
   *  not on. */
  readonly layoutRowDrawn: boolean;
  /** How the reader turns the page, kept per device (`READER_TURN_STORAGE_KEY`); `screens` until a device chooses. */
  readonly turn: ReaderTurn;
  /** The overlay's turn switch (X6 XR2.2): stores the turn, the one writer of its key, then sends the frame it in place while on. */
  setTurn(next: ReaderTurn): void;
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
  /** The frame's full-screen figure opened or closed (the frame's `place` reports, and the dispatcher's close of it, which the
   *  frame does not report): reader mode is not offered while it is open. Cleared with the frame. */
  setFigure(open: boolean): void;
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
  /** `offered()` without the modal-layer clause, read now: what a listing asks, since the listing may itself be a layer. It keeps
   *  the step's wait, which the context's drawn answer (`readerModeDrawn`) does not read (review 4192 F6). */
  available(): boolean;
  on(): boolean;
  toggle(): void;
  /** `readerLayoutRowDrawn` now (`readerLayoutHandle.ts`): whether the Layout row would be drawn, which is when the palette lists its
   *  Layout commands (D-9180). Read at the moment of the question, never a render's copy. */
  layoutRowDrawn(): boolean;
}

/** The device's remembered turn (X6 XR2.2, `ccrc-reader-turn`: `screens` or `scroll`). Read through the one storage port
 *  (`lib/storage.ts`) by `readStoredTurn` and written ONLY by the controller's `setTurn`, in this file: a second writer is a
 *  red `turn: the storage key is in the census and written in one place`. */
export const READER_TURN_STORAGE_KEY = 'ccrc-reader-turn';

/** The stored turn: `screens` when nothing is stored, the store throws or the word is unknown (`readerTurnOf`). */
const readStoredTurn = (): ReaderTurn => readerTurnOf(readKey(READER_TURN_STORAGE_KEY));

const noop = (): void => undefined;

interface Sink {
  state(s: ReaderModeState): void;
  live(text: string): void;
  frame(f: ReaderModeFrame | null): void;
  turn(t: ReaderTurn): void;
  figure(open: boolean): void;
}

/** The mutable half of the hook: refs and handles, in closures. One per mount of the hook, never rebuilt by a render.
 *  `initialTurn` is the turn the hook's state was initialised with from storage: the controller keeps it, stored at once as
 *  `state` is, so every act and read of this file sees the one value, and React hears of a change through the sink. */
function createController(sink: Sink, initialTurn: ReaderTurn) {
  let turn: ReaderTurn = initialTurn;
  let state: ReaderModeState = READER_MODE_OFF;
  let container: HTMLElement | null = null;
  let frame: ReaderModeFrame | null = null;
  /** Whether the stored frame's full-screen figure is open (`setFigure`): the frame's own reports, and the dispatcher's close. */
  let figure = false;
  let input: { doc: string | null; plainView: boolean; places: ReaderModePlaces } = { doc: null, plainView: false, places: READER_PLACES };
  let hiding: PageHiding | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActivity = 0;
  let sentinel: WakeLockSentinel | null = null;
  let requesting = false;
  /** The browser refused the last request: remembered (`wakeLockWanted` reads it) until the next entry into reader mode or the page
   *  visible again, so activity never asks again meanwhile (X6 XR fix round 1). */
  let refused = false;
  /** The generation of the wake-lock request in flight: each request takes the next one, and every clearing of `refused` takes
   *  one too, so a request that settles after its period ended (the page visible again, a fresh entry) never marks the new one. */
  let wakeGen = 0;
  /** This hook's own step back is on its way (wave 62, ticket x6-fu-reentry-flag): set when `stepBelow` stepped over entries, and
   *  cleared by that step's landing (the dispatcher's `exitReader`) or by `READER_EXIT_LANDING_MS`. `readerModeOffered` reads it, so
   *  no entry pushes a reader place under a landing still to come. A fact of this hook's own, beside the record's `exitPending`,
   *  which the dispatcher writes and this hook reads through no port: that mark is also set by an exit waiting on its settle, which
   *  a re-entry cancels, while this one stands only once a step was taken. Not named `landing`: that name is the landing line's,
   *  read in the PWA by `conflictWords.ts` alone (the rings' one-owner scan). */
  let stepping = false;
  let steppingTimer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  // ── the wake lock (spec 6.3) ──
  const wantedNow = (): boolean => wakeLockWanted({
    on: state.on, visible: document.visibilityState === 'visible', lastActivityMs: lastActivity, nowMs: Date.now(), refused,
  });
  const releaseSentinel = (s: WakeLockSentinel): void => {
    try { void Promise.resolve(s.release()).catch(noop); } catch { /* a release that throws changes nothing */ }
  };
  const requestWake = (): void => {
    const api: WakeLock | undefined = navigator.wakeLock;
    if (api === undefined || typeof api.request !== 'function') return;
    requesting = true;
    wakeGen += 1;
    const gen = wakeGen;
    let pending: Promise<WakeLockSentinel>;
    try { pending = api.request('screen'); } catch { requesting = false; refused = true; return; }
    Promise.resolve(pending).then((s) => {
      requesting = false;
      // No longer wanted by the time it was granted: let it go at once.
      if (!alive || !wantedNow()) { releaseSentinel(s); return; }
      sentinel = s;
      s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    }, () => {
      requesting = false;
      // Only the request of the period now in force is a refusal of it. One that settles after its period ended says nothing of
      // the new one, which was waiting on it: the lock is read again for the new period.
      if (gen === wakeGen) refused = true;
      else if (alive) syncWake();
    });
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
    // A torn-down hook steps nothing (review 4192 F7): the teardown is a layout cleanup and the host's unregister a passive one, so
    // the dispatcher can hand `leaveDead` a pop between them. The same guard as the sink's.
    if (!alive) return;
    input.places.markExitPending(true);
    if (input.places.stepBack() === 0) input.places.markExitPending(false);
    else setStepping(true);
  };
  /** The one writer of `stepping`: an armed wait is bounded by `READER_EXIT_LANDING_MS`. React is not told: what it draws does not
   *  read the wait (`readerModeDrawn`, review 4192 F6), and every press reads it now (`offered`, `available`). */
  function setStepping(on: boolean): void {
    if (steppingTimer !== null) clearTimeout(steppingTimer);
    steppingTimer = on ? setTimeout(() => { steppingTimer = null; setStepping(false); }, READER_EXIT_LANDING_MS) : null;
    stepping = on;
  }
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
        frame?.setReading(turn);
        break;
      case 'stop-reading':
        frame?.setReading('off');
        break;
      case 'focus-frame':
        // `readerModeExitFocus` decides (L1): the frame, or, for an exit with no frame standing, the main region. The page's Reader
        // mode action is never a target (wave 62, review 4092 F2): the head draws it from React's state, one commit behind this
        // controller, and only while a ready frame offers reader mode, so with no frame standing the action on the page is one the
        // next commit takes away (review 4052 F1).
        if (readerModeExitFocus({ on: state.on, frameStands: frame !== null }) === 'frame') frame?.focus();
        else focusShownLandmark();
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
      refused = false;             // a fresh entry asks the browser for the lock once more
      wakeGen += 1;                // and no request still pending from before it may mark the new period refused
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
    setFigure(false);   // a figure goes with its frame: the next body's frame has none open
    step({ kind: 'dismiss' });
  }

  /** The frame's full-screen figure opened (`true`) or closed (`false`): the frame's `place` reports, and the dispatcher's own
   *  close of it (a Back), which the frame does not report. Read by every offer, so an entry never pushes a reader place over the
   *  figure's history entry. */
  function setFigure(open: boolean): void {
    if (figure === open) return;
    figure = open;
    if (alive) sink.figure(open);
  }

  const offered = (): boolean => readerModeOffered({
    frameReady: frame?.ready === true,
    plainView: input.plainView,
    modalMounted: document.querySelector('[role="dialog"]') !== null,
    figureOpen: figure,
    exitLanding: stepping,
    layout: frame?.layout ?? 'default',
    rule: READER_LAYOUT_RULE,
  });
  /** The offer less the modal-layer clause, read now: a listing (the shortcut sheet is a dialog itself) asks this, never
   *  `offered`. It keeps the step's wait, so the palette lists no Reader mode while the step lands (review 4192 F8). */
  const available = (): boolean => readerModeOffered({
    frameReady: frame?.ready === true, plainView: input.plainView, modalMounted: false, figureOpen: figure, exitLanding: stepping,
    layout: frame?.layout ?? 'default', rule: READER_LAYOUT_RULE,
  });
  /** The Layout row's drawn answer, read now (`readerLayoutRowDrawn`, the one rule): what the context carries at render, for the
   *  palette's Layout commands (D-9180), which ask it through `readerLayoutHandle.ts`. */
  const layoutRowDrawn = (): boolean => readerLayoutRowDrawn({ frameReady: frame?.ready === true, plainView: input.plainView, readerModeOn: state.on });
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
  /** The overlay's turn switch: the new turn is kept (the one writer of the stored key, and the value every act reads), React is
   *  told, and the decider rules what the frame is sent (`turn-changed`: the new turn in place while on, nothing while off). The
   *  turn already in force changes nothing. */
  const setTurn = (next: ReaderTurn): void => {
    if (next === turn) return;
    turn = next;
    writeKey(READER_TURN_STORAGE_KEY, next);   // refused (private window, blocked storage): the page keeps the turn anyway
    if (alive) sink.turn(next);
    step({ kind: 'turn-changed' });
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
      // A frame replaced without being dropped (a same-page reopening publishes a new one) has no figure open at its ready.
      if (frame !== f) setFigure(false);
      frame = f;
      sink.frame(f);
      // A frame that is ready is brought to the reading in force, however it was mounted: the decider answers (L1).
      if (f.ready) step({ kind: 'frame-ready', planned: f.planned, turn });
    },
    dropFrame,
    setFigure,
    /** What a mount for `doc` is made under: the turn only while reader mode is on for `doc` and `doc` is still the screen's
     *  current document, so a new document's frame never inherits the old document's reading. */
    readingFor(doc: string | null): ReaderReading {
      return doc !== null && state.on && state.doc === doc && input.doc === doc ? turn : 'off';
    },
    frameExit: (): void => step({ kind: 'frame-exit' }),
    frameToggle,
    focusFrame(): void { frame?.focus(); },
    offered,
    available,
    layoutRowDrawn,
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
    setTurn,
    /** The page is visible again: a refusal of the lock is forgotten, so it is asked for once more. */
    pageVisible: (): void => { refused = false; wakeGen += 1; syncWake(); },
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
        // A crossing landing: while on, Back crossed the reader place; while off, the landing of this hook's own step back, which
        // ends its wait (`stepping`).
        exitReader: (_closeOverlay: boolean): void => { step({ kind: 'place-popped' }); setStepping(false); },
        leaveDead: stepBelow,
      });
      if (places.standingOnDead()) stepBelow();
      return unregister;
    },
    // A remount on the same controller (StrictMode's simulated one): a wait whose bound the teardown cleared is armed again.
    start: (): void => { alive = true; if (stepping) setStepping(true); },
    /** The screen unmounting: the decider's `leave` (the console back, the fill cleared, full screen left; no step back, no
     *  focus), then the hook's own teardown: its timers and the wake lock. */
    teardown(): void {
      const answer = readerModeStep(state, { kind: 'leave' });
      state = answer.state;
      for (const act of answer.acts) perform(act);
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      if (steppingTimer !== null) clearTimeout(steppingTimer);
      steppingTimer = null;
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
  // The turn is the device's remembered one, read from storage once, as the hook starts (`screens` when none is kept).
  const [turn, setTurnState] = useState<ReaderTurn>(readStoredTurn);
  const [figure, setFigureState] = useState(false);
  const [ctl] = useState(() => createController(
    { state: setState, live: setLive, frame: setFrameState, turn: setTurnState, figure: setFigureState }, turn,
  ));
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
    // `readerModeDrawn` owns the rule. The modal-layer test and the step's wait are read at each `enter` and in the handle, not at
    // render (`readerModeOffered`).
    state, turn, setTurn: ctl.setTurn,
    offered: readerModeDrawn({
      frameReady: frame?.ready === true, plainView, figureOpen: figure, layout: frame?.layout ?? 'default', rule: READER_LAYOUT_RULE,
    }),
    layoutNote: readerModeLayoutNote({ layout: frame?.layout ?? 'default', rule: READER_LAYOUT_RULE }),
    layoutDeskNote: readerModeLayoutNote({ layout: frame?.layout ?? 'default', rule: READER_LAYOUT_RULE, place: 'desk' }),
    layoutRowDrawn: readerLayoutRowDrawn({ frameReady: frame?.ready === true, plainView, readerModeOn: state.on }),
    enter: ctl.enter, exit: ctl.exit, menu: ctl.menu, escOverlay: ctl.escOverlay, activity: ctl.activity, dismiss: ctl.dismiss,
    aa: ctl.aa, frame,
    setFrame: ctl.setFrame, dropFrame: ctl.dropFrame, setFigure: ctl.setFigure, setFallback: ctl.setFallback, readingFor: ctl.readingFor,
    frameExit: ctl.frameExit, frameToggle: ctl.frameToggle,
  }), [ctl, state, frame, plainView, turn, figure]);
  const container = useMemo<ReaderModeContainer>(() => ({
    setContainer: ctl.setContainer, on: state.on, how: state.on ? state.how : undefined, live, focusFrame: ctl.focusFrame,
  }), [ctl, state, live]);
  const controls = useMemo<ReaderModeControls>(() => ({
    offered: ctl.offered, available: ctl.available, on: ctl.on, toggle: ctl.toggle, layoutRowDrawn: ctl.layoutRowDrawn,
  }), [ctl]);
  // The palette's Layout commands (D-9180) ask whether the Layout row would be drawn, through `readerLayoutHandle.ts`: set while
  // the screen's hook is mounted, cleared on unmount only if the slot is still this hook's, so no other screen offers them.
  useEffect(() => {
    setReaderLayoutHandle(controls);
    return () => { if (readerLayoutHandle() === controls) setReaderLayoutHandle(null); };
  }, [controls]);
  return { value, container, controls };
}
