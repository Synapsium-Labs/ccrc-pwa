// Icon — a vendored lucide icon, stroked in the control's ink (D-5100).
//
// WHY IT REPLACES THE EMOJI. A colour emoji is drawn by the platform's emoji
// font: its own colours (which no palette reaches), its own size and baseline,
// and a different picture on every OS. An icon stroked in `currentColor`
// follows the control's ink in every palette and both skins, so the identity
// core's rule that a skin owns no colour holds for glyphs too.
//
// DECORATION ONLY. `aria-hidden` and never focusable (an <svg> is focusable by
// default in some engines): every call site keeps its word or its label, which
// is what carries the meaning (the doors' rule, `door.tsx`).
//
// NO MARKUP STRING. The children are made by `createElement` from the nodes in
// `../icons/lucide.ts`, whose tags are a closed set and whose attrs are
// geometric (`pwa/test/icon.test.tsx`). Nothing here parses or injects SVG.
//
// THE STROKE. lucide draws at 2 on a 24 grid. At 16 and 20 that reads heavier
// than the Geist pair's text beside it, so 1.75; at 24 the icon is already
// large and 1.5 keeps it from shouting.
import { createElement, type ReactNode } from 'react';
import { ICONS, type IconName } from '../icons/lucide';
import { cn } from '../lib/cn';

export type { IconName };

export type IconSize = 16 | 20 | 24;

/** A block, never shrunk. An inline <svg> sits on the text baseline and adds
 *  the descender gap under itself, which would grow every `line-height: 1`
 *  glyph span it replaces; as a block it is exactly `size` tall. */
export const ICON = 'block flex-none';

const STROKE: Record<IconSize, number> = { 16: 1.75, 20: 1.75, 24: 1.5 };

export interface IconProps {
  name: IconName;
  /** Rendered width and height in px. */
  size?: IconSize;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE[size]}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn(ICON, className)}
    >
      {ICONS[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
