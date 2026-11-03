// Delegation broker wave 4, PR3 (D-7000, D-7001, D-6999, D-7021): the journal compaction PLANNER, pure.
//
// What it decides, from the durable checkpoint and one stream of the retained records (the carried file's lines first, then the
// journal's, each with its byte position in its own file):
//   - the cut point S = min(F - 1, applied - 1), where F is the first journal record accepted inside the retention floor and
//     `applied` is the checkpoint anchor's sequence, so the anchor always stays in the journal;
//   - the CARRIED set: every record at or below S that a carry rule (K1-K6) still needs, copied verbatim into
//     `delegation-carried.log` by the applier; everything else at or below S is cut;
//   - what the cut frees (`worthwhile`), and the ended activities C1 may retire once the cut is durable (`retirable`).
//
// Carry candidacy is decided per record, independently of S; only positions are kept, and `finish` filters them to S. On the way it
// decides which records are at or below S as they arrive (until the first record inside the floor appears, a record is at or below S
// exactly when it is below the anchor; from that record on, none is), so nothing needs a second pass and memory stays bounded by the
// candidates, the open Bash calls and the cut evidence IDs.
//
// THE RING: no I/O, no clock, no randomness. It imports the model's pure vocabulary and nothing of the checkpoint module: what a record
// NAMES is the consumer's port (`DelegationRecordNaming`), which `delegation-checkpoint.ts` supplies from its own naming code, so there is
// no import cycle and the planner can never name a key differently from the fold.
import type { DelegationActivitySourceKind, DelegationEventEnvelopeV1 } from '../../../shared/api.js';
import {
  DELEGATION_BASH_PENDING_MS,
  encodeDelegationNaturalKey,
  isDelegationWorkerIndex,
  parseDelegationInstant,
  type DelegationActivityRow,
  type DelegationCheckpointV1,
  type DelegationJournalRecordV1,
} from './delegation-model.js';

/** A cut is made only when it frees at least this share of the journal's bytes, net of what it carries out of the journal. */
export const DELEGATION_COMPACTION_MIN_SHARE = 0.25;

/** D-6999: every record observed within this span of a raw lease's creating call is kept, so the link can be audited again. A test pins it
 *  equal to the correlation's `DELEGATION_EVIDENCE_MARGIN_MS`. */
export const DELEGATION_RAW_LEASE_WINDOW_MS = 20 * 60_000;

/** Why a record at or below S is carried (K1-K6). Closed; the order is the order a carried line lists its reasons in. */
export const DELEGATION_CARRY_REASONS = ['open-lease', 'open-lineage', 'identity-candidate', 'active-identity',
  'active-workflow-launch', 'raw-lease-window', 'bash-pair'] as const;
export type DelegationCarryReason = (typeof DELEGATION_CARRY_REASONS)[number];

/** Which term bound S: the retention floor, the checkpoint anchor, or neither because nothing at all is cut. */
export type DelegationCutLimit = 'floor' | 'anchor' | 'empty';
const DELEGATION_CUT_LIMITS: Readonly<Record<DelegationCutLimit, true>> = { floor: true, anchor: true, empty: true };

/** Why a compaction cut nothing. */
export type DelegationCompactionSkipReason = 'not-ready' | 'nothing-to-cut' | 'below-share';
const DELEGATION_COMPACTION_SKIP_REASONS: Readonly<Record<DelegationCompactionSkipReason, true>> = {
  'not-ready': true, 'nothing-to-cut': true, 'below-share': true,
};

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: derived from the tables above, never
 *  re-spelled, so a word added to a union is admitted and a typo is not. None is a mail rejection or a run refusal. */
export function isDelegationCompactionKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return (DELEGATION_CARRY_REASONS as readonly string[]).includes(v) || own(DELEGATION_CUT_LIMITS) || own(DELEGATION_COMPACTION_SKIP_REASONS);
}

/** What a record names, as the fold reads it. The consumer's port: `delegation-checkpoint.ts` supplies it (`delegationRecordNaming`). */
export interface DelegationRecordNaming {
  naturalKeysOf(e: DelegationEventEnvelopeV1): readonly { encoded: string; sourceKind: DelegationActivitySourceKind }[];
  bashListingOf(e: DelegationEventEnvelopeV1): readonly string[] | undefined;
  workflowLaunchRunId(e: DelegationEventEnvelopeV1): string | null;
}

/** Where a line sits in its file. `length` includes the LF. */
export interface DelegationLinePosition { offset: number; length: number }

export interface DelegationCarriedLine extends DelegationLinePosition {
  sequence: number;
  journalId: string;
  /** Which file the bytes are copied from: the current carried file, or the journal. */
  source: 'carried' | 'journal';
  reasons: readonly DelegationCarryReason[];
}

export interface DelegationCompactionPlan {
  enabled: boolean;
  disabledReason: string | null;
  /** S; 0 = nothing cut. */
  cutThrough: number;
  limitedBy: DelegationCutLimit;
  /** The byte offset of record S+1 in the journal (the file size when S is its last record). */
  suffixOffset: number;
  /** In sequence order, all <= S. */
  carried: readonly DelegationCarriedLine[];
  /** The evidence records among them. */
  carriedEvidenceSequences: readonly number[];
  /** Evidence eventIds at or below S that are not carried (from the journal, and the old carried lines no rule selects any more). */
  cutEvidenceEventIds: readonly string[];
  /** Journal records at or below S, and their bytes. */
  cutRecords: number;
  cutBytes: number;
  /** The new carried file's bytes. */
  carriedBytes: number;
  /** `cutBytes` less the carried lines copied out of the journal, against `DELEGATION_COMPACTION_MIN_SHARE` of the journal's bytes. */
  worthwhile: boolean;
  /** Task 3.5: the activity IDs C1 may retire once the cut is durable, sorted. */
  retirable: readonly string[];
  /** Diagnostic facts captured by the same stream that decides the cut; never inferred from evidence observedAt. */
  firstJournalAcceptedAt: string | null;
  firstRetainedAcceptedAt: string | null;
  netShare: number;
  /** Physical carried-file totals supplied by the retained reader after validation, including suppressed journal copies. */
  currentCarriedBytes: number;
  currentCarriedLines: number;
}

/** The daily diagnostic, from the planner's measured stream and the durable outcome, never from a second read. */
export function delegationCompactionLine(plan: DelegationCompactionPlan, result: { reason: DelegationCompactionSkipReason } | { eventsDeleted: number; retired: number; ms: number }): string {
  const prefix = 'ccrc-server: delegation compaction:';
  if ('reason' in result) return `${prefix} skipped (${result.reason} ${Number((100 * plan.netShare).toFixed(2))}%); first record accepted ${plan.firstJournalAcceptedAt ?? '(none)'}; carried file ${plan.currentCarriedBytes} in ${plan.currentCarriedLines} lines`;
  const reasons = DELEGATION_CARRY_REASONS.map((r) => [r, plan.carried.filter((l) => l.reasons.includes(r)).length] as const)
    .filter(([, n]) => n > 0).map(([r, n]) => `${r}=${n}`).join(',');
  return `${prefix} cut ${plan.cutRecords} records (${plan.cutBytes}) through ${plan.cutThrough}, limited by ${plan.limitedBy}; first retained ${plan.cutThrough + 1} accepted ${plan.firstRetainedAcceptedAt}; carried ${plan.carried.length} (${plan.carriedBytes}) by reason ${reasons || '(none)'}; carried file ${plan.carriedBytes} in ${plan.carried.length} lines; events deleted ${result.eventsDeleted}; activities retired ${result.retired}; ${result.ms} ms`;
}

const DISABLED_REASON = 'recovery has not completed: compaction stays disabled from reconstruction entry through validation (O2)';

/** One record as the planner keeps it while it might be carried. */
interface Seen {
  sequence: number;
  journalId: string;
  offset: number;
  length: number;
  source: 'carried' | 'journal';
  /** At or below S (decided as the record arrives; see the header). */
  below: boolean;
  evidence: boolean;
  reasons: Set<DelegationCarryReason>;
}

/** One Bash call's records on one natural key (K6): its first listing-carrying PreToolUse, every record on the key after it, up to and
 *  including the first PostToolUse, which closes it; or, unclosed, until the fold would age the PreToolUse away. */
interface BashCall { id: number; members: Seen[]; acceptedAtMs: number }

type DueEntry = readonly [dueMs: number, key: string, id: number];
const dueLess = (a: DueEntry, b: DueEntry): boolean => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
function duePush(h: DueEntry[], e: DueEntry): void {
  h.push(e);
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (!dueLess(h[i]!, h[p]!)) break;
    [h[i], h[p]] = [h[p]!, h[i]!];
    i = p;
  }
}
function duePop(h: DueEntry[]): void {
  const last = h.pop();
  if (last === undefined || h.length === 0) return;
  h[0] = last;
  for (let i = 0; ;) {
    const l = 2 * i + 1, r = l + 1;
    let m = i;
    if (l < h.length && dueLess(h[l]!, h[m]!)) m = l;
    if (r < h.length && dueLess(h[r]!, h[m]!)) m = r;
    if (m === i) break;
    [h[i], h[m]] = [h[m]!, h[i]!];
    i = m;
  }
}

/** Disjoint, sorted, inclusive [start, end] windows in epoch milliseconds. */
function mergeWindows(windows: Array<[number, number]>): Array<[number, number]> {
  windows.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const w of windows) {
    const last = out[out.length - 1];
    if (last !== undefined && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else out.push([w[0], w[1]]);
  }
  return out;
}

function inWindows(windows: readonly (readonly [number, number])[], t: number): boolean {
  let lo = 0;
  let hi = windows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (windows[mid]![0] <= t) lo = mid + 1; else hi = mid;
  }
  const w = windows[lo - 1];
  return w !== undefined && t <= w[1];
}

/**
 * Plans one compaction. Feed the old carried file's lines first (`addCarried`, in file order), then the journal's (`add`, in file order),
 * then `finish` with the journal's size in bytes. The rules, exactly (plan "## PR3", Task 3.2; operator rulings D-7000, D-7001, D-6999,
 * D-7021):
 *   - disabled while reconstructing: nothing is cut and nothing carried (O2);
 *   - S = min(F - 1, applied - 1); with no record inside the floor, F - 1 is the journal's last sequence;
 *   - K1 a record an `open-lease` or `open-lineage` hold names; K2 every record naming an `identity-candidate` hold's key; K3 the identity
 *     record of every activity that has not ended; K4 the launch response of every Workflow run that has not ended; K5 every evidence
 *     record observed within `DELEGATION_RAW_LEASE_WINDOW_MS` of a raw lease's call, inclusive, on every repository (the planner cannot
 *     see a window's repository, so it keeps a superset); K6 the records of a Bash call are kept together, so no PostToolUse is retained
 *     without its PreToolUse (the extensions of K6 are D-7011, at `noteBash`, and D-7012, at `callCarries`);
 *   - an old carried line is carried again only when a rule still selects it, from its old position.
 */
export class DelegationCompactionPlanner {
  private readonly cp: DelegationCheckpointV1;
  private readonly ready: boolean;
  private readonly cutoffMs: number;
  private readonly naming: DelegationRecordNaming;
  private readonly anchor: number;
  /** K1: journalId -> the hold reasons naming it. */
  private readonly k1 = new Map<string, Set<'open-lease' | 'open-lineage'>>();
  /** K2: the encoded keys of the identity-candidate holds. */
  private readonly k2 = new Set<string>();
  /** K3: the identity records of activities that have not ended. */
  private readonly k3 = new Set<string>();
  /** K4: the encoded keys of Workflow runs that have not ended. */
  private readonly k4 = new Set<string>();
  /** K5: the raw leases' windows. */
  private readonly k5: Array<[number, number]>;
  /** C1: encoded key -> activity ID, for the ended activities nothing but a record could keep (the wanted set). */
  private readonly wantedByKey = new Map<string, string>();
  private readonly wanted = new Set<string>();
  /** C1: the wanted activities a record above S names. */
  private readonly namedAbove = new Set<string>();
  /** C1: the sequences at or below S naming each wanted activity. */
  private readonly namedBelow = new Map<string, number[]>();
  /** Every record at or below S that is carried, by sequence. */
  private readonly selected = new Map<number, Seen>();
  /** The evidence records at or below S: [sequence, eventId]. */
  private readonly belowEvidence: Array<readonly [number, string]> = [];
  /** K6: the open Bash call per key, and the due heap that ages them exactly as the fold does. */
  private readonly openCalls = new Map<string, BashCall>();
  private readonly due: DueEntry[] = [];
  private nextCallId = 1;
  private floorAt: number | null = null;          // F
  private journalFirst: number | null = null;     // J
  private journalLast: number | null = null;
  private journalStarted = false;
  private cutRecords = 0;
  private suffixOffset: number | null = null;
  private firstJournalAcceptedAt: string | null = null;
  private firstRetainedAcceptedAt: string | null = null;

  constructor(input: { checkpoint: DelegationCheckpointV1; ready: boolean; nowMs: number; floorMs: number; naming: DelegationRecordNaming }) {
    this.cp = input.checkpoint;
    this.ready = input.ready;
    this.cutoffMs = input.nowMs - input.floorMs;
    this.naming = input.naming;
    this.anchor = this.cp.appliedJournalSequence;
    const held = new Set<string>();
    for (const h of this.cp.pruningHolds) {
      held.add(h.journalId);
      if (h.reason === 'open-lease' || h.reason === 'open-lineage') {
        const s = this.k1.get(h.journalId) ?? new Set();
        s.add(h.reason);
        this.k1.set(h.journalId, s);
      }
      if (h.reason === 'identity-candidate') this.k2.add(h.ownerId);
    }
    const byId = new Map(this.cp.activities.map((a) => [a.activityId, a] as const));
    for (const a of this.cp.activities) if (a.executionState !== 'ended') this.k3.add(a.identityJournalId);
    for (const [encoded, id] of Object.entries(this.cp.activityIdsByNaturalKey)) {
      const a = byId.get(id);
      if (a !== undefined && a.sourceKind === 'workflow' && a.executionState !== 'ended') this.k4.add(encoded);
    }
    const windows: Array<[number, number]> = [];
    for (const l of this.cp.leases) {
      if (l.sourceKind !== 'raw') continue;
      const a = byId.get(l.activityId);
      // With the activity row: its call, Pre to Post. Without one (shown with an `unmeasured` creator): the lease's own first observation.
      const start = parseDelegationInstant(a === undefined ? l.firstObservedAt : a.openedAt);
      const end = a === undefined ? start : parseDelegationInstant(a.endedAt ?? a.openedAt);
      windows.push([start - DELEGATION_RAW_LEASE_WINDOW_MS, end + DELEGATION_RAW_LEASE_WINDOW_MS]);
    }
    this.k5 = mergeWindows(windows);
    const named = new Set<string>();
    for (const l of this.cp.leases) named.add(l.activityId);                                // released or not
    for (const n of this.cp.lineage) if (n.activityId !== null) named.add(n.activityId);   // open or closed
    for (const a of this.cp.activities) {
      if (a.executionState === 'ended' && !named.has(a.activityId) && !held.has(a.identityJournalId)) this.wanted.add(a.activityId);
    }
    for (const [encoded, id] of Object.entries(this.cp.activityIdsByNaturalKey)) if (this.wanted.has(id)) this.wantedByKey.set(encoded, id);
  }

  /** A line of the CURRENT carried file. Every one lies below the journal's first sequence, so at or below any S that cuts anything. */
  addCarried(record: DelegationJournalRecordV1, at: DelegationLinePosition): void {
    if (this.journalStarted) throw new Error('the carried file is fed before the journal');
    if (!this.ready) return;
    this.consider(record, at, 'carried', true);
  }

  /** A journal record, in file order. */
  add(record: DelegationJournalRecordV1, at: DelegationLinePosition): void {
    this.journalStarted = true;
    if (!this.ready) return;
    this.journalFirst ??= record.sequence;
    this.firstJournalAcceptedAt ??= record.acceptedAt;
    this.journalLast = record.sequence;
    if (this.floorAt === null && parseDelegationInstant(record.acceptedAt) > this.cutoffMs) this.floorAt = record.sequence;
    const below = this.floorAt === null && record.sequence <= this.anchor - 1;
    if (below) this.cutRecords++;
    else { this.suffixOffset ??= at.offset; this.firstRetainedAcceptedAt ??= record.acceptedAt; }
    this.consider(record, at, 'journal', below);
  }

  private consider(record: DelegationJournalRecordV1, at: DelegationLinePosition, source: 'carried' | 'journal', below: boolean): void {
    const seen: Seen = {
      sequence: record.sequence, journalId: record.journalId, offset: at.offset, length: at.length, source, below,
      evidence: record.entry.kind === 'evidence-accepted', reasons: new Set(),
    };
    for (const r of this.k1.get(record.journalId) ?? []) seen.reasons.add(r);
    const entry = record.entry;
    if (entry.kind === 'evidence-accepted') {
      const e = entry.event;
      if (below) this.belowEvidence.push([record.sequence, e.eventId] as const);
      const keys = this.naming.naturalKeysOf(e);
      for (const k of keys) {
        if (this.k2.has(k.encoded)) seen.reasons.add('identity-candidate');
        const id = this.wantedByKey.get(k.encoded);
        if (id === undefined) continue;
        if (!below) { this.namedAbove.add(id); continue; }
        const list = this.namedBelow.get(id);
        if (list === undefined) this.namedBelow.set(id, [record.sequence]); else list.push(record.sequence);
      }
      if (this.k3.has(record.journalId)) seen.reasons.add('active-identity');
      const runId = this.naming.workflowLaunchRunId(e);
      if (runId !== null && this.k4.has(encodeDelegationNaturalKey({ parentId: e.sessionId, parentIncarnation: e.parentIncarnation, sourceKind: 'workflow', upstreamId: runId }))) {
        seen.reasons.add('active-workflow-launch');
      }
      if (inWindows(this.k5, parseDelegationInstant(e.observedAt))) seen.reasons.add('raw-lease-window');
      if (seen.reasons.size > 0) this.select(seen);
      this.noteBash(seen, e, keys, parseDelegationInstant(record.acceptedAt));
      return;
    }
    if (seen.reasons.size > 0) this.select(seen);
  }

  private select(s: Seen): void {
    if (s.below) this.selected.set(s.sequence, s);
  }

  private isSelected(s: Seen): boolean { return s.reasons.size > 0; }

  /**
   * Whether a Bash call must be kept together: it has a record at or below S, and one of its records is selected or above S, or it is split
   * across the PREVIOUS cut (a line of the current carried file and a line of the journal, D-7012). The last arm keeps the state a crash
   * between this compaction's two renames leaves valid: the new carried file then sits beside the UNCUT journal, so a PreToolUse carried
   * last time must stay carried while its PostToolUse is still in that journal, even when this cut removes the PostToolUse.
   */
  private callCarries(call: BashCall): boolean {
    if (!call.members.some((m) => m.below)) return false;
    return call.members.some((m) => this.isSelected(m) || !m.below)
      || (call.members.some((m) => m.source === 'carried') && call.members.some((m) => m.source === 'journal'));
  }

  /** Carries every record of a call that is at or below S; a record no other rule selected carries it as `bash-pair`. */
  private carryCall(call: BashCall): void {
    for (const m of call.members) {
      if (!m.below) continue;
      if (m.reasons.size === 0) m.reasons.add('bash-pair');
      this.select(m);
    }
  }

  /**
   * K6, by the fold's own Bash rules (`foldBashCall`, `stepMappedBashFact`, `ageBashCalls`). Naming first, then ageing, as the fold does, so a
   * PostToolUse accepted at exactly the bound still closes its call. A call is carried WHOLE when any of its records is selected, or when it
   * straddles S (the plan's "a pair with Pre <= S < Post carries its Pre", and both of its partner rules). Two extensions, D-7011:
   *   - a call is every record on the key from its first listing-carrying PreToolUse up to and including the first PostToolUse (the plan's
   *     "next Bash record closes the pair", for a second PreToolUse, which the fold folds into the first call and compares by its listing);
   *   - a carried call that the fold AGED (no PostToolUse within `DELEGATION_BASH_PENDING_MS`) carries the record that aged it, so a recovery
   *     over the compacted set ages it at the same point and never pairs it with a later PostToolUse the original fold read as unpaired.
   */
  private noteBash(seen: Seen, e: DelegationEventEnvelopeV1, keys: readonly { encoded: string; sourceKind: DelegationActivitySourceKind }[], atMs: number): void {
    let closed: BashCall | null = null;
    const bashKey = (e.eventKind === 'PreToolUse' || e.eventKind === 'PostToolUse') && e.toolName === 'Bash'
      ? keys.find((k) => k.sourceKind === 'bash-worktree')?.encoded : undefined;
    if (bashKey !== undefined) {
      const open = this.openCalls.get(bashKey);
      if (open !== undefined) {
        open.members.push(seen);
        if (e.eventKind === 'PostToolUse') { this.openCalls.delete(bashKey); closed = open; }
      } else if (e.eventKind === 'PreToolUse' && this.naming.bashListingOf(e) !== undefined) {
        const call: BashCall = { id: this.nextCallId++, members: [seen], acceptedAtMs: atMs };
        this.openCalls.set(bashKey, call);
        duePush(this.due, [atMs + DELEGATION_BASH_PENDING_MS, bashKey, call.id]);
      }
    }
    // Ageing, AFTER naming, over every open call (any key), exactly as `ageBashCalls`.
    let ager = false;
    for (let top = this.due[0]; top !== undefined && top[0] <= atMs; top = this.due[0]) {
      duePop(this.due);
      const call = this.openCalls.get(top[1]);
      if (call === undefined || call.id !== top[2] || atMs - call.acceptedAtMs < DELEGATION_BASH_PENDING_MS) continue;
      this.openCalls.delete(top[1]);
      if (this.callCarries(call)) { this.carryCall(call); ager = true; }
    }
    if (ager && seen.below) {
      if (seen.reasons.size === 0) seen.reasons.add('bash-pair');
      this.select(seen);
    }
    if (closed !== null && this.callCarries(closed)) this.carryCall(closed);
  }

  /** The plan, given the file sizes measured by the retained reader (an omitted carried file is empty). */
  finish(journalBytes: number, carriedFile: { bytes: number; lines: number } = { bytes: 0, lines: 0 }): DelegationCompactionPlan {
    const none = (enabled: boolean): DelegationCompactionPlan => ({
      enabled, disabledReason: enabled ? null : DISABLED_REASON, cutThrough: 0, limitedBy: 'empty', suffixOffset: 0, carried: [],
      carriedEvidenceSequences: [], cutEvidenceEventIds: [], cutRecords: 0, cutBytes: 0, carriedBytes: 0, worthwhile: false, retirable: [],
      firstJournalAcceptedAt: this.firstJournalAcceptedAt, firstRetainedAcceptedAt: this.firstRetainedAcceptedAt, netShare: 0,
      currentCarriedBytes: carriedFile.bytes, currentCarriedLines: carriedFile.lines,
    });
    if (!this.ready) return none(false);
    const floorTerm = this.floorAt === null ? (this.journalLast ?? 0) : this.floorAt - 1;
    const anchorTerm = this.anchor - 1;
    const S = Math.min(floorTerm, anchorTerm);
    if (this.journalFirst === null || S < this.journalFirst || S <= 0) return none(true);
    // Calls still open at the end: the fold holds them pending (or as a mapped row's identity PreToolUse); kept whole by the same rule.
    for (const call of this.openCalls.values()) if (this.callCarries(call)) this.carryCall(call);
    const carried = [...this.selected.values()].sort((a, b) => a.sequence - b.sequence);
    const carriedSet = new Set(carried.map((s) => s.sequence));
    const order = (r: DelegationCarryReason): number => DELEGATION_CARRY_REASONS.indexOf(r);
    const lines: DelegationCarriedLine[] = carried.map((s) => ({
      offset: s.offset, length: s.length, sequence: s.sequence, journalId: s.journalId, source: s.source,
      reasons: [...s.reasons].sort((a, b) => order(a) - order(b)),
    }));
    const carriedBytes = lines.reduce((n, l) => n + l.length, 0);
    const fromJournal = lines.filter((l) => l.source === 'journal').reduce((n, l) => n + l.length, 0);
    const cutBytes = this.suffixOffset ?? journalBytes;
    return {
      enabled: true, disabledReason: null, cutThrough: S, limitedBy: floorTerm <= anchorTerm ? 'floor' : 'anchor', suffixOffset: cutBytes,
      carried: lines,
      carriedEvidenceSequences: carried.filter((s) => s.evidence).map((s) => s.sequence),
      cutEvidenceEventIds: this.belowEvidence.filter(([seq]) => !carriedSet.has(seq)).map(([, id]) => id),
      cutRecords: this.cutRecords, cutBytes, carriedBytes,
      worthwhile: cutBytes - fromJournal >= DELEGATION_COMPACTION_MIN_SHARE * journalBytes,
      retirable: this.retirable(carriedSet),
      firstJournalAcceptedAt: this.firstJournalAcceptedAt, firstRetainedAcceptedAt: this.firstRetainedAcceptedAt,
      netShare: journalBytes === 0 ? 0 : (cutBytes - fromJournal) / journalBytes,
      currentCarriedBytes: carriedFile.bytes, currentCarriedLines: carriedFile.lines,
    };
  }

  /**
   * C1 (D-7001, D-7021, D-7024): an ended activity that no lease or lineage row names, whose identity record no hold names, and that no
   * RETAINED record names (every naming record is at or below S and none is carried). A Workflow worker (`<runId>-<n>`, never named by a
   * record: the meta door opens it from its run's row) leaves only with its run, and a run never leaves while a worker of it stays, so the
   * next meta read cannot reopen a worker under the same ID.
   */
  private retirable(carried: ReadonlySet<number>): string[] {
    const free = (id: string): boolean =>
      this.wanted.has(id) && !this.namedAbove.has(id) && (this.namedBelow.get(id) ?? []).every((seq) => !carried.has(seq));
    const workflow = new Map<string, DelegationActivityRow>();
    const k = (parentId: string, inc: string, upstreamId: string): string => JSON.stringify([parentId, inc, upstreamId]);
    for (const a of this.cp.activities) if (a.sourceKind === 'workflow') workflow.set(k(a.parentId, a.parentIncarnation, a.upstreamId), a);
    const runOf = (a: DelegationActivityRow): DelegationActivityRow | undefined => {
      if (a.sourceKind !== 'workflow') return undefined;
      const dash = a.upstreamId.lastIndexOf('-');
      if (dash <= 0 || !isDelegationWorkerIndex(a.upstreamId.slice(dash + 1))) return undefined;
      return workflow.get(k(a.parentId, a.parentIncarnation, a.upstreamId.slice(0, dash)));
    };
    const workersOf = new Map<string, DelegationActivityRow[]>();
    for (const a of this.cp.activities) {
      const run = runOf(a);
      if (run === undefined) continue;
      const list = workersOf.get(run.activityId);
      if (list === undefined) workersOf.set(run.activityId, [a]); else list.push(a);
    }
    const out: string[] = [];
    for (const a of this.cp.activities) {
      if (runOf(a) !== undefined) continue;                        // a worker leaves with its run, below
      if (!free(a.activityId)) continue;
      const workers = workersOf.get(a.activityId) ?? [];
      if (!workers.every((w) => free(w.activityId))) continue;     // a kept worker keeps its run
      out.push(a.activityId, ...workers.map((w) => w.activityId));
    }
    return out.sort();
  }
}
