// Where the test map and the duration table come from (design 2026-09-23 §5.5, operator's ruling T4): ONLY
// from an artifact a trusted run of `ci.yml` on `main` uploaded. Not from the Actions cache — a pull request's
// run reads its own cache scope first, so a PR could plant a map that selects nothing, and a manual rebuild on
// a feature branch would become that branch's PRs' baseline. An artifact is picked only when its run is on
// branch `main`, of this repository (not a fork that names a branch `main`), of `.github/workflows/ci.yml`, and
// triggered by `push`, `schedule` or `workflow_dispatch` — events only a merge or a maintainer can cause.
//
// The filtering is pure (`pickArtifact`, unit-tested); the CLI only fetches the two listings it needs from the
// REST API with the job's own token and writes the answer to `$GITHUB_OUTPUT`. Any API failure answers "none":
// no map means a full run, and a refresh that cannot confirm its base is still the newest does not publish —
// both the safe direction.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TRUSTED_EVENTS = ['push', 'schedule', 'workflow_dispatch'];
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';

/**
 * @typedef {{ id: number, name: string, expired: boolean, created_at: string,
 *   workflow_run?: { id: number, repository_id: number, head_repository_id: number, head_branch: string, head_sha: string } }} Artifact
 * @typedef {{ id: number, path: string, event: string, head_branch: string,
 *   repository?: { id: number }, head_repository?: { id: number } }} Run
 * @typedef {{ artifactId: number, runId: number, headSha: string, createdAt: string }} Picked
 */

/** The artifacts that could be trusted, judged on the artifact's own fields, newest first.
 *  @param {Artifact[]} artifacts @param {string} name @param {number} repoId @returns {Artifact[]} */
export function artifactCandidates(artifacts, name, repoId) {
  return artifacts
    .filter((a) => a.name === name && !a.expired && a.workflow_run
      && a.workflow_run.head_branch === 'main'
      && a.workflow_run.repository_id === repoId
      && a.workflow_run.head_repository_id === repoId)
    .sort((a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id));
}

/** Whether a run is one of this repository's own `ci.yml` runs on `main`, from a trusted event.
 *  @param {Run | undefined} run @param {number} repoId @returns {boolean} */
export function isTrustedRun(run, repoId) {
  return !!run
    && run.path === CI_WORKFLOW_PATH
    && run.head_branch === 'main'
    && TRUSTED_EVENTS.includes(run.event)
    && run.repository?.id === repoId
    && run.head_repository?.id === repoId;
}

/** The newest artifact named `name` whose run is trusted, or null.
 *  @param {{ artifacts: Artifact[], runs: Record<string, Run>, name: string, repoId: number }} args
 *  @returns {Picked | null} */
export function pickArtifact({ artifacts, runs, name, repoId }) {
  for (const a of artifactCandidates(artifacts, name, repoId)) {
    const run = runs[String(/** @type {NonNullable<Artifact['workflow_run']>} */ (a.workflow_run).id)];
    if (isTrustedRun(run, repoId)) {
      return {
        artifactId: a.id,
        runId: /** @type {NonNullable<Artifact['workflow_run']>} */ (a.workflow_run).id,
        headSha: /** @type {NonNullable<Artifact['workflow_run']>} */ (a.workflow_run).head_sha,
        createdAt: a.created_at,
      };
    }
  }
  return null;
}

async function api(route) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const res = await fetch(`${base}${route}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GET ${route}: HTTP ${res.status}`);
  return res.json();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const repo = opt.repo;
  const repoId = Number(opt['repo-id']);
  const name = opt.name;
  if (!repo || !name || !Number.isInteger(repoId)) {
    throw new Error('usage: node main-artifact.mjs --repo OWNER/NAME --repo-id ID --name ARTIFACT');
  }
  /** @type {Picked | null} */
  let picked = null;
  try {
    const listed = await api(`/repos/${repo}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
    /** @type {Record<string, Run>} */
    const runs = {};
    for (const a of artifactCandidates(listed.artifacts ?? [], name, repoId)) {
      const id = String(/** @type {NonNullable<Artifact['workflow_run']>} */ (a.workflow_run).id);
      if (!(id in runs)) runs[id] = await api(`/repos/${repo}/actions/runs/${id}`);
      picked = pickArtifact({ artifacts: [a], runs, name, repoId });
      if (picked) break;
    }
  } catch (e) {
    process.stdout.write(`::warning::main-artifact: no ${name} artifact read (${e instanceof Error ? e.message : e}); answering none\n`);
    picked = null;
  }
  const lines = [
    `artifact_id=${picked ? picked.artifactId : ''}`,
    `run_id=${picked ? picked.runId : ''}`,
    `head_sha=${picked ? picked.headSha : ''}`,
  ];
  // The answer goes to stdout always (map-build's check before it publishes reads it there) and to $GITHUB_OUTPUT when
  // the step has one.
  process.stdout.write(picked ? `${name}: artifact ${picked.artifactId} of run ${picked.runId} (${picked.headSha})\n` : `${name}: none\n`);
  process.stdout.write(lines.join('\n') + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    process.stderr.write(`main-artifact.mjs: ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 2;
  });
}
