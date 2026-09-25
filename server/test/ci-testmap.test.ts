// Task 4 (spec §5, CONTRACT.md `.github/ci/testmap.mjs`): the test map's
// shape, its build/refresh transitions and its on-disk read/write. Mutation
// table at the bottom of this file records, for every guard here, which case
// goes red when the guard is deleted.
//
// Records arrive SPLIT BY PROCESS (format 2, `trace-run.mjs`): `root` is the
// vitest root process, `rest` the worker and everything it spawns. The
// baseline is subtracted per side, then the two sides are joined — which is
// what removes the include glob's walk of `server/test/` (the root's) without
// erasing a test's own walk of the same directory (the rest's).
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  MAP_FORMAT, RECORDS_FORMAT, TRACE_MISSING, GIT_FLOOR, WALK_FLOOR, FLOOR_GIT, FLOOR_WALK, subtractBaseline, buildMap, refreshMap, readMap, writeMap, readRecordsDir,
} from '../../.github/ci/testmap.mjs';
import type { DepRecord, Records, SplitTestRecord, TestMap } from '../../.github/ci/testmap.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const emptyDep = (): DepRecord => ({ read: [], probed: [], listed: [], subtree: [], git: false });
const dep = (d: Partial<DepRecord> = {}): DepRecord => ({ ...emptyDep(), ...d });
/** A raw (format 2) test record: `root`/`rest` sides, plus unknown/why. */
const split = (root: Partial<DepRecord> = {}, rest: Partial<DepRecord> = {}, extra: { unknown?: boolean, why?: string } = {}): SplitTestRecord =>
  ({ root: dep(root), rest: dep(rest), unknown: !!extra.unknown, ...(extra.why !== undefined ? { why: extra.why } : {}) });
const records = (baseline: { root?: Partial<DepRecord>, rest?: Partial<DepRecord> }, tests: Record<string, SplitTestRecord>): Records =>
  ({ format: RECORDS_FORMAT, baseline: { root: dep(baseline.root), rest: dep(baseline.rest) }, tests });

describe('subtractBaseline', () => {
  it('removes baseline members from read/probed/listed/subtree, keeps sorted+unique', () => {
    const rec = {
      read: ['server/vitest.config.ts', 'server/src/a.ts', 'server/src/a.ts'],
      probed: ['server/test/x.ts'],
      listed: ['server/test'],
      subtree: ['deploy', 'shared'],
      git: false,
    };
    const baseline = {
      read: ['server/vitest.config.ts'], probed: [], listed: ['server/test'], subtree: ['shared'], git: false,
    };
    expect(subtractBaseline(rec, baseline)).toEqual({
      read: ['server/src/a.ts'], probed: ['server/test/x.ts'], listed: [], subtree: ['deploy'], git: false,
    });
  });

  it('keeps the git flag as-is regardless of the baseline (mutation: dropping this line collapses git to the baseline\'s own flag)', () => {
    const rec = { ...emptyDep(), git: true };
    const baseline = { ...emptyDep(), git: false };
    expect(subtractBaseline(rec, baseline).git).toBe(true);
  });
});

describe('buildMap', () => {
  it('subtracts each side\'s baseline from the same side, joins the sides, and carries unknown/why', () => {
    const r = records({ root: { read: ['server/vitest.config.ts'] } }, {
      'server/test/a.test.ts': split({ read: ['server/vitest.config.ts', 'server/src/a.ts'], subtree: ['shared'] }, { read: ['ccd/ccd'], subtree: ['deploy'] }),
      'server/test/b.test.ts': split({}, {}, { unknown: true, why: 'timeout' }),
    });
    const map = buildMap(SHA_A, r);
    expect(map).toEqual({
      format: MAP_FORMAT,
      sha: SHA_A,
      baseline: { read: ['server/vitest.config.ts'], probed: [], listed: [], subtree: [], git: false },
      tests: {
        'server/test/a.test.ts': { read: ['ccd/ccd', 'server/src/a.ts'], probed: [], listed: [], subtree: ['deploy', 'shared'], git: false, unknown: false },
        'server/test/b.test.ts': { ...emptyDep(), unknown: true, why: 'timeout' },
      },
    });
  });

  it('a test\'s OWN listing of server/test survives, the include glob\'s is subtracted (the reason records are split)', () => {
    // Measured: the glob's walk of server/test is in the baseline's ROOT side;
    // single-definition's census walks it again in its worker (REST).
    const r = records({ root: { listed: ['server/test'] } }, {
      'server/test/single-definition.test.ts': split({ listed: ['server/test'] }, { listed: ['server/test', 'ccd'] }),
      'server/test/plain.test.ts': split({ listed: ['server/test'] }, {}),
    });
    const map = buildMap(SHA_A, r);
    expect(map.tests['server/test/single-definition.test.ts'].listed).toEqual(['ccd', 'server/test']);
    expect(map.tests['server/test/plain.test.ts'].listed).toEqual([]);
  });

  it('the map\'s baseline is the union of both sides (what fullTrigger reads), git ORed', () => {
    const r = records({ root: { read: ['server/vitest.config.ts'], listed: ['server/test'] }, rest: { probed: ['server/test/__snapshots__/ci-baseline.test.ts.snap'], subtree: ['shared'], git: true } }, {});
    expect(buildMap(SHA_A, r).baseline).toEqual({
      read: ['server/vitest.config.ts'],
      probed: ['server/test/__snapshots__/ci-baseline.test.ts.snap'],
      listed: ['server/test'],
      subtree: ['shared'],
      git: true,
    });
  });

  it('omits `why` when the raw record carries none', () => {
    const r = records({}, { 't.test.ts': split() });
    expect(buildMap(SHA_A, r).tests['t.test.ts']).not.toHaveProperty('why');
  });

  it('a live test with no record at all is simply absent from a built map (the selector\'s rule 1 then selects it)', () => {
    const r = records({}, { 'server/test/traced.test.ts': split() });
    expect(Object.keys(buildMap(SHA_A, r).tests)).toEqual(['server/test/traced.test.ts']);
  });
});

describe('refreshMap', () => {
  const old: TestMap = {
    format: MAP_FORMAT,
    sha: SHA_A,
    baseline: emptyDep(),
    tests: {
      'server/test/kept.test.ts': { read: ['server/src/kept.ts'], probed: [], listed: [], subtree: [], git: false, unknown: false },
      'server/test/gone.test.ts': { ...emptyDep(), unknown: false },
      'server/test/retraced.test.ts': { read: ['server/src/old.ts'], probed: [], listed: [], subtree: [], git: false, unknown: false },
    },
  };

  it('fresh entries replace old ones; old entries for live-but-not-retraced tests are carried; dead tests dropped', () => {
    const r = records({}, { 'server/test/retraced.test.ts': split({ read: ['server/src/new.ts'] }) });
    const liveTests = ['server/test/kept.test.ts', 'server/test/retraced.test.ts'];
    const map = refreshMap(old, SHA_B, r, liveTests, ['server/test/retraced.test.ts']);
    expect(map.sha).toBe(SHA_B);
    expect(map.tests).toEqual({
      'server/test/kept.test.ts': old.tests['server/test/kept.test.ts'],
      'server/test/retraced.test.ts': { read: ['server/src/new.ts'], probed: [], listed: [], subtree: [], git: false, unknown: false },
    });
    // gone.test.ts dropped — not in liveTests
    expect(map.tests).not.toHaveProperty('server/test/gone.test.ts');
  });

  it('a test MEANT to be traced whose record never arrived is unknown — never its stale old entry', () => {
    // The tests a refresh re-traces are exactly the ones whose dependencies
    // changed; a shard that crashed or was cancelled leaves them with no
    // record, and carrying the old entry forward would stop selecting them.
    const r = records({}, { 'server/test/retraced.test.ts': split({ read: ['server/src/new.ts'] }) });
    const liveTests = ['server/test/kept.test.ts', 'server/test/retraced.test.ts'];
    const map = refreshMap(old, SHA_B, r, liveTests, ['server/test/kept.test.ts', 'server/test/retraced.test.ts']);
    expect(map.tests['server/test/kept.test.ts']).toEqual({ ...emptyDep(), unknown: true, why: TRACE_MISSING });
    expect(map.tests['server/test/retraced.test.ts'].unknown).toBe(false);
  });

  it('a traced-list test that is no longer live is dropped, not written unknown', () => {
    const map = refreshMap(old, SHA_B, records({}, {}), ['server/test/kept.test.ts'], ['server/test/gone.test.ts']);
    expect(Object.keys(map.tests)).toEqual(['server/test/kept.test.ts']);
  });

  it('a fresh record for a test NOT in liveTests is dropped (deleted mid-refresh)', () => {
    const r = records({}, {
      'server/test/kept.test.ts': split({ read: ['server/src/kept.ts'] }),
      'server/test/deleted-but-traced.test.ts': split(),
    });
    const map = refreshMap(old, SHA_B, r, ['server/test/kept.test.ts'], ['server/test/kept.test.ts', 'server/test/deleted-but-traced.test.ts']);
    expect(Object.keys(map.tests)).toEqual(['server/test/kept.test.ts']);
  });

  it('a fresh record for a test with no old entry (new test) is still included', () => {
    const r = records({}, { 'server/test/new.test.ts': split() });
    const map = refreshMap(old, SHA_B, r, ['server/test/new.test.ts'], ['server/test/new.test.ts']);
    expect(Object.keys(map.tests)).toEqual(['server/test/new.test.ts']);
  });

  it('baseline is the fresh records\' baseline (both sides joined), not the old map\'s', () => {
    const r = records({ root: { read: ['server/vitest.config.ts'] }, rest: { read: ['server/package.json'] } }, {});
    const map = refreshMap(old, SHA_B, r, [], []);
    expect(map.baseline).toEqual({ read: ['server/package.json', 'server/vitest.config.ts'], probed: [], listed: [], subtree: [], git: false });
  });
});

describe('readMap / writeMap round-trip', () => {
  it('round-trips a map through disk', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    const map: TestMap = {
      format: MAP_FORMAT, sha: SHA_A,
      baseline: { read: ['server/vitest.config.ts'], probed: [], listed: [], subtree: [], git: false },
      tests: {
        'server/test/b.test.ts': { read: [], probed: [], listed: [], subtree: ['deploy'], git: true, unknown: false },
        'server/test/a.test.ts': { read: ['x'], probed: [], listed: [], subtree: [], git: false, unknown: true, why: 'timeout' },
      },
    };
    writeMap(file, map);
    const result = readMap(file);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.map).toEqual(map);
  });

  it('writeMap sorts test keys and record fields (stable key order)', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeMap(file, {
      format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
      tests: {
        'z.test.ts': { ...emptyDep(), unknown: false },
        'a.test.ts': { ...emptyDep(), unknown: false },
      },
    });
    const raw = readFileSync(file, 'utf8');
    expect(raw.indexOf('"a.test.ts"')).toBeLessThan(raw.indexOf('"z.test.ts"'));
    // compact: no pretty-printed newlines
    expect(raw).not.toContain('\n');
    const keys = Object.keys(JSON.parse(raw));
    expect(keys).toEqual(['format', 'sha', 'baseline', 'tests']);
  });
});

describe('readMap validation (never throws; the selector\'s full-suite fallback depends on this)', () => {
  it('unreadable file -> ok:false', () => {
    const result = readMap(path.join(mkTmp('ccrc-ci-testmap-'), 'nope.json'));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('unreadable') });
  });

  it('invalid JSON -> ok:false, does not throw', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'bad.json');
    writeFileSync(file, '{not json');
    expect(() => readMap(file)).not.toThrow();
    expect(readMap(file).ok).toBe(false);
  });

  it('wrong format -> ok:false', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({ format: 2, sha: SHA_A, baseline: emptyDep(), tests: {} }));
    const result = readMap(file);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('format') });
  });

  it('malformed sha (not 40-hex) -> ok:false', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({ format: MAP_FORMAT, sha: 'not-a-sha', baseline: emptyDep(), tests: {} }));
    expect(readMap(file).ok).toBe(false);
  });

  it('malformed baseline record -> ok:false', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({ format: MAP_FORMAT, sha: SHA_A, baseline: { read: 'not-an-array' }, tests: {} }));
    expect(readMap(file).ok).toBe(false);
  });

  it('a record without subtree -> ok:false (a map from before directory links were recorded is not trusted)', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({
      format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
      tests: { 't.test.ts': { read: [], probed: [], listed: [], git: false, unknown: false } },
    }));
    expect(readMap(file)).toEqual({ ok: false, reason: 'malformed record for t.test.ts' });
    writeFileSync(file, JSON.stringify({
      format: MAP_FORMAT, sha: SHA_A, baseline: { read: [], probed: [], listed: [], git: false }, tests: {},
    }));
    expect(readMap(file)).toEqual({ ok: false, reason: 'malformed baseline record' });
  });

  it('malformed test record (missing unknown) -> ok:false', () => {
    const dir = mkTmp('ccrc-ci-testmap-');
    const file = path.join(dir, 'map.json');
    writeFileSync(file, JSON.stringify({
      format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
      tests: { 't.test.ts': { read: [], probed: [], listed: [], subtree: [], git: false } },
    }));
    expect(readMap(file).ok).toBe(false);
  });
});

describe('readRecordsDir', () => {
  it('merges records*.json shards under a dir', () => {
    const dir = mkTmp('ccrc-ci-records-');
    const baseline = { root: { read: ['server/vitest.config.ts'] }, rest: { read: ['server/package.json'] } };
    writeFileSync(path.join(dir, 'records-1.json'), JSON.stringify(records(baseline, { 'server/test/a.test.ts': split() })));
    writeFileSync(path.join(dir, 'records-2.json'), JSON.stringify(records(baseline, { 'server/test/b.test.ts': split() })));
    const merged = readRecordsDir(dir);
    expect(Object.keys(merged.tests).sort()).toEqual(['server/test/a.test.ts', 'server/test/b.test.ts']);
    expect(merged.baseline).toEqual({ root: dep(baseline.root), rest: dep(baseline.rest) });
  });

  it('throws when no records*.json files exist under the dir', () => {
    const dir = mkTmp('ccrc-ci-records-empty-');
    mkdirSync(dir, { recursive: true });
    expect(() => readRecordsDir(dir)).toThrow(/no records/);
  });

  it('refuses format-1 records (one merged record per test, from before the root/rest split)', () => {
    const dir = mkTmp('ccrc-ci-records-v1-');
    writeFileSync(path.join(dir, 'records-1.json'), JSON.stringify({
      format: 1, baseline: emptyDep(), tests: { 'server/test/a.test.ts': { ...emptyDep(), unknown: false } },
    }));
    expect(() => readRecordsDir(dir)).toThrow(/records format 1.*expected 2/);
  });

  it('throws when two shards disagree on baseline — either side (mutation: deleting this check silently merges divergent baselines)', () => {
    const dir = mkTmp('ccrc-ci-records-mismatch-');
    writeFileSync(path.join(dir, 'records-1.json'), JSON.stringify(records({ rest: { read: ['a'] } }, {})));
    writeFileSync(path.join(dir, 'records-2.json'), JSON.stringify(records({ rest: { read: ['b'] } }, {})));
    expect(() => readRecordsDir(dir)).toThrow(/baseline/);
  });
});

describe('the refresh CLI (what ci.yml\'s map-build runs)', () => {
  const TESTMAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'testmap.mjs');
  const oldMap: TestMap = {
    format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
    tests: { 'server/test/kept.test.ts': { ...emptyDep(), read: ['server/src/kept.ts'], unknown: false } },
  };
  function run(extra: string[]): { status: number, stderr: string, dir: string } {
    const dir = mkTmp('ccrc-ci-testmap-cli-');
    mkdirSync(path.join(dir, 'records'));
    writeFileSync(path.join(dir, 'records', 'records-1.json'), JSON.stringify(records({}, {})));
    writeFileSync(path.join(dir, 'old.json'), JSON.stringify(oldMap));
    writeFileSync(path.join(dir, 'live.txt'), 'server/test/kept.test.ts\n');
    writeFileSync(path.join(dir, 'traced.txt'), 'server/test/kept.test.ts\n');
    const args = [TESTMAP, 'refresh', '--sha', SHA_B, '--old', path.join(dir, 'old.json'), '--records', path.join(dir, 'records'),
      '--live', path.join(dir, 'live.txt'), '--out', path.join(dir, 'new.json'), ...extra.map((a) => a.replace('DIR', dir))];
    try {
      execFileSync(process.execPath, args, { stdio: 'pipe' });
      return { status: 0, stderr: '', dir };
    } catch (e) {
      return { status: (e as { status: number }).status, stderr: String((e as { stderr: Buffer }).stderr), dir };
    }
  }

  it('refuses to refresh without --traced', () => {
    const r = run([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('refresh needs --traced FILE');
  });

  it('with --traced, a traced test that left no record comes out unknown', () => {
    const r = run(['--traced', 'DIR/traced.txt']);
    expect(r.status).toBe(0);
    const out = readMap(path.join(r.dir, 'new.json'));
    if (!out.ok) throw new Error(out.reason);
    expect(out.map.tests['server/test/kept.test.ts']).toEqual({ ...emptyDep(), unknown: true, why: TRACE_MISSING });
  });
});

describe('the CLI: the map is always written; the exit code says what newly broke (spec §5.4)', () => {
  // A traced test that fails under strace is recorded unknown and the map is published regardless. What goes red
  // is map-build, and only for news: exit 3 names each traced test that newly failed or timed out — unknown now,
  // not unknown in the map this run started from — and a failure that was already unknown is a ::warning::, so a
  // test that always fails under tracing (session-hook's timing budgets) reds the first build that sees it, not
  // every refresh after. Exit 4 names a floor violator (marked unknown above), and outranks 3.
  const TESTMAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'testmap.mjs');
  const FAILS = 'server/test/fails.test.ts';
  const SLOW = 'server/test/slow.test.ts';
  const UNRESOLVED = 'server/test/unresolved.test.ts';
  const CLEAN = 'server/test/clean.test.ts';
  const traced = {
    [FAILS]: split({}, {}, { unknown: true, why: 'vitest exited 1' }),
    [SLOW]: split({}, {}, { unknown: true, why: 'timeout after 900s' }),
    [UNRESOLVED]: split({}, {}, { unknown: true, why: '2 unresolved relative path(s)' }),
    [CLEAN]: split({ read: ['server/src/clean.ts'] }),
  };
  function cli(cmd: 'build' | 'refresh', tests: Record<string, SplitTestRecord>, oldMap: TestMap | 'garbage' | null) {
    const dir = mkTmp('ccrc-ci-testmap-cli-');
    mkdirSync(path.join(dir, 'records'));
    writeFileSync(path.join(dir, 'records', 'records-1.json'), JSON.stringify(records({}, tests)));
    const names = Object.keys(tests);
    writeFileSync(path.join(dir, 'live.txt'), names.join('\n') + '\n');
    writeFileSync(path.join(dir, 'traced.txt'), names.join('\n') + '\n');
    const args = [TESTMAP, cmd, '--sha', SHA_B, '--records', path.join(dir, 'records'), '--out', path.join(dir, 'new.json')];
    if (oldMap !== null) {
      writeFileSync(path.join(dir, 'old.json'), oldMap === 'garbage' ? '{not json' : JSON.stringify(oldMap));
      args.push('--old', path.join(dir, 'old.json'));
    }
    if (cmd === 'refresh') args.push('--live', path.join(dir, 'live.txt'), '--traced', path.join(dir, 'traced.txt'));
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const written = readMap(path.join(dir, 'new.json'));
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, written };
  }
  const oldWith = (unknownTests: string[]): TestMap => ({
    format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
    tests: Object.fromEntries([FAILS, SLOW, UNRESOLVED, CLEAN].map((n) => [n,
      unknownTests.includes(n) ? { ...emptyDep(), unknown: true, why: 'vitest exited 1' } : { ...emptyDep(), unknown: false }])),
  });

  it('build with no --old (a first build): every failure and timeout counts once — the map is written, then exit 3', () => {
    const r = cli('build', traced, null);
    expect(r.written.ok).toBe(true);
    if (!r.written.ok) throw new Error(r.written.reason);
    expect(r.written.map.tests[FAILS]).toMatchObject({ unknown: true, why: 'vitest exited 1' });
    expect(r.status).toBe(3);
    expect(r.stdout).toContain(`::error::testmap: ${FAILS} newly fails under trace (vitest exited 1)`);
    expect(r.stdout).toContain(`::error::testmap: ${SLOW} newly fails under trace (timeout after 900s)`);
    // Unknown for another reason is not a failure.
    expect(r.stdout).not.toContain(UNRESOLVED);
  });

  it('build --old: a failure that was already unknown is a ::warning:: only; a new one is exit 3', () => {
    const r = cli('build', traced, oldWith([FAILS]));
    expect(r.status).toBe(3);
    expect(r.stdout).toContain(`::warning::testmap: ${FAILS} still fails under trace (vitest exited 1)`);
    expect(r.stdout).toContain(`::error::testmap: ${SLOW} newly fails under trace (timeout after 900s)`);
    expect(r.stdout).not.toContain(`::error::testmap: ${FAILS}`);
    const quiet = cli('build', traced, oldWith([FAILS, SLOW]));
    expect(quiet.status).toBe(0);
    expect(quiet.written.ok).toBe(true);
  });

  it('build --old that cannot be read: a ::warning::, and every failure counts (the loud direction)', () => {
    const r = cli('build', traced, 'garbage');
    expect(r.status).toBe(3);
    expect(r.stdout).toContain('::warning::testmap: cannot read --old');
    expect(r.stdout).toContain(`::error::testmap: ${FAILS} newly fails under trace`);
  });

  it('refresh --old: the same rule — an already-unknown failure is a warning, a new one exit 3', () => {
    expect(cli('refresh', traced, oldWith([FAILS, SLOW])).status).toBe(0);
    const r = cli('refresh', traced, oldWith([FAILS]));
    expect(r.status).toBe(3);
    expect(r.written.ok).toBe(true);
    expect(r.stdout).toContain(`::error::testmap: ${SLOW} newly fails under trace`);
  });

  it('a floor violator: the map is written with it unknown (always selected), then exit 4 naming it — over 3', () => {
    const r = cli('build', { 'server/test/dtbd.test.ts': split({ read: ['x'] }), [CLEAN]: traced[CLEAN] }, null);
    expect(r.written.ok).toBe(true);
    if (!r.written.ok) throw new Error(r.written.reason);
    expect(r.written.map.tests['server/test/dtbd.test.ts']).toMatchObject({ unknown: true, why: FLOOR_GIT });
    expect(r.status).toBe(4);
    expect(r.stdout).toContain(`::error::testmap: server/test/dtbd.test.ts ${FLOOR_GIT}`);
    const both = cli('build', { 'server/test/dtbd.test.ts': split({ read: ['x'] }), [FAILS]: traced[FAILS] }, null);
    expect(both.status).toBe(4);
    expect(both.stdout).toContain(`::error::testmap: ${FAILS} newly fails under trace`);
  });
});

describe('the floor: repo-wide guards must come out repo-wide (spec §5.2)', () => {
  // A tracer regression that stops seeing .git reads would silently narrow the repo-wide guards (rule 2 selects
  // a test only if it read .git); one that stops seeing directory walks would narrow single-definition and
  // typecheck-tests. So a freshly traced floor test that lacks its breadth is written UNKNOWN (rule 2 then always
  // selects it — the breadth the floor protects), the map is still written, and the CLI exits 4 naming it. The
  // map is never refused: one legitimate refactor of a floor test must not freeze the map until it expires.
  // `unknown` already passes: an unknown test is always selected.
  it('names the floor exactly as the spec does', () => {
    expect(GIT_FLOOR).toEqual(['source-bytes', 'topology-clean', 'deviation-refs', 'dtbd', 'providers',
      'modelenv-single-writer', 'install-census', 'gitignore-secrets'].map((n) => `server/test/${n}.test.ts`));
    expect(WALK_FLOOR).toEqual(['single-definition', 'typecheck-tests'].map((n) => `server/test/${n}.test.ts`));
  });

  it('a build writes a git-floor test with git false as unknown, why FLOOR_GIT, and keeps its record and every other entry', () => {
    const r = records({}, {
      'server/test/dtbd.test.ts': split({ read: ['x'] }),
      'server/test/plain.test.ts': split({ read: ['y'] }),
    });
    const map = buildMap(SHA_A, r);
    expect(FLOOR_GIT).toBe('floor: git is false');
    expect(map.tests['server/test/dtbd.test.ts']).toEqual({ ...emptyDep(), read: ['x'], unknown: true, why: FLOOR_GIT });
    expect(map.tests['server/test/plain.test.ts']).toEqual({ ...emptyDep(), read: ['y'], unknown: false });
  });

  it('a build accepts git true, or unknown', () => {
    const r = records({}, {
      'server/test/dtbd.test.ts': split({}, { git: true }),
      'server/test/providers.test.ts': split({}, {}, { unknown: true, why: 'vitest exited 1' }),
    });
    const map = buildMap(SHA_A, r);
    expect(map.tests['server/test/dtbd.test.ts']).toEqual({ ...emptyDep(), git: true, unknown: false });
    expect(map.tests['server/test/providers.test.ts'].why).toBe('vitest exited 1');
  });

  it('a build writes a walk-floor test that lists nothing (once the baseline is subtracted) as unknown, why FLOOR_WALK', () => {
    const r = records({ root: { listed: ['server/test'] } }, {
      'server/test/single-definition.test.ts': split({ listed: ['server/test'] }, {}),
    });
    expect(FLOOR_WALK).toBe('floor: lists nothing');
    expect(buildMap(SHA_A, r).tests['server/test/single-definition.test.ts']).toMatchObject({ unknown: true, why: FLOOR_WALK });
    const ok = records({ root: { listed: ['server/test'] } }, {
      'server/test/single-definition.test.ts': split({ listed: ['server/test'] }, { listed: ['server/test'] }),
    });
    expect(buildMap(SHA_A, ok).tests['server/test/single-definition.test.ts'].listed).toEqual(['server/test']);
  });

  it('a refresh marks a freshly traced floor violation unknown, and does not re-judge a carried entry', () => {
    const old: TestMap = {
      format: MAP_FORMAT, sha: SHA_A, baseline: emptyDep(),
      tests: { 'server/test/install-census.test.ts': { ...emptyDep(), unknown: false } },
    };
    const bad = records({}, { 'server/test/dtbd.test.ts': split() });
    const marked = refreshMap(old, SHA_B, bad, ['server/test/dtbd.test.ts', 'server/test/install-census.test.ts'], ['server/test/dtbd.test.ts']);
    expect(marked.tests['server/test/dtbd.test.ts']).toMatchObject({ unknown: true, why: FLOOR_GIT });
    expect(marked.tests['server/test/install-census.test.ts']).toEqual(old.tests['server/test/install-census.test.ts']);
    const good = records({}, { 'server/test/dtbd.test.ts': split({}, { git: true }) });
    const map = refreshMap(old, SHA_B, good, ['server/test/dtbd.test.ts', 'server/test/install-census.test.ts'], ['server/test/dtbd.test.ts']);
    expect(map.tests['server/test/install-census.test.ts']).toEqual(old.tests['server/test/install-census.test.ts']);
  });
});

/*
 * Mutation table (measured — see the plan's Task 4 for the transcript):
 *
 * mutation                                                    -> test that goes red
 * ---------------------------------------------------------------------------------
 * subtractBaseline: drop `git: rec.git` (fold to baseline's)   -> 'keeps the git flag as-is...'
 * buildMap: subtract the JOINED baseline from each side         -> 'a test's OWN listing of server/test survives...'
 * buildMap: map.baseline = the root side only                   -> 'the map's baseline is the union of both sides...'
 * readMap: drop the `format !== MAP_FORMAT` check               -> 'wrong format -> ok:false'
 * readMap: drop the sha-shape check                             -> 'malformed sha (not 40-hex) -> ok:false'
 * readMap: drop the baseline-shape check                        -> 'malformed baseline record -> ok:false'
 * readMap: drop the per-test shape check                        -> 'malformed test record (missing unknown) -> ok:false'
 * readRecordsDir: drop the RECORDS_FORMAT check                  -> 'refuses format-1 records...'
 * readRecordsDir: drop the baseline-agreement check              -> 'throws when two shards disagree on baseline'
 * refreshMap: drop the `!live.has(name) continue` filter on fresh -> 'a fresh record for a test NOT in liveTests is dropped (deleted mid-refresh)'
 * refreshMap: drop the traced-but-missing -> unknown loop        -> 'a test MEANT to be traced whose record never arrived is unknown...'
 * testmap CLI: drop the `--traced` requirement                  -> 'refuses to refresh without --traced'
 * refreshMap: drop the old-entry carry-forward loop               -> 'fresh entries replace old ones; old entries for live-but-not-retraced...' (kept.test.ts would vanish)
 */
