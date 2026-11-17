/**
 * THE DRIFT PASS (D-8183; Linear hierarchy design 2026-11-10 §6.2, §7.2 to §7.4): it reads what changed in a managed team's
 * Linear since its last look, compares each changed object ccrc holds a binding for against what the plan says it should be
 * (the owned fields, `driftPolicy.ts`), and puts the plan's value back. L4 DELIVERY around `driftPolicy.ts`'s pure deciders: it
 * decides nothing about WHAT counts as drift (`driftedFields`, `driftVerdict`, `notDrift`, `isPersistent`,
 * `shouldRaiseDriftItem`, `commentDue` do), it only reads, asks, restores and records.
 *
 * INERT UNTIL A TEAM IS MANAGED. A team is managed once a `linear_migrations` row for it reads `applied` (wave 7): with none,
 * a tick makes no call at all. One workspace is taken per tick, the one whose `passAt` is oldest and at least
 * `DRIFT_PASS_MS` old; its mark (`linear_drift_marks`) holds the watermark (the newest `updatedAt` read) and when it last ran.
 * A read that fails keeps the old watermark and tries again after the period; so does a page cap or a deferred restore.
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
import type { BindingRow, PlanStorePort } from '../coord/planStore.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import { UNTRUSTED_CAP_BYTES, untrustedBlock } from '../coord/untrusted.js';
import type { RaiseItemInput } from '../coord/ledgersStore.js';
import { LINEAR_SYNC_PROGRAMME, type BindingKind } from '../../../shared/plan.js';
import { OPEN_ITEM_STATES, type CoordinatorPresence } from '../../../shared/ledgers.js';
import { runCcrcOp, type CcrcOpAsk, type CcrcOpOutcome } from './ccrcCall.js';
import type { LinearJournal } from './journal.js';
import type { LinearWritePolicy } from './policy.js';
import type { LinearRateService } from './rate.js';
import type { FleetSession } from '../../../shared/api.js';
import {
  DRIFT_PASS_MS, DRIFT_PERSIST, LINEAR_TEXT_PREFACE, commentDue, driftValueText, driftVerdict, driftedFields, isPersistent, notDrift,
  restoreCommentOf, restoredLine, shouldRaiseDriftItem, type DriftKind, type OwnedFields,
} from './driftPolicy.js';
import { PLAN_SYNC_CALL_TIMEOUT_MS, slotsOf, type PlanSync, type RestoreOutcome, type RestoreTarget, type SlotInfo } from './planSync.js';
import { requestIdOf, type PlannedOwned } from './planSyncPolicy.js';
import type { LinearStoreRead } from './store.js';

/** The most pages of one document a pass follows (a runaway guard): past it the pass keeps its old watermark. */
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
  /** Task 4.3's (the inbound path): taken now so the wiring is done once. */
  presenceOf: (id: string) => CoordinatorPresence;
  viaFleet: (identifiers: readonly string[]) => ReadonlySet<string>;
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
/** Fields whose values are ids: a comment names no value for them. */
const ID_FIELDS: ReadonlySet<string> = new Set(['projectId', 'milestoneId', 'parentId', 'initiativeIds', 'projectIds', 'milestoneIds']);
/** What no update can put back: no op deletes or re-parents a milestone (§7.2). */
const UNRESTORABLE: Readonly<Record<DriftKind, readonly string[]>> = { initiative: ['projectIds'], project: ['milestoneIds'], milestone: ['projectId'], issue: [] };

/** One binding to put back. */
interface TargetSpec { binding: BindingRow; kind: DriftKind; local: PlannedOwned['local']; fields: string[]; linear: OwnedFields; planned: OwnedFields; link: boolean; node: Node }
/** One difference found: restored when every target in `via` is, never restored when `via` is empty. */
interface EventSpec { binding: BindingRow; kind: DriftKind; local: PlannedOwned['local']; field: string; value: string; via: number[] }
interface Work { targets: Map<number, TargetSpec>; events: EventSpec[] }
type Planned = { bindings: BindingRow[]; owned: PlannedOwned[] };

export class DriftPass {
  private running = false;

  constructor(private readonly deps: DriftPassDeps) {}

  // ── The tick ──

  /** One beat: take at most one workspace, the one longest unread that is due, and run its pass. A tick that finds another in
   *  flight (a lane the runner restarted) returns at once. */
  async tick(now: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ws = await this.dueWorkspace(now);
      if (ws !== null) await this.passOf(ws.workspaceId, ws.slot, ws.teams, now);
    } finally { this.running = false; }
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
    const old = mark?.watermark ?? new Date(plan.managedSince(ws) ?? now).toISOString();
    const read = await this.readAll(ws, slot, teams, old);
    if (!read.ok) {
      plan.setDriftMark(ws, old, now);
      console.warn(`ccrc-server: linear drift pass read failed: ${read.word}`);
      return;
    }
    if (read.capped) console.warn('ccrc-server: linear drift pass page cap reached');
    let keepOld = read.capped;
    const managed = new Set(teams.map((t) => t.toUpperCase()));
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
        const binding = id === null ? null : plan.bindingByLinearId(ws, id);
        if (binding === null || binding.localKind !== LOCAL_OF[kind]) continue;
        const key = plan.dueKeyOfBinding(binding.id);
        const p = key === null ? null : await plannedOf(key);
        if (key === null || p === null) continue;
        if (!this.managedNode(ws, kind, node, binding, p, managed)) continue;
        const po = p.owned.find((o) => o.bindingId === binding.id && o.kind === kind);
        if (po === undefined) continue;
        this.compare(ws, key, kind, node, binding, po, p, now, workOf(key));
      }
    }

    // One restore per programme key, then each outcome recorded.
    const raise: { binding: BindingRow; kind: DriftKind; key: string; why: 'restored' | 'refused' | 'unrestorable'; word: string | null }[] = [];
    const restoredNow = new Map<number, { binding: BindingRow; kind: DriftKind; key: string }>();
    for (const [key, w] of work) {
      const specs = [...w.targets.values()];
      const outcomes = specs.length === 0 ? [] : await this.deps.planSync.restore(key, specs.map((s) => this.targetOf(ws, s, now)), 'drift-restore');
      const byId = new Map<number, RestoreOutcome>(outcomes.map((o) => [o.bindingId, o]));
      if (outcomes.some((o) => o.outcome === 'deferred')) keepOld = true;
      const commentedOnce = new Set<number>();
      for (const ev of w.events) {
        const verdict = this.verdictOf(ev, byId);
        if (verdict.kind === 'skip') continue;
        const restored = verdict.kind === 'restored';
        const eventId = plan.recordDrift({ bindingId: ev.binding.id, at: now, field: ev.field, value: ev.value, actor: NOT_READ, restored });
        if (restored) {
          const commented = byId.get(ev.binding.id)?.commented === true;
          if (commented && !commentedOnce.has(ev.binding.id)) { plan.markDriftCommented(eventId, now); commentedOnce.add(ev.binding.id); }
          restoredNow.set(ev.binding.id, { binding: ev.binding, kind: ev.kind, key });
        } else {
          raise.push({ binding: ev.binding, kind: ev.kind, key, why: verdict.kind === 'refused' ? 'refused' : 'unrestorable', word: verdict.word });
        }
      }
    }
    for (const r of raise) this.raiseItem(r.binding, r.kind, r.key, r.why, r.word, now);
    for (const [bindingId, r] of restoredNow) {
      const restores = [...new Set(plan.driftRestoresOf(bindingId, now - DRIFT_PERSIST.windowMs))];
      if (isPersistent(restores, now)) this.raiseItem(r.binding, r.kind, r.key, 'restored', null, now);
    }
    const newest = [...READS].flatMap(({ kind }) => read.nodes[kind].map((n) => (typeof n['updatedAt'] === 'string' ? n['updatedAt'] : ''))).sort().at(-1) ?? '';
    plan.setDriftMark(ws, keepOld || newest <= old ? old : newest, now);
  }

  /** Reads the four changed* documents on lane `sync`, each followed through its pages up to `DRIFT_MAX_PAGES`. */
  private async readAll(ws: string, slot: SlotInfo, teams: string[], since: string):
  Promise<{ ok: true; nodes: Record<DriftKind, Node[]>; capped: boolean } | { ok: false; word: string }> {
    const nodes: Record<DriftKind, Node[]> = { initiative: [], project: [], milestone: [], issue: [] };
    let capped = false;
    for (const { op, kind } of READS) {
      let after: string | null = null;
      for (let pages = 1; ; pages += 1) {
        const out = await this.deps.call({
          op, pass: 'drift-restore', lane: 'sync', slot: slot.ref, workspaceId: ws, teamKey: null, target: null, fields: [],
          input: op === 'changedIssues' ? { since, teams, after } : { since, after },
        });
        if (!out.ok) return { ok: false, word: out.word };
        const page = out.value['nodes'];
        if (!Array.isArray(page)) return { ok: false, word: 'malformed' };
        nodes[kind].push(...(page as Node[]));
        const next = out.value['next'];
        if (typeof next !== 'string' || next === '') break;
        if (pages >= DRIFT_MAX_PAGES) { capped = true; break; }
        after = next;
      }
    }
    return { ok: true, nodes, capped };
  }

  /** §7.2's scope: only managed objects are compared. */
  private managedNode(ws: string, kind: DriftKind, node: Node, binding: BindingRow, p: Planned, managed: ReadonlySet<string>): boolean {
    const has = (team: string | null | undefined): boolean => typeof team === 'string' && managed.has(team.toUpperCase());
    switch (kind) {
      case 'issue': return has(typeof node['teamKey'] === 'string' ? node['teamKey'] : null);
      case 'project': return has(binding.teamKey);
      case 'milestone': {
        const pid = typeof node['projectId'] === 'string' ? node['projectId'] : null;
        return pid !== null && has(this.deps.plan.bindingByLinearId(ws, pid)?.teamKey);
      }
      case 'initiative': return p.bindings.some((b) => b.localKind === 'epic' && b.workspaceId === ws && b.linearId !== null && has(b.teamKey));
    }
  }

  /** One node against its planned fields: nothing left, grace, catch-up or drift (§7.2, §7.3). Writes only the marks and the due
   *  row; what it finds to restore goes to `w`. */
  private compare(
    ws: string, key: string, kind: DriftKind, node: Node, binding: BindingRow, po: PlannedOwned, p: Planned, now: number, w: Work,
  ): void {
    const { plan } = this.deps;
    const linear = linearOwnedOf(kind, node);
    const all = driftedFields(linear, po.owned, kind);
    const runId = kind === 'issue' ? (plan.ticketById(po.local.id)?.runId ?? null) : null;
    const ctx = { prMerged: runId !== null && (this.deps.prMergedOf?.(runId) ?? false), gracePasses: binding.driftSince === null ? 0 : 1 };
    const fields = all.filter((f) => !notDrift(f, po.owned[f], linear[f], ctx));
    if (fields.length === 0) {
      // The one grace: an issue Linear reads `completed` that the plan does not, with no merge recorded yet, waits one pass.
      if (all.includes('stateType') && linear['stateType'] === 'completed' && !ctx.prMerged && binding.driftSince === null) plan.setDriftSince(binding.id, now);
      else if (binding.driftSince !== null) plan.setDriftSince(binding.id, null);
      return;
    }
    if (driftVerdict(linear, po.owned, kind, { current: po.current }) !== 'drift') {
      plan.markSyncDue(key, now);                   // catch-up (D-8704): the sync has not written the plan yet, and will
      return;
    }
    const events: EventSpec[] = fields.map((field) => ({ binding, kind, local: po.local, field, value: driftValueText(linear[field]), via: [] }));
    const restorable = fields.filter((f) => !UNRESTORABLE[kind].includes(f));
    if (restorable.length > 0) {
      const t = w.targets.get(binding.id);
      const link = restorable.includes('initiativeIds');
      w.targets.set(binding.id, { binding, kind, local: po.local, fields: restorable, linear, planned: po.owned, link: link || (t?.link ?? false), node });
      for (const e of events) if (restorable.includes(e.field)) e.via = [binding.id];
    }
    // An initiative missing a planned project forces that project's restore (its link step), once, with the project's own.
    if (kind === 'initiative' && fields.includes('projectIds')) {
      const have = new Set(Array.isArray(linear['projectIds']) ? (linear['projectIds'] as string[]) : []);
      const missing = (Array.isArray(po.owned['projectIds']) ? (po.owned['projectIds'] as string[]) : []).filter((id) => !have.has(id));
      const ev = events.find((e) => e.field === 'projectIds')!;
      for (const projectId of missing) {
        const pb = plan.bindingByLinearId(ws, projectId);
        const pk = pb === null ? null : plan.dueKeyOfBinding(pb.id);
        const pp = pk === null || pk !== key ? null : p;
        const owned = pb === null || pp === null ? undefined : pp.owned.find((o) => o.bindingId === pb.id && o.kind === 'project');
        if (pb === null || owned === undefined) { ev.via = []; break; }
        const t = w.targets.get(pb.id);
        w.targets.set(pb.id, t !== undefined ? { ...t, link: true } : { binding: pb, kind: 'project', local: owned.local, fields: [], linear: {}, planned: owned.owned, link: true, node: {} });
        ev.via.push(pb.id);
      }
    }
    w.events.push(...events);
  }

  /** What an event's outcome is: every target it rides on restored, one refused, one moot or deferred (nothing recorded now),
   *  or none to ride on (an unrestorable field). */
  private verdictOf(ev: EventSpec, byId: ReadonlyMap<number, RestoreOutcome>):
  { kind: 'restored' } | { kind: 'refused'; word: string } | { kind: 'unrestorable'; word: null } | { kind: 'skip' } {
    if (ev.via.length === 0) return { kind: 'unrestorable', word: null };
    const out = ev.via.map((v) => byId.get(v));
    const refused = out.find((o) => o?.outcome === 'refused');
    if (refused !== undefined) return { kind: 'refused', word: refused.word ?? 'refused' };
    if (out.every((o) => o?.outcome === 'restored')) return { kind: 'restored' };
    return { kind: 'skip' };
  }

  /** The restore's target for one binding, with the comment §7.4 allows (one a day while its item is open) or a milestone's line. */
  private targetOf(ws: string, s: TargetSpec, now: number): RestoreTarget {
    const { plan, coord } = this.deps;
    const target: RestoreTarget = { bindingId: s.binding.id, seen: s.binding.fingerprint, tag: String(now), ...(s.link ? { link: true } : {}) };
    if (s.fields.length === 0) return target;
    if (s.kind === 'milestone') {
      const d = s.node['description'];
      return { ...target, restoredLine: { line: restoredLine(s.fields[0]!, now), linearDescription: typeof d === 'string' ? d : null } };
    }
    const held = s.binding.heldItemId === null ? null : coord.itemById(s.binding.heldItemId);
    const itemOpen = held !== null && OPEN_ITEM_STATES.includes(held.state);
    if (!commentDue(itemOpen, plan.lastDriftCommentAt(s.binding.id), now)) return target;
    const named = (f: string, v: unknown): string | null => (ID_FIELDS.has(f) || v === null || v === undefined ? null : driftValueText(v));
    const body = restoreCommentOf(s.kind, s.fields.map((f) => ({ field: f, planned: named(f, s.planned[f]), was: named(f, s.linear[f]) })), now);
    return { ...target, comment: { body, requestId: requestIdOf(LOCAL_OF[s.kind], s.local.id, ws, `restore-${now}`) } };
  }

  // ── The persistent-drift item ──

  /** Raises the operator's item for a binding (§7.4) unless one is open for it or one it had was closed inside the window. */
  private raiseItem(binding: BindingRow, kind: DriftKind, key: string, why: 'restored' | 'refused' | 'unrestorable', word: string | null, now: number): void {
    const { plan, coord } = this.deps;
    const fresh = plan.bindingsOf(key).find((b) => b.id === binding.id) ?? binding;
    const held = fresh.heldItemId === null ? null : coord.itemById(fresh.heldItemId);
    if (!shouldRaiseDriftItem(held === null ? null : { open: OPEN_ITEM_STATES.includes(held.state), closedAt: held.closedAt }, now)) return;
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

  /** The record of what changed, as an operator or a coordinator reads it: Linear's values, fenced as untrusted text. */
  private recordBlock(bindingId: number, now: number): string {
    const lines = this.deps.plan.driftEventsOf(bindingId, now - DRIFT_PERSIST.windowMs).map((e) => {
      const day = new Date(e.at).toISOString().slice(0, 10);
      const value = e.value.replace(/\s+/gu, ' ');
      return `${day} ${e.field} = ${value === '' ? '(empty)' : value} (${e.restored ? 'put back' : 'not put back'}; who: not read by ccrc)`;
    });
    return untrustedBlock(lines.join('\n'), UNTRUSTED_CAP_BYTES, 'on the drift record', LINEAR_TEXT_PREFACE);
  }

  private planKeyOf(key: string, b: BindingRow): string {
    if (b.localKind === 'programme') return key;
    if (b.localKind === 'ticket') return this.deps.plan.ticketById(b.localId)?.key ?? String(b.localId);
    for (const e of this.deps.plan.planOf(key).epics) {
      if (b.localKind === 'epic' && e.id === b.localId) return e.key;
      const c = e.checkpoints.find((x) => x.id === b.localId);
      if (b.localKind === 'checkpoint' && c !== undefined) return c.key;
    }
    return String(b.localId);
  }

  // ── The operator's acts ──

  /** The operator's Hand or Keep on a persistent-drift item. `hand` mails the programme's coordinator (an Upkeep key has none: the
   *  item's note says so) and settles the item in one transaction; `keep` settles it, and ccrc goes on restoring. */
  act(itemId: number, act: 'hand' | 'keep', bindingId: number): { ok: true } | { ok: false; word: 'not-found' | 'not-open' } {
    const { coord, plan } = this.deps;
    const item = coord.itemById(itemId);
    if (item === null || item.action?.verb !== 'linear-drift' || item.action.bindingId !== bindingId) return { ok: false, word: 'not-found' };
    if (!OPEN_ITEM_STATES.includes(item.state)) return { ok: false, word: 'not-open' };
    const now = this.deps.now();
    const ctx = { programmeHasOpenRun: false };
    if (act === 'keep') {
      const moved = coord.moveItem(itemId, 'settle', 'ccrc', { note: 'Keeping the plan; ccrc goes on restoring.' }, now, ctx);
      return moved.ok ? { ok: true } : { ok: false, word: 'not-open' };
    }
    const key = plan.dueKeyOfBinding(bindingId);
    const binding = key === null ? undefined : plan.bindingsOf(key).find((b) => b.id === bindingId);
    const owner = key === null || key.startsWith('upkeep:') ? null : plan.planOwnerOf(key);
    if (key === null || binding === undefined || owner === null) {
      const moved = coord.moveItem(itemId, 'settle', 'ccrc', { note: 'Handed to nobody: this object has no coordinator (an Upkeep plan, or a programme with none).' }, now, ctx);
      return moved.ok ? { ok: true } : { ok: false, word: 'not-open' };
    }
    const kind = KIND_OF[binding.localKind];
    const subject = `Linear sync: drift on ${WORD[kind]} ${this.planKeyOf(key, binding)} handed (${key})`;
    const body = `ccrc keeps finding the ${WORD[kind]} ${this.planKeyOf(key, binding)} of ${key} changed in Linear and putting the plan's values back. The operator hands it to you: decide whether the plan should change, and if it should, change the plan (the sync follows). What ccrc recorded:\n\n${this.recordBlock(bindingId, now)}`;
    const moved = coord.moveItemWithMail(itemId, 'settle', 'ccrc', { note: 'Handed to the coordinator.' }, now, ctx,
      () => insertSystemMailTx(coord, { program: key }, { fromId: 'operator', toId: owner, runId: null, kind: 'status', subject, body }));
    return moved.ok ? { ok: true } : { ok: false, word: 'not-open' };
  }
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
  /** The watcher's newest fleet listing: where a run's open PR is read before its close folds the lineage. */
  currentFleet?: () => readonly FleetSession[] | null;
}): DriftPass {
  return new DriftPass({
    coord: o.coord, plan: o.plan, planSync: o.planSync, readLinearStore: o.readLinearStore,
    call: (ask) => runCcrcOp({ ccrcDir: o.ccrcDir, rate: o.rate, journal: o.journal, policy: o.policy, timeoutMs: PLAN_SYNC_CALL_TIMEOUT_MS }, ask),
    now: Date.now, presenceOf: o.presenceOf, viaFleet: o.viaFleet, prMergedOf: prMergedOfFrom(o.coord, o.currentFleet ?? (() => null)),
  });
}

/** Whether a run's pull request is merged as the server knows it (§7.3: Linear's integration closes the issue on the merge): a
 *  `merged` phase in the run's folded `.prhistory` lineage, else its session's PR in the newest fleet listing when that session is
 *  on the run's own workspace branch. Synchronous; false when neither says so. */
export function prMergedOfFrom(coord: CoordStore, fleet: () => readonly FleetSession[] | null): (runId: number) => boolean {
  return (runId) => {
    const read = coord.run(runId);
    if (!read.ok || read.run === null) return false;
    if (read.run.prLineage.some((e) => e.phase === 'merged')) return true;
    const sid = read.run.sessionId;
    const s = sid === null ? undefined : fleet()?.find((f) => f.id === sid);
    const own = read.run.branch;
    return s?.pr?.phase === 'merged' && own !== null && s.branch !== null && s.branch === own;
  };
}
