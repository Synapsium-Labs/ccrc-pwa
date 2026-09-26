// `.github/ci/main-artifact.mjs` (design 2026-09-23 §5.5, operator's ruling T4): the map and the duration table
// come ONLY from an artifact of a trusted `ci.yml` run on `main`. The picker is pure and is tested here on
// fixture listings shaped like the REST API's (`GET /repos/{r}/actions/artifacts`, `GET …/actions/runs/{id}`);
// the CLI is run once against a local fake of that API, so the fetch-and-pick path is exercised as shipped.
//
// The same module answers the stable gate's and the daily run's question (final review FR-1): does this commit
// carry a green `full-suite` from a run that tested THIS commit's tree? Only the sources spec §8 names count — the
// daily run or a manual full run of `ci.yml` on `main`, or an earlier stable gate's called run — never a
// `pull_request` run, whose checks attach to the PR's head sha while it tested `refs/pull/N/merge`, another tree.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  artifactCandidates, isTrustedRun, pickArtifact, isTrustedFullSuiteRun, isGreenFullSuiteJob, greenFullSuiteOn,
} from '../../.github/ci/main-artifact.mjs';
import type { Artifact, Run, WorkflowRun, Job } from '../../.github/ci/main-artifact.mjs';

const REPO_ID = 1001;
const FORK_ID = 2002;

function artifact(id: number, runId: number, over: Partial<Artifact> & { branch?: string, headRepo?: number } = {}): Artifact {
  return {
    id, name: over.name ?? 'testmap', expired: over.expired ?? false, created_at: over.created_at ?? `2026-09-${String(10 + id).padStart(2, '0')}T00:00:00Z`,
    workflow_run: { id: runId, repository_id: REPO_ID, head_repository_id: over.headRepo ?? REPO_ID, head_branch: over.branch ?? 'main', head_sha: `${runId}`.padStart(40, '0') },
  };
}
function run(id: number, over: Partial<Run> & { headRepo?: number } = {}): Run {
  return {
    id, path: over.path ?? '.github/workflows/ci.yml', event: over.event ?? 'push', head_branch: over.head_branch ?? 'main',
    repository: { id: REPO_ID }, head_repository: { id: over.headRepo ?? REPO_ID },
  };
}

describe('pickArtifact: the newest artifact of a trusted main run', () => {
  it('picks the newest candidate whose run is trusted', () => {
    const artifacts = [artifact(1, 11), artifact(2, 12), artifact(3, 13)];
    const runs = { 11: run(11), 12: run(12, { event: 'schedule' }), 13: run(13, { event: 'workflow_dispatch' }) };
    expect(pickArtifact({ artifacts, runs, name: 'testmap', repoId: REPO_ID })).toEqual({
      artifactId: 3, runId: 13, headSha: '13'.padStart(40, '0'), createdAt: '2026-09-13T00:00:00Z',
    });
  });

  it('skips a run from a pull request, even one whose branch is named main', () => {
    const artifacts = [artifact(1, 11), artifact(2, 12)];
    const runs = { 11: run(11), 12: run(12, { event: 'pull_request' }) };
    expect(pickArtifact({ artifacts, runs, name: 'testmap', repoId: REPO_ID })?.artifactId).toBe(1);
  });

  it('skips a fork (another head repository), another branch, another workflow, an expired artifact, another name', () => {
    const runs = { 11: run(11), 12: run(12, { headRepo: FORK_ID }), 13: run(13, { head_branch: 'feature' }), 14: run(14, { path: '.github/workflows/other.yml' }), 15: run(15), 16: run(16) };
    const artifacts = [
      artifact(1, 11),
      artifact(2, 12, { headRepo: FORK_ID }),
      artifact(3, 13, { branch: 'feature' }),
      artifact(4, 14),
      artifact(5, 15, { expired: true }),
      artifact(6, 16, { name: 'testtimes' }),
    ];
    expect(pickArtifact({ artifacts, runs, name: 'testmap', repoId: REPO_ID })?.artifactId).toBe(1);
    // A forked run can name its branch `main`; the head repository is what tells it apart. And the run's own
    // fields are checked, not only the artifact's copy of them.
    expect(isTrustedRun(run(12, { headRepo: FORK_ID }), REPO_ID)).toBe(false);
    expect(isTrustedRun(run(13, { head_branch: 'feature' }), REPO_ID)).toBe(false);
    expect(isTrustedRun(run(11), REPO_ID)).toBe(true);
    expect(artifactCandidates(artifacts, 'testmap', REPO_ID).map((a) => a.id)).toEqual([4, 1]);
  });

  it('answers null when nothing is trusted, or the run is unknown', () => {
    expect(pickArtifact({ artifacts: [artifact(1, 11)], runs: {}, name: 'testmap', repoId: REPO_ID })).toBeNull();
    expect(pickArtifact({ artifacts: [], runs: {}, name: 'testmap', repoId: REPO_ID })).toBeNull();
  });
});

describe('the CLI, against a local fake of the REST API', () => {
  const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'main-artifact.mjs');

  async function withApi(routes: Record<string, unknown>, fn: (base: string) => Promise<void>): Promise<void> {
    const server = createServer((req, res) => {
      const body = routes[req.url ?? ''];
      if (req.headers.authorization !== 'Bearer t0ken' || body === undefined) { res.statusCode = 404; res.end('{}'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.close();
    }
  }

  const cli = (base: string) => promisify(execFile)(process.execPath, [CLI, '--repo', 'o/r', '--repo-id', String(REPO_ID), '--name', 'testmap'], {
    env: { ...process.env, GITHUB_API_URL: base, GITHUB_TOKEN: 't0ken', GITHUB_OUTPUT: '' },
  });

  it('prints the picked artifact, run and sha', async () => {
    await withApi({
      '/repos/o/r/actions/artifacts?name=testmap&per_page=100': { artifacts: [artifact(2, 12), artifact(1, 11)] },
      '/repos/o/r/actions/runs/12': run(12, { event: 'pull_request' }),
      '/repos/o/r/actions/runs/11': run(11),
    }, async (base) => {
      const { stdout } = await cli(base);
      expect(stdout).toContain(`artifact_id=1\nrun_id=11\nhead_sha=${'11'.padStart(40, '0')}\n`);
    });
  });

  it('an API failure answers none (no map means a full run), and exits 0', async () => {
    await withApi({}, async (base) => {
      const { stdout } = await cli(base);
      expect(stdout).toContain('artifact_id=\nrun_id=\nhead_sha=\n');
      expect(stdout).toContain('::warning::');
    });
  });
});

// ── the green full-suite question (final review FR-1) ─────────────────────────
const SHA = 'c'.repeat(40);
function wfRun(id: number, over: Partial<WorkflowRun> & { headRepo?: number, repoId?: number } = {}): WorkflowRun {
  return {
    id, path: over.path ?? '.github/workflows/ci.yml', event: over.event ?? 'schedule', head_branch: over.head_branch ?? 'main',
    head_sha: over.head_sha ?? SHA, repository: { id: over.repoId ?? REPO_ID }, head_repository: { id: over.headRepo ?? REPO_ID },
  };
}
const job = (name: string, conclusion: string | null = 'success'): Job => ({ name, conclusion });
/** Whether `run`, carrying exactly `jobs`, is evidence of a green full suite on SHA. */
const evidence = (run: WorkflowRun, jobs: Job[]): boolean =>
  greenFullSuiteOn({ runs: [run], jobsByRun: { [String(run.id)]: jobs }, repoId: REPO_ID, sha: SHA });

describe('isTrustedFullSuiteRun / isGreenFullSuiteJob / greenFullSuiteOn: only the sources spec §8 names', () => {
  it('the daily run on main, a manual full run on main, and an earlier stable gate count', () => {
    expect(evidence(wfRun(1, { event: 'schedule' }), [job('test (server)'), job('full-suite')])).toBe(true);
    expect(evidence(wfRun(2, { event: 'workflow_dispatch' }), [job('full-suite')])).toBe(true);
    // A job inside a called workflow is named `<caller job> / <called job>`: release-stable's `full` calls ci.yml.
    expect(evidence(wfRun(3, { path: '.github/workflows/release-stable.yml', event: 'push', head_branch: 'stable' }),
      [job('gate'), job('full / full-suite')])).toBe(true);
  });

  it('a pull_request run never counts — its checks sit on the head sha, but it tested the merge ref', () => {
    // Even one whose head branch is `main` (a pull request FROM main), on this repository, in full mode.
    expect(isTrustedFullSuiteRun(wfRun(4, { event: 'pull_request' }), REPO_ID, SHA)).toBe(false);
    expect(evidence(wfRun(4, { event: 'pull_request' }), [job('full-suite')])).toBe(false);
  });

  it('a push to main (a refresh), a dispatch on a feature branch, or a release-stable run off stable does not count', () => {
    expect(evidence(wfRun(5, { event: 'push' }), [job('full-suite')])).toBe(false);
    expect(evidence(wfRun(6, { event: 'workflow_dispatch', head_branch: 'feature' }), [job('full-suite')])).toBe(false);
    expect(evidence(wfRun(7, { event: 'schedule', head_branch: 'stable' }), [job('full-suite')])).toBe(false);
    expect(evidence(wfRun(8, { path: '.github/workflows/release-stable.yml', event: 'push', head_branch: 'main' }), [job('full / full-suite')])).toBe(false);
    expect(evidence(wfRun(9, { path: '.github/workflows/release-stable.yml', event: 'workflow_dispatch', head_branch: 'stable' }), [job('full / full-suite')])).toBe(false);
    expect(evidence(wfRun(10, { path: '.github/workflows/release-stable.yml', event: 'schedule', head_branch: 'main' }), [job('full / full-suite')])).toBe(false);
    expect(evidence(wfRun(11, { path: '.github/workflows/other.yml' }), [job('full-suite')])).toBe(false);
  });

  it('a fork, another repository, or another commit does not count', () => {
    expect(evidence(wfRun(12, { headRepo: FORK_ID }), [job('full-suite')])).toBe(false);
    expect(evidence(wfRun(13, { repoId: FORK_ID }), [job('full-suite')])).toBe(false);
    expect(evidence(wfRun(14, { head_sha: 'd'.repeat(40) }), [job('full-suite')])).toBe(false);
  });

  it('only a SUCCESSFUL full-suite job counts — not a failed, skipped or cancelled one, nor any other green job', () => {
    for (const conclusion of ['failure', 'skipped', 'cancelled', 'neutral', null]) {
      expect(evidence(wfRun(15), [job('full-suite', conclusion)]), String(conclusion)).toBe(false);
    }
    expect(evidence(wfRun(16), [job('test (server)'), job('select tests'), job('build-pwa')])).toBe(false);
    expect(evidence(wfRun(17), [job('x / full-suite')])).toBe(true);
    expect(evidence(wfRun(18), [job('full-suite-ish'), job('not-full-suite'), job('full-suite / x')])).toBe(false);
    expect(isGreenFullSuiteJob(job('full-suite'))).toBe(true);
    expect(isGreenFullSuiteJob(job('x / full-suite', 'failure'))).toBe(false);
  });

  it('greenFullSuiteOn: any trusted run with a green full-suite answers true; jobs are read per run', () => {
    const runs = [wfRun(20, { event: 'pull_request' }), wfRun(21, { event: 'schedule' })];
    expect(greenFullSuiteOn({ runs, jobsByRun: { 20: [job('full-suite')], 21: [job('full-suite', 'failure')] }, repoId: REPO_ID, sha: SHA })).toBe(false);
    expect(greenFullSuiteOn({ runs, jobsByRun: { 20: [], 21: [job('full-suite')] }, repoId: REPO_ID, sha: SHA })).toBe(true);
    expect(greenFullSuiteOn({ runs, jobsByRun: {}, repoId: REPO_ID, sha: SHA })).toBe(false);
    expect(greenFullSuiteOn({ runs: [], jobsByRun: {}, repoId: REPO_ID, sha: SHA })).toBe(false);
  });
});

describe('the green-full-suite CLI, against a local fake of the REST API', () => {
  const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'main-artifact.mjs');
  type Answer = { status: number, stdout: string, stderr: string };

  /** A fake API that answers each route with its JSON, and 500 on any route it does not know. */
  async function withApi(routes: Record<string, unknown>, fn: (base: string) => Promise<void>): Promise<void> {
    const server = createServer((req, res) => {
      const body = routes[req.url ?? ''];
      if (req.headers.authorization !== 'Bearer t0ken' || body === undefined) { res.statusCode = 500; res.end('{}'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.close();
    }
  }

  const cli = async (base: string, args = ['green-full-suite', '--repo', 'o/r', '--repo-id', String(REPO_ID), '--sha', SHA]): Promise<Answer> => {
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, ...args], {
        env: { ...process.env, GITHUB_API_URL: base, GITHUB_TOKEN: 't0ken', GITHUB_OUTPUT: '' },
      });
      return { status: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number, stdout?: string, stderr?: string };
      return { status: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  };
  const runsRoute = (page: number) => `/repos/o/r/actions/runs?head_sha=${SHA}&per_page=100&page=${page}`;
  const jobsRoute = (id: number, page: number) => `/repos/o/r/actions/runs/${id}/jobs?per_page=100&page=${page}`;

  it('found=true: a trusted run with a green full-suite — found past the first page of runs and of jobs', async () => {
    // 100 pull_request runs fill page 1 (never asked for their jobs); the daily run is on page 2, and its
    // full-suite job on its jobs' page 2.
    const prRuns = Array.from({ length: 100 }, (_, i) => wfRun(1000 + i, { event: 'pull_request' }));
    await withApi({
      [runsRoute(1)]: { total_count: 101, workflow_runs: prRuns },
      [runsRoute(2)]: { total_count: 101, workflow_runs: [wfRun(77)] },
      [jobsRoute(77, 1)]: { total_count: 101, jobs: Array.from({ length: 100 }, (_, i) => job(`leg ${i}`)) },
      [jobsRoute(77, 2)]: { total_count: 101, jobs: [job('full-suite')] },
    }, async (base) => {
      const r = await cli(base);
      expect(r).toMatchObject({ status: 0, stdout: 'found=true\n' });
    });
  });

  it('found=false: only untrusted or red evidence', async () => {
    await withApi({
      [runsRoute(1)]: { total_count: 2, workflow_runs: [wfRun(5, { event: 'pull_request' }), wfRun(6)] },
      [jobsRoute(6, 1)]: { total_count: 1, jobs: [job('full-suite', 'failure')] },
    }, async (base) => {
      const r = await cli(base);
      expect(r).toMatchObject({ status: 0, stdout: 'found=false\n' });
    });
  });

  it('an API failure, a malformed response or a missing argument: exit 1 and no found= line', async () => {
    await withApi({}, async (base) => {
      const r = await cli(base);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toMatch(/found=/);
      expect(r.stderr).toContain('HTTP 500');
    });
    // The runs listing answers, a trusted run's jobs listing fails.
    await withApi({ [runsRoute(1)]: { total_count: 1, workflow_runs: [wfRun(6)] } }, async (base) => {
      const r = await cli(base);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toMatch(/found=/);
    });
    for (const body of ['{not json', { total_count: 1 }, { workflow_runs: [null] }, { workflow_runs: [{ ...wfRun(6), id: 'x' }] }]) {
      await withApi({ [runsRoute(1)]: body }, async (base) => {
        const r = await cli(base);
        expect(r.status, JSON.stringify(body)).toBe(1);
        expect(r.stdout).not.toMatch(/found=/);
      });
    }
    await withApi({ [runsRoute(1)]: { workflow_runs: [wfRun(6)] }, [jobsRoute(6, 1)]: { jobs: [{ conclusion: 'success' }] } }, async (base) => {
      const r = await cli(base);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toMatch(/found=/);
    });
    for (const args of [
      ['green-full-suite', '--repo', 'o/r', '--repo-id', String(REPO_ID)],
      ['green-full-suite', '--repo', 'o/r', '--sha', SHA],
      ['green-full-suite', '--repo-id', String(REPO_ID), '--sha', SHA],
      ['green-full-suite', '--repo', 'o/r', '--repo-id', String(REPO_ID), '--sha', 'HEAD'],
    ]) {
      await withApi({}, async (base) => {
        const r = await cli(base, args);
        expect(r.status, args.join(' ')).toBe(1);
        expect(r.stdout).not.toMatch(/found=/);
      });
    }
  });

  it('the picker\'s own usage is unchanged', async () => {
    await withApi({}, async (base) => {
      const r = await cli(base, ['--repo', 'o/r', '--repo-id', String(REPO_ID), '--name', 'testmap']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('artifact_id=\nrun_id=\nhead_sha=\n');
    });
  });
});
