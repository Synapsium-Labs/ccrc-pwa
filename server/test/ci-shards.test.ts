// Task 6 (contract) — the shard planner, `.github/ci/shards.mjs` (spec §7).
//
// `durationsFromVitestJson` is tested against BOTH a static fixture captured
// verbatim from a real run (`./node_modules/.bin/vitest run test/bus.test.ts
// --reporter=json --outputFile.json=<tmp>`, run by hand while drafting this
// plan — the shape below is that report's `testResults[0]` with only the
// numbers changed) and a report this file generates itself by spawning a
// real vitest subprocess, so the field names (`name`/`startTime`/`endTime`)
// are pinned against the real reporter, not an assumption about it.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  durationsFromVitestJson,
  planShards,
  toMatrix,
  PROFILES,
} from '../../.github/ci/shards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const serverRoot = path.resolve(here, '..');

describe('durationsFromVitestJson', () => {
  it('converts an absolute testResults name to a repo-relative key and adds 500ms', () => {
    // Captured shape (field names, nesting) from a real
    // `--reporter=json` run against test/bus.test.ts; only startTime/endTime
    // are changed here to a round number for a legible assertion.
    const report = {
      testResults: [
        {
          name: path.join(repoRoot, 'server', 'test', 'bus.test.ts'),
          startTime: 1_000_000,
          endTime: 1_000_042.75,
        },
      ],
    };
    const out = durationsFromVitestJson(report, repoRoot);
    expect(out).toEqual({ 'server/test/bus.test.ts': 542.75 });
  });

  it('handles multiple files, each independently', () => {
    const report = {
      testResults: [
        { name: path.join(repoRoot, 'server', 'test', 'a.test.ts'), startTime: 0, endTime: 100 },
        { name: path.join(repoRoot, 'server', 'test', 'b.test.ts'), startTime: 50, endTime: 60 },
      ],
    };
    const out = durationsFromVitestJson(report, repoRoot);
    expect(out).toEqual({
      'server/test/a.test.ts': 600,
      'server/test/b.test.ts': 510,
    });
  });

  it('against a REAL vitest JSON report (spawned live)', () => {
    const dir = mkTmp('ci-shards-realreport-');
    const outFile = path.join(dir, 'report.json');
    execFileSync(
      process.argv0,
      [
        path.join(serverRoot, 'node_modules', '.bin', 'vitest'),
        'run', 'test/bus.test.ts',
        '--reporter=json', `--outputFile.json=${outFile}`,
      ],
      { cwd: serverRoot },
    );
    const report = JSON.parse(readFileSync(outFile, 'utf8'));
    const out = durationsFromVitestJson(report, repoRoot);
    expect(Object.keys(out)).toEqual(['server/test/bus.test.ts']);
    // The real wall-clock delta is small and >0; +500 for collection makes
    // it >= 500 always, and comfortably under a minute for a one-file run.
    expect(out['server/test/bus.test.ts']).toBeGreaterThanOrEqual(500);
    expect(out['server/test/bus.test.ts']).toBeLessThan(60_000);
  });
});

describe('PROFILES', () => {
  it('matches the contract exactly', () => {
    expect(PROFILES).toEqual({
      linux: { targetMs: 240_000, min: 1, max: 5, workers: 2, defaultMs: 5000 },
      macosSelected: { targetMs: 900_000, min: 1, max: 2, workers: 1, defaultMs: 5000, scale: 1.5 },
      macosFull: { targetMs: 900_000, min: 1, max: 4, workers: 1, defaultMs: 5000, scale: 1.5 },
      trace: { targetMs: 900_000, min: 1, max: 8, workers: 2, defaultMs: 5000, scale: 6 },
    });
  });
});

describe('planShards — durations known (LPT)', () => {
  it('empty file list -> []', () => {
    expect(planShards([], {}, PROFILES.linux)).toEqual([]);
    expect(planShards([], null, PROFILES.linux)).toEqual([]);
  });

  it('a single file far longer than the target gets a shard of its own', () => {
    // total = 1,200,000 + 3*5,000 = 1,215,000ms; workers 2, targetMs 240,000
    // -> raw = ceil(1,215,000/2/240,000) = ceil(2.53) = 3, clamped [1,5] -> 3.
    const files = ['server/test/huge.test.ts', 'server/test/s1.test.ts', 'server/test/s2.test.ts', 'server/test/s3.test.ts'];
    const durations = {
      'server/test/huge.test.ts': 1_200_000,
      'server/test/s1.test.ts': 5_000,
      'server/test/s2.test.ts': 5_000,
      'server/test/s3.test.ts': 5_000,
    };
    const plan = planShards(files, durations, PROFILES.linux);
    expect(plan).toHaveLength(3);
    const withHuge = plan.find((s) => s.files.includes('server/test/huge.test.ts'));
    expect(withHuge!.files).toEqual(['server/test/huge.test.ts']);
    expect(withHuge!.vitestShard).toBeNull();
    // the other two shards split the three 5s files between them (LPT:
    // longest-first onto least-loaded — after the 1.2M-file starts its own
    // shard as the least-loaded target, the three 5000ms files go one to
    // the second shard, two to the third, or similarly balanced).
    const rest = plan.filter((s) => s !== withHuge);
    const restFiles = rest.flatMap((s) => s.files).sort();
    expect(restFiles).toEqual(['server/test/s1.test.ts', 'server/test/s2.test.ts', 'server/test/s3.test.ts']);
    // no file duplicated or dropped
    expect(plan.flatMap((s) => s.files).sort()).toEqual([...files].sort());
  });

  it('never produces more shards than files, even when the budget asks for more', () => {
    // Two files, each far bigger than target -> raw count would clamp to 5
    // (max), but there are only 2 files to shard.
    const files = ['server/test/a.test.ts', 'server/test/b.test.ts'];
    const durations = { 'server/test/a.test.ts': 5_000_000, 'server/test/b.test.ts': 5_000_000 };
    const plan = planShards(files, durations, PROFILES.linux);
    expect(plan).toHaveLength(2);
    expect(plan.map((s) => s.total)).toEqual([2, 2]);
  });

  it('clamps the shard count to [min, max] regardless of total', () => {
    // 20 tiny files, well under one target-worth of work -> raw = ceil(small
    // number) likely 1, but min forces at least profile.min. Use a profile
    // with min=3 to prove the clamp floor is honoured.
    const files = Array.from({ length: 20 }, (_, i) => `server/test/f${i}.test.ts`);
    const durations = Object.fromEntries(files.map((f) => [f, 100]));
    const profile = { targetMs: 240_000, min: 3, max: 5, workers: 2, defaultMs: 5000 };
    const plan = planShards(files, durations, profile);
    expect(plan).toHaveLength(3);

    // And the ceiling: durations huge enough that raw would exceed max.
    const bigDurations = Object.fromEntries(files.map((f) => [f, 10_000_000]));
    const capped = planShards(files, bigDurations, { ...profile, max: 4 });
    expect(capped).toHaveLength(4);
  });

  it('a file missing from a NON-empty table is given the MEDIAN of the known durations (spec §7.1)', () => {
    // median of 1000, 2000, 9000 is 2000: total 14000 → 2 shards, d packed as 2000 (after b by path).
    // At defaultMs (5000) the total would be 17000 → 3 shards.
    const plan = planShards(['a', 'b', 'c', 'd'], { a: 1000, b: 2000, c: 9000 },
      { targetMs: 7000, min: 1, max: 5, workers: 1, defaultMs: 5000 });
    expect(plan.map((s) => s.files)).toEqual([['c'], ['b', 'd', 'a']]);
    // An even count takes the mean of the middle two: 1000, 3000 → 2000, so three unknown files make the total
    // 10000 → 4 shards (the lower middle would give 7000 → 3, the upper 13000 → 5, defaultMs 31000 → 5).
    const even = planShards(['a', 'b', 'x', 'y', 'z'], { a: 1000, b: 3000 }, { targetMs: 3000, min: 1, max: 5, workers: 1, defaultMs: 9000 });
    expect(even.length).toBe(4);
  });

  it('a file missing from durations is still planned (one shard holds both)', () => {
    const files = ['server/test/known.test.ts', 'server/test/unknown.test.ts'];
    const durations = { 'server/test/known.test.ts': 1000 };
    const profile = { targetMs: 240_000, min: 1, max: 1, workers: 2, defaultMs: 5000 };
    const plan = planShards(files, durations, profile);
    expect(plan).toHaveLength(1);
    expect(plan[0].files.sort()).toEqual(files.sort());
  });

  it('ties in duration are broken by path, deterministically', () => {
    const files = ['server/test/z.test.ts', 'server/test/a.test.ts', 'server/test/m.test.ts'];
    const durations = Object.fromEntries(files.map((f) => [f, 1000]));
    // 3 equal-duration files onto 3 shards, one each; order of assignment
    // by path ascending means a.test.ts -> shard1, m -> shard2, z -> shard3.
    const profile = { targetMs: 1, min: 3, max: 3, workers: 1, defaultMs: 1000 };
    const plan = planShards(files, durations, profile);
    expect(plan.map((s) => s.files[0])).toEqual([
      'server/test/a.test.ts', 'server/test/m.test.ts', 'server/test/z.test.ts',
    ]);
  });
});

describe('planShards — an EMPTY durations object is "durations present"', () => {
  it('packs by LPT at defaultMs, every file exactly once, and never hands out a vitest --shard', () => {
    // select.mjs plans the TRACE matrix with `times ?? {}`: trace-run.mjs takes
    // an exact list and has no --shard, so the trace plan must never be the
    // every-shard-gets-everything fallback, even before any durations exist.
    const files = Array.from({ length: 12 }, (_, i) => `server/test/f${String(i).padStart(2, '0')}.test.ts`);
    const plan = planShards(files, {}, { ...PROFILES.trace, targetMs: 30_000 });
    expect(plan.length).toBeGreaterThan(1);
    expect(plan.every((s) => s.vitestShard === null)).toBe(true);
    expect(plan.flatMap((s) => s.files).sort()).toEqual(files);
  });
});

describe('planShards — durations === null (vitest hash-shard fallback)', () => {
  it('every shard gets ALL files, with a vitestShard "i/n" string', () => {
    const files = ['server/test/a.test.ts', 'server/test/b.test.ts', 'server/test/c.test.ts'];
    // Force count = 3 via a tiny target relative to defaultMs*files*workers.
    const profile = { targetMs: 1, min: 1, max: 5, workers: 1, defaultMs: 100_000 };
    const plan = planShards(files, null, profile);
    expect(plan).toHaveLength(3);
    for (const [i, shard] of plan.entries()) {
      expect(shard.index).toBe(i + 1);
      expect(shard.total).toBe(3);
      expect(shard.files).toEqual(files);
      expect(shard.vitestShard).toBe(`${i + 1}/3`);
    }
  });

  it('with a single computed shard, vitestShard is "1/1"', () => {
    const files = ['server/test/a.test.ts'];
    const plan = planShards(files, null, PROFILES.linux);
    expect(plan).toEqual([
      { index: 1, total: 1, files: ['server/test/a.test.ts'], vitestShard: '1/1' },
    ]);
  });
});

describe('toMatrix', () => {
  it('converts repo-relative paths to server-relative, space-joined', () => {
    const plan = [
      { index: 1, total: 2, files: ['server/test/a.test.ts', 'server/test/b.test.ts'], vitestShard: null },
      { index: 2, total: 2, files: ['server/test/c.test.ts'], vitestShard: '2/2' },
    ];
    expect(toMatrix(plan)).toEqual({
      include: [
        { shard: 1, total: 2, files: 'test/a.test.ts test/b.test.ts', vitest_shard: '' },
        { shard: 2, total: 2, files: 'test/c.test.ts', vitest_shard: '2/2' },
      ],
    });
  });

  it('empty plan -> empty include', () => {
    expect(toMatrix([])).toEqual({ include: [] });
  });
});

describe('the `times` CLI', () => {
  it('merges vitest JSON reports from repo root into one durations file', () => {
    const dir = mkTmp('ci-shards-times-cli-');
    const reportFile = path.join(dir, 'report.json');
    execFileSync(
      process.argv0,
      [
        path.join(serverRoot, 'node_modules', '.bin', 'vitest'),
        'run', 'test/bus.test.ts', 'test/dtbd.test.ts',
        '--reporter=json', `--outputFile.json=${reportFile}`,
      ],
      { cwd: serverRoot },
    );
    const outFile = path.join(dir, 'times.json');
    execFileSync(process.argv0, [
      path.join(repoRoot, '.github', 'ci', 'shards.mjs'),
      'times', '--out', outFile, reportFile,
    ], { cwd: repoRoot });
    const merged = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(Object.keys(merged).sort()).toEqual(['server/test/bus.test.ts', 'server/test/dtbd.test.ts']);
    for (const v of Object.values(merged)) {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(500);
    }
  });

  it('merges TWO separate report files (as two shards would each produce)', () => {
    const dir = mkTmp('ci-shards-times-cli-multi-');
    const r1 = path.join(dir, 'r1.json');
    const r2 = path.join(dir, 'r2.json');
    execFileSync(process.argv0, [
      path.join(serverRoot, 'node_modules', '.bin', 'vitest'), 'run', 'test/bus.test.ts',
      '--reporter=json', `--outputFile.json=${r1}`,
    ], { cwd: serverRoot });
    execFileSync(process.argv0, [
      path.join(serverRoot, 'node_modules', '.bin', 'vitest'), 'run', 'test/dtbd.test.ts',
      '--reporter=json', `--outputFile.json=${r2}`,
    ], { cwd: serverRoot });
    const outFile = path.join(dir, 'times.json');
    execFileSync(process.argv0, [
      path.join(repoRoot, '.github', 'ci', 'shards.mjs'), 'times', '--out', outFile, r1, r2,
    ], { cwd: repoRoot });
    const merged = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(Object.keys(merged).sort()).toEqual(['server/test/bus.test.ts', 'server/test/dtbd.test.ts']);
  });

  // vitest's JSON names each file by its ABSOLUTE path; the CLI makes them
  // relative to the directory it runs in, so it must run from the repository
  // root (ci.yml's times-build step sets no working-directory —
  // ci-pipeline.test.ts pins that). Run from anywhere else, it refuses rather
  // than write keys no file will ever match.
  function syntheticReport(root: string): string {
    const file = path.join(mkTmp('ci-shards-times-synth-'), 'report.json');
    writeFileSync(file, JSON.stringify({
      testResults: [{ name: path.join(root, 'server', 'test', 'x.test.ts'), startTime: 0, endTime: 1000 }],
    }));
    return file;
  }

  it('run from the repository root: the keys are repo-relative', () => {
    const root = mkTmp('ci-shards-times-root-');
    const outFile = path.join(root, 'times.json');
    execFileSync(process.argv0, [path.join(repoRoot, '.github', 'ci', 'shards.mjs'), 'times', '--out', outFile, syntheticReport(root)], { cwd: root });
    expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual({ 'server/test/x.test.ts': 1500 });
  });

  it('run from anywhere else (server/): refuses, and writes nothing', () => {
    const root = mkTmp('ci-shards-times-root-');
    mkdirSync(path.join(root, 'server'));
    const outFile = path.join(root, 'times.json');
    let stderr = '';
    expect(() => {
      try {
        execFileSync(process.argv0, [path.join(repoRoot, '.github', 'ci', 'shards.mjs'), 'times', '--out', outFile, syntheticReport(root)],
          { cwd: path.join(root, 'server'), stdio: 'pipe' });
      } catch (e) {
        stderr = String((e as { stderr: Buffer }).stderr);
        throw e;
      }
    }).toThrow();
    expect(stderr).toContain('run it from the repository root');
    expect(() => readFileSync(outFile)).toThrow();
  });

  it('with no report files, exits non-zero and writes nothing', () => {
    const dir = mkTmp('ci-shards-times-cli-empty-');
    const outFile = path.join(dir, 'times.json');
    expect(() => execFileSync(process.argv0, [
      path.join(repoRoot, '.github', 'ci', 'shards.mjs'), 'times', '--out', outFile,
    ], { cwd: repoRoot, stdio: 'pipe' })).toThrow();
  });
});
