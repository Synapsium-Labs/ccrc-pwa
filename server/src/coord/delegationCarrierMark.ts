// Delegation broker wave 5, PR6 (Task 5.6.2). L4 delivery for the lane's carrier step, no fastify: it reads the box's carriers
// through the agent's read ops, hands them to the L1 planner (`./delegation-carrier.ts`), and runs the steps it answers. It
// decides nothing the planner decides.
//
// `markLeaseCarrier` is the ONE composer of `CCD_ARGV.leaseMark` (W5-K15): compose from the checkpoint's lease, run, read the one
// carrier back through `readFileMeasured`, and journal `seen` only from that read-back, never from the verb's answer. The lane's
// `leaseActs` phase calls it for every `mark` step, and PR9's promoting dispatch will call it too. Journal first, then mark, then
// read back: the planner reads the checkpoint, so a mark is only ever composed at a generation the journal already holds.
//
// The lane's memory here is a process's own (`CarrierLaneMemory`): the standing refusals (D-7807), which refusal was logged, the
// unowned carriers already read `released`, and the released leases already measured with no carrier and no by-tree entry. A
// restart loses it and retries each standing refusal once. The agent's write allowlist is untouched: the carrier's only writer is
// verb `CCD_ARGV.leaseMark` composes, reached through `EXEC_COMMANDS`.
import { LEASE_MARK_REFUSALS, type DelegationCarrierHealth, type LeaseMarkRefusal } from '../../../shared/api.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import type { FleetState } from '../fleetstate.js';
import type { FleetIO } from '../io.js';
import type { RunCcd } from './ports.js';
import type { DelegationDurability } from './delegation-checkpoint.js';
import { delegationTreeKey } from './delegation-correlation.js';
import {
  carrierMarkArgs, carrierReadBackVersus, delegationCarrierCensusRow, isStandingMarkRefusal, parseDelegationCarrier, planCarrierSteps,
  type CarrierReadBack, type CarrierStep, type StandingMarkRefusal,
} from './delegation-carrier.js';
import { formatDelegationInstant, type DelegationCensusRecord, type DelegationCheckpointV1, type DelegationLeaseRow } from './delegation-model.js';

export interface CarrierLaneMemory {
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
export const emptyCarrierLaneMemory = (): CarrierLaneMemory =>
  ({ refused: new Map(), logged: new Map(), releasedUnowned: new Set(), notIndexed: new Set(), health: null });

export interface CarrierReadDeps {
  readonly io: Pick<FleetIO, 'readFileMeasured' | 'readdirMeasured'>;
  readonly registryDir: string;
  readonly signal?: AbortSignal;
}
const leasesDir = (d: CarrierReadDeps): string => `${d.registryDir}/delegation/leases`;
const CARRIER_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const LEASE_LINE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\n?$/;
const TREE_KEY = /^[0-9a-f]{64}$/;

/** One carrier read: proven absent, unreadable (a link, a non-regular file, a failed read), or the file's parse. */
export async function readDelegationCarrier(d: CarrierReadDeps, leaseId: string): Promise<CarrierReadBack> {
  const r = await d.io.readFileMeasured(`${leasesDir(d)}/${leaseId}.json`, undefined, d.signal);
  if (r.ok) return parseDelegationCarrier(r.content);
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
 * `unmeasured`), one read per lease whose carrier was not yet read back at its generation and is listed, one per unowned carrier not
 * already known `released`, and the by-tree entries only while a released lease with no carrier has not yet been measured against
 * them. The census row of each lease's tree is the pass's census record and the registry workdirs at or inside it.
 */
export async function planCarrierPass(d: CarrierReadDeps, cp: DelegationCheckpointV1, memory: CarrierLaneMemory, input: {
  supported: boolean; nowMs: number; census: readonly DelegationCensusRecord[]; workdirs: readonly string[];
}): Promise<{ steps: readonly CarrierStep[]; censusRow: ReadonlyMap<string, string> }> {
  const byKey = new Map(input.census.map((r) => [delegationTreeKey(r.project, r.adminRecord), r] as const));
  const censusRow = new Map(cp.leases.map((l) => {
    const key = delegationTreeKey(l.project, l.adminRecord);
    return [key, delegationCarrierCensusRow(l.canonicalPath, byKey.get(key), input.workdirs)] as const;
  }));
  const owned = new Set(cp.leases.map((l) => l.leaseId));
  for (const map of [memory.refused, memory.logged]) for (const id of map.keys()) if (!owned.has(id)) map.delete(id);
  for (const id of memory.notIndexed) if (!owned.has(id)) memory.notIndexed.delete(id);
  const readBack = new Map<string, CarrierReadBack>();
  let indexed: ReadonlySet<string> | 'unmeasured' = 'unmeasured';
  if (input.supported) {
    const list = await d.io.readdirMeasured(leasesDir(d), undefined, d.signal);
    const listed = list.ok ? new Set(list.entries.flatMap((n) => { const m = CARRIER_FILE.exec(n); return m === null ? [] : [m[1]!]; }))
      : list.reason === 'absent' ? new Set<string>() : null;
    const heal: string[] = [];
    if (listed !== null) {
      for (const l of cp.leases) {
        if (l.generation === 0 || (l.carrierGenerationSeen ?? 0) >= l.generation || d.signal?.aborted === true) continue;
        const rb: CarrierReadBack = listed.has(l.leaseId) ? await readDelegationCarrier(d, l.leaseId) : { kind: 'absent' };
        readBack.set(l.leaseId, rb);
        if (rb.kind === 'absent' && l.releasedAt !== null && !memory.notIndexed.has(l.leaseId)) heal.push(l.leaseId);
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
      if (indexed !== 'unmeasured') for (const id of heal) if (!indexed.has(id)) memory.notIndexed.add(id);
    }
  }
  const plan = planCarrierSteps({ checkpoint: cp, readBack, supported: input.supported, nowMs: input.nowMs, refused: memory.refused, censusRow, indexed });
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
  | { kind: 'refused'; word: LeaseMarkRefusal; detail: string };

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
 * read-back equals the lease (`carrierReadBackVersus`). With no capability evidence it composes nothing (`unmeasured`). A builder refusal (a lease field outside the verb's grammar) is `usage`; a
 * transport failure, a throw or an answer outside the grammar is `unmeasured`, retried next pass.
 */
export async function markLeaseCarrier(d: CarrierMarkDeps, lease: DelegationLeaseRow, cp: DelegationCheckpointV1): Promise<CarrierMarkOutcome> {
  const row = (cp.leaseCarriers ?? []).find((c) => c.leaseId === lease.leaseId);
  if (!ccdCan(d.fleetState, 'leaseMark')) return { kind: 'refused', word: 'unmeasured', detail: 'the box reports no carrier-mark capability' };
  let argv;
  try { argv = CCD_ARGV.leaseMark(carrierMarkArgs(lease, row)); } catch (err) {
    return { kind: 'refused', word: 'usage', detail: err instanceof Error ? err.message : String(err) };
  }
  try {
    const res = await d.runCcd(argv);
    if (res.ran === false) return { kind: 'refused', word: 'unmeasured', detail: `ccd did not run (${res.reason}): ${res.detail}` };
    const out = markAnswer(res.stdout);
    if (out.kind === 'refused') return out;
    const rb = await readDelegationCarrier(d, lease.leaseId);
    if (rb.kind !== 'carrier' || carrierReadBackVersus(lease, row, rb.body) !== 'equal') return out;
    const seen = await d.durable.noteCarrierSeen({ leaseId: lease.leaseId, generation: lease.generation, at: formatDelegationInstant(d.nowMs()) });
    return { ...out, seen: seen.kind !== 'refused' };
  } catch (err) {
    return { kind: 'refused', word: 'unmeasured', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** What a mark's answer leaves in the lane's memory: a standing refusal is kept against its generation and census row (rule 6), a
 *  retried one or a mark clears it; a refusal is logged once per lease and generation, and the journal never changes. */
export function noteCarrierMark(memory: CarrierLaneMemory, lease: DelegationLeaseRow, out: CarrierMarkOutcome, censusRow: ReadonlyMap<string, string>): void {
  if (out.kind === 'marked') { memory.refused.delete(lease.leaseId); return; }
  if (memory.logged.get(lease.leaseId) !== lease.generation) {
    memory.logged.set(lease.leaseId, lease.generation);
    console.warn(`ccrc-server: delegation: carrier ${lease.leaseId} generation ${lease.generation} refused ${out.word}${out.detail === '' ? '' : `: ${out.detail}`}`);
  }
  if (!isStandingMarkRefusal(out.word)) { memory.refused.delete(lease.leaseId); return; }
  memory.refused.set(lease.leaseId, { generation: lease.generation, word: out.word,
    censusRow: censusRow.get(delegationTreeKey(lease.project, lease.adminRecord)) ?? null });
}
