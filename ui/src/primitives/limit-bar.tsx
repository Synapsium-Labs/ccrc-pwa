// Limits bar — two thin rows (5h / 7d), mono tabular readouts, fills banded to
// the operator's routing policy: ok < 50, warn 50-75 ("prefer handoff"),
// critical > 75 ("hand off everything spec-able"). An amber gauge is
// actionable, not decorative. Width changes glide over --dur-bar. Each row's bar
// is a `Meter` (meter.tsx), so its height and shape are the skin's.
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Meter, limitBand } from './meter';

// The band, the track and the fill's vocabulary live with the one meter that
// draws them (D-5098, D-5446). Re-exported here, where they have always been imported
// from, so no import line in the app or the index has to move.
export { limitBand, fillVariants, TRACK, type LimitBand } from './meter';

function Row({ label, value }: { label: string; value: number | null }): ReactNode {
  const pct = value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <div className="limit-row grid grid-cols-[20px_1fr_40px] items-center gap-2 font-mono text-2xs font-regular leading-none tabular-nums text-ink-tertiary">
      <span>{label}</span>
      <Meter pct={pct} band={pct === null ? 'none' : limitBand(pct)} />
      {/* An unmeasured lane reads em-dash, never 0% — "no window" and "an empty
          window" are different facts and must not collapse to one glyph. */}
      <span className="limit-pct text-right">{pct === null ? '—' : `${Math.round(pct)}%`}</span>
    </div>
  );
}

export interface LimitBarProps {
  five: number | null;
  seven: number | null;
  className?: string;
}

export function LimitBar({ five, seven, className }: LimitBarProps): ReactNode {
  return (
    <div className={cn('limits grid gap-1.5', className)}>
      <Row label="5h" value={five} />
      <Row label="7d" value={seven} />
    </div>
  );
}
