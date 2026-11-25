// A superseded merge-queue group's jobs end when they start (wave 1d, D-9015): `.github/ci/queue-live.mjs`'s two
// pure functions, its CLI end to end on a fixture remote and a stub `gh`, and the workflow's first step in every
// long job. Mutation tables: docs/superpowers/programs/landing-order/wave1d-task-4.md (1D-02 to 1D-05) and
// wave1f-task-3.md beside it (1F-08, 1F-09: the superseded code, 64, and the step that ends a job on it alone).
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { queueGroupFate, compareWord, SUPERSEDED_EXIT } from '../../.github/ci/queue-live.mjs';

afterAll(removeTmpFixtures);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, '.github', 'ci', 'queue-live.mjs');

type Branch = 'present' | 'absent' | 'unmeasured';
type OnMain = 'yes' | 'no' | 'unmeasured';
type Fate = 'live' | 'landed' | 'superseded' | 'unmeasured';

describe('queue-live: the pure decider (D-9015)', () => {
  it('decides a queue group fate from two reads, and only an absent branch off main is superseded', () => {
    const rows: Array<[Branch, OnMain, Fate]> = [
      ['present', 'yes', 'live'], ['present', 'no', 'live'], ['present', 'unmeasured', 'live'],
      ['absent', 'yes', 'landed'], ['absent', 'no', 'superseded'], ['absent', 'unmeasured', 'unmeasured'],
      ['unmeasured', 'yes', 'unmeasured'], ['unmeasured', 'no', 'unmeasured'], ['unmeasured', 'unmeasured', 'unmeasured'],
    ];
    for (const [branch, onMain, fate] of rows) expect(queueGroupFate({ branch, onMain }), `${branch}/${onMain}`).toBe(fate);
  });

  it('reads the compare status, and an unknown word is unmeasured', () => {
    expect(['ahead', 'identical'].map(compareWord)).toEqual(['yes', 'yes']);
    expect(['diverged', 'behind'].map(compareWord)).toEqual(['no', 'no']);
    expect([undefined, null, '', 'AHEAD', 7, {}].map(compareWord)).toEqual(Array(6).fill('unmeasured'));
  });
});

describe('queue-live: the script end to end, on a fixture remote and a stub gh', () => {
  const GIT_ID = ['-c', 'user.name=ccrc fixture', '-c', 'user.email=fixture@example.invalid'];
  const base = mkTmp('ccrc-queue-live-');
  const server = path.join(base, 'server');
  const remote = path.join(server, 'owner', 'repo');
  const work = path.join(base, 'work');
  mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  writeFileSync(path.join(work, 'f.txt'), 'one\n');
  execFileSync('git', ['add', '-A'], { cwd: work });
  execFileSync('git', [...GIT_ID, 'commit', '-q', '-m', 'one'], { cwd: work });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim();
  const liveRef = `refs/heads/gh-readonly-queue/main/pr-1-${sha}`;
  const goneRef = `refs/heads/gh-readonly-queue/main/pr-2-${sha}`;
  mkdirSync(path.dirname(remote), { recursive: true });
  execFileSync('git', ['clone', '-q', '--bare', work, remote]);
  execFileSync('git', ['update-ref', liveRef, sha], { cwd: remote });

  /** The one compare request the script may make (review F1): this repository, the group's commit then `main`, in
   *  that order, and the status field. Reversed, a landed commit reads `behind`, which is `superseded`. */
  const COMPARE_ARGV = ['api', `repos/owner/repo/compare/${sha}...main`, '--jq', '.status'];

  /** Runs the script with a stub `gh` first on PATH; the stub records its arguments, one per line, and answers as told. */
  function runLive(ref: string, gh: { status?: string; exit?: number }): { line: string; status: number | null; ghRan: boolean; ghArgv: string[] } {
    const dir = mkTmp('ccrc-queue-live-run-');
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const marker = path.join(dir, 'gh-ran');
    writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\n${gh.status === undefined ? '' : `echo '${gh.status}'\n`}exit ${gh.exit ?? 0}\n`);
    chmodSync(path.join(bin, 'gh'), 0o755);
    const r = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, HOME: dir,
        GITHUB_SERVER_URL: pathToFileURL(server).href, GITHUB_REPOSITORY: 'owner/repo', GITHUB_REF: ref, GITHUB_SHA: sha,
      },
    });
    const ghRan = existsSync(marker);
    return { line: r.stdout.split('\n')[0], status: r.status, ghRan, ghArgv: ghRan ? readFileSync(marker, 'utf8').split('\n').slice(0, -1) : [] };
  }

  it('live: the queue branch stands, the job runs and the compare is never asked', () => {
    const r = runLive(liveRef, { status: 'diverged' });
    expect(r.line).toBe('queue-live: live (branch present, on main not read)');
    expect(r.status).toBe(0);
    expect(r.ghRan, 'the stub gh ran for a present branch').toBe(false);
  });

  it('landed: the branch is gone and the commit is on main, the job runs', () => {
    const r = runLive(goneRef, { status: 'ahead' });
    expect(r.line).toBe('queue-live: landed (branch absent, on main yes)');
    expect(r.status).toBe(0);
    expect(r.ghArgv, 'the compare request').toEqual(COMPARE_ARGV);
  });

  it('superseded: the branch is gone and the commit is off main, the script exits SUPERSEDED_EXIT (64, D-9067)', () => {
    const r = runLive(goneRef, { status: 'diverged' });
    expect(r.line).toBe('queue-live: superseded (branch absent, on main no)');
    expect(r.status).toBe(64);
    expect(SUPERSEDED_EXIT).toBe(64);
    expect(r.ghArgv, 'the compare request').toEqual(COMPARE_ARGV);
  });

  /** The liveness step's own script, as the workflow carries it (job `deps`), run the way a runner runs a `run:`
   *  block: `bash --noprofile --norc -eo pipefail <file>`. The stub `gh` serves `source` as the fetched script and
   *  answers the compare with `status`. */
  function runStep(ref: string, source: string, status: string): { out: string; status: number | null } {
    const wf = parse(readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
      jobs: Record<string, { steps?: Array<{ name?: string; run?: string }> }>;
    };
    const step = wf.jobs['deps']?.steps?.[0];
    expect(step?.name, 'deps\'s first step').toBe('queue group still live');
    const dir = mkTmp('ccrc-queue-live-step-');
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(dir, 'served.mjs'), source);
    writeFileSync(path.join(dir, 'step.sh'), step!.run!);
    writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\ncase "$2" in\n  */contents/*) cat '${path.join(dir, 'served.mjs')}' ;;\n  *) echo '${status}' ;;\nesac\n`);
    chmodSync(path.join(bin, 'gh'), 0o755);
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', path.join(dir, 'step.sh')], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, HOME: dir, RUNNER_TEMP: dir,
        GITHUB_SERVER_URL: pathToFileURL(server).href, GITHUB_REPOSITORY: 'owner/repo', GITHUB_REF: ref, GITHUB_SHA: sha,
      },
    });
    return { out: r.stdout, status: r.status };
  }

  it('through the step\'s own lines: a superseded group still ends the job with exit 1 (D-9015 unchanged)', () => {
    const r = runStep(goneRef, readFileSync(SCRIPT, 'utf8'), 'diverged');
    expect(r.out).toContain('queue-live: superseded (branch absent, on main no)');
    expect(r.out).not.toContain('the script failed');
    expect(r.status).toBe(1);
  });

  it('through the step\'s own lines: a script that fails is not a superseded group, and the job runs (D-9067)', () => {
    // A script that throws at load exits 1, as wave 1d's script did on superseded: the step reads that as a failure.
    const r = runStep(goneRef, "throw new Error('x');\n", 'diverged');
    expect(r.out).toContain('queue-live: unmeasured (the script failed, exit 1)');
    expect(r.status).toBe(0);
  });

  it('unmeasured: the compare call fails, the job runs', () => {
    const r = runLive(goneRef, { exit: 1 });
    expect(r.line).toBe('queue-live: unmeasured (branch absent, on main unmeasured)');
    expect(r.status).toBe(0);
  });

  it('unmeasured: the remote cannot be read, the job runs and the compare is never asked', () => {
    // Contained (review F6): a poisoned gh is first on PATH and logs any call, so the real client is never reached.
    const home = mkTmp('ccrc-queue-live-home-');
    const r = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: ghContainedEnv(home, { PATH: process.env.PATH ?? '', HOME: home,
        GITHUB_SERVER_URL: pathToFileURL(path.join(base, 'nowhere')).href,
        GITHUB_REPOSITORY: 'owner/repo', GITHUB_REF: liveRef, GITHUB_SHA: sha }),
    });
    expect(r.stdout.split('\n')[0]).toBe('queue-live: unmeasured (branch unmeasured, on main not read)');
    expect(r.status).toBe(0);
    expect(existsSync(path.join(home, 'gh-poison')), 'a gh was asked').toBe(false);
  });
});

describe('queue-live: the workflow asks it first in every long job of a queue run', () => {
  const LONG_JOBS = ['deps', 'server-shard', 'server-typecheck', 'server-perf', 'mask-perf', 'test', 'pwa-shard',
    'pwa-static', 'build-pwa', 'browser-pwa', 'node-floor'];
  const STEP = 'queue group still live';

  it('every listed job carries the step first, whole, under the merge_group condition, and no other job carries it', () => {
    const wf = parse(readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
      jobs: Record<string, { env?: Record<string, string>; steps?: Array<Record<string, unknown>> }>;
    };
    const run = [
      `gh api "repos/$GITHUB_REPOSITORY/contents/.github/ci/queue-live.mjs" -H 'Accept: application/vnd.github.raw' > "$RUNNER_TEMP/queue-live.mjs" || { echo 'queue-live: unmeasured (the script could not be fetched)'; exit 0; }`,
      'node "$RUNNER_TEMP/queue-live.mjs" || { rc=$?; [ "$rc" -eq 64 ] && exit 1; echo "queue-live: unmeasured (the script failed, exit $rc)"; exit 0; }', '',
    ].join('\n');
    for (const id of LONG_JOBS) {
      // A job with a leg switch skips every step on a refresh or a rebuild (ci-pipeline.test.ts), this one included.
      const cond = wf.jobs[id]?.env?.CCRC_LEG === undefined
        ? "github.event_name == 'merge_group'" : "env.CCRC_LEG == 'run' && github.event_name == 'merge_group'";
      expect(wf.jobs[id]?.steps?.[0], `${id}'s first step`)
        .toEqual({ name: STEP, if: cond, env: { GH_TOKEN: '${{ github.token }}' }, run });
    }
    for (const [id, j] of Object.entries(wf.jobs)) {
      if (LONG_JOBS.includes(id)) continue;
      expect((j.steps ?? []).some((s) => s.name === STEP), `${id} carries ${STEP} but is not on the list`).toBe(false);
    }
    for (const id of LONG_JOBS) {
      expect((wf.jobs[id]?.steps ?? []).filter((s) => s.name === STEP), `${id} carries ${STEP} more than once`).toHaveLength(1);
    }
  });
});
