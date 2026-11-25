// L1 policy (pure), context Coordination: the programmes read's lifecycle fields (programme lifecycle spec 2026-11-24 §6,
// §15; W2). The facts are measured by the store (`programmeLifecycleActs.ts#lifecycleRowsOf`) and the registry (one
// reading per bound session); this decides what each row shows, through the one decider of each fact (`lifecycleOf`,
// `coordinatorLineOf`), and which rows the read lists. No I/O.
import type { ProgrammeRow, ProgrammesAnswer } from '../../../shared/api.js';
import {
  coordinatorLineOf, isEnded, lifecycleOf, type CoordinatorRegistryReading, type CoordinatorWithoutProgramme,
  type PlaceholderState, type ProgrammeClaimConflict, type ProgrammeLifecycleFields,
} from '../../../shared/programmeLifecycle.js';

/** One programme row's lifecycle facts, as the store reads them (the reserved row never among them). */
export interface LifecycleRowFacts {
  readonly slug: string; readonly title: string; readonly state: string; readonly placeholder: string | null;
  readonly coordinator: string | null; readonly coordinatorUuid: string | null;
  readonly open: number; readonly dispatched: boolean; readonly conflict: ProgrammeClaimConflict | null;
}

/** A row's lifecycle fields (spec §15). `coordinator` is named only when the line is `led`; `pausedOpenRuns` only on a
 *  Paused programme with open runs. */
export function lifecycleFieldsOf(f: LifecycleRowFacts, reading: CoordinatorRegistryReading): ProgrammeLifecycleFields {
  const lifecycle = lifecycleOf(f.state, f.placeholder, { open: f.open, dispatched: f.dispatched });
  const line = coordinatorLineOf({ session: f.coordinator, uuid: f.coordinatorUuid }, reading);
  return {
    lifecycle, coordinatorLine: line, coordinator: line === 'led' ? f.coordinator : null,
    placeholder: f.placeholder as PlaceholderState | null,
    ...(lifecycle === 'paused' && f.open > 0 ? { pausedOpenRuns: f.open } : {}),
    claimConflict: f.conflict,
  };
}

/** A programme the run window did not list, as a row of its own: no wave and no run facts. */
const bareRow = (f: LifecycleRowFacts): ProgrammeRow => ({
  slug: f.slug, title: f.title, currentWave: null, waveOf: null, claimedBy: null,
  waves: { working: 0, waiting: 0, queued: 0, done: 0, failed: 0 }, lastMoveAt: null, ending: null,
});

/**
 * The programmes read with its lifecycle (spec §6, §15): every row the run window listed gains its fields; every real
 * programme that has not ended and is not a filed or withdrawn placeholder is listed even with no run in the window (an
 * Idle programme stays reachable, D-8992); the reserved row is never listed (the facts never carry it); and
 * `coordinatorsWithoutProgramme` is added, each listed only while its registry row is present and not archived (W2 review:
 * decided here, not in the door). `readingOf` answers the registry reading of a session.
 */
export function withLifecycleFields(
  answer: ProgrammesAnswer, facts: readonly LifecycleRowFacts[], readingOf: (session: string) => CoordinatorRegistryReading,
  without: readonly CoordinatorWithoutProgramme[],
): ProgrammesAnswer {
  const bySlug = new Map(facts.map((f) => [f.slug, f]));
  const reading = (f: LifecycleRowFacts): CoordinatorRegistryReading =>
    (f.coordinator === null ? { kind: 'absent' } : readingOf(f.coordinator));
  const listed = new Set<string>();
  const programmes: ProgrammeRow[] = [];
  for (const row of answer.programmes) {
    const f = bySlug.get(row.slug);
    if (f === undefined) continue;   // the reserved row, or a row with no programme: not a programme
    listed.add(row.slug);
    programmes.push({ ...row, ...lifecycleFieldsOf(f, reading(f)) });
  }
  for (const f of facts) {
    if (listed.has(f.slug) || isEnded(f.state) || f.placeholder === 'filed' || f.placeholder === 'withdrawn') continue;
    programmes.push({ ...bareRow(f), ...lifecycleFieldsOf(f, reading(f)) });
  }
  const live = without.filter((w) => { const r = readingOf(w.session); return r.kind === 'present' && !r.archived; });
  return { ...answer, programmes, coordinatorsWithoutProgramme: live };
}
