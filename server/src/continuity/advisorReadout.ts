// Context C3 (Session Conversation): the coordinator advisor's readout as the fleet assembly reads it (plan
// `2026-11-23-coordinator-advisor.md` PR D, spec §6). ONE batched read of the store per assembly (the Settings row, today's
// counts, the roll's and the continuity row's settings) and one read-state row per advised session; every word is
// `advisorStateOf`'s and `advisorApplyPathOf`'s. A read that throws answers no readout at all for the pass (the field is
// optional, and absent is "not measured"), never a guessed state.
import { CONTINUITY_LANE, laneArmGate } from '../../../shared/lane-arm.js';
import { ADVISOR_CAP_DEFAULT, type FleetAdvisor } from '../../../shared/coordinatorAdvisor.js';
import type { CoordStore } from '../coord/store.js';
import { laneArmRowViewOf } from '../coord/laneArm.js';
import { rollTargetsOf } from '../coord/rollTarget.js';
import type { SessionRecord } from '../registry.js';
import { advisorApplyPathOf, advisorRouteModelOf, advisorStateOf, coordinatorAdvisorOf, utcDayOf } from './advisorPolicy.js';

export type AdvisorReadoutCoord = Pick<CoordStore, 'coordinatorAdvisorSettings' | 'advisorDayCounts' | 'advisorReadState'
  | 'laneArmSetting' | 'rollSettings'>;

export function advisorReadoutsOf(coord: AdvisorReadoutCoord | undefined, recs: readonly SessionRecord[], nowMs: number):
  ReadonlyMap<string, FleetAdvisor> {
  const out = new Map<string, FleetAdvisor>();
  if (coord === undefined) return out;
  try {
    const day = utcDayOf(nowMs);
    const counts = coord.advisorDayCounts(day);
    const touched = recs.filter((r) => advisorRouteModelOf(r.route?.fields.advisor) !== null || r.advisorSpawn !== undefined
      || (counts.get(r.id)?.calls ?? 0) > 0);
    if (touched.length === 0) return out;
    const setting = coordinatorAdvisorOf(coord.coordinatorAdvisorSettings());
    const cap = setting?.cap ?? ADVISOR_CAP_DEFAULT;
    const continuityLive = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE), laneArmGate(CONTINUITY_LANE)).live;
    const targets = rollTargetsOf(coord.rollSettings());
    const applies = advisorApplyPathOf(continuityLive, targets === 'all' || targets === 'coordinators');
    for (const r of touched) {
      const c = counts.get(r.id);
      const today = c?.calls ?? 0;
      const spawn = r.advisorSpawn ?? null;
      const state = advisorStateOf({ routeWord: r.route?.fields.advisor, spawn, read: coord.advisorReadState(r.id), today, cap, day });
      const model = advisorRouteModelOf(r.route?.fields.advisor)
        ?? (spawn !== null && spawn !== 'unreadable' && spawn.kind === 'applied' ? spawn.model : null);
      out.set(r.id, { state, model, today, cap, overrun: Math.max(0, today - cap), tokens: c?.tokens ?? null, applies });
    }
  } catch (err) {
    console.warn(`ccrc-server: advisor readout not read this pass: ${err instanceof Error ? err.message : String(err)}`);
    out.clear();
  }
  return out;
}
