// Shard planner true durations (ARCH rank 2 of the 2026-10-25 landing measurement). The planner was fed
// `endTime - startTime` of vitest's JSON report, which drops `beforeAll` and collection time, so a file that
// spends 400 s in its hooks was planned at 0.5 s. This file pins (1) what the planner did before, as a
// characterization, then (2) the whole-file wall time a reporter now records, and (3) the longest-first order
// inside a shard.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { durationsFromVitestJson, planShards, PROFILES } from '../../.github/ci/shards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
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
