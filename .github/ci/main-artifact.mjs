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
//
// The second question this module answers (final review FR-1) is the stable gate's and the daily run's: does this
// commit already carry a GREEN `full-suite` from a run that tested this commit's own tree? Spec §8 names the
// sources — the daily run, a manual full run, or an earlier gate — and nothing else counts: a check run's name
// alone would also accept a `pull_request` run, whose checks attach to the pull request's head sha while it tested
// `refs/pull/N/merge`, a different tree. So the evidence is a workflow RUN, judged on its own fields
// (`isTrustedFullSuiteRun`), and one of its JOBS (`isGreenFullSuiteJob`); both are pure, and the
// `green-full-suite` subcommand only lists them. Unlike the picker, it has no safe answer to fall back on — a
// false `found=true` promotes unproven code, and a false `found=false` makes the gate run the whole suite — so any
// failure prints no answer at all and exits 1: the gate fails (and promotes nothing), and the daily run reads a
// failure as "not green" and runs.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TRUSTED_EVENTS = ['push', 'schedule', 'workflow_dispatch'];
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
export const RELEASE_STABLE_PATH = '.github/workflows/release-stable.yml';

/**
 * @typedef {{ id: number, name: string, expired: boolean, created_at: string,
 *   workflow_run?: { id: number, repository_id: number, head_repository_id: number, head_branch: string, head_sha: string } }} Artifact
 * @typedef {{ id: number, path: string, event: string, head_branch: string,
 *   repository?: { id: number }, head_repository?: { id: number } }} Run
 * @typedef {{ artifactId: number, runId: number, headSha: string, createdAt: string }} Picked
 * @typedef {{ id: number, path: string, event: string, head_branch: string, head_sha: string,
 *   repository?: { id: number }, head_repository?: { id: number } }} WorkflowRun
 * @typedef {{ name: string, conclusion: string | null }} Job
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

/** Whether `run` is one of the runs spec §8 accepts as full-suite evidence for `sha`: this repository's own run
 *  (base and head) of exactly that commit, and either `ci.yml` on `main` from the daily schedule or a manual
 *  dispatch, or `release-stable.yml` on a push to `stable` (the gate's own called full run, whose job is named
 *  `full / full-suite`). A `pull_request` run never is, whatever its head branch: it tested the merge ref.
 *  @param {WorkflowRun | null | undefined} run @param {number} repoId @param {string} sha @returns {boolean} */
export function isTrustedFullSuiteRun(run, repoId, sha) {
  return !!run
    && run.head_sha === sha
    && run.repository?.id === repoId
    && run.head_repository?.id === repoId
    && ((run.path === CI_WORKFLOW_PATH
        && (run.event === 'schedule' || run.event === 'workflow_dispatch')
        && run.head_branch === 'main')
      || (run.path === RELEASE_STABLE_PATH && run.event === 'push' && run.head_branch === 'stable'));
}

/** Whether `job` is a successful `full-suite` job — named `full-suite`, or `<caller job> / full-suite` when it ran
 *  inside a called workflow.
 *  @param {Job | null | undefined} job @returns {boolean} */
export function isGreenFullSuiteJob(job) {
  return !!job
    && job.conclusion === 'success'
    && typeof job.name === 'string'
    && (job.name === 'full-suite' || job.name.endsWith('/ full-suite'));
}

/** Whether any trusted run of `sha` among `runs` carries a green full-suite job (`jobsByRun`, keyed by run id).
 *  @param {{ runs: WorkflowRun[], jobsByRun: Record<string, Job[]>, repoId: number, sha: string }} args
 *  @returns {boolean} */
export function greenFullSuiteOn({ runs, jobsByRun, repoId, sha }) {
  return runs.some((run) => isTrustedFullSuiteRun(run, repoId, sha)
    && (jobsByRun[String(run.id)] ?? []).some((job) => isGreenFullSuiteJob(job)));
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

const PER_PAGE = 100;
const MAX_PAGES = 100;

/** Every item of a paginated listing (`route` already carries `per_page=100`), page after page until a short
 *  one. A response without the `key` array is malformed, and throws.
 *  @param {string} route @param {string} key @returns {Promise<unknown[]>} */
async function apiList(route, key) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await api(`${route}&page=${page}`);
    const items = body && typeof body === 'object' ? body[key] : undefined;
    if (!Array.isArray(items)) throw new Error(`GET ${route}&page=${page}: no ${key} array in the response`);
    out.push(...items);
    if (items.length < PER_PAGE) return out;
  }
  throw new Error(`GET ${route}: more than ${MAX_PAGES} pages`);
}

/** `green-full-suite --repo OWNER/NAME --repo-id ID --sha SHA`: prints exactly `found=true` or `found=false` on a
 *  decided answer and exits 0; on anything else — a missing argument, an API failure, a malformed response — it
 *  prints no answer and exits 1 (see the header).
 *  @param {string[]} argv */
async function greenFullSuiteCli(argv) {
  const opt = parseArgs(argv);
  const repo = opt.repo;
  const repoId = Number(opt['repo-id']);
  const sha = opt.sha;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !opt['repo-id'] || !Number.isInteger(repoId)
    || !sha || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error('usage: node main-artifact.mjs green-full-suite --repo OWNER/NAME --repo-id ID --sha SHA (a full 40-hex sha)');
  }
  const runs = await apiList(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=${PER_PAGE}`, 'workflow_runs');
  for (const run of runs) {
    if (!run || typeof run !== 'object' || !Number.isInteger(/** @type {{ id?: unknown }} */ (run).id)) {
      throw new Error('a workflow run in the listing has no numeric id');
    }
  }
  const trusted = /** @type {WorkflowRun[]} */ (runs).filter((run) => isTrustedFullSuiteRun(run, repoId, sha));
  /** @type {Record<string, Job[]>} */
  const jobsByRun = {};
  let found = false;
  for (const run of trusted) {
    const jobs = await apiList(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=${PER_PAGE}`, 'jobs');
    for (const job of jobs) {
      const j = /** @type {{ name?: unknown, conclusion?: unknown }} */ (job);
      if (!job || typeof job !== 'object' || typeof j.name !== 'string' || !(j.conclusion === null || typeof j.conclusion === 'string')) {
        throw new Error(`a job of run ${run.id} has no name or conclusion`);
      }
    }
    jobsByRun[String(run.id)] = /** @type {Job[]} */ (jobs);
    if (greenFullSuiteOn({ runs: [run], jobsByRun, repoId, sha })) {
      process.stderr.write(`green-full-suite: run ${run.id} (${run.path}, ${run.event} on ${run.head_branch}) has a green full-suite on ${sha}\n`);
      found = true;
      break;
    }
  }
  if (!found) process.stderr.write(`green-full-suite: ${trusted.length} trusted run(s) of ${sha}, none with a green full-suite\n`);
  process.stdout.write(`found=${found}\n`);
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
  if (process.argv[2] === 'green-full-suite') {
    greenFullSuiteCli(process.argv.slice(3)).catch((e) => {
      process.stderr.write(`main-artifact.mjs green-full-suite: ${e instanceof Error ? e.message : e}\n`);
      process.exitCode = 1;
    });
  } else {
    main().catch((e) => {
      process.stderr.write(`main-artifact.mjs: ${e instanceof Error ? e.message : e}\n`);
      process.exitCode = 2;
    });
  }
}
