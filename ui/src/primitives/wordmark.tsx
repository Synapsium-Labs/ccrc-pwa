// Wordmark — `❯ ccrc`, the first item of the identity core (D-5094, spec §3.1).
//
// ONE PRIMITIVE, BECAUSE EVERY SKIN'S BAR RENDERS IT (D-5470). The element
// half of D-5094's guard requires both shells to show the same mark, and a
// mark spelled once per shell is two marks that agree until one of them is
// edited. So it is built once, here, and the shells place it as they land.
//
// TODAY'S VALUES, NOT NEW ONES. `.wordmark` in `pwa/src/fleet/fleet.css` sets
// `font: var(--weight-medium) var(--fs-xl) / 1 var(--family-mono)` in
// `--ink-primary`, and `.wordmark::before` paints the caret in `--accent` with
// `margin-right: 0.4em`. This takes exactly those: `text-xl` (`--fs-xl`),
// `leading-none` (1), `font-mono`, `font-medium`, `text-ink-primary`, and a
// 0.4em gap. `not-italic normal-nums` restore what the `font:` shorthand
// resets on its way past, as `Well` and `Keycap` do for the same reason.
//
// `text-phosphor`, NOT `text-accent`. theme.css maps ccrc's `--accent` to the
// Tailwind key `phosphor`, because shadcn reserves `accent` for a muted hover
// surface. `text-accent` compiles to no ccrc colour at all, so the caret would
// render in whatever ink it inherits — the failure `wordmark.test.tsx` resolves
// through theme.css's `@theme` map rather than trusting a class string.
//
// A BOX GAP, NOT A TEXT SPACE. The caret and the name are two flex items with
// a gap between them and no text node, so there is no wrap opportunity
// between them (the foundations plan's F13 item 4, moved here). `nowrap`
// holds the name itself; a caller that genuinely wants it to wrap passes
// `whitespace-normal`, which `cn` (tailwind-merge) lets win because
// `className` merges after the base.
//
// NO HOOK CLASS. Utilities and a `data-wordmark` attribute only, so no
// stylesheet selector, contrast-gate key or census entry is created by it.
// Accessible text is "ccrc": the caret is decoration, and `aria-hidden`.
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export const WORDMARK =
  'inline-flex items-baseline gap-[0.4em] whitespace-nowrap'
  + ' font-mono font-medium text-xl leading-none not-italic normal-nums text-ink-primary';

export interface WordmarkProps {
  /** Placement only (a margin, a flex item's grow). The mark's type and
   *  colour are the identity core and are not a call site's to change. */
  className?: string;
}

export function Wordmark({ className }: WordmarkProps): ReactNode {
  return (
    <span data-wordmark="" className={cn(WORDMARK, className)}>
      <span aria-hidden="true" className="text-phosphor">❯</span>
      <span>ccrc</span>
    </span>
  );
}
