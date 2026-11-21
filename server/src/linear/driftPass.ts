/**
 * THE DRIFT PASS (D-8183; Linear hierarchy design 2026-11-10 §6.2, §7.2 to §7.4): it reads what changed in a managed team's
 * Linear since its last look, compares each changed object ccrc holds a binding for against what the plan says it should be
 * (the owned fields, `driftPolicy.ts`), and puts the plan's value back. L4 DELIVERY around `driftPolicy.ts`'s pure deciders: it
 * decides nothing (`driftedFields`, `driftVerdict`, `graceVerdict`, `graceRereads`, `restorableFields`, `missingLinksVerdict`,
 * `eventVerdict`, `isNewUnrestorable`, `sweepStep`, `isPersistent`, `shouldRaiseDriftItem`, `closedByKeep`, `handRoute` and `commentDue` do, review
 * 2386 F7), it only reads, asks, restores and records.
 *
 * INERT UNTIL A TEAM IS MANAGED. A team is managed once a `linear_migrations` row for it reads `applied` (wave 7): with none,
 * a tick makes no call at all. One workspace is taken per tick, the one whose `passAt` is oldest and at least
 * `DRIFT_PASS_MS` old; its mark (`linear_drift_marks`) holds one watermark per changed* kind (the newest `updatedAt` that
 * kind's read returned) and when it last ran. A read that fails keeps the old watermarks and tries again after the period; a
 * kind one of whose restores was deferred keeps its own. A kind whose read reached the page cap keeps its sweep in
 * `linear_drift_cursors` and the next pass goes on from it; its watermark moves when the sweep ends, never past the sweep's start
 * less a margin (review 2408 F3, D-8734; `driftPolicy.ts#sweepStep`). An issue whose one grace stands
 * (§7.3) is re-read by id at every pass until it ends, since an issue that does not change again is never in a changed read.
 *
 * EVERY LINEAR VALUE IT READS IS DATA. Nodes are the shaped answers of `hierarchyOps.ts` (closed grammar); a value is stored
 * as text (`driftValueText`), and it reaches an operator item or a mail only inside `untrustedBlock` under
 * `LINEAR_TEXT_PREFACE`, never in a title or a fixed sentence. The changed* documents select no actor, so every event's actor is
 * `not read` (departure D-8703, drift-actor-unread).
 *
 * ONE WRITER. Every write to a ccrc object in Linear is the sync's, through `PlanSync#restore`, in the programme's flight: the
 * pass never calls a write op itself, and a sync write that landed after this pass read the plan makes the restore moot. A
 * difference on a binding whose stored fingerprint is not the plan's current one is the sync not having written the plan yet
 * (D-8704): the programme is marked due through `markSyncDue` alone (so a programme a failure's backoff holds stays held) and
 * nothing is sent. What no update can put back (a project's milestones, a milestone's project) is recorded, never restored, and
 * raises the operator's item at once; so does a refused restore and the third restore of one binding within a week.
 */
import type { CoordStore } from '../coord/store.js';
import type { BindingRow, DriftCursor, DriftKindWord, DriftWatermarks, InboundRow, PlanStorePort } from '../coord/planStore.js';
import { linearOwnerOfProject } from '../coord/planPolicy.js';
import { HIERARCHY_ITEM_REFUSALS, type HierarchyItemRefusal } from '../../../shared/refusal.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import { UNTRUSTED_CAP_BYTES, untrustedBlock } from '../coord/untrusted.js';
import type { RaiseItemInput } from '../coord/ledgersStore.js';
import { runPrMerged } from '../coord/doneTestRead.js';
import { LINEAR_SYNC_PROGRAMME, UPKEEP_DUE_PREFIX, type BindingKind } from '../../../shared/plan.js';
import { OPEN_ITEM_STATES, type CoordinatorPresence } from '../../../shared/ledgers.js';
import { runCcrcOp, type CcrcOpAsk, type CcrcOpOutcome } from './ccrcCall.js';
import type { LinearJournal } from './journal.js';
import type { LinearWritePolicy } from './policy.js';
import type { LinearRateService } from './rate.js';
import type { FleetSession } from '../../../shared/api.js';
import {
  DRIFT_PASS_MS, DRIFT_PERSIST, driftReadHeld, driftScoped, keepIssueNode, milestonesJudged, syncWroteSince, LINEAR_TEXT_PREFACE, commentDue, driftValueText, driftVerdict, driftedFields, eventVerdict, graceRereads,
  graceVerdict, isNewUnrestorable, isPersistent, missingLinksVerdict, restorableFields, restoreCommentOf, restoreSides, restoredLine, driftEventValue, driftEventText, type NameFacts,
  shouldRaiseDriftItem, type DriftKind, type DriftRaiseWhy, type OwnedFields,
  DRIFT_KEEP_NOTE, bindingByLinearIdOf, closedByKeep, driftCursorAfterFailure, handRoute, restoreFallbackCommentOf, sweepStep,
} from './driftPolicy.js';
import { PLAN_SYNC_CALL_TIMEOUT_MS, slotsOf, type PlanSync, type RestoreOutcome, type RestoreTarget, type SlotInfo } from './planSync.js';
import { requestIdOf, type PlannedOwned } from './planSyncPolicy.js';
import type { LinearStoreRead } from './store.js';
import type { LinearRouteSlot } from './route.js';
import type { LinearDirectoryRead } from './directory.js';
import { InboundLane } from './inboundLane.js';
import type { InboundRecheck } from './inboundPolicy.js';

/** The most pages of one document a pass follows (a runaway guard): past it the pass keeps a cursor and the next pass goes on
 *  from it (`sweepStep`, review 2408 F3, D-8734). */
export const DRIFT_MAX_PAGES = 10;
/** Every event's actor: the changed* documents select none, and `ops.ts` is frozen (D-8703). */
const NOT_READ = 'not read';

export interface DriftPassDeps {
  coord: CoordStore;
  plan: PlanStorePort;
  planSync: PlanSync;
  readLinearStore: () => Promise<LinearStoreRead>;
  call: (ask: CcrcOpAsk) => Promise<CcrcOpOutcome>;
  now: () => number;
  /** The inbound path's (D-8183, `inboundLane.ts`): a coordinator's standing (an owner who is gone raises the item), and which of
   *  these issue identifiers a session's own create made. */
  presenceOf: (id: string) => CoordinatorPresence;
  viaFleet: (identifiers: readonly string[]) => ReadonlySet<string>;
  /** A workspace's directory, for the `canceled` status an inbound close moves its issue to; absent (a test): a close is never acted. */
  directory?: LinearDirectoryRead;
  /** Whether the run's pull request is recorded merged (an issue Linear reads `completed` by the integration, not drift). */
  prMergedOf?: (runId: number) => boolean;
}

type Node = Record<string, unknown>;
const READS = [
  { op: 'changedInitiatives', kind: 'initiative' }, { op: 'changedProjects', kind: 'project' },
  { op: 'changedMilestones', kind: 'milestone' }, { op: 'changedIssues', kind: 'issue' },
] as const;
const LOCAL_OF: Readonly<Record<DriftKind, BindingKind>> = { initiative: 'programme', project: 'epic', milestone: 'checkpoint', issue: 'ticket' };
const KIND_OF: Readonly<Record<BindingKind, DriftKind>> = { programme: 'initiative', epic: 'project', checkpoint: 'milestone', ticket: 'issue' };
/** What an operator calls each kind (the plan's words, never Linear's). */
const WORD: Readonly<Record<DriftKind, string>> = { initiative: 'programme', project: 'epic', milestone: 'checkpoint', issue: 'ticket' };

/** One binding to put back. */
interface TargetSpec { binding: BindingRow; kind: DriftKind; local: PlannedOwned['local']; fields: string[]; linear: OwnedFields; planned: OwnedFields; link: boolean; node: Node; holdState: boolean }
/** One difference found: restored when every target in `via` is, never restored when `via` is empty. */
interface EventSpec { binding: BindingRow; kind: DriftKind; local: PlannedOwned['local']; field: string; value: string; via: number[] }
interface Work { targets: Map<number, TargetSpec>; events: EventSpec[] }
type Planned = { bindings: BindingRow[]; owned: PlannedOwned[] };

export class DriftPass {
  private running = false;
  private readonly inbound: InboundLane;

  constructor(private readonly deps: DriftPassDeps) { this.inbound = new InboundLane(deps); }

  // ── The tick ──

  /** One beat: take at most one workspace, the one longest unread that is due, and run its pass; then, every beat whether a pass
   *  ran or not, the inbound lane's routing and acts (D-8183), after the pass so an issue it just found is mailed in the same beat.
   *  A pass that throws still lets the lane run, and throws afterwards. A tick that finds another in flight (a lane the runner
   *  restarted) returns at once. */
  async tick(now: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    let failure: { error: unknown } | null = null;
    try {
      try {
        const ws = await this.dueWorkspace(now);
        if (ws !== null) await this.passOf(ws.workspaceId, ws.slot, ws.teams, now);
      } catch (error) { failure = { error }; }
      await this.inbound.tick(now);
    } finally { this.running = false; }
    if (failure !== null) throw failure.error;
  }

  private async dueWorkspace(now: number): Promise<{ workspaceId: string; slot: SlotInfo; teams: string[] } | null> {
    const managed = this.deps.plan.managedTeams();
    if (managed.length === 0) return null;
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    const slots = slotsOf(store);
    const byWs = new Map<string, string[]>();
    for (const m of managed) byWs.set(m.workspaceId, [...(byWs.get(m.workspaceId) ?? []), m.teamKey]);
    let best: { workspaceId: string; slot: SlotInfo; teams: string[]; at: number } | null = null;
    for (const [workspaceId, teams] of byWs) {
      const slot = slots.get(workspaceId);
      if (slot === undefined) continue;
      if (driftReadHeld(this.deps.planSync.keyBlockedUntil(workspaceId), now)) continue;     // a refused key holds this lane too (A-3)
      const mark = this.deps.plan.driftMarkOf(workspaceId);
      const at = mark === null ? Number.NEGATIVE_INFINITY : mark.passAt;
      if (mark !== null && at + DRIFT_PASS_MS > now) continue;
      if (best === null || at < best.at) best = { workspaceId, slot, teams, at };
    }
    return best;
  }

  // ── One pass of one workspace ──

  private async passOf(ws: string, slot: SlotInfo, teams: string[], now: number): Promise<void> {
    const { plan } = this.deps;
    const mark = plan.driftMarkOf(ws);
    const first = new Date(plan.managedSince(ws) ?? now).toISOString();
    const old: DriftWatermarks = mark?.watermarks ?? { initiative: first, project: first, milestone: first, issue: first };
    // Round 5 F1: ccrc's own record is read BEFORE Linear. A sync write landing after the Linear read moves a binding's fingerprint,
    // and that is seen below as a change since this read; comparing `updatedAt` instead would set Linear's clock against ccrc's.
    // Two bindings holding one Linear id: the lowest id is the binding, the store's own rule (`bindingByLinearIdOf`, review 2524 F3).
    const pre: ReadonlyMap<string, BindingRow> = bindingByLinearIdOf(plan.bindingsInWorkspace(ws));
    const cursors = plan.driftCursorsOf(ws);
    const read = await this.readAll(ws, slot, old, cursors);
    if (!read.ok) {
      if (read.word === 'linear-unauthorised') this.deps.planSync.keyRefusedByRead(ws, slot);      // the one owner holds both lanes (A-3)
      // A cursor Linear refused, or an answer that cannot be read, is stale and would wedge its kind for good: the sweep restarts
      // from the mark. Any other word keeps it for the retry (D-8734; decided in `driftCursorAfterFailure`).
      if (cursors[read.kind] !== undefined && driftCursorAfterFailure(read.word) === 'drop') plan.setDriftCursor(ws, read.kind, null);
      plan.setDriftMark(ws, old, now);
      console.warn(`ccrc-server: linear drift pass read failed: ${read.word}`);
      return;
    }
    if (READS.some(({ kind }) => read.next[kind] !== null)) console.warn('ccrc-server: linear drift pass page cap reached');
    // A kind is kept here for a deferred restore alone; a read stopped at the page cap is `sweepStep`'s (a cursor, D-8734).
    const keep: Record<DriftKind, boolean> = { initiative: false, project: false, milestone: false, issue: false };
    this.deps.planSync.keyReadAnswered(ws);
    const managed = new Set(teams.map((t) => t.toUpperCase()));
    // D-8733 (drift-reads-every-team): the issue read spans every team the slot lists (a bound issue moved out must still be read);
    // what is of an unmanaged team and held by no binding is dropped here, so nothing of it is stored, journalled, logged, mailed or
    // counted. The watermark still reads the dropped nodes' `updatedAt` (`read.changed` is untouched): that stores nothing, and a
    // watermark held back for a node never kept would re-read it at every pass; a node that later moves into a managed team
    // changes `updatedAt` again, so no change is skipped.
    const boundIds = new Set(pre.keys());
    read.nodes.issue = read.nodes.issue.filter((n) => keepIssueNode({ teamKey: n['teamKey'], linearId: n['id'], managed, boundIds }));
    await this.rereadGraced(ws, slot, read.nodes.issue);
    const planned = new Map<string, Promise<Planned | null>>();
    const plannedOf = (key: string): Promise<Planned | null> => {
      const hit = planned.get(key);
      if (hit !== undefined) return hit;
      const p = this.deps.planSync.plannedOwned(key);
      planned.set(key, p);
      return p;
    };
    const work = new Map<string, Work>();
    const workOf = (key: string): Work => { const w = work.get(key) ?? { targets: new Map(), events: [] }; work.set(key, w); return w; };

    for (const { kind } of READS) {
      for (const node of read.nodes[kind]) {
        const id = typeof node['id'] === 'string' ? node['id'] : null;
        const binding = id === null ? null : pre.get(id) ?? null;
        if (binding === null || binding.localKind !== LOCAL_OF[kind]) continue;
        // A sync write landed after the Linear read: skip the node whole (no event, no restore, no record); its write moved
        // Linear's `updatedAt`, so the next pass reads it. A node with no pre-read binding was bound after the read: not compared.
        if (syncWroteSince(binding, plan.bindingByLinearId(ws, id!))) continue;
        const key = plan.dueKeyOfBinding(binding.id);
        const p = key === null ? null : await plannedOf(key);
        if (key === null || p === null) continue;
        const po = p.owned.find((o) => o.bindingId === binding.id && o.kind === kind);
        if (po === undefined) continue;
        if (!this.scoped(ws, kind, binding, po, p, managed)) continue;
        this.compare(ws, key, kind, node, binding, po, p, now, workOf(key), pre);
      }
    }

    // D-8183: an issue no binding holds, filed in a managed team outside ccrc, is inbound (the lane stores it; the beat mails it).
    this.inbound.detect(ws, read.nodes.issue, managed, now);
    await this.inbound.recheckStored(ws, slot, new Set(read.nodes.issue.flatMap((n) => (typeof n['id'] === 'string' ? [n['id']] : []))), now);   // review 2457 F4

    // One restore per programme key, then each outcome recorded.
    const raise: { binding: BindingRow; kind: DriftKind; key: string; why: DriftRaiseWhy; word: string | null }[] = [];
    const restoredNow = new Map<number, { binding: BindingRow; kind: DriftKind; key: string }>();
    for (const [key, w] of work) {
      const specs = [...w.targets.values()];
      const facts = specs.length === 0 ? null : this.namesFor(ws, slot, await plannedOf(key));
      const outcomes = facts === null ? [] : await this.deps.planSync.restore(key, specs.map((s) => this.targetOf(ws, s, now, facts)), 'drift-restore');
      const byId = new Map<number, RestoreOutcome>(outcomes.map((o) => [o.bindingId, o]));
      // A deferred target keeps the watermark of its own kind and of every event that rides on it (review 2394 N2: an initiative's
      // missing link rides on its project's restore, so the initiative must be read again too).
      for (const o of outcomes) {
        if (o.outcome !== 'deferred') continue;
        const t = w.targets.get(o.bindingId);
        if (t !== undefined) keep[t.kind] = true;
        for (const ev of w.events) if (ev.via.includes(o.bindingId)) keep[ev.kind] = true;
      }
      const commentedOnce = new Set<number>();
      for (const ev of w.events) {
        const verdict = eventVerdict(ev.via, byId);
        if (verdict.kind === 'skip') continue;
        const restored = verdict.kind === 'restored';
        // One change is recorded once: a difference no update can put back, read again after a deferral, is not a second (A4).
        if (verdict.kind === 'unrestorable' && !isNewUnrestorable(plan.lastDriftEventOf(ev.binding.id, ev.field), ev.value)) continue;
        const eventId = plan.recordDrift({ bindingId: ev.binding.id, at: now, field: ev.field, value: ev.value, actor: NOT_READ, restored });
        if (restored) {
          const commented = byId.get(ev.binding.id)?.commented === true;
          if (commented && !commentedOnce.has(ev.binding.id)) { plan.markDriftCommented(eventId, now); commentedOnce.add(ev.binding.id); }
          restoredNow.set(ev.binding.id, { binding: ev.binding, kind: ev.kind, key });
        } else {
          raise.push({ binding: ev.binding, kind: ev.kind, key, why: verdict.kind === 'refused' ? 'refused' : 'unrestorable', word: verdict.kind === 'refused' ? verdict.word : null });
        }
      }
    }
    for (const r of raise) this.raiseItem(r.binding, r.kind, r.key, r.why, r.word, now);
    for (const [bindingId, r] of restoredNow) {
      const restores = [...new Set(plan.driftRestoresOf(bindingId, now - DRIFT_PERSIST.windowMs))];
      if (isPersistent(restores, now)) this.raiseItem(r.binding, r.kind, r.key, 'restored', null, now);
    }
    // The cursors are written before the mark: a stop between them leaves a cursor over an old mark (a sweep read again from its
    // start or goes on, both safe), never a moved mark over a cursor that has lost its sweep.
    const next = { ...old };
    for (const { kind } of READS) {
      const step = sweepStep({ old: old[kind], cursor: cursors[kind] ?? null, newest: newestOf(read.changed[kind]), next: read.next[kind], keep: keep[kind], now });
      next[kind] = step.watermark;
      if (step.cursor !== null || cursors[kind] !== undefined) plan.setDriftCursor(ws, kind, step.cursor);
    }
    plan.setDriftMark(ws, next, now);
  }

  /** §7.3's grace, its second look (review 2386 F1): every ticket binding of the workspace whose grace stands and whose issue the
   *  changed read did not return is read by id (`issueOwned`) and compared with the rest. A read that fails leaves the grace
   *  standing, to be read at the next pass. */
  private async rereadGraced(ws: string, slot: SlotInfo, issues: Node[]): Promise<void> {
    const graced = this.deps.plan.graceBindingsOf(ws);
    const read = new Set(issues.flatMap((n) => (typeof n['id'] === 'string' ? [n['id']] : [])));
    for (const id of graceRereads(graced.flatMap((b) => (b.linearId === null ? [] : [b.linearId])), read)) {
      const b = graced.find((x) => x.linearId === id)!;
      const out = await this.deps.call({
        op: 'issueOwned', pass: 'drift-restore', lane: 'sync', slot: slot.ref, workspaceId: ws, teamKey: b.teamKey, target: null, fields: [], input: { id },
      });
      if (!out.ok && out.word === 'linear-unauthorised') { this.deps.planSync.keyRefusedByRead(ws, slot); break; }   // no more reads on a refused key
      const issue = out.ok ? out.value['issue'] : undefined;
      if (issue !== null && typeof issue === 'object' && !Array.isArray(issue)) issues.push(issue as Node);
    }
  }

  /** Reads the four changed* documents on lane `sync`, each from its own kind's watermark, or from its kept sweep's `since` and
   *  page cursor (D-8734), and followed through its pages up to `DRIFT_MAX_PAGES`. `nodes` is what the pass compares (the issue list
   *  gains the graced re-reads); `changed` is what the changed reads alone returned, which alone moves a watermark; `next` is
   *  Linear's cursor for a kind that stopped at the cap (null: it reached its end). A failure names its kind. */
  private async readAll(ws: string, slot: SlotInfo, since: DriftWatermarks, cursors: Partial<Record<DriftKindWord, DriftCursor>>):
  Promise<{ ok: true; nodes: Record<DriftKind, Node[]>; changed: Record<DriftKind, Node[]>; next: Record<DriftKind, string | null> } | { ok: false; word: string; kind: DriftKind }> {
    const changed: Record<DriftKind, Node[]> = { initiative: [], project: [], milestone: [], issue: [] };
    const next: Record<DriftKind, string | null> = { initiative: null, project: null, milestone: null, issue: null };
    for (const { op, kind } of READS) {
      const from = cursors[kind]?.since ?? since[kind];
      let after: string | null = cursors[kind]?.after ?? null;
      for (let pages = 1; ; pages += 1) {
        const out = await this.deps.call({
          op, pass: 'drift-restore', lane: 'sync', slot: slot.ref, workspaceId: ws, teamKey: null, target: null, fields: [],
          input: op === 'changedIssues' ? { since: from, teams: slot.teams.map((t) => t.key), after } : { since: from, after },
        });
        if (!out.ok) return { ok: false, word: out.word, kind };
        const page = out.value['nodes'];
        if (!Array.isArray(page)) return { ok: false, word: 'malformed', kind };
        changed[kind].push(...(page as Node[]));
        const cursor = out.value['next'];
        if (typeof cursor !== 'string' || cursor === '') break;
        if (pages >= DRIFT_MAX_PAGES) { next[kind] = cursor; break; }
        after = cursor;
      }
    }
    const nodes = { initiative: [...changed.initiative], project: [...changed.project], milestone: [...changed.milestone], issue: [...changed.issue] };
    return { ok: true, nodes, changed, next };
  }

  /** §7.2's scope: only managed objects are compared, judged by the binding (round 6 P2), never by where Linear holds the object now. */
  private scoped(ws: string, kind: DriftKind, binding: BindingRow, po: PlannedOwned, p: Planned, managed: ReadonlySet<string>): boolean {
    const planned = po.owned['projectId'];
    return driftScoped(kind, managed, {
      bindingTeam: binding.teamKey,
      plannedProjectTeam: typeof planned === 'string' ? this.deps.plan.bindingByLinearId(ws, planned)?.teamKey : null,
      projectTeams: p.bindings.filter((b) => b.localKind === 'epic' && b.workspaceId === ws && b.linearId !== null).map((b) => b.teamKey),
    });
  }

  /** One node against its planned fields: nothing left, grace, catch-up or drift (§7.2, §7.3). Writes only the marks and the due
   *  row; what it finds to restore goes to `w`. */
  private compare(
    ws: string, key: string, kind: DriftKind, node: Node, binding: BindingRow, po0: PlannedOwned, p: Planned, now: number, w: Work, pre: ReadonlyMap<string, BindingRow>,
  ): void {
    const { plan } = this.deps;
    // A project's planned milestones are judged only when ccrc's pre-read record already bound them (round 5 F1).
    const po: PlannedOwned = kind === 'project' && Array.isArray(po0.owned['milestoneIds'])
      ? { ...po0, owned: { ...po0.owned, milestoneIds: milestonesJudged(po0.owned['milestoneIds'] as string[], new Set(pre.keys())) } } : po0;
    const linear = linearOwnedOf(kind, node);
    const runId = kind === 'issue' ? (plan.ticketById(po.local.id)?.runId ?? null) : null;
    const prMerged = runId !== null && (this.deps.prMergedOf?.(runId) ?? false);
    const grace = graceVerdict({ drifted: driftedFields(linear, po.owned, kind), linearState: linear['stateType'], prMerged, driftSince: binding.driftSince });
    if (grace.driftSince === 'set') plan.setDriftSince(binding.id, now);
    else if (grace.driftSince === 'clear') plan.setDriftSince(binding.id, null);
    let fields = grace.fields;
    // An initiative's missing project links, each judged by the project's own binding (A1): a link the sync has yet to send is a
    // catch-up, never drift; one with no planned project binding cannot be put back.
    let links: ReturnType<typeof missingLinksVerdict> | null = null;
    if (kind === 'initiative' && fields.includes('projectIds')) {
      const have = new Set(Array.isArray(linear['projectIds']) ? (linear['projectIds'] as string[]) : []);
      const missing = (Array.isArray(po.owned['projectIds']) ? (po.owned['projectIds'] as string[]) : []).filter((id) => !have.has(id));
      links = missingLinksVerdict(missing.map((id) => ({ id, current: this.projectOf(ws, key, p, id, pre)?.owned.current ?? null })));
      if (links.catchUp) plan.markSyncDue(key, now);
      if (links.drift.length === 0 && !links.unrestorable) fields = fields.filter((f) => f !== 'projectIds');
    }
    if (fields.length === 0) return;
    if (driftVerdict(linear, po.owned, kind, { current: po.current }) !== 'drift') {
      plan.markSyncDue(key, now);                   // catch-up (D-8704): the sync has not written the plan yet, and will
      return;
    }
    const events: EventSpec[] = fields.map((field) => ({ binding, kind, local: po.local, field, value: driftEventValue(field, linear[field], po.owned[field]), via: [] }));
    const restorable = restorableFields(kind, fields);
    if (restorable.length > 0) {
      const t = w.targets.get(binding.id);
      const link = restorable.includes('initiativeIds');
      w.targets.set(binding.id, {
        binding, kind, local: po.local, fields: restorable, linear, planned: po.owned, link: link || (t?.link ?? false), node, holdState: grace.holdState,
      });
      for (const e of events) if (restorable.includes(e.field)) e.via = [binding.id];
    }
    // An initiative missing a planned project whose binding is current forces that project's restore (its link step), once.
    if (links !== null && !links.unrestorable && links.drift.length > 0) {
      const ev = events.find((e) => e.field === 'projectIds')!;
      for (const projectId of links.drift) {
        const pr = this.projectOf(ws, key, p, projectId, pre)!;
        const t = w.targets.get(pr.binding.id);
        w.targets.set(pr.binding.id, t !== undefined ? { ...t, link: true }
          : { binding: pr.binding, kind: 'project', local: pr.owned.local, fields: [], linear: {}, planned: pr.owned.owned, link: true, node: {}, holdState: false });
        ev.via.push(pr.binding.id);
      }
    }
    w.events.push(...events);
  }

  /** A project of this programme by its Linear id: its binding and what the plan says of it, or null when it is none of this key's. */
  private projectOf(ws: string, key: string, p: Planned, projectId: string, pre: ReadonlyMap<string, BindingRow>): { binding: BindingRow; owned: PlannedOwned } | null {
    const { plan } = this.deps;
    const pb = pre.get(projectId) ?? plan.bindingByLinearId(ws, projectId);
    if (pb === null || plan.dueKeyOfBinding(pb.id) !== key) return null;
    const owned = p.owned.find((o) => o.bindingId === pb.id && o.kind === 'project');
    return owned === undefined ? null : { binding: pb, owned };
  }

  /** The names a restore comment may use (A-4), gathered here and decided in `restoreSides`: the plan's own name for each of its
   *  Linear ids, and what ccrc's directory (and the slot's team keys) hold of Linear's side. The directory holds project names,
   *  workflow-state types and project-status types; it holds no milestone, issue or initiative names, so those sides stay unnamed. */
  private namesFor(ws: string, slot: SlotInfo, p: Planned | null): NameFacts {
    const dir = this.deps.directory?.get(slot.ref, slot.digest) ?? null;
    return {
      plannedName: (id) => {
        const b = p?.bindings.find((x) => x.workspaceId === ws && x.linearId === id);
        const o = b === undefined ? undefined : p?.owned.find((x) => x.bindingId === b.id);
        const n = o?.owned['name'] ?? o?.owned['title'];
        return typeof n === 'string' && n !== '' ? n : null;
      },
      linearName: (id) => dir?.projects.find((x) => x.id === id)?.name ?? null,
      knownTeams: new Set(slot.teams.map((t) => t.key.toUpperCase())),
      knownTypes: new Set([...(dir?.states ?? []).map((x) => x.type), ...(dir?.projectStatuses ?? []).map((x) => x.type)]),
    };
  }

  /** The restore's target for one binding, with the comment D-8721 allows (one a day) or a milestone's line. */
  private targetOf(ws: string, s: TargetSpec, now: number, facts: NameFacts): RestoreTarget {
    const { plan } = this.deps;
    const target: RestoreTarget = {
      bindingId: s.binding.id, seen: s.binding.fingerprint, tag: String(now), ...(s.link ? { link: true } : {}), ...(s.holdState ? { holdState: true } : {}),
    };
    if (s.fields.length === 0) return target;
    if (s.kind === 'milestone') {
      const d = s.node['description'];
      return { ...target, restoredLine: { line: restoredLine(s.fields, now), linearDescription: typeof d === 'string' ? d : null } };
    }
    if (!commentDue(plan.lastDriftCommentAt(s.binding.id), now)) return target;      // once a day, item open or not (D-8721)
    const body = restoreCommentOf(s.kind, s.fields.map((f) => ({ field: f, ...restoreSides(f, s.planned[f], s.linear[f], facts) })), now);
    // The valued body is public text and is checked before it is sent (review 2457 F3, in `PlanSync#restoreComment`, which holds the
    // project facts); the fallback names the fields only, ccrc's own words.
    const fallbackBody = restoreFallbackCommentOf(s.kind, s.fields, now);
    return { ...target, comment: { body, fallbackBody, requestId: requestIdOf(LOCAL_OF[s.kind], s.local.id, ws, `restore-${now}`) } };
  }

  // ── The persistent-drift item ──

  /** Raises the operator's item for a binding (§7.4) unless one is open for it, or, for persistence alone, the binding's kept item
   *  was closed inside the window (D-8720; `shouldRaiseDriftItem`). A handed-on item is no longer the binding's (`act`). */
  private raiseItem(binding: BindingRow, kind: DriftKind, key: string, why: DriftRaiseWhy, word: string | null, now: number): void {
    const { plan, coord } = this.deps;
    const fresh = plan.bindingsOf(key).find((b) => b.id === binding.id) ?? binding;
    const held = fresh.heldItemId === null ? null : coord.itemById(fresh.heldItemId);
    // A-1 (review 2394): only an item Keep closed quiets persistence; whether it was is read from the item's own history (the closing
    // move is ccrc's settle carrying Keep's note) and decided in `closedByKeep`.
    const last = held === null ? null : { open: OPEN_ITEM_STATES.includes(held.state), closedAt: held.closedAt, kept: closedByKeep(coord.itemHistory(held.id)) };
    if (!shouldRaiseDriftItem(last, now, why)) return;
    const planKey = this.planKeyOf(key, fresh);
    const restores = new Set(plan.driftRestoresOf(fresh.id, now - DRIFT_PERSIST.windowMs)).size;
    const said = why === 'refused'
      ? `Linear refused ccrc's attempt to put the plan's value back (${word ?? 'refused'}), so this ${WORD[kind]} stays as it was changed in Linear until that is cleared.`
      : why === 'unrestorable'
        ? `Linear holds this ${WORD[kind]} differently from the plan in a way ccrc cannot put back with an update, so ccrc leaves it as it stands.`
        : `ccrc found this ${WORD[kind]} changed in Linear and put the plan's values back ${restores} times in the last 7 days, and it keeps doing so until you decide.`;
    const input: RaiseItemInput = {
      program: LINEAR_SYNC_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'decide', neededBy: 'later', soonLabel: null, secretSlot: null,
      title: `Linear keeps changing ${WORD[kind]} ${planKey}`,
      why: `${said}\n\n${this.recordBlock(fresh.id, now)}`,
      how: [], options: ['Hand to the coordinator', 'Keep the plan'], recommended: 0,
      recommendedWhy: 'The coordinator decides whether the plan itself should change, which is what repeated edits in Linear usually mean; keeping the plan only tells ccrc to carry on restoring it.',
      action: { verb: 'linear-drift', bindingId: fresh.id },
    };
    plan.setDriftItem(fresh.id, coord.raiseItem(input, now, 'ccrc'));
  }

  /** The record of what changed, as an operator or a coordinator reads it: Linear's values, fenced as untrusted text; a one-way set's
   *  line names the planned members Linear lacks (`driftEventText`). */
  private recordBlock(bindingId: number, now: number): string {
    const lines = this.deps.plan.driftEventsOf(bindingId, now - DRIFT_PERSIST.windowMs).map((e) => {
      const day = new Date(e.at).toISOString().slice(0, 10);
      const value = e.value.replace(/\s+/gu, ' ');
      return `${day} ${driftEventText(e.field, value)} (${e.restored ? 'put back' : 'not put back'}; who: not read by ccrc)`;
    });
    return untrustedBlock(lines.join('\n'), UNTRUSTED_CAP_BYTES, 'on the drift record', LINEAR_TEXT_PREFACE);
  }

  private planKeyOf(key: string, b: BindingRow): string {
    if (b.localKind === 'programme') return key;
    if (b.localKind === 'ticket') return this.deps.plan.ticketById(b.localId)?.key ?? String(b.localId);
    const stored = key.startsWith(UPKEEP_DUE_PREFIX) ? this.deps.plan.upkeepPlanOf(key.slice(UPKEEP_DUE_PREFIX.length)) : this.deps.plan.planOf(key);
    for (const e of stored.epics) {
      if (b.localKind === 'epic' && e.id === b.localId) return e.key;
      const c = e.checkpoints.find((x) => x.id === b.localId);
      if (b.localKind === 'checkpoint' && c !== undefined) return c.key;
    }
    return String(b.localId);
  }

  // ── The operator's acts ──

  /** The operator's Hand or Keep on a persistent-drift item. `hand` mails the programme's coordinator, or, for an Upkeep plan or a
   *  programme with no coordinator, the home project's Linear owner (A-7, D-8736; `handRoute` decides), settles the item and ends the
   *  binding's hold on it, in one transaction; with no usable owner it is refused `no-linear-owner` and the item stays open. `keep`
   *  settles it and the binding keeps it (D-8720's quiet reads it, `closedByKeep`), and ccrc goes on restoring. */
  act(itemId: number, act: 'hand' | 'keep', bindingId: number, slots: readonly LinearRouteSlot[] | null = null): { ok: true } | { ok: false; word: 'not-found' | 'not-open' | HierarchyItemRefusal } {
    const { coord, plan } = this.deps;
    const item = coord.itemById(itemId);
    if (item === null || item.action?.verb !== 'linear-drift' || item.action.bindingId !== bindingId) return { ok: false, word: 'not-found' };
    if (!OPEN_ITEM_STATES.includes(item.state)) return { ok: false, word: 'not-open' };
    const now = this.deps.now();
    const ctx = { programmeHasOpenRun: false };
    if (act === 'keep') {
      const moved = coord.moveItem(itemId, 'settle', 'ccrc', { note: DRIFT_KEEP_NOTE }, now, ctx);
      return moved.ok ? { ok: true } : { ok: false, word: 'not-open' };
    }
    const key = plan.dueKeyOfBinding(bindingId);
    const binding = key === null ? undefined : plan.bindingsOf(key).find((b) => b.id === bindingId);
    if (key === null || binding === undefined) return { ok: false, word: 'not-found' };
    const upkeep = key.startsWith(UPKEEP_DUE_PREFIX);
    const route = handRoute({ upkeep, coordinator: upkeep ? null : plan.planOwnerOf(key), owner: this.linearOwnerOf(upkeep ? key.slice(UPKEEP_DUE_PREFIX.length) : coord.programHome(key), slots) });
    if (route.to === 'none') return { ok: false, word: HIERARCHY_ITEM_REFUSALS.noLinearOwner };
    const kind = KIND_OF[binding.localKind];
    const subject = `Linear sync: drift on ${WORD[kind]} ${this.planKeyOf(key, binding)} handed (${key})`;
    const to = route.to === 'coordinator' ? 'you' : 'the Linear owner of its project';
    const body = `ccrc keeps finding the ${WORD[kind]} ${this.planKeyOf(key, binding)} of ${key} changed in Linear and putting the plan's values back. The operator hands it to ${to}: decide whether the plan should change, and if it should, change the plan (the sync follows). What ccrc recorded:\n\n${this.recordBlock(bindingId, now)}`;
    // A hand-on ends the binding's hold on the item, so its next persistence is raised again as §7.4 says; only Keep keeps the
    // item, and with it D-8720's week of quiet (review 2394 A-1).
    const moved = coord.moveItemWithMail(itemId, 'settle', 'ccrc', { note: route.to === 'coordinator' ? 'Handed to the coordinator.' : "Handed to the project's Linear owner." }, now, ctx,
      // an owner's mail names no programme: the owner is not the programme's coordinator, and an Upkeep key is no programme (as `inboundLane.ts#mailOwner`)
      () => { insertSystemMailTx(coord, route.to === 'coordinator' ? { program: key } : null, { fromId: 'operator', toId: route.id, runId: null, kind: 'status', subject, body }); plan.setDriftItem(bindingId, null); });
    return moved.ok ? { ok: true } : { ok: false, word: 'not-open' };
  }

  /** A project's Linear owner as `planPolicy.ts#linearOwnerOfProject` decides it (the facts the inbound lane reads too: the rows, the
   *  latest programme's coordinator and a session's standing), or null for a project nobody names. */
  private linearOwnerOf(project: string | null, slots: readonly LinearRouteSlot[] | null): { id: string | null; gone: boolean } | null {
    if (project === null) return null;
    const { plan, presenceOf } = this.deps;
    return linearOwnerOfProject(project, plan.hierarchyProjectsOf(), { latestProgrammeCoordinator: (p) => plan.latestProgrammeCoordinator(p), presence: presenceOf }, slots);
  }

  /** A stored inbound row's issue, re-read by id (review 2457 F4, D-8733), for `plan take` and `plan triage`: the inbound lane's own read. */
  recheckInbound(row: InboundRow): Promise<InboundRecheck> { return this.inbound.recheck(row); }
}

/** The newest `updatedAt` of a read's nodes, or null when it returned none. */
function newestOf(nodes: readonly Node[]): string | null {
  return nodes.map((n) => (typeof n['updatedAt'] === 'string' ? n['updatedAt'] : '')).filter((t) => t !== '').sort().at(-1) ?? null;
}

/** A changed node as the owned fields of its kind (the shaped answers name them; a project lists its milestones as records). */
function linearOwnedOf(kind: DriftKind, node: Node): OwnedFields {
  if (kind !== 'project') return node as OwnedFields;
  const ms = Array.isArray(node['milestones']) ? (node['milestones'] as Node[]).flatMap((m) => (typeof m['id'] === 'string' ? [m['id']] : [])) : [];
  return { ...(node as OwnedFields), milestoneIds: ms };
}

/** The pass as `index.ts` builds it: Linear reached through `runCcrcOp` with the one rate service, journal and policy (the sync's own
 *  call and timeout), a run's merge read from what the server holds. */
export function driftPassFor(o: {
  coord: CoordStore; plan: PlanStorePort; planSync: PlanSync; ccrcDir: string; rate: LinearRateService; journal: LinearJournal; policy: LinearWritePolicy;
  readLinearStore: DriftPassDeps['readLinearStore']; presenceOf: DriftPassDeps['presenceOf']; viaFleet: DriftPassDeps['viaFleet'];
  /** The refresher's directory (an inbound close reads the team's `canceled` status from it). */
  directory?: DriftPassDeps['directory'];
  /** The watcher's newest fleet listing: where a run's open PR is read before its close folds the lineage. */
  currentFleet?: () => readonly FleetSession[] | null;
}): DriftPass {
  return new DriftPass({
    coord: o.coord, plan: o.plan, planSync: o.planSync, readLinearStore: o.readLinearStore,
    call: (ask) => runCcrcOp({ ccrcDir: o.ccrcDir, rate: o.rate, journal: o.journal, policy: o.policy, timeoutMs: PLAN_SYNC_CALL_TIMEOUT_MS }, ask),
    now: Date.now, presenceOf: o.presenceOf, viaFleet: o.viaFleet, directory: o.directory, prMergedOf: prMergedOfFrom(o.coord, o.currentFleet ?? (() => null)),
  });
}

/** Whether a run's pull request is merged as the server knows it (§7.3: Linear's integration closes the issue on the merge). The
 *  pass asks the done-test reader, the one reader of a run's lineage (#2964; the coordinator's ruling on review 2408's fix
 *  round 3), handing it the session's PR from the newest fleet listing; `runPrMergedSeen` decides. Synchronous. */
export function prMergedOfFrom(coord: CoordStore, fleet: () => readonly FleetSession[] | null): (runId: number) => boolean {
  return (runId) => runPrMerged(coord, runId, (sid) => {
    const s = fleet()?.find((f) => f.id === sid);
    return s === undefined ? null : { phase: s.pr?.phase ?? null, branch: s.branch };
  });
}
