// The history replay (spec §11.3, Task 10): the acceptance measurement for
// the selector. Given one real historical case — the files a real merge
// changed, and the server test files that actually failed for it — this
// module answers whether the selector, run against a given `TestMap`, would
// have selected every one of those failing tests. It is built entirely on
// Task 5's `selectTests`/`fullTrigger` (no rule logic is duplicated here),
// the way CONTRACT.md's Task 9 (`select.mjs`) is also meant to be built on
// them — this is the second, independent caller that proves the rule engine
// composes rather than needing its own copy.
//
// CONTRACT.md's `replayCase` signature and CLI are exact; the dataset file
// shape and the `summarizeReplay` aggregation are this module's own design —
// the contract does not pin either, and both are called out in this plan's
// `contract_issues`. A dataset is a JSON array of `{ id, changedFiles,
// failingTestFiles, inheritedSuspect }`; any other field a case carries —
// the frozen study set beside the spec also has `event` and `job` — is
// ignored. The report opens with the set's size (`describeDataset`), so a
// thin collection is never read as the study's window.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { selectTests } from './select-tests.mjs';
import { readMap } from './testmap.mjs';

/** @typedef {import('./testmap.mjs').TestMap} TestMap */
/** @typedef {import('./select-tests.mjs').Change} Change */

/**
 * @param {{ map: TestMap, changedFiles: string[], failingTestFiles: string[], existsAt: (ref: string, p: string) => boolean }} args
 * `notProven`: the failing tests absent from the map. Rule 1 selects such a test for being unmapped, not for
 * any recorded dependency, so it proves nothing about the map — it is reported apart and kept out of recall,
 * never counted as caught.
 * @returns {{ selected: string[], missed: string[], notProven: string[], mode: 'selected' | 'full' }}
 */
export function replayCase({ map, changedFiles, failingTestFiles, existsAt }) {
  /** @type {Change[]} */
  const changes = changedFiles.map((p) => ({
    // The dataset records WHICH files changed, not their git status letter —
    // a real replay case comes from a merge's file list, which carries no
    // A/M/D tag of its own. A changed path this map's commit never saw is
    // necessarily new (A); everything else is treated as a modification.
    // Deletions are outside what this signature can express (CONTRACT.md's
    // note: "a changed file absent at map.sha is A, else M" names only
    // these two), which under-approximates the A/D affected-set logic for a
    // replayed deletion — recorded in this plan's `contract_issues`.
    status: existsAt(map.sha, p) ? 'M' : 'A',
    path: p,
    symlink: false,
  }));

  // Live tests, for a historical case, are every test this function can be
  // sure existed in that tree: everything the map already knows about, every
  // test that is recorded as having failed (it ran, so it existed), and any
  // changed path that is itself shaped like a server test file (covers a
  // brand-new test added by the same change, mirroring `selectTests` rule 1).
  const liveTests = new Set(Object.keys(map.tests));
  for (const f of failingTestFiles) liveTests.add(f);
  for (const p of changedFiles) {
    if (p.startsWith('server/test/') && p.endsWith('.test.ts')) liveTests.add(p);
  }

  const selection = selectTests({ map, changes, liveTests: [...liveTests], existsAt });
  const notProven = failingTestFiles.filter((f) => !Object.prototype.hasOwnProperty.call(map.tests, f)).sort();

  if (selection.mode === 'full') {
    return { selected: [...liveTests].sort(), missed: [], notProven, mode: 'full' };
  }
  const selected = selection.tests.map((t) => t.file).sort();
  const selectedSet = new Set(selected);
  const missed = failingTestFiles.filter((f) => !selectedSet.has(f)).sort();
  return { selected, missed, notProven, mode: 'selected' };
}

/**
 * How many server tests were live for a case, the denominator of its selected fraction. The dataset carries no
 * tree to list them from, so this is the union of the map's tests and the selected ones: a selected test is live
 * by definition (a failing test the map never traced is live by `replayCase`'s union), so the fraction can never
 * exceed 1. Dividing by the map's count alone did — 233% on a three-test map.
 * @param {TestMap} map
 * @param {string[]} selected
 * @returns {number}
 */
export function liveCountFor(map, selected) {
  return new Set([...Object.keys(map.tests), ...selected]).size;
}

/**
 * One dataset case's outcome plus the identifying fields a report needs.
 * @typedef {{ id: string, mode: 'selected'|'full', selected: string[], missed: string[], notProven: string[], failingTestFiles: string[], liveCount: number, inheritedSuspect: boolean }} ReplayOutcome
 */

/**
 * Aggregates a set of `ReplayOutcome`s into the report `select.mjs`'s CLI
 * prints (Task 10's own design — CONTRACT.md leaves the report shape open).
 * "Micro" recall pools every failing-test instance across every case;
 * "by-case" recall is the fraction of cases with zero misses. Both exclude
 * `inheritedSuspect` cases from the headline (spec §11.3 restated in
 * CONTRACT.md Task 10: those failures may not belong to the case's own
 * change at all, so scoring them against it would understate recall for a
 * reason that has nothing to do with the selector).
 * @param {ReplayOutcome[]} outcomes
 */
export function summarizeReplay(outcomes) {
  const headline = outcomes.filter((o) => !o.inheritedSuspect);
  const excluded = outcomes.filter((o) => o.inheritedSuspect);

  // Recall counts only PROVEN failures — those the map has a record for (see replayCase's `notProven`). A case
  // is scored only when it has at least one.
  let totalFailing = 0;
  let totalCaught = 0;
  let casesScored = 0;
  let casesClean = 0;
  for (const o of headline) {
    const proven = o.failingTestFiles.length - o.notProven.length;
    if (proven === 0) continue;
    casesScored += 1;
    totalFailing += proven;
    totalCaught += proven - o.missed.length;
    if (o.missed.length === 0) casesClean += 1;
  }
  const recallMicro = totalFailing === 0 ? 1 : totalCaught / totalFailing;
  const recallByCase = casesScored === 0 ? 1 : casesClean / casesScored;

  const fractions = headline
    .map((o) => (o.liveCount === 0 ? 0 : o.selected.length / o.liveCount))
    .sort((a, b) => a - b);
  const pick = (q) => (fractions.length === 0 ? 0 : fractions[Math.min(
    fractions.length - 1, Math.floor(q * (fractions.length - 1)),
  )]);

  const misses = headline
    .filter((o) => o.missed.length > 0)
    .map((o) => ({ id: o.id, missed: o.missed }));

  const notProven = headline
    .filter((o) => o.notProven.length > 0)
    .map((o) => ({ id: o.id, files: o.notProven }));

  return {
    recallMicro,
    recallByCase,
    casesConsidered: casesScored,
    notProven,
    casesExcludedInheritedSuspect: excluded.length,
    selectedFraction: {
      min: fractions[0] ?? 0, median: pick(0.5), max: fractions[fractions.length - 1] ?? 0,
    },
    misses,
  };
}

/**
 * The selected share of server RUNTIME for one change (spec §11.3's "selected share of server runtime across
 * the last 100 merged PRs"): the durations of the files `selectTests` picks against today's map, over the
 * durations of every test in it. Historical per-commit durations do not exist, so today's table weighs every
 * change; a file with no duration gets the median of the known ones (spec §7.1). A full trigger is 1.
 * @param {{ map: TestMap, changedFiles: string[], existsAt: (ref: string, p: string) => boolean, durations: Record<string, number> }} args
 * @returns {number}
 */
export function runtimeShare({ map, changedFiles, existsAt, durations }) {
  const live = Object.keys(map.tests).sort();
  /** @type {Change[]} */
  const changes = changedFiles.map((p) => ({ status: existsAt(map.sha, p) ? 'M' : 'A', path: p, symlink: false }));
  const selection = selectTests({ map, changes, liveTests: live, existsAt });
  if (selection.mode === 'full') return 1;
  const known = Object.values(durations).sort((a, b) => a - b);
  const mid = known.length >> 1;
  const median = known.length === 0 ? 1 : known.length % 2 === 1 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  const weight = (f) => durations[f] ?? median;
  const total = live.reduce((s, f) => s + weight(f), 0);
  const chosen = selection.tests.reduce((s, t) => s + weight(t.file), 0);
  return total === 0 ? 0 : chosen / total;
}

/**
 * The size of a replay dataset, for the report: how many cases are REAL (their id starts with a CI run id — `<run>`
 * from the dataset builder, `<run>:<job>` in the frozen study set), from how many distinct runs, how many are
 * synthetic (any other id), and how many carry `inheritedSuspect`. Any other field a case carries (`event`, `job`)
 * is ignored here and everywhere else.
 * @param {Array<Record<string, unknown> & { id: string, inheritedSuspect?: boolean }>} dataset
 * @returns {{ real: number, runs: number, synthetic: number, inheritedSuspect: number }}
 */
export function describeDataset(dataset) {
  const runs = new Set();
  let real = 0;
  for (const c of dataset) {
    const m = /^(\d+)(?::|$)/.exec(String(c.id));
    if (m) {
      real += 1;
      runs.add(m[1]);
    }
  }
  return { real, runs: runs.size, synthetic: dataset.length - real, inheritedSuspect: dataset.filter((c) => !!c.inheritedSuspect).length };
}

/** @param {{ real: number, runs: number, synthetic: number, inheritedSuspect: number }} d */
export function datasetLine(d) {
  return `dataset: ${d.real} real cases from ${d.runs} runs, ${d.synthetic} synthetic, ${d.inheritedSuspect} inheritedSuspect`;
}

/** @param {number[]} shares @returns {{ count: number, min: number, median: number, max: number, mean: number }} */
export function summarizeShares(shares) {
  const s = [...shares].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { count: 0, min: 0, median: 0, max: 0, mean: 0 };
  const mid = n >> 1;
  return {
    count: n,
    min: s[0],
    median: n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
    max: s[n - 1],
    mean: s.reduce((a, b) => a + b, 0) / n,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function formatPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const { gitExistsAt } = await import('./select-tests.mjs');
  const repoDir = opt.repo ?? process.cwd();

  const mapResult = readMap(opt.map);
  if (!mapResult.ok) {
    console.error(`cannot read --map: ${mapResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const map = mapResult.map;
  const existsAt = gitExistsAt(repoDir);

  // The runtime-share report: --prs FILE (a JSON array of { number, files }, `files` paths or { path }, as
  // `gh pr list --json number,files` gives them) weighed by --times FILE (a durations table).
  if (opt.prs) {
    if (!opt.times) throw new Error('--prs needs --times FILE (a durations table)');
    const prs = JSON.parse(readFileSync(opt.prs, 'utf8'));
    const durations = JSON.parse(readFileSync(opt.times, 'utf8'));
    const shares = prs.map((pr) => runtimeShare({
      map, existsAt, durations,
      changedFiles: (pr.files ?? []).map((f) => (typeof f === 'string' ? f : f.path)),
    }));
    const s = summarizeShares(shares);
    console.log(`selected share of server runtime over ${s.count} PRs — min ${formatPct(s.min)}, median ${formatPct(s.median)}, max ${formatPct(s.max)}, mean ${formatPct(s.mean)}`);
  }
  if (!opt.dataset) return;

  const dataset = JSON.parse(readFileSync(opt.dataset, 'utf8'));
  /** @type {ReplayOutcome[]} */
  const outcomes = dataset.map((c) => {
    const { selected, missed, notProven, mode } = replayCase({
      map, changedFiles: c.changedFiles, failingTestFiles: c.failingTestFiles, existsAt,
    });
    const liveCount = liveCountFor(map, selected);
    return {
      id: c.id, mode, selected, missed, notProven, failingTestFiles: c.failingTestFiles,
      liveCount, inheritedSuspect: !!c.inheritedSuspect,
    };
  });

  const summary = summarizeReplay(outcomes);

  console.log(datasetLine(describeDataset(dataset)));
  console.log(`cases: ${outcomes.length} (${summary.casesConsidered} scored, ${summary.casesExcludedInheritedSuspect} excluded as inheritedSuspect)`);
  // With no proven failure there is nothing to score: say so, never a vacuous 100% (a map too thin for the set).
  const nothing = summary.casesConsidered === 0 ? 'n/a (no proven failure — nothing to score)' : null;
  console.log(`recall (micro, pooled over failing-test instances): ${nothing ?? formatPct(summary.recallMicro)}`);
  console.log(`recall (by case, zero-miss cases / scored cases):   ${nothing ?? formatPct(summary.recallByCase)}`);
  console.log(`selected fraction of live server tests — min ${formatPct(summary.selectedFraction.min)}, median ${formatPct(summary.selectedFraction.median)}, max ${formatPct(summary.selectedFraction.max)}`);
  const unproven = summary.notProven.reduce((n, c) => n + c.files.length, 0);
  console.log(`not proven (failing tests absent from the map, kept out of recall): ${unproven} in ${summary.notProven.length} case(s)`);
  for (const c of summary.notProven) console.log(`  ${c.id}: ${c.files.join(', ')}`);
  if (summary.misses.length === 0) {
    console.log('misses: none');
  } else {
    console.log(`misses (${summary.misses.length} case(s)):`);
    for (const m of summary.misses) {
      console.log(`  ${m.id}: ${m.missed.join(', ')}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
