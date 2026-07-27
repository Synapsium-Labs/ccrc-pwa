// Bottom sheet — vaul drawer wearing the Phosphor & Ink chrome: scrim,
// spring-up panel (r-xl top corners, safe-area padded), grabber. Swipe-down,
// scrim tap, and Esc all dismiss; focus is trapped inside while open (radix
// dialog underneath vaul). Entrance/exit timing is retimed to the motion
// tokens in primitives.css.
import { Drawer } from 'vaul';
import type { ReactNode } from 'react';
import './primitives.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Mono uppercase kicker above the title, e.g. "claude is asking". Accepts an
   *  element so callers can hang a chip off it (DialogSheet's header badge).
   *  Falsy (undefined, null, false, '', 0) renders no kicker line at all —
   *  an empty <p> is invisible but still spends its margin above the title. */
  eyebrow?: ReactNode;
  /** Full-height variant — the terminal drawer's chrome (Task 12): a
   *  --bg-well panel rising to the safe-area line on --z-drawer, body as a
   *  flex column. The title goes screen-reader-only so the glass keeps its
   *  full height for the terminal. */
  full?: boolean;
}

export function Sheet({ open, onClose, children, title, eyebrow, full }: SheetProps): ReactNode {
  // The visible title rides INSIDE the scroller, above the children it heads.
  // Outside it, the header row is `flex: none` and uncapped while only
  // `.sheet-body` scrolls — so a long title (DialogSheet's real
  // AskUserQuestion runs to ~15 lines on a phone) squeezes the body toward zero
  // and, on a landscape viewport, leaves nothing scrollable to reach the
  // options with. Inside, question and options scroll as one. The full variant
  // keeps its screen-reader-only title out of the terminal's flex column.
  const inBody = !full && Boolean(title);
  const heading = (
    <Drawer.Title className={inBody ? 'sheet-title' : 'sr-only'}>{title ?? 'Sheet'}</Drawer.Title>
  );
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-scrim" data-testid="sheet-overlay" onClick={onClose} />
        <Drawer.Content
          className={full ? 'sheet-panel sheet-panel--full' : 'sheet-panel'}
          aria-describedby={undefined}
        >
          <div className="sheet-grabber" aria-hidden="true" />
          {eyebrow ? <p className="sheet-eyebrow">{eyebrow}</p> : null}
          {inBody ? null : heading}
          <div className="sheet-body">
            {inBody ? heading : null}
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
