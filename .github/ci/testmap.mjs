// The test map: the measured record of what each server test file reads,
// probes, lists and links whole (`subtree`) (spec §5.2), baseline-subtracted so an unrelated new test
// file doesn't drag `server/test/`'s own listing into every record (§5.2's
// last bullet). This module owns the map's shape, its build/refresh
// transitions (§5.3, §5.4) and its on-disk read/write — nothing here decides
// selection (that is `select-tests.mjs`, Task 5).
//
// The records it builds from arrive SPLIT BY PROCESS (format 2, from
// `trace-run.mjs`): `root` is the vitest root process — its config, its
// include glob's walk of `server/test/`, the transforms of the test's imports
// — and `rest` is the worker and everything the test spawns. The baseline is
// subtracted per side and the two sides are then joined into the map's one
// record per test. Subtracting a single merged baseline would also erase a
// test's OWN walk of `server/test/` (single-definition's census), because the
// glob walks the same directory; per side, only the glob's walk goes.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {import('./trace-to-deps.mjs').DepRecord} DepRecord */
/** @typedef {DepRecord & { unknown: boolean, why?: string }} TestRecord */
/** @typedef {{ root: DepRecord, rest: DepRecord }} SplitDeps */
/** @typedef {SplitDeps & { unknown: boolean, why?: string }} SplitTestRecord */
/** @typedef {{ format: 2, baseline: SplitDeps, tests: Record<string, SplitTestRecord> }} Records */
/** @typedef {{ format: 1, sha: string, baseline: DepRecord, tests: Record<string, TestRecord> }} TestMap */

export const MAP_FORMAT = 1;
export const RECORDS_FORMAT = 2;

/** The `why` of a test a refresh meant to re-trace but got no record for. */
export const TRACE_MISSING = 'trace missing (shard failed or cancelled)';

// THE FLOOR (spec §5.2). The repo-wide guards reach every change only through their breadth in the map: the
// git-reading ones through `git: true` (rule 2), the walking ones through what they list. A tracer regression
// that stops seeing `.git` reads or directory walks would narrow them silently, so a freshly traced floor test
// that lacks that breadth is written UNKNOWN, with why `FLOOR_GIT` / `FLOOR_WALK`: rule 2 then selects it for
// every change — exactly the breadth the floor protects. The map is still written (and published), and the CLI
// exits 4 naming it, so the break is loud while selection keeps working; refusing the whole map instead would
// let one legitimate refactor of a floor test freeze the map until it expired. `unknown` already passes: an
// unknown test is always selected. Checked on the REAL traces every map-build makes, which is what catches a
// strace-side regression as well as a parser one.
export const GIT_FLOOR = ['source-bytes', 'topology-clean', 'deviation-refs', 'dtbd', 'providers',
  'modelenv-single-writer', 'install-census', 'gitignore-secrets'].map((n) => `server/test/${n}.test.ts`);
export const WALK_FLOOR = ['single-definition', 'typecheck-tests'].map((n) => `server/test/${n}.test.ts`);
export const FLOOR_GIT = 'floor: git is false';
export const FLOOR_WALK = 'floor: lists nothing';

/** Rewrites every floor test among `tests` that lacks its breadth as unknown, with the floor's `why`.
 *  @param {Record<string, TestRecord>} tests */
function markFloor(tests) {
  for (const f of GIT_FLOOR) {
    const r = tests[f];
    if (r && !r.unknown && !r.git) tests[f] = { ...r, unknown: true, why: FLOOR_GIT };
  }
  for (const f of WALK_FLOOR) {
    const r = tests[f];
    if (r && !r.unknown && r.listed.length === 0) tests[f] = { ...r, unknown: true, why: FLOOR_WALK };
  }
}

/** A `why` trace-run writes for a test that FAILED under trace: vitest exited non-zero, or the per-file deadline
 *  killed it — as opposed to unknown for any other reason (an unresolved path, a missing trace, the floor). */
export const FAILED_UNDER_TRACE = /^(vitest exited|timeout after)/;

const SHA_RE = /^[0-9a-f]{40}$/;

/** Sort + dedupe a string array. Every `DepRecord` array is kept in this
 *  shape by construction — callers never see an unsorted or duplicated list. */
function sortedUnique(arr) {
  return [...new Set(arr)].sort();
}

/** `arr` with every member of `remove` taken out, staying sorted+unique. */
function subtractArr(arr, remove) {
  const drop = new Set(remove);
  return sortedUnique(arr.filter((x) => !drop.has(x)));
}

/** @param {DepRecord} rec @param {DepRecord} baseline @returns {DepRecord} */
export function subtractBaseline(rec, baseline) {
  return {
    read: subtractArr(rec.read, baseline.read),
    probed: subtractArr(rec.probed, baseline.probed),
    listed: subtractArr(rec.listed, baseline.listed),
    subtree: subtractArr(rec.subtree, baseline.subtree),
    // The baseline's own git flag never suppresses a test's git flag: a test
    // that reads `.git` still needs the ALWAYS rule (spec §6.2 rule 2) even
    // though vitest's own startup does not touch `.git`. "kept as is" (the
    // contract's words) — this is not an oversight, it is the only baseline
    // field that isn't a set.
    git: rec.git,
  };
}

/** Both records joined: every list's union (sorted, unique), `git` ORed.
 *  @param {DepRecord} a @param {DepRecord} b @returns {DepRecord} */
function unionDeps(a, b) {
  return {
    read: sortedUnique([...a.read, ...b.read]),
    probed: sortedUnique([...a.probed, ...b.probed]),
    listed: sortedUnique([...a.listed, ...b.listed]),
    subtree: sortedUnique([...a.subtree, ...b.subtree]),
    git: a.git || b.git,
  };
}

/** A map entry: each side minus the SAME side of the baseline, the two sides
 *  joined, plus the `unknown`/`why` fields carried through untouched.
 *  @param {SplitTestRecord} rec @param {SplitDeps} baseline @returns {TestRecord} */
function flattenTestRecord(rec, baseline) {
  /** @type {TestRecord} */
  const out = {
    ...unionDeps(subtractBaseline(rec.root, baseline.root), subtractBaseline(rec.rest, baseline.rest)),
    unknown: !!rec.unknown,
  };
  if (rec.why !== undefined) out.why = rec.why;
  return out;
}

/** @param {string} sha @param {Records} records @returns {TestMap} */
export function buildMap(sha, records) {
  /** @type {Record<string, TestRecord>} */
  const tests = {};
  for (const name of Object.keys(records.tests)) {
    tests[name] = flattenTestRecord(records.tests[name], records.baseline);
  }
  markFloor(tests);
  return { format: MAP_FORMAT, sha, baseline: unionDeps(records.baseline.root, records.baseline.rest), tests };
}

/**
 * @param {TestMap} old
 * @param {string} sha
 * @param {Records} records fresh traces for the tests this refresh retraced
 * @param {string[]} liveTests every test file that still exists in the tree
 * @param {string[]} traced every test this refresh MEANT to re-trace (select's
 *   trace list, not what arrived)
 * @returns {TestMap}
 */
export function refreshMap(old, sha, records, liveTests, traced) {
  const live = new Set(liveTests);
  /** @type {Record<string, TestRecord>} */
  const tests = {};
  for (const name of Object.keys(records.tests)) {
    if (!live.has(name)) continue;
    tests[name] = flattenTestRecord(records.tests[name], records.baseline);
  }
  // Only the freshly traced entries are judged; a carried entry was judged when it was traced.
  markFloor(tests);
  for (const name of traced) {
    if (!live.has(name) || name in tests) continue;
    // Meant to be re-traced, and no record arrived (a trace shard crashed or
    // was cancelled). These are exactly the tests whose dependencies this
    // merge changed, so their old entries are the one thing that must NOT be
    // carried: unknown selects them (rule 2) until a clean trace replaces it.
    tests[name] = { read: [], probed: [], listed: [], subtree: [], git: false, unknown: true, why: TRACE_MISSING };
  }
  for (const name of liveTests) {
    if (name in tests) continue;
    // Not freshly traced this refresh: carry the old entry verbatim (spec
    // §5.4 — sound because a test that read none of the changed paths
    // executed identically, so its record is unchanged).
    if (old && old.tests && Object.prototype.hasOwnProperty.call(old.tests, name)) {
      tests[name] = old.tests[name];
    }
  }
  return { format: MAP_FORMAT, sha, baseline: unionDeps(records.baseline.root, records.baseline.rest), tests };
}

/** @param {unknown} v @returns {v is string[]} */
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** @param {unknown} v @returns {v is DepRecord} */
function isDepRecordShape(v) {
  return !!v && typeof v === 'object'
    && isStringArray(/** @type {any} */ (v).read)
    && isStringArray(/** @type {any} */ (v).probed)
    && isStringArray(/** @type {any} */ (v).listed)
    && isStringArray(/** @type {any} */ (v).subtree)
    && typeof (/** @type {any} */ (v).git) === 'boolean';
}

/** @param {unknown} v @returns {v is TestRecord} */
function isTestRecordShape(v) {
  if (!isDepRecordShape(v)) return false;
  const t = /** @type {any} */ (v);
  if (typeof t.unknown !== 'boolean') return false;
  if ('why' in t && typeof t.why !== 'string') return false;
  return true;
}

/**
 * Never throws. A malformed, unreadable or wrong-format map answers
 * `{ ok: false, reason }` — the caller (the selector) falls back to a full
 * run on this (spec §6.3's first bullet), so this function's job is to
 * catch every way a map can be untrustworthy, not to explain why to a human.
 * @param {string} file
 * @returns {{ ok: true, map: TestMap } | { ok: false, reason: string }}
 */
export function readMap(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, reason: `unreadable: ${/** @type {Error} */ (e).message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `invalid JSON: ${/** @type {Error} */ (e).message}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'not an object' };
  }
  if (parsed.format !== MAP_FORMAT) {
    return { ok: false, reason: `unknown format ${JSON.stringify(parsed.format)}` };
  }
  if (typeof parsed.sha !== 'string' || !SHA_RE.test(parsed.sha)) {
    return { ok: false, reason: 'malformed sha' };
  }
  if (!isDepRecordShape(parsed.baseline)) {
    return { ok: false, reason: 'malformed baseline record' };
  }
  if (!parsed.tests || typeof parsed.tests !== 'object' || Array.isArray(parsed.tests)) {
    return { ok: false, reason: 'malformed tests map' };
  }
  for (const name of Object.keys(parsed.tests)) {
    if (!isTestRecordShape(parsed.tests[name])) {
      return { ok: false, reason: `malformed record for ${name}` };
    }
  }
  return { ok: true, map: /** @type {TestMap} */ (parsed) };
}

function sortedDepRecord(rec) {
  const out = {
    read: [...rec.read].sort(),
    probed: [...rec.probed].sort(),
    listed: [...rec.listed].sort(),
    subtree: [...rec.subtree].sort(),
    git: !!rec.git,
  };
  if ('unknown' in rec) out.unknown = !!rec.unknown;
  if (rec.why !== undefined) out.why = rec.why;
  return out;
}

/** Stable key order (`format`, `sha`, `baseline`, `tests`, tests sorted by
 *  name; each record's own keys in `read, probed, listed, subtree, git[,
 *  unknown, why]` order), compact (no indentation) — a rebuild of an unchanged map
 *  therefore diffs as no-op instead of reordering JSON keys.
 *  @param {string} file @param {TestMap} map */
export function writeMap(file, map) {
  const tests = {};
  for (const name of Object.keys(map.tests).sort()) {
    tests[name] = sortedDepRecord(map.tests[name]);
  }
  const canonical = {
    format: map.format,
    sha: map.sha,
    baseline: sortedDepRecord(map.baseline),
    tests,
  };
  writeFileSync(file, JSON.stringify(canonical));
}

/** Merge every `records*.json` under `dir` (one per trace shard) into one
 *  `Records`. Only format 2 (split by process) is accepted: a format-1 file
 *  holds one merged record per test, which cannot be subtracted per side.
 *  Baselines must agree (identical after sort, both sides) — a divergent
 *  baseline between shards means the baseline test itself behaved
 *  differently on two runners, which would corrupt every subtraction
 *  silently if merged anyway, so this throws rather than picking one.
 *  @param {string} dir @returns {Records} */
export function readRecordsDir(dir) {
  const files = readdirSync(dir).filter((f) => /^records.*\.json$/.test(f)).sort();
  if (files.length === 0) {
    throw new Error(`no records*.json under ${dir}`);
  }
  /** @type {SplitDeps | null} */
  let baseline = null;
  /** @type {Record<string, SplitTestRecord>} */
  const tests = {};
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    if (parsed.format !== RECORDS_FORMAT) {
      throw new Error(`${f}: records format ${JSON.stringify(parsed.format)}, expected ${RECORDS_FORMAT} `
        + '(split by process) — re-trace with this tree\'s trace-run.mjs');
    }
    const thisBaseline = { root: sortedDepRecord(parsed.baseline.root), rest: sortedDepRecord(parsed.baseline.rest) };
    if (baseline === null) {
      baseline = thisBaseline;
    } else if (JSON.stringify(thisBaseline) !== JSON.stringify(baseline)) {
      throw new Error(`${f}: baseline disagrees with an earlier shard`);
    }
    for (const name of Object.keys(parsed.tests)) {
      tests[name] = parsed.tests[name];
    }
  }
  return { format: RECORDS_FORMAT, baseline: /** @type {SplitDeps} */ (baseline), tests };
}

function readLines(file) {
  return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key || !key.startsWith('--')) continue;
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

/**
 * What the traced run says, for the map just written: the floor violators (exit 4), the traced tests that NEWLY
 * failed under trace — failed or timed out now, and not unknown in `old`, the map this run started from — (exit 3),
 * and the failures that were already unknown there (a warning: a test that always fails under tracing reds the
 * first build that sees it, not every run after). With no `old`, every failure is new.
 * @param {TestMap} map @param {Records} records @param {TestMap | null} old
 * @returns {{ floor: string[], newlyFailed: string[], stillFailing: string[] }}
 */
export function traceVerdict(map, records, old) {
  const floor = [];
  const newlyFailed = [];
  const stillFailing = [];
  for (const name of Object.keys(records.tests).sort()) {
    const rec = map.tests[name];
    if (!rec || !rec.unknown) continue;
    if (rec.why === FLOOR_GIT || rec.why === FLOOR_WALK) floor.push(name);
    else if (FAILED_UNDER_TRACE.test(rec.why ?? '')) {
      if (old && old.tests && old.tests[name] && old.tests[name].unknown) stillFailing.push(name);
      else newlyFailed.push(name);
    }
  }
  return { floor, newlyFailed, stillFailing };
}

/** Prints the verdict as annotations and returns the exit code: 4 for a floor violator, else 3 for a newly failing
 *  test, else 0. Called only AFTER the map is written, so a red run still publishes. */
function report(map, verdict) {
  for (const name of verdict.floor) {
    process.stdout.write(`::error::testmap: ${name} ${map.tests[name].why} — written unknown (always selected); `
      + 'fix the test, or GIT_FLOOR/WALK_FLOOR in .github/ci/testmap.mjs\n');
  }
  for (const name of verdict.newlyFailed) {
    process.stdout.write(`::error::testmap: ${name} newly fails under trace (${map.tests[name].why})\n`);
  }
  for (const name of verdict.stillFailing) {
    process.stdout.write(`::warning::testmap: ${name} still fails under trace (${map.tests[name].why}) — unknown before this run too\n`);
  }
  if (verdict.floor.length > 0) return 4;
  if (verdict.newlyFailed.length > 0) return 3;
  return 0;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === 'build') {
    // --old is optional here: the map select fetched, if any — only to tell a new failure from an old one.
    /** @type {TestMap | null} */
    let old = null;
    if (args.old) {
      const oldResult = readMap(args.old);
      if (oldResult.ok) old = oldResult.map;
      else process.stdout.write(`::warning::testmap: cannot read --old (${oldResult.reason}); every failure counts as new\n`);
    }
    const records = readRecordsDir(args.records);
    const map = buildMap(args.sha, records);
    writeMap(args.out, map);
    process.exitCode = report(map, traceVerdict(map, records, old));
    return;
  }
  if (cmd === 'refresh') {
    const oldResult = readMap(args.old);
    if (!oldResult.ok) {
      throw new Error(`cannot read --old map: ${oldResult.reason}`);
    }
    if (!args.traced) {
      throw new Error('refresh needs --traced FILE: the tests select meant to trace, one per line');
    }
    const records = readRecordsDir(args.records);
    const liveTests = readLines(args.live);
    const traced = readLines(args.traced);
    const map = refreshMap(oldResult.map, args.sha, records, liveTests, traced);
    writeMap(args.out, map);
    process.exitCode = report(map, traceVerdict(map, records, oldResult.map));
    return;
  }
  throw new Error(`unknown command ${JSON.stringify(cmd)} (expected "build" or "refresh")`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
