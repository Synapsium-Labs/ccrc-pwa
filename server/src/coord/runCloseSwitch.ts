// D-8077 (spec 2026-11-04 §12.3, A15, o7, o12; the runs rebuild, Task 26): THE RUN-CLOSE SWITCH'S VIEW. L1: pure and clock-free
// (`nowMs` is an argument), no I/O and no store. The route (`routes.ts`, L4) lists the registry, reads the setting, the lane's last
// reading and the 7-day tallies, hands them here, and sends the answer. The lane's own rules live in `runClose.ts` and
// `runCloseLane.ts`; this file only says what the Advanced rows show.
//
// A group reads HELD, with no list, while coordination or reclamation is paused or the registry would not list (o12): nothing can be
// armed then. A group nothing has read yet has no list; the crash row's is the dead-coordinator lane's (`RunVerdicts.setCrashReading`). A group that is off has none either, and a standing
// marker shows as `on` with its override named, because the marker wins over the row.
import {
  RUN_CLOSE_GROUPS, RUN_CLOSE_HELD, runCloseGroupArmed, runCloseListOf,
  type RunCloseChoice, type RunCloseGroup, type RunCloseGroupView, type RunCloseHeld, type RunCloseReading, type RunCloseState,
  type RunCloseView,
} from '../../../shared/run-close.js';
import { readSwitches } from '../../../shared/switches.js';
import { COORDINATOR_PAUSE_MARKER, RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { RUN_CLOSE_ROWS, RUN_CLOSE_ROW_GROUP, RUN_CLOSE_ROW_SWITCH, type RunCloseRow } from './runClose.js';

/** The seven days the rows count closes and refusals over. */
export const RUN_CLOSE_TALLY_MS = 7 * 24 * 3_600_000;

/** The group's marker, the emergency override. */
const GROUP_MARKER: Readonly<Record<RunCloseGroup, string>> = {
  'never-started': RUN_CLOSE_ROW_SWITCH['never-started'],
  'claimant-crashed': RUN_CLOSE_ROW_SWITCH['claimant-crashed'],
  'claimant-gone': RUN_CLOSE_ROW_SWITCH['claimant-gone'],
};

/** Why every row is held, or null. A registry that would not list holds, because a raised pause cannot be ruled out. */
export function runCloseHeldOf(names: readonly string[] | null): RunCloseHeld | null {
  if (names === null) return RUN_CLOSE_HELD.registry;
  const sw = readSwitches(names);
  if (sw[COORDINATOR_PAUSE_MARKER] === 'set') return RUN_CLOSE_HELD.coordination;
  if (sw[RECLAIM_PAUSE_MARKER] === 'set') return RUN_CLOSE_HELD.reclaim;
  return null;
}

export interface RunCloseViewInput {
  /** One measured listing of the registry directory, or null when it could not be listed. */
  readonly names: readonly string[] | null;
  readonly choices: Readonly<Record<RunCloseGroup, RunCloseChoice>>;
  readonly updatedAt: number | null;
  readonly reading: RunCloseReading | null;
  /** Runs the sweep closed in the last 7 days, by the lane that closed them. */
  readonly closed7d: Readonly<Record<RunCloseGroup, number>>;
  readonly refused7d: Readonly<Record<RunCloseGroup, number>>;
  readonly nowMs: number;
}

export function runCloseViewOf(i: RunCloseViewInput): RunCloseView {
  const held = runCloseHeldOf(i.names);
  const groups = RUN_CLOSE_GROUPS.map((group): RunCloseGroupView => {
    const choice = i.choices[group];
    const marker = i.names === null ? 'unmeasurable' as const : i.names.includes(GROUP_MARKER[group]) ? 'set' as const : 'clear' as const;
    const armed = runCloseGroupArmed(marker === 'set', choice);
    // A marker wins over the row, off included; a held group reads held whatever its row says.
    const state: RunCloseState = held !== null ? 'held' : armed ? 'on' : choice;
    const read = i.reading?.groups[group];
    const list = held !== null || state === 'off' || read === undefined ? null : runCloseListOf(read.would, read.named, i.nowMs);
    return { group, choice, marker, state, held, list, closed7d: i.closed7d[group], refused7d: i.refused7d[group], updatedAt: i.updatedAt };
  });
  return { groups };
}

/** The close detail the dead-dispatch lane stores, so its closes are told from the crash row's (a null detail). */
export const DISPATCH_ABANDON_CLOSE_DETAIL = 'dispatch-abandon:never-came-back';

/** Which group closed a run, from the sweep's close detail: the never-started lane names its rows (`expired:never-started`,
 *  `expired:review-orphaned`); a sweep close with no detail is the crash row's; the dead-dispatch lane stores `dispatch-abandon:` and belongs to no group. */
export function runCloseGroupOfDetail(detail: string | null): RunCloseGroup | null {
  if (detail === null) return 'claimant-crashed';
  // The lane names the row that closed a run (`expired:<row>`); the row says which group's close it was.
  if (!detail.startsWith('expired:')) return null;
  const row = detail.slice('expired:'.length).split(' ')[0] ?? '';
  return (RUN_CLOSE_ROWS as readonly string[]).includes(row) ? RUN_CLOSE_ROW_GROUP[row as RunCloseRow] : 'never-started';
}

/** The sweep's closes grouped by detail (`CoordStore.sweepClosesBetween`) folded into the groups' counts. */
export function closedByGroup(rows: readonly { detail: string | null; n: number }[]): Record<RunCloseGroup, number> {
  const out: Record<RunCloseGroup, number> = { 'never-started': 0, 'claimant-crashed': 0, 'claimant-gone': 0 };
  for (const r of rows) {
    const g = runCloseGroupOfDetail(r.detail);
    if (g !== null) out[g] += r.n;
  }
  return out;
}
