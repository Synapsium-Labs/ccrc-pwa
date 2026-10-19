// EmptyState — what a page says when it has nothing to list (D-5102).
//
// `.mail-empty`, `.runs-empty` and `.archive-empty` were three copies of one
// rule (`padding: var(--sp-4); color: var(--ink-secondary)`), each a
// grandfathered blind spot in the contrast census. One drawing now: an
// optional icon, the sentence at the ui role, and an optional action under it.
//
// A screen says WHICH emptiness it is (loading, an error, an honest nothing)
// through its own `data-state`, passed straight through; `data-empty-state`
// marks the component itself, so a test can find it without a hook class.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon, type IconName } from './icon';

export const EMPTY_STATE = 'grid min-w-0 justify-items-start gap-2 p-4 text-ui leading-normal text-ink-secondary';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /** A glyph above the sentence, in the tertiary ink. */
  icon?: IconName;
  /** The sentence. */
  children: ReactNode;
  /** A control under it: the way out of the emptiness, when there is one. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, children, action, className, ...props }: EmptyStateProps): ReactNode {
  return (
    <div data-empty-state="" className={cn(EMPTY_STATE, className)} {...props}>
      {icon !== undefined && <Icon name={icon} size={20} className="text-ink-tertiary" />}
      <p className="m-0">{children}</p>
      {action}
    </div>
  );
}
