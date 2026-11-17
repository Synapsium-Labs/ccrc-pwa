/**
 * THE INBOUND LANE (D-8183; Linear hierarchy design 2026-11-10 §7.5): what the drift lane does with an issue filed in a managed team
 * outside ccrc. L4 DELIVERY around `driftPolicy.ts#isInbound` (what is inbound), `planPolicy.ts#linearOwnerOfTeam` (who owns the
 * team) and `inboundPolicy.ts` (every word): it finds, mails, raises and acts; it decides none of those.
 *
 * FOUR THINGS, ONE OWNER OF EACH. `detect` (a workspace pass's, over the issue nodes it read) stores each inbound issue once, with
 * the reporter's title and body (D-8705), and reads nothing else from Linear. `route` runs every beat, pass or no pass: a `waiting`
 * issue whose team's Linear owner is live or unmeasured is mailed to it, once, with the reporter's text only inside the untrusted
 * block; with no owner, or a gone one (dead or absent), it stays `waiting` and the project raises ONE *Name a Linear owner* item,
 * which settles itself in the beat that finds the owner live. A `raised` issue whose operator item is answered or closed comes back
 * to the owner as a mail, and the item settles. `act` makes the Linear writes of a `closed` issue (one comment with the reason,
 * then the cancel), in the issue's own flight, and records `actedAt` only after both landed.
 *
 * THE ROUTES CALL NO LINEAR. `plan triage` and `plan take` only write the store; the one place that writes an inbound issue in
 * Linear is `act` below, under the pass `inbound`.
 */
import type { CoordStore } from '../coord/store.js';
import type { InboundRow, PlanStorePort } from '../coord/planStore.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import { tx } from '../coord/tx.js';
import { linearOwnerOfProject, linearOwnerOfTeam } from '../coord/planPolicy.js';
import { LINEAR_SYNC_PROGRAMME } from '../../../shared/plan.js';
import { isInbound } from './driftPolicy.js';
import { answeredMail, closeCommentBody, closeRefusedMail, givenUpReason, inboundActVerdict, inboundHeld, inboundMail, keyWaitMail, noCancelMail, ownerItemInput, type InboundHold } from './inboundPolicy.js';
import { LINEAR_VIA_FLEET_MAX_ITEMS } from './journal.js';
import { statusOfType } from './ops.js';
import { PLAN_SYNC_BACKOFF_MS, slotsOf, type SlotInfo } from './planSync.js';
import { uuidOf } from './planSyncPolicy.js';
import type { DriftPassDeps } from './driftPass.js';

type Deps = Pick<DriftPassDeps, 'coord' | 'plan' | 'planSync' | 'readLinearStore' | 'call' | 'now' | 'presenceOf' | 'viaFleet' | 'directory'>;
type Node = Record<string, unknown>;

/** A changed issue node as the inbound decision reads it; null for one the shaped answer did not give these fields (never stored). */
function factsOf(n: Node): { linearId: string; identifier: string; teamKey: string; stateType: string; title: string; body: string | null } | null {
  const { id, identifier, teamKey, stateType, title, description } = n;
  if (typeof id !== 'string' || typeof identifier !== 'string' || typeof teamKey !== 'string' || typeof stateType !== 'string' || typeof title !== 'string') return null;
  return { linearId: id, identifier, teamKey, stateType, title, body: typeof description === 'string' ? description : null };
}

export class InboundLane {
  /** The workspaces whose close writes a retryable refusal holds, in this process: their closes wait (`refused`), on the plan
   *  sync's failure-hold SCHEDULE (D-8702's `deferralOf`). LEGITIMATELY DIFFERENT from the plan sync's own holds (review 2394
   *  A-3): an inbound close must never hold a programme's plan sync (the coordinator's round 2 brief, point 3), so the two
   *  lanes share the schedule, never the state. The one refusal both lanes share is the key's (a 401): it goes through the plan
   *  sync's one owner (`keyRefused`), and this lane honours `keyBlockedUntil`. A restart forgets these holds, which costs one
   *  call, and the next refusal holds again. Only a close done whole (its cancel ok) clears one (review 2394 N1). */
  private readonly holds = new Map<string, InboundHold>();

  constructor(private readonly deps: Deps) {}

  // ── Detect (a workspace pass) ──

  /** Every changed issue node with no binding in the workspace, in a managed team, that is open and no session's own create, is
   *  stored `waiting` with the reporter's text (a known one only refreshes its text: `upsertInbound`). `bound` is read once;
   *  `viaFleet` is asked in chunks of at most `LINEAR_VIA_FLEET_MAX_ITEMS` identifiers (a larger ask answers empty). */
  detect(workspaceId: string, nodes: readonly Node[], managed: ReadonlySet<string>, now: number): void {
    const bound = new Set(this.deps.plan.boundLinearIdsOf(workspaceId));
    const unbound = nodes.flatMap((n) => { const f = factsOf(n); return f === null || bound.has(f.linearId) ? [] : [f]; });
    const viaFleet = new Set<string>();
    const identifiers = [...new Set(unbound.map((f) => f.identifier))];
    for (let i = 0; i < identifiers.length; i += LINEAR_VIA_FLEET_MAX_ITEMS) {
      for (const hit of this.deps.viaFleet(identifiers.slice(i, i + LINEAR_VIA_FLEET_MAX_ITEMS))) viaFleet.add(hit);
    }
    for (const f of unbound) {
      if (!isInbound(f, bound, viaFleet, managed)) continue;
      this.deps.plan.upsertInbound({ linearId: f.linearId, workspaceId, teamKey: f.teamKey, identifier: f.identifier, title: f.title, body: f.body, seenAt: now });
    }
  }

  // ── Every beat ──

  /** Route, then act. Never throws: a failure of one is a warning, and the other still runs. */
  async tick(now: number): Promise<void> {
    for (const [name, step] of [['route', () => this.route(now)], ['answers', () => this.answered(now)]] as const) {
      try { step(); } catch (err) { console.warn(`ccrc-server: linear inbound ${name} failed: ${err instanceof Error ? err.message : String(err)}`); }
    }
    try { await this.act(); } catch (err) { console.warn(`ccrc-server: linear inbound act failed: ${err instanceof Error ? err.message : String(err)}`); }
  }

  private ownerFacts() {
    const { plan, presenceOf } = this.deps;
    return { rows: plan.hierarchyProjectsOf(), facts: { latestProgrammeCoordinator: (p: string) => plan.latestProgrammeCoordinator(p), presence: presenceOf } };
  }

  /** A `waiting` issue goes to its team's owner when it is live or unmeasured; otherwise it waits and its project raises the item.
   *  An open item settles when its project's owner reads live. A team no project holds has no owner row: its issues wait quietly. */
  private route(now: number): void {
    const { plan, coord } = this.deps;
    const { rows, facts } = this.ownerFacts();
    const noOwner = new Set<string>();
    for (const row of plan.inboundByState(null, ['waiting'])) {
      const owner = linearOwnerOfTeam(row.teamKey, rows, facts);
      if (owner === null) continue;
      if (owner.id !== null && !owner.gone) this.mailOwner(row, owner.id, now); else noOwner.add(owner.project);
    }
    const open = coord.itemsFor(LINEAR_SYNC_PROGRAMME, now).open.flatMap((i) => (i.action?.verb === 'linear-owner' ? [{ id: i.id, project: i.action.project }] : []));
    for (const project of noOwner) if (!open.some((i) => i.project === project)) this.raiseOwnerItem(project, now);
    for (const item of open) {
      if (!linearOwnerOfProject(item.project, rows, facts).live) continue;
      coord.moveItem(item.id, 'settle', 'ccrc', { note: 'A Linear owner is live: the waiting issues were mailed to it.' }, now, { programmeHasOpenRun: false });
    }
  }

  /** One mail to the owner per issue (durable, by subject), and the row `mailed` in the same transaction. */
  private mailOwner(row: InboundRow, ownerId: string, now: number): void {
    const { coord, plan } = this.deps;
    const m = inboundMail(row);
    tx(coord.db, () => {
      if (!coord.hasMailWithSubject('operator', null, ownerId, m.subject)) {
        insertSystemMailTx(coord, null, { fromId: 'operator', toId: ownerId, runId: null, kind: 'question', subject: m.subject, body: m.body });
      }
      plan.setInboundState(row.linearId, { state: 'mailed', mailedTo: ownerId, mailedAt: now });
    });
  }

  private raiseOwnerItem(project: string, now: number): void {
    const { coord, plan, presenceOf } = this.deps;
    coord.raiseItem(ownerItemInput(project, plan.coordinatorIdsOf().filter((id) => presenceOf(id) === 'alive')), now, 'ccrc');
  }

  // ── A raised issue's answer ──

  /** A `raised` issue whose operator item is answered or closed (any state but `open`) goes back to its team's owner, as a mail
   *  carrying the operator's answer, and the row is `mailed` again; an item still `checking` settles in the same transaction. With
   *  no usable owner the row stays `raised` until there is one. */
  private answered(now: number): void {
    const { coord, plan } = this.deps;
    const { rows, facts } = this.ownerFacts();
    for (const row of plan.inboundByState(null, ['raised'])) {
      const item = row.itemId === null ? null : coord.itemById(row.itemId);
      if (item !== null && item.state === 'open') continue;
      const owner = linearOwnerOfTeam(row.teamKey, rows, facts);
      if (owner === null || owner.id === null || owner.gone) continue;
      const ownerId = owner.id;
      const m = answeredMail(row, { state: item === null ? 'gone' : item.state, text: item === null ? null : item.answer }, row.itemId);
      const queue = (): void => {
        if (!coord.hasMailWithSubject('operator', null, ownerId, m.subject)) {
          insertSystemMailTx(coord, null, { fromId: 'operator', toId: ownerId, runId: null, kind: 'question', subject: m.subject, body: m.body });
        }
        plan.setInboundState(row.linearId, { state: 'mailed', mailedTo: ownerId, mailedAt: now });
      };
      if (item !== null && item.state === 'checking') {
        coord.moveItemWithMail(item.id, 'settle', 'ccrc', { note: 'The answer was mailed to the Linear owner.' }, now, { programmeHasOpenRun: false }, queue);
      } else {
        tx(coord.db, queue);
      }
    }
  }

  // ── A closed issue's Linear writes ──

  /** For each `closed` issue not yet acted: one comment with the reason, then the cancel, inside the issue's own flight; the row
   *  is `actedAt` only after both are ok (a comment answered `conflict` is one made already). A directory not yet read waits
   *  without a word; a team with no `canceled` status mails the owner once and leaves the row. */
  private async act(): Promise<void> {
    const { plan, directory, planSync } = this.deps;
    const rows = plan.inboundByState(null, ['closed']).filter((r) => r.actedAt === null);
    if (rows.length === 0 || directory === undefined) return;
    const slots = slotsOf(await this.deps.readLinearStore());
    for (const row of rows) {
      const slot = slots.get(row.workspaceId);
      const entries = slot === undefined ? null : directory.get(slot.ref, slot.digest);
      if (slot === undefined || entries === null) continue;
      const now = this.deps.now();
      if (inboundHeld(this.holds.get(row.workspaceId), now) || planSync.keyBlockedUntil(row.workspaceId) > now) continue;   // held: nothing is sent
      const canceled = statusOfType(entries, 'issue', 'canceled', row.teamKey);
      if (canceled === null) { this.mailNoCancel(row); continue; }
      await planSync.withFlight(`inbound:${row.linearId}`, async () => {
        const fresh = plan.inboundOf(row.linearId);
        if (fresh === null || fresh.state !== 'closed' || fresh.actedAt !== null) return;
        const base = { pass: 'inbound', lane: 'sync', slot: slot.ref, workspaceId: row.workspaceId, teamKey: row.teamKey, target: row.identifier } as const;
        const comment = await this.deps.call({
          ...base, op: 'issueComment', fields: ['body'],
          input: { requestId: uuidOf(`inbound:${row.linearId}:comment`), issueId: row.linearId, body: closeCommentBody(fresh.reason ?? '') },
        });
        if (!comment.ok && !(comment.word === 'linear-invalid' && comment.detail === 'conflict')) { this.refused(fresh, comment.word, slot); return; }
        const update = await this.deps.call({ ...base, op: 'issueUpdate', fields: ['state'], input: { id: row.linearId, stateId: canceled.id } });
        if (!update.ok) { this.refused(fresh, update.word, slot); return; }
        plan.setInboundState(row.linearId, { actedAt: this.deps.now() });
        this.holds.delete(row.workspaceId);                 // the whole close landed, never only its comment (N1)
      });
    }
  }

  /** A refused close write, as `inboundActVerdict` rules. A retry word holds the workspace on the plan sync's failure-hold
   *  schedule (and, for a key word, mails the owner once). Any other word gives the close up: the row is written FIRST (`actedAt`
   *  set, so `act` skips it for good, across restarts; the reason carries the refusal), and only then is the owner mailed once. */
  private refused(row: InboundRow, word: string, slot: SlotInfo): void {
    const now = this.deps.now();
    const v = inboundActVerdict(word, this.holds.get(row.workspaceId), { now, backoffSteps: PLAN_SYNC_BACKOFF_MS });
    if (v.kind === 'retry') {
      if (v.hold !== null) this.holds.set(row.workspaceId, v.hold);
      if (v.keyRefused && v.hold !== null) this.deps.planSync.keyRefused(row.workspaceId, slot, v.hold.until);   // a 401 holds both lanes (A-3)
      if (v.mailsOwner) this.mailOwnerOnce(row, keyWaitMail(row));
      return;
    }
    this.deps.plan.setInboundState(row.linearId, { actedAt: now, reason: givenUpReason(row.reason, word) });
    this.mailOwnerOnce(row, closeRefusedMail(row, word));
  }

  private mailNoCancel(row: InboundRow): void { this.mailOwnerOnce(row, noCancelMail(row)); }

  private mailOwnerOnce(row: InboundRow, m: { subject: string; body: string }): void {
    const { coord } = this.deps;
    const { rows, facts } = this.ownerFacts();
    const owner = linearOwnerOfTeam(row.teamKey, rows, facts);
    if (owner === null || owner.id === null) return;
    const ownerId = owner.id;
    if (coord.hasMailWithSubject('operator', null, ownerId, m.subject)) return;
    tx(coord.db, () => { insertSystemMailTx(coord, null, { fromId: 'operator', toId: ownerId, runId: null, kind: 'status', subject: m.subject, body: m.body }); });
  }
}
