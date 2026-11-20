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
export const INBOUND_STATES = ['waiting', 'mailed', 'handed', 'taken', 'placed', 'closed', 'raised', 'retired'] as const;
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
 *  2268 F20 and 2375 F11). `unknown-ref` and `bad-carry` are the phase words (programme work map WM0, D-8715);
 *  `evidence-unverified` is `plan ticket-done`'s (WM1, D-8727), which reuses `plan-runs-open` and `plan-bad-body` for a held
 *  ticket and one not open, so no `ticket-not-open` is added (review 2268 F21). */
export const PLAN_REFUSALS = [
  'not-plan-owner', 'not-linear-owner', 'plan-too-large', 'plan-bad-body', 'waves-not-contiguous', 'wave-overlap',
  'dropped-needs-reason', 'unknown-epic', 'unknown-checkpoint', 'unknown-ticket', 'ticket-workspace-mismatch',
  'linear-text-public', 'plan-owned', 'map-rewrites-plan', 'map-incomplete', 'migration-in-flight', 'not-managed',
  'issue-not-inbound', 'item-act-mismatch', 'plan-closed', 'plan-runs-open', 'unknown-ref', 'bad-carry', 'evidence-unverified',
] as const;
export type PlanRefusal = (typeof PLAN_REFUSALS)[number];

/** The kebab words of this vocabulary, for the mail-routes census (`mail-routes.test.ts`): a quoted kebab word in
 *  `server/src/coord` is a declared code or passes an exported guard, and this is the guard for the plan's. */
/** Built on first use, because the work map's lists (programme work map WM2, D-8779) are declared further down, beside the
 *  view they type. */
let planKebab: ReadonlySet<string> | null = null;
export const isPlanKebab = (tok: string): boolean => (planKebab ??= new Set<string>([
  LINEAR_SYNC_PROGRAMME, ...PLAN_REFUSALS, ...EPIC_STATES, ...CHECKPOINT_KINDS, ...CHECKPOINT_STATES, ...TICKET_KINDS,
  ...TICKET_SOURCES, ...TICKET_STATES, ...PLAN_END_OUTCOMES, ...BINDING_KINDS, ...BINDING_STATES, ...MIGRATION_STATES,
  ...HIERARCHY_STATES, ...INBOUND_STATES, ...PHASE_REF_KINDS, ...PHASE_REF_OPS,
  ...WORK_STATUSES, ...WORK_GROUPS, ...WORK_SOURCES, ...WORK_VERDICT_READS, WORK_READ_FAILED, ...MAP_CLASSES,
])).has(tok);

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
/** `waves` is optional (programme work map WM6, D-8780; spec Q5): `[]` is an epic with no wave range, and an absent field
 *  keeps a stored epic's range (a new epic lists none). Read it through `listedWaves` (`server/src/coord/planPolicy.ts`). */
export interface PlanEpicBody {
  key: string; title: string; summary: string; project?: string; waves?: number[];
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
/** A ticket's done evidence (programme work map WM1, D-8727; spec §4.1 D11): the work run that finished it, or a pull
 *  request the landing line holds `landed` for the ticket's own project. Stored as JSON in `plan_tickets.doneEvidence`
 *  beside `doneAt`, written by `planStore.ts` alone. */
export type TicketDoneEvidence = { runId: number } | { pr: number };
/** `plan ticket-done`'s body: the ticket and exactly one piece of evidence. The caller's identity rides the query. */
export interface PlanTicketDoneBody { ticket: string; evidence: TicketDoneEvidence }
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

// ── The work map (programme work map WM2, D-8779; spec 2026-11-16 §3.1, §4, §5.1 and §7, D2, D3, D4, D19 and D20) ──────
// One decider, `server/src/coord/workMap.ts#workMapOf`, makes the view; the plan read serves it as `work` beside `plan`.

/** A ticket's status (spec Table 6's fourteen rows, in order, first match), then `failed`, the no-plan fallback's alone
 *  (review 2268 F22). `closed`: the hierarchy's close with a reason (F10); `left-open`: a ticket of an ended plan that is not
 *  done (F4), one marked done whose evidence does not verify included (review 2382 L3-F1). */
export const WORK_STATUSES = ['dropped', 'closed', 'done', 'done-unverified', 'left-open', 'waiting-on-you', 'stuck',
  'blocked', 'working', 'state-unknown', 'in-review', 'merging', 'queued', 'not-started', 'failed'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
/** Who acts on a status. `closed` and `left-open` count apart, in no "N of M" and no outstanding count (F4); `held` is the
 *  machine's or the coordinator's, `waiting-on-you` the operator's alone (F25). */
export const WORK_GROUPS = ['done', 'in-progress', 'waiting-on-you', 'held', 'not-started', 'dropped', 'closed',
  'left-open', 'failed'] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
/** Where the map comes from (spec §5.1, D19): `ended` when the plan has an end; `plan` with a ticket to count;
 *  `declared-empty` when `plan put` ran with nothing to count; `runs` (no plan) otherwise. */
export const WORK_SOURCES = ['plan', 'declared-empty', 'ended', 'runs'] as const;
export type WorkSource = (typeof WORK_SOURCES)[number];
/** The run verdicts reader's state on the map: `not-read` skips the stuck and blocked rows (Table 6 rows 7 and 8). */
export const WORK_VERDICT_READS = ['read', 'not-read'] as const;
/** The work map's own word for a read behind `work` that throws. */
export const WORK_READ_FAILED = 'read-failed';
/** Why `work` could not be read: the store's run read-failure word (`run-unreadable`, its own family's, which the plan's
 *  words do not admit), or `read-failed`. */
export type WorkUnreadable = 'run-unreadable' | typeof WORK_READ_FAILED;
/** One ticket (or, in the no-plan fallback, one work run) on the map. */
export interface WorkItemView {
  key: string;
  /** A ticket's title. Null only on a no-plan run row whose run title is missing or repeats the programme's title, which the
   *  card draws as "Wave N". */
  title: string | null;
  status: WorkStatus; group: WorkGroup;
  /** done-unverified: why the evidence does not hold; closed: its reason; null otherwise. */
  reason: string | null;
  /** The work axis: the ticket's epic (null on a run row). */
  epic: { key: string; title: string } | null;
  /** The sequence axis, in phase order: each phase not dropped whose work holds this ticket, every number from
   *  `planPolicy.ts#phaseNumbers` (F6). `carriedFrom` lists each phase whose recorded carry names this one, in phase order
   *  (F14); a carry from a source dropped since stands, and its number is null (review 2375 F10). */
  phases: { key: string; number: number; carriedTo: { key: string; number: number } | null;
    carriedFrom: { key: string; number: number | null }[] }[];
  runId: number | null;
  /** The run's last move (`RunSummary.lastMoveAt`): null for no run or a run with no move; ABSENT when it could not be read,
   *  so unmeasured never reads as quiet (review 2795 F3). */
  lastMoveAt?: number | null;
  wave: number | null;
  doneAt: number | null;
  /** The open operator items that make it waiting-on-you. */
  itemIds: number[];
  /** The newest failed run that held a ticket now back at not-started. */
  lastFailedRunId: number | null;
}
export type PhaseFinish = null | { at: number } | { at: 'unknown' };
export interface WorkPhaseView {
  /** `number` from `phaseNumbers` (F6); a dropped phase is not listed. */
  key: string; number: number; title: string; summary: string;
  /** Null while not finished, and always for an empty phase (F14). */
  finish: PhaseFinish;
  /** Its own work by group (referenced, less dropped and carried out); closed and left-open apart. */
  counts: Record<WorkGroup, number>;
  /** Carried out of this phase. */
  carried: number;
  /** The epics this phase takes on whole. */
  wholeEpics: string[];
  /** Ticket keys, plan order: its own work, its closed and left-open tickets, and the ones carried out of it. */
  items: string[];
}
export interface WorkEpicView {
  key: string; title: string;
  /** `done` of `total`, where `total` counts what the headline's "N of M" counts, so the strip adds up to it (F3). */
  done: number; total: number; url: string | null;
  /** A dropped epic is listed only while it holds a ticket that is not dropped, its done ones (F3). */
  dropped: boolean;
  /** Dropped checkpoints are in neither (F23), nor listed. */
  checkpointsMet: number; checkpointsTotal: number;
  checkpoints: { key: string; title: string; kind: CheckpointKind; state: CheckpointState; metAt: number | null;
    evidence: CheckpointEvidence | null; url: string | null }[];
  items: string[];
}
export interface WorkMapView {
  source: WorkSource;
  end: { outcome: PlanEndOutcome; why: string | null; at: number } | null;
  verdicts: (typeof WORK_VERDICT_READS)[number];
  /** Each ticket once (each run once in the fallback). */
  counts: Record<WorkGroup, number>;
  items: WorkItemView[];
  /** The sequence axis; [] when none is declared. */
  phases: WorkPhaseView[];
  /** Tickets no phase holds, plan order; [] when the plan declares no phase. */
  notInPhase: string[];
  /** The work axis and the strip. */
  epics: WorkEpicView[];
  /** One per workspace, as `PlanView` carries them (F7). */
  initiatives: { workspaceId: string; url: string | null; state: BindingState | 'off' | 'none' }[];
  doneWhen: { text: string; proved: boolean }[];
  /** A planned programme's work runs with no ticket (D12); null when none, and on the no-plan fallback. */
  beforePlan: { runs: number } | null;
  /** The no-plan fallback: its work runs, newest first, and the waves they span (null with no run). */
  runs: { items: WorkItemView[]; waves: { from: number; to: number } | null } | null;
}
/** The plan read's `work` field: the map, or why the reads behind it failed (D19). Absent means an older server. */
export type WorkAnswer = WorkMapView | { unreadable: WorkUnreadable };
export interface HierarchyProjectRow {
  project: string; teamKey: string | null; initiatives: 'on' | 'off'; linearOwner: string | null;
  ownerNow: { id: string | null; source: 'named' | 'default' | 'none'; live: boolean; project?: string; ifUnnamed?: { id: string | null; live: boolean } };
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
/** An open issue as the map's draft read it (design §10.3): its state TYPE, its team KEY, the ids of its project, parent
 *  and milestone, and its title and description. Linear text: read only under `untrusted`. */
export interface IssueSnapshot {
  state: string; team: string; project: string | null; parent: string | null; milestone: string | null; title: string; description: string;
}
/** A team's migration map (D-8186, Task 7.1): every open issue of `team` once in `entries`; `backlog` the new paused
 *  programmes it proposes, `epics` the structure it declares for a done programme that has no plan and no live run (§10.1);
 *  `snapshot` each listed issue as read when the map was stored, by its UUID (the server fills it, never the owner). */
export interface MapBody {
  team: string;
  backlog?: { slug: string; title: string; epics: PlanEpicBody[] }[];
  epics?: { programme: string; epics: PlanEpicBody[] }[];
  entries: MapEntry[];
  snapshot: Record<string, IssueSnapshot>;
}
/** One programme's epics and checkpoints as a map item shows them (§11.3; D-8737's handover): those the map declares, and for a
 *  programme it places issues into, those its plan holds. `backlog` marks a programme the map proposes (created `paused`). */
export interface MigrationStructure {
  programme: string; title: string | null; backlog: boolean; declared: boolean;
  epics: { key: string; title: string; checkpoints: { key: string; title: string }[] }[];
}
/** `GET /api/migrations/:id` (D-8186): a migration's map or report, for its item's body. `counts` are the map's before the apply
 *  and the report's after it; `report` lists what the move rows do not (skipped as changed, waiting, and after put back the issues
 *  moved since and the milestones left under their canceled project). Every title and identifier is Linear text or plan text. */
export interface MigrationView {
  ok: true; id: number; team: string; state: MigrationState; counts: MapCounts; entries: MapEntry[]; structure: MigrationStructure[];
  report: { skipped: string[]; waiting: string[]; movedSince: string[]; milestonesLeft: string[] } | null;
}
