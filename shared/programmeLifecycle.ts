// L0 (imports nothing): the programme lifecycle's vocabulary and its two pure deciders (programme lifecycle spec
// 2026-11-24 §3, D-8983, D-8984, D-8993). A new file because `shared/api.ts` is at its growth cap.
//
// `lifecycleOf` is the ONE place the shown state is decided: the stored decision (`programs.state`) and the runs. Open,
// Active and Idle are never stored (D-8984). `isEnded` is the one end predicate every gate reads (D-8983).
// `coordinatorLineOf` derives "Led by", "No coordinator" or "Coordinator unmeasured" from the stored binding and one
// registry reading, never folding doubt into absence.

/** The stored decision's vocabulary, spelled ONCE, here: `shared/api.ts`'s `ProgramState` and its `isProgramState` list
 *  derive from it (this file imports nothing, so `api.ts` imports it, never the other way). */
export const PROGRAMME_STORED_STATES = ['active', 'paused', 'done', 'abandoned', 'unknown'] as const;
export type ProgrammeStoredState = (typeof PROGRAMME_STORED_STATES)[number];

/** The two ended decisions. */
export const PROGRAMME_ENDED_STATES = ['done', 'abandoned'] as const;
export type ProgrammeEndedState = (typeof PROGRAMME_ENDED_STATES)[number];

/** The shown lifecycle (spec §3's table). `unknown` covers stored `unknown` and any out-of-vocabulary value. */
export type ProgrammeLifecycle = 'open' | 'active' | 'idle' | 'paused' | 'done' | 'abandoned' | 'unknown';
const PROGRAMME_LIFECYCLE_MAP: Record<ProgrammeLifecycle, true> =
  { open: true, active: true, idle: true, paused: true, done: true, abandoned: true, unknown: true };
export const PROGRAMME_LIFECYCLES = Object.keys(PROGRAMME_LIFECYCLE_MAP) as ProgrammeLifecycle[];

/** A placeholder's own state (`programs.placeholder`); null on a real programme. */
export const PLACEHOLDER_STATES = ['unfiled', 'filed', 'withdrawn'] as const;
export type PlaceholderState = (typeof PLACEHOLDER_STATES)[number];

/** The runs' two facts `lifecycleOf` reads: the count of open runs (any non-terminal state, `planned` and `unknown`
 *  included) and whether any run of the programme was ever dispatched (a `run_events` row to `dispatched` or `working`). */
export interface ProgrammeRunFacts {
  readonly open: number;
  readonly dispatched: boolean;
}

/** The one end predicate (D-8983): `done` or `abandoned`. Any other stored value, out-of-vocabulary included, is not ended. */
export function isEnded(stored: string): boolean {
  return (PROGRAMME_ENDED_STATES as readonly string[]).includes(stored);
}

/**
 * Is the end RECORDED: ended, with the end's record (`planEnd`) saying the same outcome? Every end `decideInTx` writes is
 * one. A D-51 end the migration kept (spec §13 step 4, `auto-retire-kept`: `done` or `abandoned` with `planEnd` null) is
 * not: it is kept until the operator decides, so it ends nothing outside this database (W1 review, C1 and C5): the timer
 * lane cancels no timer for it and the Linear sync closes nothing for it, because neither act is undone by a reopen.
 * Every gate inside ccrc still reads `isEnded`.
 */
export function endRecorded(stored: string, planEnd: string | null): boolean {
  return isEnded(stored) && planEnd === stored;
}

/** Spec §3's truth table, row by row. A filed or withdrawn placeholder has no shown lifecycle (null). */
export function lifecycleOf(stored: string, placeholder: string | null, runs: ProgrammeRunFacts): ProgrammeLifecycle | null {
  if (placeholder === 'filed' || placeholder === 'withdrawn') return null;
  switch (stored) {
    case 'active':
      if (!runs.dispatched) return 'open';
      return runs.open > 0 ? 'active' : 'idle';
    case 'paused': return 'paused';
    case 'done': return 'done';
    case 'abandoned': return 'abandoned';
    default: return 'unknown';
  }
}

/** The coordinator line (spec §3): `led`, `no-coordinator`, or `unmeasured`, which is never folded into either. */
export type CoordinatorLine = 'led' | 'no-coordinator' | 'unmeasured';
const COORDINATOR_LINE_MAP: Record<CoordinatorLine, true> = { led: true, 'no-coordinator': true, unmeasured: true };
export const COORDINATOR_LINES = Object.keys(COORDINATOR_LINE_MAP) as CoordinatorLine[];

/** The stored binding: `programs.coordinator` and `coordinatorUuid` (null uuid only on a migration-seeded binding). */
export interface CoordinatorBinding {
  readonly session: string | null;
  readonly uuid: string | null;
}

/** One registry reading of the bound session: the registry could not be read; it lists no such row; or the row, with
 *  its uuid (`null` when the uuid could not be read), whether it is archived, and whether it is mid-swap or mid-roll. */
export type CoordinatorRegistryReading =
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly uuid: string | null; readonly archived: boolean; readonly carrying: boolean };

export function coordinatorLineOf(binding: CoordinatorBinding, registry: CoordinatorRegistryReading): CoordinatorLine {
  if (binding.session === null) return 'no-coordinator';
  switch (registry.kind) {
    case 'unreadable': return 'unmeasured';
    case 'absent': return 'no-coordinator';
    case 'present':
      if (registry.carrying || registry.uuid === null) return 'unmeasured';
      if (registry.archived) return 'no-coordinator';
      // A migration-seeded binding's uuid is null until the registry lane stamps it: any incarnation reads `led`.
      if (binding.uuid === null) return 'led';
      return registry.uuid === binding.uuid ? 'led' : 'no-coordinator';
  }
}

/** Who wrote a programme event (`programme_events.actorKind`, spec §5). */
export const PROGRAMME_ACTOR_KINDS = ['operator', 'overlord', 'coordinator', 'system', 'backfill', 'migration'] as const;
export type ProgrammeActorKind = (typeof PROGRAMME_ACTOR_KINDS)[number];

/** What a programme event records (`programme_events.edge`, spec §5 and §13). Derived transitions write none. */
export const PROGRAMME_EVENT_EDGES = [
  'started', 'coordinator', 'pause', 'resume', 'ended', 'reopened', 'repaired', 'migrated',
  'filed', 'withdrawn', 'end-proposed', 'end-declined', 'end-withdrawn', 'coordinator-gone', 'coordinator-back',
] as const;
export type ProgrammeEventEdge = (typeof PROGRAMME_EVENT_EDGES)[number];

/** The migration's and the boot re-measure's rule names (spec §13 steps 3 and 4), carried in a `migrated` event's detail. */
export const PROGRAMME_MIGRATION_RULES = [
  'plan-end', 'ended-over-open-runs', 'auto-retire-kept',
  'session-in-several', 'programme-several-claimants', 'past-claimant-in-several',
] as const;
export type ProgrammeMigrationRule = (typeof PROGRAMME_MIGRATION_RULES)[number];

/** The refusals `POST /api/runs` gains with the lifecycle (spec §5's dispatch row, R11), each a `RunRefuseCode`
 *  (`shared/api.ts` spreads this map into its own, which is at its growth cap). */
export type ProgrammeRunRefuseCode =
  | 'programme-paused' | 'programme-unknown' | 'programme-provisional' | 'owns-another-programme' | 'not-your-programme';
export const PROGRAMME_RUN_REFUSAL_MAP: Readonly<Record<ProgrammeRunRefuseCode, true>> = {
  'programme-paused': true, 'programme-unknown': true, 'programme-provisional': true,
  'owns-another-programme': true, 'not-your-programme': true,
};

/** The lifecycle store's own refusal words (W1 review), each a typed result its caller answers or rolls back on, never sent
 *  as a door's word in W1: the first recorded end stands (`already-ended`, `decideInTx`); an ended programme or a filed or
 *  withdrawn placeholder is never bound (`programme-ended`, `bindCoordinatorInTx`); a programme-keyed move names no row
 *  (`unknown-programme`, `CoordStore#reclaimProgramme`). */
export const PROGRAMME_STORE_REFUSALS = ['already-ended', 'programme-ended', 'unknown-programme'] as const;
export type ProgrammeStoreRefusal = (typeof PROGRAMME_STORE_REFUSALS)[number];
