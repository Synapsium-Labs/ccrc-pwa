// Task 10 (spec §11.3, CONTRACT.md `.github/ci/replay.mjs`): the history
// replay's core function (`replayCase`, exact contract signature) and the
// report aggregation (`summarizeReplay`, this module's own design — see the
// file's top comment on what the contract leaves open, restated in this
// plan's `contract_issues`). A tiny fixture dataset and map, per CONTRACT.md.
// Mutation table at the bottom.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { replayCase, summarizeReplay, liveCountFor, runtimeShare, summarizeShares, describeDataset, datasetLine } from '../../.github/ci/replay.mjs';
import type { ReplayOutcome } from '../../.github/ci/replay.mjs';
import type { DepRecord, TestMap, TestRecord } from '../../.github/ci/testmap.mjs';

const SHA_A = 'a'.repeat(40);
const emptyDep = (): DepRecord => ({ read: [], probed: [], listed: [], subtree: [], git: false });
const rec = (overrides: Partial<TestRecord> = {}): TestRecord => ({ ...emptyDep(), unknown: false, ...overrides });

// ─── git-backed CLI fixtures (F10-1): the replay CLI now refuses a --repo that ───
// does not carry the map's commit, so every CLI-invoking test needs a real repo
// whose HEAD is the sha the map names. Identity is passed via `-c user.name=`/
// `-c user.email=` on the commit itself, not env vars — no global config touched.
function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
}
function writeIn(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}
function gitCommitAll(dir: string, msg: string): string {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=ccrc fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-q', '-m', msg,
  ], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}
const replayCli = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'replay.mjs');

describe('replayCase', () => {
  it('a genuine hit: the failing test\'s recorded read intersects a changed file', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/dep.test.ts': rec({ read: ['server/src/dep.ts'] }) },
    };
    const result = replayCase({
      map, changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'],
      existsAt: () => true, // the changed file existed at map.sha -> status M
    });
    expect(result).toEqual({ selected: ['server/test/dep.test.ts'], missed: [], notProven: [], mode: 'selected' });
  });

  it('a genuine miss: the failing test has no recorded dependency on anything changed', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'server/test/unrelated.test.ts': rec({ read: ['server/src/other.ts'] }),
        'server/test/failed.test.ts': rec({ read: ['server/src/other.ts'] }),
      },
    };
    const result = replayCase({
      map, changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/failed.test.ts'],
      existsAt: () => true,
    });
    expect(result.mode).toBe('selected');
    expect(result.missed).toEqual(['server/test/failed.test.ts']);
    expect(result.selected).not.toContain('server/test/failed.test.ts');
  });

  it('infers status A (absent at map.sha) vs M (present) from existsAt, and PROBED (rule 4) only fires for A', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/probes.test.ts': rec({ probed: ['server/src/new.ts'] }) },
    };
    const asAdded = replayCase({
      map, changedFiles: ['server/src/new.ts'], failingTestFiles: ['server/test/probes.test.ts'],
      existsAt: () => false, // absent at map.sha -> status A
    });
    expect(asAdded.missed).toEqual([]);
    expect(asAdded.selected).toEqual(['server/test/probes.test.ts']);

    const asModified = replayCase({
      map, changedFiles: ['server/src/new.ts'], failingTestFiles: ['server/test/probes.test.ts'],
      existsAt: () => true, // present at map.sha -> status M, PROBED does not apply
    });
    expect(asModified.missed).toEqual(['server/test/probes.test.ts']);
  });

  it('a failing test absent from the map is NOT PROVEN — never counted as caught', () => {
    // Rule 1 selects it for being unmapped, not for any recorded dependency, so the case proves nothing about
    // the map: it is reported apart and kept out of recall.
    const map: TestMap = { format: 1, sha: SHA_A, baseline: emptyDep(), tests: {} };
    const result = replayCase({
      map, changedFiles: ['server/src/unrelated.ts'], failingTestFiles: ['server/test/never-traced.test.ts'],
      existsAt: () => true,
    });
    expect(result).toEqual({
      selected: ['server/test/never-traced.test.ts'], missed: [], notProven: ['server/test/never-traced.test.ts'], mode: 'selected',
    });
  });

  it('a brand-new test file among changedFiles (not in failingTestFiles) is live and selected', () => {
    const map: TestMap = { format: 1, sha: SHA_A, baseline: emptyDep(), tests: {} };
    const result = replayCase({
      map, changedFiles: ['server/test/new-feature.test.ts'], failingTestFiles: [],
      existsAt: () => false,
    });
    expect(result.selected).toEqual(['server/test/new-feature.test.ts']);
  });

  it('a full-trigger change selects everything live and reports zero misses regardless of what failed', () => {
    const map: TestMap = {
      format: 1, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'server/test/a.test.ts': rec(),
        'server/test/b.test.ts': rec(),
      },
    };
    const result = replayCase({
      map, changedFiles: ['server/package.json'], failingTestFiles: ['server/test/a.test.ts', 'server/test/b.test.ts'],
      existsAt: () => true,
    });
    expect(result).toEqual({
      mode: 'full', missed: [], notProven: [], selected: ['server/test/a.test.ts', 'server/test/b.test.ts'],
    });
  });
});

describe('summarizeReplay', () => {
  const outcome = (id: string, o: Partial<ReplayOutcome> = {}): ReplayOutcome => (
    { id, mode: 'selected', selected: [], missed: [], notProven: [], failingTestFiles: [], liveCount: 10, inheritedSuspect: false, ...o }
  );

  it('recall (micro) pools failing-test instances across cases; recall (by case) is the zero-miss fraction', () => {
    const outcomes = [
      outcome('case-1', { failingTestFiles: ['a', 'b'], missed: [] }), // 2/2 caught, clean
      outcome('case-2', { failingTestFiles: ['c', 'd'], missed: ['d'] }), // 1/2 caught, not clean
    ];
    const summary = summarizeReplay(outcomes);
    expect(summary.recallMicro).toBeCloseTo(3 / 4);
    expect(summary.recallByCase).toBeCloseTo(1 / 2);
    expect(summary.misses).toEqual([{ id: 'case-2', missed: ['d'] }]);
  });

  it('excludes inheritedSuspect cases from the headline recall, still counts them', () => {
    const outcomes = [
      outcome('clean', { failingTestFiles: ['a'], missed: [] }),
      outcome('suspect-miss', { failingTestFiles: ['x'], missed: ['x'], inheritedSuspect: true }),
    ];
    const summary = summarizeReplay(outcomes);
    expect(summary.recallMicro).toBe(1); // the suspect miss does not drag it down
    expect(summary.recallByCase).toBe(1);
    expect(summary.casesConsidered).toBe(1);
    expect(summary.casesExcludedInheritedSuspect).toBe(1);
    expect(summary.misses).toEqual([]); // suspect's miss is not reported in the headline list
  });

  it('selected-fraction distribution: min/median/max over the headline cases', () => {
    const outcomes = [
      outcome('small', { selected: ['a'], liveCount: 10 }), // 0.1
      outcome('half', { selected: ['a', 'b', 'c', 'd', 'e'], liveCount: 10 }), // 0.5
      outcome('all', { selected: Array.from({ length: 10 }, (_, i) => `t${i}`), liveCount: 10 }), // 1.0
    ];
    const summary = summarizeReplay(outcomes);
    expect(summary.selectedFraction.min).toBeCloseTo(0.1);
    expect(summary.selectedFraction.max).toBeCloseTo(1.0);
    expect(summary.selectedFraction.median).toBeCloseTo(0.5);
  });
});

describe('summarizeReplay: not-proven failures stay out of recall', () => {
  const outcome = (id: string, o: Partial<ReplayOutcome> = {}): ReplayOutcome => (
    { id, mode: 'selected', selected: [], missed: [], notProven: [], failingTestFiles: [], liveCount: 10, inheritedSuspect: false, ...o }
  );
  it('a case whose only failure is unmapped is not scored; a mixed case is scored on its proven failures only', () => {
    const summary = summarizeReplay([
      outcome('unmapped-only', { failingTestFiles: ['x'], notProven: ['x'] }),
      outcome('mixed', { failingTestFiles: ['a', 'y'], notProven: ['y'], missed: ['a'] }),
      outcome('clean', { failingTestFiles: ['b'] }),
    ]);
    expect(summary.recallMicro).toBeCloseTo(1 / 2); // a missed, b caught; x and y not proven
    expect(summary.casesConsidered).toBe(2);
    expect(summary.recallByCase).toBeCloseTo(1 / 2);
    expect(summary.notProven).toEqual([{ id: 'unmapped-only', files: ['x'] }, { id: 'mixed', files: ['y'] }]);
  });
});

describe('runtimeShare: the selected share of server RUNTIME (spec §11.3), not of file count', () => {
  const map: TestMap = {
    format: 1, sha: SHA_A, baseline: emptyDep(),
    tests: {
      'server/test/a.test.ts': rec({ read: ['server/src/a.ts'] }),
      'server/test/b.test.ts': rec({ read: ['server/src/b.ts'] }),
      'server/test/c.test.ts': rec({ read: ['ccd/ccd'] }),
    },
  };
  const durations = { 'server/test/a.test.ts': 100, 'server/test/b.test.ts': 300, 'server/test/c.test.ts': 600 };

  it('weights the selected files by their durations', () => {
    expect(runtimeShare({ map, changedFiles: ['ccd/ccd'], existsAt: () => true, durations })).toBeCloseTo(0.6);
    expect(runtimeShare({ map, changedFiles: ['server/src/a.ts'], existsAt: () => true, durations })).toBeCloseTo(0.1);
    expect(runtimeShare({ map, changedFiles: ['README.md'], existsAt: () => true, durations })).toBe(0);
  });

  it('a full trigger is the whole runtime; a file with no duration gets the median of the known ones', () => {
    expect(runtimeShare({ map, changedFiles: ['server/package.json'], existsAt: () => true, durations })).toBe(1);
    // c unknown: median(100, 300) = 200 → c's share is 200 / 600.
    const partial = { 'server/test/a.test.ts': 100, 'server/test/b.test.ts': 300 };
    expect(runtimeShare({ map, changedFiles: ['ccd/ccd'], existsAt: () => true, durations: partial })).toBeCloseTo(200 / 600);
  });

  it('summarizeShares: min, median, max and mean', () => {
    const s = summarizeShares([0.1, 0.6, 1, 0.3]);
    expect(s).toMatchObject({ count: 4, min: 0.1, max: 1 });
    expect(s.median).toBeCloseTo(0.45);
    expect(s.mean).toBeCloseTo(0.5);
  });
});

describe('the selected fraction never exceeds 100%', () => {
  // A selected test can be absent from the map (a failing test the map never
  // traced is live by replayCase's union, and rule 1 selects it). Dividing by
  // the map's test count alone put such a case above 100%. The dataset carries
  // no tree to list, so the live count is the union of the map's tests and the
  // selected ones — every selected test is live by definition.
  const map: TestMap = {
    format: 1, sha: SHA_A, baseline: emptyDep(),
    tests: { 'server/test/dep.test.ts': rec({ read: ['server/src/dep.ts'] }) },
  };

  it('liveCountFor: the map\'s tests plus any selected test the map lacks', () => {
    expect(liveCountFor(map, ['server/test/dep.test.ts', 'server/test/new.test.ts'])).toBe(2);
    expect(liveCountFor(map, [])).toBe(1);
  });

  it('refuses a --repo that does not carry the map\'s commit (F10-1): exits 1, prints no report', () => {
    // A clone that hasn't fetched the map's commit, a shallow clone, or the wrong --repo all make gitExistsAt
    // answer false for everything, which used to read every changed path as added and over-select silently
    // (exit 0). The CLI now measures the sha is actually present before doing any replay/share work at all.
    const dir = mkTmp('ccrc-ci-replay-cli-');
    gitInit(dir);
    writeIn(dir, 'server/src/dep.ts', 'export const d = 1;\n');
    gitCommitAll(dir, 'seed'); // a real repo, real HEAD — but the map below names a sha this history never had
    const absentSha = 'f'.repeat(40);
    const missingMap: TestMap = { ...map, sha: absentSha };
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify(missingMap));
    writeFileSync(path.join(dir, 'dataset.json'), JSON.stringify([
      { id: 'c1', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/new.test.ts'] },
    ]));
    const cli = replayCli();
    let error: (Error & { status?: number | null; stdout?: string; stderr?: string }) | undefined;
    try {
      execFileSync(process.execPath, [cli, '--repo', dir, '--map', path.join(dir, 'map.json'),
        '--dataset', path.join(dir, 'dataset.json')], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      error = e as typeof error;
    }
    expect(error).toBeDefined();
    expect(error?.status).toBe(1);
    expect(error?.stdout).toBe('');
    expect(error?.stderr).toContain(`replay.mjs: map commit ${absentSha} is not in ${dir}`);
  });

  it('the CLI reports at most 100% for a case whose selection includes a test absent from the map', () => {
    // The scenario itself (a live, selected-but-unmapped test) is the coverage the 224-line case used to carry
    // end to end, kept here — now against a --repo whose HEAD really is the map's sha, so it clears F10-1's
    // preflight and reaches the report this asserts on.
    const dir = mkTmp('ccrc-ci-replay-cli-cap-');
    gitInit(dir);
    writeIn(dir, 'server/src/dep.ts', 'export const d = 1;\n');
    const sha = gitCommitAll(dir, 'seed');
    const gitMap: TestMap = { ...map, sha };
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify(gitMap));
    writeFileSync(path.join(dir, 'dataset.json'), JSON.stringify([
      { id: 'c1', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/new.test.ts'] },
    ]));
    const cli = replayCli();
    const out = execFileSync(process.execPath, [cli, '--repo', dir, '--map', path.join(dir, 'map.json'),
      '--dataset', path.join(dir, 'dataset.json')], { encoding: 'utf8', stdio: 'pipe' });
    expect(out).toContain('selected fraction of live server tests — min 100.0%, median 100.0%, max 100.0%');
    // new.test.ts is not in the map: selected, but not proven — so there is nothing to score, and recall says so
    // rather than a vacuous 100%.
    expect(out).toContain('not proven (failing tests absent from the map, kept out of recall): 1 in 1 case(s)');
    expect(out).toContain('recall (micro, pooled over failing-test instances): n/a (no proven failure — nothing to score)');
    expect(out).toContain('recall (by case, zero-miss cases / scored cases):   n/a (no proven failure — nothing to score)');
  });

  it('the CLI reports the runtime share over --prs weighed by --times', () => {
    const dir = mkTmp('ccrc-ci-replay-share-');
    gitInit(dir);
    writeIn(dir, 'server/src/dep.ts', 'export const d = 1;\n');
    const sha = gitCommitAll(dir, 'seed');
    const gitMap: TestMap = { ...map, sha };
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify(gitMap));
    writeFileSync(path.join(dir, 'prs.json'), JSON.stringify([
      { number: 1, files: [{ path: 'server/src/dep.ts', additions: 1, deletions: 0 }] },
      { number: 2, files: [{ path: 'README.md', additions: 1, deletions: 0 }] },
    ]));
    writeFileSync(path.join(dir, 'times.json'), JSON.stringify({ 'server/test/dep.test.ts': 1000 }));
    const cli = replayCli();
    const out = execFileSync(process.execPath, [cli, '--repo', dir, '--map', path.join(dir, 'map.json'),
      '--prs', path.join(dir, 'prs.json'), '--times', path.join(dir, 'times.json')], { encoding: 'utf8', stdio: 'pipe' });
    expect(out).toContain('selected share of server runtime over 2 PRs — min 0.0%, median 50.0%, max 100.0%, mean 50.0%');
  });

  it('prints "map: <sha>" as the report\'s second line, immediately after "dataset: …"', () => {
    const dir = mkTmp('ccrc-ci-replay-mapline-');
    gitInit(dir);
    writeIn(dir, 'server/src/dep.ts', 'export const d = 1;\n');
    const sha = gitCommitAll(dir, 'seed');
    const gitMap: TestMap = { ...map, sha };
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify(gitMap));
    writeFileSync(path.join(dir, 'dataset.json'), JSON.stringify([
      { id: 'c1', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'] },
    ]));
    const cli = replayCli();
    const out = execFileSync(process.execPath, [cli, '--repo', dir, '--map', path.join(dir, 'map.json'),
      '--dataset', path.join(dir, 'dataset.json')], { encoding: 'utf8', stdio: 'pipe' });
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^dataset: /);
    expect(lines[1]).toBe(`map: ${sha}`);
  });
});

describe('the acceptance datasets: the frozen study set and a fresh collection (spec §11.3)', () => {
  // The study's set is frozen beside the spec (job logs expire, so it cannot be rebuilt); a fresh builder run adds
  // newer failures. The report names each set's size, so a thin set is never mistaken for the study's window. A
  // case is REAL when its id starts with a run id (`<run>` from the builder, `<run>:<job>` in the frozen set);
  // anything else is synthetic.
  const FROZEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..',
    'docs', 'superpowers', 'specs', '2026-09-23-ci-test-selection-replay-dataset.json');

  it('the frozen set is the study\'s window: 114 real cases from 64 runs, 6 synthetic, 59 inheritedSuspect', () => {
    const frozen = JSON.parse(readFileSync(FROZEN, 'utf8'));
    expect(describeDataset(frozen)).toEqual({ real: 114, runs: 64, synthetic: 6, inheritedSuspect: 59 });
    expect(datasetLine(describeDataset(frozen))).toBe('dataset: 114 real cases from 64 runs, 6 synthetic, 59 inheritedSuspect');
  });

  it('the builder\'s shape counts the same way: a bare run id is real, a slug is synthetic', () => {
    expect(describeDataset([
      { id: '555', changedFiles: [], failingTestFiles: [], inheritedSuspect: true },
      { id: '556', changedFiles: [], failingTestFiles: [], inheritedSuspect: false },
      { id: 'nul-byte-source-bytes', changedFiles: [], failingTestFiles: [], inheritedSuspect: false },
    ])).toEqual({ real: 2, runs: 2, synthetic: 1, inheritedSuspect: 1 });
  });

  it('the CLI replays the frozen shape as-is — event and job ignored — and prints the dataset line first', () => {
    const dir = mkTmp('ccrc-ci-replay-frozen-');
    gitInit(dir);
    writeIn(dir, 'server/src/dep.ts', 'export const d = 1;\n');
    const sha = gitCommitAll(dir, 'seed');
    const map: TestMap = {
      format: 1, sha, baseline: emptyDep(),
      tests: { 'server/test/dep.test.ts': rec({ read: ['server/src/dep.ts'] }) },
    };
    writeFileSync(path.join(dir, 'map.json'), JSON.stringify(map));
    writeFileSync(path.join(dir, 'dataset.json'), JSON.stringify([
      { id: '101:test (server)', event: 'pull_request', job: 'test (server)', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'], inheritedSuspect: false },
      { id: '101:test-macos', event: 'pull_request', job: 'test-macos', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'], inheritedSuspect: true },
      { id: 'synthetic:dep', event: 'synthetic', job: 'test (server)', changedFiles: ['server/src/dep.ts'], failingTestFiles: ['server/test/dep.test.ts'], inheritedSuspect: false },
    ]));
    const cli = replayCli();
    const out = execFileSync(process.execPath, [cli, '--repo', dir, '--map', path.join(dir, 'map.json'),
      '--dataset', path.join(dir, 'dataset.json')], { encoding: 'utf8', stdio: 'pipe' });
    expect(out.split('\n')[0]).toBe('dataset: 2 real cases from 1 runs, 1 synthetic, 1 inheritedSuspect');
    expect(out).toContain('cases: 3 (2 scored, 1 excluded as inheritedSuspect)');
    expect(out).toContain('recall (micro, pooled over failing-test instances): 100.0%');
    expect(out).toContain('misses: none');
  });
});

/*
 * Mutation table (measured — see PLAN.md Task 10 Step 5 for the transcript):
 *
 * mutation                                                            -> test that goes red
 * -----------------------------------------------------------------------------------------
 * replayCase: flip the A/M inference (`existsAt(...) ? 'A' : 'M'`)      -> 'infers status A (absent at map.sha) vs M (present)...'
 * replayCase: drop `failingTestFiles` from the liveTests union          -> 'a failing test absent from the map is still live...'
 * replayCase: drop the changed-test-file liveTests union clause         -> 'a brand-new test file among changedFiles...'
 * replayCase: drop the `mode === 'full'` short-circuit (falls through   -> 'a full-trigger change selects everything live...'
 *   to treating it as a `selected` result with real misses)
 * summarizeReplay: drop the inheritedSuspect filter on `headline`       -> 'excludes inheritedSuspect cases from the headline recall...'
 * summarizeReplay: break `recallMicro`/`casesClean` accumulation        -> 'recall (micro) pools failing-test instances...'
 * liveCountFor: the map's tests only (no union with selected)          -> 'liveCountFor: the map's tests plus any selected test the map lacks'
 * CLI main: divide by the map's test count again                       -> 'the CLI reports at most 100% for a case whose selection includes...'
 * CLI main: drop the cat-file preflight (F10-1, round 1 fix)           -> 'refuses a --repo that does not carry the map's commit...'
 */
