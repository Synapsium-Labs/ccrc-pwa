import { loadavg } from 'node:os';

/** The browser leg's opt-in wall-clock measurements are separate from ordinary correctness assertions. */
export const MEASURE = process.env['CCRC_MEASURE'] === '1';

/** D-9030: quiet-box preflight for reader measurements. */
export function readerTimingLoad(): { oneMinute: number; quiet: boolean } {
  const oneMinute = loadavg()[0] ?? Infinity;
  return { oneMinute, quiet: oneMinute < 4 };
}
