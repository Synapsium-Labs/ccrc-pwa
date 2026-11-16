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
// documenting it. And the objection does not survive the move: the app's
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
//
// AND NO VARIANT AXIS, measured when a design-system audit proposed one. The
// classes call sites pass are not tones: `mail-card-body`, `opt-preview`,
// `draft-well` and `tool-ask-well` each adjust this surface for the box it sits
// in — a max-height here, a margin there. Naming such one-off adjustments as
// if they were a vocabulary would invent a word per call site and put the
// design system in charge of layouts it cannot see. The well has ONE
// appearance, which is the point of it: wherever the terminal peeks through, it
// looks the same.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';

/** Token for token as `chat.css .well` declared it, less its overscroll
 *  containment (D-6437) and with a whole-pixel line height (D-6852,
 *  whole-pixel-mono-line, under D-6437). The well itself wraps (`pre-wrap`),
 *  and a y-axis containment would stop a wheel it has nothing left to scroll
 *  from reaching the transcript. Of its users outside the transcript, the ask
 *  sheet's `opt-preview` and the unsent-draft sheet's `draft-well` chain to
 *  their sheet body's own containment; `opt-preview` is given
 *  `white-space: pre`, `overflow: auto` and its own font shorthand by
 *  `chat.css`, so unlike the well proper it may scroll sideways.
 *
 *  The line height is `--fs-sm` x `--lh-mono` rounded DOWN to a whole pixel
 *  (20px, not 20.15px): a fractional line box makes a tall well's scroll range
 *  fractional, and at some page offsets Chrome then latches the first wheel at
 *  the well's end to the well, which cannot move, so it never reaches the
 *  transcript. `.msg-assist pre` and `.tool-ask-a` declare the same value (the
 *  `round()` dependency is noted on `.msg-assist pre` in prose.css).
 *
 *  `py-[10px]` is a literal because the rule was: 10px sits between `--sp-2`
 *  (8px) and `--sp-3` (12px), and the horizontal padding IS `--sp-3`. The
 *  asymmetry is deliberate in the original — a mono block wants more side than
 *  top — so rounding it to a token would be a visual change dressed as
 *  tidying. */
export const WELL =
  'well m-0 max-h-well-max overflow-x-auto overflow-y-auto'
  + ' rounded-md bg-well px-3 py-[10px] text-ink-on-well'
  + ' font-mono text-sm font-regular not-italic normal-nums'
  + ' leading-[round(down,calc(var(--fs-sm)*var(--lh-mono)),1px)]'
  + ' whitespace-pre-wrap wrap-anywhere';

export interface WellProps extends HTMLAttributes<HTMLPreElement> {
  children?: ReactNode;
  className?: string;
}

/** Always a `<pre>`: every call site was, and the surface exists to show
 *  bytes exactly as they arrived — `whitespace-pre-wrap` is load-bearing, not
 *  decoration. A site needing another element takes `WELL` directly.
 *
 *  `tabIndex={0}` IS NOT DECORATION EITHER, and it is the first thing a real
 *  browser said about this component: axe's `scrollable-region-focusable`,
 *  through the Storybook runner, on the `Tall` story. A well scrolls — that is
 *  what `max-h-well-max` plus `overflow-y-auto` MEANS — and a region that
 *  scrolls with no way to focus it is content a keyboard cannot reach. A mouse
 *  wheel and a finger could always read the rest of a long tool output; a
 *  keyboard could not. Overridable, like every other prop, for a call site
 *  that knows its well never overflows. */
export function Well({ className, children, tabIndex = 0, ...props }: WellProps): ReactNode {
  return (
    <pre className={cn(WELL, FOCUS_RING, className)} tabIndex={tabIndex} {...props}>
      {children}
    </pre>
  );
}
