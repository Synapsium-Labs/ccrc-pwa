// The caps control's usage reading, in words (spec 2026-11-19 "waiting workers sleep and hold no slot", Part 3,
// D-TBD-cap-counts-working). Pure: `CapsControl` renders what this answers and decides nothing itself.
//
// The ONE READER of `CoordCapsUsage.waiting`, the server's count of active runs the cap leaves out because their
// worker was measured waiting or gone. The field is additive: an older server omits it, and then the reading is
// today's `running / cap`, never a guessed zero.
import type { CoordCapsUsage } from '../../../shared/api';

/** `3 / 4 working, 2 waiting`: the runs that hold a slot against the cap, then the ones left out. Without `waiting`
 *  (an older server) it is the raw count against the cap, as before. */
export function capsUsageWords(usage: CoordCapsUsage, cap: number): string {
  const waiting = usage.waiting;
  if (typeof waiting !== 'number' || !Number.isInteger(waiting) || waiting < 0) return `${usage.running} / ${cap}`;
  return `${Math.max(0, usage.running - waiting)} / ${cap} working, ${waiting} waiting`;
}
