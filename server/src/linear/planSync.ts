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
 * planned value can never be read as drift of a newer sync write. Do NOT call `passFor` for a key from inside its own
 * `withFlight` function: the flight waits for itself.
 *
 * WHAT IS WRITTEN BEFORE A CALL. The binding row is `pending` before a create is sent (`ensurePending`) and `bound` after;
 * a row found `pending` at the start of a step is a create a previous pass may have sent (a crash, a timeout), so the
 * step recovers first (C2): by the caller's own id on the answer, by name and creator for an initiative or a project, by
 * name inside its project for a milestone. It never reads `LinearJournal.viaFleet`: in the very crash this exists for the
 * journal row is still `pending` with no result.
 *
 * LINEAR'S TEXT IS NEVER IN A MAIL. A coordinator is mailed a fixed sentence naming the object kind, its plan key and the
 * word, once per object and word (`hasMailWithSubject`, durable).
 */
import type { CoordStore } from '../coord/store.js';
import { planViewOf } from '../coord/planRoutes.js';
import { programmeEnd } from '../coord/planPolicy.js';
import type { BindingRow, PlanStorePort, StoredPlan } from '../coord/planStore.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import { tx } from '../coord/tx.js';
import type { BindingKind } from '../../../shared/plan.js';
import { markLinearRejected } from './connection.js';
import { runCcrcOp, type CcrcOpAsk, type CcrcOpOutcome } from './ccrcCall.js';
import type { LinearDirectoryRead } from './directory.js';
import type { LinearJournal } from './journal.js';
import type { CcrcPass, LinearWritePolicy } from './policy.js';
import type { LinearRateService } from './rate.js';
import type { LinearRefresher } from './refresher.js';
import { currentDetails, routableSlots, routeLinear } from './route.js';
import { markLinearSlotRejected, type LinearSlotRef, type LinearStoreRead } from './store.js';
import { planSyncSteps, type Local, type SyncSnapshot, type SyncStep } from './planSyncPolicy.js';

/** A due row is taken once its `dueAt` is this old: the plan routes mark a programme due at the write time, and a burst of
 *  plan verbs becomes one pass. */
export const PLAN_SYNC_DEBOUNCE_MS = 3_000;
/** The wait after a deferral, by how many deferrals the programme has had in a row (the last step holds). */
export const PLAN_SYNC_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000] as const;
/** A tick's total budget, and one call's own timeout (`runCcrcOp`'s `timeoutMs`): together they stay under the lane row's
 *  `staleAfterMs`, so a tick the runner restarts as stuck has nothing left of the first to overlap. */
export const PLAN_SYNC_TICK_DEADLINE_MS = 60_000;
export const PLAN_SYNC_CALL_TIMEOUT_MS = 15_000;
/** How long a programme waits for its workspace's directory to be filled by the refresher (a miss queues it). */
const DIRECTORY_WAIT_MS = 10_000;
/** A runaway guard: one pass never takes more steps than this. */
const MAX_STEPS_PER_PASS = 500;
/** The fingerprint of an adopted object (recovery, conflict): it was never sent the current inputs, so it matches no planned
 *  one and the next re-read emits one absolute update (or link) that writes the real fingerprint. */
const ADOPTED = 'adopted';
const LAST_BACKOFF_MS = PLAN_SYNC_BACKOFF_MS[PLAN_SYNC_BACKOFF_MS.length - 1]!;

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
  markSlotRejected: (slot: LinearSlotRef, digest: string, now: number) => Promise<void>;
  now: () => number;
  privateTrackerKeys: readonly string[];
  /** A test's shorter tick budget. */
  tickDeadlineMs?: number;
}

interface SlotInfo { ref: LinearSlotRef; digest: string; teams: { id: string; key: string }[] }
/** The drift pass's restore pass, taken from the list (never spelled beside `'plan-sync'`: the list is policy.ts's alone). */
type RestorePass = Extract<CcrcPass, `${string}restore`>;
type Flow = 'next' | 'defer';
type Failure = Exclude<CcrcOpOutcome, { ok: true }>;
/** What a failed outcome needs to know about the object it was for. */
interface Subject { slug: string; local: Local; workspaceId: string; bindingId: number | null; inputs: string; slot: SlotInfo; plan: StoredPlan }

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
  /** Workspaces whose key Linear refused (401): no call until the time. */
  private readonly blockedUntil = new Map<string, number>();

  constructor(private readonly deps: PlanSyncDeps) {}

  // ── The tick ──

  /** One beat: requeue the failed bindings that have earned another try, then run a pass for each programme due past its
   *  debounce, one at a time, until the tick's deadline. A pass in flight (even the one a restarted tick left) is joined. */
  async tick(now: number): Promise<void> {
    this.notConfigured.clear();
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

  /** C10: a `failed` binding returns to `pending` when its workspace's directory was filled after the failure (a status
   *  type added, write access regained by a verified key, the probe turned on), and otherwise once the last backoff step
   *  has passed since `failedAt`; its programme is then due. (The inputs trigger is the pass's own: it has the snapshot.) */
  private async requeueSweep(now: number): Promise<void> {
    const slots = slotsOf(await this.deps.readLinearStore());
    for (const p of this.deps.coord.programs()) {
      let requeued = false;
      for (const b of this.deps.plan.bindingsOf(p.slug)) {
        if (b.state !== 'failed' || b.failedAt === null) continue;
        const slot = slots.get(b.workspaceId);
        const filled = slot === undefined ? null : this.deps.directory.filledAt(slot.ref, slot.digest);
        if ((filled !== null && b.failedAt < filled) || b.failedAt < now - LAST_BACKOFF_MS) {
          this.deps.plan.requeueFailed({ bindingId: b.id });
          requeued = true;
        }
      }
      if (requeued) this.deps.plan.markSyncDue(p.slug, now - PLAN_SYNC_DEBOUNCE_MS);
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

  /** The drift pass's restore (Task 4.2): its steps sent as the pass `drift-restore`, in the key's flight, each write
   *  updating its binding's fingerprint. Stops at the first outcome that is not ok and answers what it sent. */
  restore(key: string, steps: readonly SyncStep[], pass: RestorePass): Promise<CcrcOpOutcome[]> {
    return this.withFlight(key, async () => {
      const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
      const slots = slotsOf(store);
      const out: CcrcOpOutcome[] = [];
      for (const step of steps) {
        if (step.kind === 'skip') continue;
        const slot = slots.get(step.workspaceId);
        if (slot === undefined) { out.push({ ok: false, word: 'not-configured', maybeSent: false }); break; }
        const b = step.bindingId === null ? null : this.bindingById(key, step.bindingId);
        const result = await this.deps.call(this.askOf(step, slot, b, pass));
        out.push(result);
        if (!result.ok) break;
        if (b !== null && b.linearId !== null) this.bind(b, b.linearId, this.identifierOf(result, b), step.fingerprint);
      }
      return out;
    });
  }

  // ── One pass ──

  private async runPass(slug: string, deadlineAt: number): Promise<'done' | 'deferred'> {
    const { plan } = this.deps;
    if (slug.startsWith('upkeep:')) {
      // C9: an Upkeep epic can exist only once wave 4's `plan triage` does; until then there is nothing to send.
      plan.clearSyncDue(slug);
      return 'done';
    }
    for (let taken = 0; ; taken += 1) {
      if (this.deps.now() >= deadlineAt || taken >= MAX_STEPS_PER_PASS) return 'deferred';
      let store: LinearStoreRead;
      try { store = await this.deps.readLinearStore(); } catch { store = { kind: 'unreadable', code: 'unreadable' }; }
      // Everything from here to the decision is synchronous: a plan write cannot land between the snapshot and the
      // `clearSyncDue` below, so a put is either in this snapshot or leaves its due row to the next pass.
      const built = this.snapshot(slug, store);
      if (built === null) { plan.clearSyncDue(slug); return 'done'; }
      const { steps, failedInputs, notices } = planSyncSteps(built.snap);
      for (const n of notices) this.mailOpenIssuesLeft(slug, n.count);
      let requeued = false;
      for (const f of failedInputs) {
        const b = built.snap.bindings.find((x) => x.id === f.bindingId);
        if (b !== undefined && b.failedInputs !== f.inputs) { plan.requeueFailed({ bindingId: b.id }); requeued = true; }
      }
      if (requeued) continue;

      const actionable = steps.filter((s) => this.actionable(s, built.snap.bindings));
      const waiting = new Set(built.waiting);
      const blocked = (ws: string | null): boolean => ws !== null && (waiting.has(ws) || this.notConfigured.has(ws) || (this.blockedUntil.get(ws) ?? 0) > this.deps.now());
      const runnable = actionable.filter((s) => !blocked(s.workspaceId));
      if (runnable.length === 0) {
        if (actionable.length === 0) { plan.clearSyncDue(slug); this.attempts.delete(slug); return 'done'; }
        const until = actionable.flatMap((s) => (s.workspaceId === null ? [] : [this.blockedUntil.get(s.workspaceId) ?? 0]));
        if (actionable.some((s) => s.workspaceId !== null && waiting.has(s.workspaceId))) this.deferUntil(slug, this.deps.now() + DIRECTORY_WAIT_MS);
        else if (Math.max(0, ...until) > this.deps.now()) this.deferUntil(slug, Math.max(...until));
        return 'deferred';                                   // not configured: the due row stays for the next tick
      }
      const flow = await this.execute(slug, runnable[0]!, built, deadlineAt);
      if (flow === 'defer') return 'deferred';
    }
  }

  /** Whether a step is work: an `initiatives-off` or `no-team-key` skip is only a statement, and a skip whose binding is
   *  already failed has been told. */
  private actionable(s: SyncStep, bindings: readonly BindingRow[]): boolean {
    if (s.kind !== 'skip') return true;
    if (s.why === 'initiatives-off' || s.why === 'no-team-key') return false;
    return s.bindingId === null || bindings.find((b) => b.id === s.bindingId)?.state !== 'failed';
  }

  /** The programme as `planSyncSteps` reads it, from the stores, synchronously (the store listing is read first). */
  private snapshot(slug: string, store: LinearStoreRead): { snap: SyncSnapshot; slots: Map<string, SlotInfo>; waiting: string[] } | null {
    const { plan, coord } = this.deps;
    const rowid = plan.programmeRowId(slug);
    const prog = coord.programs().find((p) => p.slug === slug);
    if (rowid === null || prog === undefined) return null;
    const stored = plan.planOf(slug);
    const bindings = plan.bindingsOf(slug);
    const planEnd = plan.planEndOf(slug);
    const tickets = stored.epics.flatMap((e) => e.tickets);
    const outcome = programmeEnd({
      planEnd: planEnd?.outcome ?? null, programState: prog.state, epics: stored.epics,
      openTickets: tickets.filter((t) => t.state === 'open' || t.state === 'started').length,
    });
    const slots = slotsOf(store);
    const listed = store.kind === 'listed' ? routableSlots(store) : [];
    const projectNames = [...new Set(stored.epics.flatMap((e) => [e.project, ...e.tickets.map((t) => t.project)]))];
    const projects: SyncSnapshot['projects'] = projectNames.map((project) => {
      const l = coord.linkingOf(project);
      const route = l.teamKey === null ? null : routeLinear(listed, { kind: 'team', team: l.teamKey, workspace: null });
      return {
        project, teamKey: l.teamKey, workspaceId: route !== null && route.kind === 'slot' ? route.slot.workspaceId : null,
        mode: l.mode, initiatives: plan.hierarchySettingsOf(project).initiatives,
      };
    });
    const waiting: string[] = [];
    const workspaces: SyncSnapshot['workspaces'] = [];
    for (const workspaceId of new Set(projects.flatMap((p) => (p.workspaceId === null ? [] : [p.workspaceId])))) {
      const slot = slots.get(workspaceId);
      if (slot === undefined) continue;
      const directory = this.deps.directory.get(slot.ref, slot.digest);
      if (directory === null) { waiting.push(workspaceId); this.deps.directoryMiss(slot.ref, slot.digest); }
      workspaces.push({ workspaceId, initiatives: directory?.initiatives ?? 'unknown', directory, teams: slot.teams });
    }
    const goals = coord.goalsFor(slug);
    const snap: SyncSnapshot = {
      program: {
        slug, rowid, title: prog.title, inShort: goals.inShort,
        end: outcome === null ? null : { outcome, why: planEnd?.why ?? null, at: planEnd?.at ?? this.deps.now() },
        doneWhen: planViewOf(stored, goals.doneWhen ?? [], bindings).doneWhen, paused: prog.state === 'paused',
      },
      plan: stored, bindings, workspaces, projects, privateTrackerKeys: [...this.deps.privateTrackerKeys],
    };
    return { snap, slots, waiting };
  }

  // ── One step ──

  private async execute(slug: string, step: SyncStep, built: NonNullable<ReturnType<PlanSync['snapshot']>>, deadlineAt: number): Promise<Flow> {
    const { plan } = this.deps;
    if (step.kind === 'skip') {
      // `status-missing`, `text-public`, `workspace-mismatch`: the object's binding is failed with the reason.
      const ws = step.workspaceId;
      if (ws === null) return 'next';
      const b = step.bindingId !== null ? built.snap.bindings.find((x) => x.id === step.bindingId) ?? null
        : plan.ensurePending(step.local.kind, step.local.id, ws, null);
      if (b === null) return 'next';
      const slot = built.slots.get(ws);
      if (slot === undefined) { this.notConfigured.add(ws); return 'next'; }
      this.fail({ slug, local: step.local, workspaceId: ws, bindingId: b.id, inputs: step.inputs ?? '', slot, plan: built.snap.plan }, step.why);
      return 'next';
    }
    const slot = built.slots.get(step.workspaceId);
    if (slot === undefined) { this.notConfigured.add(step.workspaceId); return 'next'; }
    let b = step.bindingId === null ? null : built.snap.bindings.find((x) => x.id === step.bindingId) ?? null;
    const subject = (bindingId: number | null): Subject => ({ slug, local: step.local, workspaceId: step.workspaceId, bindingId, inputs: step.inputs, slot, plan: built.snap.plan });

    if (step.kind === 'create') {
      const existed = b !== null;
      b ??= plan.ensurePending(step.local.kind, step.local.id, step.workspaceId, step.teamKey);
      if (existed && step.recover !== 'request-id') {
        const r = await this.recover(step, b, subject(b.id), built);
        if (r === 'bound' || r === 'next') return 'next';
        if (r === 'defer') return 'defer';
        if (this.deps.now() >= deadlineAt) return 'defer';
      }
      const out = await this.deps.call(this.askOf(step, slot, b, 'plan-sync'));
      if (out.ok) {
        const id = out.created ?? (typeof out.value['id'] === 'string' ? out.value['id'] : null);
        if (id === null) { this.deferUntil(slug, this.deps.now() + this.nextBackoff(slug)); return 'defer'; }   // ok without an id: it may have been sent
        this.bind(b, id, this.identifierOf(out, b), step.fingerprint);
        this.attempts.delete(slug);
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
    // by C12's read; the destination team of a move is not policy-checked (no field carries a second team: a follow-up).
    let currentTeam: string | null = b.teamKey ?? step.teamKey;
    if (step.kind === 'update' && step.stateType !== undefined) {
      const held = await this.readIssue(step, b, subject(b.id), deadlineAt);
      if (typeof held === 'object') currentTeam = held.team ?? currentTeam;
      const verdict = typeof held === 'object' ? held.verdict : held;
      if (verdict === 'defer') return 'defer';
      if (verdict === 'next') return 'next';
      if (verdict === 'same') { this.bind(b, b.linearId, b.identifier, step.fingerprint, step.teamKey); this.attempts.delete(slug); return 'next'; }
      send = verdict === 'state-held' ? withoutState(step) : step;
      if (step.comment !== undefined) {
        const c = await this.deps.call({
          op: 'issueComment', pass: 'plan-sync', lane: 'sync', slot: slot.ref, workspaceId: step.workspaceId, teamKey: currentTeam,
          target: b.identifier ?? b.linearId, fields: ['comment'], input: { requestId: step.comment.requestId, issueId: b.linearId, body: step.comment.body },
        });
        // C13: a `conflict` answer is a comment made already (same id): done, like an ok.
        if (!c.ok && !(c.word === 'linear-invalid' && c.detail === 'conflict')) return this.onFailure(c, subject(b.id));
      }
    }
    const ask = this.askOf(send, slot, b, 'plan-sync');
    const out = await this.deps.call(step.kind === 'update' && step.op === 'issueUpdate' ? { ...ask, teamKey: currentTeam } : ask);
    if (out.ok) {
      this.bind(b, b.linearId, this.identifierOf(out, b), step.fingerprint, step.kind === 'update' && step.op === 'issueUpdate' ? step.teamKey : undefined);
      this.attempts.delete(slug);
      return 'next';
    }
    // C4: a link answered "conflict" is a link that exists already: the same write as an ok.
    if (step.kind === 'link' && out.word === 'linear-invalid' && out.detail === 'conflict') {
      this.bind(b, b.linearId, b.identifier, step.fingerprint);
      return 'next';
    }
    return this.onFailure(out, subject(b.id));
  }

  /** C12: an issue's planned state is a TYPE, and Linear owns the name. Read the issue first: when it already reads the type
   *  and everything else planned (a GitHub integration moved it), the fingerprint is all that is written (`same`); when only
   *  the state agrees, the update goes without it (`state-held`); a read that cannot tell (`not-found`) sends the update as
   *  planned and lets its own answer rule. */
  private async readIssue(step: Extract<SyncStep, { kind: 'update' }>, b: BindingRow, s: Subject, deadlineAt: number): Promise<'send' | 'next' | 'defer' | { verdict: 'send' | 'state-held' | 'same'; team: string | null }> {
    if (step.op !== 'issueUpdate') return 'send';
    if (this.deps.now() >= deadlineAt) return 'defer';
    const out = await this.deps.call(this.readAsk('issueOwned', s, step.teamKey, { id: b.linearId! }));
    if (!out.ok) return out.word === 'not-found' ? 'send' : (this.onFailure(out, s) === 'defer' ? 'defer' : 'next');
    const issue = out.value['issue'] as { stateType?: string; title?: string; description?: string | null; teamKey?: string; projectId?: string | null; milestoneId?: string | null };
    const team = typeof issue.teamKey === 'string' ? issue.teamKey : null;
    if (issue.stateType !== step.stateType) return { verdict: 'send', team };
    const sameRest = issue.title === step.input['title'] && (issue.description ?? '').trim() === String(step.input['description'] ?? '').trim()
      && issue.projectId === step.input['projectId'] && (issue.milestoneId ?? null) === (step.input['projectMilestoneId'] ?? null)
      && typeof issue.teamKey === 'string' && step.teamKey !== null && issue.teamKey.toUpperCase() === step.teamKey.toUpperCase();
    return { verdict: sameRest ? 'same' : 'state-held', team };
  }

  /** C2: a create whose binding was `pending` at the start of the step may have been sent. Read what Linear holds. */
  private async recover(step: Extract<SyncStep, { kind: 'create' }>, b: BindingRow, s: Subject, built: NonNullable<ReturnType<PlanSync['snapshot']>>): Promise<'bound' | 'send' | 'next' | 'defer'> {
    const held = new Set(built.snap.bindings.flatMap((x) => (x.linearId === null ? [] : [x.linearId])));
    if (step.recover === 'name-and-creator') {
      const viewer = built.snap.workspaces.find((w) => w.workspaceId === step.workspaceId)?.directory?.viewerId ?? null;
      if (viewer === null) { this.deferUntil(s.slug, this.deps.now() + DIRECTORY_WAIT_MS); return 'defer'; }
      const name = String(step.input['name']);
      const out = await this.deps.call(this.readAsk(step.op === 'initiativeCreate' ? 'initiativesByName' : 'projectsByName', s, step.teamKey, { name }));
      if (!out.ok) return this.onFailure(out, s) === 'defer' ? 'defer' : 'next';
      const nodes = (out.value['nodes'] as { id: string; name: string; creatorId: string | null; teamKeys?: string[] }[]);
      const team = step.teamKey?.toUpperCase() ?? null;
      const mine = nodes.filter((n) => n.name === name && !held.has(n.id)
        && (n.id === step.requestId || n.creatorId === viewer)
        && (step.op !== 'projectCreate' || team === null || (n.teamKeys ?? []).includes(team)));
      const certain = mine.filter((n) => n.id === step.requestId);
      const found = certain.length > 0 ? certain : mine;
      if (found.length === 0) return 'send';
      if (found.length > 1) { this.fail(s, 'name-ambiguous'); return 'next'; }
      this.bind(b, found[0]!.id, null, ADOPTED);
      return 'bound';
    }
    // name-in-project: a milestone has no creator (R3); its project holds only what ccrc made
    const out = await this.deps.call(this.readAsk('projectById', s, step.teamKey, { id: String(step.input['projectId']) }));
    if (!out.ok) return this.onFailure(out, s) === 'defer' ? 'defer' : 'next';
    const milestones = ((out.value['project'] as { milestones?: { id: string; name: string }[] }).milestones ?? []);
    const name = String(step.input['name']);
    const mine = milestones.filter((m) => (m.id === step.requestId || m.name === name) && !held.has(m.id));
    const found = mine.filter((m) => m.id === step.requestId).concat(mine.filter((m) => m.id !== step.requestId));
    if (found.length === 0) return 'send';
    this.bind(b, found[0]!.id, null, ADOPTED);
    return 'bound';
  }

  /** R2 and C11: a create answered "conflict on insert" (or a milestone "name not unique"): an object exists at ccrc's id. Ids
   *  are deterministic, so id alone adopts nothing: an initiative or project is adopted only when the by-name read (name as
   *  sent, team-narrowed) shows that id made by this key's viewer; an issue only when it is in the planned team and no other
   *  binding holds it; a milestone only inside ccrc's own bound project (R2). Anything else fails the binding
   *  `linear-invalid`, mailed once, and never sends a second create. Adopted bindings carry the `adopted` fingerprint. */
  private async bindExisting(step: Extract<SyncStep, { kind: 'create' }>, b: BindingRow, s: Subject, built: NonNullable<ReturnType<PlanSync['snapshot']>>): Promise<Flow> {
    const id = step.requestId;
    const held = built.snap.bindings.some((x) => x.id !== b.id && x.linearId === id);
    if (step.op === 'projectMilestoneCreate') {
      const out = await this.deps.call(this.readAsk('projectById', s, step.teamKey, { id: String(step.input['projectId']) }));
      if (!out.ok) return this.onFailure(out, s);
      const ms = ((out.value['project'] as { milestones?: { id: string }[] }).milestones ?? []).find((m) => m.id === id);
      if (ms === undefined || held) { this.fail(s, 'linear-invalid'); return 'next'; }
      this.bind(b, ms.id, null, ADOPTED);
      return 'next';
    }
    if (step.op === 'issueCreate') {
      const out = await this.deps.call(this.readAsk('issueOwned', s, step.teamKey, { id }));
      if (!out.ok) return this.onFailure(out, s);
      const issue = out.value['issue'] as { id: string; identifier?: string; teamKey?: string };
      if (held || issue.id !== id || step.teamKey === null || typeof issue.teamKey !== 'string' || issue.teamKey.toUpperCase() !== step.teamKey.toUpperCase()) { this.fail(s, 'linear-invalid'); return 'next'; }
      this.bind(b, issue.id, typeof issue.identifier === 'string' ? issue.identifier : null, ADOPTED);
      return 'next';
    }
    const viewer = built.snap.workspaces.find((w) => w.workspaceId === step.workspaceId)?.directory?.viewerId ?? null;
    if (viewer === null) { this.deferUntil(s.slug, this.deps.now() + DIRECTORY_WAIT_MS); return 'defer'; }
    // Two reads: the object at ccrc's id (its own name, which a rename since the lost create may have left unlike the plan's),
    // then that name's by-name listing, which carries the creator the by-id read does not select.
    const isInit = step.op === 'initiativeCreate';
    const byId = await this.deps.call(this.readAsk(isInit ? 'initiativeById' : 'projectById', s, step.teamKey, { id }));
    if (!byId.ok) return this.onFailure(byId, s);
    const found = byId.value[isInit ? 'initiative' : 'project'] as { id: string; name: string };
    const out = await this.deps.call(this.readAsk(isInit ? 'initiativesByName' : 'projectsByName', s, step.teamKey, { name: found.name }));
    if (!out.ok) return this.onFailure(out, s);
    const team = step.teamKey?.toUpperCase() ?? null;
    const nodes = out.value['nodes'] as { id: string; name: string; creatorId: string | null; teamKeys?: string[] }[];
    const mine = nodes.find((n) => n.id === id && n.name === found.name && n.creatorId === viewer
      && (isInit || team === null || (n.teamKeys ?? []).includes(team)));
    if (mine === undefined || held) { this.fail(s, 'linear-invalid'); return 'next'; }
    this.bind(b, mine.id, null, ADOPTED);
    return 'next';
  }

  // ── Outcomes: the table, one row each ──

  private onFailure(out: Failure, s: Subject): Flow {
    switch (out.word) {
      case 'rate-limited': this.deferUntil(s.slug, this.deps.now() + Math.max('retryAfterS' in out ? out.retryAfterS * 1000 : 0, this.nextBackoff(s.slug))); return 'defer';
      case 'unreachable': case 'timeout': case 'policy-unavailable': case 'journal-unavailable':
        this.deferUntil(s.slug, this.deps.now() + this.nextBackoff(s.slug)); return 'defer';
      case 'malformed': {
        // Sent and answered outside the grammar: as `maybeSent`, and failed after the last backoff step.
        const n = (this.malformed.get(s.bindingId ?? -1) ?? 0) + 1;
        if (s.bindingId !== null) this.malformed.set(s.bindingId, n);
        if (s.bindingId !== null && n > PLAN_SYNC_BACKOFF_MS.length) { this.fail(s, 'malformed'); return 'next'; }
        this.deferUntil(s.slug, this.deps.now() + this.nextBackoff(s.slug)); return 'defer';
      }
      case 'not-configured': this.notConfigured.add(s.workspaceId); return 'next';
      case 'linear-unauthorised': {
        const until = this.deps.now() + this.nextBackoff(s.slug);
        this.blockedUntil.set(s.workspaceId, until);
        void this.deps.markSlotRejected(s.slot.ref, s.slot.digest, this.deps.now()).catch(() => { /* the key card shows the rest */ });
        this.deferUntil(s.slug, until);
        return 'defer';
      }
      default: this.fail(s, out.word); return 'next';
    }
  }

  private nextBackoff(slug: string): number {
    const n = this.attempts.get(slug) ?? 0;
    this.attempts.set(slug, n + 1);
    return PLAN_SYNC_BACKOFF_MS[Math.min(n, PLAN_SYNC_BACKOFF_MS.length - 1)]!;
  }

  private deferUntil(slug: string, until: number): void {
    this.deps.plan.markSyncDue(slug, until);      // a row is there to move even for a pass nobody queued (`ensureTicketBound`)
    this.deps.plan.deferSync(slug, until);
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

  private askOf(step: Exclude<SyncStep, { kind: 'skip' }>, slot: SlotInfo, b: BindingRow | null, pass: 'plan-sync' | RestorePass): CcrcOpAsk {
    const target = step.kind === 'create' ? null : step.op === 'issueUpdate' ? (b?.identifier ?? b?.linearId ?? null) : (b?.linearId ?? null);
    return {
      op: step.op, pass, lane: 'sync', slot: slot.ref, workspaceId: step.workspaceId, teamKey: step.teamKey, target, fields: step.fields, input: step.input,
    };
  }

  private readAsk(op: CcrcOpAsk['op'], s: Subject, teamKey: string | null, input: CcrcOpAsk['input']): CcrcOpAsk {
    return { op, pass: 'plan-sync', lane: 'sync', slot: s.slot.ref, workspaceId: s.workspaceId, teamKey, target: null, fields: [], input };
  }

  /** The binding is failed with the word, and the coordinator is told once per object and word. */
  private fail(s: Subject, word: string): void {
    if (s.bindingId === null) return;
    this.deps.plan.markFailed(s.bindingId, word, s.inputs, this.deps.now());
    this.mailFailed(s, word);
  }

  /** §5.4: a programme ended `done` with open issues: the coordinator is told once, in a fixed sentence (no Linear text). */
  private mailOpenIssuesLeft(slug: string, count: number): void {
    const owner = this.deps.plan.planOwnerOf(slug);
    if (owner === null) return;
    const subject = `Linear sync: programme ${slug} open-issues-left`;
    const { coord } = this.deps;
    if (coord.hasMailWithSubject('operator', null, owner, subject)) return;
    const body = `The programme ${slug} has ended as done with ${count} open ${count === 1 ? 'issue' : 'issues'} in Linear. The sync left ${count === 1 ? 'it' : 'them'} open: close or re-plan ${count === 1 ? 'it' : 'them'}.`;
    tx(coord.db, () => { insertSystemMailTx(coord, { program: slug }, { fromId: 'operator', toId: owner, runId: null, kind: 'status', subject, body }); });
  }

  private mailFailed(s: Subject, word: string): void {
    const owner = this.deps.plan.planOwnerOf(s.slug);
    if (owner === null) return;
    const key = s.local.kind === 'programme' ? s.slug : this.planKeyOf(s.plan, s.local);
    const subject = `Linear sync: ${OBJECT_WORD[s.local.kind]} ${key} ${word} (${s.slug})`;
    const { coord } = this.deps;
    if (coord.hasMailWithSubject('operator', null, owner, subject)) return;
    const body = `The Linear sync could not write the ${OBJECT_WORD[s.local.kind]} ${key} of ${s.slug} (${word}). It stays as it is until the plan or the Linear setup changes, and the sync retries by itself.`;
    tx(coord.db, () => { insertSystemMailTx(coord, { program: s.slug }, { fromId: 'operator', toId: owner, runId: null, kind: 'status', subject, body }); });
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
function slotsOf(store: LinearStoreRead): Map<string, SlotInfo> {
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
}): PlanSync {
  return new PlanSync({
    coord: o.coord, plan: o.plan, ccrcDir: o.ccrcDir, readLinearStore: o.readLinearStore, directory: o.refresher.directory,
    call: (ask) => runCcrcOp({ ccrcDir: o.ccrcDir, rate: o.rate, journal: o.journal, policy: o.policy, timeoutMs: PLAN_SYNC_CALL_TIMEOUT_MS }, ask),
    directoryMiss: (slot, digest) => { o.refresher.nameMiss(slot, digest); },
    markSlotRejected: async (slot, digest, now) => {
      await (slot.source === 'legacy' ? markLinearRejected(o.ccrcDir, digest, now) : markLinearSlotRejected(o.ccrcDir, slot.id, digest, now));
    },
    now: Date.now, privateTrackerKeys: o.privateTrackerKeys,
  });
}
