// The plan vocabulary (Linear hierarchy design 2026-11-10, wave 2, D-8181). L0: this file imports `./api.js` (the programme
// slug grammar) and TYPES from `./ledgers.js`, and `shared/api.ts` never imports it (`peers-claims-l0.test.ts`,
// `collect-lane-l0.test.ts`). Every list, bound and reserved word of the plan is spelled once, here
// (`server/test/single-definition/plan.test.ts`).
import { shapeProgramSlug } from './api.js';

/** An epic's states: planned, running, finished, or dropped from the plan. */
export const EPIC_STATES = ['planned', 'active', 'done', 'dropped'] as const;
export type EpicState = (typeof EPIC_STATES)[number];
/** What a checkpoint proves: an accepted result, an act the operator takes, or a measurement. */
export const CHECKPOINT_KINDS = ['acceptance', 'operator-act', 'measured'] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];
export const CHECKPOINT_STATES = ['open', 'met', 'dropped'] as const;
export type CheckpointState = (typeof CHECKPOINT_STATES)[number];
export const TICKET_KINDS = ['work', 'task', 'bug', 'follow-up'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];
/** Who put a ticket in the plan: the plan itself, a worker, or an inbound Linear issue the coordinator took. */
export const TICKET_SOURCES = ['plan', 'worker', 'inbound'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];
export const TICKET_STATES = ['open', 'started', 'done', 'dropped'] as const;
export type TicketState = (typeof TICKET_STATES)[number];
/** How a coordinator ends a plan explicitly (`plan close`). */
export const PLAN_END_OUTCOMES = ['done', 'abandoned'] as const;
export type PlanEndOutcome = (typeof PLAN_END_OUTCOMES)[number];
/** What a Linear binding binds a plan object to. */
export const BINDING_KINDS = ['programme', 'epic', 'checkpoint', 'ticket'] as const;
export type BindingKind = (typeof BINDING_KINDS)[number];
export const BINDING_STATES = ['pending', 'bound', 'failed'] as const;
export type BindingState = (typeof BINDING_STATES)[number];
export const MIGRATION_STATES = ['proposing', 'proposed', 'approved', 'applying', 'applied', 'put-back', 'failed'] as const;
export type MigrationState = (typeof MIGRATION_STATES)[number];
/** Where an inbound Linear issue stands (D-8183): waiting for a coordinator, mailed to one, handed to a session, taken into the
 *  plan, placed, closed in Linear with a reason, or raised to the operator. */
export const INBOUND_STATES = ['waiting', 'mailed', 'handed', 'taken', 'placed', 'closed', 'raised'] as const;
export type InboundState = (typeof INBOUND_STATES)[number];
/** What the team's Linear owner decides about an inbound issue (`plan triage`, D-8183): hand it to a programme, place it in the
 *  team's Upkeep epic, close it with a reason, or raise it to the operator. */
export const TRIAGE_DECISIONS = ['hand', 'upkeep', 'close', 'raise'] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];
/** A project's place in the per-team migration, as its row in the console says it. */
export const HIERARCHY_STATES = ['not-migrated', 'map-waiting', 'migrating', 'migrated', 'put-back'] as const;
export type HierarchyState = (typeof HIERARCHY_STATES)[number];
/** What a phase reference names: a whole epic or one ticket (programme work map, WM0, D14). */
export const PHASE_REF_KINDS = ['epic', 'ticket'] as const;
export type PhaseRefKind = (typeof PHASE_REF_KINDS)[number];
/** What `plan phase-ref` does to one reference: add it, remove it, or carry a ticket to a later phase (D17). */
export const PHASE_REF_OPS = ['add', 'remove', 'carry'] as const;
export type PhaseRefOp = (typeof PHASE_REF_OPS)[number];

/** The bounds a plan body is held to. */
export const PLAN_BOUNDS = {
  epics: 24, checkpointsPerEpic: 16, ticketsPerBody: 200, titleChars: 255, summaryChars: 500, bodyBytes: 65_536, reasonChars: 500,
  phases: 24, refsPerPhase: 200,
} as const;

/** The reserved programme row the sync's own work runs under, and the epic every programme keeps for upkeep. */
export const LINEAR_SYNC_PROGRAMME = 'linear-sync';
export const UPKEEP_EPIC_KEY = 'upkeep';
/** The due queue's key prefix for an upkeep epic: `upkeep:<project>` (design 4.2). */
export const UPKEEP_DUE_PREFIX = 'upkeep:';
export const UPKEEP_EPIC_TITLE = 'Upkeep';

/** A plan key (an epic, checkpoint or ticket key) has the programme slug grammar. */
export const isPlanKey = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  const shaped = shapeProgramSlug(v);
  return shaped.ok && shaped.slug === v;
};

/** Every refusal word of the plan verbs and the hierarchy routes. Each has its status in `REFUSAL_STATUS`
 *  (`shared/refusal.ts`). Only the coordinator's client sends the plan verbs, so only `linear-text-public` and
 *  `item-act-mismatch` have a fixed sentence in the console (`pwa/src/lib/refusalWords.ts`; programme work map reviews
 *  2268 F20 and 2375 F11). `unknown-ref` and `bad-carry` are the phase words (programme work map WM0, D-8715). */
export const PLAN_REFUSALS = [
  'not-plan-owner', 'not-linear-owner', 'plan-too-large', 'plan-bad-body', 'waves-not-contiguous', 'wave-overlap',
  'dropped-needs-reason', 'unknown-epic', 'unknown-checkpoint', 'unknown-ticket', 'ticket-workspace-mismatch',
  'linear-text-public', 'plan-owned', 'map-rewrites-plan', 'map-incomplete', 'migration-in-flight', 'not-managed',
  'issue-not-inbound', 'item-act-mismatch', 'plan-closed', 'plan-runs-open', 'unknown-ref', 'bad-carry',
] as const;
export type PlanRefusal = (typeof PLAN_REFUSALS)[number];

/** The kebab words of this vocabulary, for the mail-routes census (`mail-routes.test.ts`): a quoted kebab word in
 *  `server/src/coord` is a declared code or passes an exported guard, and this is the guard for the plan's. */
const PLAN_KEBAB: ReadonlySet<string> = new Set<string>([
  LINEAR_SYNC_PROGRAMME, ...PLAN_REFUSALS, ...EPIC_STATES, ...CHECKPOINT_KINDS, ...CHECKPOINT_STATES, ...TICKET_KINDS,
  ...TICKET_SOURCES, ...TICKET_STATES, ...PLAN_END_OUTCOMES, ...BINDING_KINDS, ...BINDING_STATES, ...MIGRATION_STATES,
  ...HIERARCHY_STATES, ...INBOUND_STATES, ...PHASE_REF_KINDS, ...PHASE_REF_OPS,
]);
export const isPlanKebab = (tok: string): boolean => PLAN_KEBAB.has(tok);

// ── Wire types ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PlanCheckpointBody {
  key: string; title: string; kind: CheckpointKind;
  /** The waves whose runs prove this checkpoint. */
  proves?: number[];
  /** Only on an `operator-act` checkpoint: the operator item whose `done` marks it met (design §4.1). */
  itemId?: number;
}
export interface PlanTicketBody {
  key: string; kind: TicketKind; title: string; body?: string; project?: string; checkpoint?: string;
}
export interface PlanEpicBody {
  key: string; title: string; summary: string; project?: string; waves: number[];
  checkpoints: PlanCheckpointBody[]; tickets?: PlanTicketBody[]; droppedWhy?: string;
}
/** One reference of a phase: a whole epic or one ticket, by its key (programme work map WM0, D14). */
export interface PlanPhaseRefBody { kind: PhaseRefKind; key: string }
/** A phase of the sequence: its key, title, one-line summary and the epics and tickets it takes on. A put's `refs` are
 *  ADDED to the stored references, never replace them (D18); `droppedWhy` drops a stored phase, keeping its references. */
export interface PlanPhaseBody { key: string; title: string; summary: string; refs: PlanPhaseRefBody[]; droppedWhy?: string }
/** `home` is the programme's home project, required when the programme has no row yet and refused `plan-bad-body` when
 *  it differs from a stored one; `title` names a new programme (default: from its slug). An absent `phases` leaves the
 *  stored phases as they are (D18). */
export interface PlanPutBody { home?: string; title?: string; phases?: PlanPhaseBody[]; epics: PlanEpicBody[] }
/** `plan phase-ref`'s body: add or remove one reference of a phase, or carry a ticket from one phase to a later one (D17).
 *  The caller's identity rides the query, never the body. */
export type PlanPhaseRefMoveBody =
  | { op: 'add' | 'remove'; phase: string; ref: PlanPhaseRefBody }
  | { op: 'carry'; from: string; to: string; ticket: string };
/** `why` is required for `abandoned`. */
export interface PlanCloseBody { outcome: PlanEndOutcome; why?: string }

export type CheckpointEvidence = { pr: number } | { itemId: number } | { path: string };
type SyncWord = BindingState | 'none' | 'unsynced';

export interface CheckpointView {
  key: string; title: string; kind: CheckpointKind; state: CheckpointState; proves: number[]; metAt: number | null;
  evidence: CheckpointEvidence | null; url: string | null; sync: SyncWord; syncWord: string | null;
}
export interface TicketView {
  key: string; kind: TicketKind; title: string; project: string; checkpoint: string | null; source: TicketSource;
  state: TicketState; runId: number | null; identifier: string | null; url: string | null; sync: SyncWord;
  syncWord: string | null;
}
export interface EpicView {
  key: string; title: string; summary: string; project: string; waves: number[]; state: EpicState; url: string | null;
  sync: SyncWord;
  /** A `failed` binding's word, so `plan show` names why. */
  syncWord: string | null;
  checkpoints: CheckpointView[]; tickets: TicketView[];
}
/** A stored reference; `carriedTo` is the key of the phase a recorded carry took this ticket to, with its time. */
export interface PhaseRefView extends PlanPhaseRefBody { carriedTo: string | null; carriedAt: number | null }
/** A phase as the plan read says it. `number` is its 1-based place among the phases not dropped, null for a dropped one,
 *  derived once (`planPolicy.ts#phaseNumbers`, review 2268 F6); with the title, what the hierarchy's sync names a phase's
 *  Linear label from (R131). A phase stores no state: its progress is the work map's. */
export interface PhaseView {
  key: string; number: number | null; title: string; summary: string; dropped: boolean; refs: PhaseRefView[];
}
export interface PlanView {
  program: string; planned: boolean;
  initiatives: { workspaceId: string; url: string | null; state: BindingState | 'off' | 'none' }[];
  epics: EpicView[];
  doneWhen: { text: string; proved: boolean }[];
  /** The phases in order; absent when the programme declares none, so a plan with no phases reads as it did before WM0.
   *  Optional on the wire (review 2268 F6); its reader is `ccrc-api plan show`. */
  phases?: PhaseView[];
}
export interface HierarchyProjectRow {
  project: string; teamKey: string | null; initiatives: 'on' | 'off'; linearOwner: string | null;
  ownerNow: { id: string | null; source: 'named' | 'default' | 'none'; live: boolean };
  ownsTeam: boolean; state: HierarchyState; stateAt: number | null; itemId: number | null; inboundWaiting: number;
}
export interface HierarchyAnswer {
  ok: true; projects: HierarchyProjectRow[]; coordinators: { id: string; live: boolean }[];
}
// D-8737: the map's shapes, early from the plan's Task 7.1 text, so the console's body types over them; wave 7 imports them.
export const MAP_CLASSES = ['programme', 'epic', 'checkpoint', 'leaf', 'upkeep', 'finished', 'superseded', 'stale', 'unclear'] as const;
export type MapClass = (typeof MAP_CLASSES)[number];
export interface MapEntry {
  /** A Linear UUID. */
  issue: string;
  identifier: string;
  class: MapClass;
  target?: { programme?: string; epic?: string; checkpoint?: string; successor?: string; ticketKey?: string; kind?: TicketKind };
}
export interface MapCounts { created: number; moved: number; closed: number; left: number; skipped: number }
