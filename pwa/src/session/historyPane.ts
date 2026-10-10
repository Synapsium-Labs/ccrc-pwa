// THE HISTORY PANE — the scrollback terminal the drawer shows above the live
// one, and every gesture that moves it: the wheel, the finger, and the throw
// that follows the finger.
//
// WHY IT IS ITS OWN FILE. It was ONE `useEffect` of three hundred lines in
// `TerminalDrawer`, and its seam was already drawn: three dependencies in
// (`hist`, `histHost`, the factory), and exactly ONE call out — `onLive`, when
// the reader reaches the bottom. No state, no toast, no request. A function
// with a teardown, which is what the effect's body always was.
//
// MEASURED BEFORE MOVED, because this file has been judged cohesive and been
// wrong once: the previous wave left `TerminalDrawer` whole on that judgment
// and then found the xterm factory inside it. Here the grep is the argument —
// `setHist`, `toast`, `api.*` and `navigate` appear ZERO times in these three
// hundred lines.
//
// THE THROW IS WRITTEN OUT HERE because the history is not a native scroller:
// xterm's viewport is an empty leftover and the real scroll is a virtual
// re-render, so the deceleration every list on the device gets for free has to
// be spelled. The four numbers it takes are below, with what each one answers.
import {
  defaultMakeHistoryTerm, type HistoryPane, type MakeHistoryTerm,
} from './terminalFactory';

const WHEEL_LINES = 3;

/* — the throw, which a console on a phone is expected to have —
 *
 * A drag that stops dead the instant the finger lifts does not read as
 * scrolling; every list on the device keeps moving and slows down. The history
 * is not a native scroller (xterm's viewport is an empty leftover and the real
 * scroll is a virtual re-render), so the deceleration has to be written here
 * too. These are the four numbers it takes, in CSS pixels and milliseconds.
 */
/** A flick, not a placement: the least speed that keeps the history moving
 *  after the finger has gone. Below it the reader was positioning the view. */
const FLING_MIN_PX_MS = 0.25;
/** A finger that rested this long before lifting is placing the view, not
 *  throwing it — so the speed it had before the pause is not its speed now. */
const FLING_IDLE_MS = 80;
/** How much of the newest sample the smoothed speed takes. Raw per-move speed
 *  is far too noisy on a phone: one 2 ms gap between moves turns an ordinary
 *  drag into a fling. */
const FLING_SMOOTH = 0.35;
/** What is left of the speed one 60 Hz frame later — the decay, expressed per
 *  frame and applied per elapsed millisecond so a slow frame does not slow the
 *  glide down with it. */
const GLIDE_DECAY = 0.95;
/** Below this there is nothing left to SHOW — half a pixel per 60 Hz frame.
 *  Stated in pixels rather than in rows on purpose: since the remainder is
 *  rendered (`HistoryTerm.offset`), the end of a throw is a sub-pixel creep
 *  rather than a row waiting to drop, and the question the threshold answers
 *  is "can the eye still see this move", not "is another step coming". */
const GLIDE_STOP_PX_MS = 0.5 / (1000 / 60);
const FRAME_MS = 1000 / 60;
/** The longest gap a single glide frame may account for. A drawer that was
 *  backgrounded mid-throw comes back with a gap of seconds, and without this
 *  the history would jump the whole distance in one frame. */
const GLIDE_MAX_STEP_MS = 50;

/** The history this pane is showing — the `'history'` arm of the drawer's own
 *  `Hist`, which is the only arm that reaches here. */
export interface HistoryShowing {
  text: string;
  lines: number;
  pane?: HistoryPane;
}

/** Build the history terminal on `host`, wire every gesture to it, and hand
 *  back the teardown. `onLive` is the one thing it asks of its caller: the
 *  reader has scrolled back to the bottom and wants the live pane again. */
export function attachHistoryPane(
  histHost: HTMLElement,
  hist: HistoryShowing,
  makeHistoryTerm: MakeHistoryTerm | undefined,
  onLive: () => void,
): () => void {
    const term = (makeHistoryTerm ?? defaultMakeHistoryTerm)(histHost, hist.lines, hist.pane);
    // THE LATCH, AND THE READER'S OWN GESTURE IS WHY IT EXISTS. xterm's
    // `write(data, done)` parses ASYNCHRONOUSLY, so `done` can land after this
    // effect has been torn down and has called `dispose()` — and `scrollLines`
    // on a disposed Terminal throws, out of a callback nothing catches, into
    // React's commit. A blank drawer and a TypeError.
    //
    // THE TEAR-DOWN THAT ACTUALLY RACES IT is a keystroke: the history lands,
    // xterm starts parsing, and the reader types to go back to live — which is
    // the drawer's own documented way out and runs this cleanup mid-parse.
    //
    // NOT STRICTMODE, and saying so is the point of this paragraph. An earlier
    // version of this comment named StrictMode's double mount as the hazard.
    // React double-invokes an effect only on a component's INITIAL mount commit,
    // and this effect returns early until `hist` flips to 'history' — which
    // happens later, on a state change of an already-mounted component — so it
    // is never double-invoked. Measured: with the guard below deleted, a
    // StrictMode-shaped test stays GREEN. Anyone writing a test for this latch
    // should reach for the keystroke race; `terminal-scrollback.test.tsx` has it.
    //
    // A flag rather than a try/catch: swallowing the throw would also swallow a
    // real one, and what this needs to express is "the terminal this callback
    // was written for is gone", which is a fact the effect knows and the
    // callback does not.
    let alive = true;
    term.fit();
    // AND AGAIN WHENEVER THE GLASS CHANGES SHAPE. Fitted once, the history kept
    // whatever grid it was born with: a phone rotated while reading went on
    // wrapping against columns it no longer had, and the keyboard opening did
    // the same thing a softer way. The live terminal has refit on both events
    // since it shipped (`refit`, in the attach effect); this is the same pair,
    // for the layer that exists to be read.
    //
    // No grid comparison here, unlike the live one: there is no resize frame to
    // send and nothing downstream to spare, so a fit that changes nothing is
    // cheaper than the bookkeeping to avoid it.
    const refitHistory = (): void => { term.fit(); };
    window.addEventListener('resize', refitHistory);
    window.visualViewport?.addEventListener('resize', refitHistory);
    // ARMED BEFORE THE DEPARTURE IT LATCHES. `onBottom` fires only for a
    // reader who has been AWAY from the newest line, and the opening scroll
    // below is that departure. Registered after it, the latch never saw it, so
    // the first scroll DOWN read as an arrival nobody had left — and returning
    // to live cost two notches up and two back instead of one each way, which
    // is exactly what the operator measured.
    term.onBottom(() => onLive());
    // A capture is LF-separated; a terminal needs the carriage return too, or
    // every line starts where the last one ended. Done HERE rather than with
    // xterm's `convertEol` so the bytes a `HistoryTerm` receives are the same
    // whoever implements it.
    term.write(hist.text.replace(/\r?\n/g, '\r\n'), () => {
      // One notch up, so the gesture that opened this visibly did something —
      // and so the bottom latch is armed by a reader who is genuinely above
      // it. INSIDE the parse callback: xterm writes asynchronously, and a
      // scroll issued beside the write runs against the buffer as it stood
      // BEFORE the history landed, which moves nothing and arms nothing.
      //
      // AND GUARDED, because "asynchronously" includes "after this effect was
      // torn down" — see the `alive` note above.
      if (!alive) return;
      term.scrollLines(-WHEEL_LINES);
    });

    /**
     * THE FINGER, because xterm has nothing for it to pan.
     *
     * `.xterm-viewport` still carries `overflow-y: scroll`, but it is an empty
     * leftover — measured on a real Terminal: zero children, empty innerHTML —
     * and the actual scroll is a virtual VS Code `Scrollable` that re-renders
     * rows, whose only input is a `wheel` listener. A touch drag across the
     * glass left `viewportY` exactly where it was and put nothing on the pty,
     * and so did its pointer-event twin. On top of that the sheet computes
     * `touch-action: none` over the whole panel, so even a real scroller would
     * not have been panned. The drag is ours to write or the phone has none.
     *
     * `defaultPrevented` IS THE GUARD, and it is not decoration: xterm binds
     * `pointerdown` on its own scrollbar slider and takes the pointer capture
     * through `GlobalPointerMoveMonitor`, but calls only `preventDefault()` —
     * never `stopPropagation()`. The press therefore reaches this element too,
     * and capturing it here would steal the capture xterm took an instant
     * earlier and break dragging the scrollbar. Reading the flag rather than
     * the target's class survives xterm renaming its internals.
     */
    let dragging = false;
    let lastY = 0;
    /** Sub-row travel, kept across moves: a slow drag is many fractions of a
     *  row, and truncating each one on its own swallows the whole gesture. */
    let carry = 0;
    /** MEASURED ONCE PER GESTURE. A cell cannot change height mid-drag, and
     *  `getBoundingClientRect` forces layout — reading it on every move is a
     *  synchronous relayout per frame, beside a terminal that repaints on every
     *  scroll. 0 means "not measurable yet", so the first move that can measure
     *  fills it in rather than dividing by a number nobody gave us. */
    let rowPx = 0;

    /** When the last move was seen, and how fast the finger was going then —
     *  smoothed, because raw per-move speed on a phone is noise. */
    let lastT = 0;
    let vel = 0;
    /** The running throw, if there is one. */
    let raf = 0;
    const stopGlide = (): void => {
      if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
    };

    /** Turn travel into rows and scroll by them, keeping the sub-row
     *  remainder. Shared by the finger and by the throw that follows it, so
     *  the two cannot disagree about which way is older or about what happens
     *  to the fraction of a row between them. */
    const advance = (travel: number): number => {
      const rows = Math.trunc(travel / rowPx);
      // The content follows the finger: dragging DOWN reaches older output,
      // which is a scroll UP.
      if (rows !== 0) term.scrollLines(-rows);
      const rest = travel - rows * rowPx;
      // AND THE REMAINDER IS SHOWN, not just carried. Without this the view
      // only ever moves in whole rows, which is fine at speed and is the whole
      // of what a decelerating throw looks wrong doing — see `offset`'s own
      // note. Nothing is snapped back when the motion stops: a view resting
      // part of a row off its grid is what every pixel-smooth scroller on the
      // device leaves behind, and snapping to the grid would put back a
      // hitch at the exact moment this is meant to remove one.
      term.offset?.(rest);
      return rest;
    };

    /**
     * THE THROW. Everything on a phone keeps moving when the finger leaves and
     * slows to a stop; a view that halts dead does not read as a scroll at all,
     * which is what the operator met — "працює виключно поки ведеш пальцем".
     * The history cannot borrow the platform's deceleration because it is not a
     * native scroller: xterm's `.xterm-viewport` is an empty leftover and the
     * real scroll is a virtual re-render. So the curve is written here.
     *
     * It carries the finger's own remainder in rather than starting from zero,
     * so the hand-off is continuous — the throw picks up mid-row exactly where
     * the drag left off.
     *
     * IT DOES NOT KNOW WHERE THE EDGES ARE, deliberately: a throw that runs
     * past the oldest line simply scrolls nothing for the rest of its curve,
     * which is invisible and costs one short animation. Asking the terminal for
     * its viewport position every frame to stop a few hundred milliseconds
     * earlier would buy a new method on the seam for nothing anyone can see.
     * The other end needs no such care — arriving at the newest line is what
     * `onBottom` latches, and it takes the whole layer down with it.
     */
    const glide = (v0: number): void => {
      let v = v0;
      // Seeded from the same clock the drag measured its speed with —
      // `requestAnimationFrame`'s argument and `performance.now()` are one
      // timeline — so the first frame of the throw carries the gap since the
      // finger left rather than being spent establishing one.
      let prev = performance.now();
      const frame = (now: number): void => {
        const dt = Math.min(now - prev, GLIDE_MAX_STEP_MS);
        prev = now;
        carry = advance(v * dt + carry);
        v *= GLIDE_DECAY ** (dt / FRAME_MS);
        if (Math.abs(v) < GLIDE_STOP_PX_MS) { raf = 0; return; }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };

    const begin = (y: number): void => {
      // A touch during a throw stops it where it is — the one thing every
      // scroller on the device does, and the only way to catch a line going
      // past.
      stopGlide();
      dragging = true;
      lastY = y;
      lastT = performance.now();
      vel = 0;
      carry = 0;
      rowPx = term.rowHeight();
    };
    const step = (y: number): void => {
      if (!dragging) return;
      if (rowPx <= 0) {
        rowPx = term.rowHeight();
        if (rowPx <= 0) { lastY = y; lastT = performance.now(); return; }
      }
      const now = performance.now();
      const dy = y - lastY;
      const dt = now - lastT;
      lastY = y;
      lastT = now;
      // A pause discards the speed rather than averaging it away: a finger that
      // rested and then lifted is placing the view, and the flick it made on
      // the way in is not what it is asking for now.
      if (dt > 0) vel = dt > FLING_IDLE_MS ? 0 : vel * (1 - FLING_SMOOTH) + (dy / dt) * FLING_SMOOTH;
      carry = advance(dy + carry);
    };
    const finish = (): void => {
      dragging = false;
      if (rowPx > 0 && Math.abs(vel) >= FLING_MIN_PX_MS) glide(vel);
      // Spent either way: a second `finish` for the same gesture — the pointer
      // echo of a touch that already ended — must not throw the view twice.
      vel = 0;
    };

    /**
     * TWO INPUT PATHS, AND THE TOUCH ONE IS NOT A LUXURY. The ask picker and
     * this drawer are siblings that can be open over the same session, and
     * every open vaul sheet installs a document-level capturing `touchmove`
     * with `preventDefault` on iOS. Preventing a touch there cancels the
     * POINTER stream, so a drag driven by pointer events alone dies the moment
     * another sheet is up — which is how the operator met it: with a picker
     * raised, the console would not scroll at all. Touch listeners keep
     * running regardless; `preventDefault` stops the default action, not the
     * other listeners.
     *
     * ONE FINGER IS COUNTED ONCE. A browser fires both families for the same
     * finger, so a touch gesture takes ownership for its duration and the
     * pointer echo is ignored until it lifts.
     */
    const pointers = new Set<number>();
    let active: number | null = null;
    let viaTouch = false;

    const down = (ev: PointerEvent): void => {
      pointers.add(ev.pointerId);
      if (viaTouch) return;                       // the finger already owns this
      // THE MOUSE IS NOT DRAGGING THE VIEW, IT IS SELECTING TEXT. xterm starts
      // a selection on `mousedown` and follows it with a document-level
      // `mousemove`; this handler captures the pointer and calls
      // `preventDefault()` on every move, which suppresses exactly those
      // compatibility mouse events. Left in, a mouse drag across the history
      // scrolls it and selects nothing — so the one way to copy a line out of
      // the console stops working, on the layer that exists for reading.
      //
      // The mouse loses nothing by standing down: the history terminal is in
      // the NORMAL buffer with a real scrollback and no custom wheel handler,
      // so xterm's own wheel scrolls it. The wheel is the mouse's gesture and
      // the drag is the finger's.
      if (ev.pointerType === 'mouse') return;
      if (ev.defaultPrevented) return;            // xterm's own scrollbar took it
      // A pinch is not a scroll. Abandon rather than follow one of the two.
      if (pointers.size > 1) { active = null; finish(); return; }
      active = ev.pointerId;
      begin(ev.clientY);
      try {
        histHost.setPointerCapture(ev.pointerId);
      } catch { /* jsdom, or a pointer someone else already holds */ }
    };
    const move = (ev: PointerEvent): void => {
      if (viaTouch || active !== ev.pointerId) return;
      step(ev.clientY);
      ev.preventDefault();
    };
    const end = (ev: PointerEvent): void => {
      pointers.delete(ev.pointerId);
      // AND THIS IS THE HALF THAT MATTERS. When another sheet preventDefaults
      // the touch at document level, iOS answers by CANCELLING the pointer
      // stream — a `pointercancel` arrives for a gesture the finger is still
      // making. Ending the drag on it would kill exactly the drag the touch
      // path exists to keep alive.
      if (viaTouch) return;
      if (active === ev.pointerId || pointers.size === 0) { active = null; finish(); }
    };

    const touchStart = (ev: TouchEvent): void => {
      viaTouch = true;
      if (ev.touches.length !== 1) { finish(); return; }   // a pinch, not a scroll
      begin(ev.touches[0]!.clientY);
    };
    const touchMove = (ev: TouchEvent): void => {
      if (ev.touches.length !== 1) { finish(); return; }
      step(ev.touches[0]!.clientY);
    };
    const touchEnd = (): void => {
      finish();
      viaTouch = false;
    };

    histHost.addEventListener('pointerdown', down);
    histHost.addEventListener('pointermove', move);
    histHost.addEventListener('pointerup', end);
    histHost.addEventListener('pointercancel', end);
    // The pointer pair stays in the BUBBLE phase on purpose: `down` reads
    // `defaultPrevented`, which only carries xterm's scrollbar claim once
    // xterm's own handler has run. The touch pair goes in the CAPTURE phase,
    // where nothing below can take it away.
    histHost.addEventListener('touchstart', touchStart, { passive: true, capture: true });
    histHost.addEventListener('touchmove', touchMove, { passive: true, capture: true });
    histHost.addEventListener('touchend', touchEnd, { passive: true, capture: true });
    histHost.addEventListener('touchcancel', touchEnd, { passive: true, capture: true });
    return () => {
      histHost.removeEventListener('pointerdown', down);
      histHost.removeEventListener('pointermove', move);
      histHost.removeEventListener('pointerup', end);
      histHost.removeEventListener('pointercancel', end);
      histHost.removeEventListener('touchstart', touchStart, true);
      histHost.removeEventListener('touchmove', touchMove, true);
      histHost.removeEventListener('touchend', touchEnd, true);
      histHost.removeEventListener('touchcancel', touchEnd, true);
      window.removeEventListener('resize', refitHistory);
      window.visualViewport?.removeEventListener('resize', refitHistory);
      stopGlide();
      // Before `dispose()` because that is the order that states the intent — but
      // the ordering carries NO mechanism, and saying so here is the honest half:
      // both statements run in this one synchronous block and the parse callback
      // fires strictly after it returns (measured, xterm 6.0.0 — `dispose()` does
      // not flush the write queue early), so `alive` is false by then either way.
      // What is load-bearing is the FLAG, and `terminal-scrollback.test.tsx` reds
      // when its check is removed. Do not add a test for this line's position; no
      // test can distinguish the two orderings.
      alive = false;
      term.dispose();
    };
}
