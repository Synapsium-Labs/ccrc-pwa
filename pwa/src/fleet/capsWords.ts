// The caps control's usage reading, in words (spec 2026-11-19 "waiting workers sleep and hold no slot", Part 3, D-8792).
// Pure: `CapsControl` renders what this answers and decides nothing itself.
//
// The ONE READER of `CoordCapsUsage.waiting` and `workingOnly`, the server's count of active runs whose worker was
// measured waiting or asleep, and whether the cap leaves them out (the `cap-counts-working` Shadow lanes row armed).
// Both fields are additive: an older server omits them, and then the reading is today's `running / cap`, never a guessed
// zero.
import type { CoordCapsUsage } from '../../../shared/api';

/** The usage against the cap, as one reading. Armed: `3 / 4 working, 2 waiting`, the runs that hold a slot and then the
 *  ones left out. Shadow: `5 / 4, 2 of them waiting`, the count the cap still uses, and how many of it wait. Without a
 *  usable `waiting` (an older server): `5 / 4`, as before. */
export function capsUsageWords(usage: CoordCapsUsage, cap: number): string {
  const waiting = usage.waiting;
  if (typeof waiting !== 'number' || !Number.isInteger(waiting) || waiting < 0) return `${usage.running} / ${cap}`;
  if (usage.workingOnly === true) return `${Math.max(0, usage.running - waiting)} / ${cap} working, ${waiting} waiting`;
  return `${usage.running} / ${cap}, ${waiting} of them waiting`;
}
