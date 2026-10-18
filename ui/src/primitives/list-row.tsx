// ListRow — a pressable row in a list, with a hairline under it.
//
// TWELVE DECLARATIONS, IDENTICAL, IN TWO STYLESHEETS. `.menu-item`
// (chat.css — the session header's overflow menu) and `.acct-list .acct-row`
// (fleet.css — the swap sheet's account picker) agreed on every one: the flex
// row, the 52px height, the `--sp-2`/`--sp-1` padding, the bottom hairline,
// no chrome of its own, left-aligned, and the same press transform. Living in
// two files is how this one survived every wave that read a single sheet —
// the shape census found it by comparing declarations instead.
//
// 52px IS NOT `--tap-min` AND THAT IS THE POINT. Both rules spelled the
// literal, eight pixels above the 44px floor, because a row in a LIST is
// scrolled past as often as it is pressed: the extra height is what separates
// neighbours a thumb is dragging over. It stays a literal here for the same
// reason it was one there — `--tap-min` is a floor to clear, not a height to
// adopt, and a `--list-row` token would imply the two numbers move together.
//
// IT CLOSES ONE DIRECTION OF A HAZARD, NOT BOTH. `.acct-row` was TWO things
// in this app: the row of the picker, and the 5h/7d gauge line of `AccountMeterRow`,
// which is a grid of mono micro-type. They collided once — the 52px touch
// target leaked into the gauge lines — and the descendant selector
// `.acct-list .acct-row` only contained that. Moving the shape in here stops
// the ROW leaking into the gauge line. It does nothing for the other
// direction: this shape is `@layer utilities`, an app sheet is UNLAYERED, and
// an unlayered rule beats every layer. While the picker still wore `acct-row`
// as its hook, the unscoped grid rule of the gauge line won on it — grid for flex,
// gap 5px, the account chip squeezed to 18px. So a hook class handed to this
// component must name nothing else: the picker wears `acct-pick`, and
// `pwa/test/hook-class-collision.test.ts` reds on a class name worn both by a
// @ccrc/ui component and by any other element.
//
// NO GROUND, like ControlRow and for the same reason: `background: none` was
// one of the twelve, so neither rule ever painted. `.menu-item` keeps its own
// `color` and `font` in chat.css — they are the menu's voice, not the row's,
// and they are what `design/audit.mjs` measures it through.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import { PRESS_GROUND, PRESS_TRANSFORM } from '../lib/press';

/** The shared row, token for token as both rules declared it.
 *
 *  `border-x-0 border-t-0 border-b` rather than `border-0 border-b`: both
 *  spell the same thing, but the short form leans on Tailwind emitting
 *  `border-width` before `border-bottom-width`, which is a sort order, not a
 *  promise. The long form says it in properties that cannot disagree. */
export const LIST_ROW =
  'flex w-full items-center gap-3 min-h-[52px] px-1 py-2'
  + ' border-x-0 border-t-0 border-b border-edge-subtle bg-transparent text-left'
  + ` ${PRESS_TRANSFORM} active:scale-[0.97]`
  // D-5101: the row lifts under the mouse and sinks while held.
  + ` ${PRESS_GROUND}`
  + ` ${FOCUS_RING}`;

export interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The hook class. Both consumers keep theirs: `.menu-item` carries the
   *  type and ink of the menu, `.acct-pick` names the row of the account
   *  picker. A hook must be unique to this row — an unlayered app rule
   *  written for another element that shares the name beats this shape. */
  className?: string;
  children: ReactNode;
}

export function ListRow(
  { className, type = 'button', children, ...props }: ListRowProps,
): ReactNode {
  return (
    <button type={type} className={cn(LIST_ROW, className)} {...props}>{children}</button>
  );
}
