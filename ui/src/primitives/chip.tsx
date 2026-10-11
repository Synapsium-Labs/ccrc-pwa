// Chip — a pill-shaped label, optionally with a dot in its own colour.
//
// SHAPE, NOT SKIN — the CollapsibleStrip rule. The base was `.chip` in
// fleet.css and a byte-identical `.chat .chip` in chat.css, and it says
// nothing about meaning: inline-flex, a 6px gap, a mono micro-label, pill
// padding, fully rounded. Every chip in the app then paints itself from
// OUTSIDE — the account chips through an inline `style` carrying token names
// from `lib/accounts.ts`, the three chat modifiers (`--active`, `--archived`,
// `--repo`) through colour-only rules in chat.css. None of that moves here.
//
// So there is no `tone` variant and deliberately so. A chip's colour in this
// app is an ACCOUNT HUE or a session state, both of which are ccrc routing
// vocabulary rather than design-system vocabulary — the same reason PickSheet
// stayed in the app with its `.opt-inert` markers. What the design system owns
// is the pill; what ccrc owns is what the pill means.
//
// RE-OPENED BY A DESIGN-SYSTEM AUDIT AND RE-CLOSED, with the three modifiers
// measured instead of described, so the next reader does not have to look:
//
//   .chip--active    --acct-active on --acct-active-tint  (chat.css)
//   .chip--archived  --ink-tertiary on --bg-raised, and its rule carries the
//                    reason it is not the well: ink-tertiary on well measures
//                    3.17:1 in LIGHT, under the floor
//   .chip--repo      font-family: var(--family-mono) — not a tone at all
//
// The first is an account alias, the second a measured contrast decision
// belonging to the surface it sits on, the third a family. A `tone` axis over
// those three would be the design system holding ccrc's account vocabulary,
// one app screen's contrast argument, and a typeface, under one word that
// means none of them. The call sites keep the classes.
//
// THE DOT IS `currentColor` BY DESIGN. `.chip i` set `background:
// currentColor`, so the dot takes whatever colour the chip was given from
// outside without that colour needing to be named twice. Keeping it means a
// caller sets one colour, not two, and the two can never drift apart.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Token for token as both copies of the rule declared it.
 *
 *  `gap-[6px]` and `px-[9px]` are literals because the rule's were: 6px sits
 *  between `--sp-1` (4px) and `--sp-2` (8px), 9px between `--sp-2` and
 *  `--sp-3` (12px), and a mono micro-label reads wrong at either neighbour.
 *  Preserved rather than rounded — rounding is a visual change dressed as
 *  tidying, and inventing half-step tokens for two paddings is worse. */
export const CHIP =
  'chip inline-flex items-center gap-[6px] rounded-full px-[9px] py-1'
  + ' font-mono text-xs font-medium leading-none not-italic normal-nums';

/** The dot, when there is one. `currentColor`, so it needs no colour of its
 *  own — see the header. Rendered `aria-hidden`: the label carries the
 *  meaning, and a screen reader announcing a bullet adds nothing.
 *
 *  NO `flex-none`, and no `block`. The rule had neither. `flex-none` would
 *  stop the dot shrinking when a long label squeezes the pill, which is a
 *  behaviour the original allowed; `block` is a no-op because a flex item is
 *  blockified anyway. Three utilities, which is what `.chip i` declared. */
export const CHIP_DOT = 'size-[5px] rounded-full bg-current';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Show the leading dot. Off by default: two of the four shipped chips
   *  (`--repo`, `--archived`) are text alone. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Chip({ dot = false, className, children, ...props }: ChipProps): ReactNode {
  return (
    <span className={cn(CHIP, className)} {...props}>
      {dot && <i aria-hidden="true" className={CHIP_DOT} />}
      {children}
    </span>
  );
}
