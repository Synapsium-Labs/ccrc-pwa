// The ladder's composed read. Ring L3, context C5: read rows and inputs, then ask the L1 deciders.
import { LADDER_CAUSE_MAP, LADDER_CAUSES, RUNGS, rungNeeds, type ConditionReading, type LadderConditionCause, type LadderWire, type NarrowingState } from '../../../shared/overlord-ladder.js';
import type { CONTINUITY_LANE } from '../../../shared/lane-arm.js';
import { liveGenerationOf } from '../continuity/liveGeneration.js';
import { degradedReading, effectiveRung, latchKnown, narrowingState, rungAvailable, rungWordReading, type EffectiveRung } from './overlordLadder.js';
import type { LadderRowsRead } from './overlordLadderStore.js';
import type { CoordStore } from './store.js';
import type { LadderCauseRow, LadderLatchCause, Rung } from '../../../shared/overlord-ladder.js';
import type { AuthorityAppender, BrakeActor, LadderWrite } from './overlordLadderStore.js';
import type { Clock, Entropy } from '../time/ports.js';

type LatchTable = Readonly<Record<string, LadderCauseRow & { readonly kind: 'latch'; readonly effect: { readonly kind: 'cap'; readonly cap: Rung } }>>;
/** The only delivery-facing latch raise: cap and notice belong to the cause row, not the caller. */
export function raiseLatch<T extends LatchTable>(
  deps: { coord: Pick<CoordStore, 'raiseLatch'>; journal: AuthorityAppender; clock: Pick<Clock, 'wall'>; entropy: Pick<Entropy, 'hex'>; causeTable: T },
  cause: keyof T & string, detail: string, raisedBy: BrakeActor,
): LadderWrite & { notice: LadderCauseRow['notice'] };
export function raiseLatch(
  deps: { coord: Pick<CoordStore, 'raiseLatch'>; journal: AuthorityAppender; clock: Pick<Clock, 'wall'>; entropy: Pick<Entropy, 'hex'>; causeTable?: LatchTable },
  cause: LadderLatchCause, detail: string, raisedBy: BrakeActor,
): LadderWrite & { notice: LadderCauseRow['notice'] };
export function raiseLatch(
  deps: { coord: Pick<CoordStore, 'raiseLatch'>; journal: AuthorityAppender; clock: Pick<Clock, 'wall'>; entropy: Pick<Entropy, 'hex'>; causeTable?: LatchTable },
  cause: string, detail: string, raisedBy: BrakeActor,
): LadderWrite & { notice: LadderCauseRow['notice'] } {
  const table: Readonly<Record<string, LadderCauseRow>> = deps.causeTable ?? LADDER_CAUSE_MAP;
  const row = table[cause];
  if (row === undefined || row.kind !== 'latch' || row.effect.kind !== 'cap') throw new Error('latch cause has no stored cap');
  const result = deps.coord.raiseLatch(deps.journal, { cause, cap: row.effect.cap, detail, raisedBy, at: deps.clock.wall(), opKey: `latch-raise-${deps.entropy.hex(16)}` });
  return { ...result, notice: row.notice };
}

export type LadderConditionInputsFor<T extends Readonly<Record<string, { readonly kind: string }>>> = {
  readonly [K in keyof T as T[K]['kind'] extends 'condition' ? K : never]: () => ConditionReading
};
export type LadderConditionInputs = LadderConditionInputsFor<typeof LADDER_CAUSE_MAP>;
type InputStore = Pick<CoordStore, 'designationRead' | 'liveGenerations' | 'laneArmSetting' | 'ladderRungRead'>;
type RowStore = Pick<CoordStore, 'ladderRows'>;
export interface NarrowingWitness { heldFor(recordSequence: number): 'held' | 'not-yet' | 'unmeasured' }
export const NO_WITNESS_YET: NarrowingWitness = { heldFor: () => 'not-yet' };

export function ladderConditionInputs(deps: { coord: InputStore; serverCaps: readonly string[]; continuityGate?: (lane: typeof CONTINUITY_LANE) => string | null }): LadderConditionInputs {
  return {
    'generation-degraded': () => {
      try {
        const designation = deps.coord.designationRead();
        const live = designation.kind === 'designated' ? liveGenerationOf(deps.coord, designation.sessionId, deps.continuityGate) : 'no-generation';
        return degradedReading(designation, live);
      } catch { return 'unmeasured'; }
    },
    'rung-word-missing': () => {
      try {
        const read = deps.coord.ladderRungRead();
        return read.kind === 'current' ? rungWordReading(read.current, deps.serverCaps) : 'unmeasured';
      } catch { return 'unmeasured'; }
    },
  };
}

export type LadderRead =
  | { readonly kind: 'measured'; readonly effective: EffectiveRung; readonly rows: Extract<LadderRowsRead, { kind: 'measured' }>;
      readonly conditions: readonly { cause: LadderConditionCause; reading: ConditionReading }[];
      readonly lastChange: { readonly narrowing: NarrowingState | null } | null; readonly latchNarrowing: ReadonlyMap<number, NarrowingState> }
  | { readonly kind: 'unmeasured'; readonly why: string };

export function ladderRead(coord: RowStore, inputs: LadderConditionInputs, witness: NarrowingWitness, serverCaps: readonly string[]): LadderRead {
  try {
    const rows = coord.ladderRows();
    if (rows.kind === 'unmeasured') return rows;
    const conditions = LADDER_CAUSES.filter((cause): cause is LadderConditionCause => LADDER_CAUSE_MAP[cause].kind === 'condition').map((cause) => {
      let reading: ConditionReading;
      try { reading = inputs[cause](); } catch { reading = 'unmeasured'; }
      return { cause, reading };
    });
    const effective = effectiveRung({ operatorRung: rows.rung === null ? { kind: 'default' } : { kind: 'set', rung: rows.rung.operatorRung }, latches: rows.standing, conditions, causeTable: LADDER_CAUSE_MAP, serverCaps });
    const narrowing = (seq: number | null): NarrowingState => {
      if (seq === null) return narrowingState(null, 'not-yet');
      try { return narrowingState(seq, witness.heldFor(seq)); } catch { return narrowingState(seq, 'unmeasured'); }
    };
    return { kind: 'measured', rows, effective, conditions,
      lastChange: rows.rung === null ? null : { narrowing: rows.rung.narrowedAt === null ? null : narrowing(rows.rung.recordSequence) },
      latchNarrowing: new Map(rows.standing.map((row) => [row.id, narrowing(row.raiseSequence)])),
    };
  } catch (err) { return { kind: 'unmeasured', why: err instanceof Error ? err.message : String(err) }; }
}

/** Project a measured read onto its public wire. */
export function ladderWire(read: Extract<LadderRead, { kind: 'measured' }>, serverCaps: readonly string[]): LadderWire {
  const { rows, effective } = read;
  return {
    ok: true, operatorRung: effective.operatorRung, operatorRungSource: rows.rung === null ? 'default' : 'set',
    effectiveRung: effective.rung, binding: effective.binding, readBy: effective.readBy,
    latches: rows.standing.map((row) => ({ cause: row.cause, cap: row.cap, raisedAt: row.raisedAt, detail: row.detail,
      known: latchKnown(LADDER_CAUSE_MAP, row.cause),
      narrowing: read.latchNarrowing.get(row.id)! })),
    conditions: read.conditions.map((condition) => ({ ...condition, effect: LADDER_CAUSE_MAP[condition.cause].effect })),
    lastChange: rows.rung === null ? null : { at: rows.rung.updatedAt, actor: rows.rung.actor, narrowing: read.lastChange!.narrowing },
    rungs: RUNGS.map((rung) => { const needs = rungNeeds(rung); return { rung, needs, available: rungAvailable(rung, serverCaps) }; }),
  };
}
