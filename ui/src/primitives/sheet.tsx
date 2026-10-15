// Bottom sheet — vaul (shadcn's Drawer: radix dialog underneath, so focus is
// trapped and Esc dismisses) wearing the Phosphor & Ink chrome: scrim,
// spring-up panel with r-xl top corners, grabber, safe-area padded.
import { Drawer } from 'vaul';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { EYEBROW } from '../lib/text';

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
}

export function Sheet({
  open,
  onClose,
  children,
  title,
  eyebrow,
  full,
  className,
}: SheetProps): ReactNode {
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
          className="sheet-scrim fixed inset-0 z-sheet bg-scrim"
          data-testid="sheet-overlay"
          onClick={onClose}
        />
        <Drawer.Content
          aria-describedby={undefined}
          className={cn(
            // NO z-index HERE, on purpose: each arm states its own. `z-sheet` and
            // `z-drawer` are custom utilities cn() cannot tell apart, so both
            // survived on the full panel and the alphabetical emit order of Tailwind
            // let `z-sheet` (40) win — the terminal drawer sank to the level of
            // the sheets it is meant to sit above (main: 50).
            'sheet-panel fixed inset-x-0 bottom-0 flex flex-col outline-none',
            // vaul inlines its own transition, so retiming it to the motion
            // tokens needs the important suffix. Entrance springs (420ms
            // overshoot); exit leaves swiftly (320ms).
            'data-[state=open]:duration-sheet! data-[state=open]:ease-spring!',
            'data-[state=closed]:duration-slow! data-[state=closed]:ease-swift!',
            full
              ? // The panel becomes the well itself: dark glass in BOTH themes,
                // stacked above ordinary sheets. Horizontal padding drops to
                // zero — the terminal runs to the glass edge. It keeps the
                // r-xl top corners and the lift shadow of every sheet: on main,
                // `.sheet-panel--full` only re-stated height, ground, padding
                // and z-index over `.sheet-panel`, so it inherited both.
                'sheet-panel--full z-drawer h-[calc(100dvh-var(--safe-top)-var(--sp-6))] rounded-t-xl bg-well shadow-sheet px-0 pt-2 pb-[calc(var(--sp-2)+var(--safe-bottom))]'
              : 'z-sheet max-h-[calc(100dvh-var(--sp-12)-var(--safe-top))] rounded-t-xl bg-sheet shadow-sheet px-4 pt-2 pb-[calc(var(--sp-4)+var(--safe-bottom))]',
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
          <div
            className={cn(
              'sheet-body min-h-0',
              full ? 'flex flex-1 flex-col overflow-hidden' : 'overflow-y-auto overscroll-contain',
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
