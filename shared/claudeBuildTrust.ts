// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md; the operator's ruling SH-1 of 2026-11-10). L0: imports
// only `shared/` siblings (the PWA bundles this file). THE TRUSTED SET OF CLAUDE CODE BUILDS IS DATA: one coord.db row per
// build (`claude_builds`, written by `CoordStore` alone), and a build is trusted only when its capture on the test box
// passed: the box recorded the build's hook and status-file output and the replay tests passed over it. There is no
// floor and no range. A build above every passed one is as untrusted as one below them.
//
// ONE DECIDER. `buildTrustOf` is what every reader of a build-coupled contract asks: child approvals now, the event readers
// that replace the pane parsers when they land. It answers `trusted`, or `untrusted` with a typed reason the reader refuses
// with, never a guess. The same file holds the queue's two pure choices (`unrecordedBuilds`, `nextCaptureJob`) and the
// capture answer's one reader (`readBuildCaptureResult`), so the lane decides nothing of its own.
import { compareClaudeVersions, isClaudeVersion } from './claudeVersion.js';
import type { DeliveryBuildView } from './deliveryResult.js';

// ── the record ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a build's capture stands. `queued`: recorded, no verdict yet (a job may be out). `pass` and `fail` are verdicts. */
export type ClaudeBuildCapture = 'queued' | 'pass' | 'fail';
export const CLAUDE_BUILD_CAPTURE_MAP: Record<ClaudeBuildCapture, true> = { queued: true, pass: true, fail: true };
export const CLAUDE_BUILD_CAPTURES: readonly ClaudeBuildCapture[] = Object.keys(CLAUDE_BUILD_CAPTURE_MAP) as ClaudeBuildCapture[];

/** Where a row came from. `rig`: the 2026-10-18 rig record, seeded by the migration (2.1.296 and 2.1.300 to 2.1.302).
 *  `fleet`: a session on the fleet ran the build, and the queue recorded it. */
export type ClaudeBuildSource = 'rig' | 'fleet';
export const CLAUDE_BUILD_SOURCE_MAP: Record<ClaudeBuildSource, true> = { rig: true, fleet: true };

/** Why the queue's last try at a build sent no job, each its own word (capture runner spec 2026-11-22 §2.2, §2.5 Table 6).
 *  `no-test-box`: no box answers. `no-runner`: the box has no capture runner. `build-absent`: the box holds no checked copy of
 *  the build, and the copy that follows it (below) did not change that. `path-refused`: the box's write guard refused a path
 *  the capture would write. `not-started`: the frame never left the server (the agent link was down). `busy`: the fleet agent
 *  is waiting on another capture. The copy's own three: `copy-refused` (the fleet's copy is not one ccrc sends: absent, not a
 *  regular file, or over the size cap), `copy-failed` (it did not arrive intact, or the lane failed on the way) and
 *  `no-admin-lane` (no admin lane is connected to carry it). A job that went out and got no answer is not one of these: it
 *  was sent, and counts as an attempt. */
export type BuildCaptureNotSent =
  | 'no-test-box' | 'no-runner' | 'build-absent' | 'path-refused' | 'not-started' | 'busy'
  | BuildCopyFailure;

/** Why the copy of a build to the test box did not place it (spec §2.2): the not-sent words a failed copy leaves. */
export type BuildCopyFailure = 'copy-refused' | 'copy-failed' | 'no-admin-lane';
const BUILD_COPY_FAILURE_MAP: Record<BuildCopyFailure, true> = {
  'copy-refused': true, 'copy-failed': true, 'no-admin-lane': true,
};

export const BUILD_CAPTURE_NOT_SENT_MAP: Record<BuildCaptureNotSent, true> = {
  'no-test-box': true, 'no-runner': true, 'build-absent': true, 'path-refused': true, 'not-started': true, busy: true,
  ...BUILD_COPY_FAILURE_MAP,
};

/** What the queue's try at a build did: a job went out (`sent`, answered or not), or none could (why). */
export type BuildCaptureTry = 'sent' | BuildCaptureNotSent;

/** One build's row, as `CoordStore.claudeBuilds` reads it and `GET /api/testbox/builds` serves it. */
export interface ClaudeBuildRecord {
  readonly build: string;
  readonly source: ClaudeBuildSource;
  readonly capture: ClaudeBuildCapture;
  /** The capture proved a PermissionRequest's `cwd` is the shell's working directory after a `cd`. Only a `pass` sets it. */
  readonly cwd: boolean;
  /** When the row was recorded (ms since the epoch; 0 for a rig seed). */
  readonly seenAt: number;
  /** How many capture jobs actually went out to the test box for the build. A try that sent nothing is not counted. */
  readonly attempts: number;
  /** When the queue last tried the build, sent or not: the retry clock. */
  readonly lastAttemptAt: number | null;
  /** Why that last try sent nothing; null when it sent a job, or before any try. */
  readonly notSent: BuildCaptureNotSent | null;
  readonly verdictAt: number | null;
  /** The replay output's tail, at most {@link BUILD_CAPTURE_OUTPUT_MAX} characters; null before a verdict. An automatic
   *  retry keeps the last one while the build is queued again. */
  readonly output: string | null;
  /** How many capture verdicts for the build failed, the retry ceiling's count (slug capture-retry-ceiling). 0 from a server
   *  that predates it, which retries nothing: {@link captureStandingOf} reads its failed row as given up. */
  readonly fails: number;
}

// ── the decider ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Why a reader does not trust a build. `unread`: no well-formed version to look up. `record-unreadable`: the record
 *  could not be read. `not-captured`: no row. `capture-queued`: a row with no verdict yet. `capture-failed`: its capture
 *  failed. */
export type BuildUntrustedReason = 'unread' | 'record-unreadable' | 'not-captured' | 'capture-queued' | 'capture-failed';
export const BUILD_UNTRUSTED_REASON_MAP: Record<BuildUntrustedReason, true> = {
  unread: true, 'record-unreadable': true, 'not-captured': true, 'capture-queued': true, 'capture-failed': true,
};
export const BUILD_UNTRUSTED_REASONS: readonly BuildUntrustedReason[] = Object.keys(BUILD_UNTRUSTED_REASON_MAP) as BuildUntrustedReason[];

export type BuildTrust =
  | { readonly kind: 'trusted'; readonly cwd: boolean }
  | { readonly kind: 'untrusted'; readonly reason: BuildUntrustedReason };

/** THE decider: `records` is the whole record, or null when it could not be read. */
export function buildTrustOf(records: readonly ClaudeBuildRecord[] | null, version: string | null): BuildTrust {
  if (!isClaudeVersion(version)) return { kind: 'untrusted', reason: 'unread' };
  if (records === null) return { kind: 'untrusted', reason: 'record-unreadable' };
  const row = records.find((r) => r.build === version);
  if (row === undefined) return { kind: 'untrusted', reason: 'not-captured' };
  if (captureStandingOf(row).kind === 'trusted') return { kind: 'trusted', cwd: row.cwd };
  return { kind: 'untrusted', reason: row.capture === 'fail' ? 'capture-failed' : 'capture-queued' };
}

/** Each reason in one clause, naming the build (or saying it could not be read). */
export function buildUntrustedSentence(reason: BuildUntrustedReason, version: string | null): string {
  const b = isClaudeVersion(version) ? `build ${version}` : 'the build';
  switch (reason) {
    case 'unread': return 'its Claude Code build could not be read';
    case 'record-unreadable': return 'the record of captured builds could not be read';
    case 'not-captured': return `${b} has no capture yet`;
    case 'capture-queued': return `${b} is waiting for its capture on the test box`;
    case 'capture-failed': return `${b} failed its capture on the test box`;
  }
}

// ── the queue's choices ──────────────────────────────────────────────────────────────────────────────────────────

/** How long a build whose last job got no verdict waits before it is sent again: an hour, so a new build is captured
 *  on the first pass the box can take it, well inside the ruling's day. */
export const BUILD_CAPTURE_RETRY_MS = 60 * 60_000;

const newestFirst = (a: string, b: string): number => compareClaudeVersions(b, a);

/** The well-formed builds in `seen` (each session's build) that have no row, once each, newest first. A new build and
 *  every build already live take the same path: one row each. */
export function unrecordedBuilds(records: readonly ClaudeBuildRecord[], seen: readonly (string | null)[]): string[] {
  const have = new Set(records.map((r) => r.build));
  const out = new Set<string>();
  for (const v of seen) if (isClaudeVersion(v) && !have.has(v)) out.add(v);
  return [...out].sort(newestFirst);
}

/** The build to send next, or null: the newest `queued` build never tried, or last tried at least
 *  {@link BUILD_CAPTURE_RETRY_MS} before `now`. */
export function nextCaptureJob(records: readonly ClaudeBuildRecord[], now: number): string | null {
  const due = records.filter((r) => r.capture === 'queued' && isClaudeVersion(r.build)
    && (r.lastAttemptAt === null || now - r.lastAttemptAt >= BUILD_CAPTURE_RETRY_MS));
  return due.map((r) => r.build).sort(newestFirst)[0] ?? null;
}

/** How many failed verdicts ccrc takes before it stops capturing a build again by itself and asks the operator (slug
 *  capture-retry-ceiling). A replay that fails three times, an hour and then two apart, is the build's, not the box's. */
export const BUILD_CAPTURE_FAIL_CEILING = 3;

/** How long after its `fails`-th failed verdict a build is captured again: {@link BUILD_CAPTURE_RETRY_MS}, doubling. */
export function captureRetryAfterMs(fails: number): number {
  return BUILD_CAPTURE_RETRY_MS * 2 ** Math.max(0, fails - 1);
}

/** Where a build's capture stands for the operator: `trusted`; `queued` (ccrc is capturing it); `retrying` (its capture
 *  failed and ccrc captures it again `at`, the `fails`-th of {@link BUILD_CAPTURE_FAIL_CEILING}); `given-up` (ccrc has stopped
 *  retrying, so only the operator's Capture again sends it). Only `given-up` waits on the operator. */
export type CaptureStanding =
  | { readonly kind: 'trusted' | 'queued' }
  | { readonly kind: 'retrying'; readonly fails: number; readonly at: number }
  | { readonly kind: 'given-up'; readonly fails: number };

/** THE STANDING's one decider, and the one home of "a passed capture is trusted", which {@link buildTrustOf} reads (review
 *  3234 F16). A failed row with no count (a server that predates the ceiling) is given up: nothing retries it. */
export function captureStandingOf(r: ClaudeBuildRecord): CaptureStanding {
  if (r.capture === 'pass') return { kind: 'trusted' };
  if (r.capture === 'queued') return { kind: 'queued' };
  if (r.fails < 1 || r.fails >= BUILD_CAPTURE_FAIL_CEILING) return { kind: 'given-up', fails: r.fails };
  return { kind: 'retrying', fails: r.fails, at: (r.verdictAt ?? 0) + captureRetryAfterMs(r.fails) };
}

/** Whether ccrc has stopped capturing the build by itself: only the operator's Capture again sends it now. */
export function captureGivenUp(r: ClaudeBuildRecord): boolean {
  return captureStandingOf(r).kind === 'given-up';
}

/** The failed builds ccrc captures again at `now` by itself: each `retrying` one whose time has come and that a session still
 *  runs (`versions`, the sessions' builds), newest first. A build no session runs is not retried (review 3234 F5). */
export function capturesToRetry(records: readonly ClaudeBuildRecord[], now: number, versions: readonly (string | null)[]): string[] {
  return records.filter((r) => { const s = captureStandingOf(r); return s.kind === 'retrying' && now >= s.at && versions.includes(r.build); })
    .map((r) => r.build).sort(newestFirst);
}

/** Whether ccrc tells the operator it gave up on `r`: given up, and a session still runs the build. One no session runs gives
 *  up quietly, with no push and no item (review 3234 F5). */
export function givenUpToTell(r: ClaudeBuildRecord, versions: readonly (string | null)[]): boolean {
  return captureGivenUp(r) && versions.includes(r.build);
}

// ── one pass's acts (spec §2.2, D7) ─────────────────────────────────────────────────────────────────────────────

/** What one act of a capture pass came to: a capture that went out (`sent`, answered or not), one that did not (its
 *  not-sent word), or the copy (`copied`, or the copy's word). */
export type CapturePassStep = 'sent' | BuildCaptureNotSent | 'copied';

/** The lane's next act in a pass: send the capture, copy the build over the admin lane, or stop and record the pass. */
export type CaptureNextAct = 'send' | 'copy' | 'stop';
const CAPTURE_NEXT_ACT_MAP: Record<CaptureNextAct, true> = { send: true, copy: true, stop: true };
export const CAPTURE_NEXT_ACTS = Object.keys(CAPTURE_NEXT_ACT_MAP) as CaptureNextAct[];

/** THE COPY RULE, decided here and carried out by the lane (`server/src/buildCaptureLane.ts`): send the capture first; copy
 *  only after the box refused it `build-absent`, once a pass, then send it again. Any other answer stops the pass. So a build
 *  the box already holds is never copied, and a pass makes at most two sends and one copy, whatever the answers. */
export function captureNextAct(steps: readonly CapturePassStep[]): CaptureNextAct {
  const last = steps[steps.length - 1];
  if (last === undefined || last === 'copied') return 'send';
  const copied = steps.some((s) => s === 'copied' || has(BUILD_COPY_FAILURE_MAP, s));
  return last === 'build-absent' && !copied ? 'copy' : 'stop';
}

/** What a stopped pass records as its try: its last act, a send's answer or the copy's failure. The rule always sends first
 *  and sends again after a copy that placed the build, so a pass never ends empty or on `copied`; were it to, nothing went
 *  out, and it reads as `not-started`. */
export function captureTryOf(steps: readonly CapturePassStep[]): BuildCaptureTry {
  const last = steps[steps.length - 1];
  return last === undefined || last === 'copied' ? 'not-started' : last;
}

/** Why the queue cannot capture anything right now, read from the record alone: the queued build it tried last sent
 *  nothing, and why (its not-sent word). Null when no queued build was tried, or the last try sent a job. The console
 *  says it, so the operator is never left waiting on a capture that cannot happen. */
export function captureBlockedBy(records: readonly ClaudeBuildRecord[]): BuildCaptureNotSent | null {
  let last: ClaudeBuildRecord | null = null;
  for (const r of records) {
    if (r.capture !== 'queued' || r.lastAttemptAt === null) continue;
    if (last === null || r.lastAttemptAt > (last.lastAttemptAt ?? 0)) last = r;
  }
  return last?.notSent ?? null;
}

// ── the job and its answer ───────────────────────────────────────────────────────────────────────────────────────

/** The job sent to the test box: the build to capture. */
export interface BuildCaptureJob {
  readonly build: string;
  /** Absent: a build-trust capture. `delivery`: one part of the paste delivery recipe (Desktop polish wave 178), named by
   *  `part`; its result is never a verdict and never touches a trust row. Additive: a job without either is a trust job. */
  readonly recipe?: 'delivery';
  readonly part?: number;
}

/** A capture's answer as the box-side runner states it: the build, whether the replay tests passed, whether they proved
 *  the `cwd` fact, and the replay output. */
export interface BuildCaptureResult {
  readonly build: string;
  readonly pass: boolean;
  readonly cwd: boolean;
  readonly output: string;
}

/** The output kept in the row: the last this many characters. */
export const BUILD_CAPTURE_OUTPUT_MAX = 8192;

const RESULT_KEYS = ['build', 'cwd', 'output', 'pass'];

/** The answer's ONE reader: a result for `build`, or null when the value is not one (another build, a field missing or
 *  mistyped, a field it does not name). A failed capture never claims the `cwd`; the output keeps its tail. */
export function readBuildCaptureResult(v: unknown, build: string): BuildCaptureResult | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== RESULT_KEYS.join()) return null;
  if (o['build'] !== build || typeof o['pass'] !== 'boolean' || typeof o['cwd'] !== 'boolean' || typeof o['output'] !== 'string') return null;
  const output = o['output'];
  return { build, pass: o['pass'], cwd: o['pass'] && o['cwd'], output: output.length > BUILD_CAPTURE_OUTPUT_MAX ? output.slice(-BUILD_CAPTURE_OUTPUT_MAX) : output };
}

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** `GET /api/testbox/builds`'s body. `deliveries` is additive (Desktop polish wave 178): absent from a server that predates
 *  it, and read by `deliveryResult.ts#readDeliveryViews`, which permits the absence. */
export interface ClaudeBuildsView {
  readonly ok: true;
  readonly claudeBuilds: readonly ClaudeBuildRecord[];
  readonly deliveries?: readonly DeliveryBuildView[];
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isStamp = (v: unknown): v is number | null => v === null || isCount(v);
/** `fails` is additive on the wire: absent (an older server) reads as 0, anything else must be a count. */
const failsOf = (v: unknown): number | null => (v === undefined ? 0 : isCount(v) ? v : null);
const has = <T extends string>(map: Record<T, true>, v: unknown): v is T => typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);

/** The wire list's ONE reader: every row well formed, or null. */
export function readClaudeBuildRecords(v: unknown): ClaudeBuildRecord[] | null {
  if (!Array.isArray(v)) return null;
  const out: ClaudeBuildRecord[] = [];
  for (const x of v as unknown[]) {
    if (typeof x !== 'object' || x === null) return null;
    const r = x as Record<string, unknown>;
    if (!isClaudeVersion(r['build']) || !has(CLAUDE_BUILD_SOURCE_MAP, r['source']) || !has(CLAUDE_BUILD_CAPTURE_MAP, r['capture'])
      || typeof r['cwd'] !== 'boolean' || !isCount(r['seenAt']) || !isCount(r['attempts']) || !isStamp(r['lastAttemptAt'])
      || !isStamp(r['verdictAt']) || !(r['output'] === null || typeof r['output'] === 'string')
      || !(r['notSent'] === null || has(BUILD_CAPTURE_NOT_SENT_MAP, r['notSent']))) return null;
    const fails = failsOf(r['fails']);
    if (fails === null) return null;
    out.push({
      build: r['build'], source: r['source'], capture: r['capture'], cwd: r['cwd'], seenAt: r['seenAt'], attempts: r['attempts'],
      lastAttemptAt: r['lastAttemptAt'], notSent: r['notSent'] as BuildCaptureNotSent | null, verdictAt: r['verdictAt'], output: r['output'] as string | null, fails,
    });
  }
  return out;
}
