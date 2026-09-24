// `.github/ci/main-artifact.mjs` (design 2026-09-23 §5.5, operator's ruling T4): the map and the duration table
// come ONLY from an artifact of a trusted `ci.yml` run on `main`. The picker is pure and is tested here on
// fixture listings shaped like the REST API's (`GET /repos/{r}/actions/artifacts`, `GET …/actions/runs/{id}`);
// the CLI is run once against a local fake of that API, so the fetch-and-pick path is exercised as shipped.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { artifactCandidates, isTrustedRun, pickArtifact } from '../../.github/ci/main-artifact.mjs';
import type { Artifact, Run } from '../../.github/ci/main-artifact.mjs';

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
