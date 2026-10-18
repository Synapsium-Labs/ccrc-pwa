// Meter — the ONE usage meter (D-5098). Every window gauge in the app draws
// through it: `LimitBar`'s rows, `AccountMeterRow` (the accounts strip and the
// Accounts screen) and `AccountRow`'s gauge (the swap and new-session
// pickers). Three meters had drawn the same fact three ways, one of them with a
// red that belonged to no palette on a track that was black in Daylight.
//
// THE METER OWNS ITS BOX AND ITS FILL. Height (`--meter-h`), radius, track
// (`--limit-track`), overflow, and the fill's display, height, radius and
// colour are all here. The app's sheets are unlayered and beat these
// utilities, so a sheet that sizes, rounds or paints a meter would keep a
// skin's shape off the screen; `pwa/test/meter.test.tsx` refuses one.
// `trackClassName` and `fillClassName` are for HOOK classes only.
//
// SHAPE IS A SKIN TOKEN. meter.css masks the track with a repeating gradient
// of `--meter-segments` segments and `--meter-gap` gaps. `:root` (Refined) is
// one segment with no gap, the continuous bar; Instrument is ten LED segments.
// The mask cuts the track and the fill alike, so an unlit segment shows the
// track. It is built from `currentColor` and `transparent`, because a mask
// reads only alpha: the meter carries no colour of its own beyond the palette.
//
// SPANS ONLY, so a meter is valid inside a button (the picker rows are one).
import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import './meter.css';

// The band, the track and the fill's vocabulary are DEFINED here, with the
// meter that draws them; limit-bar.tsx re-exports them (D-5446).
export type LimitBand = 'ok' | 'warn' | 'crit';

/** Band for a usage percentage, per the routing policy in DIRECTION.md:
 *  ok < 50, warn 50-75 ("prefer handoff"), critical > 75 ("hand off everything
 *  spec-able"). An amber gauge is actionable, not decorative. */
export function limitBand(pct: number): LimitBand {
  if (pct > 75) return 'crit';
  if (pct >= 50) return 'warn';
  return 'ok';
}

/** The track a fill sits in. Exported beside `fillVariants` because the two
 *  are one unit; the app reaches neither, only `Meter`. */
export const TRACK = 'meter limit-track block h-(--meter-h) overflow-hidden rounded-full bg-limit-track';

/** The fill's vocabulary, including the `limit-fill--*` hook classes the
 *  suites read. */
export const fillVariants = cva(
  'meter-fill limit-fill block h-full rounded-full transition-[width,background-color] duration-bar ease-swift motion-reduce:transition-none',
  {
    variants: {
      band: {
        ok: 'limit-fill--ok bg-limit-ok',
        warn: 'limit-fill--warn bg-limit-warn',
        crit: 'limit-fill--crit bg-limit-critical',
        /** NOT a fourth reading — a statement that the reading stopped.
         *
         *  A condemned or disabled lane keeps its last numbers, because they
         *  are still true of the last moment anything ran there. What is no
         *  longer true is the COLOUR: nothing runs there to refresh the
         *  statusline, so a frozen crit bar reads as live pressure on a row
         *  the same line calls expired or switched off. `limitBand` never
         *  returns this; the caller that knows passes `off`. */
        off: 'limit-fill--off bg-edge-subtle',
      },
    },
    defaultVariants: { band: 'ok' },
  },
);

export interface MeterProps {
  /** 0-100, clamped. `null` is "never measured" and draws NO fill, which is a
   *  different fact from a measured 0% (a zero-width fill). */
  pct: number | null;
  /** The classification, kept on `data-band` even when `off` greys the fill. */
  band: LimitBand | 'none';
  /** The lane's readings stopped (disabled, or its sign-in expired). */
  off?: boolean;
  className?: string;
  /** A hook class for the track. Never a size, radius or colour. */
  trackClassName?: string;
  /** A hook class for the fill. Never a size, radius or colour. */
  fillClassName?: string;
}

export function Meter({ pct, band, off = false, className, trackClassName, fillClassName }: MeterProps): ReactNode {
  const clamped = pct === null ? null : Math.min(100, Math.max(0, pct));
  const fillBand = off ? 'off' : band === 'none' ? 'ok' : band;
  return (
    <span className={cn(TRACK, trackClassName, className)} data-band={band}>
      {clamped !== null && (
        <span className={cn(fillVariants({ band: fillBand }), fillClassName)} style={{ width: `${clamped}%` }} />
      )}
    </span>
  );
}
