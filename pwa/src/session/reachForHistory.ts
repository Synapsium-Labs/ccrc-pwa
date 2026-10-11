// THE DOOR A FINGER CAN OPEN. A phone has no wheel, and on the live terminal
// glass there is nothing to scroll anyway — tmux attaches the client on the
// alternate screen, where xterm keeps no scrollback — so the key bar was the
// only way into the console history. The gesture still has one obvious meaning,
// and it is the wheel's: reach for what is above the screen.
//
// Eighty-odd lines of pointer-and-touch arbitration, lifted out of
// `TerminalDrawer`'s 225-line attach effect, where they sat between the socket
// and the resize observer with nothing to do with either. `attach…`/`detach`
// is `historyPane.ts`'s own shape, one file over.

/** How far a finger must travel DOWN the live glass before it counts as a
 *  reach for the history, in CSS pixels. About a row and a half: smaller reads
 *  as a tap that moved, and the reader gets a history they did not ask for. */
export const TOUCH_OPEN_PX = 24;

/**
 * Watch `host` for the reach, and call `onReach` once per gesture that makes
 * it. Returns the detach.
 *
 * NOTHING IS PREVENTED HERE. A tap must still reach xterm's textarea, so the
 * press is only watched, never claimed; the history opens on the move that
 * crosses the threshold and the pointer is left to xterm either way.
 *
 * AND IT IS WATCHED TWICE, because on the phone the pointer half cannot work
 * alone. vaul installs `preventScrollMobileSafari` while a drawer is open —
 * `document`, capture phase, `passive: false` — and it calls `preventDefault()`
 * on touchmove for any touch whose scroll parent is the document, which on this
 * glass is every touch (`.term-host` and every xterm element inside it are
 * `overflow: hidden`). Safari answers a prevented touchmove by tearing down the
 * POINTER stream for that gesture, so `pointermove` never arrives and the drag
 * that opens the history could never have fired on an iPhone. It never did:
 * measured on the operator's own phone across four builds, "не реагує зовсім".
 *
 * The touch listeners are not affected by that — `preventDefault` stops the
 * default action, not the other listeners, and vaul never calls
 * `stopPropagation`. One finger is still counted once: a touch gesture takes
 * ownership for its duration and the pointer echo stands down.
 */
export function attachReachForHistory(host: HTMLElement, onReach: () => void): () => void {
  let from: { x: number; y: number } | null = null;
  let openViaTouch = false;

  const reach = (x: number, y: number): void => {
    if (from === null) return;
    const dy = y - from.y;
    const dx = x - from.x;
    // DOWN, and more down than sideways: a swipe across the glass is not a
    // reach for older output, and a wobble is not a swipe. The threshold is
    // about a row and a half, which is the smallest travel that reads as
    // deliberate on a phone rather than as a tap that moved.
    if (dy < TOUCH_OPEN_PX || Math.abs(dx) > Math.abs(dy)) return;
    from = null;
    onReach();
  };
  const openDown = (ev: PointerEvent): void => {
    if (openViaTouch) return;                           // the finger owns this
    // THE MOUSE IS SELECTING TEXT, NOT REACHING FOR HISTORY — the same
    // stand-down the history layer's own drag makes one level down, and for
    // the same reason. xterm starts a selection on mousedown and follows it
    // with a document-level mousemove; a reader dragging across the live pane
    // to copy a line got a history layer over their selection, and the
    // selection with it. The mouse loses nothing by standing down: its
    // gesture for this is the wheel, which opens the history already.
    if (ev.pointerType === 'mouse') { from = null; return; }
    if (ev.defaultPrevented) { from = null; return; }   // xterm's own scrollbar
    from = { x: ev.clientX, y: ev.clientY };
  };
  const openMove = (ev: PointerEvent): void => {
    if (openViaTouch) return;
    reach(ev.clientX, ev.clientY);
  };
  const openEnd = (): void => { if (!openViaTouch) from = null; };
  const openTouchStart = (ev: TouchEvent): void => {
    openViaTouch = true;
    if (ev.touches.length !== 1) { from = null; return; }  // a pinch, not a reach
    from = { x: ev.touches[0]!.clientX, y: ev.touches[0]!.clientY };
  };
  const openTouchMove = (ev: TouchEvent): void => {
    if (ev.touches.length !== 1) { from = null; return; }
    reach(ev.touches[0]!.clientX, ev.touches[0]!.clientY);
  };
  const openTouchEnd = (): void => { from = null; openViaTouch = false; };

  host.addEventListener('pointerdown', openDown);
  host.addEventListener('pointermove', openMove);
  host.addEventListener('pointerup', openEnd);
  host.addEventListener('pointercancel', openEnd);
  // CAPTURE for the touch pair, and it is insurance rather than a measured
  // need: xterm 6.0.0 binds no touch listener at all (measured — nothing in
  // `browser/` listens for one), but it DOES call `stopPropagation()`
  // unconditionally in its paste handler one level below this host, which is
  // how the clipboard fix was lost for a day. A listener that must not be taken
  // away belongs above the elements that could take it.
  host.addEventListener('touchstart', openTouchStart, { passive: true, capture: true });
  host.addEventListener('touchmove', openTouchMove, { passive: true, capture: true });
  host.addEventListener('touchend', openTouchEnd, { passive: true, capture: true });
  host.addEventListener('touchcancel', openTouchEnd, { passive: true, capture: true });

  return () => {
    host.removeEventListener('pointerdown', openDown);
    host.removeEventListener('pointermove', openMove);
    host.removeEventListener('pointerup', openEnd);
    host.removeEventListener('pointercancel', openEnd);
    host.removeEventListener('touchstart', openTouchStart, true);
    host.removeEventListener('touchmove', openTouchMove, true);
    host.removeEventListener('touchend', openTouchEnd, true);
    host.removeEventListener('touchcancel', openTouchEnd, true);
  };
}
