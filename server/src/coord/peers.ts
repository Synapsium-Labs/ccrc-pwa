import type { PeerDeliverable, SessionLifecycle } from '../../../shared/api.js';

/**
 * L1: pure — same stance and same coord-ring scan as `journalparse.ts`.
 *
 * D9: `deliverable` is decided from the STRUCTURAL rungs of `sweepMail`'s
 * own ladder — registry row measured, tmux verdict, pane pid, lifecycle —
 * and from nothing else. The TRANSIENT rungs (120 s cooldown, the
 * single-flight latch, an unanswered ask, quiet >= 60 s) stay in
 * `sweepMail`: those are lane state, and reporting them here would tell a
 * caller a BUSY peer is unreachable — the exact lie R2 forbids.
 * `sweepMail` is NOT refactored to call this; instead
 * `deliverability-parity.test.ts` drives both over one fixture table
 * (the `_session_state`/`sessionLifecycle` two-implementations-one-fixture
 * precedent): single definition of the DECISION, zero edits to the most
 * load-bearing loop on the box.
 *
 * The probe is the CONSUMER'S declaration of what it reads (the same rule
 * as `claims.ts`'s `LivenessProbe`): three registry words mirroring
 * `readRegistryMeasured`'s three-way answer per row (absent = never
 * listed, or proven gone; unmeasurable = listed but a field's bytes never
 * came back — `measuredIdentity(rec) === null`), three tmux words mirroring
 * `SessionVerdict['verdict']` (exec.ts:81-84; the parity fixture types one
 * field with both, so the mirrors cannot drift silently).
 */
export interface PeerProbe {
  readonly registry: 'measured' | 'absent' | 'unmeasurable';
  readonly tmux: 'live' | 'gone' | 'unknown';
  readonly panePid: number | null;
  readonly lifecycle: SessionLifecycle;
}

/** Rung 4's total table — `Record<SessionLifecycle, …>` so a ninth
 *  lifecycle member is a TS2739 here, forcing a decision instead of a
 *  silent default. The three dead words answer no; `unmeasurable` answers
 *  unknown, because a session nobody managed to look at is not a session
 *  proven gone. */
const LIFECYCLE_RUNG: Record<SessionLifecycle, 'pass' | 'no' | 'unknown'> = {
  running: 'pass', unsupervised: 'pass', unclaimed: 'pass', restarting: 'pass',
  stopped: 'no', orphan: 'no', 'never-started': 'no',
  unmeasurable: 'unknown',
};

/**
 * The ladder, IN `sweepMail`'s ORDER — the first rung that cannot pass
 * answers, exactly as the sweep's own `continue`s fire (registry before
 * tmux before pid; watch.ts:1991, :2069, :2087). Three answer shapes,
 * never collapsed: 'yes', 'no:<reason>' (a measured refusal, reason
 * attached), 'unknown' (could not measure — NOT 'no', per D9).
 */
export function peerDeliverable(p: PeerProbe): PeerDeliverable {
  if (p.registry === 'absent') return 'no:not-in-registry';
  if (p.registry === 'unmeasurable') return 'unknown';
  if (p.tmux === 'gone') return 'no:session-gone';
  if (p.tmux === 'unknown') return 'unknown';
  if (p.panePid === null) return 'no:no-pane';
  const rung = LIFECYCLE_RUNG[p.lifecycle];
  if (rung === 'no') return `no:${p.lifecycle}`;
  return rung === 'unknown' ? 'unknown' : 'yes';
}

/** Which lifecycles CONTRADICT an archive stamp — total for the same
 *  TS2739 reason as above. The four live-ish words contradict (`.archived`
 *  is cleared only by ws-restore and _reg_purge, never by start/ensure, so
 *  a heartbeating row stamped merged:#N is the measured lie D9 names);
 *  `restarting` is in — a supervisor actively cycling an "archived" row is
 *  the same contradiction one heartbeat early. `unmeasurable` is OUT:
 *  doubt is not evidence, in either direction. */
const ARCHIVE_CONTRADICTS: Record<SessionLifecycle, boolean> = {
  running: true, unsupervised: true, unclaimed: true, restarting: true,
  stopped: false, orphan: false, 'never-started': false, unmeasurable: false,
};

/**
 * D9: the route does NOT filter on `.archived` and there is no boolean
 * called `addressable` — `archivedAt` is reported verbatim and decides
 * nothing. This predicate NAMES the contradiction (`archivedStale` on
 * `PeerSummary`, part B) and the same answer feeds
 * `divergence.archived-but-live` — the four measured rows go from silently
 * false to loudly flagged with zero ccd semantic change.
 */
export function archiveContradicted(
  archivedAt: number | null,
  lifecycle: SessionLifecycle,
): boolean {
  return archivedAt !== null && ARCHIVE_CONTRADICTS[lifecycle];
}
