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
// ONE STYLESHEET, FOR THE TYPING ONLY. `wordmark.css` holds `wordmark-type` and `wordmark-cursor`, the `overlord_`
// mark's typed entrance, and nothing else: the mark's type, colour and gap stay utilities. The default `ccrc` arm
// passes neither hook class and renders what it always did. The `ccrc` arm retires with the rename; nothing here
// renames the product.
//
// THE `overlord` ARM. `overlord` in Geist Mono at weight 800 (`font-extrabold`, Tailwind's default: no weight token
// maps 800, and Geist Mono is variable from 100 to 900), then an `_` in `text-phosphor`, `aria-hidden`, with no caret and no gap.
// Accessible text is "overlord". `typed` adds `wordmark-type` to the word (width, `steps(8)` over 1.2 s, once) and
// `wordmark-cursor` to the underscore, which starts to blink when the typing ends. Reduced motion shows the whole
// word and a steady underscore.
//
// Accessible text of the `ccrc` arm is "ccrc": the caret is decoration, and `aria-hidden`.
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import './wordmark.css';

export const WORDMARK =
  'inline-flex items-baseline gap-[0.4em] whitespace-nowrap'
  + ' font-mono font-medium text-xl leading-none not-italic normal-nums text-ink-primary';

/** The `overlord` arm: weight 800 in place of the `ccrc` arm's medium, and no gap, because `overlord_` is one word
 *  whose underscore sits against the last letter (the brief's reference draws no space there). */
const OVERLORD = WORDMARK.replace('font-medium', 'font-extrabold').replace('gap-[0.4em]', 'gap-0');

export interface WordmarkProps {
  /** Which mark. Default `ccrc`, what every bar renders today. */
  mark?: 'ccrc' | 'overlord';
  /** `overlord` only: type the word once, then blink the underscore. Default false. */
  typed?: boolean;
  /** Placement only (a margin, a flex item's grow). The mark's type and
   *  colour are the identity core and are not a call site's to change. */
  className?: string;
}

export function Wordmark({ mark = 'ccrc', typed = false, className }: WordmarkProps): ReactNode {
  if (mark === 'overlord') {
    return (
      <span data-wordmark="" className={cn(OVERLORD, className)}>
        <span className={typed ? 'wordmark-type' : undefined}>overlord</span>
        <span aria-hidden="true" className={cn('text-phosphor', typed && 'wordmark-cursor')}>_</span>
      </span>
    );
  }
  return (
    <span data-wordmark="" className={cn(WORDMARK, className)}>
      <span aria-hidden="true" className="text-phosphor">❯</span>
      <span>ccrc</span>
    </span>
  );
}
