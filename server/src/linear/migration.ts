/**
 * THE PER-TEAM MIGRATION (Linear hierarchy design 2026-11-10 §10, wave 7, D-8186; D-8795, D-8796). L4 delivery: it reads Linear
 * and the stores, asks `migrationPolicy.ts` (L1) every question, and writes through the plan store's port, never `coord.db`.
 *
 *   start      the operator's "Reshape in Linear" on a project row: a `proposing` row for the project's team, one team at a time.
 *   propose    the team's Linear owner sends the map (`plan map-propose`): read the team's open issues OUTSIDE the mutex
 *              (`readOpen`), then check and store the map and raise the `decide` item INSIDE it (`storeProposal`).
 *   act        the operator's Approve and Return on the map item, Put back and Done on the report item (inside the mutex).
 *   tick       the migration lane (30 s): owner and coordinator mails for a `proposing` row; apply an `approved` or `applying`
 *              row; run a put back the operator asked for.
 *
 * HOW IT WRITES (D-8796). Every write to an issue the plan adopts, and every object the map's structure creates, goes through the
 * plan sync's own passes (one writer per Linear object, D-8179): the migration writes the move row first, in the same
 * transaction that adopts the issue (`adoptIssueAsTicketInTx`, the adopted fingerprint, so the next pass sends one absolute
 * update) or inserts the structure (`declareMapStructure`); its `after.expect` is the sync's own planned owned fields
 * (`PlanSync#plannedOwnedNow`, read in that transaction). The issues it closes (a replaced level, finished, superseded, stale)
 * are not adopted, and it writes them itself (`runCcrcOp`, lane and pass `migration`), each move row before its write. A move
 * row with no `appliedAt` is settled on a later tick by `reconcileMove` against a fresh read. Nothing is ever deleted.
 */
import { ACTIVE_RUN_STATES, type RunState } from '../../../shared/api.js';
import {
  LINEAR_SYNC_PROGRAMME, UPKEEP_DUE_PREFIX, type IssueSnapshot, type MapBody, type MapEntry, type MigrationStructure, type MigrationView,
  type MigrationWaitingWhy, type PlanEpicBody,
} from '../../../shared/plan.js';
import type { CoordinatorPresence } from '../../../shared/ledgers.js';
import type { CoordStore } from '../coord/store.js';
import type { MigrationRow, MoveRowStored, PlanStorePort } from '../coord/planStore.js';
import { EMPTY_MIGRATION_REPORT, IssueHeldError, MIGRATION_PLAN_BY } from '../coord/planStore.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import { tx } from '../coord/tx.js';
import { diffPlan, linearOwnerOfTeam, teamOwnerProject } from '../coord/planPolicy.js';
import { runCcrcOp, type CcrcOpAsk, type CcrcOpOutcome } from './ccrcCall.js';
import type { LinearJournal } from './journal.js';
import type { LinearWritePolicy } from './policy.js';
import type { LinearRateService } from './rate.js';
import type { LinearDirectoryRead } from './directory.js';
import { withCcrcProvenance } from './hierarchyOps.js';
import { ownerItemInput } from './inboundPolicy.js';
import { linearEgressText, statusOfType } from './ops.js';
import { PLAN_SYNC_CALL_TIMEOUT_MS, slotsOf, type PlanSync, type SlotInfo } from './planSync.js';
import { routableSlots, routeProjectTeam, type LinearRouteSlot } from './route.js';
import { egress, uuidOf } from './planSyncPolicy.js';
import type { LinearStoreRead } from './store.js';
import {
  applySteps, checkMap, closerRelation, countsOfMap, declareMail, expectOfOwned, finishedComment, hierarchyStateOf, mapItemInput, migrationSettled, parseMapProposal,
  programmeOfEntry, proposeMail, putBackSteps, putBackVerdict, reconcileMove, replacementComment, reportCounts,
  reportItemInput, returnMail, shedTaken, startVerdict, ticketKeyOf, ticketKindOf,
  snapshotHolds, mapProposerVerdict, migrationOfProject, projectOnTeam, type CloserRelation, type IssueAfter, type IssueSnapshotRow, type MapContext, type MoveRow, type PlanFacts,
} from './migrationPolicy.js';

/** How long one apply tick lets a key's pass run when it waits for it (the sync's own budget is its own). */
export const MIGRATION_PASS_BUDGET_MS = 20_000;
/** D-8796 (condition 1, spec §10.6): the issue writes one apply tick starts (an adoption's pass, a close, a redo). Lane `migration`
 *  holds 100 calls an hour and the lane ticks every 30 s (120 ticks an hour). An adoption costs its read and one update, and a
 *  close up to four calls (read, comment, relation, state), so under `MIGRATION_CALLS_PER_TICK` two closes never share a tick:
 *  closes go one a tick, an adoption beside one (review 2918 A1). An adopted issue's row settles on a later tick's read, so the
 *  pilot's ~220 issues take about two to four hours. The cap counts the issue writes only: step 1's structure pass and the
 *  Upkeep epic's pass run before it is spent (review 2955 F3). */
export const MIGRATION_WRITES_PER_TICK = 2;
/** Review 2892 A7, narrowed by the coordinator's ruling on review 2918 F3: the migration's own issue reads and writes of a tick
 *  count here (a read, a comment, a relation, a state write, and one for the update an adoption's pass sends). A step starts only
 *  when the calls it may need are left: an adoption two, a close up to four, so an adoption and a close fit one tick. Two passes
 *  of the plan sync's own are counted neither here nor by `MIGRATION_WRITES_PER_TICK`: step 1's structure pass (only until the
 *  plan's objects exist), on lane `migration` for the objects the map declares, and the Upkeep epic's pass, whose create has no
 *  move row and so goes out on lane `sync` as the plan sync's own. Each is bounded by its lane, the pass deadline
 *  (`MIGRATION_PASS_BUDGET_MS`) and the one rate service (D-8796, as review 2955 F3 corrected it). */
export const MIGRATION_CALLS_PER_TICK = 6;
const ADOPT_CALLS = 2;
const CLOSE_CALLS = 4;
/** The moved issues put back a tick: each costs a read and a write on lane `migration` (spec §10.6). */
export const PUT_BACK_ISSUES_PER_TICK = 2;
/** The page cap of the team's open-issue read: a team past it is read again on the next tick (the pilot holds about 220). */
export const MIGRATION_OPEN_PAGES = 20;

export interface LinearMigrationDeps {
  coord: CoordStore;
  plan: PlanStorePort;
  planSync: Pick<PlanSync, 'withFlight' | 'passFor' | 'plannedOwnedNow' | 'keyBlockedUntil'>;
  readLinearStore: () => Promise<LinearStoreRead>;
  call: (ask: CcrcOpAsk) => Promise<CcrcOpOutcome>;
  directory: LinearDirectoryRead;
  presenceOf: (id: string) => CoordinatorPresence;
  /** The mask applied to every Linear text ccrc stores in a ticket (the plan routes' and the inbound path's, `linearEgressText`).
   *  Absent: that one. */
  mask?: (text: string) => string;
  /** The installer's private tracker keys, for the public-text check of a finished close's comment (review 2892 F7). Absent: none. */
  privateTrackerKeys?: readonly string[];
  now: () => number;
}

type Refusal = { ok: false; word: string; detail: string };
/** `slots`: the routable slots of the read that served it, for the programme matches of `checkMap` (D-8808). */
export type OpenRead = { ok: true; workspaceId: string; rows: IssueSnapshotRow[]; slots: LinearRouteSlot[] | null } | Refusal;
/** Where a project's team resolves (D-8808): its workspace, or the refusal start answers. */
export type ProjectWorkspace = { ok: true; workspaceId: string } | Refusal;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** An issue node of the hierarchy reads (`issueRecord`) as a snapshot row; null for a node that lacks a field. */
function rowOf(n: unknown): IssueSnapshotRow | null {
  if (!isObj(n)) return null;
  const { id, identifier, title, description, teamKey, stateType, projectId, milestoneId, parentId } = n;
  if (typeof id !== 'string' || typeof identifier !== 'string' || typeof title !== 'string' || typeof teamKey !== 'string' || typeof stateType !== 'string') return null;
  const idOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    linearId: id, identifier, title, description: typeof description === 'string' ? description : '', team: teamKey.toUpperCase(),
    state: stateType, project: idOrNull(projectId), milestone: idOrNull(milestoneId), parent: idOrNull(parentId),
  };
}
const snapshotOf = (r: IssueSnapshotRow): IssueSnapshot => ({
  state: r.state, team: r.team, project: r.project, parent: r.parent, milestone: r.milestone, title: r.title, description: r.description,
});
const asMoveRow = (m: MoveRowStored): MoveRow => m;
const CLOSERS: ReadonlySet<MapEntry['class']> = new Set(['programme', 'epic', 'checkpoint', 'finished', 'superseded', 'stale']);
/** The closers that stood for a level of the new shape: each is related to the first ticket placed under it (§10.4). */
const REPLACED: ReadonlySet<MapEntry['class']> = new Set(['programme', 'epic', 'checkpoint']);
/** A tick's budget (review 2892 A7): the issue writes it may start, the Linear calls it may make, and whether a rate refusal ended
 *  it (the lane then rests until Linear's retry time). */
interface TickBudget { writes: number; calls: number; stopped: boolean }
const freshBudget = (): TickBudget => ({ writes: MIGRATION_WRITES_PER_TICK, calls: MIGRATION_CALLS_PER_TICK, stopped: false });
/** A stored follow-up map (review 2892 A2, F4): the follow-up's own entries, with the map it joins kept beside it as `prior` until
 *  Approve merges the two; Return puts `prior` back. */
type StoredMap = MapBody & { prior?: MapBody };

const withoutPrior = (m: StoredMap): MapBody => { const { prior: _prior, ...rest } = m; return rest; };
/** A follow-up map joined to the stored one: its entries replace those of the same issues, its snapshots theirs, and its
 *  declared structure is added. */
function mergeFollowUp(was: MapBody, next: MapBody): MapBody {
  const ids = new Set(next.entries.map((e) => e.issue));
  return {
    ...was,
    entries: [...was.entries.filter((e) => !ids.has(e.issue)), ...next.entries],
    snapshot: { ...was.snapshot, ...next.snapshot },
    ...(next.backlog === undefined && was.backlog === undefined ? {} : { backlog: [...(was.backlog ?? []), ...(next.backlog ?? [])] }),
    ...(next.epics === undefined && was.epics === undefined ? {} : { epics: [...(was.epics ?? []), ...(next.epics ?? [])] }),
  };
}

/** The `planBy` of the plan rows a map declares: the store's one constant (it writes `planBy`), named here for the migration's readers. */
export { MIGRATION_PLAN_BY };

export class LinearMigration {
  private running = false;
  /** Until when the migration lane rests after Linear's rate refusal (in this process; a restart costs one refused call). */
  private restUntil = 0;
  constructor(private readonly deps: LinearMigrationDeps) {}

  // ── Reads shared by the doors and the tick ──

  /** Programmes with a non-terminal run (`live`, Task 7.1) and with one in `ACTIVE_RUN_STATES` (`active`, the wave boundary
   *  Task 7.3 waits for). Null: the runs could not be read, and nothing is decided on them. */
  private runFacts(): { live: Set<string>; active: Set<string> } | null {
    const read = this.deps.coord.runs();
    if (!read.ok) return null;
    const active = new Set<string>(ACTIVE_RUN_STATES as readonly RunState[]);
    return { live: new Set(read.runs.map((r) => r.program)), active: new Set(read.runs.filter((r) => active.has(r.state)).map((r) => r.program)) };
  }
  private planFacts(live: ReadonlySet<string>): (slug: string) => PlanFacts {
    const programs = new Set(this.deps.coord.programs().map((p) => p.slug));
    return (slug) => {
      if (!programs.has(slug)) return { declared: false, live: false, plan: null };
      const plan = this.deps.plan.planOf(slug);
      return { declared: plan.planBy !== null, live: live.has(slug), plan };
    };
  }
  /** The Linear owner of a team in one workspace (D-8808: a key two workspaces hold has one owner project each). */
  private ownerOf(team: string, workspaceId: string): { id: string | null; live: boolean; project: string } | null {
    const { plan, presenceOf } = this.deps;
    const o = linearOwnerOfTeam(team, plan.hierarchyProjectsOf(), { latestProgrammeCoordinator: (p) => plan.latestProgrammeCoordinator(p), presence: presenceOf }, workspaceId);
    return o === null ? null : { id: o.id, live: o.live, project: o.project };
  }
  /** The store read once: its routable slots when listed, else null (unreadable, absent: nothing is routed). */
  private async routable(): Promise<{ store: LinearStoreRead; slots: LinearRouteSlot[] | null }> {
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    return { store, slots: store.kind === 'listed' ? routableSlots(store) : null };
  }

  /** The team's open issues, every page up to `MIGRATION_OPEN_PAGES` (lane `migration`). */
  private async readOpenIn(workspaceId: string, slot: SlotInfo, team: string, slots: LinearRouteSlot[] | null): Promise<OpenRead> {
    const rows: IssueSnapshotRow[] = [];
    let after: string | null = null;
    for (let page = 0; page < MIGRATION_OPEN_PAGES; page += 1) {
      const out = await this.deps.call({
        op: 'teamOpenIssues', pass: 'migration', lane: 'migration', slot: slot.ref, workspaceId, teamKey: team, target: null, fields: [], input: { team, after },
      });
      if (!out.ok) return { ok: false, word: 'unreachable', detail: `the open issues of team ${team} could not be read (${out.word})` };
      const nodes = Array.isArray(out.value['nodes']) ? out.value['nodes'] : [];
      for (const n of nodes) { const r = rowOf(n); if (r !== null) rows.push(r); }
      const next = out.value['next'];
      if (typeof next !== 'string') return { ok: true, workspaceId, rows, slots };
      after = next;
    }
    return { ok: false, word: 'unreachable', detail: `team ${team} has more open issues than ${MIGRATION_OPEN_PAGES} pages` };
  }

  // ── Start (Task 7.2) ──

  /** The operator's "Reshape in Linear" (inside the mutex; `where` read before it by `workspaceOfProject`). */
  start(project: string, where: ProjectWorkspace): { ok: true; migrationId: number } | Refusal {
    const { plan, coord } = this.deps;
    const team = coord.linkingOf(project).teamKey?.toUpperCase() ?? null;
    if (!where.ok) return where;
    const v = startVerdict(plan.migrationsOf(), team, where.workspaceId);
    if (!v.ok) return v;
    const owning = teamOwnerProject(team!, plan.hierarchyProjectsOf(), where.workspaceId) ?? project;
    return { ok: true, migrationId: plan.insertMigration({ workspaceId: where.workspaceId, teamKey: team!, project: owning, now: this.deps.now() }) };
  }
  /** Where a project's team resolves (D-8808): through `routeProjectTeam` with the row's own workspace, never the first workspace
   *  holding the key. A key two workspaces hold with none on the row is `team-ambiguous`. */
  async workspaceOfProject(project: string): Promise<ProjectWorkspace> {
    const linking = this.deps.coord.linkingOf(project);
    const team = linking.teamKey;
    const unreachable = (t: string | null): ProjectWorkspace => ({ ok: false, word: 'unreachable', detail: `no Linear key serves team ${t}` });
    if (team === null) return { ok: false, word: 'no-team-key', detail: 'the project has no Linear team key' };
    const { slots } = await this.routable();
    if (slots === null) return unreachable(team);
    const route = routeProjectTeam(slots, { teamKey: team, workspaceId: linking.teamWorkspace ?? null });
    if (route.kind === 'slot') return { ok: true, workspaceId: route.slot.workspaceId };
    if (route.word === 'team-ambiguous') {
      const names = route.candidates.length === 0 ? '' : ` (${route.candidates.join(', ')})`;
      return { ok: false, word: 'team-ambiguous', detail: `team ${team.toUpperCase()} is in more than one Linear workspace${names}; pick the project's workspace on its row first` };
    }
    return unreachable(team);
  }

  // ── Propose (Task 7.2) ──

  /** Whether a migration waits for a map: `proposing`, or `applied` with skipped issues, its report open and no put back asked (a
   *  follow-up). The one predicate of `waitingRow` and `waitingWorkspaces`. */
  private waits(m: MigrationRow, team: string): boolean {
    return m.teamKey.toUpperCase() === team.toUpperCase()
      && (m.state === 'proposing' || (m.state === 'applied' && m.reportDoneAt === null && m.putBackAskedAt === null && (m.report?.skipped.length ?? 0) > 0));
  }
  /** The migration of a team in one workspace that waits for a map. Null: none. */
  private waitingRow(team: string, workspaceId: string): MigrationRow | null {
    return this.deps.plan.migrationsOf().find((m) => m.workspaceId === workspaceId && this.waits(m, team)) ?? null;
  }
  /** D-8808: the distinct workspaces with a migration of the team waiting for a map, any workspace. `plan map-propose` asks it
   *  before its Linear read, so a call with nothing to propose spends no read (the wave's review). */
  waitingWorkspaces(team: string): string[] {
    return [...new Set(this.deps.plan.migrationsOf().filter((m) => this.waits(m, team)).map((m) => m.workspaceId))];
  }

  /** Outside the mutex: the team's open issues in the migration's workspace, for `storeProposal`. */
  async readOpen(team: string, workspaceId: string): Promise<OpenRead> {
    const { store, slots } = await this.routable();
    const slot = slotsOf(store).get(workspaceId);
    if (slot === undefined || !slot.teams.some((t) => t.key.toUpperCase() === team.toUpperCase())) return { ok: false, word: 'unreachable', detail: `no Linear key serves team ${team}` };
    return this.readOpenIn(workspaceId, slot, team, slots);
  }

  /** Inside the mutex: the Linear owner's map, checked (`checkMap`) and stored with its snapshots, and its `decide` item raised.
   *  A follow-up map (the row `applied`, its report open) covers only the issues the apply skipped. */
  storeProposal(team: string, caller: string, body: unknown, open: Extract<OpenRead, { ok: true }>): { ok: true; migrationId: number; counts: ReturnType<typeof reportCounts> } | Refusal {
    const { plan, coord } = this.deps;
    const now = this.deps.now();
    const row = this.waitingRow(team, open.workspaceId);
    const followUp = row?.state === 'applied' ? row.report?.skipped ?? [] : null;
    if (row === null) return { ok: false, word: 'plan-bad-body', detail: `no migration of team ${team} is waiting for a map` };
    const owner = this.ownerOf(team, open.workspaceId);
    if (owner === null || owner.id !== caller) return { ok: false, word: 'not-linear-owner', detail: `only the Linear owner of team ${team} proposes its map` };
    const parsed = parseMapProposal(body, team);
    if (!parsed.ok) return parsed;
    // An issue ccrc's sync already holds (a programme born in the new shape, §10.5) is no part of a map: one writer per Linear object.
    const held = new Set(plan.boundLinearIdsOf(open.workspaceId));
    const heldIssues = new Set(plan.bindingsInWorkspace(open.workspaceId).flatMap((b) => (b.localKind === 'ticket' ? [b.linearId, b.identifier].filter((x): x is string => x !== null) : [])));
    // A follow-up's issues are the ones the apply skipped. One this migration adopted and then set aside holds no live binding
    // (its binding is retired, review 2892 F5), so it is mappable again; one a live binding holds is not, on either path: the
    // owner took it through inbound, so it leaves the migration (review 2918 F1; review 2955 F2).
    const mappable = open.rows.filter((r) => !held.has(r.linearId));
    const rows = followUp === null ? mappable : mappable.filter((r) => followUp.includes(r.identifier));
    const runs = this.runFacts();
    if (runs === null) return { ok: false, word: 'unreachable', detail: 'the runs could not be read' };
    const project = row.project ?? owner.project;
    const ctx: MapContext = {
      home: project, teamOf: (p) => coord.linkingOf(p).teamKey,
      sameWorkspace: (p) => this.onTeam(p, team, open.workspaceId, open.slots),
      upkeepKeys: new Set(plan.upkeepPlanOf(project).epics.flatMap((e) => e.tickets.map((t) => t.key))), heldIssues,
    };
    const map: MapBody = { ...parsed.map, snapshot: Object.fromEntries(rows.map((r) => [r.linearId, snapshotOf(r)])) };
    const checked = checkMap(map, rows, this.planFacts(runs.live), ctx);
    if (!checked.ok) return checked;
    const from = followUp === null ? ['proposing' as const] : ['applied' as const];
    // A follow-up joins the stored map on Approve (§10.3: it belongs to the same migration, and the same Put back covers it): its
    // issues then replace their earlier entries. Until then it is stored on its own, the map it joins kept as `prior`, so its item
    // counts and lists its own entries (review 2892 A2), and its issues leave the report's skipped list, so the apply writes them.
    const stored: StoredMap = followUp === null || row.map === null ? map : { ...map, prior: row.map };
    // The stored follow-up report moves the held ones to `taken` (review 2955 F2).
    const shed = followUp === null ? null : shedTaken(row.report?.skipped ?? [], row.report?.taken ?? [], (i) => this.heldIdentifier(row, i));
    const report = followUp === null || shed === null ? undefined
      : { ...(row.report ?? EMPTY_MIGRATION_REPORT()), skipped: shed.skipped.filter((id) => !map.entries.some((e) => e.identifier === id)), ...(shed.taken.length === 0 ? {} : { taken: shed.taken }) };
    coord.raiseItemWithMail(mapItemInput(row.id, team, caller, checked.counts), now, 'ccrc', (itemId) => {
      if (!plan.setMigration(row.id, from, { state: 'proposed', map: stored, itemId, ...(report === undefined ? {} : { report }) }, now)) {
        throw new Error(`migration ${row.id} moved while its map was stored`);
      }
    });
    return { ok: true, migrationId: row.id, counts: checked.counts };
  }

  // ── The operator's acts (Tasks 7.2 and 7.4; inside the mutex) ──

  act(itemId: number, migrationId: number, act: 'approve' | 'return' | 'put-back' | 'done', note: string | null):
    { ok: true } | { ok: false; word: 'not-found' | 'not-open' | 'item-act-mismatch' | 'migration-in-flight'; detail: string } {
    const { plan, coord } = this.deps;
    const now = this.deps.now();
    const m = plan.migrationById(migrationId);
    if (m === null) return { ok: false, word: 'not-found', detail: `no migration ${migrationId}` };
    // The item's settle and the migration's own write in ONE transaction (`tx` does not nest, so the move is `moveItemWithMail`'s
    // and `write` runs inside it); a refused settle writes nothing.
    const settleWith = (note: string, write: () => void): boolean =>
      coord.moveItemWithMail(itemId, 'settle', 'ccrc', { note }, now, { programmeHasOpenRun: false }, write).ok;
    const notOpen = { ok: false, word: 'not-open', detail: 'the item is not open' } as const;
    switch (act) {
      case 'approve': {
        if (m.state !== 'proposed' || m.itemId !== itemId) return { ok: false, word: 'not-open', detail: `the migration is ${m.state}` };
        const map = m.map as StoredMap | null;
        const merged = map?.prior === undefined ? null : mergeFollowUp(map.prior, withoutPrior(map));
        // Review 2892 D-8799: the map item settles on Approve (the report item, raised when the apply is done, carries the result).
        const done = settleWith('Approved: ccrc applies the map, each live programme\'s part at its wave boundary, and raises the report when it is done.',
          () => { plan.setMigration(m.id, ['proposed'], merged === null ? { state: 'approved' } : { state: 'approved', map: merged }, now); });
        return done ? { ok: true } : notOpen;
      }
      case 'return': {
        if (m.state !== 'proposed' || m.itemId !== itemId) return { ok: false, word: 'not-open', detail: `the migration is ${m.state}` };
        const owner = this.ownerOf(m.teamKey, m.workspaceId);
        const back = m.appliedAt === null ? 'proposing' as const : 'applied' as const;
        const mail = returnMail(m.id, m.teamKey, note ?? '', now);
        // A returned follow-up's issues go back to the skipped list, and the map it would have joined comes back: no move row writes
        // them (a retired move row, an issue set aside, is not a move, review 2892 F4), and the owner proposes again.
        const map = m.map as StoredMap | null;
        const moved = new Set(plan.movesOf(m.id).filter((x) => !x.subject.includes(':skipped:')).map((x) => x.identifier));
        const unwritten = (map?.entries ?? []).filter((e) => !moved.has(e.identifier)).map((e) => e.identifier);
        const report = { ...(m.report ?? EMPTY_MIGRATION_REPORT()), skipped: [...new Set([...(m.report?.skipped ?? []), ...unwritten])] };
        const done = settleWith('Returned to the Linear owner with your note.', () => {
          plan.setMigration(m.id, ['proposed'], back === 'proposing' ? { state: back, map: null } : { state: back, map: map?.prior ?? m.map, report }, now);
          if (owner?.id != null) insertSystemMailTx(coord, null, { fromId: 'operator', toId: owner.id, runId: null, kind: 'question', subject: mail.subject, body: mail.body });
        });
        return done ? { ok: true } : notOpen;
      }
      case 'put-back': {
        if (m.reportItemId !== itemId) return { ok: false, word: 'item-act-mismatch', detail: 'not this migration\'s report' };
        const v = putBackVerdict(m, plan.migrationsOf());
        if (!v.ok) return v;
        if (m.putBackAskedAt === null) plan.setMigration(m.id, ['applied'], { putBackAskedAt: now }, now);
        return { ok: true };
      }
      case 'done': {
        if (m.reportItemId !== itemId) return { ok: false, word: 'item-act-mismatch', detail: 'not this migration\'s report' };
        if (m.state !== 'applied' && m.state !== 'put-back') return { ok: false, word: 'not-open', detail: `the migration is ${m.state}` };
        if (m.putBackAskedAt !== null && m.state === 'applied') return { ok: false, word: 'not-open', detail: 'put back is running' };
        const done = settleWith('Done.', () => { plan.setMigration(m.id, ['applied', 'put-back'], { reportDoneAt: now }, now); });
        return done ? { ok: true } : notOpen;
      }
    }
  }

  /** The console's read of one migration (`GET /api/migrations/:id`; D-8737's handover): the map's entries, its counts before the
   *  apply and the report's after it, each programme's epics and checkpoints (§11.3), and the report's lists. Null: no such row,
   *  or no map stored yet. */
  view(id: number): MigrationView | null {
    const { plan, coord } = this.deps;
    const m = plan.migrationById(id);
    if (m === null || m.map === null) return null;
    const map = m.map;
    const after = m.state === 'applied' || m.state === 'put-back';
    const counts = after ? reportCounts(plan.movesOf(id), map, m.report?.skipped.length ?? 0, m.report?.taken ?? []) : countsOfMap(map);
    const titleOf = (slug: string): string | null => coord.programs().find((p) => p.slug === slug)?.title ?? null;
    const body = (epics: readonly PlanEpicBody[]): MigrationStructure['epics'] =>
      epics.map((e) => ({ key: e.key, title: e.title, checkpoints: e.checkpoints.map((c) => ({ key: c.key, title: c.title })) }));
    const structure: MigrationStructure[] = [
      ...(map.backlog ?? []).map((g) => ({ programme: g.slug, title: g.title, backlog: true, declared: true, epics: body(g.epics) })),
      ...(map.epics ?? []).map((g) => ({ programme: g.programme, title: titleOf(g.programme), backlog: false, declared: true, epics: body(g.epics) })),
    ];
    const named = new Set(structure.map((x) => x.programme));
    for (const slug of new Set(map.entries.flatMap((e) => { const p = programmeOfEntry(e); return p === null || e.class === 'unclear' ? [] : [p]; }))) {
      if (named.has(slug)) continue;
      const stored = plan.planOf(slug).epics.filter((e) => e.state !== 'dropped' && e.putBackAt === null);
      structure.push({ programme: slug, title: titleOf(slug), backlog: false, declared: false,
        epics: stored.map((e) => ({ key: e.key, title: e.title, checkpoints: e.checkpoints.filter((c) => c.putBackAt === null).map((c) => ({ key: c.key, title: c.title })) })) });
    }
    return { ok: true, id: m.id, team: m.teamKey, state: m.state, counts, entries: map.entries, structure, report: m.report };
  }
  /** The project row's hierarchy state (§11.1): the newest migration of its team in ITS workspace (`migrationOfProject`, D-8808). */
  async stateOfProject(row: { teamKey: string | null; workspaceId: string | null }): Promise<ReturnType<typeof hierarchyStateOf>> {
    const { slots } = row.teamKey !== null && row.workspaceId === null ? await this.routable() : { slots: null };
    return hierarchyStateOf(migrationOfProject(row, this.deps.plan.migrationsOf(), slots));
  }
  /** Whether a project's team is `team` in `workspaceId` (`projectOnTeam` over the project's row). */
  private onTeam(project: string, team: string, workspaceId: string, slots: readonly LinearRouteSlot[] | null): boolean {
    const l = this.deps.coord.linkingOf(project);
    return projectOnTeam({ teamKey: l.teamKey, workspaceId: l.teamWorkspace ?? null }, team, workspaceId, slots);
  }

  // ── The lane (Tasks 7.2 to 7.4) ──

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { slots } = await this.routable();
      for (let m of this.deps.plan.migrationsOf()) {
        // An open report's skipped issue the owner has since taken leaves the list before the follow-up is mailed (review 2955 F2).
        if (m.state === 'applied' && m.reportDoneAt === null && m.putBackAskedAt === null && (m.report?.skipped.length ?? 0) > 0) {
          const shed = shedTaken(m.report!.skipped, m.report!.taken ?? [], (i) => this.heldIdentifier(m, i));
          if (shed.moved) {
            const report = { ...m.report!, skipped: shed.skipped, taken: shed.taken };
            if (this.deps.plan.setMigration(m.id, ['applied'], { report }, this.deps.now())) m = { ...m, report };
          }
        }
        if (m.state === 'proposing' || (m.state === 'applied' && m.reportDoneAt === null && (m.report?.skipped.length ?? 0) > 0 && m.putBackAskedAt === null)) this.mailForMap(m, slots);
        if (m.state === 'approved' || m.state === 'applying') await this.applyTick(m);
        if (m.state === 'applied' && m.putBackAskedAt !== null) await this.putBackTick(m);
      }
    } finally {
      this.running = false;
    }
  }

  /** Whether a live binding holds the issue with this identifier: the plan store's one reader (`issueBound`), never a second
   *  definition (review 2955 F2). The issue's id comes from the map's entries, else the identifier stands for it. */
  private heldIdentifier(m: MigrationRow, identifier: string): boolean {
    const linearId = m.map?.entries.find((x) => x.identifier === identifier)?.issue ?? identifier;
    return this.deps.plan.issueBound(m.workspaceId, { id: linearId, identifier });
  }

  /** A `proposing` row: the owner is mailed for the map (or *Name a Linear owner* is raised, by the inbound lane's own item, once),
   *  and each live programme of the team with no declared plan has its coordinator mailed to declare it first (§10.1). Each mail
   *  is sent once, by its subject. A follow-up's mail names the skipped issues. */
  private mailForMap(m: MigrationRow, slots: readonly LinearRouteSlot[] | null): void {
    const { coord, plan } = this.deps;
    const now = this.deps.now();
    const owner = this.ownerOf(m.teamKey, m.workspaceId);
    const project = m.project ?? owner?.project ?? null;
    if (project === null) return;
    const mail = proposeMail(m.id, m.teamKey, project, m.state === 'applied' ? m.report?.skipped ?? [] : []);
    tx(coord.db, () => {
      if (owner !== null && owner.id !== null && owner.live) {
        if (!coord.hasMailWithSubject('operator', null, owner.id, mail.subject)) {
          insertSystemMailTx(coord, null, { fromId: 'operator', toId: owner.id, runId: null, kind: 'question', subject: mail.subject, body: mail.body });
        }
      }
      if (m.state !== 'proposing') return;
      const runs = this.runFacts();
      if (runs === null) return;
      for (const p of coord.programs()) {
        const home = coord.programHome(p.slug);
        if (home === null || !runs.live.has(p.slug) || !this.onTeam(home, m.teamKey, m.workspaceId, slots)) continue;
        if (plan.planOf(p.slug).planBy !== null) continue;
        const to = plan.planOwnerOf(p.slug);
        const d = declareMail(m.id, m.teamKey, p.slug);
        if (to !== null && !coord.hasMailWithSubject('operator', null, to, d.subject)) {
          insertSystemMailTx(coord, { program: p.slug }, { fromId: 'operator', toId: to, runId: null, kind: 'question', subject: d.subject, body: d.body });
        }
      }
    });
    if (owner === null || owner.id === null || !owner.live) this.raiseOwnerItemOnce(project, now);
  }
  private raiseOwnerItemOnce(project: string, now: number): void {
    const { coord, plan, presenceOf } = this.deps;
    const open = coord.itemsFor(LINEAR_SYNC_PROGRAMME, now).open.some((i) => i.action?.verb === 'linear-owner' && (i.action as { project?: string }).project === project);
    if (open) return;
    // The inbound path's own item, as it raises it (`ownerItemInput`), so one item names the owner for both.
    coord.raiseItem(ownerItemInput(project, plan.coordinatorIdsOf().filter((id) => presenceOf(id) === 'alive')), now, 'ccrc');
  }

  /** One apply tick of an `approved` or `applying` migration (Task 7.3; D-8796). */
  private async applyTick(m: MigrationRow): Promise<void> {
    const { plan } = this.deps;
    const now = this.deps.now();
    if (m.map === null || now < this.restUntil) return;
    if (m.state === 'approved' && !plan.setMigration(m.id, ['approved'], { state: 'applying' }, now)) return;
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    const slot = slotsOf(store).get(m.workspaceId);
    if (slot === undefined || this.deps.planSync.keyBlockedUntil(m.workspaceId) > now) return;
    const entries = this.deps.directory.get(slot.ref, slot.digest);
    const runs = this.runFacts();
    if (entries === null || runs === null) return;
    const map = m.map;
    const report = { ...(m.report ?? EMPTY_MIGRATION_REPORT()) };
    const skipped = new Set(report.skipped);
    const unrelated = new Set(report.unrelated ?? []);
    const taken = new Set(report.taken ?? []);
    const lists = { skipped, unrelated, taken };
    // An issue a live binding holds leaves the migration: the owner took it through inbound (review 2955 F2).
    const shed = shedTaken([...skipped], [...taken], (i) => this.heldIdentifier(m, i));
    skipped.clear(); taken.clear();
    for (const i of shed.skipped) skipped.add(i);
    for (const i of shed.taken) taken.add(i);
    const initiativesOff = entries.initiatives === 'off' || plan.hierarchySettingsOf(m.project ?? '').initiatives === 'off';

    // 1. The structure the map declares: plan rows and their move rows, then the sync's pass creates and binds the objects. The
    //    map's rule is judged again here (the wave's review): a programme that has since been declared by its coordinator, or
    //    has a run, takes no structure from the map, and its issues are skipped and listed, never left waiting forever.
    let structureBound = true;
    for (const g of [...(map.backlog ?? []).map((b) => ({ slug: b.slug, epics: b.epics, backlog: b })), ...(map.epics ?? []).map((e) => ({ slug: e.programme, epics: e.epics, backlog: null }))]) {
      if (runs.active.has(g.slug)) { structureBound = false; continue; }
      const stored = plan.planOf(g.slug);
      if (!g.epics.every((e) => stored.epics.some((x) => x.key === e.key))) {
        const facts = this.planFacts(runs.live)(g.slug);
        const ours = stored.planBy === null || stored.planBy === MIGRATION_PLAN_BY;
        const diff = facts.live || !ours ? null : diffPlan(stored, { epics: g.epics }, { home: m.project ?? '', doneWhenCount: 0, workspaceOfProject: () => m.workspaceId });
        if (diff === null || !diff.ok) {
          // An issue a live binding holds is taken, never skipped (review 2998 F3).
          for (const e of map.entries) if (programmeOfEntry(e) === g.slug) (taken.has(e.identifier) || this.heldIdentifier(m, e.identifier) ? taken : skipped).add(e.identifier);
          continue;
        }
        plan.declareMapStructure(m.id, g.slug, diff.changes, MIGRATION_PLAN_BY, now, g.backlog === null ? null : { home: m.project ?? '', title: g.backlog.title, state: 'paused' });
      }
      if (!this.fillCreated(m, g.slug, initiativesOff)) {
        await this.deps.planSync.passFor(g.slug, now + MIGRATION_PASS_BUDGET_MS).catch(() => 'deferred');
        if (!this.fillCreated(m, g.slug, initiativesOff)) structureBound = false;
      }
    }

    // 2. A row written before a crash, or one whose pass has not landed yet: reconciled against a fresh read by id (D-8795's
    //    `reconcileMove`). The migration's own issue reads and writes count against the tick's budget (spec §10.6, review 2892
    //    A7, as the coordinator narrowed it on review 2918 F3), and a rate refusal ends the tick and rests the lane. A replaced
    //    level's close waits while a ticket under it has not settled (review 2918 F2), listed with its reason.
    const moves = plan.movesOf(m.id).filter((x) => !x.subject.includes(':skipped:'));
    const moveOf = new Map(moves.map((x) => [x.subject, x]));
    const budget = freshBudget();
    const affords = (calls: number): boolean => !budget.stopped && budget.writes > 0 && budget.calls >= calls;
    const held = new Map<string, MigrationWaitingWhy>();
    for (const e of map.entries) {
      const row = moveOf.get(`issue:${e.issue}`);
      if (row === undefined || row.appliedAt !== null || skipped.has(e.identifier) || taken.has(e.identifier)) continue;
      // A closer naming an issue a live binding holds gets no comment, relation or close (review 2955 A1).
      if (CLOSERS.has(e.class) && this.heldIdentifier(m, e.identifier)) { taken.add(e.identifier); continue; }
      const relation = this.relationOf(m, e, row, new Set([...skipped, ...taken]));
      if (relation?.kind === 'wait') { held.set(e.identifier, 'placed-ticket-not-applied'); continue; }
      if (!affords(CLOSERS.has(e.class) ? CLOSE_CALLS : ADOPT_CALLS)) break;
      budget.writes -= 1;
      const seen = await this.readIssue(m, slot, e.issue, budget);
      if (seen === 'unread') { this.saveReport(m, report, lists, now); return; }
      // A take that landed during that read: the issue is the owner's, so it is never marked applied, never listed unrelated and
      // never counted closed, whatever the read shows (review 3016 F2). An adopted entry holds its own binding: it is not asked.
      if (CLOSERS.has(e.class) && this.heldIdentifier(m, e.identifier)) { taken.add(e.identifier); continue; }
      const v = reconcileMove(asMoveRow(row), seen === 'gone' ? 'closed' : seen);
      if (v === 'applied') {
        plan.setMove(row.id, { appliedAt: now });
        if (relation?.kind === 'none') unrelated.add(e.identifier);   // the state write landed: it joins the list (review 2955 A2)
      }
      else if (v === 'skip') this.skipAdopted(row, e, skipped, now);
      else if (CLOSERS.has(e.class)) await this.closeIssue(m, e, row, slot, entries, budget, relation, unrelated, taken, () => this.saveReport(m, report, lists, now));
      else { budget.calls -= 1; await this.deps.planSync.passFor(String(row.after['key'] ?? ''), now + MIGRATION_PASS_BUDGET_MS).catch(() => 'deferred'); }
    }

    // 3. New writes, in Task 7.1's order: each issue is read by id inside its key's flight just before its write (D-8796), and one
    //    that changed since the map was drafted is skipped, listed and never adopted.
    const fresh: MapBody = { ...map, entries: map.entries.filter((e) => !moveOf.has(`issue:${e.issue}`) && !skipped.has(e.identifier) && !taken.has(e.identifier)) };
    const live = structureBound ? runs.active : new Set([...runs.active, ...(map.epics ?? []).map((g) => g.programme), ...(map.backlog ?? []).map((g) => g.slug)]);
    const asDrafted = new Map<string, IssueSnapshot | 'closed'>(fresh.entries.flatMap((e) => (map.snapshot[e.issue] === undefined ? [] : [[e.issue, map.snapshot[e.issue]!] as const])));
    const steps = applySteps(fresh, live, asDrafted, (e) => (CLOSERS.has(e.class) || e.class === 'leaf' || e.class === 'upkeep' ? { expect: {} } : null));
    for (const id of steps.skipped) skipped.add(map.entries.find((e) => e.issue === id)?.identifier ?? id);
    const identOf = (id: string): string => map.entries.find((e) => e.issue === id)?.identifier ?? id;
    const waitingWhy = new Map<string, MigrationWaitingWhy>([...steps.waiting.map((id) => [identOf(id), 'live-programme'] as const), ...held]);
    // A step that cannot be placed now (its epic's Linear project, or the Upkeep epic's, not created yet) is asked BEFORE any
    // Linear call: it spends nothing of the tick, is listed as waiting with its reason, and the steps behind it run (review 2892 F3).
    let upkeepNow: boolean | null = null;
    for (const step of steps.now) {
      const e = map.entries.find((x) => x.issue === step.linearId)!;
      const was = map.snapshot[e.issue]!;
      if (!CLOSERS.has(e.class)) {
        if (e.class === 'upkeep') upkeepNow ??= await this.upkeepBound(m, now);
        const why = e.class === 'upkeep' ? (upkeepNow ? null : 'upkeep-not-in-linear' as const) : this.epicPlaceable(m, e) ? null : 'epic-not-in-linear' as const;
        if (why !== null) { waitingWhy.set(e.identifier, why); continue; }
      }
      // A replaced level waits, before any call, while a ticket under it has not settled (review 2918 F2).
      // A closer naming an issue a live binding holds goes to `taken` before any call (review 2955 A1).
      if (CLOSERS.has(e.class) && this.heldIdentifier(m, e.identifier)) { taken.add(e.identifier); continue; }
      const relation = this.relationOf(m, e, null, new Set([...skipped, ...taken]));
      if (relation?.kind === 'wait') { waitingWhy.set(e.identifier, 'placed-ticket-not-applied'); continue; }
      if (!affords(CLOSERS.has(e.class) ? CLOSE_CALLS : ADOPT_CALLS)) break;
      budget.writes -= 1;
      if (CLOSERS.has(e.class)) {
        const out = await this.deps.planSync.withFlight(`migration:${e.issue}`, async () => {
          const seen = await this.readIssue(m, slot, e.issue, budget);
          if (seen === 'unread') return 'unread' as const;
          if (seen === 'gone' || !snapshotHolds(was, seen)) return 'changed' as const;
          if (this.heldIdentifier(m, e.identifier)) return 'taken' as const;   // review 2998 F1: no move row for a held issue
          return plan.insertMove({ migrationId: m.id, subject: `issue:${e.issue}`, kind: 'issue', linearId: e.issue, identifier: e.identifier, before: seen, after: this.closeAfter(e) });
        });
        if (out === 'unread') { this.saveReport(m, report, lists, now); return; }
        if (out === 'taken') { taken.add(e.identifier); continue; }
        if (out === 'changed') { skipped.add(e.identifier); continue; }
        await this.closeIssue(m, e, out, slot, entries, budget, relation, unrelated, taken, () => this.saveReport(m, report, lists, now));
      } else {
        const out = await this.adopt(m, e, was, store, slot, budget);
        if (out === 'unread') { this.saveReport(m, report, lists, now); return; }
        if (out === 'taken') { taken.add(e.identifier); continue; }   // review 2955 F2
        if (out === 'changed') { skipped.add(e.identifier); continue; }
        if (out === null) { waitingWhy.set(e.identifier, e.class === 'upkeep' ? 'upkeep-not-in-linear' : 'epic-not-in-linear'); continue; }
        budget.calls -= 1;
        await this.deps.planSync.passFor(out, now + MIGRATION_PASS_BUDGET_MS).catch(() => 'deferred');
      }
    }
    const waiting = [...waitingWhy.keys()];
    const nextReport = this.saveReport(m, { ...report, waiting, waitingWhy: Object.fromEntries(waitingWhy) }, lists, now);

    // 4. Done (D-8796 condition 4) when nothing waits, every structure object is bound, no listed issue is left unwritten, and
    //    every move row is applied or its issue is skipped or taken and listed; a row still waiting on its pass holds `applying`.
    const all = plan.movesOf(m.id).filter((x) => !x.subject.includes(':skipped:'));
    const unwritten = map.entries.some((e) => e.class !== 'unclear' && !skipped.has(e.identifier) && !taken.has(e.identifier) && !all.some((x) => x.subject === `issue:${e.issue}`));
    const pending = all.some((x) => x.appliedAt === null && !(x.identifier !== null && (skipped.has(x.identifier) || taken.has(x.identifier))));
    if (waiting.length > 0 || !structureBound || unwritten || pending) return;
    this.finishApply(m, map, nextReport, all, now, store.kind === 'listed' ? routableSlots(store) : null);
  }

  /** The tick's lists written back (the row stays `applying`): `skipped` always, `unrelated` and `taken` only when they hold
   *  something. Every exit of the tick passes the same sets, so an early return loses nothing (review 2955 F1). Answers the report
   *  it wrote. */
  private saveReport(
    m: MigrationRow, report: NonNullable<MigrationRow['report']>,
    lists: { skipped: ReadonlySet<string>; unrelated: ReadonlySet<string>; taken: ReadonlySet<string> }, now: number,
  ): NonNullable<MigrationRow['report']> {
    const next = {
      ...report, skipped: [...lists.skipped],
      ...(lists.unrelated.size === 0 ? {} : { unrelated: [...lists.unrelated] }), ...(lists.taken.size === 0 ? {} : { taken: [...lists.taken] }),
    };
    this.deps.plan.setMigration(m.id, ['applying'], { report: next }, now);
    return next;
  }

  /** An adopted issue that changed between its adoption and its write (`reconcileMove` answers skip): set aside in one transaction
   *  (`setAsideAdopted`): its ticket put back, so the sync never writes over the person's change; its binding retired, so the
   *  issue reaches the team's Linear owner as inbound (spec §10.3 step 5, review 2892 F5); its row set aside, so a follow-up map
   *  can move it. It is listed as skipped. */
  private skipAdopted(row: MoveRowStored, e: MapEntry, skipped: Set<string>, now: number): void {
    const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    this.deps.plan.setAsideAdopted({ moveId: row.id, ticketId: num(row.after['ticketId']), bindingId: num(row.after['bindingId']) }, now);
    skipped.add(e.identifier);
  }

  /** One issue read by id on lane `migration`: its snapshot, `gone` (not found), or `unread` (refused; a rate refusal rests the lane
   *  until Linear's retry time). */
  private async readIssue(m: MigrationRow, slot: SlotInfo, linearId: string, budget?: TickBudget): Promise<IssueSnapshot | 'gone' | 'unread'> {
    const out = await this.callIn(budget, { op: 'issueOwned', pass: 'migration', lane: 'migration', slot: slot.ref, workspaceId: m.workspaceId, teamKey: m.teamKey, target: null, fields: [], input: { id: linearId } });
    if (!out.ok) return out.word === 'not-found' ? 'gone' : 'unread';
    const r = rowOf(out.value['issue']);
    return r === null ? 'unread' : snapshotOf(r);
  }

  /** One Linear call on lane `migration`, counted against the tick's budget when there is one (review 2892 A7). A rate refusal rests
   *  the lane until Linear's retry time and ends the tick, as the sync's own lanes do. */
  private async callIn(budget: TickBudget | undefined, ask: CcrcOpAsk): Promise<CcrcOpOutcome> {
    if (budget !== undefined) budget.calls -= 1;
    const out = await this.deps.call(ask);
    if (!out.ok && out.word === 'rate-limited') {
      if ('retryAfterS' in out) this.restUntil = this.deps.now() + out.retryAfterS * 1000;
      if (budget !== undefined) budget.stopped = true;
    }
    return out;
  }

  /** Whether a leaf can be placed now (review 2892 F3): its epic is in the plan and its Linear project is bound in the
   *  migration's workspace, so the sync can plan the issue under it. Asked before any Linear call. */
  private epicPlaceable(m: MigrationRow, e: MapEntry): boolean {
    const programme = programmeOfEntry(e);
    if (programme === null) return false;
    const epic = this.deps.plan.planOf(programme).epics.find((x) => x.key === e.target?.epic && x.state !== 'dropped' && x.putBackAt === null);
    return epic !== undefined && this.deps.plan.bindingsOf(programme)
      .some((b) => b.localKind === 'epic' && b.localId === epic.id && b.workspaceId === m.workspaceId && b.state === 'bound' && b.linearId !== null);
  }

  /** The move rows of a programme's created objects take their Linear ids from the bindings the pass made (D-8796). True when
   *  every one of them is filled. With initiatives off (the workspace's, or the home project's setting), the sync makes no
   *  initiative, so a programme's row is settled with no Linear id rather than waited on forever (the wave's review). */
  private fillCreated(m: MigrationRow, slug: string, initiativesOff: boolean): boolean {
    const { plan } = this.deps;
    const rowid = plan.programmeRowId(slug);
    const stored = plan.planOf(slug);
    const ids = new Set<string>([...(rowid === null ? [] : [`programme:${rowid}`]), ...stored.epics.flatMap((e) => [`epic:${e.id}`, ...e.checkpoints.map((c) => `checkpoint:${c.id}`)])]);
    const bindings = plan.bindingsOf(slug);
    let all = true;
    for (const row of plan.movesOf(m.id)) {
      if (row.before !== null || !ids.has(row.subject) || row.appliedAt !== null) continue;
      const [kind, localId] = row.subject.split(':');
      const b = bindings.find((x) => x.localKind === kind && x.localId === Number(localId) && x.workspaceId === m.workspaceId && x.state === 'bound' && x.linearId !== null);
      if (b === undefined && kind === 'programme' && initiativesOff) { plan.setMove(row.id, { appliedAt: this.deps.now() }); continue; }
      if (b === undefined) { all = false; continue; }
      plan.setMove(row.id, { linearId: b.linearId!, appliedAt: this.deps.now() });
    }
    return all;
  }

  /** The project's Upkeep epic, created when it is missing and made bound by the sync's pass for `upkeep:<project>` (outside any
   *  flight of ours: `passFor` joins the key's flight). The Upkeep epic is shared with the inbound path, so it is no object of the
   *  migration's: it has no move row and put back leaves it (the wave's review). A false answer waits for the next tick. */
  private async upkeepBound(m: MigrationRow, now: number): Promise<boolean> {
    const { plan, coord, planSync } = this.deps;
    const project = m.project ?? '';
    const key = `${UPKEEP_DUE_PREFIX}${project}`;
    const epicId = tx(coord.db, () => plan.ensureUpkeepEpicInTx(project, now));
    const bound = (): boolean => plan.bindingsOf(key).some((b) => b.localKind === 'epic' && b.localId === epicId && b.workspaceId === m.workspaceId && b.state === 'bound' && b.linearId !== null);
    if (!bound()) {
      plan.markSyncDue(key, now);
      await planSync.passFor(key, now + MIGRATION_PASS_BUDGET_MS).catch(() => 'deferred');
    }
    return bound();
  }

  /** A leaf or upkeep issue adopted with its move row in ONE transaction (D-8796), inside its key's flight and right after a read
   *  of the issue by id: one that changed since the map was drafted is `changed`, never adopted. The move's `after.expect` is the
   *  sync's planned owned fields for the new binding. The key whose pass sends the update, `unread`, `changed`, or null when it
   *  is not placeable now (rolled back). */
  private async adopt(m: MigrationRow, e: MapEntry, was: IssueSnapshot, store: LinearStoreRead, slot: SlotInfo, budget: TickBudget): Promise<string | 'unread' | 'changed' | 'taken' | null> {
    const { plan, planSync, coord } = this.deps;
    const programme = e.class === 'leaf' ? programmeOfEntry(e) : null;
    const project = m.project ?? '';
    const key = programme ?? `${UPKEEP_DUE_PREFIX}${project}`;
    return planSync.withFlight(key, async () => {
      const seen = await this.readIssue(m, slot, e.issue, budget);
      if (seen === 'unread') return 'unread';
      if (seen === 'gone' || !snapshotHolds(was, seen)) return 'changed';
      try {
        return tx(coord.db, () => {
          const now = this.deps.now();
          let epicId: number;
          let checkpointId: number | null = null;
          if (programme === null) {
            const upkeep = plan.upkeepEpicOf(project);
            if (upkeep === null) throw new Error('not-placeable');
            epicId = upkeep.id;
          } else {
            const epic = plan.planOf(programme).epics.find((x) => x.key === e.target!.epic && x.state !== 'dropped' && x.putBackAt === null);
            if (epic === undefined) throw new Error('not-placeable');
            epicId = epic.id;
            if (e.target?.checkpoint !== undefined) checkpointId = epic.checkpoints.find((c) => c.key === e.target!.checkpoint)?.id ?? null;
          }
          const ticketId = plan.adoptIssueAsTicketInTx({
            issue: { ...seen, linearId: e.issue, identifier: e.identifier }, programme, epicId, checkpointId, key: ticketKeyOf(e), kind: ticketKindOf(e),
            source: e.class === 'leaf' ? 'plan' : 'inbound', mask: this.deps.mask ?? linearEgressText,
          }, { workspaceId: m.workspaceId, teamKey: seen.team }, now);
          const binding = plan.bindingOf('ticket', ticketId, m.workspaceId);
          const owned = binding === null ? null : planSync.plannedOwnedNow(key, store, binding.id);
          if (binding === null || owned === null) throw new Error('not-placeable');
          const after: IssueAfter = { expect: expectOfOwned(owned.owned), ticketId, bindingId: binding.id, key };
          plan.insertMove({ migrationId: m.id, subject: `issue:${e.issue}`, kind: 'issue', linearId: e.issue, identifier: e.identifier, before: seen, after });
          return key;
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'not-placeable') return null;
        // A live binding came to hold the issue since the map was stored (the owner's take, say): it leaves the migration as
        // `taken` and never gets a second ticket or a second binding (review 2918 F1, review 2955 F2; the store refuses it,
        // `adoptIssueAsTicketInTx`).
        if (err instanceof IssueHeldError) return 'taken';
        throw err;
      }
    });
  }

  /** What closing an issue writes (§10.4): its state type, and its comment and relation. */
  private closeAfter(e: MapEntry): Record<string, unknown> {
    const state = e.class === 'finished' ? 'completed' : 'canceled';
    return { expect: { state }, close: e.class };
  }

  /** Close one issue the map retires (§10.4), its move row written already: the comment, the relation, then the state. A refused
   *  write leaves the row unapplied; the next tick reconciles it. Each call counts against the tick's budget, and a rate refusal
   *  rests the lane and ends the tick (review 2892 A7). The relation is sent once: its send is marked on the move row, as Linear's
   *  relation create takes no request id (review 2892 A1). A replaced level relates to the ticket `relation` names; one with no
   *  ticket placed under it closes with none and joins the report's `unrelated` list (review 2918 F2). */
  private async closeIssue(
    m: MigrationRow, e: MapEntry, row: MoveRowStored, slot: SlotInfo, entries: NonNullable<ReturnType<LinearDirectoryRead['get']>>, budget: TickBudget,
    relation: CloserRelation | null, unrelated: Set<string>, taken: Set<string>, persist: () => void,
  ): Promise<void> {
    const { plan, coord } = this.deps;
    const state = String((row.after['expect'] as Record<string, unknown> | undefined)?.['state'] ?? 'canceled');
    const status = statusOfType(entries, 'issue', state, m.teamKey);
    if (status === null) return;
    const base = { pass: 'migration', lane: 'migration', slot: slot.ref, workspaceId: m.workspaceId, teamKey: m.teamKey, target: e.identifier } as const;
    // A live binding that comes to hold the issue ends the close before the next write: it goes to `taken`, its row stays unapplied
    // (review 2998 F1). The one window left is a binding made while a single write is already in flight.
    const heldNow = (): boolean => {
      if (!this.heldIdentifier(m, e.identifier)) return false;
      taken.add(e.identifier);
      return true;
    };
    await this.deps.planSync.withFlight(`migration:${e.issue}`, async () => {
      if (heldNow()) return;
      const home = this.homeTitle(e);
      const linking = coord.linkingOf(m.project ?? '');
      const repo = linking.measured.state === 'measured' ? linking.measured.slug : null;
      const text = e.class === 'finished' ? finishedComment(e.target ?? {}, { teamKey: m.teamKey, mode: linking.mode }, repo, this.deps.privateTrackerKeys ?? [])
        : e.class === 'stale' ? 'ccrc\'s migration closed this issue as stale, as the approved map says; nothing was deleted.'
          : e.class === 'superseded' ? 'ccrc\'s migration closed this issue as superseded by the related issue; nothing was deleted.'
            : replacementComment(home, linking.mode, null);
      const comment = await this.callIn(budget, { ...base, op: 'issueComment', fields: ['body'], input: { requestId: uuidOf(`migration:${m.id}:${e.issue}:comment`), issueId: e.issue, body: withCcrcProvenance(egress(text)) } });
      if (!comment.ok && !(comment.word === 'linear-invalid' && comment.detail === 'conflict')) return;
      if (heldNow()) return;
      const related = row.after['related'] === true ? null
        : e.class === 'superseded' ? e.target?.successor ?? null : relation?.kind === 'relate' ? relation.issue : null;
      if (related !== null) {
        // A relation is evidence, not the close: a refused one is not retried and does not stop the close.
        const rel = await this.callIn(budget, { ...base, op: 'issueRelationCreate', fields: ['type', 'related'], input: { issueId: e.issue, relatedIssueId: related, type: 'related' } });
        if (budget.stopped) return;
        if (rel.ok) plan.setMove(row.id, { after: { ...row.after, related: true } });
      }
      if (heldNow()) return;
      const update = await this.callIn(budget, { ...base, op: 'issueUpdate', fields: ['state'], input: { id: e.issue, stateId: status.id } });
      if (update.ok) {
        // A take that landed during the write is listed taken and counted nowhere else (review 3004 F2); otherwise the level joins
        // `unrelated` only once the state write landed (review 2955 A2). The stamp and the tick's report (with the issue taken) are
        // written in ONE transaction, so a restart between them cannot lose the listing (review 3016 A2); `persist` is the tick's own
        // report save, called only when the issue is held.
        const stamp = this.deps.now();
        let held = false;
        tx(coord.db, () => {
          plan.setMove(row.id, { appliedAt: stamp });
          held = heldNow();
          if (held) persist();
        });
        if (!held && relation?.kind === 'none') unrelated.add(e.identifier);
      }
    });
  }
  /** The title a replaced level's comment names: its programme's, epic's or checkpoint's. */
  private homeTitle(e: MapEntry): string {
    const t = e.target ?? {};
    if (t.programme === undefined) return 'its new home';
    const plan = this.deps.plan.planOf(t.programme);
    const epic = t.epic === undefined ? undefined : plan.epics.find((x) => x.key === t.epic);
    const cp = epic === undefined || t.checkpoint === undefined ? undefined : epic.checkpoints.find((c) => c.key === t.checkpoint);
    return cp?.title ?? epic?.title ?? this.deps.coord.programs().find((p) => p.slug === t.programme)?.title ?? t.programme;
  }
  /** What a replaced level's close relates to (`closerRelation`, review 2918 F2), from this migration's move rows read now: a leaf's
   *  issue is applied by its applied row, never one skipped, set aside or not placed yet (review 2892 A1). Null for any other
   *  class, and for a row whose relation is already sent. */
  private relationOf(m: MigrationRow, e: MapEntry, row: MoveRowStored | null, skipped: ReadonlySet<string>): CloserRelation | null {
    if (!REPLACED.has(e.class) || row?.after['related'] === true) return null;
    const applied = new Set(this.deps.plan.movesOf(m.id).flatMap((x) => (x.kind === 'issue' && x.appliedAt !== null && !x.subject.includes(':skipped:') && x.linearId !== null ? [x.linearId] : [])));
    return closerRelation(e, m.map?.entries ?? [], applied, skipped);
  }

  /** The apply is done: the report item is raised, and `planRequired` is set for the programmes the map names and the team's
   *  programmes that have declared a plan, never an unnamed one with no plan, whose coordinator's next run open it would refuse
   *  `plan-missing` mid-work with no word to it (D-8798, review 2892 F8). */
  private finishApply(m: MigrationRow, map: MapBody, report: NonNullable<MigrationRow['report']>, moves: readonly MoveRowStored[], now: number, slots: readonly LinearRouteSlot[] | null): void {
    const { plan, coord } = this.deps;
    const counts = reportCounts(moves, map, report.skipped.length, report.taken ?? []);
    const named = [...new Set([...map.entries.flatMap((e) => (programmeOfEntry(e) === null || e.class === 'unclear' ? [] : [programmeOfEntry(e)!])),
      ...(map.epics ?? []).map((g) => g.programme), ...(map.backlog ?? []).map((g) => g.slug)])];
    const declared = coord.programs().filter((p) => {
      const home = coord.programHome(p.slug);
      return home !== null && this.onTeam(home, m.teamKey, m.workspaceId, slots) && plan.planOf(p.slug).planBy !== null;
    }).map((p) => p.slug);
    // A done programme the map placed open tickets into keeps its initiative active while they are open (D-8796, point 6).
    const placedInto = new Set(map.entries.flatMap((e) => (e.class === 'leaf' && programmeOfEntry(e) !== null && moves.some((x) => x.subject === `issue:${e.issue}` && x.appliedAt !== null) ? [programmeOfEntry(e)!] : [])));
    const done = coord.programs().filter((p) => p.state === 'done' && placedInto.has(p.slug)).map((p) => p.slug).sort();
    coord.raiseItemWithMail(reportItemInput(m.id, m.teamKey, counts, done), now, 'ccrc', (reportItemId) => {
      if (!plan.setMigration(m.id, ['applying'], { state: 'applied', appliedAt: m.appliedAt ?? now, reportItemId, report }, now)) throw new Error(`migration ${m.id} moved while it was finished`);
      plan.setPlanRequired([...new Set([...named, ...declared])]);
    });
    // A follow-up's earlier report closes after the new one is raised: `moveItem` opens its own transaction (`tx` does not nest),
    // so it cannot run inside `raiseItemWithMail`'s.
    if (m.reportItemId !== null) coord.moveItem(m.reportItemId, 'settle', 'ccrc', { note: 'A follow-up map was applied: its report follows.' }, now, { programmeHasOpenRun: false });
  }

  /** Put back (Task 7.4): from the move record alone, last move first, inside each key's flight. The ccrc half first (the records
   *  dropped "put back", `putBackAt` set, so the sync emits nothing for them); then the moved issues, a few a tick (spec §10.6:
   *  each costs a read and a write on lane `migration`), each restored or, when it moved since, listed and untouched; then the
   *  created objects: a project canceled, an initiative canceled with its programme's plan end recorded `abandoned` "put back"
   *  (the plan was the map's), a milestone left under its canceled project and listed (D-8795). */
  private async putBackTick(m: MigrationRow): Promise<void> {
    const { plan } = this.deps;
    const now = this.deps.now();
    if (now < this.restUntil) return;
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    const slot = slotsOf(store).get(m.workspaceId);
    if (slot === undefined || this.deps.planSync.keyBlockedUntil(m.workspaceId) > now) return;
    const entries = this.deps.directory.get(slot.ref, slot.digest);
    if (entries === null) return;
    // The ccrc half covers every record the migration made, applied or not (a security review: an unapplied adoption's ticket must
    // not stay live); Linear's half restores only what was applied.
    const recorded = plan.movesOf(m.id);
    const local = (kind: string) => recorded.filter((x) => x.before === null && x.subject.startsWith(`${kind}:`)).map((x) => Number(x.subject.split(':')[1]));
    plan.dropPutBack({ epics: local('epic'), checkpoints: local('checkpoint'), tickets: recorded.flatMap((x) => (typeof x.after['ticketId'] === 'number' ? [x.after['ticketId']] : [])) }, now);
    const moves = recorded.filter((x) => x.appliedAt !== null);
    const report = { ...(m.report ?? EMPTY_MIGRATION_REPORT()) };
    const movedSince = new Set(report.movedSince);
    const todo = moves.filter((x) => x.kind === 'issue' && x.revertedAt === null && x.linearId !== null).sort((a, b) => b.id - a.id).slice(0, PUT_BACK_ISSUES_PER_TICK);
    for (const row of todo) {
      // An issue a live binding holds is the owner's: no write, listed taken; its row is handled so put back goes on (review 3004
      // F2). It is asked before the read, again after it and again inside the write's flight (review 3016 F1): a take can land in
      // any of those awaits. A row this migration adopted holds its own binding (`after.bindingId`), which is no take: only a
      // closer's row can be taken.
      const held = (): boolean => typeof row.after['bindingId'] !== 'number' && this.heldIdentifier(m, row.identifier ?? row.linearId!);
      if (held()) { this.putBackTaken(m, report, movedSince, row, now); continue; }
      const seen = await this.readIssue(m, slot, row.linearId!);
      // An issue found moved since earlier in this tick is saved before any early return (review 2892 F2): its row is already
      // marked handled, so no later tick would list it.
      if (seen === 'unread') { this.saveMovedSince(m, report, movedSince, now); return; }
      if (held()) { this.putBackTaken(m, report, movedSince, row, now); continue; }
      const { steps, moved } = putBackSteps([asMoveRow(row)], seen === 'gone' ? new Map() : new Map([[row.linearId!, seen]]));
      // An issue moved since (or gone) is listed and never touched; its row is marked handled so the next tick goes on.
      if (moved.length > 0 || steps.length === 0) { movedSince.add(row.identifier ?? row.linearId!); plan.setMove(row.id, { revertedAt: this.deps.now() }); continue; }
      const stepped = await this.putBackStep(m, steps[0]!, row, slot, entries, held);
      if (stepped === 'taken') { this.putBackTaken(m, report, movedSince, row, now); continue; }
      if (stepped === 'failed') { this.saveMovedSince(m, report, movedSince, now); return; }
      plan.setMove(row.id, { revertedAt: this.deps.now() });
    }
    // The created objects only once every moved issue is handled: a project is canceled after its issues left it.
    if (plan.movesOf(m.id).some((x) => x.appliedAt !== null && x.kind === 'issue' && x.revertedAt === null && x.linearId !== null)) {
      this.saveMovedSince(m, report, movedSince, now);
      return;
    }
    const milestones: string[] = [];
    for (const row of plan.movesOf(m.id).filter((x) => x.appliedAt !== null && x.before === null && x.revertedAt === null).sort((a, b) => b.id - a.id)) {
      const slug = typeof row.after['key'] === 'string' ? row.after['key'] : null;
      if (row.kind === 'checkpoint') { milestones.push(row.subject); plan.setMove(row.id, { revertedAt: this.deps.now() }); continue; }
      if (row.kind === 'programme') {
        // The programme's plan was the map's: its end is recorded `abandoned` "put back", so nothing reopens it, and its initiative
        // is canceled here, in the key's flight. With every epic put back, the sync's snapshot has no fact for the initiative and
        // sends it nothing, so it never writes over this cancel.
        // Only a programme whose plan is still the map's own is ended and its initiative canceled (a security review): one its
        // coordinator has since taken over (its first plan write after the map's, which makes `planBy` the coordinator's, D-8802,
        // review 2892 F1) is theirs, and is left as it is.
        if (slug === null || plan.planOf(slug).planBy !== MIGRATION_PLAN_BY) { plan.setMove(row.id, { revertedAt: this.deps.now() }); continue; }
        if (plan.planEndOf(slug) === null) plan.closePlan(slug, 'abandoned', 'put back', this.deps.now());
        if (row.linearId !== null) {
          const out = await this.deps.planSync.withFlight(slug ?? `migration:${row.linearId}`, () => this.deps.call({
            pass: 'put-back', lane: 'migration', slot: slot.ref, workspaceId: m.workspaceId, teamKey: m.teamKey, op: 'initiativeUpdate', target: row.linearId,
            fields: ['status'], input: { id: row.linearId, status: 'Canceled' },
          }));
          if (!out.ok) { this.saveMovedSince(m, report, movedSince, now); return; }
        }
        plan.setMove(row.id, { revertedAt: this.deps.now() });
        continue;
      }
      const st = statusOfType(entries, 'project', 'canceled', null);
      if (st === null || row.linearId === null) { this.saveMovedSince(m, report, movedSince, now); return; }
      const ok = await this.deps.planSync.withFlight(slug ?? `migration:${row.linearId}`, async () => (await this.deps.call({
        pass: 'put-back', lane: 'migration', slot: slot.ref, workspaceId: m.workspaceId, teamKey: m.teamKey, op: 'projectUpdate', target: row.linearId,
        fields: ['status'], input: { id: row.linearId, statusId: st.id },
      })).ok);
      if (!ok) { this.saveMovedSince(m, report, movedSince, now); return; }
      plan.setMove(row.id, { revertedAt: this.deps.now() });
    }
    plan.setMigration(m.id, ['applied'], { state: 'put-back', putBackAt: now, report: { ...report, movedSince: [...movedSince], milestonesLeft: [...report.milestonesLeft, ...milestones] } }, now);
  }
  /** An issue a live binding holds, found by put back: listed taken (once), its row marked handled and the report saved in ONE
   *  transaction, so a restart between them loses neither (review 3016 A2). The one place put back says "held, so take it". */
  private putBackTaken(m: MigrationRow, report: NonNullable<MigrationRow['report']>, movedSince: ReadonlySet<string>, row: MoveRowStored, now: number): void {
    report.taken = [...new Set([...(report.taken ?? []), row.identifier ?? row.linearId!])];
    tx(this.deps.coord.db, () => {
      this.deps.plan.setMove(row.id, { revertedAt: this.deps.now() });
      this.saveMovedSince(m, report, movedSince, now);
    });
  }
  private saveMovedSince(m: MigrationRow, report: NonNullable<MigrationRow['report']>, movedSince: ReadonlySet<string>, now: number): void {
    this.deps.plan.setMigration(m.id, ['applied'], { report: { ...report, movedSince: [...movedSince] } }, now);
  }

  /** One moved issue restored from its `before` (state, project, milestone, parent, team, title and description), in its key's
   *  flight, on lane `migration` with pass `put-back`. */
  private async putBackStep(m: MigrationRow, step: ReturnType<typeof putBackSteps>['steps'][number], row: MoveRowStored, slot: SlotInfo, entries: NonNullable<ReturnType<LinearDirectoryRead['get']>>, held: () => boolean): Promise<'restored' | 'failed' | 'taken'> {
    if (step.linearId === null) return 'restored';
    const was = row.before!;
    const team = slot.teams.find((t) => t.key.toUpperCase() === was.team.toUpperCase());
    const state = statusOfType(entries, 'issue', was.state, was.team);
    if (team === undefined || state === null) return 'failed';
    const key = typeof row.after['key'] === 'string' ? row.after['key'] : `migration:${step.linearId}`;
    return this.deps.planSync.withFlight(key, async () => {
      if (held()) return 'taken' as const;   // review 3016 F1: a take that landed while the write waited for its flight
      const out = await this.deps.call({
        pass: 'put-back', lane: 'migration', slot: slot.ref, workspaceId: m.workspaceId, teamKey: m.teamKey,
        op: 'issueUpdate', target: row.identifier, destinationTeamKey: was.team, fields: ['title', 'description', 'state', 'project', 'milestone', 'team', 'parent'],
        input: { id: step.linearId, teamId: team.id, stateId: state.id, projectId: was.project, projectMilestoneId: was.milestone, parentId: was.parent, title: was.title, description: was.description },
      });
      if (!out.ok && out.word === 'rate-limited' && 'retryAfterS' in out) this.restUntil = this.deps.now() + out.retryAfterS * 1000;
      return out.ok ? 'restored' as const : 'failed' as const;
    });
  }
}

/** The migration as `index.ts` builds it (D-8186): Linear reached through `runCcrcOp` with the one rate service, journal and
 *  policy, as the plan sync and the drift pass reach it. */
export function linearMigrationFor(o: {
  coord: CoordStore; plan: PlanStorePort; planSync: LinearMigrationDeps['planSync']; ccrcDir: string; rate: LinearRateService;
  journal: LinearJournal; policy: LinearWritePolicy; readLinearStore: LinearMigrationDeps['readLinearStore'];
  directory: LinearDirectoryRead; presenceOf: (id: string) => CoordinatorPresence; privateTrackerKeys?: readonly string[];
}): LinearMigration {
  return new LinearMigration({
    coord: o.coord, plan: o.plan, planSync: o.planSync, readLinearStore: o.readLinearStore, directory: o.directory, presenceOf: o.presenceOf,
    ...(o.privateTrackerKeys === undefined ? {} : { privateTrackerKeys: o.privateTrackerKeys }),
    call: (ask) => runCcrcOp({ ccrcDir: o.ccrcDir, rate: o.rate, journal: o.journal, policy: o.policy, timeoutMs: PLAN_SYNC_CALL_TIMEOUT_MS }, ask),
    now: Date.now,
  });
}
