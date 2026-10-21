// The fleet's one count readout (W2 Task S2c; D-5471, D-5472): "19 sessions · 4 waiting · 5 runs". The fleet
// head's count line, Refined's phone subtitle (S5) and sidebar head (S6) and Instrument's status bar (S9) all
// render it; none counts sessions itself, so two places can never show two numbers for one fleet.
import type { FleetSession, RunSummary } from '../../../shared/api';
import { isRunClosed } from './runWords';

export interface FleetSummary {
  readonly sessions: number;
  /** The server's `attention` bucket, never `dialogPending`: a killed session that is still `dialogPending` is
   *  bucketed `dead` (shared/api.ts's ladder checks `dead` first), and it is waiting on no one. */
  readonly waiting: number;
  /** Open runs, or null when the caller does not know them (no runs frame yet) or does not show them. */
  readonly runs: number | null;
  /** The readout. A zero waiting or zero runs part is left out, and so is an unknown runs part. */
  readonly readout: string;
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

export function fleetSummary(sessions: readonly FleetSession[], runs: readonly Pick<RunSummary, 'state'>[] | null): FleetSummary {
  const waiting = sessions.filter((s) => s.bucket === 'attention').length;
  const open = runs === null ? null : runs.filter((r) => !isRunClosed(r)).length;
  const parts = [count(sessions.length, 'session')];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (open !== null && open > 0) parts.push(count(open, 'run'));
  return { sessions: sessions.length, waiting, runs: open, readout: parts.join(' · ') };
}
