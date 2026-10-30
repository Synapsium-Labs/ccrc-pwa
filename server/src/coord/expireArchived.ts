import type { FleetIO, MeasuredDirectoryRead } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { CcdResult, RunCcd } from './ports.js';
import type { CcdArgv } from '../ccdargv.js';
import type { Viewers } from '../viewer.js';
import type { NotifyLog } from '../notifylog.js';
import { CCD_ARGV, EXPIRE_CAP, EXPIRE_CHILD_CAP, capSupported, ccdCan, sweepDec } from '../ccdargv.js';
import type { CoordStore } from './store.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { childReclaimHasCoordinated } from './childReclaim.js';
import { readSwitches } from '../../../shared/switches.js';
import {
  EXPIRE_ASKS_AGAIN_CADENCE, EXPIRE_CHILD_LIVE_MARKER, EXPIRE_HALT_WORDS, EXPIRE_LANE_LIVE_MARKER, EXPIRE_TOKEN_KIND, archivedExpiryStoreSkip, expireKeptParts, parseExpireAudit,
  archivedExpiryVerdict,
  parseExpireResult, reviewKeeps,
  type ArchivedExpiryOutcome, type ExpireAuditRead, type ExpiryStoreRead,
} from '../archivedExpiry.js';
import { isRegistryId } from '../../../shared/api.js';
import { notify } from '../notice.js';
import { notRanSentence } from '../unmeasured.js';
import { recordNestedRescueShadow } from './nestedRescueShadow.js';
import { journalShadowVerdict } from './shadowJournal.js';
import { SHADOW_LANE, SHADOW_RUNG } from '../../../shared/shadowJournal.js';
import {
  RETIRE_LISTING_MODES, RETIRE_NOTICE_HOMES, RETIRE_VIEWER_RULES, RETIRE_REASON_NAMES, RETIRE_STEPS, capabilityJudge,
  viewerJudge, type RetireNoRead, type RetireReason,
} from '../retire.js';
import { retireAct, type RetireActPort } from '../retireLane.js';

/**
 * THE EXPIRY LANE'S ONE EXECUTOR (workspace lifecycle spec 2026-09-24 §5.3, wave 3b): `ws-audit --expire`, then
 * `ws-expire` with THAT audit's token — child reclamation's `reclaimChild` shape, in a file of its own so nothing of
 * the child lane's vocabulary, feed rows or attention list is shared. Its one caller is `watch.ts`'s
 * `sweepArchivedExpiry`, on the session's `KeyedQueue`.
 *
 * It re-reads everything it acts on, in this order, and every doubt is "not this time":
 *   1. the box must PROVE it has the verb — `ccdCan(state, 'wsExpire')` (`EXPIRE_CAP`, D-5866), which refuses on no
 *      evidence; never `verbSupported`, which permits on an absent list;
 *   2. ONE registry listing: `reclaim-paused` — the fleet's one cleanup switch — stops it, and so does a listing that
 *      could not be taken;
 *   3. the STORE, re-read for this row (`readExpiryStore`, the destructive-grade reads child reclamation's executor
 *      takes at its act): a run that names it as worker or claimant, a review that still needs it, or a store that
 *      cannot say, defers it. The lane read these when its pass began; a run can bind the row since, and ccd cannot
 *      see the coordination store, so this read is the only guard of the run conjuncts at the act;
 *   4. a person looking at the session defers it — WITHOUT a ceiling (spec §5.3: "Presence defers WITHOUT a
 *      ceiling" — that spec's "presence" is the viewer claim `Viewers` now holds);
 *   5. the audit — one that cannot be read is the audit's own failure (`audit-failed`), never the verb's — and its
 *      `expiresAt` through the one reader: a document without it is NO EVIDENCE, and nothing is
 *      composed; an archive other than the one the lane queued is a row that moved, retried — checked BEFORE a
 *      refusal is classified, so another archive's refusal is never folded onto the queued one (review 313, F2);
 *   6. the switches read ONCE MORE, nearest the argv — `expire-lane-live` decides SHADOW or LIVE at the act, and a
 *      pause raised during the audit stops it — whatever the lane believed when it queued the row;
 *   7. shadow: "would expire", and stop. A CHILD (`childOf`, D-6641) also needs `expire-v1`'s sibling capability
 *      and `expire-child-live`, both asked again here; either missing is shadow or `unsupported`, never the flag. Live: the verb, the capability asked AGAIN in the act's own scope.
 * It NEVER kills, never stops a unit, never retries inside itself: ccd does the act, and re-proves the token inside
 * its lock at the instant of deletion.
 */

/** The executor's ports (L2, declared by this consumer) — `ChildReclaimDeps`'s shape. */
export interface ExpireArchivedDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: RunCcd; fleetState?: FleetState;
  viewers?: Pick<Viewers, 'isVisible'>;
  notifyLog?: NotifyLog;
}

/** One row the lane asks about: the archive it believes it is expiring (epoch seconds) and the instant ccd gave. */
export interface ExpireArchivedRequest {
  readonly sessionId: string;
  readonly archivedAt: number;
  readonly expiresAt: number;
  /** The minting run, when the row carries a readable child marker: `--child-of` rides every call for it (D-6641). */
  readonly childOf?: number;
  /** The uuid of the registry row the lane judged (`childReclaimRowUuid`), for the child's coordination fence. */
  readonly rowUuid?: string | null;
}

/** The executor's answer, as the lane folds it (`ArchivedExpiryOutcome`), plus what the feed row needs. */
export type ExpireArchivedResult = ArchivedExpiryOutcome & {
  readonly sessionId: string; readonly archivedAt: number; readonly expiresAt: number;
  readonly wip?: string | null | 'unreadable'; readonly secretsDropped?: number | 'unreadable';
  /** The row is an archived child (D-6641): its shadow row says so. */
  readonly child?: true;
  /** `expire-lane-live` stands and only `expire-child-live` holds this child back (D-6861): the one case the shadow
   *  journal records as `expire-child`. A child held because the lane itself is unarmed is not that arm's verdict. */
  readonly childArmHeld?: true;
};

/** What both executor entries answer for a session id that is not a registry id (spec §2.3): refused here, before
 *  either builder, so no call is composed. The lane's population is registry-derived and omits such a row; this is the
 *  executor boundary's own re-check. */
const EXPIRE_ID_REFUSED = 'the server refused this session id: it is not a registry id, so no call was composed';

/** The executor: archive-expired's row of the one retire gate (`ARCHIVE_EXPIRED_RETIRE`), driven by the one executor
 *  loop over this file's port (`expireRetirePort`), in the order the header above gives (D-7169). */
export async function expireArchived(deps: ExpireArchivedDeps, req: ExpireArchivedRequest): Promise<ExpireArchivedResult> {
  return retireAct(expireRetirePort(deps, req), ARCHIVE_EXPIRED_RETIRE, req);
}

/** The two switches, from ONE registry listing: `reclaim-paused` (or a listing that could not be taken, which cannot
 *  rule it out) is `paused`; otherwise whether `expire-lane-live` stands. A rejecting `readdirMeasured` is a listing
 *  that could not be taken, `unreadable`. */
async function expirySwitches(deps: ExpireArchivedDeps): Promise<{ kind: 'paused'; detail: string } | { kind: 'clear'; live: boolean; childLive: boolean }> {
  // D-5969 (ARCH-08b): the MEASURED listing; a rejecting port is `unreadable`, and the pause says which it was.
  let listed: MeasuredDirectoryRead;
  try { listed = await deps.io.readdirMeasured(deps.cfg.registryDir); } catch { listed = { ok: false, reason: 'unreadable' }; }
  if (!listed.ok) {
    return { kind: 'paused', detail: `the registry did not list (${listed.reason}), so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out` };
  }
  const names = listed.entries;
  if (readSwitches(names)[RECLAIM_PAUSE_MARKER] === 'set') {
    return { kind: 'paused', detail: `${RECLAIM_PAUSE_MARKER} is raised: cleanup is paused fleet-wide` };
  }
  return { kind: 'clear', live: expireLaneLive(names), childLive: names.includes(EXPIRE_CHILD_LIVE_MARKER) };
}

/** Whether `expire-lane-live` stands in a registry listing: the one reading, for the executor and the lane's child shadow. */
export const expireLaneLive = (names: readonly string[]): boolean => names.includes(EXPIRE_LANE_LIVE_MARKER);

/** THE REVIEW CONJUNCT for one row (spec §5.3, #166 R16): is `id` the `sessionId` of a REVIEW run whose reviewed
 *  run is not terminal? An unreadable or absent reviewed run is doubt, and doubt keeps (`reviewKeeps`). Shared by the
 *  lane's pass and the act's re-read, and by the stop-done lane's (D-5370, `sleepLane.ts`). */
export function expiryReviewing(coord: Pick<CoordStore, 'runsNamingSession' | 'run'>, id: string): { ok: true; reviewing: boolean } | { ok: false; detail: string } {
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
 *  its own (`bindingsOf`: the worker's and the claimant's open runs), then the review rule. Any read that fails is the store's
 *  failure: `ok:false`, and the act waits. */
export function readExpiryStore(coord: CoordStore, id: string, child?: { readonly rowUuid: string | null }): ExpiryStoreRead {
  try {
    const bound = coord.bindingsOf(id);
    const worker = bound.worker();
    if (!worker.ok) return { ok: false, detail: worker.detail };
    const claims = bound.claimant();
    if (!claims.ok) return { ok: false, detail: claims.detail };
    const openWorker = worker.siblings.length > 0;
    const openClaimant = claims.siblings.length > 0;
    if (openWorker || openClaimant) return { ok: true, openWorker, openClaimant, reviewing: false };
    const review = expiryReviewing(coord, id);
    if (!review.ok) return review;
    return { ok: true, openWorker, openClaimant, reviewing: review.reviewing, ...(child === undefined ? {} : { coordinated: childEverCoordinated(coord, id, child.rowUuid) }) };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** A child that EVER coordinated is never taken (spec §4): the reclaim lane's own fence, over terminal runs too.
 *  A read that throws is `null` — doubt keeps. */
export function childEverCoordinated(coord: CoordStore, id: string, rowUuid: string | null): boolean | null {
  try { return childReclaimHasCoordinated(coord, id, Date.now(), rowUuid); } catch { return null; }
}

/** The lane's LEARNING read (wave 3b): the audit alone, to learn when this archive expires — ccd's own instant, so
 *  the server never types the threshold. Read-only on the box (`ws-audit` journals a terminal refusal and nothing
 *  else); behind the capability, as the act is. */
export async function learnExpiry(deps: Pick<ExpireArchivedDeps, 'runCcd' | 'fleetState'>, sessionId: string, childOf?: number): Promise<ExpireAuditRead> {
  // The id first, as the act's step 0 (spec §2.3): the learning audit is the other `wsExpireAudit` builder.
  if (!isRegistryId(sessionId)) return { kind: 'unreadable', detail: EXPIRE_ID_REFUSED };
  if (!ccdCan(deps.fleetState, 'wsExpire')) return { kind: 'unreadable', detail: `the fleet host does not advertise ${EXPIRE_CAP}` };
  if (childOf !== undefined && !capSupported(deps.fleetState, EXPIRE_CHILD_CAP)) return { kind: 'unreadable', detail: `the fleet host does not advertise ${EXPIRE_CHILD_CAP}` };
  return expireAudit(deps, sessionId, childOf);
}

/** The audit — its own function, as `childReclaimAudit` is: an old verb (`ws-audit`), asked the old question. ANY
 *  exit 1 is `unreadable` (`parseExpireAudit` reads the exit before a byte of the document). */
async function expireAudit(deps: Pick<ExpireArchivedDeps, 'runCcd' | 'fleetState'>, sessionId: string, childOf?: number): Promise<ExpireAuditRead> {
  const argv = CCD_ARGV.wsExpireAudit(sessionId, childOf);
  if (!ccdCan(deps.fleetState, 'wsExpireAudit')) return { kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' };
  const res = await deps.runCcd(argv);
  // D-6034: a call that never ran (or may not have) is read FIRST, before a byte of a document: unreadable, so the
  // executor answers `audit-failed` (retried on the failure backoff), never a refusal.
  if (res.ran === false) return { kind: 'unreadable', detail: notRanSentence(argv[0] ?? 'ccd', res) };
  return parseExpireAudit(sessionId, res.ok, res.stdout);
}

/** The act — its own function, and the capability asked AGAIN inside it: this is the scope `verb-gate.test.ts` reads
 *  for `ws-expire`'s gate, and the one line that must never run without it. */
async function expireAct(deps: ExpireArchivedDeps, sessionId: string, token: string, childOf?: number) {
  if (!ccdCan(deps.fleetState, 'wsExpire')) return 'unsupported' as const;
  if (childOf !== undefined && !capSupported(deps.fleetState, EXPIRE_CHILD_CAP)) return 'unsupported' as const;
  const argv = CCD_ARGV.wsExpire(token, sessionId, sweepDec(deps.fleetState, 'expire sweep'), childOf);
  const res = await deps.runCcd(argv);
  // D-6034: read FIRST, before the box words and the composition dies are read off the runner's stderr. The verb may
  // have started (a link that dropped after the send, a wait that expired), so this is the reader's own "may have been
  // cut short" answer: `failed`, resumable — retried, and never a refusal, a box word or a composition error.
  if (res.ran === false) return { kind: 'failed' as const, resumable: true, detail: notRanSentence(argv[0] ?? 'ccd', res) };
  return parseExpireResult(sessionId, res.stdout, res.stderr);
}

// ── the feed row ─────────────────────────────────────────────────────────────

// D-5859: the row's body is built as the funnel's argument, outside its archive guard, so it never throws: an instant
// beyond what `Date` renders (a corrupt registry document) is said as the raw epoch instead.
const iso = (epochS: number): string => {
  const d = new Date(epochS * 1000);
  return Number.isNaN(d.getTime()) ? `epoch ${epochS} s` : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
};

const FEED_TITLE: Readonly<Record<ArchivedExpiryOutcome['kind'], string>> = {
  expired: 'archived workspace cleaned up',
  'would-expire': 'archived workspace would be cleaned up',
  deferred: 'archived workspace cleanup deferred',
  refused: 'archived workspace cleanup refused',
  gone: 'archived workspace gone',
  failed: 'archived workspace cleanup failed',
  'audit-failed': 'archived workspace cleanup failed',
  restart: 'archived workspace cleanup stopped before it began',
  stuck: 'archived workspace cleanup stuck',
  box: 'archived workspace cleanup failed',
  composition: 'archived workspace cleanup failed',
  'no-evidence': 'archived workspace cleanup has no evidence',
};

/** The feed row's words: what happened, to which archive, and when it was due. `standing`: the row's attention entry
 *  STANDS (`expiryReportStands`) — an earlier attempt may have stopped part-way — so a shadow row over it never says that
 *  nothing was deleted, only that THIS pass deleted nothing (wave 6; the standing entry's own words). */
export function expireFeedBody(r: ExpireArchivedResult, standing = false): string {
  const who = `${r.sessionId} (archived ${iso(r.archivedAt)}, due ${iso(r.expiresAt)})`;
  switch (r.kind) {
    case 'expired': {
      const wip = r.wip === null ? 'nothing uncommitted was left' : r.wip === 'unreadable' || r.wip === undefined
        ? 'uncommitted work was pinned, its commit id unreadable' : `uncommitted work was pinned as ${r.wip}`;
      const secrets = typeof r.secretsDropped === 'number' && r.secretsDropped > 0
        ? `; ${r.secretsDropped} secret-shaped ${r.secretsDropped === 1 ? 'path was' : 'paths were'} dropped and recorded` : '';
      // What the tail kept of its two leaves (wave 5): each kept word, or — an older ccd that does not report them — that
      // whether they went is not known. Recorded here; only a kept word is an attention entry.
      const kept = expireKeptParts(r.kept);
      const leaves = kept.length > 0 ? `; ccd kept ${kept.join(' and ')} — it stays on disk`
        : r.kept.clips === 'unreported' || r.kept.tmpRoot === 'unreported'
          ? '; whether its clips directory and temp root were removed is not reported by this box’s ccd (an older build), so it is unmeasured'
          : '';
      return `${who} was cleaned up: its commits are kept in the attic (ccd ws-attic --session ${r.sessionId}), ${wip}${secrets}${leaves}.`;
    }
    case 'would-expire':
      return `${who} would be cleaned up now${r.child === true ? ' (child)' : ''} — the cleanup is not armed (shadow), so `
        + `${standing ? 'this pass deleted nothing — but an earlier attempt may have stopped part-way, so what is left on disk is '
          + 'not known, and its attention entry stands' : 'nothing was deleted'}`
        + `${r.sensitive > 0 ? `; ${r.sensitive} secret-shaped ${r.sensitive === 1 ? 'file' : 'files'} would be dropped` : ''}.`;
    case 'deferred': return `${who}: deferred (${r.why}) — ${r.detail}.`;
    case 'refused': return `${who}: ccd refused (${r.token}) — ${r.detail}`;
    case 'gone': return `${who} left the archive before it was cleaned up.`;
    case 'failed': return `${who}: failed — ${r.detail}. ${r.resumable ? 'It is retried, backing off in between.'
      : 'It is not retried: the box said it will not resume, so the lane stops asking for this archive.'}`;
    case 'audit-failed': return `${who}: its expiry's own audit could not be read (${r.detail}), so no verb ran. `
      + 'It is retried, backing off in between.';
    // ccd said it stopped before this attempt's breadcrumb (`crumb: false`, or an older ccd's `state-changed`): never a
    // sentence about one cause, since a fresh pin's failure says the same (wave 6).
    case 'restart': return `${who}: ccd stopped before this attempt started anything (${r.detail}) — nothing was deleted, `
      + 'and the lane audits it afresh.';
    case 'stuck': return `${who}: ccd stopped part-way (${r.detail}) — the session was stopped and nothing further was `
      + `deleted. It is listed at once, and asked again ${EXPIRE_ASKS_AGAIN_CADENCE}, `
      + 'until an attempt completes, a verdict stops it for good, or the workspace is archived again.';
    // `flock-unavailable` halts the lane on that box until the server restarts (`watch.ts`): the row says so, whatever the
    // row's own attention entry says (a standing one stands through it; wave 6).
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.` + (r.word === 'flock-unavailable'
      ? ` ${EXPIRE_HALT_WORDS}` : '');
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
    case 'no-evidence': return `${who}: the fleet box's ccd does not say when this archive expires; nothing was composed.`;
  }
}

/** ONE feed row for an outcome — written by the LANE, and only when the row's outcome CHANGED, so a refusal that
 *  stands is one row, not one a minute. `kind: 'run'` with no run: recorded, never pushed, in the unfiltered feed.
 *  A missing log degrades the record and never the act. */
export function recordExpireFeed(deps: Pick<ExpireArchivedDeps, 'coord' | 'notifyLog'>, r: ExpireArchivedResult, standing = false): void {
  // Through the funnel (`notice.ts`, D-5859), `'record-only'`: recorded whatever the presence, never pushed.
  const title = r.child === true && r.kind === 'would-expire' ? 'archived child workspace would be cleaned up' : FEED_TITLE[r.kind];
  // The durable journal beside the feed row (D-6861): a marked child the verdict would take but for its arm, and only
  // that (`childArmHeld`: the expiry lane is live and the child arm is not).
  if (r.kind === 'would-expire' && r.child === true && r.childArmHeld === true) {
    journalShadowVerdict(deps.coord, { lane: SHADOW_LANE.expireChild, subject: r.sessionId, path: null, epoch: String(r.archivedAt),
      rung: SHADOW_RUNG.childShadow, bytes: null, inodes: null, detail: expireFeedBody(r, standing) });
  }
  notify(deps, { kind: 'run', sessionId: r.sessionId, runId: null, title, body: expireFeedBody(r, standing) },
    'record-only', { degraded: `archived expiry ${r.kind}, feed archive degraded` });
}

// ── the gate's row (D-7166; ARCH-44, consolidation spec K1) ──────────────────

/** `expirySwitches`' answer, as it stands (D-7224). */
type ExpirySwitchesRead = Awaited<ReturnType<typeof expirySwitches>>;

/**
 * ARCHIVE-EXPIRED'S ROW OF THE ONE RETIRE GATE (`retire.ts#decideRetire`): `expireArchived`'s steps 0 to 7, one row step
 * per point at which the executor answers, in its order, each judged by its own statements over its readers' facts. The
 * readers are its reads, unchanged (`expirySwitches` included, D-7224), held by `expireRetirePort`; `expireArchived`
 * runs this row through `retireAct` (D-7169).
 */
export interface ArchiveExpiredFacts {
  /** The request's session id: the id predicate's input. */
  readonly [RETIRE_STEPS.id]?: string;
  /** `expire-v1`, then the child arm's `expire-child-v1` (true for a row that is no child). */
  readonly [RETIRE_STEPS.capability]?: readonly boolean[];
  readonly [RETIRE_STEPS.switches]?: ExpirySwitchesRead;
  readonly [RETIRE_STEPS.store]?: ExpiryStoreRead;
  readonly [RETIRE_STEPS.viewer]?: boolean;
  readonly [RETIRE_STEPS.audit]?: ExpireAuditRead;
  readonly [RETIRE_STEPS.archiveMatch]?: RetireNoRead;
  readonly [RETIRE_STEPS.auditVerdict]?: RetireNoRead;
  readonly [RETIRE_STEPS.switchesLast]?: ExpirySwitchesRead;
  readonly [RETIRE_STEPS.live]?: RetireNoRead;
}

/** The markers the executor's two listings read, each from ONE measured listing. */
const EXPIRY_SWITCH_MARKERS: readonly string[] = [RECLAIM_PAUSE_MARKER, EXPIRE_LANE_LIVE_MARKER, EXPIRE_CHILD_LIVE_MARKER];

/** The executor's answer envelope (`expireArchived`'s `answer`), for one request. */
const expiryAnswerOf = (req: ExpireArchivedRequest) =>
  (o: ArchivedExpiryOutcome, extra: Partial<ExpireArchivedResult> = {}): ExpireArchivedResult =>
    ({ ...o, sessionId: req.sessionId, archivedAt: req.archivedAt, expiresAt: req.expiresAt,
      ...(req.childOf === undefined ? {} : { child: true }), ...extra } as ExpireArchivedResult);

/** The audit's document, for a step after `audit` (which judged an unreadable one). */
const expiryDocumentOf = (f: ArchiveExpiredFacts): Extract<ExpireAuditRead, { kind: 'document' }> => {
  const audit = f[RETIRE_STEPS.audit];
  if (audit === undefined || audit.kind !== 'document') throw new Error('archive-expired: a step after the audit was judged without its document');
  return audit;
};

/** Step 0's id predicate, before any read (D-7204: `id-argv-census.test.ts`'s expiry gate). */
function expiryIdJudge(sessionId: string, req: ExpireArchivedRequest): ExpireArchivedResult | null {
  const answer = expiryAnswerOf(req);
  if (!isRegistryId(sessionId)) return answer({ kind: 'composition', detail: EXPIRE_ID_REFUSED });
  return null;
}

/** Steps 2 and 6: `expirySwitches`' pause, its detail passed through as it is worded (D-7224). */
function expirySwitchesJudge(first: ExpirySwitchesRead, req: ExpireArchivedRequest): ExpireArchivedResult | null {
  const answer = expiryAnswerOf(req);
  if (first.kind === 'paused') return answer({ kind: 'deferred', why: 'paused-at-server', detail: first.detail });
  return null;
}

export const ARCHIVE_EXPIRED_RETIRE: RetireReason<ExpireArchivedRequest, ArchiveExpiredFacts, ExpireArchivedResult> = {
  name: RETIRE_REASON_NAMES.archiveExpired,
  decide: [
    { step: RETIRE_STEPS.id, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.capability, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.switches, sync: false, onReject: 'propagate', markers: EXPIRY_SWITCH_MARKERS },
    { step: RETIRE_STEPS.store, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.viewer, sync: true, onReject: 'propagate' },
  ],
  audit: { step: RETIRE_STEPS.audit, sync: false, onReject: 'propagate' },
  act: [
    { step: RETIRE_STEPS.archiveMatch, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.auditVerdict, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.switchesLast, sync: false, onReject: 'propagate', markers: EXPIRY_SWITCH_MARKERS },
    { step: RETIRE_STEPS.live, sync: true, onReject: 'propagate' },
  ],
  listing: RETIRE_LISTING_MODES.measuredOnce,
  viewer: RETIRE_VIEWER_RULES.noCeiling,
  notice: RETIRE_NOTICE_HOMES.lane,
  judge: {
    [RETIRE_STEPS.id]: (sessionId, _f, req) => expiryIdJudge(sessionId, req),
    [RETIRE_STEPS.capability]: capabilityJudge<ExpireArchivedRequest, ArchiveExpiredFacts, ExpireArchivedResult>([
      (req) => expiryAnswerOf(req)({ kind: 'deferred', why: 'unsupported', detail: `the fleet host does not advertise ${EXPIRE_CAP}` }),
      (req) => expiryAnswerOf(req)({ kind: 'deferred', why: 'unsupported', detail: `the fleet host does not advertise ${EXPIRE_CHILD_CAP}` }),
    ]),
    [RETIRE_STEPS.switches]: (first, _f, req) => expirySwitchesJudge(first, req),
    [RETIRE_STEPS.store]: (read, _f, req) => {
      const kept = archivedExpiryStoreSkip(read);
      return kept !== null ? expiryAnswerOf(req)({ kind: 'deferred', why: kept,
        detail: `the coordination store, re-read at the act, keeps ${req.sessionId} (${kept})` }) : null;
    },
    [RETIRE_STEPS.viewer]: viewerJudge<ExpireArchivedRequest, ArchiveExpiredFacts, ExpireArchivedResult>(
      RETIRE_VIEWER_RULES.noCeiling,
      (req) => expiryAnswerOf(req)({ kind: 'deferred', why: 'presence', detail: 'someone is viewing this session' })),
    [RETIRE_STEPS.audit]: (audit, _f, req) => {
      const answer = expiryAnswerOf(req);
      if (audit.kind === 'unreadable') return answer({ kind: 'audit-failed', detail: audit.detail });
      if (audit.expiresAt.kind === 'absent') return answer({ kind: 'no-evidence' });
      return null;
    },
    [RETIRE_STEPS.archiveMatch]: (_n, f, req) => {
      const audit = expiryDocumentOf(f);
      return audit.archivedAt !== null && audit.archivedAt !== req.archivedAt
        ? expiryAnswerOf(req)({ kind: 'deferred', why: 'state-changed',
          detail: `the audit read archive ${String(audit.archivedAt)}, not the ${req.archivedAt} this pass queued` })
        : null;
    },
    [RETIRE_STEPS.auditVerdict]: (_n, f, req) => {
      const answer = expiryAnswerOf(req);
      const audit = expiryDocumentOf(f);
      if (audit.verdict.kind === 'refused') {
        const { token, detail } = audit.verdict;
        return EXPIRE_TOKEN_KIND[token] === 'gone' ? answer({ kind: 'gone' })
          : answer({ kind: 'refused', token, detail, inUse: audit.inUse,
            auditExpiresAt: audit.expiresAt.kind === 'at' ? audit.expiresAt.at : null });
      }
      if (audit.archivedAt !== req.archivedAt || audit.expiresAt.kind !== 'at') {
        return answer({ kind: 'deferred', why: 'state-changed',
          detail: `the audit read archive ${String(audit.archivedAt)}, not the ${req.archivedAt} this pass queued` });
      }
      return null;
    },
    [RETIRE_STEPS.switchesLast]: (last, _f, req) => expirySwitchesJudge(last, req),
    [RETIRE_STEPS.live]: (_n, f, req) => {
      const answer = expiryAnswerOf(req);
      const last = f[RETIRE_STEPS.switchesLast];
      if (last?.kind !== 'clear') throw new Error('archive-expired: the shadow arm was judged without a clear last listing');
      const audit = expiryDocumentOf(f);
      if (!last.live) return answer({ kind: 'would-expire', sensitive: audit.sensitive });
      if (req.childOf !== undefined && !last.childLive) return answer({ kind: 'would-expire', sensitive: audit.sensitive }, { childArmHeld: true });
      return null;
    },
  },
  evidence: [archivedExpiryVerdict],
};

/**
 * ARCHIVE-EXPIRED'S PORT (D-7169): `ARCHIVE_EXPIRED_RETIRE`'s readers, each the statement the executor's ladder ran for
 * that step and nothing else, and the act with its verb mapping. The id predicate is `expiryIdJudge`'s (D-7204): the
 * `id` reader hands over the session id. Both listings are `expirySwitches`, not edited (D-7224); the shadow arm reads
 * the last one's `live` and `childLive`, so ONE listing answers both. The audit and the act have no try, as before: a
 * rejection rejects `expireArchived` into its caller's catch (D-7226). The one outcome effect is the nested-rescue
 * shadow, on an audit refusal only, after the archive-match check (D-7199). The lane writes the feed row.
 */
export function expireRetirePort(
  deps: ExpireArchivedDeps, req: ExpireArchivedRequest,
): RetireActPort<ExpireArchivedRequest, ArchiveExpiredFacts, ExpireArchivedResult> {
  const { sessionId, archivedAt, childOf } = req;
  const answer = expiryAnswerOf(req);
  return {
    read: {
      [RETIRE_STEPS.id]: () => sessionId,
      [RETIRE_STEPS.capability]: () => [ccdCan(deps.fleetState, 'wsExpire'),
        childOf === undefined || capSupported(deps.fleetState, EXPIRE_CHILD_CAP)],
      [RETIRE_STEPS.switches]: () => expirySwitches(deps),
      [RETIRE_STEPS.store]: () => readExpiryStore(deps.coord, sessionId, childOf === undefined ? undefined : { rowUuid: req.rowUuid ?? null }),
      [RETIRE_STEPS.viewer]: () => deps.viewers?.isVisible(sessionId) === true,
      [RETIRE_STEPS.audit]: () => expireAudit(deps, sessionId, childOf),
      [RETIRE_STEPS.archiveMatch]: () => true,
      [RETIRE_STEPS.auditVerdict]: () => true,
      [RETIRE_STEPS.switchesLast]: () => expirySwitches(deps),
      [RETIRE_STEPS.live]: () => true,
    },
    act: async (facts) => {
      const verb = await expireAct(deps, sessionId, expiryDocumentOf(facts).verdict.token, childOf);
      if (verb === 'unsupported') {
        return answer({ kind: 'deferred', why: 'unsupported', detail: `the fleet host does not advertise ${EXPIRE_CAP}` });
      }
      switch (verb.kind) {
        case 'expired': return answer({ kind: 'expired', kept: verb.kept }, { wip: verb.wip, secretsDropped: verb.secretsDropped });
        case 'refused':
          return EXPIRE_TOKEN_KIND[verb.token] === 'gone' ? answer({ kind: 'gone' })
            : answer({ kind: 'refused', token: verb.token, detail: verb.detail, inUse: [] });
        case 'failed': return answer({ kind: 'failed', resumable: verb.resumable, detail: verb.detail });
        case 'restart': return answer({ kind: 'restart', detail: verb.detail });
        case 'stuck': return answer({ kind: 'stuck', detail: verb.detail });
        case 'box': return answer({ kind: 'box', word: verb.word, detail: verb.detail });
        case 'composition': return answer({ kind: 'composition', detail: verb.detail });
      }
    },
    answered: (step, _outcome, facts) => {
      if (step !== RETIRE_STEPS.auditVerdict) return;
      const audit = expiryDocumentOf(facts);
      if (audit.verdict.kind !== 'refused') return;
      recordNestedRescueShadow(deps, { sessionId, runId: null, key: String(archivedAt), who: `${sessionId} (archived ${archivedAt})`,
        count: audit.nestedWouldRescue ?? 0, paths: audit.nestedWouldRescuePaths ?? [], rung: SHADOW_RUNG.expireRescue });
    },
  };
}
