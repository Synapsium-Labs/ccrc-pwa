// Delegation broker wave 5, PR6 (Task 5.6.2). L4 delivery for the lane's carrier step, no fastify: it reads the box's carriers
// through the agent's read ops, hands them to the L1 planner (`./delegation-carrier.ts`), and runs the steps it answers. It
// decides nothing the planner decides.
//
// `markLeaseCarrier` is the ONE composer of `CCD_ARGV.leaseMark` (W5-K15): compose from the checkpoint's lease, run, read the one
// carrier back through `readFileMeasured`, and journal `seen` only from that read-back, never from the verb's answer. The lane's
// `leaseActs` phase calls it for every `mark` step, and PR9's promoting dispatch will call it too. Journal first, then mark, then
// read back: the planner reads the checkpoint, so a mark is only ever composed at a generation the journal already holds.
//
// The lane's memory here is a process's own (`CarrierLaneMemory`): a pass ordinal, the pass each lease's carrier was last read at,
// the standing refusals (D-7807), which refusal was logged, the leases whose last mark answered `unmeasured` or did not run, the
// unowned carriers already read `released`, and the released leases already measured with no carrier and no by-tree entry. A
// restart loses it and retries each standing refusal once. The agent's write allowlist is untouched: the carrier's only writer is
// verb `CCD_ARGV.leaseMark` composes, reached through `EXEC_COMMANDS`.
import { LEASE_MARK_REFUSALS, type DelegationCarrierHealth, type LeaseMarkRefusal } from '../../../shared/api.js';
import { CCD_ARGV, LEASE_MARK_LOCK_CAP, capSupported, ccdCan, type LeaseMarkArgs } from '../ccdargv.js';
import type { FleetState } from '../fleetstate.js';
import type { FleetIO } from '../io.js';
import type { RunCcd } from './ports.js';
import type { DelegationDurability } from './delegation-checkpoint.js';
import { delegationTreeKey } from './delegation-correlation.js';
import {
  DELEGATION_CARRIER_REFUSAL_RETRY_PASSES, carrierMarkArgs, carrierReadBackVersus, carrierReadsOf, carrierStateHoldsTree, delegationCarrierCensusRow, isStandingMarkRefusal,
  parseDelegationCarrier, planCarrierSteps, type CarrierReadBack, type CarrierStep, type StandingMarkRefusal,
} from './delegation-carrier.js';
import { formatDelegationInstant, type DelegationCensusRecord, type DelegationCheckpointV1, type DelegationLeaseRow } from './delegation-model.js';

export interface CarrierLaneMemory {
  /** The lane's carrier passes so far: an ordinal, never a clock (D-8034's re-verify order, D-8039's bound). */
  pass: number;
  /** leaseId -> the pass its carrier was last read at (D-8034). */
  readonly lastRead: Map<string, number>;
  /** leaseId -> the pass its last mark answered `unmeasured`: such leases take the budget last, least recently attempted first, until
   *  the lease is up to date (D-8039). */
  readonly unmeasured: Map<string, number>;
  /** leaseId -> the pass its last mark did not run (`ran: false`): the verb may still write its by-tree entry, so it is not `notIndexed`
   *  for `DELEGATION_CARRIER_REFUSAL_RETRY_PASSES` passes, and then joins the ordinary flow (D-8034). */
  readonly notRan: Map<string, number>;
  /** leaseId -> the standing refusal of its last mark (rule 6). */
  readonly refused: Map<string, StandingMarkRefusal>;
  /** leaseId -> the generation whose refusal was last logged (one line per lease and generation). */
  readonly logged: Map<string, number>;
  /** Unowned carriers read `released`: a released carrier never changes, so it is not read again. */
  readonly releasedUnowned: Set<string>;
  /** Released leases read with no carrier while no by-tree entry named them: no later write names them, so no heal is asked again. */
  readonly notIndexed: Set<string>;
  /** The last pass's counts, or null before the lane planned a carrier pass. */
  health: DelegationCarrierHealth | null;
}
export const emptyCarrierLaneMemory = (): CarrierLaneMemory => ({ pass: 0, lastRead: new Map(), unmeasured: new Map(), notRan: new Map(),
  refused: new Map(), logged: new Map(), releasedUnowned: new Set(), notIndexed: new Set(), health: null });

export interface CarrierReadDeps {
  readonly io: Pick<FleetIO, 'readFileMeasured' | 'readdirMeasured'>;
  readonly registryDir: string;
  readonly signal?: AbortSignal;
}
const leasesDir = (d: CarrierReadDeps): string => `${d.registryDir}/delegation/leases`;
const CARRIER_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const LEASE_LINE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\n?$/;
const TREE_KEY = /^[0-9a-f]{64}$/;

/** One carrier read: proven absent, unreadable (a non-regular file, a failed read), or the file's parse, whose `leaseId` must name the
 *  lease the file is named for. A link is followed here, while the box refuses one (`bad-carrier`); the box is the authority. */
export async function readDelegationCarrier(d: CarrierReadDeps, leaseId: string): Promise<CarrierReadBack> {
  const r = await d.io.readFileMeasured(`${leasesDir(d)}/${leaseId}.json`, undefined, d.signal);
  if (r.ok) return parseDelegationCarrier(r.content, leaseId);
  return r.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable', detail: `the carrier of lease ${leaseId} could not be read` };
}

/** The lease ids the by-tree entries name (rule 3's heal), or `'unmeasured'` when the listing or any entry did not read. */
async function readIndexed(d: CarrierReadDeps): Promise<ReadonlySet<string> | 'unmeasured'> {
  const list = await d.io.readdirMeasured(`${leasesDir(d)}/by-tree`, undefined, d.signal);
  if (!list.ok) return list.reason === 'absent' ? new Set() : 'unmeasured';
  const named = new Set<string>();
  for (const name of list.entries) {
    if (!TREE_KEY.test(name)) continue;                              // a dot-file is a mark's staging file, never an entry
    if (d.signal?.aborted === true) return 'unmeasured';
    const r = await d.io.readFileMeasured(`${leasesDir(d)}/by-tree/${name}`, undefined, d.signal);
    if (!r.ok) { if (r.reason === 'absent') continue; return 'unmeasured'; }
    const m = LEASE_LINE.exec(r.content);
    if (m === null) return 'unmeasured';
    named.add(m[1]!);
  }
  return named;
}

/**
 * Reads what one pass's carrier step needs and plans it. Unsupported: nothing is read. Otherwise one listing of the leases directory
 * (a proven absent directory is every carrier absent; an unreadable one reads nothing, and every lease that needed a read counts
 * `unmeasured`), one read per listed carrier `carrierReadsOf` names (every lease behind its generation, and up to eight up-to-date
 * unreleased ones, least recently read first, D-8034), one per unowned carrier not already known `released`, and the by-tree entries
 * only while a released lease with no carrier has not yet been measured against them (a lease whose mark did not run, for thirty passes;
 * an entry that later names a lease already measured without one makes it measured again, review 1549 F4). The re-verify reads are
 * optional: an unreadable listing reads nothing, and only the leases that needed a read count `unmeasured` (review 1549 F5).
 * A lease not re-read this pass is `marked` when its journalled `seen` equals its generation and no read this pass contradicted it. The
 * census row of each lease's tree is the pass's census record and the registry workdirs at or inside it.
 */
export async function planCarrierPass(d: CarrierReadDeps, cp: DelegationCheckpointV1, memory: CarrierLaneMemory, input: {
  fleetState: Pick<FleetState, 'ccdVerbs'> | undefined; nowMs: number; census: readonly DelegationCensusRecord[]; workdirs: readonly string[];
}): Promise<{ steps: readonly CarrierStep[]; censusRow: ReadonlyMap<string, string> }> {
  const supported = ccdCan(input.fleetState, 'leaseMark'), pass = (memory.pass += 1);
  const byKey = new Map(input.census.map((r) => [delegationTreeKey(r.project, r.adminRecord), r] as const));
  const censusRow = new Map(cp.leases.map((l) => {
    const key = delegationTreeKey(l.project, l.adminRecord);
    return [key, delegationCarrierCensusRow(l.canonicalPath, byKey.get(key), input.workdirs)] as const;
  }));
  const owned = new Set(cp.leases.map((l) => l.leaseId));
  for (const map of [memory.refused, memory.logged, memory.lastRead, memory.unmeasured, memory.notRan]) for (const id of map.keys()) if (!owned.has(id)) map.delete(id);
  for (const id of memory.notIndexed) if (!owned.has(id)) memory.notIndexed.delete(id);
  for (const l of cp.leases) if (l.generation > 0 && (l.carrierGenerationSeen ?? 0) >= l.generation) memory.unmeasured.delete(l.leaseId);   // up to date
  for (const [id, at] of memory.notRan) if (pass - at >= DELEGATION_CARRIER_REFUSAL_RETRY_PASSES) memory.notRan.delete(id);   // F2's bound
  const readBack = new Map<string, CarrierReadBack>();
  let indexed: ReadonlySet<string> | 'unmeasured' = new Set();       // no heal asked: nothing to measure
  if (supported) {
    const list = await d.io.readdirMeasured(leasesDir(d), undefined, d.signal);
    const listed = list.ok ? new Set(list.entries.flatMap((n) => { const m = CARRIER_FILE.exec(n); return m === null ? [] : [m[1]!]; }))
      : list.reason === 'absent' ? new Set<string>() : null;
    const heal: string[] = [];
    if (listed !== null) {
      const reads = carrierReadsOf(cp, memory.lastRead), released = new Set(cp.leases.flatMap((l) => (l.releasedAt === null ? [] : [l.leaseId])));
      for (const id of [...reads.behind, ...reads.reverify]) {
        if (d.signal?.aborted === true) break;
        const rb: CarrierReadBack = listed.has(id) ? await readDelegationCarrier(d, id) : { kind: 'absent' };
        readBack.set(id, rb);
        memory.lastRead.set(id, pass);
        if (rb.kind === 'absent' && released.has(id) && !memory.notIndexed.has(id)) heal.push(id);
      }
      for (const id of listed) {
        if (owned.has(id) || memory.releasedUnowned.has(id) || d.signal?.aborted === true) continue;
        const rb = await readDelegationCarrier(d, id);
        if (rb.kind === 'carrier' && rb.body.state === 'released') memory.releasedUnowned.add(id);
        readBack.set(id, rb);
      }
      for (const id of memory.releasedUnowned) if (!listed.has(id)) memory.releasedUnowned.delete(id);
    }
    if (heal.length > 0) {
      indexed = await readIndexed(d);
      if (indexed !== 'unmeasured') {
        for (const id of heal) if (!indexed.has(id) && !memory.notRan.has(id)) memory.notIndexed.add(id);
        // review 1549 F4: an entry written late names a lease already `notIndexed`; it is measured again, so its heal is asked
        for (const id of memory.notIndexed) if (indexed.has(id)) memory.notIndexed.delete(id);
      }
    }
  }
  const plan = planCarrierSteps({ checkpoint: cp, readBack, supported, lockSupported: capSupported(input.fleetState, LEASE_MARK_LOCK_CAP),
    nowMs: input.nowMs, pass, refused: memory.refused, censusRow, indexed, deferred: memory.unmeasured });
  memory.health = plan.health;
  return { steps: plan.steps, censusRow };
}

/** A `mint` or `seen` step through PR5b's doors (`transitionLease` reason `carrier`, `noteCarrierSeen`). A refusal or a throw is warned and
 *  changes nothing: the next pass plans from the checkpoint again. */
export async function applyCarrierJournalStep(durable: Pick<DelegationDurability, 'transitionLease' | 'noteCarrierSeen'>,
  step: Exclude<CarrierStep, { kind: 'mark' }>, nowMs: number): Promise<void> {
  const at = formatDelegationInstant(nowMs);
  try {
    const out = step.kind === 'mint'
      ? await durable.transitionLease({ leaseId: step.leaseId, expectGeneration: 0, reason: 'carrier', at, expiresAt: null, terminalEvidenceAt: null,
        runId: null, promotedSession: null, auditEvidence: null, carrierRequired: true, resolvesThrough: null })
      : await durable.noteCarrierSeen({ leaseId: step.leaseId, generation: step.generation, at });
    if (out.kind === 'refused') console.warn(`ccrc-server: delegation: carrier ${step.leaseId} ${step.kind} refused ${out.refusal}: ${out.detail}`);
  } catch (err) {
    console.warn(`ccrc-server: delegation: carrier ${step.leaseId} ${step.kind} threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface CarrierMarkDeps extends CarrierReadDeps {
  readonly runCcd: RunCcd;
  /** The box's capability words: the composer asks them itself, so no caller (the lane, PR9's dispatch) composes on no evidence. */
  readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  readonly durable: Pick<DelegationDurability, 'noteCarrierSeen'>;
  readonly nowMs: () => number;
}
export type CarrierMarkOutcome =
  | { kind: 'marked'; answer: string; seen: boolean }
  | { kind: 'refused'; word: LeaseMarkRefusal; detail: string; notRan?: true }
  /** Nothing composed: the lease moved since the pass planned its mark (F9), or the box takes no orphan lock for a state that holds a
   *  tree (D-8037). The next pass plans again. */
  | { kind: 'moved' } | { kind: 'unsupported'; detail: string };

const markAnswer = (stdout: string): CarrierMarkOutcome => {
  const line = stdout.trim().split('\n').pop() ?? '';
  let doc: unknown;
  try { doc = JSON.parse(line); } catch { return { kind: 'refused', word: 'unmeasured', detail: 'the verb answered no JSON line' }; }
  const o = (typeof doc === 'object' && doc !== null ? doc : {}) as Record<string, unknown>;
  if (o.ok === true && typeof o.answer === 'string') return { kind: 'marked', answer: o.answer, seen: false };
  if (o.ok === false && (LEASE_MARK_REFUSALS as readonly unknown[]).includes(o.refusal)) {
    return { kind: 'refused', word: o.refusal as LeaseMarkRefusal, detail: typeof o.detail === 'string' ? o.detail : '' };
  }
  return { kind: 'refused', word: 'unmeasured', detail: 'the verb answered outside its grammar' };
};

/**
 * Marks one lease's carrier at the generation the checkpoint journals, then reads that carrier back and journals `seen` only when the
 * read-back equals the lease (`carrierReadBackVersus`). With no capability evidence it composes nothing (`unmeasured`); a state that
 * holds a tree is composed only behind `LEASE_MARK_LOCK_CAP` (D-8037). `planned` is the lane's planned argv: when the lease moved since
 * (another generation or state), nothing is composed (F9); PR9's direct call passes none. A builder refusal (a lease field outside the
 * verb's grammar) is `usage`; a transport failure, a throw or an answer outside the grammar is `unmeasured`, retried next pass.
 */
export async function markLeaseCarrier(
  d: CarrierMarkDeps, lease: DelegationLeaseRow, cp: DelegationCheckpointV1, planned?: Pick<LeaseMarkArgs, 'generation' | 'state'>,
): Promise<CarrierMarkOutcome> {
  const row = (cp.leaseCarriers ?? []).find((c) => c.leaseId === lease.leaseId);
  if (!ccdCan(d.fleetState, 'leaseMark')) return { kind: 'refused', word: 'unmeasured', detail: 'the box reports no carrier-mark capability' };
  const args = carrierMarkArgs(lease, row);
  if (planned !== undefined && (planned.generation !== args.generation || planned.state !== args.state)) return { kind: 'moved' };
  if (carrierStateHoldsTree(args.state) && !capSupported(d.fleetState, LEASE_MARK_LOCK_CAP)) {
    return { kind: 'unsupported', detail: `the box reports no orphan lock for a ${args.state} mark` };
  }
  let argv;
  try { argv = CCD_ARGV.leaseMark(args); } catch (err) {
    return { kind: 'refused', word: 'usage', detail: err instanceof Error ? err.message : String(err) };
  }
  let out: CarrierMarkOutcome;
  try {
    const res = await d.runCcd(argv);
    if (res.ran === false) return { kind: 'refused', word: 'unmeasured', detail: `ccd did not run (${res.reason}): ${res.detail}`, notRan: true };
    out = markAnswer(res.stdout);
    if (out.kind !== 'marked') return out;
    const rb = await readDelegationCarrier(d, lease.leaseId);
    if (rb.kind !== 'carrier' || carrierReadBackVersus(lease, row, rb.body) !== 'equal') return out;
  } catch (err) {
    return { kind: 'refused', word: 'unmeasured', detail: err instanceof Error ? err.message : String(err) };
  }
  try {                                                               // the mark landed: a throw here is the door's, never a refusal
    const seen = await d.durable.noteCarrierSeen({ leaseId: lease.leaseId, generation: lease.generation, at: formatDelegationInstant(d.nowMs()) });
    return { ...out, seen: seen.kind !== 'refused' };
  } catch (err) {
    console.warn(`ccrc-server: delegation: carrier ${lease.leaseId} seen threw: ${err instanceof Error ? err.message : String(err)}`);
    return out;
  }
}

/** What a mark's answer leaves in the lane's memory: a standing refusal is kept against its generation, census row and pass (rule 6,
 *  D-8039), a retried one or a mark clears it; an `unmeasured` answer defers the lease (D-8039), a mark that did not run keeps it out of
 *  `notIndexed` for a bounded number of passes; a refusal is logged once per lease and generation, and the journal never changes. */
export function noteCarrierMark(memory: CarrierLaneMemory, lease: DelegationLeaseRow, out: CarrierMarkOutcome, censusRow: ReadonlyMap<string, string>): void {
  if (out.kind === 'moved' || out.kind === 'unsupported') return;
  const id = lease.leaseId;
  if (out.kind === 'refused' && out.word === 'unmeasured') memory.unmeasured.set(id, memory.pass); else memory.unmeasured.delete(id);
  if (out.kind === 'refused' && out.notRan === true) memory.notRan.set(id, memory.pass); else memory.notRan.delete(id);
  if (out.kind === 'marked') { memory.refused.delete(id); return; }
  if (memory.logged.get(lease.leaseId) !== lease.generation) {
    memory.logged.set(lease.leaseId, lease.generation);
    console.warn(`ccrc-server: delegation: carrier ${lease.leaseId} generation ${lease.generation} refused ${out.word}${out.detail === '' ? '' : `: ${out.detail}`}`);
  }
  if (!isStandingMarkRefusal(out.word)) { memory.refused.delete(lease.leaseId); return; }
  memory.refused.set(lease.leaseId, { generation: lease.generation, word: out.word, pass: memory.pass,
    censusRow: censusRow.get(delegationTreeKey(lease.project, lease.adminRecord)) ?? null });
}
