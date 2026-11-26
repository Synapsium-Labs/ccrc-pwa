// Reader mode's decisions (native Docs reader, reader-mode plan Task XR1.1 as amended 2026-11-24, D-8975; the reader-mode
// spec `docs/superpowers/specs/2026-11-20-native-docs-reader-mode-design.md`: section 3.3 the state and its transitions,
// section 4.1 what is offered, section 4.2 the exits, section 6.3 the wake lock and the time left). Ring L1 policy: pure
// deciders over plain values, no I/O, no DOM, no timer, no browser global, and no runtime import of a `.tsx`, a store or
// `lib/api.ts`. Delivery (`useReaderMode.ts`, the reading container) asks these and performs the acts it is handed: it
// decides nothing. Every decision is one row of one table (`readerModeStep`), so a test can hold each row.
//
// The amendment's three changes to the plan's text: `readerModeOffered` takes no layout or rule (the layout rule moved
// to P5.1, so `READER_REMOUNT_QUIET_MS`, `READER_LAYOUT_RULE` and the layout note are defined there, not here);
// `readerModeStep` gains XR2.1's events `frame-exit` and `frame-toggle`; and the act `toggle-overlay` is not defined
// (the overlay is the state's `overlay` field), while XR2.1's `start-reading` and `stop-reading` are.

/** How the reader turns the page: the frame's own `reading` op carries it (`screens`: pages; `scroll`: continuous). */
export type ReaderTurn = 'screens' | 'scroll';

/** How reader mode fills the screen. `fill`: the console's layer is drawn over the viewport. `full-screen`: the browser
 *  also granted element full screen. A refusal leaves reader mode on as `fill`. */
export type ReaderModeHow = 'full-screen' | 'fill';

/** Off, or on for one document. `doc` is the document's key (what `doc-changed` is compared with). `overlay` is whether
 *  ccrc's overlay toolbar is shown. `placed` is whether entering pushed the history place that an exit steps back over. */
export type ReaderModeState =
  | { on: false }
  | { on: true; doc: string; how: ReaderModeHow; overlay: boolean; placed: boolean };

/** Reader mode's one off state. Every exit leaves exactly this. */
export const READER_MODE_OFF: ReaderModeState = Object.freeze({ on: false as const });

/** What happened. `enter`: the operator asked, with the facts the decision needs (a user activation is in hand; the
 *  document allows full screen; the place budget has room). `full-screen-*`: the browser's answer to the request, and
 *  its loss (Esc in browser full screen arrives as `full-screen-lost`). `settled`: the wait after a lost full screen is
 *  over, and `landedBelow` says whether a pop already landed below the reader place. `esc`: Esc on ccrc's overlay
 *  toolbar. `exit-tap`, `key` (`r` in the host) and `frame-exit` (the frame's own exit op) leave by the operator's act;
 *  `place-popped` (Back crossed the reader place), `doc-changed`, `fallback` (the rich view did not start) and `block`
 *  (the app's block or sign-in loss) leave by the world's, and so does `leave` (the Docs screen unmounting under reader
 *  mode: the console's state goes, and the place is left for X2's decider to skip as stale). `menu` toggles the overlay;
 *  `dismiss` (a tap on the clear layer outside it) only hides it. No window blur reaches it: wave XR subscribes none
 *  (XR2.1). `frame-toggle` is the frame's `r`: it enters or exits, and is refused unless reader mode is offered (the
 *  whole of `readerModeOffered`, read by delivery as the op arrives) and the frame holds focus (spec §8). */
export type ReaderModeEvent =
  | { kind: 'enter'; doc: string; activation: boolean; fullscreenEnabled: boolean; placeFree: boolean }
  | { kind: 'full-screen-granted' }
  | { kind: 'full-screen-refused' }
  | { kind: 'full-screen-lost' }
  | { kind: 'settled'; landedBelow: boolean }
  | { kind: 'esc' }
  | { kind: 'exit-tap' }
  | { kind: 'key' }
  | { kind: 'place-popped' }
  | { kind: 'doc-changed'; doc: string }
  | { kind: 'fallback' }
  | { kind: 'block' }
  | { kind: 'menu' }
  | { kind: 'dismiss' }
  | { kind: 'frame-exit' }
  | { kind: 'leave' }
  | {
      kind: 'frame-toggle'; doc: string; activation: boolean; fullscreenEnabled: boolean; placeFree: boolean;
      offered: boolean; frameFocused: boolean;
    };

/** What delivery does, in the order listed. `start-reading` and `stop-reading` send the frame the `reading` op, with the
 *  stored turn and with `off`. There is no act that closes the frame's overlay: the step-back's pop does (XR1.3). */
export type ReaderModeAct =
  | 'draw-fill'
  | 'push-place'
  | 'request-full-screen'
  | 'exit-full-screen'
  | 'clear-fill'
  | 'await-settle'
  | 'step-back'
  | 'focus-frame'
  | 'hide-console'
  | 'show-console'
  | 'start-reading'
  | 'stop-reading'
  | 'announce';

/** One answer of the table: the next state and the acts to perform, in order. */
export interface ReaderModeAnswer {
  readonly state: ReaderModeState;
  readonly acts: readonly ReaderModeAct[];
}

/** How long a wake lock is wanted after the last activity, in milliseconds (spec section 6.3). */
export const READER_WAKE_IDLE_MS = 300000;

/** How long an exit from full screen waits for a pop that is already in flight before it steps back itself. */
export const READER_EXIT_SETTLE_MS = 100;

type On = Extract<ReaderModeState, { on: true }>;

const NOTHING = (state: ReaderModeState): ReaderModeAnswer => ({ state, acts: [] });

/** What follows the console's return in an exit. `step-back`: undo the place entering pushed, once, when there is one.
 *  `await-settle`: the same, but a full-screen loss may be followed by a pop of the browser's own, so the step-back waits
 *  for `settled`. `none`: the exit is the pop itself (or has no place to undo). */
type ExitTail = 'step-back' | 'await-settle' | 'none';

/** The one place an exit's acts are written, so their order is written once: leave full screen (when it is held and the
 *  browser has not already taken it), clear the fill, stop the frame's reading (unless the frame is gone), show the
 *  console, undo the place (by `tail`, and only when entering pushed one), and give the focus back to the frame. */
interface ExitOpts { leaveFullScreen: boolean; stopReading: boolean; tail: ExitTail; focus?: false }

function exitActs(s: On, opts: ExitOpts): readonly ReaderModeAct[] {
  const acts: ReaderModeAct[] = [];
  if (opts.leaveFullScreen && s.how === 'full-screen') acts.push('exit-full-screen');
  acts.push('clear-fill');
  if (opts.stopReading) acts.push('stop-reading');
  acts.push('show-console');
  if (s.placed && opts.tail === 'step-back') acts.push('step-back');
  if (s.placed && opts.tail === 'await-settle') acts.push('await-settle');
  if (opts.focus !== false) acts.push('focus-frame');
  return acts;
}

function exited(s: On, opts: ExitOpts): ReaderModeAnswer {
  return { state: READER_MODE_OFF, acts: exitActs(s, opts) };
}

/** Entering: the fill, the place, full screen only with an activation and a document that allows it, the console hidden,
 *  the frame told to read, focus and the announcement. A spent place budget enters unplaced. */
function entered(e: { doc: string; activation: boolean; fullscreenEnabled: boolean; placeFree: boolean }): ReaderModeAnswer {
  const acts: ReaderModeAct[] = ['draw-fill'];
  if (e.placeFree) acts.push('push-place');
  if (e.activation && e.fullscreenEnabled) acts.push('request-full-screen');
  acts.push('hide-console', 'start-reading', 'focus-frame', 'announce');
  return { state: { on: true, doc: e.doc, how: 'fill', overlay: false, placed: e.placeFree }, acts };
}

/** The operator's own exit (the exit control, `r`, the frame's exit op, and a block): step back once when placed. */
function operatorExit(s: On): ReaderModeAnswer {
  return exited(s, { leaveFullScreen: true, stopReading: true, tail: 'step-back' });
}

/** Reader mode's one decision table over (state, event). An event that means nothing in the state it finds is answered
 *  with the same state and no acts (never a throw): several are echoes of an exit that already happened. */
export function readerModeStep(state: ReaderModeState, event: ReaderModeEvent): ReaderModeAnswer {
  switch (event.kind) {
    case 'enter':
      return state.on ? NOTHING(state) : entered(event);
    case 'frame-toggle':
      if (state.on) return operatorExit(state);
      return event.offered && event.frameFocused ? entered(event) : NOTHING(state);
    case 'leave':
      // The screen is going: give the page back (full screen, the fill, the console). The frame goes with the screen, so
      // it is neither told to stop nor focused, and nothing steps back: the place is stale once the visit ends (spec §3.3).
      return state.on ? exited(state, { leaveFullScreen: true, stopReading: false, tail: 'none', focus: false }) : NOTHING(state);
    case 'exit-tap':
    case 'key':
    case 'frame-exit':
    case 'block':
      return state.on ? operatorExit(state) : NOTHING(state);
    case 'full-screen-lost':
      // Never `step-back` at once: the browser's own pop may be in flight, so the step-back waits for `settled`.
      return state.on ? exited(state, { leaveFullScreen: false, stopReading: true, tail: 'await-settle' }) : NOTHING(state);
    case 'settled':
      // Arrives after an `await-settle`, normally while off. Re-entered meanwhile: the new reading owns the place.
      if (state.on || event.landedBelow) return NOTHING(state);
      return { state, acts: ['step-back'] };
    case 'place-popped':
      return state.on ? exited(state, { leaveFullScreen: true, stopReading: true, tail: 'none' }) : NOTHING(state);
    case 'doc-changed':
      if (!state.on || event.doc === state.doc) return NOTHING(state);
      return exited(state, { leaveFullScreen: true, stopReading: true, tail: 'none' });
    case 'fallback':
      // The frame is gone: nothing to tell it to stop.
      return state.on ? exited(state, { leaveFullScreen: true, stopReading: false, tail: 'step-back' }) : NOTHING(state);
    case 'full-screen-granted':
      if (state.on) return state.how === 'fill' ? NOTHING({ ...state, how: 'full-screen' }) : NOTHING(state);
      // The request resolved after an exit: leave the full screen it just took.
      return { state, acts: ['exit-full-screen'] };
    case 'full-screen-refused':
      return NOTHING(state);
    case 'esc':
      return state.on ? { state: { ...state, overlay: false }, acts: ['focus-frame'] } : NOTHING(state);
    case 'menu':
      if (!state.on) return NOTHING(state);
      return state.overlay
        ? { state: { ...state, overlay: false }, acts: ['focus-frame'] }
        : NOTHING({ ...state, overlay: true });
    case 'dismiss':
      return state.on && state.overlay ? { state: { ...state, overlay: false }, acts: ['focus-frame'] } : NOTHING(state);
  }
}

/** Whether reader mode is offered: a ready frame, outside the plain view, and with no modal layer mounted. `modalMounted`
 *  is true while any `[role="dialog"]` is in the document, open or still animating closed, so reader mode never starts
 *  its hiding under a modal layer (spec section 4.1). */
export function readerModeOffered(input: { frameReady: boolean; plainView: boolean; modalMounted: boolean }): boolean {
  return input.frameReady && !input.plainView && !input.modalMounted;
}

/** The one wake-lock decider, re-read on every state change: on, visible, and active within `READER_WAKE_IDLE_MS`. */
export function wakeLockWanted(input: { on: boolean; visible: boolean; lastActivityMs: number; nowMs: number }): boolean {
  return input.on && input.visible && input.nowMs - input.lastActivityMs < READER_WAKE_IDLE_MS;
}

/** The minutes left of a reading time at a share read (`share` clamped to [0, 1]); unrounded. */
export function timeLeftMinutes(readingMinutes: number, share: number): number {
  const s = Math.min(1, Math.max(0, share));
  return readingMinutes * (1 - s);
}
