// CountBadge — a count for you to look at.
//
// TWO RULES, SIX DECLARATIONS, BYTE-IDENTICAL. `.bucket-head-unseen` (the
// fleet list's "N new" pill on a bucket head, counting the bucket's sessions
// you have not seen yet, `BucketBar`) and `.mail-badge-count` (the fleet
// head's mail door, counting what waits on you) are the same pill in two
// places, and each wrote it out.
//
// THE TONE IS NOT A VARIANT AXIS. Both are attention — amber tint, amber ink —
// because both counts are drawn only for you to look at: what you have not
// seen, and what waits on you. A `tone` prop would invite a quiet count, and
// a count nobody needs to see is a count that should not be rendered. `.settings-badge` looks similar
// and is a different thing: a label pill with a hairline, three modifiers and
// no number in it, which the shape census registers by name.
//
// `1.6` LEADING IS A LITERAL, as both rules had it. It is what centres a digit
// in a `--r-full` pill at `--fs-2xs` without a height or a flex — the pill is
// as tall as its line box, which is why there is no `min-height` here and no
// tap floor: this is a READOUT inside a control, never the control.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** The pill, token for token as both rules declared it. `tabular-nums` so a
 *  count ticking 9 -> 10 does not change the pill's width, and `not-italic`
 *  because the `font:` shorthand they used reset it for free. */
export const COUNT_BADGE =
  'rounded-full bg-status-attention-tint px-[6px] text-status-attention-text'
  + ' font-mono text-2xs font-semibold leading-[1.6] not-italic tabular-nums';

export interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function CountBadge({ className, children, ...props }: CountBadgeProps): ReactNode {
  return <span className={cn(COUNT_BADGE, className)} {...props}>{children}</span>;
}
