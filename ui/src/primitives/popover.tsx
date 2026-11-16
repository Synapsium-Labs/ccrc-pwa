// Popover (D-5934) — Radix's popover wearing the Phosphor & Ink chrome: a
// `--bg-sheet` panel on `shadow-pop` with `--r-lg` corners, in a portal,
// placed beside its trigger and flipped or shifted off any edge it would
// cross. Radix owns everything else, and it is the same Radix the Sheet runs
// on (vaul's dialog): one dismissable layer, one focus scope, one portal.
// Escape and an outside press close it, and focus returns to the trigger.
// A hand-rolled placement or dismissal beside this would be a second owner.
//
// Its first consumer is the workflow strip's per-agent menu at >=900; below
// that width the same menu is a `Sheet`.
import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** The open state's owner. Uncontrolled by default; pass `open` and
 *  `onOpenChange` to drive it. Non-modal, so the page behind stays readable
 *  and an outside press both closes it and reaches what was pressed. */
export const Popover = PopoverPrimitive.Root;

/** The real button the popover hangs off. `asChild` lends its behaviour to a
 *  caller's own button instead of rendering one. */
export const PopoverTrigger = PopoverPrimitive.Trigger;

/** Closes the popover through Radix and hands focus back to the trigger.
 *  `asChild` wraps a menu item that acts, so a choice also closes the menu. */
export const PopoverClose = PopoverPrimitive.Close;

export type PopoverContentProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>;

/** Room kept between the panel and the viewport edge it is pushed off. */
const EDGE_ROOM_PX = 16;

export function PopoverContent({
  className,
  align = 'end',
  sideOffset = 6,
  collisionPadding = EDGE_ROOM_PX,
  children,
  ...props
}: PopoverContentProps): ReactNode {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          // Never wider or taller than the room Radix measured on the side it
          // chose, so a long menu scrolls inside the panel instead of off-screen.
          'z-sheet min-w-[12rem] max-w-[var(--radix-popover-content-available-width)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto',
          'rounded-lg border border-edge-subtle bg-sheet shadow-pop p-1 text-ink-primary outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
