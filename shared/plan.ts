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
/** A project's place in the per-team migration, as its row in the console says it. */
export const HIERARCHY_STATES = ['not-migrated', 'map-waiting', 'migrating', 'migrated', 'put-back'] as const;
export type HierarchyState = (typeof HIERARCHY_STATES)[number];

/** The bounds a plan body is held to. */
export const PLAN_BOUNDS = {
  epics: 24, checkpointsPerEpic: 16, ticketsPerBody: 200, titleChars: 255, summaryChars: 500, bodyBytes: 65_536, reasonChars: 500,
} as const;

/** The reserved programme row the sync's own work runs under, and the epic every programme keeps for upkeep. */
export const LINEAR_SYNC_PROGRAMME = 'linear-sync';
export const UPKEEP_EPIC_KEY = 'upkeep';
export const UPKEEP_EPIC_TITLE = 'Upkeep';

/** A plan key (an epic, checkpoint or ticket key) has the programme slug grammar. */
export const isPlanKey = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  const shaped = shapeProgramSlug(v);
  return shaped.ok && shaped.slug === v;
};

/** Every refusal word of the plan verbs and the hierarchy routes. Each has its status in `REFUSAL_STATUS`
 *  (`shared/refusal.ts`) and a fixed sentence in the console (`pwa/src/lib/refusalWords.ts`). */
export const PLAN_REFUSALS = [
  'not-plan-owner', 'not-linear-owner', 'plan-too-large', 'plan-bad-body', 'waves-not-contiguous', 'wave-overlap',
  'dropped-needs-reason', 'unknown-epic', 'unknown-checkpoint', 'unknown-ticket', 'ticket-workspace-mismatch',
  'linear-text-public', 'plan-owned', 'map-rewrites-plan', 'map-incomplete', 'migration-in-flight', 'not-managed',
  'issue-not-inbound', 'item-act-mismatch', 'plan-closed', 'plan-runs-open',
] as const;
export type PlanRefusal = (typeof PLAN_REFUSALS)[number];

/** The kebab words of this vocabulary, for the mail-routes census (`mail-routes.test.ts`): a quoted kebab word in
 *  `server/src/coord` is a declared code or passes an exported guard, and this is the guard for the plan's. */
const PLAN_KEBAB: ReadonlySet<string> = new Set<string>([
  LINEAR_SYNC_PROGRAMME, ...PLAN_REFUSALS, ...EPIC_STATES, ...CHECKPOINT_KINDS, ...CHECKPOINT_STATES, ...TICKET_KINDS,
  ...TICKET_SOURCES, ...TICKET_STATES, ...PLAN_END_OUTCOMES, ...BINDING_KINDS, ...BINDING_STATES, ...MIGRATION_STATES,
  ...HIERARCHY_STATES,
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
/** `home` is the programme's home project, required when the programme has no row yet and refused `plan-bad-body` when
 *  it differs from a stored one; `title` names a new programme (default: from its slug). */
export interface PlanPutBody { home?: string; title?: string; epics: PlanEpicBody[] }
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
export interface PlanView {
  program: string; planned: boolean;
  initiatives: { workspaceId: string; url: string | null; state: BindingState | 'off' | 'none' }[];
  epics: EpicView[];
  doneWhen: { text: string; proved: boolean }[];
}
export interface HierarchyProjectRow {
  project: string; teamKey: string | null; initiatives: 'on' | 'off'; linearOwner: string | null;
  ownerNow: { id: string | null; source: 'named' | 'default' | 'none'; live: boolean };
  ownsTeam: boolean; state: HierarchyState; stateAt: number | null; itemId: number | null; inboundWaiting: number;
}
export interface HierarchyAnswer {
  ok: true; projects: HierarchyProjectRow[]; coordinators: { id: string; live: boolean }[];
}
