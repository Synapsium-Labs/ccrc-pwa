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

import type { DocsFolderLocation, DocsPageLocation } from '../../../../shared/docs';

/** The document reader mode is entered for (spec §4.1), as `doc-changed` compares it: a leaf path's project or folder,
 *  section and path, with no ref, commit, view or fragment, so a new commit or a same-page link spelled another way is the
 *  same document and another file is not. NUL joins the parts (no part can hold it). `null` has one meaning: the page is
 *  no leaf path, so there is no document to read. */
export function readerModeDocKey(page: DocsPageLocation | null, folderPage: DocsFolderLocation | null): string | null {
  if (page !== null && page.kind === 'path' && !page.dirSlash) {
    return readerModeDocKeyOf({ kind: 'project', owner: page.project, section: page.section, path: page.path });
  }
  if (folderPage !== null && folderPage.kind === 'folder-path' && !folderPage.dirSlash) {
    return readerModeDocKeyOf({ kind: 'folder', owner: folderPage.label, section: folderPage.section, path: folderPage.path });
  }
  return null;
}

/** The one rule of the key, from its parts: what a document body knows of itself (its project, section and path) is enough,
 *  so a body names its own document the way the page does, and a mount can be asked whether reader mode is on for it. `owner`
 *  is the project or the folder's label. */
export function readerModeDocKeyOf(o: { kind: 'project' | 'folder'; owner: string; section: string; path: string }): string {
  return [o.kind, o.owner, o.section, o.path].join('\u0000');
}

/** How the reader turns the page: the frame's own `reading` op carries it (`screens`: pages; `scroll`: continuous). */
export type ReaderTurn = 'screens' | 'scroll';

/** Reader mode's reading as a frame is told it (the library's `setReading`): the turn, or `off` when reader mode is not on. The
 *  one definition: the mount's policy, the bridge, the frame's body and the hook all name it from here. */
export type ReaderReading = ReaderTurn | 'off';

/** The turn a device's stored word means (X6 XR2.2): exactly `screens` or `scroll`; absent or anything else reads `screens`, so an
 *  unknown word, a hand-edited value or a newer build's word never leaves the reader with no way to turn. */
export function readerTurnOf(stored: string | null): ReaderTurn {
  return stored === 'scroll' ? 'scroll' : 'screens';
}

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
 *  whole of `readerModeOffered`, read by delivery as the op arrives) and the frame holds focus (spec §8). `frame-ready` is a
 *  mount reporting ready, with `planned` the reading the mount was last sent (`off` when it was sent none) and `turn` the turn in
 *  force now: it is brought to the reading in force, which a mount made just before entering, or planned under a reading that has
 *  since ended or changed (a new document's frame after a link, an exit during a remount, a switch of the turn while it was
 *  mounting), would otherwise miss. `turn-changed` is the operator's switch of the turn (X6 XR2.2), after the new turn is stored:
 *  while on, the frame is sent it in place. */
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
  | { kind: 'frame-ready'; planned: ReaderReading; turn: ReaderTurn }
  | { kind: 'turn-changed' }
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
    case 'frame-ready':
      // On and planned under another reading than the turn in force (none, or the other turn): its reading must be set now. Off and
      // planned under any turn: the reading it was made under has ended.
      if (state.on && event.planned !== event.turn) return { state, acts: ['start-reading'] };
      if (!state.on && event.planned !== 'off') return { state, acts: ['stop-reading'] };
      return NOTHING(state);
    case 'turn-changed':
      // The frame is sent the new turn in place (the stored turn is read by the act); off, there is no reading to change.
      return state.on ? { state, acts: ['start-reading'] } : NOTHING(state);
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

/** Whether reader mode is offered: a ready frame, outside the plain view, with no modal layer mounted and no figure open.
 *  `modalMounted` is true while any `[role="dialog"]` is in the document, open or still animating closed, so reader mode never
 *  starts its hiding under a modal layer (spec section 4.1). `figureOpen` is whether the frame's full-screen figure is open (X6 XR
 *  fix round 1): its history entry is above the page's, and a reader place pushed over it would sit above the figure's own, so
 *  the head's button, the one bar's control and `r` alike are refused until it closes. */
export function readerModeOffered(
  input: { frameReady: boolean; plainView: boolean; modalMounted: boolean; figureOpen: boolean },
): boolean {
  return input.frameReady && !input.plainView && !input.modalMounted && !input.figureOpen;
}

/** Whether ccrc draws its own Exit with no frame to give an overlay (X6 XR fix round 1): reader mode is on and no frame stands.
 *  The document's leaf has left `ok` (changing, failed) or the next mount is not in yet, the console is hidden under the fill, and
 *  on a phone's installed app there is no key and no browser Back: without this the operator has nothing of ccrc's to leave with.
 *  It is the frameless form's only decision; a standing frame has the overlay (`state.overlay`) and its own menu. */
export function readerModeExitShown(input: { on: boolean; frameStands: boolean }): boolean {
  return input.on && !input.frameStands;
}

/** Where the `focus-frame` act puts focus (X6 XR fix round 2, item 3, review 4043 A2). `frame`: the frame, as it always was: a
 *  focus request while reader mode stays on (Esc, the overlay's menu, a dropped frame's dismiss), and every exit that has a frame
 *  standing. `head-action`: an exit with no frame standing (the frameless Exit's own), while the Docs head's Reader mode action is
 *  shown and stays (delivery reads that from its own offer after the step, never from a scan of the page alone, review 4052 F1).
 *  `main`: the same exit with no such action on screen. The frameless Exit unmounts holding the focus, and with no frame
 *  to give it to, focus would otherwise fall to the page's body with nothing announced. A frame that arrives afterwards is
 *  neither asked nor given focus: this is an answer for the act that ran, not a state. */
export type ReaderExitFocus = 'frame' | 'head-action' | 'main';

export function readerModeExitFocus(input: { on: boolean; frameStands: boolean; headActionShown: boolean }): ReaderExitFocus {
  if (input.on || input.frameStands) return 'frame';
  return input.headActionShown ? 'head-action' : 'main';
}

/** Where focus goes when a focus guard of the reading container is reached (spec 6.5; X6 XR fix round 1). `none`: reader mode is
 *  off, the guards are out of the tab order. `exit-only`: no frame stands, so the Exit alone is drawn and both guards send focus to
 *  it (a guard that sent it to a frame that is not there would leave it on an invisible span, and the next Tab out of the
 *  container). `overlay-last`: the leading guard while the overlay shows, to its last control. `frame`: otherwise, into the frame. */
export type ReaderGuardTarget = 'none' | 'exit-only' | 'overlay-last' | 'frame';

export function readerModeGuardTarget(
  input: { on: boolean; frameStands: boolean; overlayShown: boolean; guard: 'leading' | 'trailing' },
): ReaderGuardTarget {
  if (!input.on) return 'none';
  if (readerModeExitShown({ on: input.on, frameStands: input.frameStands })) return 'exit-only';
  return input.guard === 'leading' && input.overlayShown ? 'overlay-last' : 'frame';
}

/** The one wake-lock decider, re-read on every state change: on, visible, and active within `READER_WAKE_IDLE_MS`, and not
 *  refused. `refused` is the memo of a request the browser refused (X6 XR fix round 1): until the next entry into reader mode or
 *  the page becoming visible again (both clear it, in delivery) a refusal means the lock is not wanted, so activity asks nothing. */
export function wakeLockWanted(
  input: { on: boolean; visible: boolean; lastActivityMs: number; nowMs: number; refused: boolean },
): boolean {
  return input.on && input.visible && !input.refused && input.nowMs - input.lastActivityMs < READER_WAKE_IDLE_MS;
}

/** The minutes left of a reading time at a share read (`share` clamped to [0, 1], and read as 0 when it is not a finite number,
 *  as the overlay's percentage reads it); unrounded. */
export function timeLeftMinutes(readingMinutes: number, share: number): number {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  return readingMinutes * (1 - s);
}
