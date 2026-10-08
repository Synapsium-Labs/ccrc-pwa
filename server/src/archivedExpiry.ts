// THE EXPIRY LANE'S DECISIONS (workspace lifecycle spec 2026-09-24 §5.3 "The lane", wave 3b). L1: pure, clock-free
// (the clock is an argument), `fs`-free and fastify-free — `childReclaimSweep.ts`'s shape, beside it and sharing
// nothing with it. It imports L0 alone. `watch.ts`'s `sweepArchivedExpiry` (L4) GATHERS the evidence and APPLIES
// these verdicts; `coord/expireArchived.ts` (the one executor) reads the box's two documents through the parsers
// here. Nothing in this file reads a file, a row or a clock.
//
// THE POPULATION is an ARCHIVED WORKSPACE nobody claims, seven days after its archive — never a child (CCR-15's lane
// owns those) and never a main checkout (nothing archives one). THE THRESHOLD IS NEVER TYPED HERE: ccd's
// `ws-audit --expire` document carries `expiresAt` (`archivedAt + WS_EXPIRE_AFTER_S`, from the one ccd definition),
// and `expireAuditExpiresAt` is the ONE reader of that key. A document without it — an older ccd — is NO EVIDENCE,
// and the lane composes nothing for that row.
//
// EVERY UNCERTAIN ANSWER IS "NOT THIS PASS". The path these verdicts feed asks for a deletion with no human in it;
// the executor re-reads, and ccd re-proves inside its lock at the instant of deletion. This file narrows the window.
import {
  TERMINAL_RUN_STATES, type ChildMark, type ExpiryAttention, type RunState,
} from '../../shared/api.js';

/** THE LANE'S LIVE SWITCH (the coordinator's safety ruling (E), the scope sweep's precedent). Until `$REG/<this>`
 *  exists the lane AUDITS and RECORDS "would expire <id>" — a feed row and an attention entry — and NEVER composes
 *  `ws-expire`. It has NO WRITER in the tree: the operator touches it by hand on the fleet box, and
 *  `single-definition.test.ts` pins that, beside `stall-watch-live`. Spelled here and nowhere else in `server/src`. */
export const EXPIRE_LANE_LIVE_MARKER = 'expire-lane-live';

/** Every word `ws-expire` and `ws-audit --expire` refuse with — and NO other. `archived-expiry-policy.test.ts` holds
 *  this set equal to what ccd's EXPIRE region and the shared ladder (`_ws_reclaim_ladder`) emit, in both directions,
 *  the way `CHILD_RECLAIM_TOKEN_KIND` is held to the RECLAIM region. */
export type ExpireToken =
  | 'no-such-session' | 'not-archived' | 'not-a-workspace' | 'branch-elsewhere' | 'tree-unreadable'
  | 'containment-unproven' | 'no-worktree-record' | 'not-expired' | 'child' | 'paused' | 'held' | 'attached'
  | 'live' | 'in-use' | 'tree-busy' | 'state-changed' | 'in-progress' | 'reap-in-progress' | 'reclaim-in-progress';

/** What each word means to the lane, spelled ONCE (wave 3's plan, "Wave 3b inherits", the words by kind):
 *   - `gone`: the row left the population — returned, re-archived from scratch, or removed. Drop it, no report.
 *   - `terminal`: the box proved something waiting will not change. Reported (attention), never re-asked until the
 *     row's archive changes.
 *   - `retry`: a condition that passes (a hold, a pause, a person, a process, a lock, a token gone stale). Asked
 *     again; `in-use` standing for `EXPIRE_IN_USE_ATTENTION_PASSES` asks is reported, naming what holds it. */
export const EXPIRE_TOKEN_KIND: Readonly<Record<ExpireToken, 'gone' | 'terminal' | 'retry'>> = {
  'no-such-session': 'gone',
  'not-archived': 'gone',
  'not-a-workspace': 'terminal',
  'branch-elsewhere': 'terminal',
  'tree-unreadable': 'terminal',
  'containment-unproven': 'terminal',
  'no-worktree-record': 'terminal',
  'not-expired': 'retry',
  child: 'retry',
  paused: 'retry',
  held: 'retry',
  attached: 'retry',
  live: 'retry',
  'in-use': 'retry',
  'tree-busy': 'retry',
  'state-changed': 'retry',
  'in-progress': 'retry',
  'reap-in-progress': 'retry',
  'reclaim-in-progress': 'retry',
};

/** `EXPIRE_TOKEN_KIND` read TOTALLY: the word's kind, or null for one this build was never compiled to know. */
export const expireTokenKind = (token: string): 'gone' | 'terminal' | 'retry' | null =>
  Object.prototype.hasOwnProperty.call(EXPIRE_TOKEN_KIND, token)
    ? EXPIRE_TOKEN_KIND[token as ExpireToken]
    : null;

const isExpireToken = (v: unknown): v is ExpireToken => typeof v === 'string' && expireTokenKind(v) !== null;

/** The two BOX words (wave 3's plan, "Wave 3b inherits", the verb): `cmd_ws_expire` refuses through `_lc_refuse` —
 *  exit 1, NOTHING on stdout — when the box has no util-linux `flock` (`flock-unavailable`: PERMANENT for that box)
 *  or the reap lock cannot be opened (`lock-unopenable`: retryable). Told apart from a COMPOSITION error (a usage
 *  line, `bad token`, `bad session id`, a blank `--actor`), which also exits 1 with an empty stdout, by stderr's
 *  exact shape — never by the empty stdout alone, which would retry the first for ever or blame the argv for the
 *  second. */
export type ExpireBoxWord = 'flock-unavailable' | 'lock-unopenable';

// ── how long, how often ──────────────────────────────────────────────────────

/** How many consecutive `in-use` answers before the row is REPORTED (the coordinator's ruling (G)): a standing
 *  in-use refusal is EXPECTED — an orphan `nohup` server, a tmux or fsmonitor daemon left in the tree — and after
 *  this many asks it becomes an attention entry naming the pid, its command and the path. Never a ceiling: the lane
 *  never deletes a tree a process stands in, and never kills. */
export const EXPIRE_IN_USE_ATTENTION_PASSES = 3;

/** How long an audit that answered with NO `expiresAt` (an older ccd) is left before the row is audited again — the
 *  box may be upgraded meanwhile. Not a threshold of the expiry: nothing is ever composed on that answer. */
export const EXPIRE_NO_EVIDENCE_RETRY_MS = 60 * 60_000;

/** In shadow, how long a "would expire" record stands before the row is audited again, so the record follows the
 *  row (someone opened a shell in it, it was restored) without auditing it every pass. */
export const EXPIRE_SHADOW_REAUDIT_MS = 15 * 60_000;

/** The failure backoff's ceiling: after the k-th consecutive `failed` answer the row waits
 *  `min(this, passMs × 2^k)`, and a run of failures that has lasted this long is reported (and still retried). */
export const EXPIRE_FAILURE_CEILING_MS = 60 * 60_000;

/** How many audits the lane runs in one pass to LEARN rows' expiry instants. The first armed pass faces every
 *  archived row at once; this spreads that over passes instead of asking the box for thirty audits in a minute. */
export const EXPIRE_AUDITS_PER_PASS = 3;

// ── the box's two documents ──────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
const WIP_SHAPE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const epochOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;

/** One process the audit found working in the tree (`in-use`): its pid, its command (`""` when the box could not
 *  read it) and its working directory. */
export interface ExpireInUse { readonly pid: number; readonly comm: string; readonly cwd: string }

/** THE ONE READER of the audit document's `expiresAt` (the coordinator's ruling (C)). THREE answers, never folded:
 *  `at` — the instant, ccd's own arithmetic; `none` — ccd PRINTED the key and could read no archive (`null`); and
 *  `absent` — the key is not there at all: an older ccd, which is NO EVIDENCE. Both of the last two compose nothing;
 *  they are told apart because only `absent` is fixed by upgrading the box. */
export type ExpiresAtRead =
  | { readonly kind: 'at'; readonly at: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'absent' };

export function expireAuditExpiresAt(doc: Record<string, unknown>): ExpiresAtRead {
  if (!Object.prototype.hasOwnProperty.call(doc, 'expiresAt')) return { kind: 'absent' };
  const at = epochOrNull(doc.expiresAt);
  return at === null ? { kind: 'none' } : { kind: 'at', at };
}

/** `ccd ws-audit --session <id> --expire`'s answer. `unreadable` is its own arm: a document this build cannot read is
 *  never a refusal and never a token. */
export type ExpireAuditRead =
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'document'; readonly archivedAt: number | null; readonly expiresAt: ExpiresAtRead;
      readonly sensitive: number; readonly inUse: readonly ExpireInUse[];
      readonly verdict:
        | { readonly kind: 'expirable'; readonly token: string }
        | { readonly kind: 'refused'; readonly token: ExpireToken; readonly detail: string } };

/** `ok` is the audit's exit status: ANY exit 1 — `unmeasured` included — is `unreadable`, whatever the document
 *  says, so no exit-1 document is ever spent. */
export function parseExpireAudit(sessionId: string, ok: boolean, stdout: string): ExpireAuditRead {
  let v: unknown;
  try { v = JSON.parse(stdout.trim()); } catch { return { kind: 'unreadable', detail: 'ws-audit --expire printed no JSON document' }; }
  if (!isRecord(v)) return { kind: 'unreadable', detail: 'ws-audit --expire printed no JSON object' };
  if (v.session !== sessionId) {
    return { kind: 'unreadable', detail: `ws-audit --expire answered for ${String(v.session)}, not ${sessionId}` };
  }
  if (v.mode !== 'expire') return { kind: 'unreadable', detail: 'ws-audit answered without "mode":"expire"' };
  if (!ok) {
    return { kind: 'unreadable', detail: `ws-audit --expire measured nothing: ${typeof v.detail === 'string' ? v.detail : ''}` };
  }
  const sensitive = Array.isArray(v.sensitive) ? v.sensitive.length : 0;
  const inUse = Array.isArray(v.inUse) ? v.inUse.flatMap((u): ExpireInUse[] => (isRecord(u)
    && typeof u.pid === 'number' && Number.isSafeInteger(u.pid) && typeof u.comm === 'string' && typeof u.cwd === 'string'
    ? [{ pid: u.pid, comm: u.comm, cwd: u.cwd }] : [])) : [];
  const base = { kind: 'document' as const, archivedAt: epochOrNull(v.archivedAt), expiresAt: expireAuditExpiresAt(v),
    sensitive, inUse };
  if (v.verdict === 'expirable') {
    if (typeof v.token !== 'string' || !TOKEN_SHAPE.test(v.token)) {
      return { kind: 'unreadable', detail: 'ws-audit --expire said expirable with no 64-hex token' };
    }
    return { ...base, verdict: { kind: 'expirable', token: v.token } };
  }
  if (isExpireToken(v.verdict)) {
    return { ...base, verdict: { kind: 'refused', token: v.verdict, detail: typeof v.detail === 'string' ? v.detail : '' } };
  }
  return { kind: 'unreadable', detail: `ws-audit --expire answered a verdict this build does not know: ${String(v.verdict)}` };
}

/** The exact stderr ccd's `die` prints for a call the SERVER composed wrong (`cmd_ws_expire`'s argument dies, before
 *  its lock). Anchored on the whole prefix-stripped message, never a substring. */
const EXPIRE_COMPOSITION_DIES: readonly RegExp[] = [
  /^usage: ccd ws-expire --expect <token> --session <id> \[--surface <word>\] \[--actor <text>\] \[--reason <text>\]$/,
  /^bad token$/,
  /^bad session id$/,
  /^--actor must be non-blank$/,
  /^--reason must be non-blank$/,
  /^--actor is longer than \d+ bytes$/,
  /^--reason is longer than \d+ bytes$/,
  // NOT `python3 unavailable — …`, though wave 3's hand-over grouped it with these: that `die` is a fact about the
  // BOX (no python3 there), not about the argv, so it reads as `failed` — retried with backoff and reported past the
  // ceiling — never as "the server composed a call ccd rejected", which is never retried.
];

/** `flock-unavailable`'s die: that one `ccd:` line, alone. */
const FLOCK_UNAVAILABLE = 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised';

/** `lock-unopenable`'s die, MEASURED by the reclaim lane (review 170 fr-I I1): bash's own redirection diagnostic for
 *  the lock path FIRST, then `ccd: cannot open the reap lock at <path>` LAST. Recognised whole-output. */
function lockUnopenable(err: string): string | null {
  const lines = err.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const m = /^ccd: cannot open the reap lock at (.+)$/.exec(last);
  if (!m) return null;
  const lockPath = m[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bashLine = new RegExp(`^.*: line [0-9]+: ${lockPath}: .+$`);
  return lines.slice(0, -1).every((l) => bashLine.test(l)) ? last.slice('ccd: '.length) : null;
}

/** `ccd ws-expire …`'s answer (wave 3's plan, "Wave 3b inherits", the verb). Three documents — `expired` and
 *  `refused` at exit 0, `failed` at exit 1 (the breadcrumb is kept and the next attempt resumes it) — and three
 *  conditions that are no document: the two BOX words, and a COMPOSITION error. Anything else with an empty stdout is
 *  a call cut short: `failed`, resumable. */
export type ExpireVerbRead =
  | { readonly kind: 'expired'; readonly archivedAt: number | null; readonly wip: string | null | 'unreadable';
      readonly secretsDropped: number | 'unreadable' }
  | { readonly kind: 'refused'; readonly token: ExpireToken; readonly detail: string }
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string };

export function parseExpireResult(sessionId: string, stdout: string, stderr: string): ExpireVerbRead {
  let v: unknown = null;
  try { v = JSON.parse(stdout.trim()); } catch { v = null; }
  if (isRecord(v)) {
    if (typeof v.expired === 'string') {
      if (v.expired !== sessionId) {
        return { kind: 'failed', resumable: false, detail: `ws-expire reported expiring ${v.expired}, not ${sessionId}` };
      }
      const wip = v.wip === null ? null : typeof v.wip === 'string' && WIP_SHAPE.test(v.wip) ? v.wip : 'unreadable';
      const secretsDropped = typeof v.secretsDropped === 'number' && Number.isSafeInteger(v.secretsDropped)
        && v.secretsDropped >= 0 ? v.secretsDropped : 'unreadable';
      return { kind: 'expired', archivedAt: epochOrNull(v.archivedAt), wip, secretsDropped };
    }
    if (typeof v.refused === 'string') {
      const detail = typeof v.detail === 'string' ? v.detail : '';
      return isExpireToken(v.refused) ? { kind: 'refused', token: v.refused, detail }
        : { kind: 'failed', resumable: false, detail: `ws-expire refused with a word this build does not know: ${v.refused}` };
    }
    if (typeof v.failed === 'string') {
      const detail = typeof v.detail === 'string' ? v.detail : '';
      return { kind: 'failed', resumable: v.failed !== 'probe-unmeasured', detail: detail === '' ? v.failed : `${v.failed}: ${detail}` };
    }
  }
  const err = stderr.trim();
  if (err === FLOCK_UNAVAILABLE) return { kind: 'box', word: 'flock-unavailable', detail: err.slice('ccd: '.length) };
  const lock = lockUnopenable(err);
  if (lock !== null) return { kind: 'box', word: 'lock-unopenable', detail: lock };
  const msg = err.startsWith('ccd: ') ? err.slice('ccd: '.length) : err;
  if (EXPIRE_COMPOSITION_DIES.some((p) => p.test(msg))) return { kind: 'composition', detail: msg };
  return { kind: 'failed', resumable: true,
    detail: err === '' ? 'ws-expire answered nothing — it may have been cut short; the next attempt resumes it' : err };
}

// ── eligibility ──────────────────────────────────────────────────────────────

/** The coordination store's answers for one row, read once per pass (`lastRunBySession`, and the review runs naming
 *  the row). `ok:false` is a store this pass could not read: every row is ineligible. */
export type ExpiryStoreRead =
  | { readonly ok: false; readonly detail: string }
  | { readonly ok: true; readonly openWorker: boolean; readonly openClaimant: boolean; readonly reviewing: boolean };

export interface ArchivedExpiryInput {
  readonly sessionId: string;
  readonly workspace: string | null;
  /** The registry's archive epoch (seconds), `null` when the row is not archived. */
  readonly archivedAt: number | null;
  readonly child: ChildMark;
  readonly identityMeasured: boolean;
  readonly held: string | null;
  readonly store: ExpiryStoreRead;
  /** What the lane has LEARNED from this archive's audit: the instant (seconds), `null` before any audit read one. */
  readonly expiresAt: number | null;
  readonly nowMs: number;
}

export type ArchivedExpirySkip =
  | 'not-a-workspace' | 'not-archived' | 'child' | 'identity-unmeasured' | 'store-unreadable' | 'open-run'
  | 'coordinating' | 'review-open' | 'expiry-unknown' | 'not-yet' | 'held';

export type ArchivedExpiryVerdict =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly why: ArchivedExpirySkip };

/**
 * IS THIS ROW AN ARCHIVED WORKSPACE THE SERVER MAY ASK TO EXPIRE NOW (spec §5.3, "A row is eligible when")? Every
 * conjunct in the spec's order, every doubt ineligible:
 *  - a workspace (a main checkout is never expired) with an archive;
 *  - no child marker — `child` or `unreadable` is CCR-15's lane's, never this one's;
 *  - identity measured;
 *  - the store read; no non-terminal run names it as `sessionId` or as `claimedBy`; it is not the `sessionId` of a
 *    review run whose reviewed run is not terminal (CCR-15 R16, applied to unmarked reviewers: the report lives in
 *    this workspace's clips);
 *  - its expiry instant is KNOWN (ccd's, from the audit) and has come;
 *  - no hold. A row past its instant and still held is `held` — the attention list's, never acted on.
 * The switch and the twice-observed rule are the lane's (`watch.ts`), applied on top.
 */
export function archivedExpiryVerdict(i: ArchivedExpiryInput): ArchivedExpiryVerdict {
  const skip = (why: ArchivedExpirySkip): ArchivedExpiryVerdict => ({ eligible: false, why });
  if (i.workspace === null) return skip('not-a-workspace');
  if (i.archivedAt === null) return skip('not-archived');
  if (i.child.kind !== 'none') return skip('child');
  if (!i.identityMeasured) return skip('identity-unmeasured');
  const kept = archivedExpiryStoreSkip(i.store);
  if (kept !== null) return skip(kept);
  if (i.expiresAt === null) return skip('expiry-unknown');
  if (i.nowMs < i.expiresAt * 1000) return skip('not-yet');
  if (i.held !== null) return skip('held');
  return { eligible: true };
}

/** The store's conjuncts alone, in the verdict's order — the ONE reading of an `ExpiryStoreRead`, shared by the
 *  verdict (the lane's pass) and the executor (its re-read at the act), so the two can never weigh a run apart. */
export type ArchivedExpiryStoreSkip = Extract<ArchivedExpirySkip, 'store-unreadable' | 'open-run' | 'coordinating' | 'review-open'>;

export function archivedExpiryStoreSkip(store: ExpiryStoreRead): ArchivedExpiryStoreSkip | null {
  if (!store.ok) return 'store-unreadable';
  if (store.openWorker) return 'open-run';
  if (store.openClaimant) return 'coordinating';
  if (store.reviewing) return 'review-open';
  return null;
}

/** A REVIEW run naming this row as `sessionId`, whose reviewed run is not terminal, keeps it (spec §5.3, CCR-15 R16).
 *  A reviewed run this pass could not read, or that is absent, is doubt — and doubt keeps. */
export const reviewKeeps = (reviewed: { readonly kind: 'run'; readonly state: RunState } | { readonly kind: 'absent' } | { readonly kind: 'unreadable' }): boolean =>
  reviewed.kind !== 'run' || !(TERMINAL_RUN_STATES as readonly RunState[]).includes(reviewed.state);

// ── the lane's memory of one row ─────────────────────────────────────────────

/** IN MEMORY ONLY: a restart loses it, and losing it can only DELAY an expiry (the instant is learned again, and
 *  eligibility must be seen twice again) — never cause one. Keyed by the ARCHIVE: a row whose `archivedAt` changes
 *  (returned and archived again) starts a fresh entry, so nothing learned about one archive is applied to another. */
export interface ArchivedExpiryEntry {
  readonly archivedAt: number;
  /** ccd's instant for THIS archive (seconds), once an audit read one. */
  readonly expiresAt: number | null;
  /** The earliest the row may be audited or asked again (ms). */
  readonly nextAskAt: number;
  /** The first pass of the current unbroken run of eligible verdicts (ms), or null. */
  readonly eligibleSince: number | null;
  /** The previous attempt's outcome key (`kind` or `kind:word`), so a feed row is written when it CHANGES, not every
   *  pass a standing refusal is met again. */
  readonly lastOutcome: string | null;
  /** Consecutive `in-use` answers, and the latest one's processes. */
  readonly inUseRun: number;
  readonly inUse: readonly ExpireInUse[];
  /** Consecutive `failed` answers, and since when (ms). */
  readonly failures: number;
  readonly failingSince: number | null;
  /** What the attention list says about this row, or null. */
  readonly report: ExpiryReport | null;
}

/** One attention entry's facts before it is worded. */
export type ExpiryReport =
  | { readonly kind: 'would-expire'; readonly at: number; readonly sensitive: number }
  | { readonly kind: 'held'; readonly at: number; readonly reason: string }
  | { readonly kind: 'in-use'; readonly at: number; readonly inUse: readonly ExpireInUse[]; readonly passes: number }
  | { readonly kind: 'refused'; readonly at: number; readonly token: ExpireToken; readonly detail: string }
  /** `final`: the row is not asked again for this archive — a composition error, or a failure the box said will not
   *  resume — so its sentence never promises a retry. Absent on a failure that is still being retried. */
  | { readonly kind: 'failing'; readonly at: number; readonly detail: string; readonly final?: true }
  | { readonly kind: 'no-evidence'; readonly at: number };

export const archivedExpiryEntry = (archivedAt: number): ArchivedExpiryEntry => ({
  archivedAt, expiresAt: null, nextAskAt: 0, eligibleSince: null, lastOutcome: null, inUseRun: 0, inUse: [],
  failures: 0, failingSince: null, report: null,
});

/** The entry for this pass: the previous one while its archive is still the row's, else a fresh one. */
export const archivedExpiryEntryFor = (prev: ArchivedExpiryEntry | undefined, archivedAt: number): ArchivedExpiryEntry =>
  prev !== undefined && prev.archivedAt === archivedAt ? prev : archivedExpiryEntry(archivedAt);

/** What an audit run only to LEARN the instant taught the entry. `absent` (an older ccd) and `none` leave it unknown
 *  and wait `EXPIRE_NO_EVIDENCE_RETRY_MS`; an audit that read a DIFFERENT archive than the registry's is a row moving
 *  under the lane — learned nothing, asked again next pass. An audit that could not be READ, or that read NO archive
 *  (a refusal ccd answered before it read the stamp: an interrupted ws-reap's breadcrumb, `reap-in-progress`), taught
 *  nothing either, and it is not asked again every pass: it climbs the failure ladder and is REPORTED, so a row the
 *  lane cannot learn is on the attention list — the shadow record is the operator's arming evidence — and never takes a
 *  learn slot each pass (review 313, parked item 1). A `gone` word is a return, which the next pass drops unreported.
 *  A document with NO `expiresAt` key is an older ccd's (the current one prints the key on every expire audit, and the
 *  breadcrumb's carries `null`), even when it names no archive — an older ccd prints `archivedAt` only past its seven-day
 *  age check — so it is no evidence, never a failure: only an upgrade of the box fixes it. */
export function archivedExpiryLearned(entry: ArchivedExpiryEntry, read: ExpireAuditRead, nowMs: number, passMs: number): ArchivedExpiryEntry {
  if (read.kind === 'document' && read.archivedAt === null && read.verdict.kind === 'refused'
    && EXPIRE_TOKEN_KIND[read.verdict.token] === 'gone') return { ...entry, nextAskAt: nowMs + passMs };
  if (read.kind === 'document' && read.expiresAt.kind === 'absent') {
    return { ...entry, failures: 0, failingSince: null, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS,
      report: { kind: 'no-evidence', at: nowMs } };
  }
  if (read.kind === 'unreadable' || read.archivedAt === null) {
    const why = read.kind === 'unreadable' ? read.detail : `ws-audit --expire read no archive (${read.verdict.kind === 'refused'
      ? `${read.verdict.token}${read.verdict.detail === '' ? '' : `: ${read.verdict.detail}`}` : 'expirable'})`;
    const failures = entry.failures + 1;
    const failingSince = entry.failingSince ?? nowMs;
    return { ...entry, failures, failingSince, nextAskAt: nowMs + archivedExpiryBackoffMs(failures, passMs),
      report: { kind: 'failing', at: failingSince, detail: `its expiry could not be learned — ${why}` } };
  }
  if (read.archivedAt !== entry.archivedAt) return { ...entry, nextAskAt: nowMs + passMs };
  const learned = { failures: 0, failingSince: null, report: entry.report?.kind === 'failing' ? null : entry.report };
  if (read.expiresAt.kind !== 'at') {
    return { ...entry, ...learned, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS,
      report: read.expiresAt.kind === 'absent' ? { kind: 'no-evidence', at: nowMs } : learned.report };
  }
  return { ...entry, ...learned, expiresAt: read.expiresAt.at, nextAskAt: 0,
    report: learned.report?.kind === 'no-evidence' ? null : learned.report };
}

/** A report whose row the lane will NEVER ask again for this archive (`nextAskAt` is +∞ — `archivedExpiryNextEntry`'s
 *  terminal-refusal, non-resumable-failure and composition arms): the report is the row's only trace on the attention
 *  list, so a hold must not take its place — nothing would ever put it back. */
export const expiryReportIsFinal = (r: ExpiryReport | null): boolean =>
  r !== null && ((r.kind === 'failing' && r.final === true) || (r.kind === 'refused' && EXPIRE_TOKEN_KIND[r.token] === 'terminal'));

/** One pass's verdict, folded into memory. THE TWICE-OBSERVED RULE (spec §5.3: "all of the above held on the
 *  previous pass too"): an eligible verdict seeds `eligibleSince` on its first pass and makes the row DUE only on a
 *  later one; any other verdict ends the run. And THE HELD REPORT (spec §5.3: "An archived workspace that is still
 *  held after 7 days is not acted on. It goes on the attention list."): `held` is listed with its reason, and the
 *  listing goes when the hold does. AND THE RECORD FOLLOWS THE ROW (review 313, F1): an ineligible sighting ends a
 *  `would-expire` or `in-use` report too, with the run of in-use answers. Such a row is never due, so it is never
 *  audited again, and a report it kept would stand on the attention list — the operator's arming evidence — for as long
 *  as the condition lasts. The box's own verdicts (`refused`, `failing`, `no-evidence`) stand: they are about the box.
 *  A report so cleared also resets `nextAskAt` to 0: one transient ineligible pass (a store read that failed once, an
 *  identity unmeasured) must not hide a row that is due again behind the shadow wait the report carried — it is
 *  re-audited as soon as it is twice-observed eligible, and the twice-observed rule still gates that. A hold that
 *  REPLACES a would-expire, in-use or retryable failing report resets it for the same reason (a final report is kept,
 *  wait and all). */
export function archivedExpirySighted(
  entry: ArchivedExpiryEntry, v: ArchivedExpiryVerdict, held: string | null, nowMs: number,
): ArchivedExpiryEntry {
  const eligibleSince = v.eligible ? (entry.eligibleSince ?? nowMs) : null;
  if (!v.eligible && v.why === 'held' && held !== null) {
    // A row the lane has stopped asking keeps its own report — listed with its reason while held and after the hold goes.
    if (expiryReportIsFinal(entry.report)) return eligibleSince === entry.eligibleSince ? entry : { ...entry, eligibleSince };
    const at = entry.report?.kind === 'held' ? entry.report.at : nowMs;
    // A hold that REPLACES a would-expire, in-use or retryable failing report ends it as an ineligible sighting does, so
    // it resets `nextAskAt` the same way: the release clears the hold's own report, and left at the replaced report's
    // wait (the shadow wait, a failure's backoff) the row would be unlisted and not due until that wait ran out — absent
    // from the list the operator arms on. Re-audited as soon as it is due again; the twice-observed rule still gates it.
    const replaces = entry.report?.kind === 'would-expire' || entry.report?.kind === 'in-use' || entry.report?.kind === 'failing';
    return { ...entry, eligibleSince, inUseRun: 0, inUse: [], ...(replaces ? { nextAskAt: 0 } : {}),
      report: { kind: 'held', at, reason: held } };
  }
  const ends = !v.eligible && (entry.report?.kind === 'would-expire' || entry.report?.kind === 'in-use');
  const report = entry.report?.kind === 'held' || ends ? null : entry.report;
  const run = ends ? { inUseRun: 0, inUse: [] as readonly ExpireInUse[], nextAskAt: 0 } : {};
  return eligibleSince === entry.eligibleSince && report === entry.report ? entry : { ...entry, ...run, eligibleSince, report };
}

/** DUE: eligible on a previous pass and still, and past `nextAskAt`. */
export const archivedExpiryDue = (entry: ArchivedExpiryEntry, nowMs: number): boolean =>
  entry.eligibleSince !== null && entry.eligibleSince < nowMs && nowMs >= entry.nextAskAt;

/** Why the executor asked nothing of the box this time: no `expire-v1`, the cleanup switch (or a listing that could
 *  not rule it out), one of the store's conjuncts RE-READ at the act (`ArchivedExpiryStoreSkip`: a run bound to the
 *  row since the lane's pass, or a store that cannot say), a person at the session, or an audit of another archive
 *  than the one the lane queued. */
export type ArchivedExpiryDeferWhy = 'unsupported' | 'paused-at-server' | ArchivedExpiryStoreSkip | 'presence' | 'state-changed';

/** The one executor's answer, as the lane folds it into memory. */
export type ArchivedExpiryOutcome =
  | { readonly kind: 'expired' }
  | { readonly kind: 'would-expire'; readonly sensitive: number }
  | { readonly kind: 'deferred'; readonly why: ArchivedExpiryDeferWhy; readonly detail: string }
  | { readonly kind: 'refused'; readonly token: ExpireToken; readonly detail: string; readonly inUse: readonly ExpireInUse[];
      /** The instant the refusing AUDIT gave (seconds), when it gave one — so a `not-expired` after the lane learned
       *  an earlier instant (the threshold was raised: §9's lever) is learned afresh, never re-asked every pass. */
      readonly auditExpiresAt?: number | null }
  | { readonly kind: 'gone' }
  /** `resumable` is the box's own answer (`ExpireVerbRead.failed.resumable`), CARRIED, never narrowed (review 313,
   *  parked item 4): `false` — a wrong-row `expired`, a refusal word this build does not know, `probe-unmeasured` — is
   *  not something waiting cures, so the row is reported and not asked again for this archive. */
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string }
  | { readonly kind: 'no-evidence' };

const EXPIRY_OUTCOME_KINDS: Readonly<Record<ArchivedExpiryOutcome['kind'], true>> = {
  expired: true, 'would-expire': true, deferred: true, refused: true, gone: true, failed: true, box: true,
  composition: true, 'no-evidence': true,
};
const EXPIRY_DEFER_WHYS: Readonly<Record<ArchivedExpiryDeferWhy, true>> = {
  unsupported: true, 'paused-at-server': true, 'store-unreadable': true, 'open-run': true, coordinating: true,
  'review-open': true, presence: true, 'state-changed': true,
};
const EXPIRE_BOX_WORDS: Readonly<Record<ExpireBoxWord, true>> = { 'flock-unavailable': true, 'lock-unopenable': true };

/** Every kebab word this lane spells as a literal — ccd's nineteen, the two box words, the outcome kinds and the defer
 *  reasons — for `mail-routes.test.ts`'s scan of `server/src/coord`, where the executor lives. None is a mail rejection
 *  or a run refusal: no `refused` or `reject.code` ever carries one. Derived from the Records above, never a list. */
export function isArchivedExpiryKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return expireTokenKind(v) !== null || own(EXPIRE_BOX_WORDS) || own(EXPIRY_OUTCOME_KINDS) || own(EXPIRY_DEFER_WHYS);
}

/** The outcome's key, for "write a feed row only when it changes". */
export const archivedExpiryOutcomeKey = (o: ArchivedExpiryOutcome): string =>
  o.kind === 'refused' || o.kind === 'box' ? `${o.kind}:${o.kind === 'refused' ? o.token : o.word}`
    : o.kind === 'deferred' ? `deferred:${o.why}` : o.kind;

/** The failure backoff: `min(EXPIRE_FAILURE_CEILING_MS, passMs × 2^k)`. */
export const archivedExpiryBackoffMs = (failures: number, passMs: number): number =>
  Math.min(EXPIRE_FAILURE_CEILING_MS, passMs * 2 ** Math.min(failures, 20));

/**
 * The entry after an attempt — `null` when the row is finished with (expired, or gone from the population). Every
 * retryable answer is asked again on a later pass, a TERMINAL refusal and a COMPOSITION error are never asked again
 * for this archive (the first is the box's proof, the second this server's bug: retrying either would repeat it
 * every minute), and both are reported.
 */
export function archivedExpiryNextEntry(
  entry: ArchivedExpiryEntry, o: ArchivedExpiryOutcome, nowMs: number, passMs: number,
): ArchivedExpiryEntry | null {
  const base = { ...entry, lastOutcome: archivedExpiryOutcomeKey(o) };
  const steady = { inUseRun: 0, inUse: [] as readonly ExpireInUse[], failures: 0, failingSince: null };
  switch (o.kind) {
    case 'expired': case 'gone': return null;
    case 'would-expire':
      return { ...base, ...steady, nextAskAt: nowMs + EXPIRE_SHADOW_REAUDIT_MS,
        report: { kind: 'would-expire', at: entry.report?.kind === 'would-expire' ? entry.report.at : nowMs, sensitive: o.sensitive } };
    case 'no-evidence':
      return { ...base, ...steady, expiresAt: null, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS, report: { kind: 'no-evidence', at: nowMs } };
    case 'deferred':
      // A pause or a missing verb the EXECUTOR saw (its own registry listing, its own caps read) is one the tick's
      // listing may never have shown — a switch raised and lowered inside one cadence window — so the sighting from
      // before it is forgotten here too: a lowered switch needs two FRESH passes, whoever saw it.
      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null,
        ...(o.why === 'paused-at-server' || o.why === 'unsupported' ? { eligibleSince: null } : {}) };
    case 'refused': {
      const kind = EXPIRE_TOKEN_KIND[o.token];
      if (kind === 'gone') return null;
      if (kind === 'terminal') {
        return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
          report: { kind: 'refused', at: nowMs, token: o.token, detail: o.detail } };
      }
      if (o.token === 'not-expired') {
        // ccd says the instant has not come — the lane's learned one is stale (the threshold was raised, or the two
        // clocks disagree). Learn the audit's instant, and start the twice-observed rule again from it: never
        // re-asked every pass on the old one. No instant given: unknown, so the next pass learns it.
        return { ...base, ...steady, expiresAt: o.auditExpiresAt ?? null, eligibleSince: null, nextAskAt: nowMs + passMs,
          report: null };
      }
      if (o.token === 'in-use') {
        const passes = entry.inUseRun + 1;
        return { ...base, failures: 0, failingSince: null, inUseRun: passes, inUse: o.inUse, nextAskAt: nowMs + passMs,
          report: passes >= EXPIRE_IN_USE_ATTENTION_PASSES
            ? { kind: 'in-use', at: entry.report?.kind === 'in-use' ? entry.report.at : nowMs, inUse: o.inUse, passes }
            : null };
      }
      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null };
    }
    case 'failed': case 'box': {
      if (o.kind === 'failed' && !o.resumable) {
        // The box said this will not resume: reported AT ONCE and never asked again for this archive — never an hour
        // of retries before anyone hears of it (review 313, parked item 4).
        return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
          report: { kind: 'failing', at: nowMs, detail: o.detail, final: true } };
      }
      // `flock-unavailable` is the BOX's, and the lane stops asking that box at all (`watch.ts`); for the row it is
      // a failure like `lock-unopenable`, backed off and reported past the ceiling.
      const failures = entry.failures + 1;
      const failingSince = entry.failingSince ?? nowMs;
      return { ...base, inUseRun: 0, inUse: [], failures, failingSince,
        nextAskAt: nowMs + archivedExpiryBackoffMs(failures, passMs),
        report: nowMs - failingSince >= EXPIRE_FAILURE_CEILING_MS || o.kind === 'box'
          ? { kind: 'failing', at: failingSince, detail: o.detail } : null };
    }
    case 'composition':
      return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
        report: { kind: 'failing', at: nowMs, detail: `the server composed a call ccd rejected: ${o.detail}`, final: true } };
  }
}

// ── the attention list ───────────────────────────────────────────────────────

const iso = (epochS: number): string => new Date(epochS * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** WHAT A PROCESS IS, before anything suggests ending it (the coordinator's ruling (G)): the fleet's own tmux server
 *  is a `tmux: server` too, and ending THAT ends every session on the box. So the sentence names the pid AND its
 *  command AND where it stands, and says to find out what it is first — it never says to kill. */
export function expiryInUseSentence(inUse: readonly ExpireInUse[], passes: number): string {
  const who = inUse.length === 0 ? 'a process'
    : inUse.map((u) => `process ${u.pid} (${u.comm === '' ? 'its command could not be read' : `“${u.comm}”`}) in ${u.cwd}`)
      .join(', ');
  return `kept: ${who} has its working directory in this archived workspace, and has kept it from being cleaned up `
    + `for ${passes} passes. Find out what it is before ending it — the fleet’s own tmux server is also a “tmux: server”, `
    + 'and ending that ends every session. Nothing is deleted while it stands.';
}

/** The words for one report. */
export function expiryReportSentence(r: ExpiryReport, expiresAt: number | null): string {
  switch (r.kind) {
    case 'would-expire':
      return `would be cleaned up now${expiresAt === null ? '' : ` (due ${iso(expiresAt)})`}: the cleanup is not armed `
        + `(shadow), so nothing was deleted. ${r.sensitive === 0 ? 'No secret-shaped file would be dropped.'
          : `${r.sensitive} secret-shaped ${r.sensitive === 1 ? 'file' : 'files'} would be dropped and recorded by path.`}`;
    case 'held':
      // The INSTANT, never a period: the threshold is ccd's, and a sentence that typed it would go stale the day
      // `WS_EXPIRE_AFTER_S` moves (review 313, F3).
      return `held (“${r.reason}”) past its expiry${expiresAt === null ? '' : ` (due ${iso(expiresAt)})`}, so it is not `
        + 'cleaned up — release the hold or restore it.';
    case 'in-use': return expiryInUseSentence(r.inUse, r.passes);
    case 'refused': return `not cleaned up: ccd refused (${r.token}) — ${r.detail === '' ? 'no detail' : r.detail}`;
    case 'failing':
      return r.final === true ? `cleanup stopped: ${r.detail}. It is not asked again for this archive.`
        : `cleanup keeps failing: ${r.detail}. It is retried, backing off in between.`;
    case 'no-evidence':
      return 'not cleaned up: the fleet box’s ccd does not say when this archive expires (an older build), so the '
        + 'server composes nothing for it until the box is updated.';
  }
}

/** THE ATTENTION LIST, derived from the lane's memory alone, newest first. A row in memory with a report is listed;
 *  a held row past its instant is listed by the lane as a `held` report. */
export function expiryAttention(
  entries: ReadonlyMap<string, ArchivedExpiryEntry>,
): ExpiryAttention[] {
  const out: ExpiryAttention[] = [];
  for (const [sessionId, e] of entries) {
    if (e.report === null) continue;
    out.push({ sessionId, kind: e.report.kind, sentence: expiryReportSentence(e.report, e.expiresAt),
      archivedAt: e.archivedAt, expiresAt: e.expiresAt, at: e.report.at });
  }
  return out.sort((a, b) => b.at - a.at || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}
