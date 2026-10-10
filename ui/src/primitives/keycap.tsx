// Keycap — a key, drawn as a key.
//
// TWO RULES, TEN DECLARATIONS SHARED. `.chat-head .keycap` (the session
// header's controls) and `.term-keys .keycap` (the terminal drawer's key row)
// agree on the geometry, the type and the press: a tap-square grid with its
// content centred, mono micro-caps, a `--r-sm` corner, a HEAVIER BOTTOM
// BORDER, and a 1px downward nudge when pressed. The heavy bottom edge is the
// whole idea — chat.css's own comment calls it "a keycap, not an icon" — and
// it was written out twice.
//
// THE SHAPE CENSUS DID NOT FIND THIS ONE, which is worth recording rather
// than quietly fixing. The two rules agree on ten declarations and disagree
// on five, which puts them near 0.5 on the census's measure and well below
// its 0.72 window. They disagree on exactly the five that make a GROUND —
// flex, padding, ink, fill, border colour — because one sits on `--bg-raised`
// chrome and the other on the terminal's own well, where every colour is a
// `color-mix` over `--ink-on-well`. A census tuned to catch near-copies
// cannot also catch two copies wearing different skins. This one was found by
// reading, which is why that threshold is documented in the census rather
// than tuned until it catches everything: tuning it down to 0.5 would pair
// every flex row in the tree.
//
// SO IT OWNS THE SHAPE, NOT THE SKIN, like ControlRow and for a sharper
// reason than consistency: the terminal keycap's fill is
// `color-mix(in srgb, var(--ink-on-well) 9%, transparent)`, and
// `utility-pairs.test.ts` resolves a utility back to a token through
// theme.css's `@theme` block. An arbitrary `bg-[color-mix(…)]` has no stem
// there, so moving that ground into a variant would drop the pair out of both
// halves of the gate at once — measured nowhere, green everywhere.
//
// `enabled:active:` ON THE PRESS, because the two rules disagreed about that
// too: the header's is `:active:not(:disabled)` and the terminal's is a bare
// `:active`. Only the header renders a disabled keycap (`esc`, while nothing
// is running), so the stricter of the two is the one that is ever observed,
// and it is the one that generalises.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';

/** The ten, token for token as both rules declared them.
 *
 *  `not-italic normal-nums` because both used the `font:` SHORTHAND, which
 *  resets `font-style` and `font-variant-numeric` on its way past — and one
 *  of these keys legends a digit. */
export const KEYCAP =
  'keycap grid min-w-tap min-h-tap place-items-center rounded-sm border border-b-2'
  + ' font-mono text-xs font-medium leading-none tracking-caps not-italic normal-nums'
  + ' cursor-pointer transition-transform duration-press ease-swift'
  + ' motion-reduce:transition-none enabled:active:translate-y-px'
  + ` ${FOCUS_RING}`;

export interface KeycapProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** OPTIONAL, unlike every other hook class in this package, because this
   *  one is already in `KEYCAP`. Both grounds are reached by a DESCENDANT
   *  selector — `.chat-head .keycap`, `.term-keys .keycap` — so a keycap is
   *  skinned by where it sits, and the terminal's sequence keys genuinely
   *  need nothing of their own. What arrives here is a MODIFIER when there is
   *  one: `--pr`, `--act`, `--esc`, `--term`, `--more`. */
  className?: string;
  children: ReactNode;
}

export function Keycap(
  { className, type = 'button', children, ...props }: KeycapProps,
): ReactNode {
  return (
    <button type={type} className={cn(KEYCAP, className)} {...props}>{children}</button>
  );
}
