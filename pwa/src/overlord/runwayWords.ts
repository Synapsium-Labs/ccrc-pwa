// The capacity line's words (Overlord W1 home B, Task 6; plan questions 6 and Global Constraints "Runway"; spec §6.8): L1, pure,
// (context C5, the `overlord/**` row). Each pool's runway (when it runs out: the `out` crossing) and its earliest reset (when an exhausted account
// regains headroom), from `GET /api/pools/runway`'s `PoolRunwayWire` (`shared/loadLines.ts`), said as spans from the READ'S own
// clock (`nowS`), so no clock is read here.
//
// NOTHING UNMEASURED READS AS A VALUE. `none-exhausted`, a reset at `atS` and an unmeasured reset (with its `why`) each have
// their own sentence, and so does each crossing. The read still loading, and a server that has no such read (404, `absent`),
// leave the line UNDRAWN (`hidden`): never "no runway". A failed read (a 503) is drawn as unmeasured. A pool of `null` is the
// untagged accounts; every other pool name is the read's own, never a list in this source.
import type { CrossingUnmeasured, PoolRunwayAnswer, PoolRunwayWire } from '../../../shared/loadLines';
import { stallDurationText } from '../../../shared/stall-watch';
import type { ReadState } from './readState';

export const CAPACITY_WORDS = {
  title: 'Capacity',
  untagged: 'untagged accounts',
  noPools: 'no pools to read',
  unmeasured: 'Capacity unmeasured',
  stale: 'Showing the last answer; the latest read failed.',
  noneExhausted: 'no account is exhausted',
  outNow: 'at its ceiling now',
  resetDue: 'its earliest reset is due',
} as const;

/** Why a window could not be projected, in words: the crossing's reasons, which also name an unmeasured reset's four. */
export const CROSSING_WHY: Readonly<Record<CrossingUnmeasured, string>> = {
  'no-sample': 'no sample of the current window',
  stale: 'the newest sample is too old to project from',
  rolled: 'the window has reset since the newest sample',
  thin: 'too few samples to project from',
  'no-reset': 'the window carries no reset time',
};

/** A span as "2 h 5 min" under two days and "3 d" from there on (a weekly window runs for days). Never negative. */
export function spanWords(ms: number): string {
  const clamped = Math.max(0, ms);
  return clamped >= 48 * 3_600_000 ? `${Math.round(clamped / 86_400_000)} d` : stallDurationText(clamped);
}

const inWords = (atS: number, nowS: number): string => spanWords((atS - nowS) * 1000);

/** The `out` crossing as a sentence. */
export function runwayText(out: PoolRunwayAnswer['out'], nowS: number): string {
  switch (out.kind) {
    case 'at': return out.atS <= nowS ? `runway: ${CAPACITY_WORDS.outNow}` : `runway: runs out in about ${inWords(out.atS, nowS)}`;
    case 'not-before-reset': return `runway: not out before its reset, in about ${inWords(out.resetS, nowS)}`;
    case 'unmeasured': return `runway: unmeasured (${CROSSING_WHY[out.why]})`;
  }
}

/** The earliest reset as a sentence. */
export function resetText(reset: PoolRunwayAnswer['earliestReset'], nowS: number): string {
  switch (reset.kind) {
    case 'none-exhausted': return `reset: ${CAPACITY_WORDS.noneExhausted}`;
    case 'at': return reset.atS <= nowS ? `reset: ${CAPACITY_WORDS.resetDue}` : `earliest reset in about ${inWords(reset.atS, nowS)}`;
    case 'unmeasured': return `earliest reset: unmeasured (${CROSSING_WHY[reset.why]})`;
  }
}

export interface PoolLine {
  /** Unique in the line; a pool's own name is never the key (an untagged pool has none). */
  readonly key: string;
  /** The read's own pool name, or "untagged accounts". Pool names are data: draw them as text. */
  readonly pool: string;
  readonly runway: string;
  readonly reset: string;
}

export type CapacityView =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'unmeasured'; readonly text: string }
  | { readonly kind: 'pools'; readonly pools: readonly PoolLine[]; readonly stale: string | null };

/** What the capacity line draws for a read. */
export function capacityView(read: ReadState<PoolRunwayWire>): CapacityView {
  if (read.state === 'loading' || read.state === 'absent') return { kind: 'hidden' };
  if (read.state === 'unmeasured') return { kind: 'unmeasured', text: `${CAPACITY_WORDS.unmeasured} (${read.error})` };
  const { nowS, pools } = read.value;
  return {
    kind: 'pools',
    stale: read.state === 'stale' ? CAPACITY_WORDS.stale : null,
    pools: pools.map((p, i) => ({
      key: `pool-${i}`,
      pool: p.pool === null ? CAPACITY_WORDS.untagged : p.pool,
      runway: runwayText(p.runway.out, nowS),
      reset: resetText(p.runway.earliestReset, nowS),
    })),
  };
}
