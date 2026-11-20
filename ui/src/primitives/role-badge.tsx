// RoleBadge — a session's role as a small picture, where its word stood (desktop polish C50, D-8817).
//
// THE OPERATOR'S NOTE (2026-11-19): "instead of writing the word "coordinator" let's come up with a badge to give to
// the workspace". The fleet list and the session header marked a coordinator with that word. This draws one icon in its
// place and keeps what the word carried: the accessible name (`role="img"` with an `aria-label`, so a screen reader still
// says the word) and the hover title that says what the role means.
//
// THE WORD IS NOT SPELT HERE. `label` and `title` come in from the caller (the PWA's `sessionFacts.ts` owns
// `COORDINATOR_WORD` and `COORDINATOR_ROLE_TITLE`), so this package keeps no app vocabulary and a reword reaches the
// badge through the one place that spells it.
//
// THE COLOUR IS THE CALLER'S. The icon strokes in `currentColor`, like every `Icon`, so the badge reads in whatever ink
// its row sets: inside a programme box the row sets the programme's hue, elsewhere the quiet secondary ink. A badge
// paints no colour of its own, which keeps the contrast audit's pairs where the callers' rules name them.
//
// DECORATION AND NAME. Unlike a bare `Icon` (aria-hidden, its call site keeps a word), the badge IS the call site's only
// cue, so it carries the name itself.
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon, type IconName } from './icon';

/** An inline flex box round the icon, never shrunk. The icon is 16px unless the caller's stylesheet sizes its `svg` (the session
 *  header sets `1em`), so the line it sits on keeps its own height. */
export const ROLE_BADGE = 'inline-flex flex-none items-center justify-center';

export interface RoleBadgeProps {
  /** The vendored icon drawn. */
  icon: IconName;
  /** The accessible name: the role's word, which a screen reader says in place of the picture. */
  label: string;
  /** What the role means, shown on hover. */
  title: string;
  className?: string;
}

export function RoleBadge({ icon, label, title, className }: RoleBadgeProps): ReactNode {
  return (
    <span role="img" aria-label={label} title={title} className={cn(ROLE_BADGE, className)}>
      <Icon name={icon} size={16} />
    </span>
  );
}
