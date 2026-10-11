// Limits bar — two thin rows (5h / 7d), mono tabular readouts, fills banded to
// the operator's routing policy: ok < 50, warn 50-75 ("prefer handoff"),
// critical > 75 ("hand off everything spec-able"). An amber gauge is
// actionable, not decorative. Width changes glide over --dur-bar.
import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type LimitBand = 'ok' | 'warn' | 'crit';

/** Band for a usage percentage, per the routing policy in DIRECTION.md. */
export function limitBand(pct: number): LimitBand {
  if (pct > 75) return 'crit';
  if (pct >= 50) return 'warn';
  return 'ok';
}

/** The track a fill sits in. Exported beside `fillVariants` because the two are
 *  one unit — a fill with no track has no height to fill. */
export const TRACK = 'limit-track block h-1 overflow-hidden rounded-full bg-limit-track';

/** Exported for the same reason `buttonVariants` is: a call site whose LAYOUT
 *  differs from `LimitBar`'s own row — `SwapSheet`'s account gauge puts the
 *  label and percentage in different cells — still needs THIS bar's vocabulary,
 *  including the `limit-fill`/`limit-fill--*` hook classes that `fleet.css`'s
 *  disabled-row override selects on. A second copy would drift. */
export const fillVariants = cva(
  'limit-fill block h-full rounded-full transition-[width,background-color] duration-bar ease-swift motion-reduce:transition-none',
  {
    variants: {
      band: {
        ok: 'limit-fill--ok bg-limit-ok',
        warn: 'limit-fill--warn bg-limit-warn',
        crit: 'limit-fill--crit bg-limit-critical',
        /** NOT a fourth reading — a statement that the reading stopped.
         *
         *  A condemned lane keeps its last numbers, because they are still
         *  true of the last moment anything ran there. What is no longer true
         *  is the COLOUR: nothing runs there to refresh the statusline, so a
         *  frozen crit-red bar reads as live pressure on a row the same line
         *  calls expired. `limitBand` never returns this; the call site that
         *  knows the lane is condemned passes it.
         *
         *  It lived in fleet.css as `.acct-list .acct-row[data-disabled='true']
         *  .limit-fill`, the last entry in the appearance census — a background
         *  set on this component from a sheet its own story never loads, which
         *  is the definition of a drift that shows up in one theme only. */
        off: 'limit-fill--off bg-edge-subtle',
      },
    },
    defaultVariants: { band: 'ok' },
  },
);

function Row({ label, value }: { label: string; value: number | null }): ReactNode {
  const pct = value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <div className="limit-row grid grid-cols-[20px_1fr_40px] items-center gap-2 font-mono text-2xs font-regular leading-none tabular-nums text-ink-tertiary">
      <span>{label}</span>
      <span className={TRACK}>
        {pct !== null && (
          <span className={fillVariants({ band: limitBand(pct) })} style={{ width: `${pct}%` }} />
        )}
      </span>
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
