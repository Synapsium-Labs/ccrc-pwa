// The `select` job's entry point (spec §3-§4, §6, contract Task 9). This is
// the ONE place that turns a GitHub Actions trigger into what the rest of the
// pipeline runs: it decides the mode from the event (`decideMode`), and for
// any mode that needs a real per-file answer (`selected`, or a `refresh`
// trace list) it calls Task 5's `selectTests` against Task 4's `TestMap` and
// Task 6's `planShards`/`toMatrix` — no selection rule is duplicated here.
// It is deliberately the only module in `.github/ci/` that touches
// `$GITHUB_OUTPUT`/`$GITHUB_STEP_SUMMARY`, so every other module stays a pure
// library callable from a test without an Actions runner.
//
// Two conditions are refused outright — the process exits non-zero with no
// output written, so the `select` job fails and `test (server)` goes red —
// because each would otherwise produce a GREEN run that tested nothing, or the
// wrong thing: a live-test list that cannot be read or is empty (`full` with
// zero files skips every shard, and a skip with count 0 is a pass), and a
// live test path containing whitespace (every matrix joins its files with
// spaces, so such a path would split into two filters that match nothing).
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readMap } from './testmap.mjs';
import { readChanges, liveTestFiles, gitExistsAt, selectTests, RULE_NAMES } from './select-tests.mjs';
import { planShards, toMatrix, PROFILES } from './shards.mjs';

/** @typedef {import('./testmap.mjs').TestMap} TestMap */
/** @typedef {import('./select-tests.mjs').Selection} Selection */

/**
 * @typedef {{ tests: 'selected'|'full'|'none', trace: 'none'|'refresh'|'rebuild', skip: boolean }} ModeDecision
 */

/**
 * Maps a trigger to a mode (spec §3's table, restated exactly by
 * CONTRACT.md Task 9). Pure and total — every unrecognised combination
 * falls through to the same `full/none` the manual escape hatch uses, so a
 * misconfigured caller gets the SAFE answer, never a silent no-op.
 *
 * Order is significant, and matches the contract's own listing:
 *   1. `pull_request`                          -> selected / none — or full / none with `inputMode === 'full'`,
 *                                                 which ci.yml passes when the PR changes `.github/` (a plain-bash
 *                                                 check, so a PR cannot talk its own selector out of a full run)
 *   2. `push` with no `inputMode`               -> none / refresh
 *   3. `schedule`                                -> fullGreen ? none/none/skip : full/rebuild
 *   4. `inputMode === 'full'`                    -> full / none
 *   5. `inputMode === 'rebuild'`                  -> none / rebuild
 *   6. anything else                              -> full / none
 *
 * @param {{ event: string, inputMode?: string, fullGreen: boolean }} args
 * @returns {ModeDecision}
 */
export function decideMode({ event, inputMode, fullGreen }) {
  if (event === 'pull_request') {
    return inputMode === 'full'
      ? { tests: 'full', trace: 'none', skip: false }
      : { tests: 'selected', trace: 'none', skip: false };
  }
  if (event === 'push' && !inputMode) {
    return { tests: 'none', trace: 'refresh', skip: false };
  }
  if (event === 'schedule') {
    return fullGreen
      ? { tests: 'none', trace: 'none', skip: true }
      : { tests: 'full', trace: 'rebuild', skip: false };
  }
  if (inputMode === 'full') {
    return { tests: 'full', trace: 'none', skip: false };
  }
  if (inputMode === 'rebuild') {
    return { tests: 'none', trace: 'rebuild', skip: false };
  }
  return { tests: 'full', trace: 'none', skip: false };
}

/**
 * What a trigger can never answer (ruling T2), checked on decideMode's answer before anything runs: a pull
 * request always runs server tests (never `none`), and a schedule, a refresh push or a rebuild never runs a
 * per-file SELECTION (they run everything or nothing). A violation is a bug in this module; the CLI refuses it.
 * @param {string} event @param {string | undefined} inputMode @param {'selected'|'full'|'none'} tests
 * @returns {string | null}
 */
export function modeInvariantViolation(event, inputMode, tests) {
  if (event === 'pull_request' && tests === 'none') return 'a pull_request answered tests: none';
  if (tests === 'selected' && (event === 'schedule' || (event === 'push' && !inputMode) || inputMode === 'rebuild')) {
    return `a ${inputMode === 'rebuild' ? 'rebuild' : event} answered tests: selected`;
  }
  return null;
}

/** Every live server test file, or a thrown `Error` saying why there is no
 *  usable list — see the file header for why these refuse rather than fall
 *  back: every mode's matrices are built from this list, so there is no
 *  `full` to fall back TO without it.
 *  @param {string} repoDir @returns {string[]} */
function liveTestsOrRefuse(repoDir) {
  let live;
  try {
    live = liveTestFiles(repoDir);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    throw new Error(`select.mjs: cannot list the live server tests in ${repoDir}: ${msg}`);
  }
  if (live.length === 0) {
    throw new Error(`select.mjs: no live server test files under server/test in ${repoDir}`);
  }
  const spaced = live.filter((f) => /\s/.test(f));
  if (spaced.length > 0) {
    throw new Error(`select.mjs: a live test path contains whitespace, which the space-joined shard lists cannot carry: ${spaced.join(', ')}`);
  }
  return live;
}

/**
 * The real, per-file answer (spec §6): read the map, diff it against `HEAD`,
 * and run `selectTests`. Every failure along the way — an unreadable/
 * malformed map, a `map.sha` no longer reachable from this checkout, a git
 * command that fails for any other reason — is caught HERE and turned into
 * `{ mode: 'full', reason }` (spec §6.3's "the selector itself hits any
 * internal error ... emits mode full with the reason — it never answers
 * nothing"), so nothing above this function needs its own try/catch.
 *
 * @param {string} repoDir
 * @param {string | undefined} mapFile
 * @param {string[]} liveTests every live server test file (already computed
 *   by the caller, so this never re-reads it)
 * @returns {{ selection: Selection, map: TestMap | null }}
 */
function computeRealSelection(repoDir, mapFile, liveTests) {
  try {
    // No map is the ordinary first-run state (no trusted main artifact yet),
    // not a read error: say so, and say where it looked.
    if (!mapFile) {
      return { selection: { mode: 'full', reason: 'map: no map restored (select.mjs was given no --map)' }, map: null };
    }
    if (!existsSync(mapFile)) {
      return { selection: { mode: 'full', reason: `map: no map restored at ${mapFile}` }, map: null };
    }
    const mapResult = readMap(mapFile);
    if (!mapResult.ok) {
      return { selection: { mode: 'full', reason: `map: ${mapResult.reason}` }, map: null };
    }
    const map = mapResult.map;
    // Only a map from this tree's own history: its commit must be an ancestor of HEAD (exit 1 = it is not;
    // anything else — an unknown commit — throws and falls back below).
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', map.sha, 'HEAD'], { cwd: repoDir, stdio: 'pipe' });
    } catch (e) {
      if (e && /** @type {{ status?: number }} */ (e).status === 1) {
        return { selection: { mode: 'full', reason: `map: ${map.sha} is not an ancestor of HEAD` }, map: null };
      }
      throw e;
    }
    const changes = readChanges(repoDir, map.sha, 'HEAD');
    const existsAt = gitExistsAt(repoDir);
    const selection = selectTests({ map, changes, liveTests, existsAt });
    return { selection, map };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    return { selection: { mode: 'full', reason: `selector error: ${msg || 'unknown error'}` }, map: null };
  }
}

/** Markdown for `$GITHUB_STEP_SUMMARY` (spec §6.4's reason table, plus the
 *  mode/trace/fallback context a human needs to diagnose a later miss from
 *  this table alone). In shadow mode `selection` is still the REAL,
 *  would-be selection — only the matrices differ (contract: "the table is
 *  the would-be selection and the matrices carry ALL live tests").
 *  @param {{ event: string, inputMode: string|undefined, decide: ModeDecision, testsOut: string, shadowFlag: boolean, fallback: string, selection: Selection|null, mapSha: string, fileCount: number }} args
 *  @returns {string} */
function renderSummary({ event, inputMode, decide, testsOut, shadowFlag, fallback, selection, mapSha, fileCount }) {
  const lines = ['## CI test selection', ''];
  lines.push(`- event: \`${event}\`${inputMode ? ` (input mode: \`${inputMode}\`)` : ''}`);
  lines.push(`- tests: \`${testsOut}\`${shadowFlag ? ' — shadow: matrices below carry ALL live tests' : ''}`);
  lines.push(`- trace: \`${decide.trace}\``);
  if (mapSha) lines.push(`- map: \`${mapSha}\``);
  if (fallback) lines.push(`- fallback reason: ${fallback}`);
  lines.push('');
  if (selection && selection.mode === 'selected') {
    if (selection.tests.length === 0) {
      lines.push('_no server test file is affected by this change_');
    } else {
      lines.push('| rule | test | changed path |', '|---|---|---|');
      for (const t of selection.tests) {
        lines.push(`| ${t.rule} ${RULE_NAMES[t.rule]} | \`${t.file}\` | \`${t.path}\` |`);
      }
    }
  } else if (testsOut === 'none') {
    lines.push('_nothing to run — mode \`none\`_');
  } else if (testsOut === 'full') {
    lines.push(`_full run — ${fileCount} server test file(s)_`);
  }
  return lines.join('\n') + '\n';
}

/** Appends every `[name, value]` pair to `$GITHUB_OUTPUT` in the delimited
 *  form GitHub Actions requires for a value that may contain a newline (every
 *  matrix here is JSON on one line, but the reason strings are free text) —
 *  or, when unset (a local/test invocation), prints the same to stdout so
 *  the CLI is still inspectable without a runner.
 *  @param {Record<string, string>} outputs */
function writeOutputs(outputs) {
  const lines = [];
  for (const [name, value] of Object.entries(outputs)) {
    const delim = `ghadelim_${randomBytes(8).toString('hex')}`;
    lines.push(`${name}<<${delim}`, String(value), delim);
  }
  const text = lines.join('\n') + '\n';
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, text);
  } else {
    process.stdout.write(text);
  }
}

/** @param {string} md */
function writeSummary(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md);
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

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const repoDir = opt.repo ?? process.cwd();
  const event = opt.event ?? '';
  const inputMode = opt['input-mode'];
  const selectionMode = opt.selection ?? 'enforce';
  const fullGreen = opt['full-green'] === 'true';
  const mapFile = opt.map;
  const timesFile = opt.times;
  const traceListFile = opt['trace-list'];

  let durations = null;
  if (timesFile) {
    try {
      durations = JSON.parse(readFileSync(timesFile, 'utf8'));
    } catch {
      durations = null;
    }
  }

  const decide = decideMode({ event, inputMode, fullGreen });
  const violation = modeInvariantViolation(event, inputMode, decide.tests);
  if (violation) throw new Error(`select.mjs: ${violation} — refusing (ruling T2)`);
  const liveTestsAll = liveTestsOrRefuse(repoDir);

  const needsRealSelection = decide.tests === 'selected' || decide.trace === 'refresh';
  const realSel = needsRealSelection ? computeRealSelection(repoDir, mapFile, liveTestsAll) : null;

  let testsOut = decide.tests;
  let fallback = '';
  let mapSha = '';
  /** @type {Selection | null} */
  let selectionResult = null;

  if (decide.tests === 'selected') {
    if (realSel.selection.mode === 'full') {
      testsOut = 'full';
      fallback = realSel.selection.reason;
    } else {
      mapSha = realSel.map.sha;
      selectionResult = realSel.selection;
    }
  } else if (decide.trace === 'refresh') {
    if (realSel.selection.mode === 'full') {
      fallback = realSel.selection.reason;
    } else {
      mapSha = realSel.map.sha;
      selectionResult = realSel.selection;
    }
  }

  const shadowFlag = testsOut === 'selected' && selectionMode === 'shadow';

  /** @type {string[]} */
  let testFileList;
  if (testsOut === 'none') {
    testFileList = [];
  } else if (testsOut === 'selected') {
    testFileList = shadowFlag ? [...liveTestsAll] : selectionResult.tests.map((t) => t.file);
  } else {
    testFileList = [...liveTestsAll];
  }

  /** @type {string[]} */
  let traceList;
  if (decide.trace === 'none') {
    traceList = [];
  } else if (decide.trace === 'refresh') {
    traceList = realSel.selection.mode === 'full'
      ? [...liveTestsAll]
      : realSel.selection.tests.map((t) => t.file);
  } else {
    // rebuild: trace every live test (spec §5.3 / contract Task 9).
    traceList = [...liveTestsAll];
  }

  // The macOS budget follows the EVENT: a pull request keeps to 2 shards even when it fell back to full (the
  // organisation's 5 macOS slots are shared with every other PR); 4 only for the daily, dispatched or called
  // full run.
  const macosProfile = event !== 'pull_request' && testsOut === 'full' ? PROFILES.macosFull : PROFILES.macosSelected;

  const serverPlan = planShards(testFileList, durations, PROFILES.linux);
  const macosPlan = planShards(testFileList, durations, macosProfile);
  // `durations ?? {}`, never null: trace-run.mjs takes an exact list and has
  // no --shard, so the trace plan must always be a real partition (LPT at
  // defaultMs when no duration is known), never the fallback that hands every
  // shard every file plus a vitest `i/n`.
  const tracePlan = planShards(traceList, durations ?? {}, PROFILES.trace);

  // What this run MEANT to trace, for map-build: a refresh writes every one of
  // these that left no record as unknown instead of carrying its old entry.
  if (traceListFile) {
    mkdirSync(path.dirname(traceListFile), { recursive: true });
    writeFileSync(traceListFile, traceList.map((f) => `${f}\n`).join(''));
  }

  writeOutputs({
    tests: testsOut,
    trace: decide.trace,
    shadow: String(shadowFlag),
    count: String(testFileList.length),
    macos_count: String(testFileList.length),
    server_matrix: JSON.stringify(toMatrix(serverPlan)),
    macos_matrix: JSON.stringify(toMatrix(macosPlan)),
    trace_matrix: JSON.stringify(toMatrix(tracePlan)),
    trace_count: String(traceList.length),
    map_sha: mapSha,
    fallback,
  });

  writeSummary(renderSummary({
    event, inputMode, decide, testsOut, shadowFlag, fallback,
    selection: selectionResult, mapSha, fileCount: testFileList.length,
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
