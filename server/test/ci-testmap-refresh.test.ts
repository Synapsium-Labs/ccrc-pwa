// The bounded test-map refresh (#1407's measurement: no map published since the hourly refresh outgrew its
// 60-minute shards). This file pins how select treats a fresh, a missing and a stale map TODAY (characterization,
// green on the unchanged code), then the bounded refresh: a partial-merge that stamps each record with the sha it was
// traced at, the uncertain-means-full rule, the batch sizer and the stale-map warning.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { refreshMap } from '../../.github/ci/testmap.mjs';
import { uncertainTests, selectTests } from '../../.github/ci/select-tests.mjs';
import { planTraceBatch, PROFILES } from '../../.github/ci/shards.mjs';
import { refreshPriority } from '../../.github/ci/select.mjs';
import { mkTmp } from './tmpHelpers.js';

const SELECT_MJS = path.resolve(__dirname, '../../.github/ci/select.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, { cwd: repo, env: { ...process.env, ...GIT_ENV, ...env }, encoding: 'utf8' });
}

function writeFile(repo: string, rel: string, content: string): void {
  const full = path.join(repo, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(repo: string, message: string, date?: string): string {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message], date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {});
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function rec(opts: { read?: string[]; unknown?: boolean; tracedAt?: string } = {}) {
  const r: Record<string, unknown> = { read: opts.read ?? [], probed: [], listed: [], subtree: [], git: false, unknown: !!opts.unknown };
  if (opts.tracedAt) r.tracedAt = opts.tracedAt;
  return r;
}

function parseOutput(text: string): Record<string, string> {
  const lines = text.split('\n');
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_]+)<<(.+)$/.exec(lines[i]);
    if (!m) continue;
    const vals: string[] = [];
    i++;
    while (i < lines.length && lines[i] !== m[2]) vals.push(lines[i++]);
    out[m[1]] = vals.join('\n');
  }
  return out;
}

function runSelect(repo: string, args: string[]) {
  const io = mkTmp('ccrc-ci-refresh-io-');
  const outputFile = path.join(io, 'output.txt');
  const summaryFile = path.join(io, 'summary.md');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  let stdout = '';
  try {
    stdout = execFileSync('node', [SELECT_MJS, '--repo', repo, ...args], {
      env: { ...process.env, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile }, encoding: 'utf8',
    });
  } catch (e) {
    throw new Error(`select failed: ${String((e as { stderr?: unknown }).stderr)}`);
  }
  return { stdout, outputs: parseOutput(readFileSync(outputFile, 'utf8')), summary: readFileSync(summaryFile, 'utf8') };
}

/** A repo whose map commit is `OLD_DATE` (days old) and whose HEAD changes src/foo.ts. */
const OLD_DATE = '2026-01-01T00:00:00Z';
function fixture(opts: { mapDate?: string } = {}) {
  const repo = mkTmp('ccrc-ci-refresh-repo-');
  git(repo, ['init', '-q']);
  git(repo, ['checkout', '-q', '-b', 'main']);
  writeFile(repo, 'src/foo.ts', 'export const foo = 1;\n');
  writeFile(repo, 'server/test/a.test.ts', "it('a', () => {});\n");
  writeFile(repo, 'server/test/b.test.ts', "it('b', () => {});\n");
  const baseSha = commitAll(repo, 'base', opts.mapDate ?? OLD_DATE);
  writeFile(repo, 'src/foo.ts', 'export const foo = 2;\n');
  const headSha = commitAll(repo, 'head');
  return { repo, baseSha, headSha };
}

function writeMap(repo: string, map: unknown): string {
  const f = path.join(repo, '..', `map-${path.basename(repo)}.json`);
  writeFileSync(f, JSON.stringify(map));
  return f;
}

function mapOf(sha: string, tests: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { format: 1, sha, baseline: { read: [], probed: [], listed: [], subtree: [], git: false }, tests, ...extra };
}

describe('select today: a fresh, a missing and a stale map (characterization)', () => {
  it('a fresh map selects exactly what the change affects, and the summary carries no stale-map warning', () => {
    const { repo, baseSha } = fixture({ mapDate: new Date().toISOString() });
    const map = writeMap(repo, mapOf(baseSha, {
      'server/test/a.test.ts': rec({ read: ['src/foo.ts'] }), 'server/test/b.test.ts': rec(),
    }));
    const r = runSelect(repo, ['--event', 'pull_request', '--map', map]);
    expect(r.outputs.tests).toBe('selected');
    expect(r.outputs.count).toBe('1');
    expect(r.summary).toContain('server/test/a.test.ts');
    expect(r.summary).not.toMatch(/stale|older than/i);
    expect(r.stdout).not.toMatch(/::warning::/);
  });

  it('a missing map answers a full run and says so', () => {
    const { repo } = fixture();
    const r = runSelect(repo, ['--event', 'pull_request', '--map', path.join(repo, 'absent.json')]);
    expect(r.outputs.tests).toBe('full');
    expect(r.outputs.fallback).toMatch(/no map restored/);
  });

  it('a months-old map is still trusted and selected from; since the bounded refresh it also says it is old', () => {
    const { repo, baseSha } = fixture({ mapDate: OLD_DATE });
    const map = writeMap(repo, mapOf(baseSha, {
      'server/test/a.test.ts': rec({ read: ['src/foo.ts'] }), 'server/test/b.test.ts': rec(),
    }));
    const r = runSelect(repo, ['--event', 'pull_request', '--map', map]);
    expect(r.outputs.tests).toBe('selected');
    expect(r.outputs.count).toBe('1');
    expect(r.summary).toMatch(/older than 3 h/);
  });

  it('a refresh with no durations traces the whole selection, every file once, in at most eight shards', () => {
    const { repo, baseSha } = fixture();
    const map = writeMap(repo, mapOf(baseSha, {
      'server/test/a.test.ts': rec({ read: ['src/foo.ts'] }), 'server/test/b.test.ts': rec(),
    }));
    const r = runSelect(repo, ['--event', 'schedule', '--input-mode', 'refresh', '--map', map]);
    expect(r.outputs.trace).toBe('refresh');
    expect(r.outputs.trace_count).toBe('1');
    expect(JSON.parse(r.outputs.trace_matrix).include.length).toBeLessThanOrEqual(8);
  });
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const dep = { read: [], probed: [], listed: [], subtree: [], git: false };
const side = { root: dep, rest: dep };

describe('the partial merge (a refresh that retraced only a batch)', () => {
  const old = {
    format: 1, sha: SHA_A, baseline: dep,
    tests: {
      'server/test/carried-old.test.ts': { ...dep, read: ['x'], unknown: false },
      'server/test/carried-stamped.test.ts': { ...dep, read: ['y'], unknown: false, tracedAt: SHA_A },
      'server/test/retraced.test.ts': { ...dep, read: ['old'], unknown: false, tracedAt: SHA_A },
    },
  };
  const records = { format: 2, baseline: side, tests: { 'server/test/retraced.test.ts': { ...side, rest: { ...dep, read: ['new'] }, unknown: false } } };
  const live = ['server/test/carried-old.test.ts', 'server/test/carried-stamped.test.ts', 'server/test/retraced.test.ts'];

  it('keeps the carried entries, overwrites the retraced one, and stamps each with the sha it was traced at', () => {
    const m = refreshMap(old as never, SHA_B, records as never, live, ['server/test/retraced.test.ts']);
    expect(m.sha).toBe(SHA_B);
    expect(m.tests['server/test/retraced.test.ts'].read).toEqual(['new']);
    expect(m.tests['server/test/retraced.test.ts'].tracedAt).toBe(SHA_B);
    expect(m.tests['server/test/carried-stamped.test.ts'].read).toEqual(['y']);
    expect(m.tests['server/test/carried-stamped.test.ts'].tracedAt).toBe(SHA_A);
    // A record from before stamping was traced at the map it came from, never at this refresh.
    expect(m.tests['server/test/carried-old.test.ts'].tracedAt).toBe(SHA_A);
  });

  it('a second partial refresh never re-stamps a carried entry with a newer sha', () => {
    const m1 = refreshMap(old as never, SHA_B, records as never, live, ['server/test/retraced.test.ts']);
    const m2 = refreshMap(m1 as never, SHA_C, { ...records, tests: {} } as never, live, []);
    expect(m2.tests['server/test/carried-old.test.ts'].tracedAt).toBe(SHA_A);
    expect(m2.tests['server/test/retraced.test.ts'].tracedAt).toBe(SHA_B);
  });
});

describe('uncertain means full', () => {
  const change = (p: string, status: 'A' | 'D' | 'M' = 'M') => ({ status, path: p, symlink: false });
  const exists = () => true;
  const map = {
    format: 1, sha: SHA_B, baseline: dep,
    tests: {
      'server/test/fresh.test.ts': { ...dep, unknown: false, tracedAt: SHA_B },
      'server/test/deferred.test.ts': { ...dep, read: ['src/foo.ts'], unknown: false, tracedAt: SHA_A },
      'server/test/older-but-quiet.test.ts': { ...dep, read: ['src/other.ts'], unknown: false, tracedAt: SHA_A },
    },
  };
  const live = ['server/test/deferred.test.ts', 'server/test/fresh.test.ts', 'server/test/older-but-quiet.test.ts'];
  const staleChanges = new Map([[SHA_A, [change('src/foo.ts')]]]);

  it('a record older than a change to what it read is uncertain; an older record nothing touched is not', () => {
    const u = uncertainTests({ map: map as never, liveTests: live, staleChanges, existsAt: exists });
    expect(u.map((x: { file: string }) => x.file)).toEqual(['server/test/deferred.test.ts']);
  });

  it('a record whose own file changed after its traced-at sha is uncertain', () => {
    const sc = new Map([[SHA_A, [change('server/test/older-but-quiet.test.ts')]]]);
    const u = uncertainTests({ map: map as never, liveTests: live, staleChanges: sc, existsAt: exists });
    expect(u.map((x: { file: string }) => x.file)).toContain('server/test/older-but-quiet.test.ts');
  });

  it('a test present when the map was built but absent from it was never traced: uncertain; one added since is rule 1, not uncertain', () => {
    const l = [...live, 'server/test/lost.test.ts', 'server/test/brand-new.test.ts'];
    const at = (_ref: string, p: string) => p !== 'server/test/brand-new.test.ts';
    const u = uncertainTests({ map: map as never, liveTests: l, staleChanges, existsAt: at });
    const files = u.map((x: { file: string }) => x.file);
    expect(files).toContain('server/test/lost.test.ts');
    expect(files).not.toContain('server/test/brand-new.test.ts');
  });

  it('a record whose traced-at sha cannot be diffed (no change set for it) is uncertain', () => {
    const u = uncertainTests({ map: map as never, liveTests: live, staleChanges: new Map(), existsAt: exists });
    expect(u.map((x: { file: string }) => x.file)).toEqual(['server/test/deferred.test.ts', 'server/test/older-but-quiet.test.ts']);
  });

  it('a pipeline change after the traced-at sha makes every older record uncertain', () => {
    const sc = new Map([[SHA_A, [change('.github/ci/select.mjs')]]]);
    const u = uncertainTests({ map: map as never, liveTests: live, staleChanges: sc, existsAt: exists });
    expect(u.map((x: { file: string }) => x.file).sort()).toEqual(['server/test/deferred.test.ts', 'server/test/older-but-quiet.test.ts']);
  });

  it('selectTests answers full, naming the uncertain test, instead of a per-file selection', () => {
    const sel = selectTests({ map: map as never, changes: [change('src/unrelated.ts')], liveTests: live, existsAt: exists, staleChanges });
    expect(sel.mode).toBe('full');
    expect((sel as { reason: string }).reason).toMatch(/uncertain.*server\/test\/deferred\.test\.ts/);
  });

  it('a map with every record at its own sha is selected as before', () => {
    const m = { ...map, tests: { 'server/test/fresh.test.ts': map.tests['server/test/fresh.test.ts'] } };
    const sel = selectTests({ map: m as never, changes: [change('src/unrelated.ts')], liveTests: ['server/test/fresh.test.ts'], existsAt: exists, staleChanges: new Map() });
    expect(sel.mode).toBe('selected');
  });
});

describe('the batch sizer', () => {
  const MIN = 60_000;
  const budgetMs = 45 * MIN;
  const profile = { shards: 8, budgetMs, workers: 2, scale: 6, defaultMs: 5000 };
  const loadOf = (files: string[], d: Record<string, number>) => files.reduce((s, f) => s + (d[f] ?? 5000), 0) * profile.scale / profile.workers;

  it('never plans a shard past the budget, and defers what does not fit', () => {
    const d: Record<string, number> = {};
    const files: string[] = [];
    for (let i = 0; i < 60; i++) { const f = `server/test/t${String(i).padStart(2, '0')}.test.ts`; files.push(f); d[f] = (1 + (i % 7)) * 90_000; }
    const r = planTraceBatch(files, d, profile);
    expect(r.plan.length).toBeLessThanOrEqual(8);
    for (const s of r.plan) expect(loadOf(s.files, d)).toBeLessThanOrEqual(budgetMs);
    expect(r.deferred.length).toBeGreaterThan(0);
    expect([...r.batch, ...r.deferred].sort()).toEqual([...files].sort());
    expect(r.plan.flatMap((s: { files: string[] }) => s.files).sort()).toEqual([...r.batch].sort());
  });

  it('plans in the order it was given: the first files are the ones that fit', () => {
    const d = { 'server/test/a.test.ts': 600_000, 'server/test/b.test.ts': 600_000 };
    const r = planTraceBatch(['server/test/b.test.ts', 'server/test/a.test.ts'], d, { ...profile, shards: 1, budgetMs: 40 * MIN });
    expect(r.batch).toEqual(['server/test/b.test.ts']);
    expect(r.deferred).toEqual(['server/test/a.test.ts']);
  });

  it('takes a smaller file after a larger one that did not fit', () => {
    const d = { 'server/test/big.test.ts': 900_000, 'server/test/small.test.ts': 10_000, 'server/test/mid.test.ts': 600_000 };
    const r = planTraceBatch(['server/test/mid.test.ts', 'server/test/big.test.ts', 'server/test/small.test.ts'], d, { ...profile, shards: 1, budgetMs: 40 * MIN });
    expect(r.batch).toEqual(['server/test/mid.test.ts', 'server/test/small.test.ts']);
    expect(r.deferred).toEqual(['server/test/big.test.ts']);
  });

  it('a file with no known duration costs the median of the known ones', () => {
    const d = { 'server/test/a.test.ts': 600_000 };
    const r = planTraceBatch(['server/test/a.test.ts', 'server/test/unknown.test.ts'], d, { ...profile, shards: 1, budgetMs: 40 * MIN });
    expect(r.deferred).toEqual(['server/test/unknown.test.ts']);
  });

  it('numbers its shards 1..n of n, empty shards dropped', () => {
    const r = planTraceBatch(['server/test/a.test.ts'], {}, profile);
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0]).toMatchObject({ index: 1, total: 1, vitestShard: null, workers: 2 });
  });

  it('the trace profile carries the 45-minute budget inside the 60-minute job timeout', () => {
    expect(PROFILES.trace.budgetMs).toBe(45 * MIN);
    expect(PROFILES.trace.max).toBe(8);
  });
});

describe('select warns when the map is old', () => {
  const HOUR = 3_600_000;
  function withBuiltAt(ageMs: number, extra: string[] = []) {
    const { repo, baseSha } = fixture({ mapDate: new Date().toISOString() });
    const now = new Date('2026-10-26T12:00:00Z');
    const map = writeMap(repo, mapOf(baseSha, { 'server/test/a.test.ts': rec({ read: ['src/foo.ts'] }), 'server/test/b.test.ts': rec() },
      { builtAt: new Date(now.getTime() - ageMs).toISOString() }));
    return runSelect(repo, ['--event', 'pull_request', '--map', map, '--now', now.toISOString(), ...extra]);
  }

  it('a map built more than three hours ago is reported in the step summary and as a warning annotation', () => {
    const r = withBuiltAt(4 * HOUR);
    expect(r.summary).toMatch(/map is 4 h old/);
    expect(r.summary).toMatch(/older than 3 h/);
    expect(r.stdout).toMatch(/::warning::.*map is 4 h old/);
    expect(r.outputs.tests).toBe('selected');
  });

  it('a map built two hours ago is not', () => {
    const r = withBuiltAt(2 * HOUR);
    expect(r.summary).not.toMatch(/older than/);
    expect(r.stdout).not.toMatch(/::warning::/);
  });

  it('a map without a build time is aged by its commit', () => {
    const { repo, baseSha } = fixture({ mapDate: '2026-10-26T01:00:00Z' });
    const map = writeMap(repo, mapOf(baseSha, { 'server/test/a.test.ts': rec({ read: ['src/foo.ts'] }), 'server/test/b.test.ts': rec() }));
    const r = runSelect(repo, ['--event', 'pull_request', '--map', map, '--now', '2026-10-26T12:00:00Z']);
    expect(r.summary).toMatch(/map is 11 h old/);
  });
});

describe('a refresh is bounded', () => {
  it('traces only the batch that fits the budget, hands map-build just that batch, and reports what it deferred', () => {
    const { repo, baseSha } = fixture();
    const tests: Record<string, unknown> = {};
    const durations: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      const f = `server/test/t${String(i).padStart(2, '0')}.test.ts`;
      writeFile(repo, f, `it('${i}', () => {});\n`);
    }
    const base2 = commitAll(repo, 'tests');
    for (let i = 0; i < 20; i++) {
      const f = `server/test/t${String(i).padStart(2, '0')}.test.ts`;
      tests[f] = rec({ read: ['src/foo.ts'] });
      durations[f] = 600_000; // 10 min x 6 / 2 workers = 30 min of one shard each
    }
    writeFile(repo, 'src/foo.ts', 'export const foo = 3;\n');
    commitAll(repo, 'touch');
    void base2;
    const map = writeMap(repo, mapOf(baseSha, { ...tests, 'server/test/a.test.ts': rec(), 'server/test/b.test.ts': rec() }));
    const times = path.join(repo, '..', `times-${path.basename(repo)}.json`);
    writeFileSync(times, JSON.stringify(durations));
    const traceList = path.join(repo, '..', `traced-${path.basename(repo)}.txt`);
    const r = runSelect(repo, ['--event', 'schedule', '--input-mode', 'refresh', '--map', map, '--times', times, '--trace-list', traceList]);
    const matrix = JSON.parse(r.outputs.trace_matrix) as { include: Array<{ files: string }> };
    expect(matrix.include.length).toBeLessThanOrEqual(8);
    const traced = readFileSync(traceList, 'utf8').split('\n').filter(Boolean);
    expect(r.outputs.trace_count).toBe(String(traced.length));
    expect(traced.length).toBe(8);
    expect(new Set(matrix.include.flatMap((m) => m.files.split(' ')).map((f) => `server/${f}`)).size).toBe(8);
    expect(r.summary).toMatch(/deferred to a later refresh: 12/);
  });
});

describe('what an older record does not make uncertain', () => {
  const change = (p: string) => ({ status: 'M' as const, path: p, symlink: false });
  it('an older unknown record, or one that reads .git, is selected by rule 2 anyway: not uncertain', () => {
    const map = {
      format: 1, sha: SHA_B, baseline: dep,
      tests: {
        'server/test/unknown.test.ts': { ...dep, read: ['src/foo.ts'], unknown: true, tracedAt: SHA_A },
        'server/test/git.test.ts': { ...dep, read: ['src/foo.ts'], git: true, unknown: false, tracedAt: SHA_A },
      },
    };
    const u = uncertainTests({
      map: map as never, liveTests: Object.keys(map.tests), staleChanges: new Map([[SHA_A, [change('src/foo.ts')]]]), existsAt: () => true,
    });
    expect(u).toEqual([]);
  });
});

describe('a refresh is a refresh whenever there is a map', () => {
  it('a pipeline change forces everything, and the refresh still carries the map and is bounded', () => {
    const { repo, baseSha } = fixture();
    writeFile(repo, '.github/ci/x.mjs', '// pipeline\n');
    commitAll(repo, 'pipeline');
    const map = writeMap(repo, mapOf(baseSha, { 'server/test/a.test.ts': rec(), 'server/test/b.test.ts': rec() }));
    const r = runSelect(repo, ['--event', 'schedule', '--input-mode', 'refresh', '--map', map]);
    expect(r.outputs.map_sha).toBe(baseSha);
    expect(r.outputs.fallback).toMatch(/pipeline path changed/);
    expect(r.outputs.trace_count).toBe('2');
  });

  it('with no map it traces from the live list, bounded, and has no map sha', () => {
    const { repo } = fixture();
    const r = runSelect(repo, ['--event', 'schedule', '--input-mode', 'refresh', '--map', path.join(repo, 'absent.json')]);
    expect(r.outputs.map_sha).toBe('');
    expect(r.outputs.trace_count).toBe('2');
  });

  it('a carried stale record that a later change touched is traced again, and a pull request meanwhile gets a full run', () => {
    const { repo, baseSha, headSha } = fixture();
    // The map is at HEAD; one record is still stamped at the earlier commit, and HEAD's change to src/foo.ts is
    // newer than that stamp.
    const map = writeMap(repo, mapOf(headSha, {
      'server/test/a.test.ts': rec({ read: ['src/foo.ts'], tracedAt: baseSha }),
      'server/test/b.test.ts': rec({ tracedAt: headSha }),
    }));
    const pr = runSelect(repo, ['--event', 'pull_request', '--map', map]);
    expect(pr.outputs.tests).toBe('full');
    expect(pr.outputs.fallback).toMatch(/uncertain.*server\/test\/a\.test\.ts/);
    const refresh = runSelect(repo, ['--event', 'schedule', '--input-mode', 'refresh', '--map', map]);
    expect(refresh.outputs.trace_count).toBe('1');
  });
});

describe('the order a refresh traces in', () => {
  it('tests that are new or never traced come first, then the stalest stamp, then by name', () => {
    const { repo, baseSha, headSha } = fixture();
    const map = {
      format: 1, sha: headSha, baseline: dep,
      tests: {
        'server/test/a.test.ts': { ...dep, unknown: false, tracedAt: headSha },
        'server/test/b.test.ts': { ...dep, unknown: false, tracedAt: baseSha },
      },
    };
    const selection = { mode: 'selected', tests: [
      { file: 'server/test/a.test.ts', rule: 3, path: 'src/foo.ts' },
      { file: 'server/test/b.test.ts', rule: 3, path: 'src/foo.ts' },
      { file: 'server/test/c.test.ts', rule: 1, path: 'server/test/c.test.ts' },
    ] };
    const order = refreshPriority(repo, map as never, [], selection as never, [{ file: 'server/test/z.test.ts', tracedAt: null }]);
    expect(order).toEqual(['server/test/c.test.ts', 'server/test/z.test.ts', 'server/test/b.test.ts', 'server/test/a.test.ts']);
  });
});
