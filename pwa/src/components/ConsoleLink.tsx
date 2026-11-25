// A Docs tab's link back to the console (desktop polish wave 174): the tab bar's one link at a desk (below it the frame draws
// no bar, fix round 3), and the failed-render fallback's way out in a Docs tab (fix round 1, A1), so both go to one place,
// the console's root, by one rule.
//
// A LINK THAT STANDS ALONE IS A CONTROL (fix round 1, A3): an anchor wearing the ghost button (`GHOST_ANCHOR`), which
// carries the button's tap floor, never the inline `TextLink`. Its behaviour is the tab rule's (`useTabLink`): at a desk it
// opens the console in a new tab and says so in its name; below the desk width it moves in place, and its name is its word.
import type { ReactNode } from 'react';
import { cn } from '@ccrc/ui';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { CONSOLE_ROOT, NEW_TAB_WORDS } from '../lib/docTab';
import { useTabLink } from '../lib/useTabLink';

export function ConsoleLink({ label, className }: { readonly label: string; readonly className?: string }): ReactNode {
  const props = useTabLink()(CONSOLE_ROOT);
  const newTab = props.target === '_blank';
  return (
    // The new-tab name is spelled whole (it starts with the word shown, so a voice user saying what they see reaches it):
    // a visually hidden span would put a space before its comma in Chrome's name ("Console , opens…").
    <a {...props} aria-label={newTab ? label + NEW_TAB_WORDS : undefined} className={cn(GHOST_ANCHOR, 'w-auto px-3', className)}>
      {label}
      {newTab && <span aria-hidden="true">{' ↗'}</span>}
    </a>
  );
}
