// The live-generation reader (Overlord spec §3.3.11; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ladder.md` Task 3,
// question 18, slug `live-generation-reader-moves-out`). Ring L3, context C3. The continuity doors and the ladder's
// `generation-degraded` input read a session's live generation through these two functions, moved out of the continuity
// routes' closures unchanged, so there is one reader and never a second copy.
import { CONTINUITY_LANE, laneArmGate } from '../../../shared/lane-arm.js';
import { laneArmRowViewOf } from '../coord/laneArm.js';
import type { CoordStore } from '../coord/store.js';
import { designationFactFrom, identityOf as generationIdentityOf, type DesignationFact } from '../roleOf.js';
import { effectiveGeneration } from './continuityStore.js';

/** The designation as this call reads it, or `unmeasured` (a read that throws included). */
export function designationReadOf(coord: Pick<CoordStore, 'designationRead'>): DesignationFact | 'unmeasured' {
  try { return designationFactFrom(coord.designationRead()); } catch { return 'unmeasured'; }
}

/** The identity's live generation, as the one accessor reads it (`effectiveGeneration`), or what kept it from being read. */
export function liveGenerationOf(
  coord: Pick<CoordStore, 'liveGenerations' | 'designationRead' | 'laneArmSetting'>, id: string,
  continuityGate?: (lane: typeof CONTINUITY_LANE) => string | null,
) {
  const gens = coord.liveGenerations();
  const fact = designationReadOf(coord);
  if (!gens.ok || fact === 'unmeasured') return 'unmeasured' as const;
  const row = gens.rows.find((g) => g.identity === generationIdentityOf(id, fact));
  if (row === undefined) return 'no-generation' as const;
  const live = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE), (continuityGate ?? laneArmGate)(CONTINUITY_LANE)).live;
  return { row, state: effectiveGeneration(row, live).state };
}
