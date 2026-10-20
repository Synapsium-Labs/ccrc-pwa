// Bottom sheet — vaul (shadcn's Drawer: radix dialog underneath, so focus is
// trapped and Esc dismisses) wearing the Phosphor & Ink chrome: scrim,
// spring-up panel with r-xl top corners, grabber, safe-area padded.
import { Drawer } from 'vaul';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { cn } from '../lib/cn';
import { EYEBROW } from '../lib/text';
import { SHEET_MOTION_VARS, VAUL_MOTION } from '../lib/motion';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Mono uppercase kicker above the title, e.g. "claude is asking". Accepts an
   *  element so callers can hang a chip off it. Falsy renders no kicker line at
   *  all — an empty <p> is invisible but still spends its margin. */
  eyebrow?: ReactNode;
  /** Full-height variant — the terminal drawer's chrome: a --bg-well panel
   *  rising to the safe-area line on --z-drawer, body as a flex column. The
   *  title goes screen-reader-only so the glass keeps its full height. */
  full?: boolean;
  className?: string;
  /** Called with a physical Escape before the sheet dismisses on it, as
   *  Radix's `onEscapeKeyDown` (vaul passes it through). `preventDefault()`
   *  keeps the sheet open; the keydown still reaches what has focus. Absent,
   *  Escape dismisses as it always has. The terminal drawer passes one so an
   *  Esc typed into its terminal goes to the session and never closes it. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** What takes the focus when the sheet opens (D-5931). Absent, or empty when the panel mounts, the panel itself
   *  takes it: never an input, so a phone's keyboard never rises unasked. A danger confirm passes its Cancel
   *  (`useCancelFirst`). The terminal drawer passes nothing: xterm focuses its own textarea when its socket opens. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/** A field that raises a phone's keyboard when focused. */
const isTextField = (el: HTMLElement): boolean =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el.isContentEditable;

/** A mouse or a trackpad, where focusing a field raises no on-screen keyboard. */
const finePointer = (): boolean => window.matchMedia?.('(pointer: fine)').matches === true;

/** THE SHEET OWNS FOCUS (D-5931, spec §2.4 (b)). In on open, trapped while open (Radix's modal scope), back to the
 *  opener on close. One owner: no caller moves the focus into or out of a sheet.
 *
 *  It moves the focus on exactly two events, and never again while open, so a child that takes the focus later
 *  (xterm on its socket's open) keeps it:
 *  - THE PANEL MOUNTS WHILE OPEN (the returned callback ref, stable, so it fires on a mount and on nothing else).
 *    A first open mounts the panel one pass after the opening commit (Radix's `Portal` waits for a layout effect of
 *    its own), and so does every open of a sheet whose parent mounts it already open (`UpdateMoveSheet`). Child refs
 *    attach before the parent's, so `initialFocus` is already set.
 *  - `open` TURNS TRUE (the effect). It runs before that mount pass, while the opener still has the focus, so it
 *    reads the opener there. On a REOPEN DURING THE CLOSE TRANSITION the closing panel is still mounted and no ref
 *    fires, so the effect moves the focus itself.
 *  Every focus passes `preventScroll`: the body is its own scroller and a Cancel at its foot must not scroll the
 *  question away (D-5610). Radix's own open focus stays suppressed (`onOpenAutoFocus`); it would pick the first
 *  tabbable, an input on the new-session and free-text sheets.
 *
 *  The give-back is the effect's cleanup: the dialog's trap (`trapped={open}`) is released by then, and a focus moved
 *  outside a live trap is pulled back in. Radix gives the focus back only to its own `Dialog.Trigger`, which no sheet
 *  uses. An opener that has left the document is left alone, and a disabled one ignores the call (an Ack in flight:
 *  `AckConfirm`'s effect, its parent's, runs after this one and places the focus). A text field gets it back only on a
 *  fine pointer: on a phone that would raise the keyboard unasked, and one tap on the field resumes typing. */
function useSheetFocus(open: boolean, initialFocus: RefObject<HTMLElement | null> | undefined): (el: HTMLElement | null) => void {
  const panel = useRef<HTMLElement | null>(null);
  const isOpen = useRef(open);
  isOpen.current = open;
  const target = useRef(initialFocus);
  target.current = initialFocus;
  // The opener as the focus left it for this sheet: read by whichever of the two events runs first.
  const opener = useRef<HTMLElement | null>(null);
  const focusIn = useCallback((el: HTMLElement): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !el.contains(active)) opener.current = active;
    const want = target.current?.current ?? null;
    (want !== null && el.contains(want) ? want : el).focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const el = panel.current;
    if (el !== null && el.isConnected) {
      // A reopen during the close transition: the panel is mounted already and no ref fires.
      if (!el.contains(document.activeElement)) focusIn(el);
    } else {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    const from = opener;
    return () => {
      const back = from.current;
      from.current = null;
      if (back === null || !back.isConnected) return;
      if (isTextField(back) && !finePointer()) return;
      back.focus({ preventScroll: true });
    };
  }, [open, focusIn]);
  return useCallback((el: HTMLElement | null): void => {
    panel.current = el;
    if (el !== null && isOpen.current) focusIn(el);
  }, [focusIn]);
}

export function Sheet({
  open,
  onClose,
  children,
  title,
  eyebrow,
  full,
  className,
  onEscapeKeyDown,
  initialFocus,
}: SheetProps): ReactNode {
  const panelRef = useSheetFocus(open, initialFocus);
  // The visible title rides INSIDE the scroller, above the children it heads.
  // Outside it, the header row is flex-none and uncapped while only the body
  // scrolls — so a long title (a real AskUserQuestion runs to ~15 lines on a
  // phone) squeezes the body toward zero and, on a landscape viewport, leaves
  // nothing scrollable to reach the options with. Inside, question and options
  // scroll as one.
  const inBody = !full && Boolean(title);
  const heading = (
    <Drawer.Title
      className={
        inBody
          ? // `anywhere` because the title is dynamic: paths, URLs and
            // snake_case identifiers included, and the panel is position:fixed
            // with nothing to clip against. Capped at 38vh so a long question
            // can never push the options out of reach.
            'sheet-title max-h-[38vh] flex-none overflow-y-auto mb-4 font-ui text-lg font-semibold leading-tight text-ink-primary [overflow-wrap:anywhere]'
          : 'sr-only'
      }
    >
      {title ?? 'Sheet'}
    </Drawer.Title>
  );
  return (
    <Drawer.Root
      open={open}
      // THE FULL VARIANT GIVES THE PANEL'S DRAG BACK TO ITS CONTENT. Every
      // other sheet holds a list that vaul's own scroll detection handles, so
      // a downward swipe anywhere is a dismissal and should stay one. The
      // terminal is not a list: its glass owns the wheel and the touch drag
      // (that is the whole of the history this drawer exists to reach), and a
      // panel that also claims the gesture wins it — measured on a phone, a
      // swipe over the console collapsed the drawer instead of scrolling it.
      // `handleOnly` leaves exactly one place that drags the panel: the
      // grabber, which is why it becomes a real `Drawer.Handle` below.
      handleOnly={full}
      // THE KEYBOARD IS COUNTED ONCE. vaul's `repositionInputs` shrinks the panel
      // to the visual viewport whenever a textarea has focus, and the terminal
      // already pads its own bottom by the keyboard's height (`useKeyboardInset`,
      // the discipline the session screen shares). Both at once subtract the
      // keyboard twice: measured on an Android phone (Chrome 155, a 792px layout
      // viewport, a 444px visual one), the glass collapsed to zero rows and the
      // input box the operator was typing into left the screen. The full variant
      // keeps the app's inset; every other sheet keeps vaul's
      // (`sheet-keyboard-once.test.tsx`).
      repositionInputs={!full}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay
          // The scrim fades on vaul's keyframes at the panel's pace (D-5930).
          className={cn('sheet-scrim fixed inset-0 z-sheet bg-scrim', VAUL_MOTION, SHEET_MOTION_VARS)}
          data-testid="sheet-overlay"
          onClick={onClose}
        />
        <Drawer.Content
          ref={panelRef}
          // Focusable from script only, and named by its title (Radix's `aria-labelledby`): the panel is what takes
          // the focus when nothing else is asked for (D-5931).
          tabIndex={-1}
          aria-describedby={undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          // Radix's own open focus stays off; the focus is `useSheetFocus`'s, never this event's (D-5931).
          onOpenAutoFocus={(event) => { event.preventDefault(); }}
          className={cn(
            // NO z-index HERE, on purpose: each arm states its own. `z-sheet` and
            // `z-drawer` are custom utilities cn() cannot tell apart, so both
            // survived on the full panel and the alphabetical emit order of Tailwind
            // let `z-sheet` (40) win — the terminal drawer sank to the level of
            // the sheets it is meant to sit above (main: 50).
            // `outline-none!` is IMPORTANT because the panel takes the focus (D-5931): after a keyboard open Chrome
            // marks it `:focus-visible`, and the app's page-wide `:focus-visible` ring is unlayered, so it beats a
            // layered utility. A ring round the whole panel says nothing; the panel is a container, not a control.
            'sheet-panel fixed inset-x-0 bottom-0 flex flex-col outline-none!',
            // vaul slides the panel with KEYFRAMES, which no transition utility
            // reaches: retimed that way it slid for vaul's own half second, and
            // under reduced motion too. 'lib/motion.ts' puts the keyframes on the
            // tokens (D-5930): the entrance springs on --dur-sheet, the exit
            // leaves swiftly on --dur-slow, and both are 1ms under reduce. The
            // same helper retimes vaul's inline drag transition (the snap-back
            // after a short drag), which the old utilities had covered.
            VAUL_MOTION,
            SHEET_MOTION_VARS,
            full
              ? // The panel becomes the well itself: dark glass in BOTH themes,
                // stacked above ordinary sheets. Horizontal padding drops to
                // zero — the terminal runs to the glass edge. It keeps the
                // r-xl top corners and the lift shadow of every sheet: on main,
                // `.sheet-panel--full` only re-stated height, ground, padding
                // and z-index over `.sheet-panel`, so it inherited both.
                'sheet-panel--full z-drawer h-[calc(100dvh-var(--safe-top)-var(--sp-6))] rounded-t-xl bg-well shadow-sheet px-0 pt-2 pb-[calc(var(--sp-2)+var(--safe-bottom))]'
              : // The sides pad with the card role (D-5093, Task 14b): 16px in
                // Refined, the --sp-4 it used before, and 12px in Instrument.
                'z-sheet max-h-[calc(100dvh-var(--sp-12)-var(--safe-top))] rounded-t-xl bg-sheet shadow-sheet px-card pt-2 pb-[calc(var(--sp-4)+var(--safe-bottom))]',
            className,
          )}
        >
          {/* On-well furniture restates itself in the well's ink so it survives
              the dark glass in the light theme too.

              A DECORATIVE BAR CANNOT BE THE ONE THING THAT DRAGS. With
              `handleOnly` above, the full sheet's only drag target is this
              element, so it becomes vaul's own handle: that carries the
              pointer wiring and an invisible hit area larger than the 4px bar
              a thumb would otherwise have to find. The plain div stays for
              every other sheet, where the whole panel is still the drag target
              and the bar is only a hint. */}
          {/* THE GROUND OF THE HANDLE IS IMPORTANT (`!`) BECAUSE THE ONE vaul
              INJECTS IS UNLAYERED: `[data-vaul-handle]{background:#e2e2e4; …}`
              at runtime, outside every layer, and an unlayered rule beats
              these layered utilities — the grabber went near-white on the
              dark glass. On main `.sheet-panel--full .sheet-grabber` won on
              specificity; a utility can only win on importance. `mt-1` is the
              top margin of the base grabber, which the full variant kept on main. */}
          {full
            ? <Drawer.Handle
                aria-hidden="true"
                className="sheet-grabber mx-auto mt-1 mb-2 h-1 w-9 flex-none rounded-full bg-ink-on-well/30!"
              />
            : <div
                aria-hidden="true"
                className="sheet-grabber mx-auto mt-1 mb-4 h-1 w-9 flex-none rounded-full bg-edge-strong"
              />}
          {eyebrow ? (
            <p
              className={cn(
                `sheet-eyebrow mb-2 flex-none ${EYEBROW} [overflow-wrap:anywhere]`,
                full ? 'px-4 text-ink-on-well/55' : 'text-ink-tertiary',
              )}
            >
              {eyebrow}
            </p>
          ) : null}
          {inBody ? null : heading}
          {/* A box that scrolls on one axis clips on both, so the scrolling
              body is a clip edge at its sides, flush with every full-width
              row, and `FOCUS_RING` draws 4px outside its control (2px outline,
              2px offset). `px-1 -mx-1` moves the clip edge out by that reach
              and leaves the content box where it was (D-5495,
              `pwa/test/sheet-ring-room.test.tsx`). */}
          <div
            className={cn(
              'sheet-body min-h-0',
              full ? 'flex flex-1 flex-col overflow-hidden' : '-mx-1 px-1 overflow-y-auto overscroll-contain',
            )}
          >
            {inBody ? heading : null}
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
