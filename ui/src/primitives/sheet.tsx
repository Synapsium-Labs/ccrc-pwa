// Bottom sheet — vaul (shadcn's Drawer: radix dialog underneath, so focus is
// trapped and Esc dismisses) wearing the Phosphor & Ink chrome: scrim,
// spring-up panel with r-xl top corners, grabber, safe-area padded.
import { Drawer } from 'vaul';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

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
            'sheet-panel fixed inset-x-0 bottom-0 z-sheet flex flex-col outline-none',
            // vaul inlines its own transition, so retiming it to the motion
            // tokens needs the important suffix. Entrance springs (420ms
            // overshoot); exit leaves swiftly (320ms).
            'data-[state=open]:duration-sheet! data-[state=open]:ease-spring!',
            'data-[state=closed]:duration-slow! data-[state=closed]:ease-swift!',
            full
              ? // The panel becomes the well itself: dark glass in BOTH themes,
                // stacked above ordinary sheets. Horizontal padding drops to
                // zero — the terminal runs to the glass edge.
                'sheet-panel--full z-drawer h-[calc(100dvh-var(--safe-top)-var(--sp-6))] bg-well px-0 pt-2 pb-[calc(var(--sp-2)+var(--safe-bottom))]'
              : 'max-h-[calc(100dvh-var(--sp-12)-var(--safe-top))] rounded-t-xl bg-sheet shadow-sheet px-4 pt-2 pb-[calc(var(--sp-4)+var(--safe-bottom))]',
            className,
          )}
        >
          {/* On-well furniture restates itself in the well's ink so it survives
              the dark glass in the light theme too. */}
          <div
            aria-hidden="true"
            className={cn(
              'sheet-grabber mx-auto h-1 w-9 flex-none rounded-full',
              full ? 'mb-2 bg-ink-on-well/30' : 'mt-1 mb-4 bg-edge-strong',
            )}
          />
          {eyebrow ? (
            <p
              className={cn(
                'sheet-eyebrow mb-2 flex-none font-mono text-2xs font-medium uppercase leading-none tracking-caps [overflow-wrap:anywhere]',
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
