// THE DRIFT PUSH BUDGET (coordinator-durability tail spec §4.4; D-5922). L1: pure, clock-free (`now` is an argument),
// IO-free. It chooses WHICH open findings reach the operator on this pass and how; the lane (`driftLane.ts`, L4)
// stamps `pushedAt` first and calls the funnel after. Nothing here acts, and the reconciler as a whole never does.
//
// The rule: one push per finding, the first time its age passes 24 h, never again for that key (`pushedAt`, read by
// the caller). Two bounds, because a first deploy meets weeks of standing drift: the pass that finds the table empty
// folds every due finding into ONE summary, and otherwise at most `DRIFT_PASS_CAP` per pass and `DRIFT_DAY_CAP` per
// UTC day (the day's count is read from the table, so a restart keeps it). While the lane is UNARMED nothing is
// pushed: the same due findings are chosen for a shadow record instead, once per key (`shadowAt`).
import type { DriftKind } from '../../../shared/api.js';
import { DRIFT_PUSH_AGE_MS, type DriftFindingRow } from './drift.js';

/** At most this many per-item pushes in one pass. */
export const DRIFT_PASS_CAP = 3;
/** At most this many per-item pushes in one UTC day. */
export const DRIFT_DAY_CAP = 12;

/** What a stall OPERATOR rung in mode `live` already told the operator (a `shadow` row reached nobody). */
export interface DriftToldFacts {
  /** Runs with a live quiet-arm rung 3. */
  readonly quietRuns: ReadonlySet<number>;
  /** Deliveries with a live mail-stuck observation. */
  readonly stuckDeliveries: ReadonlySet<number>;
}

export interface DriftPushInput {
  /** The table's rows after this pass's record. */
  readonly rows: readonly DriftFindingRow[];
  /** Whether the table held no row at all before this pass recorded. */
  readonly tableWasEmpty: boolean;
  /** Whether the push marker stands (the lane is live). Unarmed: shadow only. */
  readonly armed: boolean;
  /** Whether the dead-coordinator lane is armed: it then owns a dead claimant, and `claimant-gone` is listed, not pushed. */
  readonly deadCoordinatorArmed: boolean;
  readonly told: DriftToldFacts;
  /** Delivery ids whose own once-per-park push already went (`parkEscalatedAt` set). */
  readonly escalatedDeliveries: ReadonlySet<number>;
  /** Per-item pushes already made this UTC day. */
  readonly pushedToday: number;
  readonly now: number;
}

export interface DriftPushPlan {
  /** Armed, empty table: every due finding, folded into one summary push. */
  readonly summary: readonly DriftFindingRow[];
  /** Armed: the per-item pushes, oldest fact first. */
  readonly items: readonly DriftFindingRow[];
  /** Unarmed: the due findings not yet recorded as "would push". */
  readonly shadow: readonly DriftFindingRow[];
}

const idOf = (key: string): number | null => {
  const m = /:(\d+)$/.exec(key);
  return m === null ? null : Number(m[1]);
};

/** A finding the operator was already told about by the stall watch, or whose own remedy pushes it. */
function listedNotPushed(r: DriftFindingRow, i: DriftPushInput): boolean {
  const kind: DriftKind = r.kind;
  if (kind === 'question-orphaned') return true; // §5's re-raise pushes the question itself
  if (kind === 'claimant-gone') return i.deadCoordinatorArmed;
  const id = idOf(r.key);
  if (kind === 'run-quiet') return id !== null && i.told.quietRuns.has(id);
  if (kind === 'mail-held') return id !== null && i.told.stuckDeliveries.has(id);
  if (kind === 'mail-parked') return id !== null && (i.told.stuckDeliveries.has(id) || i.escalatedDeliveries.has(id));
  return false;
}

/** The pass's pushes. Pure over plain rows; the same input answers the same plan. */
export function chooseDriftPushes(i: DriftPushInput): DriftPushPlan {
  const due = i.rows
    .filter((r) => r.clearedAt === null && r.pushedAt === null
      && i.now - (r.factAt ?? r.firstSeenAt) > DRIFT_PUSH_AGE_MS && !listedNotPushed(r, i))
    .sort((a, b) => (a.factAt ?? a.firstSeenAt) - (b.factAt ?? b.firstSeenAt) || (a.key < b.key ? -1 : 1));
  if (!i.armed) return { summary: [], items: [], shadow: due.filter((r) => r.shadowAt === null) };
  if (i.tableWasEmpty) return { summary: due, items: [], shadow: [] };
  const room = Math.max(0, Math.min(DRIFT_PASS_CAP, DRIFT_DAY_CAP - i.pushedToday));
  return { summary: [], items: due.slice(0, room), shadow: [] };
}
