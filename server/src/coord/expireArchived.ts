import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { Presence } from '../presence.js';
import type { NotifyLog } from '../notifylog.js';
import { CCD_ARGV, EXPIRE_CAP, capSupported, sweepDec, verbSupported } from '../ccdargv.js';
import type { CoordStore } from './store.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import {
  EXPIRE_LANE_LIVE_MARKER, EXPIRE_TOKEN_KIND, archivedExpiryStoreSkip, parseExpireAudit, parseExpireResult, reviewKeeps,
  type ArchivedExpiryOutcome, type ExpireAuditRead, type ExpiryStoreRead,
} from '../archivedExpiry.js';

/**
 * THE EXPIRY LANE'S ONE EXECUTOR (workspace lifecycle spec 2026-09-24 §5.3, wave 3b): `ws-audit --expire`, then
 * `ws-expire` with THAT audit's token — child reclamation's `reclaimChild` shape, in a file of its own so nothing of
 * the child lane's vocabulary, feed rows or attention list is shared. Its one caller is `watch.ts`'s
 * `sweepArchivedExpiry`, on the session's `KeyedQueue`.
 *
 * It re-reads everything it acts on, in this order, and every doubt is "not this time":
 *   1. the box must PROVE it has the verb — `capSupported(state, EXPIRE_CAP)`, which refuses on no evidence; never
 *      `verbSupported`, which permits on an absent list;
 *   2. ONE registry listing: `reclaim-paused` — the fleet's one cleanup switch — stops it, and so does a listing that
 *      could not be taken;
 *   3. the STORE, re-read for this row (`readExpiryStore`, the destructive-grade reads child reclamation's executor
 *      takes at its act): a run that names it as worker or claimant, a review that still needs it, or a store that
 *      cannot say, defers it. The lane read these when its pass began; a run can bind the row since, and ccd cannot
 *      see the coordination store, so this read is the only guard of the run conjuncts at the act;
 *   4. a person looking at the session defers it — WITHOUT a ceiling (spec §5.3: "Presence defers WITHOUT a
 *      ceiling");
 *   5. the audit, and its `expiresAt` through the one reader: a document without it is NO EVIDENCE, and nothing is
 *      composed; an archive other than the one the lane queued is a row that moved, retried;
 *   6. the switches read ONCE MORE, nearest the argv — `expire-lane-live` decides SHADOW or LIVE at the act, and a
 *      pause raised during the audit stops it — whatever the lane believed when it queued the row;
 *   7. shadow: "would expire", and stop. Live: the verb, the capability asked AGAIN in the act's own scope.
 * It NEVER kills, never stops a unit, never retries inside itself: ccd does the act, and re-proves the token inside
 * its lock at the instant of deletion.
 */

/** The executor's ports (L2, declared by this consumer) — `ChildReclaimDeps`'s shape. */
export interface ExpireArchivedDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
  presence?: Pick<Presence, 'isVisible'>;
  notifyLog?: NotifyLog;
}

/** One row the lane asks about: the archive it believes it is expiring (epoch seconds) and the instant ccd gave. */
export interface ExpireArchivedRequest {
  readonly sessionId: string;
  readonly archivedAt: number;
  readonly expiresAt: number;
}

/** The executor's answer, as the lane folds it (`ArchivedExpiryOutcome`), plus what the feed row needs. */
export type ExpireArchivedResult = ArchivedExpiryOutcome & {
  readonly sessionId: string; readonly archivedAt: number; readonly expiresAt: number;
  readonly wip?: string | null | 'unreadable'; readonly secretsDropped?: number | 'unreadable';
};

export async function expireArchived(deps: ExpireArchivedDeps, req: ExpireArchivedRequest): Promise<ExpireArchivedResult> {
  const { sessionId, archivedAt, expiresAt } = req;
  const answer = (o: ArchivedExpiryOutcome, extra: Partial<ExpireArchivedResult> = {}): ExpireArchivedResult =>
    ({ ...o, sessionId, archivedAt, expiresAt, ...extra } as ExpireArchivedResult);
  // 1 — the capability, refusing on no evidence.
  if (!capSupported(deps.fleetState, EXPIRE_CAP)) {
    return answer({ kind: 'deferred', why: 'unsupported', detail: `the fleet host does not advertise ${EXPIRE_CAP}` });
  }
  // 2 — the switch, from ONE listing. Unlistable is a pause this server cannot rule out.
  const first = await expirySwitches(deps);
  if (first.kind === 'paused') return answer({ kind: 'deferred', why: 'paused-at-server', detail: first.detail });
  // 3 — the store's conjuncts, RE-READ for this row now: the lane's read is a pass old.
  const kept = archivedExpiryStoreSkip(readExpiryStore(deps.coord, sessionId));
  if (kept !== null) {
    return answer({ kind: 'deferred', why: kept, detail: `the coordination store, re-read at the act, keeps ${sessionId} (${kept})` });
  }
  // 4 — a person at the session. No ceiling: presence defers for as long as it lasts.
  if (deps.presence?.isVisible(sessionId) === true) {
    return answer({ kind: 'deferred', why: 'presence', detail: 'someone is viewing this session' });
  }
  // 5 — the audit, and the threshold through its one reader.
  const audit = await expireAudit(deps, sessionId);
  if (audit.kind === 'unreadable') return answer({ kind: 'failed', detail: audit.detail });
  if (audit.expiresAt.kind === 'absent') return answer({ kind: 'no-evidence' });
  if (audit.verdict.kind === 'refused') {
    const { token, detail } = audit.verdict;
    return EXPIRE_TOKEN_KIND[token] === 'gone' ? answer({ kind: 'gone' })
      : answer({ kind: 'refused', token, detail, inUse: audit.inUse,
        auditExpiresAt: audit.expiresAt.kind === 'at' ? audit.expiresAt.at : null });
  }
  if (audit.archivedAt !== archivedAt || audit.expiresAt.kind !== 'at') {
    return answer({ kind: 'deferred', why: 'state-changed',
      detail: `the audit read archive ${String(audit.archivedAt)}, not the ${archivedAt} this pass queued` });
  }
  // 6 — the switches once more, NEAREST THE ARGV: the audit took time, and an operator who raised the pause or took
  // `expire-lane-live` away meanwhile is obeyed now, not on the next pass.
  const last = await expirySwitches(deps);
  if (last.kind === 'paused') return answer({ kind: 'deferred', why: 'paused-at-server', detail: last.detail });
  // 7 — shadow stops here: the lane records it, and nothing is composed.
  if (!last.live) return answer({ kind: 'would-expire', sensitive: audit.sensitive });
  const verb = await expireAct(deps, sessionId, audit.verdict.token);
  if (verb === 'unsupported') {
    return answer({ kind: 'deferred', why: 'unsupported', detail: `the fleet host does not advertise ${EXPIRE_CAP}` });
  }
  switch (verb.kind) {
    case 'expired': return answer({ kind: 'expired' }, { wip: verb.wip, secretsDropped: verb.secretsDropped });
    case 'refused':
      return EXPIRE_TOKEN_KIND[verb.token] === 'gone' ? answer({ kind: 'gone' })
        : answer({ kind: 'refused', token: verb.token, detail: verb.detail, inUse: [] });
    case 'failed': return answer({ kind: 'failed', detail: verb.detail });
    case 'box': return answer({ kind: 'box', word: verb.word, detail: verb.detail });
    case 'composition': return answer({ kind: 'composition', detail: verb.detail });
  }
}

/** The two switches, from ONE registry listing: `reclaim-paused` (or a listing that could not be taken, which cannot
 *  rule it out) is `paused`; otherwise whether `expire-lane-live` stands. A rejecting `readdir` is a listing that
 *  could not be taken. */
async function expirySwitches(deps: ExpireArchivedDeps): Promise<{ kind: 'paused'; detail: string } | { kind: 'clear'; live: boolean }> {
  let names: readonly string[] | null;
  try { names = await deps.io.readdir(deps.cfg.registryDir); } catch { names = null; }
  if (names === null) {
    return { kind: 'paused', detail: `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out` };
  }
  if (names.includes(RECLAIM_PAUSE_MARKER)) {
    return { kind: 'paused', detail: `${RECLAIM_PAUSE_MARKER} is raised: cleanup is paused fleet-wide` };
  }
  return { kind: 'clear', live: names.includes(EXPIRE_LANE_LIVE_MARKER) };
}

/** THE REVIEW CONJUNCT for one row (spec §5.3, CCR-15 R16): is `id` the `sessionId` of a REVIEW run whose reviewed
 *  run is not terminal? An unreadable or absent reviewed run is doubt, and doubt keeps (`reviewKeeps`). Shared by the
 *  lane's pass and the act's re-read. */
export function expiryReviewing(coord: CoordStore, id: string): { ok: true; reviewing: boolean } | { ok: false; detail: string } {
  try {
    const naming = coord.runsNamingSession(id);
    if (!naming.ok) return { ok: false, detail: naming.detail };
    for (const row of naming.runs) {
      const run = coord.run(row.id);
      if (!run.ok) return { ok: false, detail: run.detail };
      const reviews = run.run?.reviews ?? null;
      if (reviews === null) continue;
      const reviewed = coord.run(reviews);
      if (reviewKeeps(!reviewed.ok ? { kind: 'unreadable' } : reviewed.run === null ? { kind: 'absent' }
        : { kind: 'run', state: reviewed.run.state })) return { ok: true, reviewing: true };
    }
    return { ok: true, reviewing: false };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The store's conjuncts for ONE row, AT THE ACT — the destructive-grade reads child reclamation's executor takes at
 *  its own (`openRunsForSession`, `openRunsClaimedBy`), then the review rule. Any read that fails is the store's
 *  failure: `ok:false`, and the act waits. */
export function readExpiryStore(coord: CoordStore, id: string): ExpiryStoreRead {
  try {
    const worker = coord.openRunsForSession(id);
    if (!worker.ok) return { ok: false, detail: worker.detail };
    const claims = coord.openRunsClaimedBy(id);
    if (!claims.ok) return { ok: false, detail: claims.detail };
    const openWorker = worker.siblings.length > 0;
    const openClaimant = claims.siblings.length > 0;
    if (openWorker || openClaimant) return { ok: true, openWorker, openClaimant, reviewing: false };
    const review = expiryReviewing(coord, id);
    return review.ok ? { ok: true, openWorker, openClaimant, reviewing: review.reviewing } : review;
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The audit — its own function, as `childReclaimAudit` is: an old verb (`ws-audit`), asked the old question. ANY
 *  exit 1 is `unreadable` (`parseExpireAudit` reads the exit before a byte of the document). */
async function expireAudit(deps: ExpireArchivedDeps, sessionId: string): Promise<ExpireAuditRead> {
  const argv = CCD_ARGV.wsExpireAudit(sessionId);
  if (!verbSupported(deps.fleetState, argv)) return { kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' };
  const res = await deps.runCcd(argv);
  return parseExpireAudit(sessionId, res.ok, res.stdout);
}

/** The act — its own function, and the capability asked AGAIN inside it: this is the scope `verb-gate.test.ts` reads
 *  for `ws-expire`'s gate, and the one line that must never run without it. */
async function expireAct(deps: ExpireArchivedDeps, sessionId: string, token: string) {
  if (!capSupported(deps.fleetState, EXPIRE_CAP)) return 'unsupported' as const;
  const argv = CCD_ARGV.wsExpire(token, sessionId, sweepDec(deps.fleetState, 'expire sweep'));
  const res = await deps.runCcd(argv);
  return parseExpireResult(sessionId, res.stdout, res.stderr);
}

// ── the feed row ─────────────────────────────────────────────────────────────

const iso = (epochS: number): string => new Date(epochS * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const FEED_TITLE: Readonly<Record<ArchivedExpiryOutcome['kind'], string>> = {
  expired: 'archived workspace cleaned up',
  'would-expire': 'archived workspace would be cleaned up',
  deferred: 'archived workspace cleanup deferred',
  refused: 'archived workspace cleanup refused',
  gone: 'archived workspace gone',
  failed: 'archived workspace cleanup failed',
  box: 'archived workspace cleanup failed',
  composition: 'archived workspace cleanup failed',
  'no-evidence': 'archived workspace cleanup has no evidence',
};

/** The feed row's words: what happened, to which archive, and when it was due. */
export function expireFeedBody(r: ExpireArchivedResult): string {
  const who = `${r.sessionId} (archived ${iso(r.archivedAt)}, due ${iso(r.expiresAt)})`;
  switch (r.kind) {
    case 'expired': {
      const wip = r.wip === null ? 'nothing uncommitted was left' : r.wip === 'unreadable' || r.wip === undefined
        ? 'uncommitted work was pinned, its commit id unreadable' : `uncommitted work was pinned as ${r.wip}`;
      const secrets = typeof r.secretsDropped === 'number' && r.secretsDropped > 0
        ? `; ${r.secretsDropped} secret-shaped ${r.secretsDropped === 1 ? 'path was' : 'paths were'} dropped and recorded` : '';
      return `${who} was cleaned up: its commits are kept in the attic (ccd ws-attic --session ${r.sessionId}), ${wip}${secrets}.`;
    }
    case 'would-expire':
      return `${who} would be cleaned up now — the cleanup is not armed (shadow), so nothing was deleted`
        + `${r.sensitive > 0 ? `; ${r.sensitive} secret-shaped ${r.sensitive === 1 ? 'file' : 'files'} would be dropped` : ''}.`;
    case 'deferred': return `${who}: deferred (${r.why}) — ${r.detail}.`;
    case 'refused': return `${who}: ccd refused (${r.token}) — ${r.detail}`;
    case 'gone': return `${who} left the archive before it was cleaned up.`;
    case 'failed': return `${who}: failed — ${r.detail}. It is retried, backing off in between.`;
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.`;
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
    case 'no-evidence': return `${who}: the fleet box's ccd does not say when this archive expires; nothing was composed.`;
  }
}

/** ONE feed row for an outcome — written by the LANE, and only when the row's outcome CHANGED, so a refusal that
 *  stands is one row, not one a minute. `kind: 'run'` with no run: recorded, never pushed, in the unfiltered feed.
 *  A missing log degrades the record and never the act. */
export function recordExpireFeed(deps: Pick<ExpireArchivedDeps, 'coord' | 'notifyLog'>, r: ExpireArchivedResult): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({ kind: 'run', sessionId: r.sessionId, runId: null, title: FEED_TITLE[r.kind], body: expireFeedBody(r) });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed '
      + `(${err instanceof Error ? err.message : String(err)}) — archived expiry ${r.kind}, feed archive degraded`);
  } finally {
    void log.flush();
  }
}
