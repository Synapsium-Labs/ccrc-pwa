// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): the SQL of `claude_builds`, the trusted set of Claude
// Code builds (migration 60). It sits beside `store.ts` in `linkingStore.ts`'s idiom: every function takes the store's
// `DatabaseSync` and is synchronous, and `CoordStore` keeps one-line delegates, so its methods are the table's only writers.
// What a row means for a reader is `shared/claudeBuildTrust.ts#buildTrustOf`'s, and nothing here decides it.
import type { DatabaseSync } from 'node:sqlite';
import { compareClaudeVersions, isClaudeVersion } from '../../../shared/claudeVersion.js';
import {
  CLAUDE_BUILD_CAPTURE_MAP, CLAUDE_BUILD_SOURCE_MAP, type BuildCaptureResult, type ClaudeBuildRecord,
} from '../../../shared/claudeBuildTrust.js';

interface Row {
  build: string; source: string; capture: string; cwd: number; seenAt: number; attempts: number;
  lastAttemptAt: number | null; verdictAt: number | null; output: string | null;
}

const COLUMNS = 'build, source, capture, cwd, seenAt, attempts, lastAttemptAt, verdictAt, output';

/** Every row, newest build first. A row the table's CHECKs let through but this build cannot read (a build off the grammar)
 *  is left out, so no reader trusts what it cannot name. Throws when the table cannot be read: the caller says so. */
export function claudeBuildRecords(db: DatabaseSync): ClaudeBuildRecord[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM claude_builds`).all() as unknown as Row[];
  const out: ClaudeBuildRecord[] = [];
  for (const r of rows) {
    if (!isClaudeVersion(r.build) || !(r.source in CLAUDE_BUILD_SOURCE_MAP) || !(r.capture in CLAUDE_BUILD_CAPTURE_MAP)) continue;
    out.push({
      build: r.build, source: r.source as ClaudeBuildRecord['source'], capture: r.capture as ClaudeBuildRecord['capture'],
      cwd: r.cwd === 1, seenAt: r.seenAt, attempts: r.attempts, lastAttemptAt: r.lastAttemptAt, verdictAt: r.verdictAt, output: r.output,
    });
  }
  return out.sort((a, b) => compareClaudeVersions(b.build, a.build));
}

/** One `queued` row for each build that has none; an existing row is left as it is. Answers the builds it recorded. */
export function noteClaudeBuildsSeen(db: DatabaseSync, builds: readonly string[], now: number): string[] {
  const ins = db.prepare("INSERT OR IGNORE INTO claude_builds (build, source, capture, seenAt) VALUES (?, 'fleet', 'queued', ?)");
  const out: string[] = [];
  for (const b of builds) if (isClaudeVersion(b) && Number(ins.run(b, now).changes) === 1) out.push(b);
  return out;
}

/** A job is going out for a `queued` build: one more attempt, stamped `now`. False when no queued row names it. */
export function markClaudeBuildAttempt(db: DatabaseSync, build: string, now: number): boolean {
  return Number(db.prepare("UPDATE claude_builds SET attempts = attempts + 1, lastAttemptAt = ? WHERE build = ? AND capture = 'queued'")
    .run(now, build).changes) === 1;
}

/** A capture's verdict, on a `queued` row only (a verdict never overwrites another). False when no queued row names it. */
export function recordClaudeBuildVerdict(db: DatabaseSync, r: BuildCaptureResult, now: number): boolean {
  return Number(db.prepare("UPDATE claude_builds SET capture = ?, cwd = ?, output = ?, verdictAt = ? WHERE build = ? AND capture = 'queued'")
    .run(r.pass ? 'pass' : 'fail', r.pass && r.cwd ? 1 : 0, r.output, now, r.build).changes) === 1;
}

/** The operator's **Capture again**: a `fail` row goes back to `queued`, its verdict and output cleared and its retry clock
 *  reset, so the next pass sends it. */
export type ClaudeBuildRequeue = 'queued' | 'unknown-build' | 'not-failed';
export function requeueClaudeBuild(db: DatabaseSync, build: string): ClaudeBuildRequeue {
  const changed = Number(db.prepare(
    "UPDATE claude_builds SET capture = 'queued', cwd = 0, output = NULL, verdictAt = NULL, lastAttemptAt = NULL WHERE build = ? AND capture = 'fail'",
  ).run(build).changes);
  if (changed === 1) return 'queued';
  return db.prepare('SELECT 1 AS x FROM claude_builds WHERE build = ?').get(build) === undefined ? 'unknown-build' : 'not-failed';
}
