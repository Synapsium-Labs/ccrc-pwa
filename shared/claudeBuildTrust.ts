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

// ── the record ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a build's capture stands. `queued`: recorded, no verdict yet (a job may be out). `pass` and `fail` are verdicts. */
export type ClaudeBuildCapture = 'queued' | 'pass' | 'fail';
export const CLAUDE_BUILD_CAPTURE_MAP: Record<ClaudeBuildCapture, true> = { queued: true, pass: true, fail: true };
export const CLAUDE_BUILD_CAPTURES: readonly ClaudeBuildCapture[] = Object.keys(CLAUDE_BUILD_CAPTURE_MAP) as ClaudeBuildCapture[];

/** Where a row came from. `rig`: the 2026-10-18 rig record, seeded by the migration (2.1.296 and 2.1.300 to 2.1.302).
 *  `fleet`: a session on the fleet ran the build, and the queue recorded it. */
export type ClaudeBuildSource = 'rig' | 'fleet';
export const CLAUDE_BUILD_SOURCE_MAP: Record<ClaudeBuildSource, true> = { rig: true, fleet: true };

/** One build's row, as `CoordStore.claudeBuilds` reads it and `GET /api/testbox/builds` serves it. */
export interface ClaudeBuildRecord {
  readonly build: string;
  readonly source: ClaudeBuildSource;
  readonly capture: ClaudeBuildCapture;
  /** The capture proved a PermissionRequest's `cwd` is the shell's working directory after a `cd`. Only a `pass` sets it. */
  readonly cwd: boolean;
  /** When the row was recorded (ms since the epoch; 0 for a rig seed). */
  readonly seenAt: number;
  /** How many capture jobs were sent for the build. */
  readonly attempts: number;
  readonly lastAttemptAt: number | null;
  readonly verdictAt: number | null;
  /** The replay output's tail, at most {@link BUILD_CAPTURE_OUTPUT_MAX} characters; null before a verdict. */
  readonly output: string | null;
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
  if (row.capture === 'pass') return { kind: 'trusted', cwd: row.cwd };
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

/** The build to send next, or null: the newest `queued` build never sent, or last sent at least
 *  {@link BUILD_CAPTURE_RETRY_MS} before `now`. */
export function nextCaptureJob(records: readonly ClaudeBuildRecord[], now: number): string | null {
  const due = records.filter((r) => r.capture === 'queued' && isClaudeVersion(r.build)
    && (r.lastAttemptAt === null || now - r.lastAttemptAt >= BUILD_CAPTURE_RETRY_MS));
  return due.map((r) => r.build).sort(newestFirst)[0] ?? null;
}

// ── the job and its answer ───────────────────────────────────────────────────────────────────────────────────────

/** The job sent to the test box: the build to capture. */
export interface BuildCaptureJob { readonly build: string }

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

/** `GET /api/testbox/builds`'s body. */
export interface ClaudeBuildsView { readonly ok: true; readonly claudeBuilds: readonly ClaudeBuildRecord[] }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isStamp = (v: unknown): v is number | null => v === null || isCount(v);
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
      || !isStamp(r['verdictAt']) || !(r['output'] === null || typeof r['output'] === 'string')) return null;
    out.push({
      build: r['build'], source: r['source'], capture: r['capture'], cwd: r['cwd'], seenAt: r['seenAt'], attempts: r['attempts'],
      lastAttemptAt: r['lastAttemptAt'], verdictAt: r['verdictAt'], output: r['output'] as string | null,
    });
  }
  return out;
}
