// CoverScreen — the whole viewport, and nothing behind it is reachable.
//
// TWO RULES, TWELVE DECLARATIONS, ONE DIFFERENT. `.block-screen` (this build
// is too old for the fleet protocol) and `.login-screen` (the session gate)
// agreed on eleven and disagreed only on their `gap`. shell.css says they are
// the same thing in its own words — the login screen's comment opens "Beside
// .block-screen because it is the same kind of thing and mounted the same
// way".
//
// BOTH SHARE `--z-block`, DELIBERATELY. shell.css argues it: app.tsx renders
// the login screen FIRST, so at equal z the block screen paints on top, which
// is the right order — a build too old to speak the fleet protocol cannot be
// fixed by signing in. Minting a second token would have made that ordering a
// number to maintain instead of a consequence of the DOM.
//
// MOUNTED OUTSIDE THE SHELL, which is what `fixed` alone cannot buy. Both are
// PRECEDING SIBLINGS of `.app-shell` in app.tsx, not descendants: `fixed` plus
// `--z-block` is what does the covering, and the DOM position is what keeps
// them out of any ancestor that might clip or transform its own descendants.
// A consumer that renders one inside the shell gets a cover that a transform
// three levels up can trap.
//
// NO GROUND, like ControlRow and for the same reason: each consumer declares
// its own `background` and `color` in shell.css, and four descendant rules —
// `.block-screen-copy`, `.login-title`, `.login-copy`, `.login-label` — are
// measured pairs only because of it.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** The cover, token for token as both rules declared it — minus the ground,
 *  and minus the `gap`, which is the one declaration the two disagreed on
 *  (`--sp-5` for the block screen's single sentence and button, `--sp-4` for
 *  the login screen's title, copy, form and footer). A shared value here would
 *  have had to pick one of them, which is a visual change wearing a tidy-up's
 *  clothes. */
export const COVER_SCREEN =
  'fixed inset-0 z-block flex flex-col items-center justify-center p-6 text-center';

export interface CoverScreenProps extends HTMLAttributes<HTMLDivElement> {
  /** The hook class, always — it carries the ground, the gap, and the
   *  selector both screens' tests and app rules key on. */
  className: string;
  children: ReactNode;
}

export function CoverScreen(
  { className, children, ...props }: CoverScreenProps,
): ReactNode {
  return <div className={cn(COVER_SCREEN, className)} {...props}>{children}</div>;
}
