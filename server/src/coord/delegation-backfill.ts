// Session helpers S2 (D-8874; spec docs/superpowers/specs/2026-11-19-session-helpers-design.md §7.2, Table 10, Table 13's S2 row;
// plan docs/superpowers/plans/2026-11-20-broker-helper-ends.md, Task S2): the ONE-TIME PASS over the broker's old open records,
// decided.
//
// L1 policy, context C5 Coordination: pure, no fs, no clock, no SQLite. It is the sibling of `delegation-end-basis.ts` (S1), which owns
// how a measured end is written; this module owns the one close that has no measured end. The checkpoint builder
// (`delegation-checkpoint.ts`, growth-frozen under D-8641) keeps two thin calls into it (`closeByBackfill`, `reopenBackfill`), and the
// durability layer runs them inside `commitLocked`, the way D-6268's zero-delta retire runs. Every rule is written here once:
//   - `backfillVerdict`: one record's answer under the five conditions of §7.2. It qualifies only when it is OPEN (`active`; `unknown`
//     has no writer and is left alone), has been quiet for 24 hours, and passes the positive check: a bash-worktree record by its
//     quiet alone (a Bash call's Post arrives within its tool timeout); an agent or workflow record when its parent's incarnation is
//     measured and is not the record's, or its parent is measured absent from the registry (the adoption decider's own death
//     evidence), or it has been quiet for 7 days. A `compact` or a `resume` is no evidence (spec Table 3): it keeps the incarnation.
//   - `planDelegationBackfill`: the ids the pass closes and the dry run's report, decided on one checkpoint at one instant. Once a pass
//     has run, the ids it recorded bound every later pass (review 2900 F2: a re-run after a rebuild from the journal alone closes only
//     those ids).
//   - `backfillClosed` / `backfillReopened`: the pass's rows and the undo's. The pass writes `ended`, `endedAt` null and the basis, and
//     nothing else, so the undo gives back an untouched record byte for byte; one an event touched since keeps its `lastEventAt`.
//   - `workerUnderRun`: review 3026 F3. A Workflow worker the meta door opens from its run's row takes the run's state and basis, not
//     only its `endedAt`, so a worker of a closed run opens closed by the same pass.
//   - The pass's list, `DELEGATION_BACKFILL_FILE`, and its codec.
//   - The route's two decisions: a parent's fact from what the route measured (`backfillParentOf`) and the POST's body
//     (`parseBackfillRequest`). The route (`delegationBackfillRoutes.ts`, L4) measures and acts, and decides nothing.
import { DELEGATION_ACTIVITY_SOURCE_KINDS, type DelegationActivitySourceKind } from '../../../shared/api.js';
import {
  DELEGATION_BACKFILL_AGE_BANDS,
  DELEGATION_BACKFILL_WORDS,
  isDelegationBackfillAct,
  type DelegationBackfillAgeBand,
  type DelegationBackfillReport,
} from '../../../shared/delegationBackfill.js';
import {
  canonicalDelegationJson,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  parseDelegationInstant,
  type DelegationActivityRow,
  type DelegationCheckpointV1,
} from './delegation-model.js';

const DAY_MS = 86_400_000;
/** Condition: quiet this long, measured from `lastEventAt` (spec §7.2: the longest measured gap between one agent's events is 10.5 h). */
export const DELEGATION_BACKFILL_QUIET_MS = DAY_MS;
/** The positive check's quiet arm: more than eleven times the longest measured run of an ended agent record (14.8 h). */
export const DELEGATION_BACKFILL_PROVEN_QUIET_MS = 7 * DAY_MS;
/** The pass's list (review 2900 F2): a file beside the journal and the checkpoint in the delegation directory. A rebuild from the
 *  journal alone rewrites the checkpoint and leaves this file, so a re-run reads the ids the first pass closed. Written before the
 *  pass's commit and never removed by the undo. */
export const DELEGATION_BACKFILL_FILE = 'delegation-backfill.json';

/** What the registry says of a record's parent, measured by the caller: absent from a listing that read, present at a measured
 *  incarnation, or anything else (unmeasured). */
export type DelegationBackfillParent = { kind: 'absent' } | { kind: 'measured'; incarnation: string } | { kind: 'unmeasured' };

/** A parent's registry fact from the route's two measurements: the registry listing's ids (null when it did not list), and the
 *  parent's incarnation read twice (`delegationLeaseDoor.ts#incarnationOf`, asked only of a listed id). A listed parent whose incarnation
 *  did not read is unmeasured, never absent; an unlisted one is absent only from a listing that read. */
export function backfillParentOf(listed: ReadonlySet<string> | null, id: string,
  incarnation: { kind: 'measured'; incarnation: string } | { kind: 'unmeasured' } | null): DelegationBackfillParent {
  if (listed === null) return { kind: 'unmeasured' };
  if (!listed.has(id)) return { kind: 'absent' };
  return incarnation?.kind === 'measured' ? { kind: 'measured', incarnation: incarnation.incarnation } : { kind: 'unmeasured' };
}

/** The POST's body: exactly `{act: 'pass', closes: <a non-negative safe integer>}` or `{act: 'undo'}`; anything else is null. */
export type DelegationBackfillRequest = { act: 'pass'; closes: number } | { act: 'undo' };
export function parseBackfillRequest(body: unknown): DelegationBackfillRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o).sort().join();
  if (!isDelegationBackfillAct(o['act'])) return null;
  if (o['act'] === 'undo') return keys === 'act' ? { act: 'undo' } : null;
  const closes = o['closes'];
  return keys === 'act,closes' && typeof closes === 'number' && Number.isSafeInteger(closes) && closes >= 0 ? { act: 'pass', closes } : null;
}

/** One record's answer: not open (`ended`), quiet for less than 24 hours (`young`), quiet but its positive check failed (`unchecked`),
 *  or closed by the pass (`close`). */
export type DelegationBackfillVerdict = 'ended' | 'young' | 'unchecked' | 'close';

export function backfillVerdict(a: DelegationActivityRow, nowMs: number, parent: DelegationBackfillParent | undefined): DelegationBackfillVerdict {
  if (a.executionState !== 'active') return 'ended';
  const quiet = nowMs - parseDelegationInstant(a.lastEventAt);
  if (quiet < DELEGATION_BACKFILL_QUIET_MS) return 'young';
  if (a.sourceKind === 'bash-worktree' || quiet >= DELEGATION_BACKFILL_PROVEN_QUIET_MS) return 'close';
  if (parent?.kind === 'absent') return 'close';
  return parent?.kind === 'measured' && parent.incarnation !== a.parentIncarnation ? 'close' : 'unchecked';
}

/** The time bound on the dry run's read of the retained journal for review 3026 F4's count (the coordinator's condition). The read runs
 *  OUTSIDE the applier's queue, so nothing the watcher applies waits for it; the bound caps what it costs the server's event loop. Measured
 *  on this box on a fixture of the live journal's shape: about 47,000 records a second, so 120 seconds reads several million. Past the bound
 *  the count is unmeasured (`cut`), never a partial number. */
export const DELEGATION_BACKFILL_SCAN_MS = 120_000;

/** The parents whose registry facts decide a verdict: those of the open agent and workflow records quiet for 24 hours and less than
 *  7 days. Distinct, sorted. Any other record's verdict reads no parent, so the caller reads no registry row for it. */
export function backfillParentsToRead(activities: readonly DelegationActivityRow[], nowMs: number): string[] {
  const out = new Set<string>();
  for (const a of activities) {
    if (a.executionState !== 'active' || a.sourceKind === 'bash-worktree') continue;
    const quiet = nowMs - parseDelegationInstant(a.lastEventAt);
    if (quiet >= DELEGATION_BACKFILL_QUIET_MS && quiet < DELEGATION_BACKFILL_PROVEN_QUIET_MS) out.add(a.parentId);
  }
  return [...out].sort();
}

/** The dry run's age bands, by how long a record has been quiet (slug age-bands-by-quiet). The first edge IS the positive check's seven
 *  days of quiet (the coordinator's ruling on the seven-day census), so a record past it is one the check passes on quiet alone, and one
 *  in `days1to7` passed by its parent's measurement (or is a bash-worktree record); the second edge is a month. */
const DELEGATION_BACKFILL_BAND_MONTH_MS = 30 * DAY_MS;
const bandOf = (a: DelegationActivityRow, nowMs: number): DelegationBackfillAgeBand => {
  const quiet = nowMs - parseDelegationInstant(a.lastEventAt);
  return quiet < DELEGATION_BACKFILL_PROVEN_QUIET_MS ? 'days1to7' : quiet < DELEGATION_BACKFILL_BAND_MONTH_MS ? 'days7to30' : 'days30plus';
};
const zeroBands = (): Record<DelegationBackfillAgeBand, number> =>
  Object.fromEntries(DELEGATION_BACKFILL_AGE_BANDS.map((b) => [b, 0])) as Record<DelegationBackfillAgeBand, number>;

export interface DelegationBackfillInput {
  checkpoint: Pick<DelegationCheckpointV1, 'activities' | 'leases' | 'lineage'>;
  nowMs: number;
  parents: ReadonlyMap<string, DelegationBackfillParent>;
  /** The ids the first pass recorded, or null before any pass. */
  listed: ReadonlySet<string> | null;
  /** The natural keys (encoded) of the Agent final task notifications the journal retains, with whether the read was whole (`false`:
   *  cut at `DELEGATION_BACKFILL_SCAN_MS`); null when the journal was not read (the pass). */
  reported: { keys: ReadonlySet<string>; complete: boolean } | null;
}
export interface DelegationBackfillPlan {
  /** The ids the pass closes, sorted. */
  close: readonly string[];
  report: DelegationBackfillReport;
}

/** The pass's decision and the dry run's report, on one checkpoint at one instant. Writes nothing. */
export function planDelegationBackfill(input: DelegationBackfillInput): DelegationBackfillPlan {
  const { checkpoint: cp, nowMs, listed, reported } = input;
  const named = new Set<string>();
  for (const l of cp.leases) named.add(l.activityId);                                  // released or not, as the retire doors read them
  for (const n of cp.lineage) if (n.activityId !== null) named.add(n.activityId);     // open or closed
  const byKind = Object.fromEntries(DELEGATION_ACTIVITY_SOURCE_KINDS.map((k) => [k, zeroBands()])) as Record<DelegationActivitySourceKind, Record<DelegationBackfillAgeBand, number>>;
  const close: string[] = [];
  let failedCheck = 0, young = 0, unlisted = 0, closed = 0, namedCount = 0, reportedFirst = 0;
  for (const a of cp.activities) {
    if (a.endBasis === 'backfill-unmeasured') closed++;
    if (reported !== null && a.sourceKind === 'agent' && (a.executionState === 'active' || a.endBasis === 'backfill-unmeasured')
      && reported.keys.has(encodeDelegationNaturalKey(a))) reportedFirst++;
    const verdict = backfillVerdict(a, nowMs, input.parents.get(a.parentId));
    if (verdict === 'young') young++;
    else if (verdict === 'unchecked') failedCheck++;
    else if (verdict === 'close' && listed !== null && !listed.has(a.activityId)) unlisted++;
    else if (verdict === 'close') {
      close.push(a.activityId);
      byKind[a.sourceKind][bandOf(a, nowMs)]++;
      if (named.has(a.activityId)) namedCount++;
    }
  }
  close.sort();
  return {
    close,
    report: {
      words: DELEGATION_BACKFILL_WORDS, asOf: formatDelegationInstant(nowMs), mode: listed === null ? 'first' : 'listed',
      listed: listed === null ? null : listed.size, closes: close.length, byKind, named: namedCount, failedCheck, young, unlisted, closed,
      reportedFirst: reported !== null && reported.complete ? reportedFirst : null,
      reportedScan: reported === null ? 'skipped' : reported.complete ? 'complete' : 'cut',
    },
  };
}

/** A record closed by the pass: `ended`, no end time, the basis. Nothing else changes, so `backfillReopened` gives it back. */
const closedByBackfill = (a: DelegationActivityRow): DelegationActivityRow => ({ ...a, executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' });

/** The pass's rows: each listed id whose record is still open, closed. An id with no row, or a record no longer open, is left. */
export function backfillClosed(rows: ReadonlyMap<string, DelegationActivityRow>, ids: readonly string[]): DelegationActivityRow[] {
  const out: DelegationActivityRow[] = [];
  for (const id of ids) {
    const a = rows.get(id);
    if (a !== undefined && a.executionState === 'active') out.push(closedByBackfill(a));
  }
  return out;
}

/** The undo's rows: every record whose basis is the backfill's, which only the pass writes, open again. The pass closed only `active`
 *  records and its close left `endedAt` null, so the reopened record is the one the pass closed; its `lastEventAt` is whatever an event
 *  gave it since. */
export function backfillReopened(rows: ReadonlyMap<string, DelegationActivityRow>): DelegationActivityRow[] {
  const out: DelegationActivityRow[] = [];
  for (const a of rows.values()) {
    if (a.endBasis !== 'backfill-unmeasured') continue;
    const { endBasis: _closed, ...open } = a;
    out.push({ ...open, executionState: 'active', endedAt: null });
  }
  return out;
}

/** Review 3026 F3: a worker the meta door opened from its run's row, under the run's state and basis. A run the pass closed has no
 *  `endedAt`, so the opening alone would make the worker `active` under a closed run; it is closed by the same pass instead. */
export function workerUnderRun(worker: DelegationActivityRow, run: DelegationActivityRow): DelegationActivityRow {
  return run.endBasis === 'backfill-unmeasured' && worker.executionState === 'active' ? closedByBackfill(worker) : worker;
}

/** The pass's list, as it is written: canonical JSON of `{v: 1, at, ids}`, ids sorted. */
export function encodeBackfillList(at: string, ids: readonly string[]): Uint8Array {
  return new TextEncoder().encode(`${canonicalDelegationJson({ v: 1, at, ids: [...ids].sort() })}\n`);
}

/** The pass's list read back: its ids, or why it cannot be used. A list that does not read is never an empty list: an empty one would
 *  let a re-run close nothing, and an absent one would let it choose again. */
export function decodeBackfillList(bytes: Uint8Array): { ok: true; ids: ReadonlySet<string> } | { ok: false; detail: string } {
  let v: unknown;
  try { v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return { ok: false, detail: 'the list is not UTF-8 JSON' }; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, detail: 'the list is not a JSON object' };
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== 'at,ids,v' || o['v'] !== 1 || typeof o['at'] !== 'string') return { ok: false, detail: 'the list is not {v: 1, at, ids}' };
  const ids = o['ids'];
  if (!Array.isArray(ids) || !ids.every((x): x is string => typeof x === 'string' && x !== '')) return { ok: false, detail: 'the list\'s ids are not non-empty strings' };
  return { ok: true, ids: new Set(ids) };
}
