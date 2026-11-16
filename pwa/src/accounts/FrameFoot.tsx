import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';

/** One button of a frame's foot. */
export interface FootAct {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly describedBy?: string;
}

/**
 * A connect-sheet frame's foot (accounts plan Task A18, D-7740): the quiet acts on the left (Back, Leave it off, Check
 * again), the frame's primary last. One component, so every frame lays its acts out the same way at every width.
 */
export function FrameFoot({ quiet = [], primary }: { quiet?: readonly FootAct[]; primary?: FootAct }): ReactNode {
  return (
    <div className="acct-actions">
      {quiet.map((a) => (
        <Button key={a.label} variant="ghost" size="fit" disabled={a.disabled} onClick={a.onClick}>{a.label}</Button>
      ))}
      {primary !== undefined && (
        <Button
          variant="primary"
          disabled={primary.disabled}
          aria-busy={primary.busy || undefined}
          aria-describedby={primary.describedBy}
          onClick={primary.onClick}
        >
          {primary.label}
        </Button>
      )}
    </div>
  );
}
