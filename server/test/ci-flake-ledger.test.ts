// D-8268: the flake ledger, `.github/ci/flake-ledger.mjs`. A flake is a job that failed and then passed on the SAME
// head sha (a re-run attempt, or a second run of the same workflow on that sha): nothing in the tree changed between
// the two, so the failure was not the code's. The pairing (`pairFlakes`), the run pre-filter (`candidateRuns`), the
// signature readers (`parseLogSignature`, `annotationSignature`), the summary (`summarize`) and the whole pass over an
// injected reader (`runLedger`) are tested here offline over fixtures; the CLI is run once against a fake `gh` on
// PATH, so no row here touches the network.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import {
  annotationSignature, candidateRuns, daySlices, ghIo, pairFlakes, parseArgs, parseLogSignature, runLedger, summarize,
  toExecutions,
} from '../../.github/ci/flake-ledger.mjs';
import type { Annotation } from '../../.github/ci/flake-ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', '..', '.github', 'ci', 'flake-ledger.mjs');
const CI = '.github/workflows/ci.yml';
const sha = (c: string): string => c.repeat(40);

type Run = { id: number, name: string, path: string, event: string, head_sha: string, run_attempt: number, created_at: string };
type Job = {
  id: number, run_id: number, run_attempt: number, name: string, status: string, conclusion: string | null,
  started_at: string | null, completed_at: string | null, head_sha: string,
  steps?: Array<{ name: string, number: number, conclusion: string | null }>,
};

const run = (id: number, event: string, s: string, attempt: number, over: Partial<Run> = {}): Run => ({
  id, name: 'ci', path: CI, event, head_sha: s, run_attempt: attempt, created_at: '2026-11-10T10:00:00Z', ...over,
});

let jobSeq = 1000;
const job = (r: Run, name: string, attempt: number, conclusion: string | null, minute: number, over: Partial<Job> = {}): Job => ({
  id: jobSeq++, run_id: r.id, run_attempt: attempt, name, status: 'completed', conclusion,
  started_at: `2026-11-10T10:${String(minute).padStart(2, '0')}:00Z`,
  completed_at: `2026-11-10T10:${String(minute + 1).padStart(2, '0')}:00Z`,
  head_sha: r.head_sha,
  steps: [{ name: 'Set up job', number: 1, conclusion: 'success' }, { name: 'Run tests', number: 2, conclusion: conclusion === 'success' ? 'success' : 'failure' }],
  ...over,
});

/** R1: a queue entry whose attempt 1 failed a shard and whose attempt 2 (a re-run) passed it.
 *  R2/R3: two pull_request runs on one sha, the first red, the second green.
 *  R4: a single queue run, red, never re-run — a real failure, never a flake.
 *  R5: a pull_request run re-run twice: failed, failed, passed. */
function fixture() {
  const R1 = run(1, 'merge_group', sha('a'), 2);
  const R2 = run(2, 'pull_request', sha('b'), 1);
  const R3 = run(3, 'pull_request', sha('b'), 1, { created_at: '2026-11-10T11:00:00Z' });
  const R4 = run(4, 'merge_group', sha('c'), 1);
  const R5 = run(5, 'pull_request', sha('d'), 3);
  const jobs: Record<number, Job[]> = {
    1: [
      job(R1, 'server 1/4', 1, 'failure', 1), job(R1, 'server 2/4', 1, 'success', 1),
      job(R1, 'server 1/4', 2, 'success', 20),
    ],
    2: [job(R2, 'pwa 2/3', 1, 'failure', 5), job(R2, 'typecheck (server)', 1, 'success', 5)],
    3: [job(R3, 'pwa 2/3', 1, 'success', 40), job(R3, 'typecheck (server)', 1, 'success', 40)],
    4: [job(R4, 'server 3/4', 1, 'failure', 2)],
    5: [
      job(R5, 'browser (pwa) 1/2', 1, 'failure', 1), job(R5, 'browser (pwa) 1/2', 2, 'timed_out', 10),
      job(R5, 'browser (pwa) 1/2', 3, 'success', 30),
    ],
  };
  return { runs: [R1, R2, R3, R4, R5], jobs };
}

const execsOf = (runs: Run[], jobs: Record<number, Job[]>) => runs.flatMap((r) => toExecutions(r, jobs[r.id] ?? []));

describe('candidateRuns — only a sha that ran more than once can hold a pair', () => {
  it('keeps a re-run run and every run of a sha the same workflow ran twice; drops a lone first attempt', () => {
    const { runs } = fixture();
    expect(candidateRuns(runs).map((r) => r.id).sort()).toEqual([1, 2, 3, 5]);
  });

  it('does not join two workflows that ran once each on one sha', () => {
    const a = run(10, 'pull_request', sha('e'), 1);
    const b = run(11, 'pull_request', sha('e'), 1, { path: '.github/workflows/codeql.yml', name: 'codeql' });
    expect(candidateRuns([a, b])).toEqual([]);
  });
});

describe('toExecutions', () => {
  it('maps a job onto one execution, keyed by workflow, job name and head sha, naming its failed step', () => {
    const r = run(7, 'merge_group', sha('f'), 1);
    const j = job(r, 'server 1/4', 1, 'failure', 3);
    expect(toExecutions(r, [j])).toEqual([{
      runId: 7, attempt: 1, jobId: j.id, event: 'merge_group', workflow: CI, job: 'server 1/4', sha: sha('f'),
      conclusion: 'failure', startedAt: '2026-11-10T10:03:00Z', completedAt: '2026-11-10T10:04:00Z', failedStep: 'Run tests',
    }]);
  });

  it('falls back to the run\'s name for the workflow and to the run\'s sha when the job lacks one', () => {
    const r = run(8, 'pull_request', sha('9'), 1, { path: '' });
    const j = job(r, 'x', 1, 'success', 1, { head_sha: '', steps: [] });
    const [e] = toExecutions(r, [j]);
    expect(e).toMatchObject({ workflow: 'ci', sha: sha('9'), failedStep: null });
  });
});

describe('pairFlakes — every failed execution paired with the first pass after it on the same key', () => {
  it('finds the re-run pair, the cross-run pair and both failures of a twice-failed job; never the real failure', () => {
    const { runs, jobs } = fixture();
    const pairs = pairFlakes(execsOf(runs, jobs));
    expect(pairs.map((p: { failed: { runId: number, attempt: number, job: string }, passed: { runId: number, attempt: number } }) =>
      [p.failed.job, p.failed.runId, p.failed.attempt, p.passed.runId, p.passed.attempt])).toEqual([
      ['server 1/4', 1, 1, 1, 2],
      ['browser (pwa) 1/2', 5, 1, 5, 3],
      ['pwa 2/3', 2, 1, 3, 1],
      ['browser (pwa) 1/2', 5, 2, 5, 3],
    ]);
  });

  it('does not depend on the order the executions arrive in', () => {
    const { runs, jobs } = fixture();
    const execs = execsOf(runs, jobs);
    expect(pairFlakes([...execs].reverse())).toEqual(pairFlakes(execs));
  });

  it('reads a pass BEFORE a failure as no flake, and a cancelled or skipped attempt as neither side', () => {
    const r = run(20, 'merge_group', sha('1'), 3);
    const execs = toExecutions(r, [
      job(r, 'server 1/4', 1, 'success', 1),
      job(r, 'server 1/4', 2, 'failure', 10),
      job(r, 'server 1/4', 3, 'cancelled', 20),
    ]);
    expect(pairFlakes(execs)).toEqual([]);
    const r2 = run(21, 'merge_group', sha('2'), 3);
    const pairs = pairFlakes(toExecutions(r2, [
      job(r2, 'server 1/4', 1, 'failure', 1),
      job(r2, 'server 1/4', 2, 'cancelled', 10),
      job(r2, 'server 1/4', 3, 'success', 20),
    ]));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ failed: { attempt: 1 }, passed: { attempt: 3 } });
  });

  it('never pairs across shas, job names or workflows', () => {
    const a = run(30, 'pull_request', sha('3'), 1);
    const b = run(31, 'pull_request', sha('4'), 1);
    const c = run(32, 'pull_request', sha('3'), 1, { path: '.github/workflows/codeql.yml' });
    const execs = [
      ...toExecutions(a, [job(a, 'server 1/4', 1, 'failure', 1)]),
      ...toExecutions(b, [job(b, 'server 1/4', 1, 'success', 5)]),
      ...toExecutions(a, [job(a, 'server 2/4', 1, 'success', 5)]),
      ...toExecutions(c, [job(c, 'server 1/4', 1, 'success', 5)]),
    ];
    expect(pairFlakes(execs)).toEqual([]);
  });

  it('drops a job whose name matches an exclude pattern', () => {
    const { runs, jobs } = fixture();
    const pairs = pairFlakes(execsOf(runs, jobs), { exclude: [/^browser /] });
    expect(pairs.map((p: { failed: { job: string } }) => p.failed.job)).toEqual(['server 1/4', 'pwa 2/3']);
  });
});

describe('parseLogSignature', () => {
  const ts = '2026-11-10T10:01:02.1234567Z ';
  it('reads vitest\'s FAIL lines through the runner timestamps and colour codes, first one as the signature', () => {
    const log = [
      `${ts}> vitest run`,
      `${ts}\u001b[31m FAIL \u001b[39m test/ws-reap.test.ts > ws-reap > reaps an orphan 1203ms`,
      `${ts}AssertionError: expected 1 to be 2`,
      `${ts} FAIL  |server| test/lanes.test.ts > lane runner > ticks`,
      `${ts} FAIL  test/ws-reap.test.ts > ws-reap > reaps an orphan`,
      `${ts}##[error]Process completed with exit code 1.`,
    ].join('\n');
    expect(parseLogSignature(log)).toEqual({
      signature: 'test/ws-reap.test.ts > ws-reap > reaps an orphan',
      tests: ['test/ws-reap.test.ts > ws-reap > reaps an orphan', 'test/lanes.test.ts > lane runner > ticks'],
    });
  });

  it('names a whole failed file when vitest gives no test (a suite that failed to load)', () => {
    expect(parseLogSignature(`${ts} FAIL  test/boot.test.ts [ test/boot.test.ts ]`)).toEqual({
      signature: 'test/boot.test.ts', tests: ['test/boot.test.ts'],
    });
  });

  it('reads an unhandled error by its first error line, digits folded so one cause reads as one signature', () => {
    const log = [
      `${ts}⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯`,
      `${ts}`,
      `${ts}Vitest caught 1 unhandled error during the test run.`,
      `${ts}This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.`,
      `${ts}`,
      `${ts}⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯`,
      `${ts}Error: listen EADDRINUSE: address already in use 127.0.0.1:41234`,
      `${ts}⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯`,
      `${ts} Test Files  59 passed (59)`,
      `${ts}      Errors  1 error`,
    ].join('\n');
    expect(parseLogSignature(log)).toEqual({
      signature: 'unhandled: Error: listen EADDRINUSE: address already in use N.N.N.N:N', tests: [],
    });
  });

  it('lists the test file an unhandled error originated in, its digits kept, and keeps the cause alone as the signature', () => {
    const log = [
      `${ts}\u001b[31m⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯\u001b[39m`,
      `${ts}Vitest caught 1 unhandled error during the test run.`,
      `${ts}⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯`,
      `${ts}\u001b[31mEnvironmentTeardownError\u001b[39m: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`,
      `${ts}This error originated in "test/boot2.test.ts" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.`,
    ].join('\n');
    expect(parseLogSignature(log)).toEqual({
      signature: 'unhandled: EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending',
      tests: ['test/boot2.test.ts'],
    });
  });

  it('falls back to the first ##[error] line that is not the generic exit-code line', () => {
    const log = [
      `${ts}##[error]Process completed with exit code 1.`,
      `${ts}##[error]The operation was canceled.`,
      `${ts}##[error]npm ERR! code ECONNRESET`,
    ].join('\n');
    expect(parseLogSignature(log)).toEqual({ signature: 'error: npm ERR! code ECONNRESET', tests: [] });
  });

  it('answers null for a log with nothing it can name', () => {
    expect(parseLogSignature('')).toBeNull();
    expect(parseLogSignature(`${ts}##[error]Process completed with exit code 2.`)).toBeNull();
  });
});

describe('annotationSignature', () => {
  it('skips the generic annotations and names the first specific one with its path', () => {
    expect(annotationSignature([
      { path: '.github', message: 'Process completed with exit code 1.', annotation_level: 'failure' },
      { path: 'server/test/a.test.ts', message: 'AssertionError: expected 3 to be 4', annotation_level: 'failure' },
    ])).toBe('server/test/a.test.ts: AssertionError: expected N to be N');
  });

  it('answers null when only generic or notice annotations exist', () => {
    expect(annotationSignature([])).toBeNull();
    expect(annotationSignature([
      { path: '.github', message: 'The job was not acquired by Runner of type hosted even after multiple attempts', annotation_level: 'notice' },
      { path: '.github', message: 'Process completed with exit code 1.', annotation_level: 'failure' },
    ])).toBeNull();
  });
});

describe('summarize — top N by signature', () => {
  const row = (signature: string, job: string, date: string, runId: number) => ({ signature, job, date, failedRunId: runId, event: 'merge_group' });
  it('counts by signature, most first, ties broken by the newest date then the signature', () => {
    const rows = [
      row('t > a', 'server 1/4', '2026-11-09', 1), row('t > b', 'server 2/4', '2026-11-10', 2),
      row('t > a', 'server 3/4', '2026-11-10', 3), row('t > c', 'pwa 1/3', '2026-11-08', 4),
    ];
    expect(summarize(rows, 2)).toEqual([
      { signature: 't > a', count: 2, jobs: ['server 1/4', 'server 3/4'], events: ['merge_group'], firstDate: '2026-11-09', lastDate: '2026-11-10', runIds: [1, 3] },
      { signature: 't > b', count: 1, jobs: ['server 2/4'], events: ['merge_group'], firstDate: '2026-11-10', lastDate: '2026-11-10', runIds: [2] },
    ]);
  });
});

describe('daySlices and parseArgs', () => {
  it('lists every UTC day of the window, both ends included', () => {
    expect(daySlices('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(() => daySlices('2026-11-03', '2026-11-02')).toThrow(/since/);
    expect(() => daySlices('11/02/2026', '2026-11-02')).toThrow(/YYYY-MM-DD/);
  });

  it('defaults to the last seven days to today, both events, logs on, top 10', () => {
    const opt = parseArgs(['--repo', 'o/r'], new Date('2026-11-11T08:00:00Z'), {});
    expect(opt).toMatchObject({
      repo: 'o/r', since: '2026-11-05', until: '2026-11-11', events: ['merge_group', 'pull_request'], logs: true, top: 10,
    });
  });

  it('takes the repository from GITHUB_REPOSITORY, and refuses an unknown flag or event', () => {
    expect(parseArgs(['--days', '2', '--no-logs', '--top', '3', '--event', 'merge_group', '--exclude', '^test '], new Date('2026-11-11T08:00:00Z'), { GITHUB_REPOSITORY: 'o/x' }))
      .toMatchObject({ repo: 'o/x', since: '2026-11-10', until: '2026-11-11', logs: false, top: 3, events: ['merge_group'] });
    expect(() => parseArgs(['--bogus'], new Date(), {})).toThrow(/unknown/);
    expect(() => parseArgs(['--event', 'push'], new Date(), {})).toThrow(/event/);
  });
});

/** A reader over the fixture that records every call, so a row can pin what the pass asked for. */
function fakeIo(over: { log?: Record<number, string | null>, annotations?: Record<number, Annotation[]>, total?: number } = {}) {
  const { runs, jobs } = fixture();
  const calls: string[] = [];
  return {
    calls,
    jobs,
    io: {
      listRuns: async (event: string, day: string) => {
        calls.push(`runs ${event} ${day}`);
        const list = day === '2026-11-10' ? runs.filter((r) => r.event === event) : [];
        return { runs: list, total: over.total ?? list.length };
      },
      listJobs: async (runId: number) => { calls.push(`jobs ${runId}`); return jobs[runId] ?? []; },
      annotations: async (jobId: number): Promise<Annotation[]> => { calls.push(`annotations ${jobId}`); return over.annotations?.[jobId] ?? []; },
      jobLog: async (jobId: number) => { calls.push(`log ${jobId}`); return over.log?.[jobId] ?? null; },
    },
  };
}

describe('runLedger — the whole pass over an injected reader', () => {
  const opt = { events: ['merge_group', 'pull_request'], days: ['2026-11-10'], logs: true, exclude: [] as RegExp[] };

  it('lists jobs only for candidate runs and reads signatures only for the failed side of a pair', async () => {
    const f = fakeIo();
    const failedR1 = f.jobs[1]![0]!.id;
    f.io.jobLog = async (jobId: number) => { f.calls.push(`log ${jobId}`); return jobId === failedR1 ? ' FAIL  test/x.test.ts > a > b' : null; };
    const { rows, warnings } = await runLedger(f.io, opt);
    expect(warnings).toEqual([]);
    expect(f.calls.filter((c) => c.startsWith('jobs ')).sort()).toEqual(['jobs 1', 'jobs 2', 'jobs 3', 'jobs 5']);
    expect(f.calls.filter((c) => c.startsWith('log ')).length).toBe(4);
    expect(rows[0]).toEqual({
      date: '2026-11-10', event: 'merge_group', workflow: CI, job: 'server 1/4', sha: sha('a'),
      signature: 'test/x.test.ts > a > b', signatureSource: 'log', failingTests: ['test/x.test.ts > a > b'],
      failedRunId: 1, failedAttempt: 1, failedJobId: failedR1, failedConclusion: 'failure', failedAt: '2026-11-10T10:02:00Z',
      passedRunId: 1, passedAttempt: 2, passedJobId: f.jobs[1]![2]!.id, passedAt: '2026-11-10T10:21:00Z',
    });
  });

  it('falls back from the log to the annotations to the failed step, and skips logs when told to', async () => {
    const f = fakeIo();
    const r2Failed = f.jobs[2]![0]!.id;
    f.io.annotations = async (jobId: number) => (jobId === r2Failed ? [{ path: 'pwa/src/x.test.ts', message: 'boom', annotation_level: 'failure' }] : []);
    const { rows } = await runLedger(f.io, { ...opt, logs: false });
    expect(f.calls.some((c) => c.startsWith('log '))).toBe(false);
    const bySource = Object.fromEntries(rows.map((r: { job: string, signatureSource: string, signature: string }) => [r.job, [r.signatureSource, r.signature]]));
    expect(bySource['pwa 2/3']).toEqual(['annotation', 'pwa/src/x.test.ts: boom']);
    expect(bySource['server 1/4']).toEqual(['step', 'step: Run tests']);
  });

  it('warns when a day holds more runs than the listing can return', async () => {
    const f = fakeIo({ total: 1500 });
    const { warnings } = await runLedger(f.io, opt);
    expect(warnings.join('\n')).toMatch(/merge_group 2026-11-10: 1500 runs/);
  });
});

describe('ghIo — the one reader that talks to GitHub', () => {
  const page = (n: number, total: number) => ({ total_count: total, jobs: Array.from({ length: n }, (_, i) => ({ id: i })) });

  it('asks page after page with GETs only until a short page', async () => {
    const asked: string[][] = [];
    const io = ghIo({ repo: 'o/r', sleep: async () => {}, gh: (args: string[]) => {
      asked.push(args);
      return JSON.stringify(args[1]!.endsWith('page=1') ? page(50, 80) : page(30, 80));
    } });
    expect(await io.listJobs(9)).toHaveLength(80);
    expect(asked).toEqual([
      ['api', 'repos/o/r/actions/runs/9/jobs?filter=all&per_page=50&page=1'],
      ['api', 'repos/o/r/actions/runs/9/jobs?filter=all&per_page=50&page=2'],
    ]);
  });

  it('retries a server error twice with a growing pause, and gives up on the third', async () => {
    const pauses: number[] = [];
    let n = 0;
    const flaky = ghIo({ repo: 'o/r', sleep: async (ms: number) => { pauses.push(ms); }, gh: () => {
      n += 1;
      if (n === 1) throw new Error('gh: Server Error (HTTP 502)');
      if (n === 2) throw new Error('stream error: stream ID 1; CANCEL; received from peer');
      return JSON.stringify(page(1, 1));
    } });
    expect(await flaky.listJobs(9)).toHaveLength(1);
    expect(pauses).toEqual([2000, 4000]);
    const down = ghIo({ repo: 'o/r', sleep: async () => {}, gh: () => { throw new Error('gh: HTTP 503'); } });
    await expect(down.listJobs(9)).rejects.toThrow(/503/);
  });

  it('asks for a log with terminal escapes allowed, and asks again without the flag on a gh too old to know it', async () => {
    const asked: string[][] = [];
    const io = ghIo({ repo: 'o/r', sleep: async () => {}, gh: (args: string[]) => {
      asked.push(args);
      if (args.includes('--allow-escape-sequences')) throw new Error('unknown flag: --allow-escape-sequences');
      return ' FAIL  test/z.test.ts > q';
    } });
    expect(await io.jobLog(5)).toBe(' FAIL  test/z.test.ts > q');
    expect(asked).toEqual([
      ['api', 'repos/o/r/actions/jobs/5/logs', '--allow-escape-sequences'],
      ['api', 'repos/o/r/actions/jobs/5/logs'],
    ]);
  });

  it('never retries a client error, and reads a missing log or annotation list as none', async () => {
    let n = 0;
    const io = ghIo({ repo: 'o/r', sleep: async () => {}, gh: () => { n += 1; throw new Error('gh: Not Found (HTTP 404)'); } });
    await expect(io.listJobs(9)).rejects.toThrow(/404/);
    expect(n).toBe(1);
    expect(await io.jobLog(5)).toBeNull();
    expect(await io.annotations(5)).toEqual([]);
  });
});

describe('the CLI, against a fake gh on PATH', () => {
  function fakeGh(behaviour: 'ok' | 'fail') {
    const dir = mkTmp('flake-ledger-gh-');
    const { runs, jobs } = fixture();
    const routes: Record<string, unknown> = {};
    for (const event of ['merge_group', 'pull_request']) {
      const list = runs.filter((r) => r.event === event);
      routes[`repos/o/r/actions/runs?event=${event}&created=2026-11-10&per_page=100&page=1`] = { total_count: list.length, workflow_runs: list };
    }
    for (const [id, js] of Object.entries(jobs)) routes[`repos/o/r/actions/runs/${id}/jobs?filter=all&per_page=50&page=1`] = { total_count: js.length, jobs: js };
    const fixtures = path.join(dir, 'routes.json');
    writeFileSync(fixtures, JSON.stringify(routes));
    const gh = path.join(dir, 'gh');
    writeFileSync(gh, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(dir, 'calls.txt'))}, args.join(' ') + '\\n');
if (${JSON.stringify(behaviour)} === 'fail') { process.stderr.write('HTTP 502'); process.exit(1); }
const route = args.find((a) => a.startsWith('repos/'));
const routes = JSON.parse(fs.readFileSync(${JSON.stringify(fixtures)}, 'utf8'));
if (route in routes) { process.stdout.write(JSON.stringify(routes[route])); process.exit(0); }
if (/\\/annotations/.test(route)) { process.stdout.write('[]'); process.exit(0); }
if (/\\/logs$/.test(route)) { process.stdout.write(' FAIL  test/y.test.ts > flaky'); process.exit(0); }
process.stderr.write('no route ' + route); process.exit(1);
`);
    chmodSync(gh, 0o755);
    return dir;
  }
  const cli = (dir: string, args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}`, GITHUB_REPOSITORY: '' },
  });

  it('prints one JSON line per pair on stdout and the summary on stderr, read-only gh api calls only', () => {
    const dir = fakeGh('ok');
    const r = cli(dir, ['--repo', 'o/r', '--since', '2026-11-10', '--until', '2026-11-10', '--top', '1']);
    expect(r.status, r.stderr).toBe(0);
    const rows = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(4);
    expect(rows.every((x: { signature: string }) => x.signature === 'test/y.test.ts > flaky')).toBe(true);
    expect(r.stderr).toMatch(/4 flakes/);
    expect(r.stderr).toMatch(/ 4 {2}test\/y\.test\.ts > flaky/);
    const calls = readFileSync(path.join(dir, 'calls.txt'), 'utf8').trim().split('\n');
    expect(calls.every((c) => c.startsWith('api repos/o/r/'))).toBe(true);
    expect(calls.some((c) => /-X|--method|-f |--field|--input/.test(c))).toBe(false);
  });

  it('exits 1 when gh fails, and 2 on a usage error', () => {
    const dir = fakeGh('fail');
    expect(cli(dir, ['--repo', 'o/r', '--since', '2026-11-10', '--until', '2026-11-10']).status).toBe(1);
    expect(cli(dir, ['--nope']).status).toBe(2);
    expect(cli(dir, ['--since', '2026-11-10']).status).toBe(2); // no repository named anywhere
  });
});
