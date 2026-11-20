/**
 * THE PLAN SYNC (D-8182; Linear hierarchy design 2026-11-10 §5.2, §6.3, §8): the pass that makes Linear carry a programme's
 * plan. L4 DELIVERY around Task 3.1's pure deciders (`planSyncPolicy.ts`): it reads one snapshot, takes the first step the
 * deciders emit, sends it through `runCcrcOp`, writes the binding, and reads the plan again, until nothing is left, the
 * deadline passes or something defers it. It decides nothing about WHAT to write: every rule below is how a pass reacts to
 * what a call answered, and each answer has one handling (the table in the design, a row per outcome in the tests).
 *
 * ONE WRITER PER LINEAR OBJECT. A programme key (a slug, or `upkeep:<project>`) has one single flight: `passFor` on a key
 * with a pass in flight JOINS it and never starts a second, and `withFlight` runs another writer's work (the drift
 * restore, the migration's adopted issues) after the pass in flight, never between two of its steps. Every write to a
 * bound object, whoever asked for it, updates that binding's fingerprint in the same flight, so a restore of an older
 * planned value can never be read as drift of a newer sync write: the drift restore (`restore`, D-8183) re-reads the plan
 * INSIDE its flight, and a target whose fingerprint moved since the drift pass read it (a sync write landed first, carrying the
 * newer plan) is `moot`: nothing is sent for it. Do NOT call `passFor` for a key from inside its own `withFlight` function:
 * the flight waits for itself.
 *
 * A STEP'S FAILURE HOLDS ITS WORKSPACE, NOT THE PROGRAMME (D-8183, D-8702). A deferring answer holds the step's workspace for its programme
 * (`hold`, on that workspace's own backoff step) and the pass goes on with the runnable steps in other workspaces; the programme's
 * row is deferred, as a failure, to the earliest hold only when nothing else is runnable. The holds are in process memory (the row's
 * own hold is persisted); the probe's settled marks and the episodes' streaks are the store's, so a restart keeps them.
 *
 * WHAT IS WRITTEN BEFORE A CALL. The binding row is `pending` before a create is sent (`ensurePending`) and `bound` after;
 * a row found `pending` at the start of a step is a create a previous pass may have sent (a crash, a timeout), so the
 * step recovers first (C2'): it adopts only ccrc's own object, the one at the create's requestId (an initiative or a project
 * made by this key, a milestone inside its own bound project), and otherwise sends the create with that id. Which object is
 * ccrc's is `adoptionVerdict`'s to say (L1), as C12's issue read is `issueReadVerdict`'s and a requeue `requeueVerdict`'s.
 * It never reads `LinearJournal.viaFleet`: in the very crash this exists for the journal row is still `pending` with no result.
 *
 * LINEAR'S TEXT IS NEVER IN A MAIL. A coordinator is mailed a fixed sentence naming the object kind, its plan key and the
 * word, once per object and word (`hasMailWithSubject`, durable).
 */
import type { CoordStore } from '../coord/store.js';
import { planViewOf } from '../coord/planRoutes.js';
import { linearOwnerOfProject, programmeEnd } from '../coord/planPolicy.js';
import type { CoordinatorPresence } from '../../../shared/ledgers.js';
import { ADOPTED_FINGERPRINT, type BindingRow, type PlanStorePort, type StoredPlan, type SyncDeferral, type TicketRow } from '../coord/planStore.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import { tx } from '../coord/tx.js';
import { LINEAR_SYNC_PROGRAMME, UPKEEP_DUE_PREFIX, type BindingKind } from '../../../shared/plan.js';
import type { FleetSession } from '../../../shared/api.js';
import { slugForTicket } from '../linking/policy.js';
import { markLinearRejected } from './connection.js';
import { runCcrcOp, type CcrcOpAsk, type CcrcOpOutcome } from './ccrcCall.js';
import type { LinearDirectoryRead } from './directory.js';
import type { LinearJournal } from './journal.js';
import type { CcrcPass, LinearWritePolicy } from './policy.js';
import type { LinearRateService } from './rate.js';
import type { LinearRefresher } from './refresher.js';
import { currentDetails, routableSlots, routeProjectTeam } from './route.js';
import { markLinearSlotRejected, type LinearSlotRef, type LinearStoreRead } from './store.js';
import { restoreCommentChoice, restoreHoldVerdict, restoreTargetVerdict, restoredDescription } from './driftPolicy.js';
import {
  adoptionVerdict, deferralOf, deferralUntil, deferralUsesBackoff, directoryMissed, directoryWaitVerdict, dispatchWaitVerdict, nextDirectoryStreak, probeEpisodeText, probeRecheckDue, probeWaitsVerdict, initiativesItemInput, initiativesItemVerdicts, initiativesItemsToSettle, issueReadVerdict, planSyncSteps, requeueVerdict, type PlannedOwned,
  withoutPutBack, textFactsOf, textRefusalOf, type AdoptionAsk, type DeferCause, type Deferral, type DirectoryStreak, type FillLook, type AdoptionKind, type AdoptionNode, type IssueRead, type Local, type RequeueVerdict, type SyncSnapshot, type SyncStep,
} from './planSyncPolicy.js';

/** A due row is taken once its `dueAt` is this old: the plan routes mark a programme due at the write time, and a burst of
 *  plan verbs becomes one pass. */
export const PLAN_SYNC_DEBOUNCE_MS = 3_000;
/** The wait after a deferral, by how many deferrals the programme has had in a row (the last step holds). */
export const PLAN_SYNC_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000] as const;
/** A tick's total budget, and one call's own timeout (`runCcrcOp`'s `timeoutMs`): together they stay under the lane row's
 *  `staleAfterMs`, so a tick the runner restarts as stuck has nothing left of the first to overlap. */
export const PLAN_SYNC_TICK_DEADLINE_MS = 60_000;
export const PLAN_SYNC_CALL_TIMEOUT_MS = 15_000;
/** How long a dispatch waits for its ticket's issue (§5.6): past it the dispatch goes with today's slug, and the sync links
 *  the PR once the issue appears. */
export const PLAN_SYNC_DISPATCH_WAIT_MS = 12_000;
/** How long a programme waits for its workspace's directory to be filled by the refresher (a miss queues it). */
const DIRECTORY_WAIT_MS = 10_000;
/** A runaway guard: one pass never takes more steps than this. */
const MAX_STEPS_PER_PASS = 500;
const LAST_BACKOFF_MS = PLAN_SYNC_BACKOFF_MS[PLAN_SYNC_BACKOFF_MS.length - 1]!;

/** One binding the drift pass asks to have put back (D-8183): `seen` is the binding's fingerprint when the pass read Linear, `tag`
 *  names the restore (the forced link's request id), `comment` is the drift comment to send once it is restored, `restoredLine` a
 *  milestone's own record of it. */
export interface RestoreTarget {
  bindingId: number; seen: string | null; tag: string;
  /** The drift is in the project's link to its initiative (or the initiative's to it): the link is made again under the restore's own
   *  request id. Absent: the update alone (an update keeps the stored link mark, D-8183, so the sync sends no second link). */
  link?: boolean;
  /** The drift comment: `body` names values and passes the public-text check before it is sent; refused (review 2457 F3), the
   *  restore's field writes still go and `fallbackBody`, ccrc's own words naming the fields only, goes instead. */
  comment?: { body: string; fallbackBody: string; requestId: string };
  restoredLine?: { line: string; linearDescription: string | null };
  /** An issue's grace stands (§7.3, `graceVerdict`): its update goes without its state, as C12's `state-held` sends it, so a
   *  restore of another field in the same pass never ends the grace (review 2386 A5). */
  holdState?: boolean;
}
/** `restored`: the planned fields are back and the binding holds the plan's fingerprint. `moot`: a sync write landed first, or the
 *  binding is gone: nothing was sent. `refused`: Linear refused the write and the binding is failed (`word`). `deferred`: nothing
 *  was written yet (a deferring answer, an unreadable store, no step to send). `commented`: the drift comment was sent or found made. */
export interface RestoreOutcome { bindingId: number; outcome: 'restored' | 'moot' | 'refused' | 'deferred'; word?: string; commented: boolean }

export interface PlanSyncDeps {
  /** For the mail and for `goalsFor`, `linkingOf` and `programs()` only: every plan read and write goes through `plan`. */
  coord: CoordStore;
  plan: PlanStorePort;
  ccrcDir: string;
  /** The Linear store as the routes read it: where each workspace's slot, its key digest and its team ids live. */
  readLinearStore: () => Promise<LinearStoreRead>;
  call: (ask: CcrcOpAsk) => Promise<CcrcOpOutcome>;
  directory: LinearDirectoryRead;
  /** A workspace's directory is not filled: ask the refresher to fill it (`LinearRefresher#nameMiss`). */
  directoryMiss: (slot: LinearSlotRef, keyDigest: string) => void;
  /** Queue the slot's directory refresh, the initiatives probe with it, past its window (`LinearRefresher#queueDirectory`). */
  queueDirectory?: (slot: LinearSlotRef) => void;
  markSlotRejected: (slot: LinearSlotRef, digest: string, now: number) => Promise<void>;
  now: () => number;
  privateTrackerKeys: readonly string[];
  /** §5.6: the pull request a run opened, as far as the server knows it (synchronous, a read of what it holds); null when
   *  none is known. Absent: no PR is ever linked. */
  prOfRun?: (runId: number) => { number: number; branch: string | null } | null;
  /** A test's shorter tick budget. */
  tickDeadlineMs?: number;
  /** The Linear owner of a project (D-8183): who an Upkeep epic's failure mails, since it has no coordinator. None: no mail. */
  upkeepOwnerOf?: (project: string) => string | null;
}

export interface SlotInfo { ref: LinearSlotRef; digest: string; teams: { id: string; key: string }[] }
/** The drift pass's restore pass, taken from the list (never spelled beside `'plan-sync'`: the list is policy.ts's alone). */
export type RestorePass = Extract<CcrcPass, `${string}restore`>;
/** Which of ccrc's passes a send belongs to: the sync's own, or the restore's (D-8183: a restore's calls are journaled `drift-restore`). */
type SendPass = 'plan-sync' | RestorePass;
/** `next`: go on; `defer`: the pass ends and its programme row is deferred; `held`: the step's workspace is held for this
 *  programme (D-8183) and the pass goes on with the steps in other workspaces. */
type Flow = 'next' | 'defer' | 'held';
/** The steps a restore sends: an absolute update and, for a project under a live initiative, its link (never a create). */
type Restorable = Extract<SyncStep, { kind: 'update' | 'link' }>;
type Failure = Exclude<CcrcOpOutcome, { ok: true }>;
/** What one restore's steps did in Linear (A-4): `wrote` a call was answered ok; `same` Linear already held the plan (the issue read
 *  said `same`, or a link answered `conflict`). Neither: nothing went (no key, no slot). */
interface SendNote { wrote: boolean; same: boolean }
/** What failing a binding needs to know about its object (a skip's binding is failed with no slot: A2). */
interface Told { slug: string; local: Local; workspaceId: string; bindingId: number | null; inputs: string; plan: StoredPlan }
/** What a failed outcome needs to know about the object it was for. */
interface Subject extends Told { slot: SlotInfo; /** The pass every call of this step is journaled under (`readAsk` reads it). */ pass: SendPass }

const OBJECT_WORD: Record<BindingKind, string> = { programme: 'programme', epic: 'epic', checkpoint: 'checkpoint', ticket: 'ticket' };

export class PlanSync {
  /** The passes in flight, joined by a second `passFor`. */
  private readonly passes = new Map<string, Promise<'done' | 'deferred'>>();
  /** The tail of each key's flight chain (`withFlight`). */
  private readonly tails = new Map<string, Promise<unknown>>();
  /** Consecutive deferrals of a key: the backoff step. Reset by progress and by `done`. */
  private readonly attempts = new Map<string, number>();
  /** Malformed answers for one binding: after the last backoff step it is failed. */
  private readonly malformed = new Map<number, number>();
  /** Workspaces whose key is not configured, for this tick: no call is made for them again until the next. */
  private readonly notConfigured = new Set<string>();
  /** Workspaces whose key Linear refused (401): no call until the time. ONE OWNER for both lanes that write (review 2394 A-3): the
   *  plan sync's own 401 and an inbound close's go through `keyRefused`, and the inbound lane reads `keyBlockedUntil`. */
  private readonly blockedUntil = new Map<string, number>();
  /** D-8183 (carried M3/A9): a step's failure holds that step's WORKSPACE for its programme (`<slug>|<workspaceId>`), not the
   *  whole programme: the pass goes on with its runnable steps in other workspaces, and its row is deferred, as a failure, to the
   *  earliest hold only when nothing else is runnable. Each hold escalates on its own step counter (`attempts` under the same key). In
   *  process memory: a restart forgets them (the row's own hold is persisted). */
  private readonly wsHolds = new Map<string, { until: number; why: SyncDeferral }>();
  constructor(private readonly deps: PlanSyncDeps) {}

  // ── The tick ──

  /** One beat: requeue the failed bindings that have earned another try, then run a pass for each programme due past its
   *  debounce, one at a time, until the tick's deadline. A pass in flight (even the one a restarted tick left) is joined. */
  async tick(now: number): Promise<void> {
    this.notConfigured.clear();
    try { await this.settleInitiativesItems(now); } catch { console.warn('ccrc-server: linear plan sync initiatives item settle failed'); }
    try { this.meetOperatorActs(now); } catch { console.warn('ccrc-server: linear plan sync operator-act check failed'); }
    const deadlineAt = this.deps.now() + (this.deps.tickDeadlineMs ?? PLAN_SYNC_TICK_DEADLINE_MS);
    try { await this.requeueSweep(now); } catch { console.warn('ccrc-server: linear plan sync requeue failed'); }
    for (const key of this.deps.plan.dueSyncs(now - PLAN_SYNC_DEBOUNCE_MS)) {
      if (this.deps.now() >= deadlineAt) return;
      try { await this.passFor(key, deadlineAt); } catch { console.warn('ccrc-server: linear plan sync pass failed'); }
    }
  }

  /** §4.1's design call: an `operator-act` checkpoint whose operator item is done is met, with the item as its evidence
   *  (`markCheckpointMet` settles its epic and marks its programme due; the programme's pass then writes the milestone). */
  private meetOperatorActs(now: number): void {
    for (const c of this.deps.plan.openOperatorActs()) {
      if (this.deps.coord.itemById(c.itemId)?.state !== 'done') continue;
      this.deps.plan.markCheckpointMet(c.checkpointId, { itemId: c.itemId }, now);
      this.deps.plan.markSyncDue(c.program, now - PLAN_SYNC_DEBOUNCE_MS);
    }
  }

  /** C10 and C17 (`requeueVerdict`): a `failed` binding gets another try when its workspace's directory was filled after the
   *  failure (a status type added, write access regained by a verified key, the probe turned on), and otherwise once the last
   *  backoff step has passed since `failedAt`; its programme is then due. (The inputs trigger is the pass's own: it has the
   *  snapshot.) */
  private async requeueSweep(now: number): Promise<void> {
    const slots = slotsOf(await this.deps.readLinearStore());
    this.recheckSettledProbes(slots, now);
    const keys = [...this.deps.coord.programs().map((p) => p.slug), ...this.deps.plan.upkeepProjectsOf().map((project) => `${UPKEEP_DUE_PREFIX}${project}`)];
    for (const key of keys) {
      let requeued = false;
      for (const b of this.deps.plan.bindingsOf(key)) {
        if (b.state !== 'failed') continue;
        const slot = slots.get(b.workspaceId);
        const filledAt = slot === undefined ? null : this.deps.directory.filledAt(slot.ref, slot.digest);
        requeued = this.requeue(b, requeueVerdict(b, { kind: 'time', filledAt, olderThan: now - LAST_BACKOFF_MS })) || requeued;
      }
      if (requeued) this.deps.plan.markSyncDue(key, now - PLAN_SYNC_DEBOUNCE_MS);
    }
  }

  /** A programme settled without its initiative at a probe episode's bound is due again once its workspace's directory was
   *  refilled since (or the episode ended): the next pass reads the probe again, creating and linking the initiative on `on`. */
  private recheckSettledProbes(slots: Map<string, SlotInfo>, now: number): void {
    // The settled marks are the store's (D-8183): a restart keeps them, so a refill reading `on` still finds the programme due.
    for (const [ws, slugs] of this.deps.plan.settledProbes()) {
      const slot = slots.get(ws);
      const filledAt = slot === undefined ? null : this.deps.directory.filledAt(slot.ref, slot.digest);
      if (!probeRecheckDue(this.streakOf(`probe|${ws}`), filledAt)) continue;
      for (const slug of slugs) this.deps.plan.markSyncDue(slug, now - PLAN_SYNC_DEBOUNCE_MS);
      this.deps.plan.clearSettledProbes(ws);
    }
  }

  /** Write a requeue verdict: whether the binding was returned. */
  private requeue(b: BindingRow, verdict: RequeueVerdict): boolean {
    if (verdict === 'stay') return false;
    return this.deps.plan.requeueFailed({ bindingId: b.id, to: verdict === 'to-bound' ? 'bound' : 'pending' }) > 0;
  }

  /** The operator's Check again on an initiatives item: queue the probe for that workspace's slot and answer at once, never
   *  awaiting it. False when no slot serves the workspace or this sync has no way to queue. */
  async checkInitiatives(workspaceId: string): Promise<boolean> {
    const slot = slotsOf(await this.deps.readLinearStore()).get(workspaceId);
    if (slot === undefined || this.deps.queueDirectory === undefined) return false;
    this.deps.queueDirectory(slot.ref);
    return true;
  }

  private openInitiativesItems(now: number): { id: number; workspaceId: string }[] {
    const out: { id: number; workspaceId: string }[] = [];
    for (const i of this.deps.coord.itemsFor(LINEAR_SYNC_PROGRAMME, now).open) {
      if (i.action?.verb === 'linear-initiatives') out.push({ id: i.id, workspaceId: i.action.workspaceId });
    }
    return out;
  }

  /** Raise the operator item of a workspace reading `off` (L1's `initiativesItemVerdicts` decides; this acts). One item per
   *  workspace: the open ones are looked up by their action. */
  private reconcileInitiativesItems(snap: SyncSnapshot): void {
    const { coord } = this.deps;
    const now = this.deps.now();
    const open = new Set(this.openInitiativesItems(now).map((i) => i.workspaceId));
    for (const { workspaceId, verdict } of initiativesItemVerdicts(snap, open)) {
      if (verdict === 'raise') coord.raiseItem(initiativesItemInput(workspaceId), now, 'ccrc');
    }
  }

  /** Each beat, independent of any programme being due: an open initiatives item whose workspace now reads `on` settles, and
   *  the programmes that were waiting on an initiative there are marked due, so the next beat creates them. Nothing but one
   *  query when no item is open. */
  private async settleInitiativesItems(now: number): Promise<void> {
    const open = this.openInitiativesItems(now);
    if (open.length === 0) return;
    const store = await this.deps.readLinearStore();
    const slots = slotsOf(store);
    const readsOf = (ws: string): 'on' | 'off' | 'unknown' | null => {
      const slot = slots.get(ws);
      return slot === undefined ? null : this.deps.directory.get(slot.ref, slot.digest)?.initiatives ?? null;
    };
    for (const item of initiativesItemsToSettle(open, readsOf)) {
      const moved = this.deps.coord.moveItem(item.id, 'settle', 'ccrc', { note: 'Initiatives are on in this workspace.' }, now, { programmeHasOpenRun: false });
      if (!moved.ok) continue;
      for (const p of this.deps.coord.programs()) {
        const snap = this.snapshot(p.slug, store)?.snap;
        if (snap?.projects.some((x) => x.workspaceId === item.workspaceId && x.initiatives === 'on')) {
          this.deps.plan.markSyncDue(p.slug, now - PLAN_SYNC_DEBOUNCE_MS);
        }
      }
    }
  }

  // ── The flights ──

  /** Run one pass for `key`, or join the one in flight. The tick and `ensureTicketBound` both come through here. */
  passFor(key: string, deadlineAt: number): Promise<'done' | 'deferred'> {
    const hit = this.passes.get(key);
    if (hit !== undefined) return hit;
    const p: Promise<'done' | 'deferred'> = this.withFlight(key, () => this.runPass(key, deadlineAt)).finally(() => {
      if (this.passes.get(key) === p) this.passes.delete(key);
    });
    this.passes.set(key, p);
    return p;
  }

  /** Run `fn` as the only writer of `key`'s objects: after every flight already queued, before any later one. */
  withFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return run;
  }

  /** What the plan says each bound object's owned fields are (D-8183, §6.2), from the very deciders the sync sends by
   *  (`planSyncSteps`' `owned`): one computation, never a second copy of the rules. Read-only: it reads the stores, writes none,
   *  calls nothing in Linear and joins no flight; its snapshot neither advances the D-8701 episode streaks nor asks the refresher
   *  for a fill (`readOnly`, review 2386 A2). Null when the key has no programme (or, for `upkeep:<project>`, no Upkeep epic yet). */
  async plannedOwned(key: string): Promise<{ bindings: BindingRow[]; owned: PlannedOwned[] } | null> {
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    const built = this.snapshot(key, store, true);
    return built === null ? null : { bindings: built.snap.bindings, owned: planSyncSteps(built.snap).owned };
  }

  /** The drift pass's restore (D-8183, §7.2): it puts the named bindings' planned fields back, in the key's flight, so it runs
   *  after any pass in flight and never between two of its steps. It RE-READS THE PLAN INSIDE THE FLIGHT: a target whose
   *  binding is gone, no longer `bound`, or whose fingerprint is no longer the one the drift pass read (`seen`) is `moot`,
   *  because a sync write landed first and wrote the newer plan (a restore of the older value would undo it, and the drift read
   *  was a catch-up). Its steps are the sync's own (`planSyncSteps` with the targets forced), each sent through `execute`, so
   *  C12's issue read, the outcome table, the binding writes and the coordinator's mails apply as for any sync step, under the
   *  pass `drift-restore`. A refusal that fails the binding (`linear-forbidden`, `linear-invalid`) is `refused` with its word; a
   *  deferring answer is `deferred`. The comment follows a restored target: a failed comment never fails the binding. */
  restore(key: string, targets: readonly RestoreTarget[], pass: RestorePass): Promise<RestoreOutcome[]> {
    return this.withFlight(key, async () => {
      const outcome = (t: RestoreTarget, o: RestoreOutcome['outcome'], word?: string, commented = false): RestoreOutcome =>
        ({ bindingId: t.bindingId, outcome: o, ...(word === undefined ? {} : { word }), commented });
      // Round 6 P3: a restore is a write, so it asks every hold the sync keeps, inside the flight and before it sends: the programme's
      // persisted failure hold here, its workspace's and its key's per target below. Nothing is sent and the drift read comes again.
      // Review 2457 A3: a hold answers `deferred` only for a target that would otherwise be sent; a moot target is `moot` held or not
      // (`restoreTargetVerdict`), so the snapshot is read even while the programme is held (read-only then: a held programme advances
      // no episode and asks for no fill).
      const now = this.deps.now();
      const programmeHeld = restoreHoldVerdict({ programmeHeldUntil: this.deps.plan.heldSyncUntil(key, now), releaseAt: 0, now }) === 'defer';
      const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
      if (store.kind === 'unreadable') return targets.map((t) => outcome(t, 'deferred'));
      const built = this.snapshot(key, store, programmeHeld);
      if (built === null) return targets.map((t) => outcome(t, 'moot'));
      const heldTarget = (t: RestoreTarget): boolean => {
        const ws = built.snap.bindings.find((x) => x.id === t.bindingId)?.workspaceId;
        return ws !== undefined && restoreHoldVerdict({ programmeHeldUntil: null, releaseAt: this.releaseOf(key, ws), now: this.deps.now() }) === 'defer';
      };
      const verdicts = new Map(targets.map((t) => {
        const b = built.snap.bindings.find((x) => x.id === t.bindingId);
        const moot = !(b !== undefined && b.state === 'bound' && b.linearId !== null && b.fingerprint === t.seen);
        return [t.bindingId, restoreTargetVerdict({ moot, programmeHeld, targetHeld: heldTarget(t) })] as const;
      }));
      const force = new Map(targets.filter((t) => verdicts.get(t.bindingId) === 'send').map((t) => [t.bindingId, t.tag] as const));
      const steps = planSyncSteps(built.snap, { force }).steps;
      const deadlineAt = this.deps.now() + PLAN_SYNC_TICK_DEADLINE_MS;
      const out: RestoreOutcome[] = [];
      for (const t of targets) {
        if (!force.has(t.bindingId)) { out.push(outcome(t, verdicts.get(t.bindingId) === 'moot' ? 'moot' : 'deferred')); continue; }
        const mine = steps.filter((x): x is Restorable => (x.kind === 'update' || (x.kind === 'link' && t.link === true)) && x.bindingId === t.bindingId);
        if (mine.length === 0) { out.push(outcome(t, 'deferred')); continue; }          // nothing to send (a skip): the sync's own pass says why
        let flow: Flow = 'next';
        const note: SendNote = { wrote: false, same: false };
        for (const step of mine) {
          flow = await this.execute(key, this.withRestoredLine(t.holdState === true && step.kind === 'update' && step.op === 'issueUpdate' ? withoutState(step) : step, t), built, deadlineAt, pass, note);
          if (flow !== 'next') break;
        }
        const b = this.bindingById(key, t.bindingId);
        const final = mine[mine.length - 1]!.fingerprint;
        if (flow !== 'next') { out.push(outcome(t, 'deferred')); continue; }
        if (b?.state === 'failed') { out.push(outcome(t, 'refused', b.failedWord ?? 'unknown')); continue; }
        // A-4: a restore is recorded only when something was written. Nothing sent because Linear already holds the plan is `moot`;
        // nothing sent because the key or the slot is missing is `deferred`: either way no comment and no record.
        if (!note.wrote) { out.push(outcome(t, note.same ? 'moot' : 'deferred')); continue; }
        if (b === null || b.state !== 'bound' || b.fingerprint !== final) { out.push(outcome(t, 'deferred')); continue; }
        const commented = t.comment === undefined ? false : await this.restoreComment(key, b, t.comment, built, pass);
        out.push(outcome(t, 'restored', undefined, commented));
      }
      return out;
    });
  }

  /** A milestone's restore replaces its update's description with `restoredDescription`: this Restored line and the two newest
   *  Linear holds, first, then the planned text, fitted to Linear's cap (a milestone takes no comment in Linear, D-8407; D-8708);
   *  the step's fingerprint stays the plan's, the lines are not plan text. */
  private withRestoredLine(step: Restorable, t: RestoreTarget): Restorable {
    if (t.restoredLine === undefined || step.kind !== 'update' || step.op !== 'projectMilestoneUpdate') return step;
    const description = restoredDescription(String(step.input['description'] ?? ''), t.restoredLine.linearDescription, t.restoredLine.line);
    return { ...step, input: { ...step.input, description } };
  }

  /** The drift comment on a restored object: an initiative, a project or an issue (never a milestone). A `conflict` answer is a
   *  comment made already (the same request id). Answers whether it was sent or found made.
   *
   *  PUBLIC TEXT (review 2457 F3, the coordinator's ruling; spec §6.1): the comment passes the same check as every sync step's text
   *  (`textRefusalOf`, with the binding's project facts and the installer's private tracker keys) before it is sent. Refused, the
   *  restore's field writes have gone already and the comment is the fixed fallback (`restoreCommentChoice`), and the refusal is told
   *  once to the owner in a fixed sentence (`mailRestoreTextRefused`), as a sync step's text refusal is told: it fails no binding
   *  here, since the fields were put back. */
  private async restoreComment(slug: string, b: BindingRow, c: { body: string; fallbackBody: string; requestId: string }, built: NonNullable<ReturnType<PlanSync['snapshot']>>, pass: RestorePass): Promise<boolean> {
    const slot = built.slots.get(b.workspaceId);
    if (slot === undefined || b.linearId === null) return false;
    const chosen = restoreCommentChoice(c, textRefusalOf([c.body], textFactsOf(built.snap, b), built.snap.privateTrackerKeys));
    if (chosen.refused) this.mailRestoreTextRefused(slug, b, built.snap.plan);
    const [op, key, target, teamKey] = b.localKind === 'programme' ? ['initiativeComment', 'initiativeId', b.linearId, null] as const
      : b.localKind === 'epic' ? ['projectComment', 'projectId', b.linearId, b.teamKey] as const
      : b.localKind === 'ticket' ? ['issueComment', 'issueId', b.identifier ?? b.linearId, b.teamKey] as const : [null, null, null, null] as const;
    if (op === null) return false;
    const out = await this.deps.call({
      op, pass, lane: 'sync', slot: slot.ref, workspaceId: b.workspaceId, teamKey, target, fields: ['body'],
      input: { requestId: c.requestId, [key]: b.linearId, body: chosen.body },
    });
    return out.ok || (out.word === 'linear-invalid' && out.detail === 'conflict');
  }

  // ── The dispatch (§5.6) ──

  /** The workspace slug a dispatch of `runId` takes (the route's whole rule): a ticket slug when the run is a fresh `work`
   *  spawn for a ticket in a `private` project and the ticket's issue is bound within {@link PLAN_SYNC_DISPATCH_WAIT_MS};
   *  otherwise `undefined`, and the dispatch goes as it would without the sync (a resumed run's branch is its session's, a
   *  public project's never carries the identifier). `given` is the slug the caller sent: kept after the identifier; a
   *  value that is not a string is the dispatch's to refuse, so it answers `undefined`. It never throws. */
  async dispatchSlug(runId: number, given: unknown): Promise<string | undefined> {
    try {
      if (given !== undefined && typeof given !== 'string') return undefined;
      const found = this.ticketOfRun(runId);
      if (found === null || found.run.kind !== 'work' || found.run.sessionId !== null) return undefined;
      if (this.deps.coord.linkingOf(found.ticket.project).mode !== 'private') return undefined;
      const { identifier } = await this.ensureTicketBound(runId, PLAN_SYNC_DISPATCH_WAIT_MS);
      return identifier === null ? undefined : slugForTicket(identifier, given, found.ticket.title);
    } catch { return undefined; }
  }

  /** Join the pass in flight for the run's programme, or start one (`passFor`: a wave's parallel dispatches share it), and
   *  wait for it at most `budgetMs` (a joined pass keeps its first caller's deadline, so the wait is bounded here, and the
   *  timer is cleared whichever side settles). The answer is the run's ticket's binding as it stands. */
  async ensureTicketBound(runId: number, budgetMs: number): Promise<{ identifier: string | null }> {
    const found = this.ticketOfRun(runId);
    if (found === null) return { identifier: null };
    const { plan } = this.deps;
    const slug = found.run.program;
    const boundNow = (): string | null => plan.bindingsOf(slug).find((x) => x.localKind === 'ticket' && x.localId === found.ticket.id && x.state === 'bound' && x.identifier !== null)?.identifier ?? null;
    // M-5: bound already, so the wait is for nothing. A7/A12: a programme held by a failure's backoff (Linear unreachable, a refused key)
    // starts no pass from a dispatch: the dispatch goes as it would without the sync, and the PR is linked once the issue appears.
    const first = dispatchWaitVerdict({ identifier: boundNow(), programmeHeldUntil: plan.heldSyncUntil(slug, this.deps.now()), workspaceHeld: false, now: this.deps.now() });
    if (first !== 'wait') return { identifier: boundNow() };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); });
    try {
      await Promise.race([this.startFor(slug, found.ticket, budgetMs).then(() => undefined, () => undefined), waited]);
    } finally { clearTimeout(timer); }
    return { identifier: boundNow() };
  }

  /** The workspace a ticket's issue is (or would be) in: where its binding is, else where its project's team routes. Null: none. */
  private async workspaceOfTicket(slug: string, t: TicketRow): Promise<string | null> {
    const bound = this.deps.plan.bindingsOf(slug).find((b) => b.localKind === 'ticket' && b.localId === t.id);
    if (bound !== undefined) return bound.workspaceId;
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    return this.workspaceOfProject(t.project, store.kind === 'listed' ? routableSlots(store) : []);
  }

  /** The workspace a project's linked team routes to (`routeProjectTeam`), null when it has no team or no slot serves it. */
  private workspaceOfProject(project: string, listed: ReturnType<typeof routableSlots>): string | null {
    const l = this.deps.coord.linkingOf(project);
    const route = l.teamKey === null ? null : routeProjectTeam(listed, { teamKey: l.teamKey, workspaceId: l.teamWorkspace ?? null });
    return route !== null && route.kind === 'slot' ? route.slot.workspaceId : null;
  }

  /** Mark the programme due and join or start its pass, unless the ticket's workspace is held by a failure of this programme's steps
   *  there (D-8183: the row itself may be due again when another workspace's shorter hold has passed): then the dispatch goes as it
   *  would without the sync. The timer is the caller's and is already running, so this may read the store. */
  private async startFor(slug: string, t: TicketRow, budgetMs: number): Promise<void> {
    const ws = await this.workspaceOfTicket(slug, t);
    const held = dispatchWaitVerdict({ identifier: null, programmeHeldUntil: null, workspaceHeld: ws !== null && this.releaseOf(slug, ws) > this.deps.now(), now: this.deps.now() });
    if (held !== 'wait') return;
    this.deps.plan.markSyncDue(slug, this.deps.now() - PLAN_SYNC_DEBOUNCE_MS);
    await this.passFor(slug, this.deps.now() + budgetMs);
  }

  private ticketOfRun(runId: number): { run: NonNullable<Extract<ReturnType<CoordStore['run']>, { ok: true }>['run']>; ticket: TicketRow } | null {
    const read = this.deps.coord.run(runId);
    if (!read.ok || read.run === null) return null;
    const ticket = this.deps.plan.planOf(read.run.program).epics.flatMap((e) => e.tickets).find((t) => t.runId === runId);
    return ticket === undefined ? null : { run: read.run, ticket };
  }

  // ── One pass ──

  private async runPass(slug: string, deadlineAt: number): Promise<'done' | 'deferred'> {
    const { plan } = this.deps;
    for (let taken = 0; ; taken += 1) {
      if (this.deps.now() >= deadlineAt || taken >= MAX_STEPS_PER_PASS) return 'deferred';
      let store: LinearStoreRead;
      try { store = await this.deps.readLinearStore(); } catch { store = { kind: 'unreadable', code: 'unreadable' }; }
      // C18: a store that cannot be read is not "no Linear": the pass waits on the backoff and its due row stays.
      if (store.kind === 'unreadable') { this.deferFor(slug, 'store-unreadable'); return 'deferred'; }
      // Everything from here to the decision is synchronous: a plan write cannot land between the snapshot and the
      // `clearSyncDue` below, so a put is either in this snapshot or leaves its due row to the next pass.
      const built = this.snapshot(slug, store);
      if (built === null) { plan.clearSyncDue(slug); return 'done'; }
      try { if (built.snap.program !== null) this.reconcileInitiativesItems(built.snap); } catch { console.warn('ccrc-server: linear plan sync initiatives item failed'); }
      const { steps, failedInputs, notices, waits } = planSyncSteps(built.snap);
      for (const n of notices) this.mailOpenIssuesLeft(slug, n.count);
      let requeued = false;
      for (const f of failedInputs) {
        const b = built.snap.bindings.find((x) => x.id === f.bindingId);
        if (b !== undefined) requeued = this.requeue(b, requeueVerdict(b, { kind: 'inputs', inputs: f.inputs })) || requeued;
      }
      if (requeued) continue;

      const actionable = steps.filter((s) => this.actionable(s, built.snap.bindings));
      const waiting = new Set(built.waiting);
      const blocked = (ws: string | null): boolean => ws !== null && (waiting.has(ws) || this.notConfigured.has(ws) || this.releaseOf(slug, ws) > this.deps.now());
      const runnable = actionable.filter((s) => !blocked(s.workspaceId));
      if (runnable.length === 0) {
        if (actionable.length === 0) {
          // An initiative waiting on the probe (it reads `unknown`): ask the refresher for a refill and come back on the
          // backoff, so the programme is never settled without its initiative (fix round 1, F1). The refresher's own window
          // bounds what the asks cost.
          // Past the episode's bound (D-8701, ruling of mail 22220) it is settled without the initiative, its coordinator told
          // once, and no refill is asked for it: the next refill or plan change looks again.
          const probe = probeWaitsVerdict(waits, (ws) => this.streakOf(`probe|${ws}`));
          for (const ws of probe.bounded) {
            this.mailEpisode(slug, ws, 'probe', built.snap);
            plan.addSettledProbe(ws, slug);
          }
          const waitsOn = probe.waitOn.flatMap((ws) => { const slot = built.slots.get(ws); return slot === undefined ? [] : [slot]; });
          if (waitsOn.length > 0) {
            for (const slot of waitsOn) this.deps.directoryMiss(slot.ref, slot.digest);
            this.deferFor(slug, 'initiatives-unknown');
            return 'deferred';
          }
          plan.clearSyncDue(slug); this.attempts.delete(slug); this.clearHolds(slug); return 'done';
        }
        const held = [...new Set(actionable.flatMap((s) => (s.workspaceId === null ? [] : [s.workspaceId])))]
          .flatMap((ws) => { const until = this.releaseOf(slug, ws); return until > this.deps.now() ? [{ until, why: this.wsHolds.get(`${slug}|${ws}`)?.why ?? deferralOf('workspace-blocked').why }] : []; })
          .sort((a, b) => a.until - b.until);
        const waitedOn = [...new Set(actionable.flatMap((s) => (s.workspaceId !== null && waiting.has(s.workspaceId) ? [s.workspaceId] : [])))];
        if (waitedOn.length > 0) {
          // I1: statuses never read wait on the backoff, and past the bound the coordinator is told once per episode.
          const unread = new Set(built.unread);
          const w = directoryWaitVerdict(waitedOn.map((ws) => ({ workspaceId: ws, missing: unread.has(ws) ? 'statuses' as const : 'directory' as const, streak: this.streakOf(`statuses|${ws}`) })));
          for (const ws of w.tell) this.mailEpisode(slug, ws, 'statuses');
          this.deferFor(slug, w.cause);
        } else if (held.length > 0) this.deferUntil(slug, held[0]!.until, held[0]!.why);   // the earliest workspace hold (D-8702)
        return 'deferred';                                   // not configured: the due row stays for the next tick
      }
      const flow = await this.execute(slug, runnable[0]!, built, deadlineAt, 'plan-sync');
      if (flow === 'defer') return 'deferred';          // `held`: that workspace is out of this pass, the others go on
    }
  }

  /** Whether a step is work: an `initiatives-off` or `no-team-key` skip is only a statement, and a skip whose binding is
   *  already failed has been told. */
  private actionable(s: SyncStep, bindings: readonly BindingRow[]): boolean {
    if (s.kind !== 'skip') return true;
    if (s.why === 'initiatives-off' || s.why === 'no-team-key') return false;
    return s.bindingId === null || bindings.find((b) => b.id === s.bindingId)?.state !== 'failed';
  }

  /** The programme as `planSyncSteps` reads it, from the stores, synchronously (the store listing is read first). A key
   *  `upkeep:<project>` reads that project's Upkeep epic instead (D-8183): `program` is null, there is no programme row, and a
   *  project with no Upkeep epic has no snapshot. `readOnly` (the drift pass's `plannedOwned`): no episode is observed and no fill
   *  is asked for, so a read changes nothing. */
  private snapshot(slug: string, store: LinearStoreRead, readOnly = false): { snap: SyncSnapshot; slots: Map<string, SlotInfo>; waiting: string[]; unread: string[] } | null {
    const { plan, coord } = this.deps;
    const upkeep = slug.startsWith(UPKEEP_DUE_PREFIX);
    const rowid = upkeep ? null : plan.programmeRowId(slug);
    const found = upkeep ? undefined : coord.programs().find((p) => p.slug === slug);
    const prog = rowid === null || found === undefined ? null : { rowid, row: found };
    if (!upkeep && prog === null) return null;
    const stored = withoutPutBack(upkeep ? plan.upkeepPlanOf(slug.slice(UPKEEP_DUE_PREFIX.length)) : plan.planOf(slug));   // Task 3.1: a record Put back dropped is never in the snapshot
    if (upkeep && stored.epics.length === 0) return null;
    const bindings = plan.bindingsOf(slug);
    const planEnd = upkeep ? null : plan.planEndOf(slug);
    const tickets = stored.epics.flatMap((e) => e.tickets);
    const outcome = prog === null ? null : programmeEnd({
      planEnd: planEnd?.outcome ?? null, programState: prog.row.state, epics: stored.epics,
      openTickets: tickets.filter((t) => t.state === 'open' || t.state === 'started').length,
    });
    const slots = slotsOf(store);
    const listed = store.kind === 'listed' ? routableSlots(store) : [];
    const projectNames = [...new Set(stored.epics.flatMap((e) => [e.project, ...e.tickets.map((t) => t.project)]))];
    const projects: SyncSnapshot['projects'] = projectNames.map((project) => {
      const l = coord.linkingOf(project);
      return {
        project, teamKey: l.teamKey, workspaceId: this.workspaceOfProject(project, listed),
        mode: l.mode, initiatives: plan.hierarchySettingsOf(project).initiatives,
      };
    });
    const waiting: string[] = [];
    const unread: string[] = [];
    const workspaces: SyncSnapshot['workspaces'] = [];
    // The workspaces the projects resolve to, and those the programme's initiative is bound in (F2: an old workspace's
    // initiative is still updated and closed after a team key moved away).
    const initiativeWs = bindings.flatMap((b) => (rowid !== null && b.localKind === 'programme' && b.localId === rowid ? [b.workspaceId] : []));
    for (const workspaceId of new Set([...projects.flatMap((p) => (p.workspaceId === null ? [] : [p.workspaceId])), ...initiativeWs])) {
      const slot = slots.get(workspaceId);
      if (slot === undefined) continue;
      const directory = this.deps.directory.get(slot.ref, slot.digest);
      const statuses = this.deps.directory.projectStatusesRead(slot.ref, slot.digest);
      // D-8701: statuses never read wait for a refill as a missing directory does; they are never "no status of that type".
      if (directoryMissed(directory, statuses)) {
        waiting.push(workspaceId);
        if (!readOnly) this.deps.directoryMiss(slot.ref, slot.digest);
        if (directory !== null) unread.push(workspaceId);
      }
      // The episodes' streaks see each fill once, whichever programme's pass reads it first.
      const filledAt = this.deps.directory.filledAt(slot.ref, slot.digest);
      const look = (unsettled: boolean): FillLook => ({ keyDigest: slot.digest, filledAt, reading: directory === null ? 'none' : unsettled ? 'unsettled' : 'settled' });
      if (!readOnly) {
        this.observe(`probe|${workspaceId}`, look(directory?.initiatives === 'unknown'));
        this.observe(`statuses|${workspaceId}`, look(statuses !== 'read'));
      }
      workspaces.push({ workspaceId, initiatives: directory?.initiatives ?? 'unknown', directory, teams: slot.teams });
    }
    const goals = prog === null ? null : coord.goalsFor(slug);
    const ticketPrs = this.ticketPrsOf(tickets, bindings);
    const snap: SyncSnapshot = {
      program: prog === null || goals === null ? null : {
        slug, rowid: prog.rowid, title: prog.row.title, inShort: goals.inShort,
        end: outcome === null ? null : { outcome, why: planEnd?.why ?? null, at: planEnd?.at ?? this.deps.now() },
        doneWhen: planViewOf(stored, goals.doneWhen ?? [], bindings).doneWhen, paused: prog.row.state === 'paused',
      },
      plan: stored, bindings, workspaces, projects, privateTrackerKeys: [...this.deps.privateTrackerKeys], ticketPrs,
    };
    return { snap, slots, waiting, unread };
  }

  /** §5.6: the PR of each bound ticket's run, as a URL on the project's measured repository (an unmeasured repository has no
   *  URL to give, so its tickets are not linked). A port that throws is no PR. */
  private ticketPrsOf(tickets: readonly TicketRow[], bindings: readonly BindingRow[]): NonNullable<SyncSnapshot['ticketPrs']> {
    const out: NonNullable<SyncSnapshot['ticketPrs']> = {};
    const { prOfRun, coord } = this.deps;
    if (prOfRun === undefined) return out;
    for (const t of tickets) {
      if (t.runId === null || !bindings.some((b) => b.localKind === 'ticket' && b.localId === t.id && b.state === 'bound')) continue;
      try {
        const pr = prOfRun(t.runId);
        const m = coord.linkingOf(t.project).measured;
        if (pr !== null && m.state === 'measured') out[t.id] = { number: pr.number, branch: pr.branch, url: `https://github.com/${m.slug}/pull/${pr.number}` };
      } catch { /* no PR known */ }
    }
    return out;
  }

  // ── One step ──

  private async execute(slug: string, step: SyncStep, built: NonNullable<ReturnType<PlanSync['snapshot']>>, deadlineAt: number, pass: SendPass = 'plan-sync', note?: SendNote): Promise<Flow> {
    const { plan } = this.deps;
    if (step.kind === 'skip') {
      // `status-missing`, `text-public`, `workspace-mismatch`: the object's binding is failed with the reason.
      const ws = step.workspaceId;
      if (ws === null) return 'next';
      const b = step.bindingId !== null ? built.snap.bindings.find((x) => x.id === step.bindingId) ?? null
        : plan.ensurePending(step.local.kind, step.local.id, ws, null);
      if (b === null) return 'next';
      // A2: failing a binding writes coord.db and mails; it calls nothing in Linear, so it needs no slot. A `workspace-mismatch`
      // whose old workspace no slot serves is failed and told once like any other, never left due at every beat.
      this.fail({ slug, local: step.local, workspaceId: ws, bindingId: b.id, inputs: step.inputs ?? '', plan: built.snap.plan }, step.why);
      return 'next';
    }
    const slot = built.slots.get(step.workspaceId);
    if (slot === undefined) { this.notConfigured.add(step.workspaceId); return 'next'; }
    let b = step.bindingId === null ? null : built.snap.bindings.find((x) => x.id === step.bindingId) ?? null;
    const subject = (bindingId: number | null): Subject => ({ slug, local: step.local, workspaceId: step.workspaceId, bindingId, inputs: step.inputs, slot, plan: built.snap.plan, pass });

    if (step.kind === 'create') {
      const existed = b !== null;
      b ??= plan.ensurePending(step.local.kind, step.local.id, step.workspaceId, step.teamKey);
      if (existed && step.recover !== 'request-id') {
        const r = await this.recover(step, b, subject(b.id), built);
        if (r === 'bound' || r === 'next') return 'next';
        if (r === 'defer' || r === 'held') return r;
        if (this.deps.now() >= deadlineAt) return 'defer';
      }
      const out = await this.deps.call(this.askOf(step, slot, b, pass));
      if (out.ok) {
        const id = out.created ?? (typeof out.value['id'] === 'string' ? out.value['id'] : null);
        if (id === null) return this.hold(subject(b.id), 'created-without-id');   // ok without an id: it may have been sent
        // A6 (§5.5): a create records the team it was made in, also on a binding a skip made first with none.
        this.bind(b, id, this.identifierOf(out, b), step.fingerprint, step.teamKey);
        this.progressed(slug, step.workspaceId);
        return 'next';
      }
      if (out.word === 'linear-invalid' && out.detail !== undefined) {
        if (this.deps.now() >= deadlineAt) return 'defer';
        return this.bindExisting(step, b, subject(b.id), built);
      }
      return this.onFailure(out, subject(b.id));
    }

    // an update or a link: the binding is bound
    if (b === null || b.linearId === null) return 'next';
    let send = step;
    // An issue update asks the policy and the journal with the issue's CURRENT team (`LinearWriteAsk.resource.teamKey`), read
    // by C12's read; a move's destination team rides `destinationTeamKey` (C15).
    let currentTeam: string | null = b.teamKey ?? step.teamKey;
    if (step.kind === 'update' && step.stateType !== undefined) {
      const held = await this.readIssue(step, b, subject(b.id), deadlineAt);
      if (typeof held === 'object') currentTeam = held.team ?? currentTeam;
      const verdict = typeof held === 'object' ? held.verdict : held;
      if (verdict === 'defer' || verdict === 'held') return verdict;
      if (verdict === 'next') return 'next';
      // A10 (§5.5): the read's identifier is the issue's now (a move whose reply was lost has a new one).
      if (verdict === 'same') {
        if (note !== undefined) note.same = true;
        this.bind(b, b.linearId, typeof held === 'object' && held.identifier !== null ? held.identifier : b.identifier, step.fingerprint, step.teamKey);
        this.progressed(slug, step.workspaceId); return 'next';
      }
      send = verdict === 'state-held' ? withoutState(step) : step;
      if (step.comment !== undefined) {
        const c = await this.deps.call({
          op: 'issueComment', pass, lane: 'sync', slot: slot.ref, workspaceId: step.workspaceId, teamKey: currentTeam,
          target: b.identifier ?? b.linearId, fields: ['body'], input: { requestId: step.comment.requestId, issueId: b.linearId, body: step.comment.body },
        });
        // C13: a `conflict` answer is a comment made already (same id): done, like an ok.
        if (!c.ok && !(c.word === 'linear-invalid' && c.detail === 'conflict')) return this.onFailure(c, subject(b.id));
      }
    }
    const ask = this.askOf(send, slot, b, pass);
    // C15: a move writes into the destination team, so the policy is asked about it too (the journal keeps the current one).
    const moves = step.kind === 'update' && step.op === 'issueUpdate' && step.teamKey !== null && currentTeam !== null && currentTeam.toUpperCase() !== step.teamKey.toUpperCase();
    const out = await this.deps.call(step.kind === 'update' && step.op === 'issueUpdate'
      ? { ...ask, teamKey: currentTeam, ...(moves ? { destinationTeamKey: step.teamKey } : {}) } : ask);
    if (out.ok) {
      if (note !== undefined) note.wrote = true;
      this.bind(b, b.linearId, this.identifierOf(out, b), step.fingerprint, step.kind === 'update' && step.op === 'issueUpdate' ? step.teamKey : undefined);
      this.progressed(slug, step.workspaceId);
      return 'next';
    }
    // C4: a link answered "conflict" is a link that exists already: the same write as an ok.
    if (step.kind === 'link' && out.word === 'linear-invalid' && out.detail === 'conflict') {
      if (note !== undefined) note.same = true;
      this.bind(b, b.linearId, b.identifier, step.fingerprint);
      return 'next';
    }
    // C16: a PR link refused with a failing word is given up for that URL: the issue stays bound, its fingerprint records the
    // URL as settled (a new URL is tried again), and the coordinator is told once. A deferring word defers as for any step.
    if (step.kind === 'link' && step.op === 'issueLink') {
      const linked = b;
      const issueId = b.linearId;
      return this.onFailure(out, subject(b.id), (word) => {
        this.bind(linked, issueId, linked.identifier, step.fingerprint);
        this.mailLinkGivenUp(subject(linked.id), word);
      });
    }
    return this.onFailure(out, subject(b.id));
  }

  /** C12 and C19: an issue's planned state is a TYPE, and Linear owns the name. Read the issue first and ask
   *  `issueReadVerdict` what to send (`same`: the fingerprint only; `state-held`: the update without its state; `send`: as
   *  planned, a move's state with it); a read that cannot tell (`not-found`) sends the update as planned and lets its own
   *  answer rule. */
  private async readIssue(step: Extract<SyncStep, { kind: 'update' }>, b: BindingRow, s: Subject, deadlineAt: number): Promise<'send' | 'next' | 'defer' | 'held' | { verdict: 'send' | 'state-held' | 'same'; team: string | null; identifier: string | null }> {
    if (step.op !== 'issueUpdate') return 'send';
    if (this.deps.now() >= deadlineAt) return 'defer';
    const out = await this.deps.call(this.readAsk('issueOwned', s, step.teamKey, { id: b.linearId! }));
    if (!out.ok) return out.word === 'not-found' ? 'send' : this.onFailure(out, s);
    const issue = out.value['issue'] as IssueRead & { identifier?: unknown };
    return {
      verdict: issueReadVerdict(issue, step), team: typeof issue.teamKey === 'string' ? issue.teamKey : null,
      identifier: typeof issue.identifier === 'string' ? issue.identifier : null,
    };
  }

  /** C2': a create whose binding was `pending` at the start of the step may have been sent. Read what Linear holds and adopt
   *  only ccrc's own object (`adoptionVerdict`); anything else sends the create, whose id makes a lost race a `conflict`. */
  private async recover(step: Extract<SyncStep, { kind: 'create' }>, b: BindingRow, s: Subject, built: NonNullable<ReturnType<PlanSync['snapshot']>>): Promise<'bound' | 'send' | 'next' | 'defer' | 'held'> {
    let kind: AdoptionKind;
    let nodes: AdoptionNode[];
    if (step.recover === 'name-and-creator') {
      if (this.viewerOf(built, step.workspaceId) === null) return this.hold(s, 'viewer-unknown');
      const out = await this.deps.call(this.readAsk(step.op === 'initiativeCreate' ? 'initiativesByName' : 'projectsByName', s, step.teamKey, { name: String(step.input['name']) }));
      if (!out.ok) return this.onFailure(out, s);
      kind = step.op === 'initiativeCreate' ? 'initiative' : 'project';
      nodes = out.value['nodes'] as AdoptionNode[];
    } else {
      // name-in-project: read inside ccrc's own bound project (a milestone has no creator, R3)
      const out = await this.deps.call(this.readAsk('projectById', s, step.teamKey, { id: String(step.input['projectId']) }));
      if (!out.ok) return this.onFailure(out, s);
      kind = 'milestone';
      nodes = (out.value['project'] as { milestones?: AdoptionNode[] }).milestones ?? [];
    }
    const v = adoptionVerdict(kind, nodes, this.adoptionAsk(step, b, built));
    if (v.verdict === 'none') return 'send';
    this.bind(b, v.id, null, ADOPTED_FINGERPRINT, v.teamKey ?? step.teamKey);
    return 'bound';
  }

  private viewerOf(built: NonNullable<ReturnType<PlanSync['snapshot']>>, workspaceId: string): string | null {
    return built.snap.workspaces.find((w) => w.workspaceId === workspaceId)?.directory?.viewerId ?? null;
  }

  /** What `adoptionVerdict` is asked with: the create's id, the directory's viewer, and every Linear id
   *  another binding of this programme holds. */
  private adoptionAsk(step: Extract<SyncStep, { kind: 'create' }>, b: BindingRow, built: NonNullable<ReturnType<PlanSync['snapshot']>>): AdoptionAsk {
    const held = new Set(built.snap.bindings.flatMap((x) => (x.id === b.id || x.linearId === null ? [] : [x.linearId])));
    return { requestId: step.requestId, viewer: this.viewerOf(built, step.workspaceId), held };
  }

  /** R2, C11 and D-8183: a create answered "conflict on insert" (or a milestone "name not unique"): an object exists at ccrc's id. An
   *  initiative or project is adopted only when the by-name read shows that id made by this key's viewer, an issue when no other
   *  binding holds it, a milestone only inside ccrc's own bound project (R2): the team it sits in does not matter (the key may have
   *  changed since a lost create), and an issue is bound with the team it is actually in, so the next update moves it. Anything else
   *  fails the binding `linear-invalid`, mailed once, and never sends a second create. Adopted bindings carry the `adopted` fingerprint. */
  private async bindExisting(step: Extract<SyncStep, { kind: 'create' }>, b: BindingRow, s: Subject, built: NonNullable<ReturnType<PlanSync['snapshot']>>): Promise<Flow> {
    const id = step.requestId;
    let kind: AdoptionKind;
    let nodes: AdoptionNode[];
    let identifier: string | null = null;
    if (step.op === 'projectMilestoneCreate') {
      const out = await this.deps.call(this.readAsk('projectById', s, step.teamKey, { id: String(step.input['projectId']) }));
      if (!out.ok) return this.onFailure(out, s);
      kind = 'milestone';
      nodes = (out.value['project'] as { milestones?: AdoptionNode[] }).milestones ?? [];
    } else if (step.op === 'issueCreate') {
      const out = await this.deps.call(this.readAsk('issueOwned', s, step.teamKey, { id }));
      if (!out.ok) return this.onFailure(out, s);
      const issue = out.value['issue'] as AdoptionNode & { identifier?: string };
      kind = 'issue';
      nodes = [issue];
      identifier = typeof issue.identifier === 'string' ? issue.identifier : null;
    } else {
      if (this.viewerOf(built, step.workspaceId) === null) return this.hold(s, 'viewer-unknown');
      // Two reads: the object at ccrc's id (its own name, which a rename since the lost create may have left unlike the plan's),
      // then that name's by-name listing, which carries the creator the by-id read does not select.
      const isInit = step.op === 'initiativeCreate';
      const byId = await this.deps.call(this.readAsk(isInit ? 'initiativeById' : 'projectById', s, step.teamKey, { id }));
      if (!byId.ok) return this.onFailure(byId, s);
      const found = byId.value[isInit ? 'initiative' : 'project'] as { id: string; name: string };
      const out = await this.deps.call(this.readAsk(isInit ? 'initiativesByName' : 'projectsByName', s, step.teamKey, { name: found.name }));
      if (!out.ok) return this.onFailure(out, s);
      kind = isInit ? 'initiative' : 'project';
      nodes = out.value['nodes'] as AdoptionNode[];
    }
    const v = adoptionVerdict(kind, nodes, this.adoptionAsk(step, b, built));
    if (v.verdict === 'none') { this.fail(s, 'linear-invalid'); return 'next'; }
    this.bind(b, v.id, identifier, ADOPTED_FINGERPRINT, v.teamKey ?? step.teamKey);
    return 'next';
  }

  // ── Outcomes: the table, one row each ──

  /** `failWith` is what a failing word does (by default the binding fails with it, C16's link gives the URL up instead). */
  private onFailure(out: Failure, s: Subject, failWith: (word: string) => void = (word) => this.fail(s, word)): Flow {
    switch (out.word) {
      case 'rate-limited': return this.hold(s, out.word, { floorMs: 'retryAfterS' in out ? out.retryAfterS * 1000 : 0 });
      case 'unreachable': case 'timeout': case 'policy-unavailable': case 'journal-unavailable':
        return this.hold(s, out.word);
      case 'malformed': {
        // Sent and answered outside the grammar: as `maybeSent`, and failed after the last backoff step.
        const n = (this.malformed.get(s.bindingId ?? -1) ?? 0) + 1;
        if (s.bindingId !== null) this.malformed.set(s.bindingId, n);
        if (s.bindingId !== null && n > PLAN_SYNC_BACKOFF_MS.length) { failWith('malformed'); return 'next'; }
        return this.hold(s, 'malformed');
      }
      case 'not-configured': this.notConfigured.add(s.workspaceId); return 'next';
      case 'linear-unauthorised': {
        this.hold(s, 'linear-unauthorised');
        this.keyRefused(s.workspaceId, s.slot, this.wsHolds.get(`${s.slug}|${s.workspaceId}`)!.until);
        return 'held';
      }
      default: failWith(out.word); return 'next';
    }
  }

  /** The time a deferral waits to, by the step counter kept under `key`: a programme's slug, or a
   *  workspace hold's `<slug>|<workspaceId>`. The counter moves only when the deferral used a backoff step. */
  private deferTime(key: string, d: Deferral, o: { floorMs?: number; until?: number }): number {
    const step = this.attempts.get(key) ?? 0;
    if (deferralUsesBackoff(d)) this.attempts.set(key, step + 1);
    return deferralUntil(d, { now: this.deps.now(), backoffMs: PLAN_SYNC_BACKOFF_MS[Math.min(step, PLAN_SYNC_BACKOFF_MS.length - 1)]!, ...o, directoryWaitMs: DIRECTORY_WAIT_MS });
  }

  /** Defer the programme for `cause` as `deferralOf` says (M5): its kind, and its time. Answers the time deferred to. For the
   *  causes that are not one workspace's (`store-unreadable`, the pass's own waits); a step's own failure is {@link hold}. */
  private deferFor(slug: string, cause: DeferCause, o: { floorMs?: number; until?: number } = {}): number {
    const d = deferralOf(cause);
    const until = this.deferTime(slug, d, o);
    this.deferUntil(slug, until, d.why);
    return until;
  }

  /** D-8183: a step's failure holds the step's workspace for its programme, on that workspace's own backoff step, and the pass goes
   *  on (`held`); the programme's row is deferred only when nothing else is runnable (`runPass`). */
  private hold(s: { slug: string; workspaceId: string }, cause: DeferCause, o: { floorMs?: number } = {}): Flow {
    const d = deferralOf(cause);
    this.wsHolds.set(`${s.slug}|${s.workspaceId}`, { until: this.deferTime(`${s.slug}|${s.workspaceId}`, d, o), why: d.why });
    return 'held';
  }

  /** A workspace's key was refused (a 401), by the plan sync's own call or an inbound close's (D-8183, review 2394 A-3): no call
   *  in that workspace until `until` (the later of any standing refusal and this one), for every programme and the inbound lane
   *  alike, and the slot is marked rejected through its one owner (`markSlotRejected`), so the key card shows it. */
  keyRefused(workspaceId: string, slot: Pick<SlotInfo, 'ref' | 'digest'>, until: number): void {
    this.blockedUntil.set(workspaceId, Math.max(this.blockedUntil.get(workspaceId) ?? 0, until));
    void this.deps.markSlotRejected(slot.ref, slot.digest, this.deps.now()).catch(() => { /* the key card shows the rest */ });
  }
  /** A workspace's key was refused by one of the drift pass's READS (round 6 P3, A-3): the same hold as a write's 401, on the plan
   *  sync's own schedule (`deferTime` under a key of its own, the `linear-unauthorised` deferral), never a schedule of the pass's.
   *  Answers the time it holds to. */
  keyRefusedByRead(workspaceId: string, slot: Pick<SlotInfo, 'ref' | 'digest'>): number {
    const until = this.deferTime(`read|${workspaceId}`, deferralOf('linear-unauthorised'), {});
    this.keyRefused(workspaceId, slot, until);
    return until;
  }
  /** A drift read in `workspaceId` was answered: the read hold's backoff starts again (as `progressed` does for a write's). */
  keyReadAnswered(workspaceId: string): void { this.attempts.delete(`read|${workspaceId}`); }
  /** Until when a workspace's refused key holds every write lane there (0: not held). */
  keyBlockedUntil(workspaceId: string): number { return this.blockedUntil.get(workspaceId) ?? 0; }

  /** When a workspace is free for this programme again: the later of its key's refusal and its step failure's hold (0: free). */
  private releaseOf(slug: string, ws: string): number {
    return Math.max(this.blockedUntil.get(ws) ?? 0, this.wsHolds.get(`${slug}|${ws}`)?.until ?? 0);
  }

  /** A step made progress in `ws`: the programme's and the workspace's backoff steps start again and the hold is gone. */
  private progressed(slug: string, ws: string): void {
    this.attempts.delete(slug); this.attempts.delete(`${slug}|${ws}`); this.wsHolds.delete(`${slug}|${ws}`);
  }

  private clearHolds(slug: string): void {
    for (const key of [...this.wsHolds.keys()]) if (key.startsWith(`${slug}|`)) { this.wsHolds.delete(key); this.attempts.delete(key); }
  }

  /** Defer the programme's due row to `until`. A `failure` holds: no later mark pulls it back to now (A7/A12). A `wait` is
   *  ordinary: the next plan write or run transition takes it at once. */
  private deferUntil(slug: string, until: number, why: SyncDeferral): void {
    this.deps.plan.markSyncDue(slug, until);      // a row is there to move even for a pass nobody queued (`ensureTicketBound`)
    this.deps.plan.deferSync(slug, until, why);
  }

  // ── Writes ──

  private bind(b: BindingRow, linearId: string, identifier: string | null, fingerprint: string, teamKey?: string | null): void {
    this.deps.plan.markBound(b.id, linearId, identifier, fingerprint, this.deps.now(), teamKey);
  }

  private identifierOf(out: CcrcOpOutcome, b: BindingRow): string | null {
    const i = out.ok ? out.value['identifier'] : undefined;
    return typeof i === 'string' ? i : b.identifier;
  }

  private bindingById(slug: string, id: number): BindingRow | null {
    return this.deps.plan.bindingsOf(slug).find((b) => b.id === id) ?? null;
  }

  private askOf(step: Exclude<SyncStep, { kind: 'skip' }>, slot: SlotInfo, b: BindingRow | null, pass: SendPass): CcrcOpAsk {
    const target = step.kind === 'create' ? null : step.op === 'issueUpdate' || step.op === 'issueLink' ? (b?.identifier ?? b?.linearId ?? null) : (b?.linearId ?? null);
    return {
      op: step.op, pass, lane: 'sync', slot: slot.ref, workspaceId: step.workspaceId, teamKey: step.teamKey, target, fields: step.fields, input: step.input,
      ...(step.teamKeys === undefined ? {} : { teamKeys: step.teamKeys }),
    };
  }

  private readAsk(op: CcrcOpAsk['op'], s: Subject, teamKey: string | null, input: CcrcOpAsk['input']): CcrcOpAsk {
    return { op, pass: s.pass, lane: 'sync', slot: s.slot.ref, workspaceId: s.workspaceId, teamKey, target: null, fields: [], input };
  }

  /** The binding is failed with the word, and the coordinator is told once per object and word. */
  private fail(s: Told, word: string): void {
    if (s.bindingId === null) return;
    this.deps.plan.markFailed(s.bindingId, word, s.inputs, this.deps.now());
    this.mailFailed(s, word);
  }

  /** D-8701's episodes (the bounded waits): each workspace's streak of fills reading `unknown` initiatives (`probe|<ws>`) or project
   *  statuses never read (`statuses|<ws>`). The store's (D-8183): a restart keeps the streak, so an episode's bound and its one mail
   *  stand across it. */
  private streakOf(key: string): DirectoryStreak | undefined { return this.deps.plan.streaksOf().get(key); }

  /** One look at a workspace's fill, written into its streak when it changed (L1's `nextDirectoryStreak` decides). */
  private observe(key: string, look: FillLook): void {
    const prev = this.streakOf(key);
    const next = nextDirectoryStreak(prev, look);
    if (next !== prev) this.deps.plan.setStreak(key, next ?? null);
  }

  /** D-8701's episode mail: once per programme, workspace and episode (its first fill names it), in a fixed sentence. */
  private mailEpisode(slug: string, workspaceId: string, kind: 'probe' | 'statuses', snap?: SyncSnapshot): void {
    const streak = this.streakOf(`${kind}|${workspaceId}`);
    if (streak === undefined) return;
    if (kind === 'probe') {
      // The facts the sentence is built from (L1's `probeEpisodeText`): is the programme's initiative bound in this workspace, and has the
      // programme ended (so the initiative's close waits too).
      const bound = snap?.program != null && snap.bindings.some((b) => b.localKind === 'programme' && b.localId === snap.program!.rowid && b.workspaceId === workspaceId && b.state === 'bound' && b.linearId !== null);
      this.mailOnce(slug, `Linear sync: workspace ${workspaceId} initiatives-unknown since ${streak.since} (${slug})`,
        probeEpisodeText({ slug, workspaceId, initiativeBound: bound, endWaiting: snap?.program?.end != null }));
    } else {
      this.mailOnce(slug, `Linear sync: workspace ${workspaceId} statuses-unread since ${streak.since} (${slug})`,
        `ccrc could not read the project statuses of the Linear workspace ${workspaceId}, so nothing of ${slug} in that workspace syncs until they read. The sync retries on its backoff.`);
    }
  }

  /** §5.4: a programme ended `done` with open issues: the coordinator is told once, in a fixed sentence (no Linear text). */
  private mailOpenIssuesLeft(slug: string, count: number): void {
    const owner = this.ownerOf(slug);
    if (owner === null) return;
    const subject = `Linear sync: programme ${slug} open-issues-left`;
    const { coord } = this.deps;
    if (coord.hasMailWithSubject('operator', null, owner, subject)) return;
    const body = `The programme ${slug} has ended as done with ${count} open ${count === 1 ? 'issue' : 'issues'} in Linear. The sync left ${count === 1 ? 'it' : 'them'} open: close or re-plan ${count === 1 ? 'it' : 'them'}.`;
    tx(coord.db, () => { insertSystemMailTx(coord, { program: slug }, { fromId: 'operator', toId: owner, runId: null, kind: 'status', subject, body }); });
  }

  /** Who is told about a key: a programme's coordinator, or an Upkeep epic's project's Linear owner (D-8183); none: nobody. */
  private ownerOf(slug: string): string | null {
    return slug.startsWith(UPKEEP_DUE_PREFIX) ? this.deps.upkeepOwnerOf?.(slug.slice(UPKEEP_DUE_PREFIX.length)) ?? null : this.deps.plan.planOwnerOf(slug);
  }

  private mailFailed(s: Told, word: string): void {
    const key = s.local.kind === 'programme' ? s.slug : this.planKeyOf(s.plan, s.local);
    this.mailOnce(s.slug, `Linear sync: ${OBJECT_WORD[s.local.kind]} ${key} ${word} (${s.slug})`,
      `The Linear sync could not write the ${OBJECT_WORD[s.local.kind]} ${key} of ${s.slug} (${word}). It stays as it is until the plan or the Linear setup changes, and the sync retries by itself.`);
  }

  /** Review 2457 F3: a restore comment the public-text check refused, told once per object, in a fixed sentence (never a value, never
   *  the check's class). The comment went out as ccrc's fallback naming the fields only, and the restore's field writes went. */
  private mailRestoreTextRefused(slug: string, b: BindingRow, plan: StoredPlan): void {
    const local: Local = { kind: b.localKind, id: b.localId };
    const key = b.localKind === 'programme' ? slug : this.planKeyOf(plan, local);
    this.mailOnce(slug, `Linear sync: ${OBJECT_WORD[b.localKind]} ${key} restore-comment text-public (${slug})`,
      `The Linear sync put back the ${OBJECT_WORD[b.localKind]} ${key} of ${slug} after it was changed in Linear, but the comment it would have left named text that is not safe to post in a public project. It left a comment that names only the fields it put back.`);
  }

  /** C16: a refused PR link, told once per ticket and word, in a fixed sentence (never the URL). */
  private mailLinkGivenUp(s: Subject, word: string): void {
    const key = this.planKeyOf(s.plan, s.local);
    this.mailOnce(s.slug, `Linear sync: ${OBJECT_WORD[s.local.kind]} ${key} pr-link ${word} (${s.slug})`,
      `The Linear sync could not link the pull request to the ${OBJECT_WORD[s.local.kind]} ${key} of ${s.slug} (${word}). It does not try that link again; the issue stays in sync, and a later pull request is linked as usual.`);
  }

  private mailOnce(slug: string, subject: string, body: string): void {
    const owner = this.ownerOf(slug);
    if (owner === null) return;
    const { coord } = this.deps;
    if (coord.hasMailWithSubject('operator', null, owner, subject)) return;
    tx(coord.db, () => { insertSystemMailTx(coord, { program: slug }, { fromId: 'operator', toId: owner, runId: null, kind: 'status', subject, body }); });
  }

  private planKeyOf(plan: StoredPlan, local: Local): string {
    for (const e of plan.epics) {
      if (local.kind === 'epic' && e.id === local.id) return e.key;
      if (local.kind === 'checkpoint') { const c = e.checkpoints.find((x) => x.id === local.id); if (c !== undefined) return c.key; }
      if (local.kind === 'ticket') { const t = e.tickets.find((x) => x.id === local.id); if (t !== undefined) return t.key; }
    }
    return String(local.id);
  }
}

/** The update without its state: Linear already reads the planned type (C12). */
function withoutState(step: Extract<SyncStep, { kind: 'update' }>): Extract<SyncStep, { kind: 'update' }> {
  const { stateId: _drop, ...input } = step.input as Record<string, unknown>;
  return { ...step, input: input as typeof step.input, fields: step.fields.filter((f) => f !== 'state') };
}

/** Each workspace's slot, the digest of the key in it and the teams its record learned for that key: what the sync reads
 *  of the Linear store. A slot whose key is gone or whose record describes another key is not here (C3). */
export function slotsOf(store: LinearStoreRead): Map<string, SlotInfo> {
  const out = new Map<string, SlotInfo>();
  if (store.kind !== 'listed') return out;
  for (const s of store.slots) {
    const d = currentDetails(s);
    if (d !== null && s.key.kind === 'key') out.set(s.id, { ref: { source: 'file', id: s.id }, digest: s.key.digest, teams: d.teams.map((t) => ({ id: t.id, key: t.key })) });
  }
  const legacy = store.legacy;
  if (legacy !== null && legacy.workspace !== null && !legacy.superseded && legacy.key.kind === 'key') {
    out.set(legacy.workspace.workspaceId, { ref: { source: 'legacy' }, digest: legacy.key.digest, teams: legacy.workspace.teams.map((t) => ({ id: t.id, key: t.key })) });
  }
  return out;
}

/** The sync as `index.ts` builds it: Linear reached through `runCcrcOp` with the one rate service, journal and policy, a
 *  directory miss asking the one refresher, a refused key marking its slot rejected as the proxy does. */
export function planSyncFor(o: {
  coord: CoordStore; plan: PlanStorePort; ccrcDir: string; rate: LinearRateService; journal: LinearJournal; policy: LinearWritePolicy;
  refresher: LinearRefresher; privateTrackerKeys: readonly string[]; readLinearStore: PlanSyncDeps['readLinearStore'];
  /** A coordinator's standing, for the Linear owner an Upkeep epic's failure mail goes to (D-8183). */
  presenceOf: (id: string) => CoordinatorPresence;
  /** The watcher's newest fleet listing: where a run's open PR is read before its close folds the lineage. */
  currentFleet?: () => readonly FleetSession[] | null;
}): PlanSync {
  return new PlanSync({
    coord: o.coord, plan: o.plan, ccrcDir: o.ccrcDir, readLinearStore: o.readLinearStore, directory: o.refresher.directory,
    call: (ask) => runCcrcOp({ ccrcDir: o.ccrcDir, rate: o.rate, journal: o.journal, policy: o.policy, timeoutMs: PLAN_SYNC_CALL_TIMEOUT_MS }, ask),
    directoryMiss: (slot, digest) => { o.refresher.nameMiss(slot, digest); },
    queueDirectory: (slot) => { o.refresher.queueDirectory(slot); },
    markSlotRejected: async (slot, digest, now) => {
      await (slot.source === 'legacy' ? markLinearRejected(o.ccrcDir, digest, now) : markLinearSlotRejected(o.ccrcDir, slot.id, digest, now));
    },
    now: Date.now, privateTrackerKeys: o.privateTrackerKeys, prOfRun: prOfRunFrom(o.coord, o.currentFleet ?? (() => null)),
    upkeepOwnerOf: (project) => linearOwnerOfProject(project, o.plan.hierarchyProjectsOf(), {
      latestProgrammeCoordinator: (p) => o.plan.latestProgrammeCoordinator(p), presence: o.presenceOf,
    }).id,
  });
}

/** §5.6: a run's pull request as the server knows it: the newest of its folded `.prhistory` lineage (written when the run
 *  closes), else its session's PR in the newest fleet listing when that session is on the run's own branch. Synchronous; null (no PR yet,
 *  and an unreadable branch is the same: the link waits) when neither names one. */
export function prOfRunFrom(coord: CoordStore, fleet: () => readonly FleetSession[] | null): NonNullable<PlanSyncDeps['prOfRun']> {
  return (runId) => {
    const read = coord.run(runId);
    if (!read.ok || read.run === null) return null;
    const last = read.run.prLineage.at(-1);
    if (last !== undefined) return { number: last.pr, branch: last.branch };
    const sid = read.run.sessionId;
    const s = sid === null ? undefined : fleet()?.find((f) => f.id === sid);
    // The session's PR is this run's only when it sits on the run's own workspace branch: a resumed session may still show an
    // earlier wave's PR. A branch that cannot be read on either side is "no PR yet": the link waits and the next pass asks again.
    const own = read.run.branch;
    return s?.pr?.number != null && own !== null && s.branch !== null && s.branch === own ? { number: s.pr.number, branch: s.branch } : null;
  };
}
