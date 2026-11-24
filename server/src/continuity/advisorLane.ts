// L4 delivery, context C3 (Session Conversation): the coordinator advisor's COUNT lane (plan `2026-11-23-coordinator-advisor.md`
// PR C, D-8970, D-8971). Once a minute, one pass at a time: for every session whose route asks for an advisor or whose last
// spawn applied one, it reads that session's transcript forward from the kept offset (`readAdvisorForward`), folds the lines'
// facts (`advisorFactsOf`, `foldAdvisorFacts`) and records the calls and the reader's state through the store's one writer
// (`recordAdvisorRead`). Every decision is elsewhere: who is advised is `advisorFor`'s, the readout `advisorStateOf`'s. This
// file reads, folds and records. A read that fails records nothing and is retried next pass; the offset never moves past a
// line it did not read.
import type { CoordStore } from '../coord/store.js';
import type { FleetIO } from '../io.js';
import type { SessionRecord } from '../registry.js';
import { advisorFactsOf } from '../transcript/parse.js';
import { readAdvisorForward } from '../transcript/advisorRead.js';
import { ADVISOR_KEEP_DAYS } from '../coord/advisorStore.js';
import { advisorRouteModelOf, foldAdvisorFacts, utcDayOf } from './advisorPolicy.js';

/** The lane's `LANE_SCHEDULE` row. */
export const ADVISOR_COUNT_LANE_ROW = 'advisorCount';
const DAY_MS = 86_400_000;

export type AdvisorCountCoord = Pick<CoordStore, 'advisorReadState' | 'recordAdvisorRead'>;

export interface AdvisorCountDeps {
  readonly coord: AdvisorCountCoord;
  readonly io: Pick<FleetIO, 'statMeasured' | 'readFileFromBytesMeasured'>;
  /** The transcript path the resolver names for this session, or null when it names none. */
  readonly transcriptOf: (rec: SessionRecord) => Promise<string | null>;
  readonly now: () => number;
  readonly log: (line: string) => void;
}

/** Whether the lane reads this session: its route asks for an advisor, or its last spawn applied one. */
export function advisorCounted(rec: Pick<SessionRecord, 'route' | 'advisorSpawn'>): boolean {
  const routed = advisorRouteModelOf(rec.route?.fields.advisor) !== null;
  const applied = rec.advisorSpawn !== undefined && rec.advisorSpawn !== 'unreadable' && rec.advisorSpawn.kind === 'applied';
  return routed || applied;
}

export interface AdvisorCountResult { readonly read: number; readonly calls: number; readonly failed: number }

export async function advisorCountPass(deps: AdvisorCountDeps, records: readonly SessionRecord[]): Promise<AdvisorCountResult> {
  let read = 0; let calls = 0; let failed = 0;
  for (const rec of records) {
    if (!advisorCounted(rec)) continue;
    const spawn = rec.advisorSpawn;
    const spawnAt = spawn !== undefined && spawn !== 'unreadable' ? spawn.at : 0;
    const file = await deps.transcriptOf(rec);
    if (file === null) { failed += 1; continue; }
    const prev = deps.coord.advisorReadState(rec.id);
    // No place in this file (a first read, or a new path after a swap): its tail, never byte 0 (review F1).
    const offset = prev !== null && prev.file === file ? prev.offset : 'tail';
    const r = await readAdvisorForward(deps.io, file, offset);
    if (!r.ok) { failed += 1; deps.log(`ccrc-server: advisor count: ${rec.id}: the transcript is ${r.reason}, counted next pass`); continue; }
    const applied = spawn !== undefined && spawn !== 'unreadable' && spawn.kind === 'applied';
    const folded = foldAdvisorFacts(prev, file, spawnAt, applied, r.lines.map(advisorFactsOf), r.next, r.skippedLong ? 1 : 0);
    const now = deps.now();
    deps.coord.recordAdvisorRead(rec.id, folded.state, folded.calls, now, utcDayOf(now - ADVISOR_KEEP_DAYS * DAY_MS));
    read += 1; calls += folded.calls.length;
  }
  return { read, calls, failed };
}
