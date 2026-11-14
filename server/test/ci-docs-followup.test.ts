// `.github/ci/docs-followup.mjs` (D-8396, the operator's approval of 2026-11-12): a pull request push whose every file
// changed since the PR's newest head with a passing `ci.yml` run is documentation skips the heavy PR jobs, while every
// required check still reports. The path list, the baseline pick and the decision are pure and tested on fixtures
// shaped like the REST API's `GET /repos/{r}/actions/workflows/ci.yml/runs`; the CLI runs once against a local fake of
// that API and a real git repository, so the fetch-diff-answer path is exercised as shipped. Every doubt answers
// `docs_followup=false`, which runs everything: a first push, a failed lookup, a force-push, a mixed change, an empty one.
import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { mkTmp } from './tmpHelpers.js';
import {
  FOLLOWUP_DOCS_PATTERNS, isFollowUpDocsFile, followUpDocsOnly, baselineCandidates, decideFollowUp,
} from '../../.github/ci/docs-followup.mjs';
import type { FollowUpRun, FollowUpContext, FollowUpGit } from '../../.github/ci/docs-followup.mjs';

const REPO_ID = 1001;
const FORK_ID = 2002;
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'docs-followup.mjs');
const sha = (n: number): string => n.toString(16).padStart(40, '0');

function wfRun(id: number, over: Partial<FollowUpRun> = {}): FollowUpRun {
  return {
    id, path: '.github/workflows/ci.yml', event: 'pull_request', status: 'completed', conclusion: 'success',
    head_branch: 'feat', head_sha: sha(id), created_at: `2026-11-${String(10 + (id % 10)).padStart(2, '0')}T00:00:00Z`,
    repository: { id: REPO_ID }, head_repository: { id: REPO_ID }, pull_requests: [{ number: 7 }],
    ...over,
  };
}
const CTX: FollowUpContext = { repoId: REPO_ID, runId: 999, pr: 7, headSha: sha(500), headRef: 'feat', headRepoId: REPO_ID };

describe('the docs-only list (D-8396): docs/** and a root *.md, defined once', () => {
  it('names exactly docs/** and *.md (root only: a `*` never crosses a slash)', () => {
    expect([...FOLLOWUP_DOCS_PATTERNS]).toEqual(['docs/**', '*.md']);
  });

  it('admits a file under docs/ and a Markdown file at the root', () => {
    for (const f of ['docs/a.md', 'docs/superpowers/plans/2026-11-12-x.md', 'docs/design/img.png', 'README.md', 'CLAUDE.md', 'CONTRIBUTING.md']) {
      expect(isFollowUpDocsFile(f), f).toBe(true);
    }
  });

  it('refuses Markdown inside a code directory, code anywhere, and an infrastructure file under docs/', () => {
    for (const f of [
      'ccd/skills/coordinator/SKILL.md', 'server/README.md', 'pwa/src/x.md', '.github/PULL_REQUEST_TEMPLATE.md',
      'server/src/a.ts', 'install.sh', 'LICENSE', 'README.mdx', 'docs', 'xdocs/a.md', 'docs/package.json',
      'docs/tsconfig.json', '',
    ]) {
      expect(isFollowUpDocsFile(f), f).toBe(false);
    }
  });

  it('a change is docs-only when it is non-empty and every file is on the list', () => {
    expect(followUpDocsOnly(['docs/a.md', 'README.md'])).toBe(true);
    expect(followUpDocsOnly(['docs/a.md', 'server/src/a.ts'])).toBe(false);
    expect(followUpDocsOnly([])).toBe(false);
    expect(followUpDocsOnly(['', '  '])).toBe(false);
  });
});

describe('baselineCandidates: this pull request\'s own passing ci.yml runs, newest first', () => {
  it('keeps a passing pull_request run of this branch and repository, and orders newest first', () => {
    const got = baselineCandidates([wfRun(1), wfRun(3), wfRun(2)], CTX).map((r) => r.id);
    expect(got).toEqual([3, 2, 1]);
  });

  it('drops this run, another workflow, another event, a run not passing, another branch or head repository, and a malformed sha', () => {
    const runs = [
      wfRun(999), wfRun(11, { path: '.github/workflows/macos.yml' }), wfRun(12, { event: 'merge_group' }),
      wfRun(13, { conclusion: 'failure' }), wfRun(14, { status: 'in_progress', conclusion: null }),
      wfRun(15, { head_branch: 'other' }), wfRun(16, { head_repository: { id: FORK_ID } }),
      wfRun(17, { repository: { id: FORK_ID } }), wfRun(18, { head_sha: 'abc' }),
      wfRun(19, { pull_requests: [{ number: 8 }] }),
    ];
    expect(baselineCandidates(runs, CTX)).toEqual([]);
  });

  it('a fork\'s run lists no pull request: it is kept on its branch and head repository alone', () => {
    const ctx = { ...CTX, headRepoId: FORK_ID };
    expect(baselineCandidates([wfRun(5, { head_repository: { id: FORK_ID }, pull_requests: [] })], ctx).map((r) => r.id)).toEqual([5]);
  });
});

/** A git double: `ancestors` are the shas that are ancestors of the head; `diffs[base]` the files base..head changed. */
function fakeGit(ancestors: string[], diffs: Record<string, string[]>): FollowUpGit {
  return {
    isAncestor: (a) => ancestors.includes(a),
    changed: (a) => { const d = diffs[a]; if (!d) throw new Error(`no diff from ${a}`); return d; },
  };
}

describe('decideFollowUp: skip only a docs-only change since this PR\'s newest passing head', () => {
  const base = { event: 'pull_request', fullLabel: 'false', ctx: CTX };

  it('a docs-only change since the newest passing head: true, naming that head and run', () => {
    const d = decideFollowUp({ ...base, runs: [wfRun(2), wfRun(1)], git: fakeGit([sha(2), sha(1)], { [sha(2)]: ['docs/a.md', 'README.md'] }) });
    expect(d).toMatchObject({ followup: true, base: sha(2), runId: 2 });
  });

  it('a code file since that head: false, naming the file', () => {
    const d = decideFollowUp({ ...base, runs: [wfRun(2)], git: fakeGit([sha(2)], { [sha(2)]: ['docs/a.md', 'server/src/a.ts'] }) });
    expect(d.followup).toBe(false);
    expect(d.why).toContain('server/src/a.ts');
  });

  it('a first push (no passing run of this PR): false', () => {
    expect(decideFollowUp({ ...base, runs: [], git: fakeGit([], {}) }).followup).toBe(false);
    expect(decideFollowUp({ ...base, runs: [wfRun(2, { conclusion: 'failure' })], git: fakeGit([sha(2)], { [sha(2)]: ['docs/a.md'] }) }).followup).toBe(false);
  });

  it('a force-push: the newest passing head that is still an ancestor is the baseline; none, false', () => {
    const git = fakeGit([sha(1)], { [sha(1)]: ['docs/a.md'], [sha(2)]: ['docs/a.md'] });
    expect(decideFollowUp({ ...base, runs: [wfRun(2), wfRun(1)], git })).toMatchObject({ followup: true, base: sha(1) });
    expect(decideFollowUp({ ...base, runs: [wfRun(2)], git: fakeGit([], { [sha(2)]: ['docs/a.md'] }) }).followup).toBe(false);
  });

  it('the same head that already passed (an empty change): false, as an empty change is never docs-only', () => {
    const ctx = { ...CTX, headSha: sha(2) };
    expect(decideFollowUp({ ...base, ctx, runs: [wfRun(2)], git: fakeGit([sha(2)], { [sha(2)]: [] }) }).followup).toBe(false);
  });

  it('never on another event, under the full-ci label or a train/ head, or without a head sha', () => {
    const runs = [wfRun(2)];
    const git = fakeGit([sha(2)], { [sha(2)]: ['docs/a.md'] });
    for (const event of ['merge_group', 'workflow_dispatch', 'schedule', 'push', '']) {
      expect(decideFollowUp({ ...base, event, runs, git }).followup, event).toBe(false);
    }
    expect(decideFollowUp({ ...base, fullLabel: 'true', runs, git }).followup).toBe(false);
    expect(decideFollowUp({ ...base, ctx: { ...CTX, headSha: '' }, runs, git }).followup).toBe(false);
  });

  it('a diff that throws: false (the fail-safe direction)', () => {
    const git: FollowUpGit = { isAncestor: () => true, changed: () => { throw new Error('bad object'); } };
    const d = decideFollowUp({ ...base, runs: [wfRun(2)], git });
    expect(d.followup).toBe(false);
    expect(d.why).toContain('bad object');
  });
});

describe('the CLI, against a local fake of the REST API and a real git repository', () => {
  const gitEnv = (cwd: string): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? '', HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
  const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8', env: gitEnv(cwd) });
  const commit = (repo: string, files: Record<string, string>, msg: string): string => {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(path.join(repo, path.dirname(f)), { recursive: true });
      writeFileSync(path.join(repo, f), body);
    }
    git(repo, 'add', ...Object.keys(files));
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg);
    return git(repo, 'rev-parse', 'HEAD').trim();
  };

  /** A repository with: base (code) -> passed (code) -> docs (docs/ and README.md) -> code (server/). */
  function repo(): { dir: string, passed: string, docs: string, code: string } {
    const dir = mkTmp('ccrc-docs-followup-');
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, { 'server/src/a.ts': 'export const a = 1;\n' }, 'base');
    const passed = commit(dir, { 'server/src/a.ts': 'export const a = 2;\n' }, 'passed');
    const docs = commit(dir, { 'docs/x.md': '# x\n', 'README.md': '# r\n' }, 'docs');
    const code = commit(dir, { 'server/src/a.ts': 'export const a = 3;\n' }, 'code');
    return { dir, passed, docs, code };
  }

  async function withApi(routes: Record<string, unknown>, fn: (base: string, asked: string[]) => Promise<void>): Promise<void> {
    const asked: string[] = [];
    const server = createServer((req, res) => {
      asked.push(req.url ?? '');
      const body = routes[req.url ?? ''];
      if (req.headers.authorization !== 'Bearer t0ken' || body === undefined) { res.statusCode = 500; res.end('{}'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked);
    } finally {
      server.close();
    }
  }

  const route = '/repos/o/r/actions/workflows/ci.yml/runs?event=pull_request&branch=feat&status=success&per_page=30';

  async function cli(apiBase: string, dir: string, head: string, extra: string[] = []): Promise<{ out: string, stdout: string }> {
    const out = path.join(dir, '..', `${path.basename(dir)}-out.txt`);
    writeFileSync(out, '');
    const { stdout } = await promisify(execFile)(process.execPath, [CLI,
      '--repo', 'o/r', '--repo-id', String(REPO_ID), '--run-id', '999', '--pr', '7', '--event', 'pull_request',
      '--head-sha', head, '--head-ref', 'feat', '--head-repo-id', String(REPO_ID), '--full-label', 'false', '--checkout', dir, ...extra,
    ], { env: { ...gitEnv(dir), GITHUB_API_URL: apiBase, GITHUB_TOKEN: 't0ken', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '' } });
    return { out: readFileSync(out, 'utf8'), stdout };
  }

  it('docs-only since the passing head: docs_followup=true, from one API call', async () => {
    const r = repo();
    await withApi({ [route]: { total_count: 1, workflow_runs: [wfRun(41, { head_sha: r.passed })] } }, async (base, asked) => {
      const { out, stdout } = await cli(base, r.dir, r.docs);
      expect(out).toBe('docs_followup=true\n');
      expect(stdout).toContain(r.passed);
      expect(asked).toEqual([route]);
    });
  });

  it('a code change since the passing head: docs_followup=false', async () => {
    const r = repo();
    await withApi({ [route]: { total_count: 1, workflow_runs: [wfRun(41, { head_sha: r.passed })] } }, async (base) => {
      expect((await cli(base, r.dir, r.code)).out).toBe('docs_followup=false\n');
    });
  });

  it('a passing head that is not in the history (force-pushed away): docs_followup=false', async () => {
    const r = repo();
    await withApi({ [route]: { total_count: 1, workflow_runs: [wfRun(41, { head_sha: sha(0xdead) })] } }, async (base) => {
      expect((await cli(base, r.dir, r.docs)).out).toBe('docs_followup=false\n');
    });
  });

  it('a failed lookup or a malformed answer: docs_followup=false, and the CLI still exits 0', async () => {
    const r = repo();
    await withApi({}, async (base) => {
      const { out, stdout } = await cli(base, r.dir, r.docs);
      expect(out).toBe('docs_followup=false\n');
      expect(stdout).toContain('::warning::');
    });
    await withApi({ [route]: { total_count: 1 } }, async (base) => {
      expect((await cli(base, r.dir, r.docs)).out).toBe('docs_followup=false\n');
    });
  });

  it('a merge-queue run never asks the API and answers false', async () => {
    const r = repo();
    await withApi({ [route]: { total_count: 1, workflow_runs: [wfRun(41, { head_sha: r.passed })] } }, async (base, asked) => {
      const { out } = await cli(base, r.dir, r.docs, ['--event', 'merge_group']);
      expect(out).toBe('docs_followup=false\n');
      expect(asked).toEqual([]);
    });
  });
});
