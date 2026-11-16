// Skeleton — a shimmer that respires at the phosphor's tempo. The sweep runs a
// token gradient (raised -> edge-subtle -> raised); reduced motion freezes it
// to a matte block rather than strobing.
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface SkeletonProps {
  lines?: number;
  className?: string;
}

export function Skeleton({ lines = 3, className }: SkeletonProps): ReactNode {
  return (
    <div className={cn('skel grid gap-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="skel-line block h-3 rounded-sm bg-[linear-gradient(90deg,var(--bg-raised)_25%,var(--edge-subtle)_45%,var(--bg-raised)_65%)] bg-[length:200%_100%] animate-shimmer last:w-3/5 motion-reduce:animate-none motion-reduce:bg-[position:0_0]"
        />
      ))}
    </div>
  );
}
