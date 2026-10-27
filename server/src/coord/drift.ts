// THE DRIFT DECIDER (coordinator-durability tail spec §4.1, §4.2; `drift-decider-pure` (D-5921)). L1: pure and
// clock-free (the clock is an argument), `fs`-free, fastify-free and timer-free. It imports L0, `askwindow.ts` and
// `deadCoordinator.ts` alone — NEVER `coord/reclaim.ts`, which imports IO; a ring is decided by imports, and
// `drift-findings.test.ts` scans this file's. The watcher (L4) gathers the inputs below — the store's `drift*` reads
// and the reclaim ladder's verdict per claimant (`measureClaimant`, carried here in the structural
// `ClaimantReading`, so there is no second liveness vocabulary) — and records the output; it decides nothing.
//
// THE RECONCILER NEVER ACTS. This file answers "what is out of step" and nothing else: no door, no mail, no close.
import { ACTIVE_RUN_STATES, DRIFT_KIND_MAP, type DriftFinding, type DriftKind } from '../../../shared/api.js';
import { ASK_ANSWERING_MAX_MS, askNotifyAt } from '../askwindow.js';
import type { ClaimantReading } from '../deadCoordinator.js';

// ── the thresholds (spec §4.2, each the issue's figure) ──────────────────────────────────────────────────────

/** An active run with no act row for longer than this is `run-quiet`. */
export const RUN_QUIET_MS = 72 * 3_600_000;
/** A delivery parked, or held behind a gate, for longer than this is `mail-parked` / `mail-held`. */
export const MAIL_DRIFT_MS = 3_600_000;
/** A run at `awaiting-review` for longer than this, with no claimant mail naming it since, is `review-waiting`. */
export const REVIEW_WAITING_MS = 24 * 3_600_000;
/** The age past which the lane pushes a finding once (DT2 reads it; spec §4.4). */
export const DRIFT_PUSH_AGE_MS = 24 * 3_600_000;
/** Two periods of the watcher's 10 s ask sweep, written here because an L1 file cannot import the watcher. */
export const DRIFT_ASK_MARGIN_MS = 20_000;

// ── the inputs: plain rows (the store's `drift*` reads implement the row shapes) ─────────────────────────────

/** A non-terminal run. `lastActAt` is the `at` of its newest ACT row — a `run_events` row that is neither a stall
 *  observation (`parseStallDetail` reads it) nor caused by `'operator'` (the lanes speak as the operator) — or null
 *  when it has none; the decider then ages it from `openedAt`. */
export interface DriftRunRow {
  readonly id: number; readonly program: string; readonly state: string; readonly claimedBy: string | null;
  readonly openedAt: number; readonly lastActAt: number | null;
}
/** An outstanding delivery with its gate and D1's park columns (#853). `state` is the row's own word. */
export interface DriftDeliveryRow {
  readonly id: number; readonly toId: string; readonly state: string; readonly lastGate: string | null;
  readonly gateSince: number | null; readonly parkedAt: number | null; readonly parkEscalatedAt: number | null;
}
/** A run at `awaiting-review`: when it entered that state (its `run_events` transition; null when no row says) and
 *  the `at` of its claimant's newest mail naming it (null: none). */
export interface DriftReviewRow {
  readonly id: number; readonly program: string; readonly claimedBy: string | null;
  readonly enteredAt: number | null; readonly lastClaimantMailAt: number | null;
}
/** A `held` or `answering` asks row. */
export interface DriftAskRow { readonly id: number; readonly at: number; readonly childId: string; readonly state: string }
/** A worker's child mark beside the series' parent (`childParentOf`) and the marked run's `claimedBy`. */
export interface DriftWorkerRow {
  readonly sessionId: string; readonly markRunId: number; readonly parentId: string | null;
  readonly runClaimedBy: string | null;
}
/** An approval from the boot snapshot of `held` rows (spec §5.3) whose child the watcher MEASURED still painting a
 *  permission prompt with no `heldApprovals` entry covering it. Never a `released` row read from the store. */
export interface DriftApprovalRow { readonly id: number; readonly childId: string; readonly notifyAt: number }

export interface DriftInput {
  readonly runs: readonly DriftRunRow[];
  /** The reclaim ladder's verdict per claimant id. A claimant with no entry was not measured: no finding. */
  readonly claimants: ReadonlyMap<string, ClaimantReading>;
  readonly deliveries: readonly DriftDeliveryRow[];
  readonly reviews: readonly DriftReviewRow[];
  readonly asks: readonly DriftAskRow[];
  readonly workers: readonly DriftWorkerRow[];
  readonly approvals: readonly DriftApprovalRow[];
}

/** One stored `drift_findings` row (D-5922): the finding plus the passes that saw it and the push's once-only stamps.
 *  `clearedAt` null: open. `pushedAt`/`pushedVia` are both null or both set; `shadowAt` is the unarmed lane's own. */
export interface DriftFindingRow extends DriftFinding {
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly clearedAt: number | null;
  readonly pushedAt: number | null;
  readonly pushedVia: 'item' | 'summary' | null;
  readonly shadowAt: number | null;
}

// ── the decider ──────────────────────────────────────────────────────────────────────────────────────────────

const ACTIVE: ReadonlySet<string> = new Set(ACTIVE_RUN_STATES);

function finding(
  kind: DriftKind, id: string, subject: Record<string, string | number>, detail: string, factAt: number | null,
  target: { runId?: number; sessionId?: string },
): DriftFinding {
  const isRun = DRIFT_KIND_MAP[kind] === 'run';
  return {
    key: `${kind}:${id}`, kind, subject: JSON.stringify(subject), detail, factAt,
    runId: isRun ? (target.runId ?? null) : null,
    sessionId: isRun ? null : (target.sessionId ?? null),
  };
}

const hours = (ms: number): string => `${Math.floor(ms / 3_600_000)} h`;

/** Every finding standing at `now`, grouped in the map's kind order. The same input answers the same keys. */
export function driftFindings(input: DriftInput, now: number): DriftFinding[] {
  const out: DriftFinding[] = [];

  // run-quiet: ACTIVE runs only. `planned` waits by design; `awaiting-review` is review-waiting's alone.
  for (const r of input.runs) {
    if (!ACTIVE.has(r.state)) continue;
    const since = r.lastActAt ?? r.openedAt;
    if (now - since <= RUN_QUIET_MS) continue;
    out.push(finding('run-quiet', String(r.id), { runId: r.id, program: r.program },
      `run ${r.id} (${r.state}) has had no act for ${hours(now - since)}`, since, { runId: r.id }));
  }

  // claimant-gone: one per (programme, claimant), on a `dead` verdict only — never `alive`, never `unmeasurable`.
  const newest = new Map<string, number>();
  for (const r of input.runs) newest.set(r.program, Math.max(newest.get(r.program) ?? 0, r.id));
  const gone = new Map<string, { program: string; claimant: string; cause: string }>();
  for (const r of input.runs) {
    if (r.claimedBy === null) continue;
    const reading = input.claimants.get(r.claimedBy);
    if (reading?.state !== 'dead') continue;
    gone.set(`${r.program}:${r.claimedBy}`, { program: r.program, claimant: r.claimedBy, cause: reading.cause });
  }
  for (const [id, g] of gone) {
    const runId = newest.get(g.program) as number;
    out.push(finding('claimant-gone', id, { program: g.program, claimant: g.claimant, runId },
      `the claimant ${g.claimant} of ${g.program} measures dead (${g.cause})`, null, { runId }));
  }

  // mail: a parked row is mail-parked and never also mail-held; terminal rows are never a finding.
  for (const d of input.deliveries) {
    if (d.state !== 'queued') continue;
    if (d.parkedAt !== null) {
      if (now - d.parkedAt <= MAIL_DRIFT_MS) continue;
      out.push(finding('mail-parked', String(d.id), { deliveryId: d.id, sessionId: d.toId },
        `delivery ${d.id} to ${d.toId} parked for ${hours(now - d.parkedAt)}`, d.parkedAt, { sessionId: d.toId }));
      continue;
    }
    if (d.lastGate === null || d.gateSince === null || now - d.gateSince <= MAIL_DRIFT_MS) continue;
    out.push(finding('mail-held', String(d.id), { deliveryId: d.id, sessionId: d.toId },
      `delivery ${d.id} to ${d.toId} held by ${d.lastGate} for ${hours(now - d.gateSince)}`, d.gateSince,
      { sessionId: d.toId }));
  }

  // parent-mismatch: names the WORKER, not the run.
  for (const w of input.workers) {
    if (w.parentId === null || w.parentId === w.runClaimedBy) continue;
    out.push(finding('parent-mismatch', w.sessionId,
      { sessionId: w.sessionId, runId: w.markRunId },
      `worker ${w.sessionId} is marked for run ${w.markRunId} (claimed by ${w.runClaimedBy ?? 'nobody'}) but its parent reads ${w.parentId}`,
      null, { sessionId: w.sessionId }));
  }

  // review-waiting: from the transition into awaiting-review; a claimant mail naming the run after it clears it.
  for (const r of input.reviews) {
    if (r.enteredAt === null) continue;
    if (now - r.enteredAt <= REVIEW_WAITING_MS) continue;
    if (r.lastClaimantMailAt !== null && r.lastClaimantMailAt >= r.enteredAt) continue;
    out.push(finding('review-waiting', String(r.id), { runId: r.id, program: r.program },
      `run ${r.id} has waited for review for ${hours(now - r.enteredAt)}`, r.enteredAt, { runId: r.id }));
  }

  // question-orphaned: a held ask past its notify time plus the margin; an answering one past that plus the
  // answering bound; an approval from the boot snapshot still painted past its notifyAt plus the margin.
  for (const a of input.asks) {
    const due = askNotifyAt(a.at) + DRIFT_ASK_MARGIN_MS + (a.state === 'answering' ? ASK_ANSWERING_MAX_MS : 0);
    if (a.state !== 'held' && a.state !== 'answering') continue;
    if (now <= due) continue;
    out.push(finding('question-orphaned', `ask:${a.id}`, { askId: a.id, sessionId: a.childId },
      `ask ${a.id} from ${a.childId} is ${a.state} past its notify time`, a.at, { sessionId: a.childId }));
  }
  for (const p of input.approvals) {
    if (now <= p.notifyAt + DRIFT_ASK_MARGIN_MS) continue;
    out.push(finding('question-orphaned', `approval:${p.id}`, { approvalId: p.id, sessionId: p.childId },
      `approval ${p.id} from ${p.childId} is still painted past its notify time`, p.notifyAt,
      { sessionId: p.childId }));
  }

  return out;
}
