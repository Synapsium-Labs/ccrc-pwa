// The selector (spec §6, Task 5): decides which server test files a change
// must run, from the measured `TestMap` (Task 4) and the changed-path set
// between the map's commit and the tree under test. This module answers ONE
// question — "given this map and this diff, what runs, and why" — and never
// decides the mode itself (that lives in `select.mjs`, Task 9, which is what
// falls back to `full` when the map is missing/unreadable, spec §6.3's first
// bullet).

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {import('./testmap.mjs').DepRecord} DepRecord */
/** @typedef {import('./testmap.mjs').TestMap} TestMap */
/** @typedef {{ status: 'A'|'M'|'D', path: string, symlink: boolean }} Change */
/** @typedef {{ mode: 'selected', tests: Array<{ file: string, rule: 1|2|3|4|5|6, path: string }>, queued?: { unmapped: string[], uncertain: string[] } } | { mode: 'full', reason: string }} Selection */

/** Each rule's name, as the reason table prints it (spec §6.2's numbering). */
export const RULE_NAMES = { 1: 'NEW', 2: 'ALWAYS', 3: 'READ', 4: 'PROBED', 5: 'LISTED', 6: 'SUBTREE' };

/** Whether repo-relative `p` is the directory `dir` or sits anywhere under it (`'.'` holds everything).
 *  @param {string} p @param {string} dir */
function atOrUnder(p, dir) {
  return dir === '.' || p === dir || p.startsWith(`${dir}/`);
}

/** Every path this module produces is a repo-relative POSIX string
 *  (CONTRACT.md's path convention), regardless of the host OS. */
function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** `git diff --raw -z --no-renames <fromSha> <toRef>`, parsed into `Change[]`.
 *  `-z` NUL-delimits both the record separator and the path, which is the
 *  only safe way to read a path containing a space or a newline — the
 *  human-readable form quotes such paths and this parser would otherwise have
 *  to un-quote it. `--no-renames` is load-bearing: CONTRACT.md defines a
 *  rename as arriving as one `D` and one `A`, which is what the affected-set
 *  logic in `selectTests` is built around; with rename detection on, git
 *  would instead emit a single `R###` record this parser does not expect.
 *  @param {string} repoDir @param {string} fromSha @param {string} [toRef]
 *  @returns {Change[]} */
export function readChanges(repoDir, fromSha, toRef = 'HEAD') {
  const raw = execFileSync('git', ['diff', '--raw', '-z', '--no-renames', fromSha, toRef], {
    cwd: repoDir, maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  // Each record is `:<oldmode> <newmode> <oldsha> <newsha> <status>` then a
  // NUL, then the path, then a NUL. Splitting the whole buffer on NUL and
  // walking pairs is simpler and just as exact, since neither field can
  // itself contain a NUL.
  const parts = raw.split('\0');
  /** @type {Change[]} */
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const header = parts[i];
    const p = parts[i + 1];
    if (!header || !p) continue;
    const fields = header.trim().split(/\s+/);
    if (fields.length < 5) continue;
    // The header starts with git's ':' — `:120000 000000 …` — which is stripped before the old mode is read, or an
    // old-side symlink (a deleted one, or one turned into a file) would never be flagged.
    const [oldModeRaw, newMode, , , statusRaw] = fields;
    const oldMode = oldModeRaw.replace(/^:/, '');
    const letter = statusRaw[0];
    /** @type {'A'|'M'|'D'} */
    const status = letter === 'A' ? 'A' : letter === 'D' ? 'D' : 'M';
    const symlink = oldMode === '120000' || newMode === '120000';
    changes.push({ status, path: toPosix(p), symlink });
  }
  return changes;
}

/** Every `*.test.ts` file tracked under `server/test` at `ref`, repo-relative
 *  POSIX paths, recursive (matches vitest's own `test/**\/*.test.ts` include).
 *  THE one listing of the live tests: select.mjs builds every list from it,
 *  and map-build reads it through this module's `live-tests` subcommand.
 *
 *  `-z`, and nothing trimmed (final review FR-2): without it git C-QUOTES a
 *  path holding a non-ASCII byte, `"`, `\\` or a control character
 *  (`"server/test/caf\\303\\251.test.ts"`), which fails the `.test.ts`
 *  filter below — the test would leave every list, and the full run and the
 *  stable gate would go green without it. A name no shard list can carry is
 *  refused by `unsafeTestPaths`' callers, loudly, never dropped here.
 *  @param {string} repoDir @param {string} [ref] @returns {string[]} */
export function liveTestFiles(repoDir, ref = 'HEAD') {
  const raw = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', ref, '--', 'server/test'], {
    cwd: repoDir, maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  return raw.split('\0')
    .filter((l) => l.length > 0 && l.endsWith('.test.ts'))
    .map(toPosix)
    .sort();
}

/** A character no list of test paths here can carry: whitespace (every
 *  matrix joins its files with spaces), a control character (the list files
 *  are one path per line), a double quote or a backslash (the characters git
 *  and the shell steps quote or escape). Non-ASCII passes: it travels as-is. */
export const UNSAFE_TEST_PATH = /[\s\x00-\x1f\x7f"\\]/;

/** The paths among `paths` that `UNSAFE_TEST_PATH` refuses.
 *  @param {string[]} paths @returns {string[]} */
export function unsafeTestPaths(paths) {
  return paths.filter((p) => UNSAFE_TEST_PATH.test(p));
}

/** Curried `git cat-file -e <ref>:<path>` — true iff SOMETHING (blob or tree)
 *  exists at that path at that ref. Used on directory paths too: a directory
 *  is a tree object, and `cat-file -e` answers it exactly like a file, which
 *  is what lets the affected-set walk (below) ask "did this ancestor
 *  directory exist before/after" with the same primitive it uses for files.
 *  @param {string} repoDir @returns {(ref: string, p: string) => boolean} */
export function gitExistsAt(repoDir) {
  return (ref, p) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${ref}:${p}`], { cwd: repoDir, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };
}

const PACKAGE_FILE_RE = /^(package\.json|package-lock\.json)$/;
const VITEST_CONFIG_RE = /^vitest\..*config\.[cm]?[jt]s$/;
const TSCONFIG_RE = /^tsconfig.*\.json$/;
// Consumed by the setup steps before any traced process: git applies `.gitattributes` at checkout (an `eol`
// attribute rewrites a script's line endings), `npm ci` reads `.npmrc`, and the packages' install lifecycle
// runs server/scripts/.
const GITATTRIBUTES_RE = /^\.gitattributes$/;
const NPMRC_RE = /^\.npmrc$/;

/** Parent directory of a repo-relative POSIX path, `'.'` at the root — the
 *  same "root is `.`" convention CONTRACT.md states for every path in this
 *  module. */
function parentOf(p) {
  const dir = path.posix.dirname(p);
  return dir === '' ? '.' : dir;
}

/** The full-run trigger (spec §6.3's changed-set bullet): a reason string
 *  when ANY changed path is infrastructure the map cannot safely reason
 *  about, else `null`. Checked before any per-test rule — a match here means
 *  the whole selection question is moot.
 *
 *  What the baseline READ or PROBED is a trigger: that is vitest's own
 *  startup, which every test shares. What it LISTED is not. The baseline
 *  lists `server/test/` because the include glob walks it (with a literal
 *  include too, measured), so as a trigger it would make every PR that adds
 *  or deletes a test file run the full suite — 29 of the last 60 merged PRs.
 *  Dropping it loses nothing: records are split by process (`testmap.mjs`),
 *  so a test that walks `server/test/` in its OWN right keeps that listing
 *  and is selected by rule 5, and the added test itself by rule 1. A
 *  directory the baseline linked whole (`subtree`) IS a trigger, for the same
 *  reason its reads are: it is subtracted from every test.
 *  @param {Change[]} changes @param {DepRecord} baseline @returns {string | null} */
export function fullTrigger(changes, baseline) {
  const readSet = new Set(baseline.read);
  const probedSet = new Set(baseline.probed);
  for (const c of [...changes].sort((a, b) => a.path.localeCompare(b.path))) {
    const base = path.posix.basename(c.path);
    if (PACKAGE_FILE_RE.test(base)) return `package manifest changed: ${c.path}`;
    if (VITEST_CONFIG_RE.test(base)) return `vitest config changed: ${c.path}`;
    if (TSCONFIG_RE.test(base)) return `tsconfig changed: ${c.path}`;
    if (GITATTRIBUTES_RE.test(base)) return `checkout attributes changed: ${c.path}`;
    if (NPMRC_RE.test(base)) return `npm config changed: ${c.path}`;
    if (c.path.startsWith('server/scripts/')) return `install script changed: ${c.path}`;
    if (c.path === '.github' || c.path.startsWith('.github/')) return `pipeline path changed: ${c.path}`;
    if (c.symlink) return `symlink changed: ${c.path}`;
    if (readSet.has(c.path)) return `baseline reads this path: ${c.path}`;
    if (probedSet.has(c.path)) return `baseline probed this path: ${c.path}`;
    if (baseline.subtree.some((dir) => atOrUnder(c.path, dir))) return `baseline links this directory: ${c.path}`;
  }
  return null;
}

/** Ancestor directories of `p`, immediate parent first, ending at `'.'`
 *  (exclusive of `p` itself, inclusive of `'.'`). */
function ancestors(p) {
  const out = [];
  let cur = parentOf(p);
  while (true) {
    out.push(cur);
    if (cur === '.') break;
    cur = parentOf(cur);
  }
  return out;
}

/** The affected set `Pa` and entry directory `E` for one A/D change (spec
 *  §6.2's rule text, restated in CONTRACT.md Task 5): starting at `p`'s
 *  immediate parent, walk ancestors while each one is ABSENT at the other
 *  side of the change (before the add, or after the delete) — those
 *  ancestors are themselves newly-created-or-removed, so they belong in `Pa`
 *  alongside `p`. `E`, the entry directory, is the parent of the highest
 *  (most-ancestral) member of `Pa` — the directory that existed on both
 *  sides and whose LISTING changed.
 *  @param {Change} change @param {(ref: string, p: string) => boolean} existsAt
 *  @param {string} mapSha @returns {{ Pa: string[], E: string }} */
function affectedSet(change, existsAt, mapSha) {
  const otherRef = change.status === 'A' ? mapSha : 'HEAD';
  const chain = [change.path];
  for (const anc of ancestors(change.path)) {
    if (existsAt(otherRef, anc)) break;
    chain.push(anc);
    if (anc === '.') break;
  }
  const topMost = chain[chain.length - 1];
  const E = topMost === '.' ? '.' : parentOf(topMost);
  return { Pa: chain, E };
}

/**
 * UNCERTAIN means FULL (selection spec §6.3). A record is only as good as the commit it was traced at, and a bounded
 * refresh carries the tests it did not retrace with their old stamp. A live test is uncertain when its record is older
 * than a change that would select it — the change set between its `tracedAt` and the map's `sha`, `staleChanges` — or
 * when it was never traced: it existed when the map was built and the map holds no record for it. A test added since
 * the map is not uncertain; rule 1 selects it. A record at the map's own sha is never uncertain, and nor is one that
 * rule 2 selects whatever changed (unknown, or reading `.git`). No change set for a stamp, a stamp that is not a
 * commit select could diff, is uncertain too: nothing says the record is current.
 * @param {{ map: TestMap, liveTests: string[], staleChanges?: Map<string, Change[]>, existsAt: (ref: string, p: string) => boolean }} args
 * @returns {Array<{ file: string, why: string, tracedAt: string | null }>}
 */
export function uncertainTests({ map, liveTests, staleChanges, existsAt }) {
  /** @type {Array<{ file: string, why: string, tracedAt: string | null }>} */
  const out = [];
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  // Only a map that stamps its records can say a test was never traced: in a map from before stamping, a test
  // missing from it is the old rule 1 (selected, not full).
  const stamped = Object.values(map.tests).some((r) => r.tracedAt !== undefined);
  for (const file of [...liveTests].sort()) {
    if (!Object.prototype.hasOwnProperty.call(map.tests, file)) {
      if (stamped && existsAt(map.sha, file)) out.push({ file, why: 'never traced', tracedAt: null });
      continue;
    }
    const at = map.tests[file].tracedAt ?? map.sha;
    if (at === map.sha) continue;
    const g = groups.get(at);
    if (g) g.push(file); else groups.set(at, [file]);
  }
  for (const [at, files] of groups) {
    const changes = staleChanges?.get(at);
    if (!changes) {
      for (const file of files) out.push({ file, why: `no change set since ${at.slice(0, 12)}`, tracedAt: at });
      continue;
    }
    const full = fullTrigger(changes, map.baseline);
    if (full) {
      for (const file of files) out.push({ file, why: `${full}, after it was traced`, tracedAt: at });
      continue;
    }
    for (const t of selectAmong({ map, sha: at, changes, files, existsAt })) {
      if (t.rule !== 2) out.push({ file: t.file, why: `${RULE_NAMES[t.rule]} ${t.path}, after it was traced`, tracedAt: at });
    }
  }
  return out.sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : 0));
}

/**
 * @param {{ map: TestMap, changes: Change[], liveTests: string[], existsAt: (ref: string, p: string) => boolean, staleChanges?: Map<string, Change[]>, queueRunsUnmapped?: boolean }} args
 *   `staleChanges`: for each older stamp in the map, the changes from that commit to the map's `sha` (select.mjs
 *   reads them). A record with an older stamp and no change set here is uncertain; a map from before stamping has
 *   no older stamps.
 *
 *   `queueRunsUnmapped` (a pull request, diffed from its merge base; operator ruling 2026-10-25: the merge queue
 *   runs the whole suite): what the map cannot vouch for is LEFT TO THE QUEUE instead of turning the pull request
 *   into a full run. A live test the map has no entry for is selected only when the change touches it (rule 1);
 *   an uncertain test (its record older than a change to what it read) is selected only when this change hits it
 *   through the per-file rules, read against the record it has. The rest are listed in `queued`, never dropped
 *   silently, and the queue's full run is what tests them before the merge. Such tests arrived on main, or moved
 *   under their record, after the map was built: selecting or going full for each made a day-old map run most of
 *   the suite on every pull request.
 * @returns {Selection}
 */
export function selectTests({ map, changes, liveTests, existsAt, staleChanges, queueRunsUnmapped = false }) {
  const full = fullTrigger(changes, map.baseline);
  if (full) return { mode: 'full', reason: full };
  const uncertain = uncertainTests({ map, liveTests, staleChanges, existsAt });
  if (queueRunsUnmapped) {
    const tests = selectAmong({ map, sha: map.sha, changes, files: liveTests, existsAt, queueRunsUnmapped: true });
    const chosen = new Set(tests.map((t) => t.file));
    const unmapped = liveTests.filter((f) => !Object.prototype.hasOwnProperty.call(map.tests, f) && !chosen.has(f)).sort();
    const unmappedSet = new Set(unmapped);
    const uncertainQueued = uncertain.map((u) => u.file).filter((f) => !chosen.has(f) && !unmappedSet.has(f));
    return { mode: 'selected', tests, queued: { unmapped, uncertain: uncertainQueued } };
  }
  if (uncertain.length > 0) {
    const u = uncertain[0];
    return { mode: 'full', reason: `uncertain: ${uncertain.length} test(s) whose record is older than a change to what it read, first ${u.file} (${u.why})` };
  }
  return { mode: 'selected', tests: selectAmong({ map, sha: map.sha, changes, files: liveTests, existsAt }) };
}

/** The selection a refresh retraces from: the full trigger and the per-file rules, but NOT the uncertain-means-full
 *  answer — a refresh is what makes the uncertain records certain again, so it asks `uncertainTests` for them itself.
 *  @param {{ map: TestMap, changes: Change[], liveTests: string[], existsAt: (ref: string, p: string) => boolean }} args
 *  @returns {Selection} */
export function selectIgnoringUncertainty({ map, changes, liveTests, existsAt }) {
  const full = fullTrigger(changes, map.baseline);
  if (full) return { mode: 'full', reason: full };
  return { mode: 'selected', tests: selectAmong({ map, sha: map.sha, changes, files: liveTests, existsAt }) };
}

/** The per-file rules (spec §6.2) over `files`, for `changes` made since `sha` (the commit the records were traced at).
 *  `queueRunsUnmapped`: a test the map has no entry for is selected only when the change touches it (selectTests).
 *  @param {{ map: TestMap, sha: string, changes: Change[], files: string[], existsAt: (ref: string, p: string) => boolean, queueRunsUnmapped?: boolean }} args
 *  @returns {Array<{ file: string, rule: 1|2|3|4|5|6, path: string }>} */
function selectAmong({ map, sha, changes, files, existsAt, queueRunsUnmapped = false }) {
  // Precompute once per change, not once per test x change.
  const changed = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  const changedByPath = new Map(changed.map((c) => [c.path, c]));
  const analyses = changed.map((c) => {
    if (c.status === 'M') return { change: c, Pa: [c.path], E: null };
    const { Pa, E } = affectedSet(c, existsAt, sha);
    return { change: c, Pa, E };
  });

  /** @type {Array<{ file: string, rule: 1|2|3|4|5|6, path: string }>} */
  const selected = [];

  for (const file of [...files].sort()) {
    const changedHere = changedByPath.get(file);
    const inMap = Object.prototype.hasOwnProperty.call(map.tests, file);

    // Rule 1 — NEW: the test file itself is new/modified, or the map has no
    // entry for it at all (never traced, so nothing else here is safe to trust).
    if (!inMap && queueRunsUnmapped && !changedHere) continue;
    if (!inMap || (changedHere && (changedHere.status === 'A' || changedHere.status === 'M'))) {
      selected.push({ file, rule: 1, path: file });
      continue;
    }

    const rec = map.tests[file];

    // Rule 2 — ALWAYS: an unknown trace, or a test that reads `.git` (spec
    // §5.2: it reads the whole tracked tree or its history, so every change
    // is potentially relevant to it).
    if (rec.unknown || rec.git) {
      selected.push({ file, rule: 2, path: file });
      continue;
    }

    const readSet = new Set(rec.read);
    const probedSet = new Set(rec.probed);
    const listedSet = new Set(rec.listed);

    // Rule 3 — READ: a modified/deleted/renamed path (or, for A/D, any
    // ancestor in its affected set) sits in this test's `read`.
    let hit = null;
    for (const a of analyses) {
      if (a.change.status === 'M') {
        if (readSet.has(a.change.path)) { hit = a; break; }
      } else if (a.Pa.some((x) => readSet.has(x))) {
        hit = a; break;
      }
    }
    if (hit) {
      selected.push({ file, rule: 3, path: hit.change.path });
      continue;
    }

    // Rule 4 — PROBED: an added path (or an ancestor newly created with it)
    // sits in this test's `probed` (a path it checked for and found absent).
    hit = null;
    for (const a of analyses) {
      if (a.change.status !== 'A') continue;
      if (a.Pa.some((x) => probedSet.has(x))) { hit = a; break; }
    }
    if (hit) {
      selected.push({ file, rule: 4, path: hit.change.path });
      continue;
    }

    // Rule 5 — LISTED: an added/deleted path's entry directory sits in this
    // test's `listed` (it enumerated that directory). `a.E` is `null` for
    // every `M` change (an unchanged path can't have a new/gone entry
    // directory), which already excludes them here without a separate status
    // check.
    hit = null;
    for (const a of analyses) {
      if (a.E !== null && listedSet.has(a.E)) { hit = a; break; }
    }
    if (hit) {
      selected.push({ file, rule: 5, path: hit.change.path });
      continue;
    }

    // Rule 6 — SUBTREE: any changed path (added, modified or deleted) at or
    // under a directory this test linked whole into a fixture home: what it
    // stat'ed or probed through the link left no path of its own to match.
    const through = changed.find((c) => rec.subtree.some((dir) => atOrUnder(c.path, dir)));
    if (through) {
      selected.push({ file, rule: 6, path: through.path });
    }
  }

  return selected;
}

/** `live-tests [--repo DIR]`: `liveTestFiles` at HEAD, one path per line —
 *  map-build's live list, so there is ONE listing. Refuses (exit 1, nothing
 *  printed) a name `UNSAFE_TEST_PATH` refuses, as select.mjs does: a line
 *  cannot carry a newline, and a list read line by line must not split one.
 *  @param {string[]} args */
function liveTestsCli(args) {
  const opt = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i]?.startsWith('--')) opt[args[i].slice(2)] = args[i + 1];
  }
  const live = liveTestFiles(opt.repo ?? process.cwd());
  const unsafe = unsafeTestPaths(live);
  if (unsafe.length > 0) {
    throw new Error(`select-tests.mjs live-tests: a live test path a list cannot carry: ${unsafe.map((p) => JSON.stringify(p)).join(', ')}`);
  }
  process.stdout.write(live.map((f) => `${f}\n`).join(''));
}

/** For each stamp older than the map's own sha, the changes from that commit to the map's sha: what a record traced
 *  there has missed since. A stamp git cannot diff (not a commit here, or not an ancestor of the map's sha) gets no
 *  entry, which `uncertainTests` reads as uncertain.
 *  @param {string} repoDir @param {TestMap} map @returns {Map<string, import('./select-tests.mjs').Change[]>} */
export function gitStaleChanges(repoDir, map) {
  /** @type {Map<string, import('./select-tests.mjs').Change[]>} */
  const out = new Map();
  for (const rec of Object.values(map.tests)) {
    const at = rec.tracedAt;
    if (!at || at === map.sha || out.has(at)) continue;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', at, map.sha], { cwd: repoDir, stdio: 'pipe' });
      out.set(at, readChanges(repoDir, at, map.sha));
    } catch {
      // no entry: uncertain
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'live-tests') {
    liveTestsCli(args.slice(1));
    return;
  }
  const opt = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i]?.startsWith('--')) opt[args[i].slice(2)] = args[i + 1];
  }
  const repoDir = opt.repo ?? process.cwd();
  const { readMap } = await import('./testmap.mjs');
  const mapResult = readMap(opt.map);
  if (!mapResult.ok) {
    console.log(JSON.stringify({ mode: 'full', reason: `map unreadable: ${mapResult.reason}` }));
    return;
  }
  const changes = readChanges(repoDir, mapResult.map.sha, opt.to ?? 'HEAD');
  const liveTests = liveTestFiles(repoDir, opt.to ?? 'HEAD');
  const selection = selectTests({
    map: mapResult.map, changes, liveTests, existsAt: gitExistsAt(repoDir),
    staleChanges: gitStaleChanges(repoDir, mapResult.map),
  });
  console.log(JSON.stringify(selection));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
