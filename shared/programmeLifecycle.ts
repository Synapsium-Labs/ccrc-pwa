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

// ── W2: the doors' vocabulary (programme lifecycle spec §5, §8, §11, §14, §15; D-8987, D-8989, D-8992) ─────────────────

/** The edges of `POST /api/programmes/:slug/state` (spec §5). */
export const PROGRAMME_STATE_EDGES = ['pause', 'resume', 'end', 'reopen', 'repair'] as const;
export type ProgrammeStateEdge = (typeof PROGRAMME_STATE_EDGES)[number];
export const isProgrammeStateEdge = (v: unknown): v is ProgrammeStateEdge =>
  typeof v === 'string' && (PROGRAMME_STATE_EDGES as readonly string[]).includes(v);

/** Every operator or Overlord programme act the credential rule (spec §14) rules on: the state door's edges, the start, the
 *  hand-over, and the confirm and decline of an end proposal. */
export const PROGRAMME_DOOR_ACTS = [...PROGRAMME_STATE_EDGES, 'start', 'hand-over', 'confirm-end', 'decline-end'] as const;
export type ProgrammeDoorAct = (typeof PROGRAMME_DOOR_ACTS)[number];

/** What a door asks of its caller (spec §14): `dark-ok` works while sign-in is dark and records `flag-off` then; `gate` takes
 *  the account gate; `step-up` takes its step-up; `rung` is the Overlord's door, gated by its rung cell alone (W7). */
export const DOOR_CREDENTIALS = ['dark-ok', 'gate', 'step-up', 'rung'] as const;
export type DoorCredential = (typeof DOOR_CREDENTIALS)[number];

/** Who decides an edge: the operator through a console door, or the Overlord through its own door (W7). */
export const PROGRAMME_DECIDERS = ['operator', 'overlord'] as const;
export type ProgrammeDecider = (typeof PROGRAMME_DECIDERS)[number];

/** The doors' own refusal words, each with its ONE status, spread into `shared/refusal.ts`'s `REFUSAL_STATUS`
 *  (`DELEGATION_ADOPT_REFUSALS`' idiom). CHOSEN, not measured: 400 for what the caller can fix, 404 for a programme that
 *  is not there, 409 for a state that refuses the act, 503 for a coordinator line that could not be measured. The words the
 *  doors share with older tables (`programme-ended`, `already-asked`, `not-your-programme`) keep those tables' statuses. */
export const PROGRAMME_DOOR_REFUSALS = {
  'slug-taken': 409, 'why-required': 400, 'coordinator-required': 409, 'owns-another-programme': 409,
  'programme-has-coordinator': 409, 'coordinator-unmeasured': 503, 'unknown-programme': 404, 'not-paused': 409,
  'not-ended': 409, 'not-unknown': 409, 'programme-runs-open': 409, 'evidence-required': 400, 'programme-provisional': 409,
  'programme-unknown': 409, 'no-coordinator': 409,
} as const;
export type ProgrammeDoorRefusal = keyof typeof PROGRAMME_DOOR_REFUSALS;

/** An end proposal's outcome, and the two answers its item offers (spec §8). */
export type ProgrammeEndOutcome = ProgrammeEndedState;
export const END_PROPOSAL_OPTIONS: readonly string[] = ['End the programme', 'Keep it open'];
/** The proposal's evidence: 1 to this many lines, each 1 to `END_EVIDENCE_LINE_MAX` characters. */
export const END_EVIDENCE_MAX = 24;
export const END_EVIDENCE_LINE_MAX = 2000;

/** A migration conflict on a live programme (spec §13), derived at each read, never stored: one session holding open runs
 *  in several programmes, or one programme whose open runs several sessions hold. */
export const CLAIM_CONFLICT_KINDS = ['session-in-several', 'programme-several-claimants'] as const;
export interface ProgrammeClaimConflict {
  readonly kind: (typeof CLAIM_CONFLICT_KINDS)[number];
  readonly claimants: readonly string[];
}

/** The lifecycle fields `GET /api/programmes` adds to a row (spec §15), each additive: absent from an older server, and
 *  read by one PWA reader (W6). `coordinator` is the bound session, named only when the line is `led`. */
export interface ProgrammeLifecycleFields {
  lifecycle?: ProgrammeLifecycle | null;
  coordinatorLine?: CoordinatorLine;
  coordinator?: string | null;
  placeholder?: PlaceholderState | null;
  pausedOpenRuns?: number;
  claimConflict?: ProgrammeClaimConflict | null;
}

/** Why a coordinator owns no programme now (spec §6): its programme was handed to another, ended, its placeholder was
 *  withdrawn, or the operator released it. */
export const NO_PROGRAMME_WHYS = ['handed-over', 'ended', 'withdrawn', 'released', 'never-joined'] as const;
export type NoProgrammeWhy = Exclude<(typeof NO_PROGRAMME_WHYS)[number], 'never-joined'>;

/** One coordinator with no programme (spec §6), from its newest event: why, and since when. */
export interface CoordinatorWithoutProgramme {
  readonly session: string;
  readonly why: NoProgrammeWhy;
  readonly since: number;
  /** The programme it last owned. */
  readonly last: string;
}

/** The programmes read's additive list (spec §6, §15). */
export interface ProgrammesLifecycleAnswer {
  coordinatorsWithoutProgramme?: CoordinatorWithoutProgramme[];
}

/** One line of a programme's story (spec §11): a programme event (its own, or a placeholder's filed into it), or a run's
 *  transition, oldest first. */
export type ProgrammeHistoryEntry =
  | { readonly source: 'programme'; readonly at: number; readonly program: string; readonly edge: ProgrammeEventEdge | string;
      readonly fromState: string | null; readonly toState: string | null; readonly actorKind: string; readonly actor: string;
      readonly why: string; readonly session: string | null; readonly detail: unknown }
  | { readonly source: 'run'; readonly at: number; readonly runId: number; readonly wave: number; readonly kind: string;
      readonly fromState: string | null; readonly toState: string; readonly actor: string };

/** `GET /api/sessions/:id/programme` (spec §7, §14): the session's one programme, or `none` with why. */
export type SessionProgrammeAnswer =
  | { readonly ok: true; readonly programme: { readonly slug: string; readonly placeholder: PlaceholderState | null;
      readonly lifecycle: ProgrammeLifecycle | null } }
  | { readonly ok: true; readonly programme: 'none'; readonly why: NoProgrammeWhy | 'never-joined' };

/** The words a coordinator left owning nothing is told (spec §7), once, by system mail. */
export const NO_PROGRAMME_SENTENCE =
  'You own no programme now. The operator or the Overlord will give you one or archive this session; open no runs until then.';

/** The lifecycle doors' kebab words, for the code-word census (`mail-routes.test.ts`): their refusals, the event and edge
 *  words, the door acts and credentials, the coordinator lines, the conflict kinds and why a coordinator owns nothing. Each
 *  rides a door's answer or a stored event, never a mail rejection. */
const DOOR_WORDS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(PROGRAMME_DOOR_REFUSALS), ...PROGRAMME_EVENT_EDGES, ...PROGRAMME_DOOR_ACTS, ...DOOR_CREDENTIALS,
  ...COORDINATOR_LINES, ...CLAIM_CONFLICT_KINDS, ...NO_PROGRAMME_WHYS,
]);
export const isProgrammeDoorWord = (w: string): boolean => DOOR_WORDS.has(w);
