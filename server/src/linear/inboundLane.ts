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
 * to the owner as a mail, and the item settles. `act` makes the Linear writes of a `closed` issue (one comment, with the reason or,
 * when the reason fails the public-text check at act time, a fallback with no text, then the cancel), in the issue's own flight, and records `actedAt` only after both landed.
 *
 * THE ROUTES CALL NO LINEAR. `plan triage` and `plan take` only write the store; the one place that writes an inbound issue in
 * Linear is `act` below, under the pass `inbound`.
 */
import type { CoordStore } from '../coord/store.js';
import type { InboundRow, PlanStorePort } from '../coord/planStore.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import { tx } from '../coord/tx.js';
import { ccrcIssueIds, linearOwnerOfTeam, ownerItemReady, teamOwnerProject } from '../coord/planPolicy.js';
import { LINEAR_SYNC_PROGRAMME } from '../../../shared/plan.js';
import { isInbound } from './driftPolicy.js';
import {
  answeredMail, closeCommentBody, closeRefusedCommentBody, closeRefusedMail, closeTextRefusedMail, closeCommentSeedOf, closeIdOf, givenUpReason, inboundActVerdict, inboundHeld, inboundNoteMail, inboundRecheckDue, inboundRecheckStops, inboundRecheckOf, inboundRetireVerdict,
  keyWaitMail, noCancelMail, ownerItemInput, type InboundHold, type InboundRecheck, type RetireWhy,
} from './inboundPolicy.js';
import { LINEAR_VIA_FLEET_MAX_ITEMS } from './journal.js';
import { statusOfType } from './ops.js';
import { textFactOfTeam, textRefusalOf, uuidOf } from './planSyncPolicy.js';
import { PLAN_SYNC_BACKOFF_MS, slotsOf, type SlotInfo } from './planSync.js';
import type { DriftPassDeps } from './driftPass.js';
import type { LinearStoreRead } from './store.js';
import { measuredTeamRoutes, type TeamRoutes } from './route.js';

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
  /** Each close's own count of malformed answers, by its issue's linearId: what the give-up counts (review 2408 F2), as the plan
   *  sync counts a binding's. In this process, as `holds` is; a close done whole or given up drops its count. */
  private readonly malformed = new Map<string, number>();
  /** When each open stored row's issue was last read, by workspace and then by linearId (review 2524 F1: one workspace's pass never
   *  prunes another's times): by a pass's changed read or by this lane's own by-id re-read
   *  (`recheckStored`). In memory like `holds` (D-8733): nothing new is stored, and a restart costs one read per row. */
  private readonly checked = new Map<string, Map<string, number>>();

  constructor(private readonly deps: Deps) {}

  // ── Detect (a workspace pass) ──

  /** Every changed issue node that is no ccrc create (a binding holds it, or a pending ticket's create was sent with its id:
   *  `ccrcIssueIds`, round 5 F2), in a managed team, open and no session's own create, is stored `waiting` with the reporter's
   *  text (a known one only refreshes its text: `upsertInbound`). A node whose row is already stored is judged by
   *  `inboundRetireVerdict` too (round 4 F1, D-8735): completed, canceled or ccrc's own, the row is retired; an open issue whose
   *  row was retired returns to `waiting`. `bound` is read once; `viaFleet` is asked in chunks of at most
   *  `LINEAR_VIA_FLEET_MAX_ITEMS` identifiers (a larger ask answers empty). */
  detect(workspaceId: string, nodes: readonly Node[], managed: ReadonlySet<string>, now: number): void {
    const bound = ccrcIssueIds(this.deps.plan.bindingsInWorkspace(workspaceId));
    const facts = nodes.flatMap((n) => { const f = factsOf(n); return f === null ? [] : [f]; });
    const unbound = facts.filter((f) => !bound.has(f.linearId));
    const viaFleet = new Set<string>();
    const identifiers = [...new Set(unbound.map((f) => f.identifier))];
    for (let i = 0; i < identifiers.length; i += LINEAR_VIA_FLEET_MAX_ITEMS) {
      for (const hit of this.deps.viaFleet(identifiers.slice(i, i + LINEAR_VIA_FLEET_MAX_ITEMS))) viaFleet.add(hit);
    }
    for (const f of facts) {
      const inbound = isInbound(f, bound, viaFleet, managed);
      const stored = this.deps.plan.inboundOf(f.linearId);
      if (stored !== null) {
        const v = inboundRetireVerdict(stored, { stateType: f.stateType, own: bound.has(f.linearId) || viaFleet.has(f.identifier), inbound });
        if (v.kind === 'retire') { this.retire(stored, v.why, now); continue; }
        if (v.kind === 'reopen') {
          // the row's `reason` is a close's and stays; the reopen is a note (review of d4c372f12), written with the state. It carries the
          // cause the row was retired with, read before the state clears it (review 2524 A4)
          const { plan, coord } = this.deps;
          tx(coord.db, () => {
            plan.setInboundState(f.linearId, { state: 'waiting', mailedTo: null, mailedAt: null, handedTo: null, itemId: null, retiredWhy: null });
            plan.setInboundNote(f.linearId, { kind: 'reopened', at: now, was: stored.retiredWhy });
          });
        }
      }
      if (!inbound) continue;
      this.deps.plan.upsertInbound({ linearId: f.linearId, workspaceId, teamKey: f.teamKey, identifier: f.identifier, title: f.title, body: f.body, seenAt: now });
    }
  }

  /** A stored row leaves the lane (D-8735) with its cause: the state, `retiredWhy` and the deletion of its stored note are one act
   *  (`retireInboundInTx`, review 2457 A6). A `raised` row's open or checking operator item settles in the same transaction, so no
   *  item is left asking about an issue that is gone. Writes nothing of the issue that was read: only the state and the cause. */
  private retire(row: InboundRow, why: RetireWhy, now: number): void {
    const { coord, plan } = this.deps;
    this.malformed.delete(row.linearId);   // a reopened issue's next close counts its own answers; the map never grows with retired issues
    const item = row.state === 'raised' && row.itemId !== null ? coord.itemById(row.itemId) : null;
    if (item !== null && (item.state === 'open' || item.state === 'checking')) {
      coord.moveItemWithMail(item.id, 'settle', 'ccrc', { note: 'The issue is no longer inbound in Linear.' }, now, { programmeHasOpenRun: false }, () => plan.retireInboundInTx(row.linearId, why));
    } else {
      plan.retireInbound(row.linearId, why);
    }
  }

  // ── The by-id re-read of a stored row (review 2457 F4, D-8733) ──

  /** The workspace's managed team keys, upper-case. */
  private managedOf(workspaceId: string): Set<string> {
    return new Set(this.deps.plan.managedTeams().filter((m) => m.workspaceId === workspaceId).map((m) => m.teamKey.toUpperCase()));
  }

  /** ONE by-id read of a stored row's issue, through the one rate service, judged by `inboundRecheckOf`. It reads the issue and
   *  drops it: no field of it is kept, written or logged here. No side effect: a caller makes what a refused key means (the one
   *  owner, `keyRefusedByRead`, or the close's own `refused`). A workspace whose key is refused now is not asked. */
  private async readById(row: InboundRow, slot: SlotInfo): Promise<InboundRecheck> {
    const { planSync } = this.deps;
    const managed = this.managedOf(row.workspaceId);
    if (managed.size === 0) return inboundRecheckOf({}, managed);                    // no managed team now: nothing is judged, nothing is asked
    if (planSync.keyBlockedUntil(row.workspaceId) > this.deps.now()) return { kind: 'unmeasured', word: 'linear-unauthorised' };
    const out = await this.deps.call({
      op: 'issueOwned', pass: 'drift-restore', lane: 'sync', slot: slot.ref, workspaceId: row.workspaceId, teamKey: row.teamKey, target: null, fields: [], input: { id: row.linearId },
    });
    if (!out.ok) return out.word === 'not-found' ? inboundRecheckOf(null, managed) : { kind: 'unmeasured', word: out.word };
    const issue = out.value['issue'];
    return inboundRecheckOf(issue !== null && typeof issue === 'object' && !Array.isArray(issue) ? issue as Node : {}, managed);
  }

  /** A refused key on a re-read goes to the plan sync's one owner, as the pass's reads do (A-3). */
  private noteKey(row: InboundRow, slot: SlotInfo, answer: InboundRecheck): void {
    if (answer.kind === 'unmeasured' && answer.word === 'linear-unauthorised' && this.deps.planSync.keyBlockedUntil(row.workspaceId) <= this.deps.now()) {
      this.deps.planSync.keyRefusedByRead(row.workspaceId, slot);
    }
  }

  /** The doors' re-read (`plan take`, `plan triage`): the stored row's issue, by id. An unmeasured answer is any case the read
   *  could not be made (no key, no slot, Linear or the key refused). */
  async recheck(row: InboundRow): Promise<InboundRecheck> {
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    const slot = slotsOf(store).get(row.workspaceId);
    if (slot === undefined) return { kind: 'unmeasured', word: null };
    const answer = await this.readById(row, slot);
    this.noteKey(row, slot, answer);
    return answer;
  }

  /** After a workspace pass: each open stored row (`inboundRetirable`) the pass's changed read did not return is read by id, at most
   *  once per `INBOUND_RECHECK_MS` and at most `INBOUND_RECHECK_MAX_PER_PASS` rows a pass, and retired `moved-out` (or completed or
   *  canceled) when its issue no longer reads open in a managed team. A row the changed read returned counts as read now (`detect`
   *  judged it). Only a workspace-wide answer ends the walk (`inboundRecheckStops`: the key's refusal, a transport or rate failure,
   *  an unreadable store), so a failure costs one read a pass; an answer about one row (review 2524 F2) marks that row checked and
   *  the walk goes on: the row is not retired and nothing of it is stored. */
  async recheckStored(workspaceId: string, slot: SlotInfo, seen: ReadonlySet<string>, now: number): Promise<void> {
    const rows = this.deps.plan.inboundByState(workspaceId, ['waiting', 'mailed', 'handed', 'raised', 'closed']);
    const open = new Set(rows.map((r) => r.linearId));
    const checked = this.checked.get(workspaceId) ?? new Map<string, number>();
    this.checked.set(workspaceId, checked);
    for (const id of checked.keys()) if (!open.has(id)) checked.delete(id);
    for (const id of seen) if (open.has(id)) checked.set(id, now);
    for (const row of inboundRecheckDue(rows, seen, checked, now)) {
      const answer = await this.readById(row, slot);
      if (answer.kind === 'unmeasured' && inboundRecheckStops(answer.word)) { this.noteKey(row, slot, answer); return; }
      checked.set(row.linearId, now);
      if (answer.kind !== 'retire') continue;
      const fresh = this.deps.plan.inboundOf(row.linearId);
      if (fresh !== null) this.retire(fresh, answer.why, now);
    }
  }

  // ── Every beat ──

  /** Route, then act. Never throws: a failure of one is a warning, and the other still runs. */
  async tick(now: number): Promise<void> {
    const store = await this.deps.readLinearStore().catch((): LinearStoreRead => ({ kind: 'unreadable', code: 'unreadable' }));
    const routes = measuredTeamRoutes(store);
    for (const [name, step] of [['route', () => this.route(now, routes)], ['answers', () => this.answered(now, routes)]] as const) {
      try { step(); } catch (err) { console.warn(`ccrc-server: linear inbound ${name} failed: ${err instanceof Error ? err.message : String(err)}`); }
    }
    try { await this.act(store, routes); } catch (err) { console.warn(`ccrc-server: linear inbound act failed: ${err instanceof Error ? err.message : String(err)}`); }
  }

  private ownerFacts() {
    const { plan, presenceOf } = this.deps;
    return { rows: plan.hierarchyProjectsOf(), facts: { latestProgrammeCoordinator: (p: string) => plan.latestProgrammeCoordinator(p), presence: presenceOf } };
  }

  /** A `waiting` issue goes to its team's owner when it is live or unmeasured; otherwise it waits and its project raises the item.
   *  An open item settles when the workspace's owner reads live and none of its team's issues still wait. */
  private route(now: number, routes: TeamRoutes | null): void {
    const { plan, coord } = this.deps;
    const { rows, facts } = this.ownerFacts();
    const noOwner = new Set<string>();
    const waiting: InboundRow[] = [];
    for (const row of plan.inboundByState(null, ['waiting'])) {
      const owner = linearOwnerOfTeam(row.teamKey, rows, facts, row.workspaceId, routes);
      if (owner.kind === 'owner' && owner.id !== null && !owner.gone) this.mailOwner(row, owner.id, now);
      else {
        waiting.push(row);
        if (owner.kind === 'owner') noOwner.add(owner.project);
      }
    }
    const open = coord.itemsFor(LINEAR_SYNC_PROGRAMME, now).open.flatMap((i) => (i.action?.verb === 'linear-owner' ? [{ id: i.id, project: i.action.project }] : []));
    for (const project of noOwner) if (!open.some((i) => i.project === project)) this.raiseOwnerItem(project, now);
    for (const item of open) {
      if (!ownerItemReady(item.project, rows, facts, routes, waiting)) continue;
      coord.moveItem(item.id, 'settle', 'ccrc', { note: 'A Linear owner is live: the waiting issues were mailed to it.' }, now, { programmeHasOpenRun: false });
    }
  }

  /** One mail to the owner per issue (durable, by subject), and the row `mailed` in the same transaction. */
  private mailOwner(row: InboundRow, ownerId: string, now: number): void {
    const { coord, plan } = this.deps;
    // the mail is picked by the row's note (D-8734, D-8735): a reopen or a stored return is mailed under a subject carrying its
    // time, so the first mail's dedupe never eats it; the note is deleted in the transaction that mails it (`setInboundState` deletes it with the move to `mailed`)
    const note = plan.inboundNoteOf(row.linearId);
    const m = inboundNoteMail(row, note);
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
  private answered(now: number, routes: TeamRoutes | null): void {
    const { coord, plan } = this.deps;
    const { rows, facts } = this.ownerFacts();
    for (const row of plan.inboundByState(null, ['raised'])) {
      const item = row.itemId === null ? null : coord.itemById(row.itemId);
      if (item !== null && item.state === 'open') continue;
      const owner = linearOwnerOfTeam(row.teamKey, rows, facts, row.workspaceId, routes);
      if (owner.kind !== 'owner' || owner.id === null || owner.gone) continue;
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

  /** For each `closed` issue not yet acted: one comment (the reason, or a fallback with no text when the reason fails the public-text check now), then the cancel, inside the issue's own flight; the row
   *  is `actedAt` only after both are ok (a comment answered `conflict` is one made already). A directory not yet read waits
   *  without a word; a team with no `canceled` status mails the owner once and leaves the row. */
  private async act(store: LinearStoreRead, routing: TeamRoutes | null): Promise<void> {
    const { plan, directory, planSync } = this.deps;
    const rows = plan.inboundByState(null, ['closed']).filter((r) => r.actedAt === null);
    if (rows.length === 0 || directory === undefined) return;
    const slots = slotsOf(store);
    for (const row of rows) {
      const slot = slots.get(row.workspaceId);
      const entries = slot === undefined ? null : directory.get(slot.ref, slot.digest);
      if (slot === undefined || entries === null) continue;
      const now = this.deps.now();
      if (inboundHeld(this.holds.get(row.workspaceId), now) || planSync.keyBlockedUntil(row.workspaceId) > now) continue;   // held: nothing is sent
      const canceled = statusOfType(entries, 'issue', 'canceled', row.teamKey);
      if (canceled === null) { this.mailNoCancel(row, routing); continue; }
      await planSync.withFlight(`inbound:${row.linearId}`, async () => {
        const fresh = plan.inboundOf(row.linearId);
        if (fresh === null || fresh.state !== 'closed' || fresh.actedAt !== null) return;
        // the issue is re-read by id first (review 2457 F4): one that left the managed teams is retired and nothing is written in
        // Linear; a read that cannot be made is a refused step of the close (the same words, holds and mails), and writes nothing
        const seen = await this.readById(fresh, slot);
        if (seen.kind === 'retire') { this.retire(fresh, seen.why, this.deps.now()); return; }
        const project = teamOwnerProject(fresh.teamKey, plan.hierarchyProjectsOf(), fresh.workspaceId, routing);
        if (seen.kind === 'unmeasured') {
          if (seen.word !== null) this.refused(fresh, { word: seen.word }, slot, routing, project.kind !== 'unmeasured');
          return;
        }
        if (project.kind === 'unmeasured') return;
        const refusal = this.textRefusal(fresh, project.kind === 'owner' ? project.row.project : null);
        const closeId = closeIdOf(fresh);
        const kind = refusal === null ? 'reason' : 'fallback';
        const base = { pass: 'inbound', lane: 'sync', slot: slot.ref, workspaceId: row.workspaceId, teamKey: row.teamKey, target: row.identifier } as const;
        const comment = await this.deps.call({
          ...base, op: 'issueComment', fields: ['body'],
          input: { requestId: uuidOf(closeCommentSeedOf(row.linearId, kind, fresh)), issueId: row.linearId, body: refusal === null ? closeCommentBody(fresh.reason ?? '') : closeRefusedCommentBody() },
        });
        const conflict = !comment.ok && comment.word === 'linear-invalid' && comment.detail === 'conflict';
        if (!comment.ok && !conflict) { this.refused(fresh, comment, slot, routing); return; }
        // the owner is told once per close (the subject is keyed per close) whenever the fallback comment landed, made now or by an
        // earlier attempt, so a lost answer never loses the mail, and an owner whose session is gone is still mailed; before the
        // cancel. A team with no Linear owner at all has no addressee: no mail, and the close and cancel go on (review 2874 F3,
        // the coordinator's ruling: as for the no-cancel and give-up mails; the fallback comment is already on the issue)
        if (refusal !== null) this.mailOwnerOnce(fresh, closeTextRefusedMail(fresh, refusal, closeId), routing);
        const update = await this.deps.call({ ...base, op: 'issueUpdate', fields: ['state'], input: { id: row.linearId, stateId: canceled.id } });
        if (!update.ok) { this.refused(fresh, update, slot, routing); return; }
        plan.setInboundState(row.linearId, { actedAt: this.deps.now() });
        this.holds.delete(row.workspaceId);                 // the whole close landed, never only its comment (N1)
        this.malformed.delete(row.linearId);
      });
    }
  }

  /** Spec §6.1, re-run before the close comment is sent: the facts (the project that owns the team, its linking mode, the installer's
   *  private tracker keys) may have changed since the close was decided. `textRefusalOf` is the one check; a team no project claims is
   *  judged as `unknown`, public, with the row's team key. The project is decided in the row's own workspace, as the lane's other
   *  owner lookups are (review 2971 F1): a key two workspaces hold never takes its mode from the other workspace's project. The class
   *  that refused it, or null. */
  private textRefusal(row: InboundRow, project: string | null): string | null {
    const { coord, planSync } = this.deps;
    const fact = textFactOfTeam(project === null ? null : coord.linkingOf(project), row.teamKey);
    return textRefusalOf([row.reason ?? ''], [fact], planSync.privateKeys());
  }

  /** A refused close write, as `inboundActVerdict` rules. A retry word holds the workspace on the plan sync's failure-hold
   *  schedule (and, for a key word, mails the owner once). Any other word gives the close up: the row is written FIRST (`actedAt`
   *  set, so `act` skips it for good, across restarts; the reason carries the refusal), and only then is the owner mailed once.
   *  When the close's read cannot measure the owner, keep retry holds but defer that permanent step. */
  private refused(row: InboundRow, out: { word: string; retryAfterS?: number }, slot: SlotInfo, routes: TeamRoutes | null, mayGiveUp = true): void {
    const now = this.deps.now();
    const { word } = out;
    const malformedSeen = word === 'malformed' ? (this.malformed.get(row.linearId) ?? 0) + 1 : 0;
    if (word === 'malformed') this.malformed.set(row.linearId, malformedSeen);
    const v = inboundActVerdict(word, this.holds.get(row.workspaceId), {
      now, backoffSteps: PLAN_SYNC_BACKOFF_MS, malformedSeen, floorMs: out.retryAfterS === undefined ? 0 : out.retryAfterS * 1000,
    });
    if (v.kind === 'retry') {
      if (v.hold !== null) this.holds.set(row.workspaceId, v.hold);
      if (v.keyRefused && v.hold !== null) this.deps.planSync.keyRefused(row.workspaceId, slot, v.hold.until);   // a 401 holds both lanes (A-3)
      if (v.mailsOwner) this.mailOwnerOnce(row, keyWaitMail(row, word), routes);
      return;
    }
    if (!mayGiveUp) return;
    this.malformed.delete(row.linearId);
    this.deps.plan.setInboundState(row.linearId, { actedAt: now, reason: givenUpReason(row.reason, word) });
    this.mailOwnerOnce(row, closeRefusedMail(row, word), routes);
  }

  private mailNoCancel(row: InboundRow, routes: TeamRoutes | null): void { this.mailOwnerOnce(row, noCancelMail(row), routes); }

  private mailOwnerOnce(row: InboundRow, m: { subject: string; body: string }, routes: TeamRoutes | null): void {
    const { coord } = this.deps;
    const { rows, facts } = this.ownerFacts();
    const owner = linearOwnerOfTeam(row.teamKey, rows, facts, row.workspaceId, routes);
    if (owner.kind !== 'owner' || owner.id === null) return;
    const ownerId = owner.id;
    if (coord.hasMailWithSubject('operator', null, ownerId, m.subject)) return;
    tx(coord.db, () => { insertSystemMailTx(coord, null, { fromId: 'operator', toId: ownerId, runId: null, kind: 'status', subject: m.subject, body: m.body }); });
  }
}
