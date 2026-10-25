// The shard planner (spec §7, contract Task 6).
//
// Packs the selected server test files across a bounded number of CI
// runners: LPT (longest-processing-time-first) bin-packing when real
// per-file durations are known (from the `testtimes` artifact of a trusted
// main run), or an equal vitest hash-shard fallback (`--shard=i/n`, each
// shard given every file) when none are (spec §7.1: with no durations at
// all, sharding falls back to vitest's own `--shard=i/n`).
//
// Paths in `files` / the keys of `durations` are REPO-RELATIVE POSIX
// strings, matching every other module in `.github/ci/` (contract
// "Conventions"); `toMatrix` is where the plan crosses into
// SERVER-RELATIVE, because that is the one boundary the workflow reads
// (`CCRC_TEST_LIST`, `vitest run <files>`).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ index: number, total: number, files: string[], vitestShard: string|null, workers: number }} Shard
 * @typedef {Shard[]} ShardPlan
 * @typedef {{ targetMs: number, min: number, max: number, workers: number, defaultMs: number, scale?: number, budgetMs?: number }} ShardProfile
 */

/**
 * Per-file durations from a vitest JSON reporter report (`vitest run
 * --reporter=json --outputFile.json=…`). `testResults[].name` is an
 * ABSOLUTE path; `endTime - startTime` (both ms-epoch, possibly
 * fractional) is the file's wall time. A flat 500ms is added per file for
 * vitest's own collection overhead (spec §7.1's planner budget), added
 * once here so every caller of the resulting map already carries it.
 *
 * @param {{ testResults: Array<{ name: string, startTime: number, endTime: number }> }} report
 * @param {string} repoRoot
 * @returns {Record<string, number>}
 */
export function durationsFromVitestJson(report, repoRoot) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const result of report.testResults ?? []) {
    const rel = path.relative(repoRoot, result.name).split(path.sep).join('/');
    out[rel] = (result.endTime - result.startTime) + 500;
  }
  return out;
}

/** @type {Record<string, ShardProfile>} */
export const PROFILES = {
  linux: { targetMs: 240_000, min: 1, max: 12, workers: 2, defaultMs: 5000 },
  macosSelected: { targetMs: 900_000, min: 1, max: 2, workers: 2, defaultMs: 5000, scale: 1.5 },
  macosFull: { targetMs: 900_000, min: 1, max: 4, workers: 2, defaultMs: 5000, scale: 1.5 },
  // `budgetMs`: what ONE trace shard may be planned to take. The job's own timeout is 60 minutes; a refresh plans to
  // 45 and defers the rest (planTraceBatch), because a shard that hits the timeout is cancelled, leaves no records,
  // and the map is not published at all.
  trace: { targetMs: 900_000, min: 1, max: 8, workers: 2, defaultMs: 5000, scale: 6, budgetMs: 2_700_000 },
};

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Pack `files` into a `ShardPlan` (spec §7.1).
 *
 * total = Σ(duration ?? the median of the known durations, or defaultMs
 * when none are known)·scale; count = clamp(ceil(total /
 * workers / targetMs), min, max), never more than `files.length`. With
 * `durations`: LPT — sort files longest-duration-first (ties by path
 * ascending), assign each to the currently least-loaded shard;
 * `vitestShard: null`. With `durations === null`: every shard gets ALL
 * files and `vitestShard: "i/n"` (vitest's own hash-partitioned
 * `--shard`). Empty `files` -> `[]`.
 *
 * @param {string[]} files repo-relative test file paths
 * @param {Record<string, number>|null} durations repo-relative path -> ms, or null when none are known
 * @param {ShardProfile} profile
 * @returns {ShardPlan}
 */
export function planShards(files, durations, { targetMs, min, max, workers, defaultMs, scale = 1 }) {
  if (files.length === 0) return [];

  // A file with no duration is given the MEDIAN of the known ones (spec §7.1); `defaultMs` only when none are
  // known — an empty table, or none at all.
  const known = durations != null ? Object.values(durations).sort((a, b) => a - b) : [];
  const mid = known.length >> 1;
  const fallback = known.length === 0 ? defaultMs : known.length % 2 === 1 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  const durationOf = (f) => (durations != null ? (durations[f] ?? fallback) : defaultMs);
  const total = files.reduce((sum, f) => sum + durationOf(f), 0) * scale;
  const raw = Math.ceil(total / workers / targetMs);
  const count = Math.min(clamp(raw, min, max), files.length);

  if (durations === null) {
    return Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      total: count,
      files: [...files],
      vitestShard: `${i + 1}/${count}`,
      workers,
    }));
  }

  const sorted = [...files].sort((a, b) => {
    const da = durationOf(a);
    const db = durationOf(b);
    if (db !== da) return db - da;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const loads = new Array(count).fill(0);
  /** @type {string[][]} */
  const buckets = Array.from({ length: count }, () => []);
  for (const f of sorted) {
    let idx = 0;
    for (let i = 1; i < count; i++) if (loads[i] < loads[idx]) idx = i;
    buckets[idx].push(f);
    loads[idx] += durationOf(f);
  }

  return buckets.map((bucketFiles, i) => ({
    index: i + 1,
    total: count,
    files: bucketFiles,
    vitestShard: null,
    workers,
  }));
}

/**
 * A BOUNDED trace plan (the test-map refresh). The map refresh used to trace everything the merges since the last map
 * affected, in at most 8 shards, however long that took; a stale map selects more, so each refresh outgrew its 60-minute
 * shards, was cancelled, and none was ever published. This takes `files` in the order given — most important first —
 * and plans as many as fit: a file goes to the least-loaded shard if its cost still keeps that shard within
 * `budgetMs`, and is DEFERRED if it fits none (a later, smaller file may still fit). A shard's load is what
 * planShards counts: Σ duration · scale / workers, with a file of no known duration costing the median of the known
 * ones (`defaultMs` when none are). Never plans a shard past the budget. Shards come out numbered 1..n of n, the
 * empty ones dropped; the matrix shape is `toMatrix`'s.
 *
 * @param {string[]} files repo-relative test files, in priority order
 * @param {Record<string, number>} durations repo-relative path -> ms
 * @param {{ shards: number, budgetMs: number, workers: number, scale: number, defaultMs: number }} limits
 * @returns {{ plan: ShardPlan, batch: string[], deferred: string[] }} `batch` in the order given
 */
export function planTraceBatch(files, durations, { shards, budgetMs, workers, scale, defaultMs }) {
  const known = Object.values(durations).sort((a, b) => a - b);
  const mid = known.length >> 1;
  const fallback = known.length === 0 ? defaultMs : known.length % 2 === 1 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  const costOf = (f) => ((durations[f] ?? fallback) * scale) / workers;
  const loads = new Array(shards).fill(0);
  /** @type {string[][]} */
  const buckets = Array.from({ length: shards }, () => []);
  /** @type {Set<string>} */
  const taken = new Set();
  for (const f of files) {
    const cost = costOf(f);
    let idx = 0;
    for (let i = 1; i < shards; i++) if (loads[i] < loads[idx]) idx = i;
    if (loads[idx] + cost > budgetMs) continue;
    buckets[idx].push(f);
    loads[idx] += cost;
    taken.add(f);
  }
  const used = buckets.filter((b) => b.length > 0);
  const plan = used.map((b, i) => ({ index: i + 1, total: used.length, files: b, vitestShard: null, workers }));
  return { plan, batch: files.filter((f) => taken.has(f)), deferred: files.filter((f) => !taken.has(f)) };
}

function toServerRelative(repoRelPath) {
  return repoRelPath.startsWith('server/') ? repoRelPath.slice('server/'.length) : repoRelPath;
}

/**
 * The GitHub Actions matrix shape `ci.yml`'s `server-shard` / `test-macos`
 * jobs read. Paths cross the repo-relative -> server-relative boundary
 * here (contract "Conventions" — convert only at the two stated
 * boundaries).
 *
 * @param {ShardPlan} plan
 * @returns {{ include: Array<{ shard: number, total: number, files: string, vitest_shard: string, workers: number }> }}
 */
export function toMatrix(plan) {
  return {
    include: plan.map((s) => ({
      shard: s.index,
      total: s.total,
      files: s.files.map(toServerRelative).join(' '),
      vitest_shard: s.vitestShard ?? '',
      workers: s.workers,
    })),
  };
}

function usage() {
  process.stderr.write('usage: node shards.mjs times --out FILE <report.json>...\n');
  process.exitCode = 2;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'times') return usage();
  const outIdx = rest.indexOf('--out');
  if (outIdx === -1 || !rest[outIdx + 1]) return usage();
  const outFile = rest[outIdx + 1];
  const reportFiles = rest.filter((_, i) => i !== outIdx && i !== outIdx + 1);
  if (reportFiles.length === 0) return usage();

  // vitest's JSON names every file by its ABSOLUTE path, and the keys must
  // be repo-relative (`server/test/…`, what select.mjs plans with), so the
  // root they are made relative to is the directory this runs in: the
  // repository root. ci.yml's times-build runs it with no working-directory.
  // Run from anywhere else, a key would come out `test/…` or `../…` and match
  // no file — every duration silently lost — so that refuses instead.
  const repoRoot = process.cwd();
  /** @type {Record<string, number>} */
  const merged = {};
  for (const rf of reportFiles) {
    const report = JSON.parse(readFileSync(rf, 'utf8'));
    Object.assign(merged, durationsFromVitestJson(report, repoRoot));
  }
  const stray = Object.keys(merged).filter((k) => !k.startsWith('server/'));
  if (stray.length > 0) {
    process.stderr.write(`shards.mjs times: ${stray[0]} is not under server/ relative to ${repoRoot} — run it from the repository root\n`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(outFile, JSON.stringify(merged, Object.keys(merged).sort(), 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
