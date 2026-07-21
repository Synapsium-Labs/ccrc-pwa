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
}

export function Sheet({ open, onClose, children, title }: SheetProps): ReactNode {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-scrim" data-testid="sheet-overlay" onClick={onClose} />
        <Drawer.Content className="sheet-panel" aria-describedby={undefined}>
          <div className="sheet-grabber" aria-hidden="true" />
          <Drawer.Title className={title ? 'sheet-title' : 'sr-only'}>
            {title ?? 'Sheet'}
          </Drawer.Title>
          <div className="sheet-body">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
