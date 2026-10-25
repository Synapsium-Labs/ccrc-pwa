import type { ChildReclaimSweepInput, ChildReclaimSweepVerdict } from '../childReclaimSweep.js';

/**
 * The kept reason (D-TBD-kept-reason-visible). L1: pure.
 *
 * `review-report-live` and `siblings-open` are `ordinary` skip words: the chip's own rows are meant to say them, and
 * the banner and the feed do not. So a child kept by a stuck reviewed run, or by a stale sibling run, had no row
 * naming the run, and finding it took a manual join of the registry against the coordination database. This reads the
 * sweep input beside its verdict and names the run and its age; the feed row's sentence is `keptReasonBody`, and
 * `KeptReasonLimiter` paces the row to one per child per day. It decides nothing about eligibility.
 */
export const KEPT_REASON_FEED_MS = 24 * 3_600_000;

interface AgedRun { readonly id: number; readonly ageMs: number }

export type KeptReason =
  | { readonly kind: 'review'; readonly reviewedRunId: number | null; readonly ageMs: number | null }
  | { readonly kind: 'siblings'; readonly blocking: readonly AgedRun[]; readonly stale: readonly AgedRun[] };

const aged = (nowMs: number) => (r: { readonly id: number; readonly openedAt: number }): AgedRun =>
  ({ id: r.id, ageMs: nowMs - r.openedAt });

/** The reason this child is kept, or the stale siblings it ignores, or `null` when there is nothing to say. */
export function keptReasonOf(i: ChildReclaimSweepInput, v: ChildReclaimSweepVerdict): KeptReason | null {
  if (i.child.kind !== 'child') return null;
  if (!v.eligible && v.why === 'review-report-live' && i.reviewedRun.kind === 'run') {
    const r = i.reviewedRun;
    return { kind: 'review', reviewedRunId: r.id ?? null, ageMs: r.openedAt === undefined ? null : i.nowMs - r.openedAt };
  }
  if (!i.siblings.ok) return null;
  // Blocking runs are named only when they are what kept the child: an earlier word answers ahead of `siblings-open`.
  const blocking = (!v.eligible && v.why === 'siblings-open' ? i.siblings.blocking ?? [] : []).map(aged(i.nowMs));
  const stale = (i.siblings.stale ?? []).map(aged(i.nowMs));
  if (blocking.length === 0 && stale.length === 0) return null;
  return { kind: 'siblings', blocking, stale };
}

function ageText(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

const ageOf = (r: AgedRun, verb: string): string => (Number.isFinite(r.ageMs) ? ` (${verb} ${ageText(r.ageMs)})` : '');
const runText = (r: AgedRun): string => `run #${r.id}${ageOf(r, 'open')}`;

/** The feed row's body. Names runs by id and age only: no workspace paths, no claimant. */
export function keptReasonBody(sessionId: string, runId: number, reason: KeptReason): string {
  const who = `${sessionId}, child of run #${runId}`;
  if (reason.kind === 'review') {
    const run = reason.reviewedRunId === null ? 'the run it reviewed' : `run #${reason.reviewedRunId}`;
    const age = reason.ageMs === null ? '' : ` (open ${ageText(reason.ageMs)})`;
    return `${who}: this review workspace is kept while ${run}${age} is not closed. Closing or abandoning that run releases it.`;
  }
  const parts: string[] = [];
  if (reason.blocking.length > 0) {
    parts.push(`this workspace is kept while ${reason.blocking.map(runText).join(', ')} still name${reason.blocking.length === 1 ? 's' : ''} it.`);
  }
  if (reason.stale.length > 0) {
    parts.push(`${reason.stale.map((r) => `stale sibling run #${r.id}${ageOf(r, 'planned')}, never dispatched, its coordinator archived or gone`).join(', ')} ${reason.stale.length === 1 ? 'is' : 'are'} ignored; ccrc does not close it, abandon it to tidy up.`);
  }
  return `${who}: ${parts.join(' ')}`;
}

/** One row per child, kind and run per day. In memory only: a restart says each reason once more. */
export class KeptReasonLimiter {
  private readonly at = new Map<string, { readonly sessionId: string; readonly at: number }>();

  /** True when a row for this child, run and kind is due, and records it as written at `nowMs`. */
  due(sessionId: string, runId: number, kind: KeptReason['kind'], nowMs: number): boolean {
    const key = `${sessionId}\u0000${runId}\u0000${kind}`;
    const last = this.at.get(key);
    if (last !== undefined && !(nowMs - last.at >= KEPT_REASON_FEED_MS)) return false;
    this.at.set(key, { sessionId, at: nowMs });
    return true;
  }

  /** Forgets every child the registry no longer lists. */
  prune(listed: ReadonlySet<string>): void {
    for (const [key, v] of [...this.at]) if (!listed.has(v.sessionId)) this.at.delete(key);
  }
}
