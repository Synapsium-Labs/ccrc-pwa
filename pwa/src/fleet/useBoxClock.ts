// The one clock the programme boxes are read against (Task G1d, D-7380; review 1279 F3). A box's state is `needs`, `paused`,
// `stalled` or `moving` by the stall watch's own quiet time (the runs frame's `stallQuietMs`, read once in the store), the
// operator's pause (the coord frame's, `set` only) and the time. The project cards and the Status view both draw boxes,
// and both read all three here: the rollup's clock (`useRollupClock`, one timer that also wakes where a box crosses its
// threshold), the quiet time, the pause, and `boxNow`.
// `boxNow` is the time read when the clock's `next` last moved. With the same runs, quiet time and pause no box crosses
// between two moves of `next`, so that time reads every box's state as the real time would, and what a view builds from it
// (a memo'd card's props, the Status view's groups) changes only at a boundary or with a frame (C9). The memo's keys are
// exactly the boundary's inputs, so a change of any of them re-reads it even when `next` does not move: a pause that clears
// with no box ahead, a runs frame that ages a box, a quiet time that leaves the earliest boundary where it was.
// The Status view passes no sessions: it draws no rollup window, so the clock adds none. A caller passes a memoised
// `activeRuns`, because `boxNow` keys on its identity: a fresh array each render would re-read it on every render.
import { useMemo } from 'react';
import type { FleetSession, RunSummary } from '../../../shared/api';
import type { FleetStore } from '../stores/fleet';
import { markerState } from './coordWords';
import { useRollupClock } from './useRollupClock';

export interface BoxClockReading {
  /** The rollup's clock: the window's `now`, read fresh on every render, and `next`, its one timer's boundary. */
  readonly roll: { readonly now: number; readonly next: number | null };
  /** The time read when `roll.next` last moved, or when the runs, the quiet time or the pause did. */
  readonly boxNow: number;
  /** The stall watch's quiet time, or null on a server that sends none (D-7376): no box stalls. */
  readonly stallQuietMs: number | null;
  /** The operator's pause: the coord frame's marker reads `set`. */
  readonly coordPaused: boolean;
}

export function useBoxClock(store: FleetStore, sessions: readonly FleetSession[], activeRuns: readonly RunSummary[]): BoxClockReading {
  const stallQuietMs = store((s) => s.stallQuietMs);
  const coordPaused = store((s) => markerState(s.coord?.pause) === 'set');
  const roll = useRollupClock(sessions, activeRuns, stallQuietMs, coordPaused);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `roll.next` stands for `roll.now`: it moves only at a boundary.
  const boxNow = useMemo(() => roll.now, [roll.next, activeRuns, stallQuietMs, coordPaused]);
  return { roll, boxNow, stallQuietMs, coordPaused };
}
