// Well — the terminal peeking through, wherever it peeks.
//
// WHY THIS MOVED, WHEN chat.css's OWN COMMENT ARGUED IT SHOULD NOT. That
// comment said: a shared surface with four consumers, two of them already in
// this package, and "splitting it would have made a second definition of one
// surface … moving it would have left two app components reaching into the
// design system for a base class." It then named its own cost, honestly:
//
//     "the two ui components still spell `className="well …"`, and their
//      Storybook stories render that <pre> unwelled, which is the visible
//      cost of the split not being made."
//
// That cost is the whole argument for moving it. `ToolCard` and `MailCard` are
// @ccrc/ui components whose primary surface does not render in @ccrc/ui's own
// Storybook — a design system that cannot show its own component is not
// documenting it. And the objection does not survive the move: the app's three
// consumers do not reach into a base CLASS, they render a COMPONENT, which is
// the ordinary direction. There is still exactly one definition.
//
// NO STYLESHEET. Utilities over the same tokens, so the rule is deleted rather
// than relocated — a stylesheet moved between packages rewrites every contrast
// gate key it owns (`<basename> <selector>`), and this one is measured.
//
// TWO UTILITIES THAT LOOK LIKE NOISE AND ARE NOT. The rule used the `font`
// SHORTHAND, which resets `font-style` and `font-variant-numeric` to normal as
// a side effect. Separate utilities do not. `not-italic` and `normal-nums`
// restore exactly that, so a well under an italic or tabular-nums ancestor
// renders as it always did. Without them this would be a silent visual change
// in whichever screen grew such an ancestor first.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Token for token as `chat.css .well` declared it.
 *
 *  `py-[10px]` is a literal because the rule was: 10px sits between `--sp-2`
 *  (8px) and `--sp-3` (12px), and the horizontal padding IS `--sp-3`. The
 *  asymmetry is deliberate in the original — a mono block wants more side than
 *  top — so rounding it to a token would be a visual change dressed as
 *  tidying. */
export const WELL =
  'well m-0 max-h-well-max overflow-x-auto overflow-y-auto overscroll-contain'
  + ' rounded-md bg-well px-3 py-[10px] text-ink-on-well'
  + ' font-mono text-sm font-regular leading-mono not-italic normal-nums'
  + ' whitespace-pre-wrap wrap-anywhere';

export interface WellProps extends HTMLAttributes<HTMLPreElement> {
  children?: ReactNode;
  className?: string;
}

/** Always a `<pre>`: all seven call sites were, and the surface exists to show
 *  bytes exactly as they arrived — `whitespace-pre-wrap` is load-bearing, not
 *  decoration. A site needing another element takes `WELL` directly. */
export function Well({ className, children, ...props }: WellProps): ReactNode {
  return (
    <pre className={cn(WELL, className)} {...props}>
      {children}
    </pre>
  );
}
