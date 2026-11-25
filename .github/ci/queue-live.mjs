// A SUPERSEDED MERGE-QUEUE GROUP'S JOBS END WHEN THEY START (wave 1d, D-9015).
//
// When the merge queue rebuilds or removes a group, the run it started for that group keeps queuing jobs, and
// each one takes a runner the live groups behind it are waiting for. So under `merge_group` each long job of
// ci.yml asks THIS script first whether its group still stands, from two reads:
//   1. the queue branch (`GITHUB_REF`, `refs/heads/gh-readonly-queue/main/pr-<n>-<sha>`), by
//      `git ls-remote --exit-code`: exit 0 is `present`, exit 2 is `absent`, anything else is `unmeasured`;
//   2. only when the branch is absent, whether the group's commit is on `main`, by one compare call
//      (`gh api repos/<repository>/compare/<sha>...main --jq .status`): `ahead`/`identical` is `yes`,
//      `diverged`/`behind` is `no`, anything else is `unmeasured`.
// A present branch is `live` whatever the second read would say. An absent branch is `landed` when the commit is
// on `main` (the queue deletes the branch after a merge while advisory legs may still start) and `superseded`
// when it is not. Every other pair is `unmeasured`, and the job runs: fail open.
//
// The script prints one line, `queue-live: <fate> (branch <word>, on main <word>)`, and exits 1 only on
// `superseded`. It cancels nothing and needs no permission beyond the job's own read-only token: a job already
// running when its group is superseded runs to its end, which is the residual the plan names.
//
// The workflow fetches this one file from the default branch before any checkout, never from the group's own
// commit (a superseded group's commit may no longer be served), so it depends on Node's built-ins alone.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** A child process's deadline, in milliseconds; a deadline passed is `unmeasured`. */
const CHILD_DEADLINE_MS = 30_000;

/**
 * @typedef {'present' | 'absent' | 'unmeasured'} BranchWord
 * @typedef {'yes' | 'no' | 'unmeasured'} OnMainWord
 * @typedef {'live' | 'landed' | 'superseded' | 'unmeasured'} QueueFate
 */

/**
 * A queue group's fate from its two reads. Pure.
 * @param {{ branch: BranchWord, onMain: OnMainWord }} read
 * @returns {QueueFate}
 */
export function queueGroupFate(read) {
  if (read.branch === 'present') return 'live';
  if (read.branch === 'absent' && read.onMain === 'yes') return 'landed';
  if (read.branch === 'absent' && read.onMain === 'no') return 'superseded';
  return 'unmeasured';
}

/**
 * GitHub's compare status of `<group sha>...main`, as the second read's word. Pure.
 * @param {unknown} status
 * @returns {OnMainWord}
 */
export function compareWord(status) {
  if (status === 'ahead' || status === 'identical') return 'yes';
  if (status === 'diverged' || status === 'behind') return 'no';
  return 'unmeasured';
}

/**
 * Runs one child process under the deadline.
 * @param {string} cmd @param {string[]} args
 * @returns {{ status: number | null, stdout: string }}
 */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: CHILD_DEADLINE_MS, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { status: null, stdout: '' };
  return { status: r.status, stdout: r.stdout ?? '' };
}

/** @param {NodeJS.ProcessEnv} env @returns {BranchWord} */
function readBranch(env) {
  const server = env.GITHUB_SERVER_URL ?? '';
  const repository = env.GITHUB_REPOSITORY ?? '';
  const ref = env.GITHUB_REF ?? '';
  if (!server || !repository || !ref.startsWith('refs/heads/')) return 'unmeasured';
  const r = run('git', ['ls-remote', '--exit-code', `${server.replace(/\/+$/, '')}/${repository}`, ref]);
  if (r.status === 0) return 'present';
  if (r.status === 2) return 'absent';
  return 'unmeasured';
}

/** @param {NodeJS.ProcessEnv} env @returns {OnMainWord} */
function readOnMain(env) {
  const repository = env.GITHUB_REPOSITORY ?? '';
  const sha = env.GITHUB_SHA ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(sha)) return 'unmeasured';
  const r = run('gh', ['api', `repos/${repository}/compare/${sha}...main`, '--jq', '.status']);
  if (r.status !== 0) return 'unmeasured';
  return compareWord(r.stdout.trim());
}

function main() {
  /** @type {BranchWord} */
  let branch = 'unmeasured';
  /** @type {OnMainWord} */
  let onMain = 'unmeasured';
  try {
    branch = readBranch(process.env);
    if (branch === 'absent') onMain = readOnMain(process.env);
  } catch { /* an unmeasured read lets the job run */ }
  const fate = queueGroupFate({ branch, onMain });
  const onMainShown = branch === 'absent' ? onMain : 'not read';
  console.log(`queue-live: ${fate} (branch ${branch}, on main ${onMainShown})`);
  if (fate === 'superseded') {
    console.log('::notice::queue-live: this group was superseded in the merge queue; the job ends here and its run is read by nothing');
    process.exit(1);
  }
}

const entry = process.argv[1] ?? '';
if (entry && decodeURIComponent(new URL(import.meta.url).pathname) === entry) main();
