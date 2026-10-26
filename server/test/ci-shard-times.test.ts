// Shard planner true durations (rank 2 of the 2026-10-25 landing root-cause measurement). The planner was fed
// `endTime - startTime` of vitest's JSON report, which drops `beforeAll` and collection time, so a file that
// spends 400 s in its hooks was planned at 0.5 s. This file pins (1) what the planner did before, as a
// characterization, then (2) the whole-file wall time a reporter now records, and (3) the longest-first order
// inside a shard.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { durationsFromVitestJson, orderLongestFirst, planShards, PROFILES } from '../../.github/ci/shards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const serverRoot = path.join(repoRoot, 'server');
const abs = (rel: string) => path.join(repoRoot, rel);

describe('characterization: planner on a fixed fixture', () => {
  // Hooks-heavy file: the JSON report's tests span only 0..1 ms, its beforeAll took 400 s.
  const report = {
    testResults: [
      { name: abs('server/test/heavy.test.ts'), startTime: 0, endTime: 1 },
      { name: abs('server/test/mid.test.ts'), startTime: 0, endTime: 200_000 },
      { name: abs('server/test/small1.test.ts'), startTime: 0, endTime: 10_000 },
      { name: abs('server/test/small2.test.ts'), startTime: 0, endTime: 10_000 },
    ],
  };
  const files = report.testResults.map((r) => path.relative(repoRoot, r.name));

  it('records endTime - startTime + 500 per file (the hooks-heavy file is planned at 501 ms)', () => {
    expect(durationsFromVitestJson(report, repoRoot)).toEqual({
      'server/test/heavy.test.ts': 501,
      'server/test/mid.test.ts': 200_500,
      'server/test/small1.test.ts': 10_500,
      'server/test/small2.test.ts': 10_500,
    });
  });

  it('plans shard assignment LPT from those durations', () => {
    const plan = planShards(files, durationsFromVitestJson(report, repoRoot), PROFILES.linux);
    expect(plan.map((s) => s.files)).toEqual([
      ['server/test/mid.test.ts', 'server/test/small1.test.ts', 'server/test/small2.test.ts', 'server/test/heavy.test.ts'],
    ]);
  });
});

describe('durationsFromVitestJson: whole-file wall time', () => {
  it('a file whose time is all in beforeAll is recorded at its full time, not ~0', () => {
    // The reporter's `wallMs` covers environment setup, collection, hooks and tests; the JSON report's
    // start/end span only the tests (1 ms here).
    const report = {
      testResults: [{ name: abs('server/test/heavy.test.ts'), startTime: 0, endTime: 1, wallMs: 400_000 }],
    };
    expect(durationsFromVitestJson(report, repoRoot)).toEqual({ 'server/test/heavy.test.ts': 400_000 });
  });

  it('an older artifact without wallMs still reads as endTime - startTime + 500', () => {
    const report = { testResults: [{ name: abs('server/test/old.test.ts'), startTime: 5, endTime: 105 }] };
    expect(durationsFromVitestJson(report, repoRoot)).toEqual({ 'server/test/old.test.ts': 600 });
  });
});

describe('orderLongestFirst', () => {
  it('orders by recorded time, longest first', () => {
    expect(orderLongestFirst(['b', 'c', 'a'], { a: 400, b: 10, c: 200 })).toEqual(['a', 'c', 'b']);
  });

  it('a file missing from the times sorts at the median position', () => {
    // known {a:400,b:10,c:200} -> median 200; "m" ties with c (200) and, ties going by path, follows it.
    expect(orderLongestFirst(['m', 'a', 'b', 'c'], { a: 400, b: 10, c: 200 })).toEqual(['a', 'c', 'm', 'b']);
  });

  it('keeps every file exactly once and does not mutate its input', () => {
    const input = ['x', 'y'];
    expect(orderLongestFirst(input, {})).toEqual(['x', 'y']);
    expect(input).toEqual(['x', 'y']);
  });
});

describe('file-times reporter (real vitest run)', () => {
  it('records the time spent in beforeAll that the JSON report drops', () => {
    const dir = mkTmp('ci-shard-times-reporter-');
    mkdirSync(path.join(dir, 'test'));
    writeFileSync(path.join(dir, 'test', 'slow-hook.test.ts'),
      "import { beforeAll, it, expect } from 'vitest';\n"
      + 'beforeAll(async () => { await new Promise((r) => setTimeout(r, 600)); });\n'
      + "it('is instant', () => { expect(1).toBe(1); });\n");
    const out = path.join(dir, 'times.json');
    const json = path.join(dir, 'report.json');
    const reporter = path.join(repoRoot, '.github', 'ci', 'file-times-reporter.mjs');
    const r = spawnSyncGroup(process.execPath, [
      path.join(serverRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', dir,
      `--reporter=${reporter}`, '--reporter=json', `--outputFile.json=${json}`,
    ], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...process.env, CCRC_FILE_TIMES_OUT: out } });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(report.testResults).toHaveLength(1);
    const [entry] = report.testResults;
    expect(entry.name).toBe(path.join(dir, 'test', 'slow-hook.test.ts'));
    expect(entry.wallMs).toBeGreaterThanOrEqual(600);
    // the stock JSON report is what the old calculation read: the 600 ms hook is not in its span
    const stock = JSON.parse(readFileSync(json, 'utf8')).testResults[0];
    expect(stock.endTime - stock.startTime).toBeLessThan(300);
    expect(durationsFromVitestJson(report, dir)[path.relative(dir, entry.name)]).toBeGreaterThanOrEqual(600);
  });
});

describe('vitest.select.config.ts sequencer', () => {
  const serverRootTsx = path.join(serverRoot, 'node_modules', '.bin', 'tsx');
  // `sharded` stands in for a `--shard=i/n` run; `sizes` (keyed `:<server-relative path>`, as BaseSequencer
  // keys its cache) are the file sizes BaseSequencer's default order falls back to with no past results.
  function sortedBy(env: Record<string, string>, moduleIds: string[],
    { sharded = false, sizes = {} }: { sharded?: boolean, sizes?: Record<string, number> } = {}): string[] {
    const dir = mkTmp('ci-shard-times-seq-');
    const target = path.join(serverRoot, 'vitest.select.config.ts').replace(/\\/g, '/');
    const script = path.join(dir, 'run.mts');
    writeFileSync(script, [
      `import cfg from '${target}';`,
      'const Seq = (cfg as any).test.sequence.sequencer;',
      "const project = { name: '', config: { sequence: { groupOrder: 0 }, isolate: true } };",
      `const files = ${JSON.stringify(moduleIds)}.map((moduleId) => ({ moduleId, project }));`,
      `const sizes: Record<string, number> = ${JSON.stringify(sizes)};`,
      `const ctx = { config: { root: ${JSON.stringify(serverRoot)}, ${sharded ? 'shard: { index: 1, count: 2 }' : ''} },`,
      '  cache: { getFileTestResults: () => undefined, getFileStats: (k: string) => (k in sizes ? { size: sizes[k] } : undefined) } };',
      'const out = await new Seq(ctx).sort(files);',
      'process.stdout.write(JSON.stringify(out.map((f: any) => f.moduleId)));',
    ].join('\n'), 'utf8');
    const e: NodeJS.ProcessEnv = { ...process.env };
    delete e.CCRC_TEST_TIMES;
    delete e.CCRC_TEST_LIST;
    Object.assign(e, env);
    return JSON.parse(execFileSync(serverRootTsx, [script], { cwd: serverRoot, env: e, encoding: 'utf8' }));
  }
  const id = (n: string) => path.join(serverRoot, 'test', `${n}.test.ts`);

  it('runs the files of CCRC_TEST_TIMES longest first', () => {
    const dir = mkTmp('ci-shard-times-seq-t-');
    const list = path.join(dir, 'tests.txt');
    const times = path.join(dir, 'testtimes.json');
    writeFileSync(list, 'test/a.test.ts\ntest/b.test.ts\ntest/c.test.ts\n');
    writeFileSync(times, JSON.stringify({ 'server/test/a.test.ts': 400, 'server/test/b.test.ts': 10, 'server/test/c.test.ts': 200 }));
    expect(sortedBy({ CCRC_TEST_LIST: list, CCRC_TEST_TIMES: times }, [id('b'), id('c'), id('a')]))
      .toEqual([id('a'), id('c'), id('b')]);
  });

  it('without times, keeps the order of CCRC_TEST_LIST (the planner lists a shard longest first)', () => {
    const dir = mkTmp('ci-shard-times-seq-l-');
    const list = path.join(dir, 'tests.txt');
    writeFileSync(list, 'test/c.test.ts\ntest/a.test.ts\ntest/b.test.ts\n');
    expect(sortedBy({ CCRC_TEST_LIST: list }, [id('a'), id('b'), id('c')]))
      .toEqual([id('c'), id('a'), id('b')]);
  });

  it('keeps every specification when two share a moduleId (one file in two projects)', () => {
    const dir = mkTmp('ci-shard-times-seq-d-');
    const list = path.join(dir, 'tests.txt');
    writeFileSync(list, 'test/b.test.ts\ntest/a.test.ts\n');
    expect(sortedBy({ CCRC_TEST_LIST: list }, [id('a'), id('b'), id('a')]))
      .toEqual([id('b'), id('a'), id('a')]);
  });

  it('under --shard with no recorded times, keeps BaseSequencer\'s default order (not the list order)', () => {
    const dir = mkTmp('ci-shard-times-seq-s-');
    const list = path.join(dir, 'tests.txt');
    writeFileSync(list, 'test/a.test.ts\ntest/b.test.ts\ntest/c.test.ts\n');
    // BaseSequencer with no past results runs larger files first.
    const sizes = { ':test/a.test.ts': 1, ':test/b.test.ts': 3, ':test/c.test.ts': 2 };
    expect(sortedBy({ CCRC_TEST_LIST: list }, [id('a'), id('b'), id('c')], { sharded: true, sizes }))
      .toEqual([id('b'), id('c'), id('a')]);
  });
});
