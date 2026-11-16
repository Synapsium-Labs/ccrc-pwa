// The close ✕ (D-5933, D-6033): lucide's `x` in a tap target, at least `--tap-min` on every pointer. The Sheet's
// desktop arm draws it at its top right. A control of its own file, so the ring it carries never shares a file with
// a container that writes `outline-none` (the Sheet's panel, D-5931; `focus-ring.test.ts`).
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import { PRESS_FEEDBACK } from '../lib/press';
import { Icon } from './icon';

const CLOSE_BUTTON =
  'flex min-w-tap min-h-tap items-center justify-center rounded-md border-none bg-transparent text-ink-secondary'
  + ' hover:text-ink-primary cursor-pointer'
  + ` ${PRESS_FEEDBACK} ${FOCUS_RING}`;

export interface CloseButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** The accessible name. "Close" unless the caller closes something more specific. */
  label?: string;
}

export function CloseButton({ className, label = 'Close', type = 'button', ...props }: CloseButtonProps): ReactNode {
  return (
    <button type={type} aria-label={label} className={cn(CLOSE_BUTTON, className)} {...props}>
      <Icon name="x" size={20} />
    </button>
  );
}
