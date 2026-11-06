// Delegation broker wave 5, PR7 (Task 5.7.3). L4 delivery for the lane's adoption step, no fastify: it gathers what the L1 decider
// (`./delegation-adoption.ts`) needs, runs it, and acts on its answer. It decides nothing the decider decides.
//
// Each pass, in order: one listing of the registry (the `delegation-adopt` marker and `mail-disabled`, absent, present and
// unmeasured kept apart), the audits the previous pass asked for (`ws-lease-audit`, behind `lease-audit-v1`, read-only), the parents'
// facts and the audits fed and held (both classified in L1, review 1587 A7 and F3), the carriers of the leases past rules 4 to 6 read
// HERE at decision time, at most `DELEGATION_ADOPT_CARRIER_READS_PER_PASS` (never PR6's read-backs, D-8034; review 1587 F7), the decider, then the
// effects: `adopt` through PR5b's `transitionLease` (a feed row on `applied`; the carrier is marked by PR6's step later in the same
// pass), `would-adopt` as one log line per lease and generation (shadow writes nothing durable, O5-7 (a)), and `attention` through
// the caller's notice funnel. The notices are derived from durable state each pass (`owedLeaseNotices`, D-7812), never from this
// pass's decisions, and each is queued through `queueRunlessNotice`, deduped on its subject in one transaction; while `mail-disabled`
// stands nothing is queued and the notices stay owed. The lane's memory here is a process's own: a restart re-derives what is owed.
import type { DelegationAdoptionHealth, LeaseAuditAnswer } from '../../../shared/api.js';
import { DELEGATION_ADOPT_MARKER, MAIL_DISABLED_MARKER, readSwitches } from '../../../shared/switches.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import type { FleetState } from '../fleetstate.js';
import type { FleetIO } from '../io.js';
import type { RunCcd, WatcherCoordPort } from './ports.js';
import type { DelegationDurability } from './delegation-checkpoint.js';
import type { ParentIncarnation } from './gitref.js';
import type { DelegationCircuitBreakerState } from './delegation-policy.js';
import { formatDelegationInstant, type DelegationCensusRecord, type DelegationCheckpointV1, type DelegationLeaseRow } from './delegation-model.js';
import { delegationTreeKey } from './delegation-correlation.js';
import { conflictingTreeKeys } from './delegation-conflicts.js';
import { leaseCoordinatorOf } from './delegation-lease-acts.js';
import { boxHoldsTrees, runStampsOfSeries } from './delegationLeaseDoor.js';
import { readDelegationCarrier } from './delegationCarrierMark.js';
import type { CarrierReadBack } from './delegation-carrier.js';
import { queueRunlessNotice } from './rundefsTx.js';
import {
  adoptTerminalEvidenceAt, adoptionAudits, adoptionCarrierReads, adoptionParentFacts, buildLeaseDigest, delegationAdoptionHealthShown, buildLeaseReminder,
  decideAdoption, leaseRecipient, owedLeaseNotices, parseLeaseAuditAnswer, type AdoptWatch, type AdoptionInput, type HeldLeaseAudit, type LeaseDigestItem, type LeaseRecipient,
  type ParentFact,
} from './delegation-adoption.js';

export interface AdoptLaneMemory {
  /** The decider's watch, carried pass to pass. */
  watch: Map<string, AdoptWatch>;
  /** The attention keys still standing whose notice ran (review 1587 F4: a key is recorded only after its notice). */
  raised: Set<string>;
  /** The audits the last pass asked for, run at the start of this one. */
  asked: { leaseId: string; generation: number }[];
  /** The definite audit answers held (`adoptionAudits`: a candidate's generation, at most `DELEGATION_AUDIT_HOLD_MS`). */
  audits: Map<string, HeldLeaseAudit>;
  /** leaseId -> the generation whose shadow line was logged, and apart from it the generation whose refusal was (review 1587 A1): one
   *  line of each per lease and generation, both pruned with the lease. */
  readonly shadowLogged: Map<string, number>;
  readonly refusalLogged: Map<string, number>;
  health: DelegationAdoptionHealth | null;
}
/** The health block's `adoption` member: the last pass's counts, or null when every count is zero (D-8035's rule). */
export const adoptionHealthShown = (memory: AdoptLaneMemory): DelegationAdoptionHealth | null => delegationAdoptionHealthShown(memory.health);
export const emptyAdoptLaneMemory = (): AdoptLaneMemory => ({ watch: new Map(), raised: new Set(), asked: [], audits: new Map(), shadowLogged: new Map(),
  refusalLogged: new Map(), health: null });

export interface AdoptStepDeps {
  readonly io: Pick<FleetIO, 'readFileMeasured' | 'readdirMeasured'>;
  readonly registryDir: string;
  readonly signal?: AbortSignal;
  readonly runCcd: RunCcd;
  readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  readonly durable: Pick<DelegationDurability, 'transitionLease' | 'state'>;
  /** The coord store, as the lane's notice sinks carry it; with none, nothing is mailed and every notice stays owed. */
  readonly mail: { readonly coord?: WatcherCoordPort | undefined };
  /** The notice funnel: `record-only` for the feed row of an adoption, `push` for an attention item. */
  readonly notice: (title: string, body: string, mode: 'record-only' | 'push') => void;
}
export interface AdoptPassFacts {
  nowMs: number;
  /** The pass's flat census and the projects it measured (`laneFlatCensus`). */
  census: readonly DelegationCensusRecord[];
  censused: ReadonlySet<string>;
  /** The registry rows this pass assembled, every id its listing named (null before one), and whether the registry listed at all. */
  records: readonly { id: string }[];
  listedIds: ReadonlySet<string> | null;
  registryListed: boolean;
  /** The sessions this pass measured alive. */
  alive: ReadonlySet<string>;
  /** The census's settled incarnations. */
  incarnations: ReadonlyMap<string, ParentIncarnation>;
  /** The lane's first-dead instants (epoch ms), as the breaker reads them. */
  firstDead: ReadonlyMap<string, number>;
  breaker: DelegationCircuitBreakerState;
}

/** One `ws-lease-audit` (read-only), behind `lease-audit-v1`: the verb's answer, or `unmeasured` when it did not run or answered outside
 *  its grammar (which the decider counts as changed). */
export async function runLeaseAudit(d: Pick<AdoptStepDeps, 'runCcd' | 'fleetState'>, leaseId: string, generation: number): Promise<LeaseAuditAnswer> {
  if (!ccdCan(d.fleetState, 'leaseAudit')) return { ok: false, refusal: 'unmeasured', detail: 'the box reports no lease-audit capability' };
  try {
    const res = await d.runCcd(CCD_ARGV.leaseAudit(leaseId, generation, false));
    if (res.ran === false) return { ok: false, refusal: 'unmeasured', detail: `ccd did not run (${res.reason}): ${res.detail}` };
    return parseLeaseAuditAnswer(res.stdout);
  } catch (err) {
    return { ok: false, refusal: 'unmeasured', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The lane's adoption step for one pass (the caller holds a ready applier and runs it between native-removed and the carriers). */
export async function runAdoptStep(d: AdoptStepDeps, memory: AdoptLaneMemory, f: AdoptPassFacts): Promise<void> {
  const now = formatDelegationInstant(f.nowMs);
  const listing = await d.io.readdirMeasured(d.registryDir, undefined, d.signal);
  const switches = readSwitches(listing.ok ? listing.entries : null);
  const marker = switches[DELEGATION_ADOPT_MARKER] === 'set' ? 'present' : switches[DELEGATION_ADOPT_MARKER] === 'clear' ? 'absent' : 'unmeasured';
  const mailHeld = switches[MAIL_DISABLED_MARKER] !== 'clear';
  const fresh = new Map<string, HeldLeaseAudit>();
  for (const ask of memory.asked.splice(0)) {
    if (d.signal?.aborted === true) break;
    fresh.set(ask.leaseId, { generation: ask.generation, answer: await runLeaseAudit(d, ask.leaseId, ask.generation), at: now });
  }
  const cp = d.durable.state().checkpoint as DelegationCheckpointV1;
  const conflicting = conflictingTreeKeys(cp);
  const { audits, held } = adoptionAudits({ now, checkpoint: cp, auditable: ccdCan(d.fleetState, 'leaseAudit'), held: memory.audits, fresh });
  memory.audits = held;
  const parents = adoptionParentFacts(cp, { now, registryListed: f.registryListed, listedIds: f.listedIds, built: new Set(f.records.map((x) => x.id)),
    alive: f.alive, incarnations: f.incarnations, firstDead: f.firstDead });
  const input: Omit<AdoptionInput, 'carriers'> = { now, checkpoint: cp, treePresent: new Set(f.census.filter((x) => x.state === 'present').map((x) => delegationTreeKey(x.project, x.adminRecord))),
    censused: f.censused, audits, watch: memory.watch, parents, conflicting, boxHolds: boxHoldsTrees(d.fleetState), breaker: f.breaker, marker, raised: memory.raised };
  const carriers = new Map<string, CarrierReadBack>();
  for (const id of adoptionCarrierReads(input)) {
    if (d.signal?.aborted === true) return;
    carriers.set(id, await readDelegationCarrier(d, id));
  }
  const r = decideAdoption({ ...input, carriers });
  memory.watch = r.watch;
  memory.raised = new Set([...memory.raised].filter((k) => r.raised.has(k)));       // a key leaves when its condition clears (F4)
  const unreleased = new Set(cp.leases.filter((l) => l.releasedAt === null).map((l) => l.leaseId));
  for (const logged of [memory.shadowLogged, memory.refusalLogged]) for (const id of logged.keys()) if (!unreleased.has(id)) logged.delete(id);
  const leaseOf = (id: string): DelegationLeaseRow | undefined => cp.leases.find((l) => l.leaseId === id);
  const once = (logged: Map<string, number>, l: DelegationLeaseRow, line: string): void => {
    if (logged.get(l.leaseId) === l.generation) return;
    logged.set(l.leaseId, l.generation);
    console.warn(line);
  };
  for (const dec of r.decisions) {
    if (d.signal?.aborted === true) break;
    const lease = 'leaseId' in dec ? leaseOf(dec.leaseId) : undefined;
    if (dec.kind === 'audit') memory.asked.push({ leaseId: dec.leaseId, generation: dec.generation });
    else if (dec.kind === 'attention') {
      d.notice(dec.title, dec.body, 'push');
      memory.raised.add(dec.key);                                                      // F4: recorded only after its notice ran
    } else if (dec.kind === 'would-adopt' && lease !== undefined) {
      once(memory.shadowLogged, lease, `ccrc-server: delegation: adoption shadow: would adopt ${lease.leaseId} (${lease.project}/${lease.adminRecord}, terminal ${r.watch.get(lease.leaseId)?.terminalAt ?? 'unknown'})`);
    } else if (dec.kind === 'adopt' && lease !== undefined) {
      const audit = audits.get(lease.leaseId);
      try {
        const out = await d.durable.transitionLease({ leaseId: lease.leaseId, expectGeneration: dec.expectGeneration, reason: 'adopt', at: now,
          expiresAt: dec.expiresAt, terminalEvidenceAt: adoptTerminalEvidenceAt(dec.terminalAt, lease), runId: null, promotedSession: null,
          auditEvidence: audit !== undefined && audit !== 'unsupported' && audit.ok ? audit.token : null, carrierRequired: true, resolvesThrough: null });
        if (out.kind === 'applied') {
          d.notice(`worktree kept: ${lease.project}/${lease.adminRecord}`, `Delegated work left this worktree changed; it is kept until ${dec.expiresAt} (lease ${lease.leaseId}).`, 'record-only');
        } else once(memory.refusalLogged, lease, `ccrc-server: delegation: adoption of ${lease.leaseId} ${out.kind === 'refused' ? `refused ${out.refusal}: ${out.detail}` : 'already applied'}`);
      } catch (err) {
        console.warn(`ccrc-server: delegation: adoption of ${lease.leaseId} threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  memory.health = { ...r.health, owed: queueOwedNotices({ ...d, coord: d.mail.coord }, d.durable.state().checkpoint as DelegationCheckpointV1, now, parents, r.decisions, mailHeld) };
}

/** Queues every notice owed from durable state (D-7812), each through `queueRunlessNotice`; answers how many are owed and not yet sent
 *  (review 1587 F6): one held while `mail-disabled` stands whose subject has no mail yet, one for a recipient unmeasured (which holds it),
 *  and one whose queue threw. With no store nothing is mailed and every notice counts. */
function queueOwedNotices(d: AdoptStepDeps & { coord?: WatcherCoordPort | undefined }, cp: DelegationCheckpointV1, now: string,
  parents: ReadonlyMap<string, ParentFact>, decisions: ReturnType<typeof decideAdoption>['decisions'], mailHeld: boolean): number {
  const coordinators = new Map<string, Parameters<typeof leaseCoordinatorOf>[1] | null>();
  const recipientOf = (l: DelegationLeaseRow): LeaseRecipient => {
    if (d.coord === undefined) return { kind: 'unmeasured' };
    if (!coordinators.has(l.parentId)) {
      let read: ReturnType<typeof runStampsOfSeries>;
      try { read = runStampsOfSeries(d.coord, l.parentId); } catch (err) { read = { ok: false, detail: err instanceof Error ? err.message : String(err) }; }
      coordinators.set(l.parentId, read.ok ? read.runs : null);
    }
    const runs = coordinators.get(l.parentId) ?? null;
    if (runs === null) return { kind: 'unmeasured' };
    try { return leaseRecipient(l, parents.get(l.parentId), leaseCoordinatorOf(l, runs)); } catch { return { kind: 'unmeasured' }; }
  };
  let owed = 0;
  const due: { toId: string; subject: string; body: string }[] = [];
  for (const { recipient, item } of owedLeaseNotices(cp, now, recipientOf)) {
    if (recipient.kind === 'unmeasured') owed += 1;
    else due.push({ toId: recipient.to, ...buildLeaseDigest(recipient.to, item, { retain: true, promote: false }) });
  }
  for (const dec of decisions) {
    if (dec.kind !== 'remind') continue;
    const l = cp.leases.find((x) => x.leaseId === dec.leaseId);
    const to = l === undefined ? null : recipientOf(l);
    if (l === undefined || to === null || to.kind === 'record-only') continue;
    if (to.kind === 'unmeasured') { owed += 1; continue; }
    const item: LeaseDigestItem = { leaseId: l.leaseId, generation: dec.generation, canonicalPath: l.canonicalPath, parentId: l.parentId, expiresAt: dec.expiresAt };
    due.push({ toId: to.to, ...buildLeaseReminder(item, { retain: true, promote: false }) });
  }
  for (const n of due) {
    if (d.coord === undefined) { owed += 1; continue; }
    try {
      if (mailHeld) { if (!d.coord.hasMailWithSubject('operator', null, n.toId, n.subject)) owed += 1; continue; }
      queueRunlessNotice(d.coord, { toId: n.toId, kind: 'status', subject: n.subject, body: n.body });
    } catch (err) {
      owed += 1;
      console.warn(`ccrc-server: delegation: notice "${n.subject}" could not be queued: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return owed;
}
