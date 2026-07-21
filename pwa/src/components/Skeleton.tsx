// Skeleton — shimmering loading placeholder. The shimmer sweeps a token
// gradient (raised → edge-subtle → raised) at the phosphor's breathing tempo;
// reduced motion freezes it to a matte block (primitives.css).
import type { ReactNode } from 'react';
import './primitives.css';

export function Skeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}): ReactNode {
  return (
    <div className={className ? `skel ${className}` : 'skel'} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel-line" />
      ))}
    </div>
  );
}
