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
  LINEAR_SYNC_PROGRAMME, UPKEEP_DUE_PREFIX, type IssueSnapshot, type MapBody, type MapEntry, type MigrationStructure, type MigrationView, type PlanEpicBody,
} from '../../../shared/plan.js';
import type { CoordinatorPresence } from '../../../shared/ledgers.js';
import type { CoordStore } from '../coord/store.js';
import type { MigrationRow, MoveRowStored, PlanStorePort } from '../coord/planStore.js';
import { EMPTY_MIGRATION_REPORT } from '../coord/planStore.js';
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
import { egress, uuidOf } from './planSyncPolicy.js';
import type { LinearStoreRead } from './store.js';
import {
  applySteps, checkMap, countsOfMap, declareMail, expectOfOwned, hierarchyStateOf, mapItemInput, migrationSettled, parseMapProposal,
  programmeOfEntry, proposeMail, putBackSteps, putBackVerdict, reconcileMove, replacementComment, reportCounts,
  reportItemInput, returnMail, startVerdict, ticketKeyOf, ticketKindOf,
  type IssueAfter, type IssueSnapshotRow, type MapContext, type MoveRow, type PlanFacts,
} from './migrationPolicy.js';

/** How long one apply tick lets a key's pass run when it waits for it (the sync's own budget is its own). */
export const MIGRATION_PASS_BUDGET_MS = 20_000;
/** D-8796 (condition 1, spec §10.6): the issue writes one apply tick starts (an adoption's pass, a close, a redo). Lane `migration`
 *  holds 100 calls an hour and the lane ticks every 30 s (120 ticks an hour); an adoption costs one update and a close up to
 *  three calls, so two a tick stays near the lane's share and the sync's own lane is never spent. The pilot's ~220 issues take
 *  about two hours. */
export const MIGRATION_WRITES_PER_TICK = 2;
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
  now: () => number;
}

type Refusal = { ok: false; word: string; detail: string };
export type OpenRead = { ok: true; workspaceId: string; rows: IssueSnapshotRow[] } | Refusal;

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

export class LinearMigration {
  private running = false;
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
  private ownerOf(team: string): { id: string | null; live: boolean; project: string } | null {
    const { plan, presenceOf } = this.deps;
    const o = linearOwnerOfTeam(team, plan.hierarchyProjectsOf(), { latestProgrammeCoordinator: (p) => plan.latestProgrammeCoordinator(p), presence: presenceOf });
    return o === null ? null : { id: o.id, live: o.live, project: o.project };
  }
  /** The workspace a team routes to, and its slot. */
  private async slotOfTeam(team: string): Promise<{ workspaceId: string; slot: SlotInfo } | null> {
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    for (const [workspaceId, slot] of slotsOf(store)) if (slot.teams.some((t) => t.key.toUpperCase() === team.toUpperCase())) return { workspaceId, slot };
    return null;
  }

  /** The team's open issues, every page up to `MIGRATION_OPEN_PAGES` (lane `migration`). */
  private async readOpenIn(workspaceId: string, slot: SlotInfo, team: string): Promise<OpenRead> {
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
      if (typeof next !== 'string') return { ok: true, workspaceId, rows };
      after = next;
    }
    return { ok: false, word: 'unreachable', detail: `team ${team} has more open issues than ${MIGRATION_OPEN_PAGES} pages` };
  }

  // ── Start (Task 7.2) ──

  /** The operator's "Reshape in Linear" (inside the mutex; `workspaceId` read before it by `workspaceOfTeam`). */
  start(project: string, workspaceId: string | null): { ok: true; migrationId: number } | Refusal {
    const { plan, coord } = this.deps;
    const team = coord.linkingOf(project).teamKey?.toUpperCase() ?? null;
    const v = startVerdict(plan.migrationsOf(), team, workspaceId);
    if (!v.ok) return v;
    if (workspaceId === null) return { ok: false, word: 'unreachable', detail: `no Linear key serves team ${team}` };
    const owning = teamOwnerProject(team!, plan.hierarchyProjectsOf()) ?? project;
    return { ok: true, migrationId: plan.insertMigration({ workspaceId, teamKey: team!, project: owning, now: this.deps.now() }) };
  }
  async workspaceOfTeam(project: string): Promise<string | null> {
    const team = this.deps.coord.linkingOf(project).teamKey;
    return team === null ? null : (await this.slotOfTeam(team))?.workspaceId ?? null;
  }

  // ── Propose (Task 7.2) ──

  /** Outside the mutex: the team's open issues, for `storeProposal`. */
  async readOpen(team: string): Promise<OpenRead> {
    const at = await this.slotOfTeam(team);
    if (at === null) return { ok: false, word: 'unreachable', detail: `no Linear key serves team ${team}` };
    return this.readOpenIn(at.workspaceId, at.slot, team);
  }

  /** Inside the mutex: the Linear owner's map, checked (`checkMap`) and stored with its snapshots, and its `decide` item raised.
   *  A follow-up map (the row `applied`, its report open) covers only the issues the apply skipped. */
  storeProposal(team: string, caller: string, body: unknown, open: Extract<OpenRead, { ok: true }>): { ok: true; migrationId: number; counts: ReturnType<typeof reportCounts> } | Refusal {
    const { plan, coord } = this.deps;
    const now = this.deps.now();
    const row = plan.migrationsOf().find((m) => m.teamKey === team && m.workspaceId === open.workspaceId && !migrationSettled(m));
    const followUp = row?.state === 'applied' ? row.report?.skipped ?? [] : null;
    if (row === undefined || (row.state !== 'proposing' && (followUp === null || followUp.length === 0))) {
      return { ok: false, word: 'plan-bad-body', detail: `no migration of team ${team} is waiting for a map` };
    }
    const owner = this.ownerOf(team);
    if (owner === null || owner.id !== caller) return { ok: false, word: 'not-linear-owner', detail: `only the Linear owner of team ${team} proposes its map` };
    const parsed = parseMapProposal(body, team);
    if (!parsed.ok) return parsed;
    const rows = followUp === null ? open.rows : open.rows.filter((r) => followUp.includes(r.identifier));
    const runs = this.runFacts();
    if (runs === null) return { ok: false, word: 'unreachable', detail: 'the runs could not be read' };
    const project = row.project ?? owner.project;
    const ctx: MapContext = {
      home: project, teamOf: (p) => coord.linkingOf(p).teamKey,
      upkeepKeys: new Set(plan.upkeepPlanOf(project).epics.flatMap((e) => e.tickets.map((t) => t.key))),
    };
    const map: MapBody = { ...parsed.map, snapshot: Object.fromEntries(rows.map((r) => [r.linearId, snapshotOf(r)])) };
    const checked = checkMap(map, rows, this.planFacts(runs.live), ctx);
    if (!checked.ok) return checked;
    const from = followUp === null ? ['proposing' as const] : ['applied' as const];
    // A follow-up joins the stored map (§10.3: it belongs to the same migration, and the same Put back covers it): its issues
    // replace their earlier entries and leave the report's skipped list, so the apply writes them.
    const stored = followUp === null || row.map === null ? map : mergeFollowUp(row.map, map);
    const report = followUp === null ? undefined : { ...(row.report ?? EMPTY_MIGRATION_REPORT()), skipped: followUp.filter((id) => !map.entries.some((e) => e.identifier === id)) };
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
        const done = settleWith('Approved: ccrc applies the map, each live programme\'s part at its wave boundary, and raises the report when it is done.',
          () => { plan.setMigration(m.id, ['proposed'], { state: 'approved' }, now); });
        return done ? { ok: true } : notOpen;
      }
      case 'return': {
        if (m.state !== 'proposed' || m.itemId !== itemId) return { ok: false, word: 'not-open', detail: `the migration is ${m.state}` };
        const owner = this.ownerOf(m.teamKey);
        const back = m.appliedAt === null ? 'proposing' as const : 'applied' as const;
        const mail = returnMail(m.id, m.teamKey, note ?? '', now);
        // A returned follow-up's issues go back to the skipped list: no move row writes them, and the owner proposes again.
        const moved = new Set(plan.movesOf(m.id).map((x) => x.identifier));
        const unwritten = (m.map?.entries ?? []).filter((e) => e.class !== 'unclear' && !moved.has(e.identifier)).map((e) => e.identifier);
        const report = { ...(m.report ?? EMPTY_MIGRATION_REPORT()), skipped: [...new Set([...(m.report?.skipped ?? []), ...unwritten])] };
        const done = settleWith('Returned to the Linear owner with your note.', () => {
          plan.setMigration(m.id, ['proposed'], back === 'proposing' ? { state: back, map: null } : { state: back, map: m.map, report }, now);
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
    const counts = after ? reportCounts(plan.movesOf(id), map, m.report?.skipped.length ?? 0) : countsOfMap(map);
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
  /** The project row's hierarchy state (§11.1): its team's newest migration in the workspace its key routes to. */
  stateOfTeam(team: string | null): ReturnType<typeof hierarchyStateOf> {
    if (team === null) return hierarchyStateOf(null);
    const m = this.deps.plan.migrationsOf().find((r) => r.teamKey.toUpperCase() === team.toUpperCase()) ?? null;
    return hierarchyStateOf(m);
  }

  // ── The lane (Tasks 7.2 to 7.4) ──

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const m of this.deps.plan.migrationsOf()) {
        if (m.state === 'proposing' || (m.state === 'applied' && m.reportDoneAt === null && (m.report?.skipped.length ?? 0) > 0 && m.putBackAskedAt === null)) this.mailForMap(m);
        if (m.state === 'approved' || m.state === 'applying') await this.applyTick(m);
        if (m.state === 'applied' && m.putBackAskedAt !== null) await this.putBackTick(m);
      }
    } finally {
      this.running = false;
    }
  }

  /** A `proposing` row: the owner is mailed for the map (or *Name a Linear owner* is raised, by the inbound lane's own item, once),
   *  and each live programme of the team with no declared plan has its coordinator mailed to declare it first (§10.1). Each mail
   *  is sent once, by its subject. A follow-up's mail names the skipped issues. */
  private mailForMap(m: MigrationRow): void {
    const { coord, plan } = this.deps;
    const now = this.deps.now();
    const owner = this.ownerOf(m.teamKey);
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
        if (home === null || !runs.live.has(p.slug) || coord.linkingOf(home).teamKey?.toUpperCase() !== m.teamKey.toUpperCase()) continue;
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
    if (m.map === null) return;
    if (m.state === 'approved' && !plan.setMigration(m.id, ['approved'], { state: 'applying' }, now)) return;
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    const slot = slotsOf(store).get(m.workspaceId);
    if (slot === undefined || this.deps.planSync.keyBlockedUntil(m.workspaceId) > now) return;
    const entries = this.deps.directory.get(slot.ref, slot.digest);
    const runs = this.runFacts();
    if (entries === null || runs === null) return;
    const map = m.map;
    const report = m.report ?? EMPTY_MIGRATION_REPORT();

    // 1. The structure the map declares: plan rows and their move rows, then the sync's pass creates and binds the objects.
    let structureBound = true;
    for (const g of [...(map.backlog ?? []).map((b) => ({ slug: b.slug, epics: b.epics, backlog: b })), ...(map.epics ?? []).map((e) => ({ slug: e.programme, epics: e.epics, backlog: null }))]) {
      if (runs.active.has(g.slug)) { structureBound = false; continue; }
      const stored = plan.planOf(g.slug);
      if (!g.epics.every((e) => stored.epics.some((s) => s.key === e.key))) {
        const diff = diffPlan(stored, { epics: g.epics }, { home: m.project ?? '', doneWhenCount: 0, workspaceOfProject: () => m.workspaceId });
        if (!diff.ok) continue;
        plan.declareMapStructure(m.id, g.slug, diff.changes, 'ccrc-migration', now, g.backlog === null ? null : { home: m.project ?? '', title: g.backlog.title, state: 'paused' });
      }
      if (!this.fillCreated(m, g.slug)) {
        await this.deps.planSync.passFor(g.slug, now + MIGRATION_PASS_BUDGET_MS).catch(() => 'deferred');
        if (!this.fillCreated(m, g.slug)) structureBound = false;
      }
    }

    // 2. The issues: one read of the team's open issues, then each listed issue in Task 7.1's order.
    const open = await this.readOpenIn(m.workspaceId, slot, m.teamKey);
    if (!open.ok) return;
    const reread = new Map<string, IssueSnapshot | 'closed'>(map.entries.map((e) => [e.issue, 'closed' as const]));
    for (const r of open.rows) if (reread.has(r.linearId)) reread.set(r.linearId, snapshotOf(r));
    const moves = new Map(plan.movesOf(m.id).map((x) => [x.subject, x]));
    const skipped = new Set(report.skipped);
    const fresh: MapBody = { ...map, entries: map.entries.filter((e) => !moves.has(`issue:${e.issue}`) && !skipped.has(e.identifier)) };

    let budget = MIGRATION_WRITES_PER_TICK;
    // A row written before a crash: reconciled against the fresh read (D-8795's reconcileMove).
    for (const e of map.entries) {
      const row = moves.get(`issue:${e.issue}`);
      if (row === undefined || row.appliedAt !== null) continue;
      const seen = reread.get(e.issue) ?? 'closed';
      const v = reconcileMove(asMoveRow(row), seen);
      if (v === 'applied') plan.setMove(row.id, { appliedAt: now });
      else if (v === 'skip') skipped.add(e.identifier);
      else if (budget > 0) {
        budget -= 1;
        if (CLOSERS.has(e.class)) await this.closeIssue(m, e, row, slot, entries);
        else await this.deps.planSync.passFor(String(row.after['key'] ?? ''), now + MIGRATION_PASS_BUDGET_MS).catch(() => 'deferred');
      }
    }

    const live = structureBound ? runs.active : new Set([...runs.active, ...(map.epics ?? []).map((g) => g.programme), ...(map.backlog ?? []).map((g) => g.slug)]);
    const steps = applySteps(fresh, live, reread, (e) => (CLOSERS.has(e.class) || e.class === 'leaf' || e.class === 'upkeep' ? { expect: {} } : null));
    for (const id of steps.skipped) skipped.add(map.entries.find((e) => e.issue === id)?.identifier ?? id);
    for (const step of steps.now) {
      if (budget <= 0) break;
      budget -= 1;
      const e = map.entries.find((x) => x.issue === step.linearId)!;
      const before = step.before!;
      if (CLOSERS.has(e.class)) {
        const row = plan.insertMove({ migrationId: m.id, subject: `issue:${e.issue}`, kind: 'issue', linearId: e.issue, identifier: e.identifier, before, after: this.closeAfter(e) });
        await this.closeIssue(m, e, row, slot, entries);
      } else {
        // An Upkeep issue is placed in the project's Upkeep epic, whose Linear project the sync must have created first: a ticket
        // is placeable only under a bound epic (`plannedOwnedNow` answers null before it).
        if (e.class === 'upkeep' && !(await this.upkeepBound(m, now))) continue;
        const key = await this.adopt(m, e, before, store);
        if (key === null) continue;
        await this.deps.planSync.passFor(key, now + MIGRATION_PASS_BUDGET_MS).catch(() => 'deferred');
      }
    }
    const waiting = [...steps.waiting].map((id) => map.entries.find((e) => e.issue === id)?.identifier ?? id);
    const nextReport = { ...report, skipped: [...skipped], waiting };
    plan.setMigration(m.id, ['applying'], { report: nextReport }, now);

    // 3. Done (D-8796 condition 4) when nothing waits, every structure object is bound, no listed issue is left unwritten, and
    //    every move row is applied or its issue is skipped and listed; a row still waiting on its pass holds `applying`.
    const all = plan.movesOf(m.id);
    const unwritten = fresh.entries.some((e) => e.class !== 'unclear' && !skipped.has(e.identifier) && !all.some((x) => x.subject === `issue:${e.issue}`));
    const pending = all.some((x) => x.appliedAt === null && !(x.identifier !== null && skipped.has(x.identifier)));
    if (waiting.length > 0 || !structureBound || unwritten || pending) return;
    this.finishApply(m, map, nextReport, all, now);
  }

  /** The move rows of a programme's created objects take their Linear ids from the bindings the pass made (D-8796). True when
   *  every one of them is filled. */
  private fillCreated(m: MigrationRow, slug: string): boolean {
    const { plan } = this.deps;
    // A key `upkeep:<project>` is the project's Upkeep epic (no programme row); any other key is a programme's slug.
    const upkeep = slug.startsWith(UPKEEP_DUE_PREFIX);
    const rowid = upkeep ? null : plan.programmeRowId(slug);
    const stored = upkeep ? plan.upkeepPlanOf(slug.slice(UPKEEP_DUE_PREFIX.length)) : plan.planOf(slug);
    const ids = new Set<string>([...(rowid === null ? [] : [`programme:${rowid}`]), ...stored.epics.flatMap((e) => [`epic:${e.id}`, ...e.checkpoints.map((c) => `checkpoint:${c.id}`)])]);
    const bindings = plan.bindingsOf(slug);
    let all = true;
    for (const row of plan.movesOf(m.id)) {
      if (row.before !== null || !ids.has(row.subject) || row.appliedAt !== null) continue;
      const [kind, localId] = row.subject.split(':');
      const b = bindings.find((x) => x.localKind === kind && x.localId === Number(localId) && x.workspaceId === m.workspaceId && x.state === 'bound' && x.linearId !== null);
      if (b === undefined) { all = false; continue; }
      plan.setMove(row.id, { linearId: b.linearId!, appliedAt: this.deps.now() });
    }
    return all;
  }

  /** The project's Upkeep epic, created (with its move row, `before` null) in one transaction when it is missing, and its Linear
   *  objects created by the sync's pass for `upkeep:<project>` (outside any flight of ours: `passFor` joins the key's flight). True
   *  when the epic is bound; its move row then holds its Linear id. A false answer waits for the next tick. */
  private async upkeepBound(m: MigrationRow, now: number): Promise<boolean> {
    const { plan, coord, planSync } = this.deps;
    const project = m.project ?? '';
    const key = `${UPKEEP_DUE_PREFIX}${project}`;
    tx(coord.db, () => {
      const had = plan.upkeepEpicOf(project);
      const epicId = plan.ensureUpkeepEpicInTx(project, now);
      if (had === null) plan.insertMove({ migrationId: m.id, subject: `epic:${epicId}`, kind: 'epic', linearId: null, identifier: null, before: null, after: { created: true } });
    });
    const epicId = plan.upkeepEpicOf(project)!.id;
    const bound = (): boolean => plan.bindingsOf(key).some((b) => b.localKind === 'epic' && b.localId === epicId && b.workspaceId === m.workspaceId && b.state === 'bound' && b.linearId !== null);
    if (!bound()) {
      plan.markSyncDue(key, now);
      await planSync.passFor(key, now + MIGRATION_PASS_BUDGET_MS).catch(() => 'deferred');
    }
    this.fillCreated(m, key);
    return bound();
  }

  /** A leaf or upkeep issue adopted with its move row in ONE transaction (D-8796): the move's `after.expect` is the sync's planned
   *  owned fields for the new binding. The key whose pass sends the update, or null when it is not placeable now (rolled back). */
  private async adopt(m: MigrationRow, e: MapEntry, before: IssueSnapshot, store: LinearStoreRead): Promise<string | null> {
    const { plan, planSync, coord } = this.deps;
    const programme = e.class === 'leaf' ? programmeOfEntry(e) : null;
    const project = m.project ?? '';
    const key = programme ?? `${UPKEEP_DUE_PREFIX}${project}`;
    return planSync.withFlight(key, async () => {
      try {
        return tx(coord.db, () => {
          const now = this.deps.now();
          let epicId: number;
          let checkpointId: number | null = null;
          if (programme === null) {
            const had = plan.upkeepEpicOf(project);
            epicId = plan.ensureUpkeepEpicInTx(project, now);
            if (had === null) plan.insertMove({ migrationId: m.id, subject: `epic:${epicId}`, kind: 'epic', linearId: null, identifier: null, before: null, after: { created: true } });
          } else {
            const epic = plan.planOf(programme).epics.find((x) => x.key === e.target!.epic && x.state !== 'dropped' && x.putBackAt === null);
            if (epic === undefined) throw new Error('not-placeable');
            epicId = epic.id;
            if (e.target?.checkpoint !== undefined) checkpointId = epic.checkpoints.find((c) => c.key === e.target!.checkpoint)?.id ?? null;
          }
          const ticketId = plan.adoptIssueAsTicketInTx({
            issue: { ...before, linearId: e.issue, identifier: e.identifier }, programme, epicId, checkpointId, key: ticketKeyOf(e), kind: ticketKindOf(e),
            source: e.class === 'leaf' ? 'plan' : 'inbound', mask: this.deps.mask ?? linearEgressText,
          }, { workspaceId: m.workspaceId, teamKey: before.team }, now);
          const binding = plan.bindingOf('ticket', ticketId, m.workspaceId);
          const owned = binding === null ? null : planSync.plannedOwnedNow(key, store, binding.id);
          if (binding === null || owned === null) throw new Error('not-placeable');
          const after: IssueAfter = { expect: expectOfOwned(owned.owned), ticketId, bindingId: binding.id, key };
          plan.insertMove({ migrationId: m.id, subject: `issue:${e.issue}`, kind: 'issue', linearId: e.issue, identifier: e.identifier, before, after });
          return key;
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'not-placeable') return null;
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
   *  write leaves the row unapplied; the next tick reconciles it. */
  private async closeIssue(m: MigrationRow, e: MapEntry, row: MoveRowStored, slot: SlotInfo, entries: NonNullable<ReturnType<LinearDirectoryRead['get']>>): Promise<void> {
    const { plan } = this.deps;
    const state = String((row.after['expect'] as Record<string, unknown> | undefined)?.['state'] ?? 'canceled');
    const status = statusOfType(entries, 'issue', state, m.teamKey);
    if (status === null) return;
    const base = { pass: 'migration', lane: 'migration', slot: slot.ref, workspaceId: m.workspaceId, teamKey: m.teamKey, target: e.identifier } as const;
    await this.deps.planSync.withFlight(`migration:${e.issue}`, async () => {
      const home = this.homeTitle(e);
      const mode = this.deps.coord.linkingOf(m.project ?? '').mode;
      const text = e.class === 'finished' ? 'ccrc\'s migration closed this issue as finished; its evidence is on the issue.'
        : e.class === 'stale' ? 'ccrc\'s migration closed this issue as stale, as the approved map says; nothing was deleted.'
          : e.class === 'superseded' ? 'ccrc\'s migration closed this issue as superseded by the related issue; nothing was deleted.'
            : replacementComment(home, mode, null);
      const comment = await this.deps.call({ ...base, op: 'issueComment', fields: ['body'], input: { requestId: uuidOf(`migration:${m.id}:${e.issue}:comment`), issueId: e.issue, body: withCcrcProvenance(egress(text)) } });
      if (!comment.ok && !(comment.word === 'linear-invalid' && comment.detail === 'conflict')) return;
      const related = e.class === 'superseded' ? e.target?.successor ?? null : CLOSERS.has(e.class) && e.class !== 'finished' && e.class !== 'stale' ? this.firstTicketUnder(m, e) : null;
      if (related !== null) {
        // A relation is evidence, not the close: a refused one is not retried and does not stop the close.
        await this.deps.call({ ...base, op: 'issueRelationCreate', fields: ['type', 'related'], input: { issueId: e.issue, relatedIssueId: related, type: 'related' } });
      }
      const update = await this.deps.call({ ...base, op: 'issueUpdate', fields: ['state'], input: { id: e.issue, stateId: status.id } });
      if (update.ok) plan.setMove(row.id, { appliedAt: this.deps.now() });
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
  /** The first issue placed under a replaced level's home, by its applied move row (the relation's other end), or null. */
  private firstTicketUnder(m: MigrationRow, e: MapEntry): string | null {
    const t = e.target ?? {};
    const placed = (m.map?.entries ?? []).find((x) => x.class === 'leaf' && x.target?.programme === t.programme
      && (e.class === 'programme' || x.target?.epic === t.epic) && (e.class !== 'checkpoint' || x.target?.checkpoint === t.checkpoint));
    return placed?.issue ?? null;
  }

  private finishApply(m: MigrationRow, map: MapBody, report: NonNullable<MigrationRow['report']>, moves: readonly MoveRowStored[], now: number): void {
    const { plan, coord } = this.deps;
    const counts = reportCounts(moves, map, report.skipped.length);
    const programmes = [...new Set([...map.entries.flatMap((e) => (programmeOfEntry(e) === null ? [] : [programmeOfEntry(e)!])),
      ...(map.epics ?? []).map((g) => g.programme), ...(map.backlog ?? []).map((g) => g.slug)])];
    coord.raiseItemWithMail(reportItemInput(m.id, m.teamKey, counts), now, 'ccrc', (reportItemId) => {
      if (!plan.setMigration(m.id, ['applying'], { state: 'applied', appliedAt: m.appliedAt ?? now, reportItemId, report }, now)) throw new Error(`migration ${m.id} moved while it was finished`);
      plan.setPlanRequired(programmes);
    });
    // A follow-up's earlier report closes after the new one is raised: `moveItem` opens its own transaction (`tx` does not nest),
    // so it cannot run inside `raiseItemWithMail`'s.
    if (m.reportItemId !== null) coord.moveItem(m.reportItemId, 'settle', 'ccrc', { note: 'A follow-up map was applied: its report follows.' }, now, { programmeHasOpenRun: false });
  }

  /** Put back (Task 7.4): from the move record alone, last move first, inside each key's flight. The ccrc half first (the records
   *  dropped "put back", `putBackAt` set, so the sync emits nothing for them), then Linear's: each moved issue restored, each
   *  created initiative and project canceled; a created milestone stays under its canceled project (D-8795); an issue moved since
   *  is listed and untouched. */
  private async putBackTick(m: MigrationRow): Promise<void> {
    const { plan } = this.deps;
    const now = this.deps.now();
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    const slot = slotsOf(store).get(m.workspaceId);
    if (slot === undefined || this.deps.planSync.keyBlockedUntil(m.workspaceId) > now) return;
    const entries = this.deps.directory.get(slot.ref, slot.digest);
    if (entries === null) return;
    const moves = plan.movesOf(m.id);
    // The ccrc half: what the migration made in the plan, dropped in one transaction.
    const local = (kind: string) => moves.filter((x) => x.before === null && x.subject.startsWith(`${kind}:`)).map((x) => Number(x.subject.split(':')[1]));
    plan.dropPutBack({ epics: local('epic'), checkpoints: local('checkpoint'), tickets: moves.flatMap((x) => (typeof x.after['ticketId'] === 'number' ? [x.after['ticketId']] : [])) }, now);
    // The current state of every moved issue, by id.
    const current = new Map<string, IssueSnapshot>();
    for (const x of moves) {
      if (x.kind !== 'issue' || x.linearId === null || x.revertedAt !== null) continue;
      const out = await this.deps.call({ op: 'issueOwned', pass: 'put-back', lane: 'migration', slot: slot.ref, workspaceId: m.workspaceId, teamKey: m.teamKey, target: null, fields: [], input: { id: x.linearId } });
      if (!out.ok) { if (out.word === 'not-found') continue; return; }
      const r = rowOf(out.value['issue']);
      if (r !== null) current.set(r.linearId, snapshotOf(r));
    }
    const { steps, moved, left } = putBackSteps(moves.filter((x) => x.revertedAt === null).map(asMoveRow), current);
    let done = true;
    for (const step of steps) {
      const row = moves.find((x) => x.linearId === step.linearId && (step.before === null) === (x.before === null))!;
      const ok = await this.putBackStep(m, step, row, slot, entries);
      if (ok) plan.setMove(row.id, { revertedAt: this.deps.now() });
      else done = false;
    }
    if (!done) return;
    const ident = (id: string) => moves.find((x) => x.linearId === id)?.identifier ?? id;
    const report = { ...(m.report ?? EMPTY_MIGRATION_REPORT()), movedSince: moved.map(ident), milestonesLeft: left };
    plan.setMigration(m.id, ['applied'], { state: 'put-back', putBackAt: now, report }, now);
  }

  private async putBackStep(m: MigrationRow, step: ReturnType<typeof putBackSteps>['steps'][number], row: MoveRowStored, slot: SlotInfo, entries: NonNullable<ReturnType<LinearDirectoryRead['get']>>): Promise<boolean> {
    if (step.linearId === null) return true;
    const base = { pass: 'put-back', lane: 'migration', slot: slot.ref, workspaceId: m.workspaceId, teamKey: m.teamKey } as const;
    if (step.op === 'initiativeUpdate') {
      const out = await this.deps.call({ ...base, op: 'initiativeUpdate', target: step.linearId, fields: ['status'], input: { id: step.linearId, status: 'Canceled' } });
      return out.ok;
    }
    if (step.op === 'projectUpdate') {
      const st = statusOfType(entries, 'project', 'canceled', null);
      if (st === null) return false;
      const out = await this.deps.call({ ...base, op: 'projectUpdate', target: step.linearId, fields: ['status'], input: { id: step.linearId, statusId: st.id } });
      return out.ok;
    }
    const was = row.before!;
    const team = slot.teams.find((t) => t.key.toUpperCase() === was.team.toUpperCase());
    const state = statusOfType(entries, 'issue', was.state, was.team);
    if (team === undefined || state === null) return false;
    const key = typeof row.after['key'] === 'string' ? row.after['key'] : `migration:${step.linearId}`;
    return this.deps.planSync.withFlight(key, async () => {
      const out = await this.deps.call({
        ...base, op: 'issueUpdate', target: row.identifier, destinationTeamKey: was.team, fields: ['title', 'description', 'state', 'project', 'milestone', 'team', 'parent'],
        input: { id: step.linearId, teamId: team.id, stateId: state.id, projectId: was.project, projectMilestoneId: was.milestone, parentId: was.parent, title: was.title, description: was.description },
      });
      return out.ok;
    });
  }
}

/** The migration as `index.ts` builds it (D-8186): Linear reached through `runCcrcOp` with the one rate service, journal and
 *  policy, as the plan sync and the drift pass reach it. */
export function linearMigrationFor(o: {
  coord: CoordStore; plan: PlanStorePort; planSync: LinearMigrationDeps['planSync']; ccrcDir: string; rate: LinearRateService;
  journal: LinearJournal; policy: LinearWritePolicy; readLinearStore: LinearMigrationDeps['readLinearStore'];
  directory: LinearDirectoryRead; presenceOf: (id: string) => CoordinatorPresence;
}): LinearMigration {
  return new LinearMigration({
    coord: o.coord, plan: o.plan, planSync: o.planSync, readLinearStore: o.readLinearStore, directory: o.directory, presenceOf: o.presenceOf,
    call: (ask) => runCcrcOp({ ccrcDir: o.ccrcDir, rate: o.rate, journal: o.journal, policy: o.policy, timeoutMs: PLAN_SYNC_CALL_TIMEOUT_MS }, ask),
    now: Date.now,
  });
}
