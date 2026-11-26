import { loadavg } from 'node:os';

/** The browser leg's opt-in wall-clock measurements are separate from ordinary correctness assertions. */
export const MEASURE = process.env['CCRC_MEASURE'] === '1';

/** D-9030: log the load at both ends; it no longer blocks taking a sample. */
export function readerTimingLoad(): number {
  return loadavg()[0] ?? Infinity;
}

/** Normal ceiling rows report overruns for the sitting's quietness check. The delay controls
 * must exercise the ceiling assertion even at high load. Neither mode changes the budget. */
export function readerCeilingReading(ms: number, ceiling: number, control: 'AP-M27' | 'AP-M31') {
  const assertCeiling = process.env['CCRC_READER_DELAY_CONTROL'] === control;
  return { assertCeiling, reading: ms <= ceiling ? 'under' : 'over' } as const;
}
