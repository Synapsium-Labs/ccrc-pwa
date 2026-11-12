// A DOCS-ONLY FOLLOW-UP PUSH SKIPS THE HEAVY PULL-REQUEST JOBS (D-8396, the operator's approval of 2026-11-12).
//
// A pull request whose newest passing `ci.yml` run tested head A, and whose new head B differs from A only in
// documentation, has nothing new for the server shards, the pwa shards, the static pwa checks, Storybook or the node
// floor to see. So the `select` job asks THIS module once per pull-request run, and every heavy job reads its answer
// (`docs_followup`) and short-circuits: the server jobs by a job-level `if:`, the pwa shards and static checks by
// step, so the required check names (`test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`) all still report
// success. The merge queue ALWAYS runs everything; it never asks.
//
// The rule, in order; every doubt answers `false`, which runs everything (the safe direction):
//   1. only a `pull_request`, and never under the `full-ci` label or a `train/` head (`--full-label true`);
//   2. the baseline is the NEWEST run of `ci.yml` for this pull request (its branch and head repository; its
//      number too when the run lists one, which a fork's never does) that completed with conclusion `success`,
//      other than this run, whose head is an ancestor of this head (a force-push leaves the older heads behind);
//      no such run (a first push, every earlier run red) is `false`;
//   3. the change from that head to this one (`git diff --name-only --no-renames`) must be non-empty and every file
//      on FOLLOWUP_DOCS_PATTERNS (and no infrastructure file: select-tests.mjs `infraTrigger`); an empty change (a
//      reopen, the same head again) is never docs-only.
// A baseline that was itself a skipped follow-up is sound: two docs-only steps make a docs-only change.
//
// The list is WIDER than reach.mjs `docsOnly` (D-7868), which admits docs/ alone because about 40 server suites read
// the root Markdown files: here the head before already passed every PR check over its code, and the merge queue runs
// every suite over the result, so a root `.md` that breaks a server suite reds the queue entry, not main. A pull
// request that changes the pipeline (`.github/`) never gets here: ci.yml asks only when its plain-bash pipeline step
// answered unchanged, so a change to this module is never judged by itself.
//
// One REST call (`GET …/actions/workflows/ci.yml/runs`, one page of 30, 30 s at most) with the job's own read-only token. The
// answer is `docs_followup=true|false`, appended to `$GITHUB_OUTPUT` exactly once, and the CLI always exits 0.
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { infraTrigger } from './select-tests.mjs';
import { CI_WORKFLOW_PATH } from './main-artifact.mjs';

/** THE docs-only list for a follow-up push (D-8396): every file under docs/, and a Markdown file at the repository's
 *  root. A `*` never crosses a `/`, so `*.md` is the root alone: Markdown inside a code directory (a ccd skill, a
 *  package README) is read by that code and is not on the list. A path no pattern names is not docs. */
export const FOLLOWUP_DOCS_PATTERNS = Object.freeze(['docs/**', '*.md']);

/** @param {string} pattern @returns {RegExp} */
function globRe(pattern) {
  const body = pattern.split(/(\*\*|\*)/).map((part) => (part === '**' ? '.+' : part === '*' ? '[^/]+'
    : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(`^${body}$`);
}
const FOLLOWUP_DOCS_RES = FOLLOWUP_DOCS_PATTERNS.map(globRe);

/** Whether `p` (repo-relative, POSIX) is a documentation file a follow-up may change without a PR run.
 *  @param {string} p @returns {boolean} */
export function isFollowUpDocsFile(p) {
  return typeof p === 'string' && p !== '' && FOLLOWUP_DOCS_RES.some((re) => re.test(p)) && infraTrigger(p) === null;
}

/** A non-empty change whose every file is on the list. @param {string[]} changed @returns {boolean} */
export function followUpDocsOnly(changed) {
  const files = changed.map((f) => f.trim()).filter(Boolean);
  return files.length > 0 && files.every(isFollowUpDocsFile);
}

/**
 * @typedef {{ id: number, path: string, event: string, status: string, conclusion: string | null, head_branch: string,
 *   head_sha: string, created_at: string, repository?: { id: number }, head_repository?: { id: number },
 *   pull_requests?: Array<{ number: number }> }} FollowUpRun
 * @typedef {{ repoId: number, runId: number, pr: number, headSha: string, headRef: string, headRepoId: number }} FollowUpContext
 * @typedef {{ isAncestor: (sha: string) => boolean, changed: (sha: string) => string[] }} FollowUpGit
 * @typedef {{ followup: boolean, why: string, base?: string, runId?: number }} FollowUpDecision
 */

/** This pull request's passing `ci.yml` runs other than this one, newest first.
 *  @param {FollowUpRun[]} runs @param {FollowUpContext} ctx @returns {FollowUpRun[]} */
export function baselineCandidates(runs, ctx) {
  return runs
    .filter((r) => !!r && Number.isInteger(r.id) && r.id !== ctx.runId
      && r.path === CI_WORKFLOW_PATH && r.event === 'pull_request'
      && r.status === 'completed' && r.conclusion === 'success'
      && r.head_branch === ctx.headRef
      && r.repository?.id === ctx.repoId && r.head_repository?.id === ctx.headRepoId
      && typeof r.head_sha === 'string' && /^[0-9a-f]{40}$/.test(r.head_sha)
      && (!Array.isArray(r.pull_requests) || r.pull_requests.length === 0 || r.pull_requests.some((p) => p?.number === ctx.pr)))
    .sort((a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : b.id - a.id));
}

/** The decision (the header's rule). A throw from `git` is `false` with its message.
 *  @param {{ event: string, fullLabel: string, runs: FollowUpRun[], ctx: FollowUpContext, git: FollowUpGit }} args
 *  @returns {FollowUpDecision} */
export function decideFollowUp({ event, fullLabel, runs, ctx, git }) {
  if (event !== 'pull_request') return { followup: false, why: `a ${event || '(no event)'} run is never a follow-up: everything runs` };
  if (fullLabel === 'true') return { followup: false, why: 'the full-ci label or a train/ head asks for every check' };
  if (!/^[0-9a-f]{40}$/.test(ctx.headSha ?? '')) return { followup: false, why: 'no head sha to diff to' };
  const candidates = baselineCandidates(runs, ctx);
  if (candidates.length === 0) return { followup: false, why: 'no earlier passing run of this pull request (a first push, or every run before was red)' };
  try {
    const base = candidates.find((r) => git.isAncestor(r.head_sha));
    if (!base) return { followup: false, why: 'no passing head of this pull request is an ancestor of this one (a force-push)' };
    const changed = git.changed(base.head_sha).map((f) => f.trim()).filter(Boolean);
    const at = { base: base.head_sha, runId: base.id };
    if (changed.length === 0) return { followup: false, why: `nothing changed since ${base.head_sha} (run ${base.id}): an empty change is never docs-only`, ...at };
    const code = changed.find((f) => !isFollowUpDocsFile(f));
    if (code !== undefined) return { followup: false, why: `${code} changed since ${base.head_sha} (run ${base.id}) and is not documentation`, ...at };
    return { followup: true, why: `every file changed since ${base.head_sha} (run ${base.id}, passing) is documentation: ${changed.join(', ')}`, ...at };
  } catch (e) {
    return { followup: false, why: `could not diff against the passing head (${e instanceof Error ? e.message : e})` };
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) if (argv[i]?.startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

/** The pull request's passing runs of ci.yml: one page, newest first. @returns {Promise<FollowUpRun[]>} */
async function listRuns(repo, headRef) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const route = `/repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&branch=${encodeURIComponent(headRef)}&status=success&per_page=30`;
  const res = await fetch(`${base}${route}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    // A stalled API answers nothing after 30 s: everything runs, and select never waits out its own deadline.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GET ${route}: HTTP ${res.status}`);
  const body = await res.json();
  const runs = body && typeof body === 'object' ? body.workflow_runs : undefined;
  if (!Array.isArray(runs)) throw new Error(`GET ${route}: no workflow_runs array in the response`);
  return runs;
}

/** @param {string} dir @param {string} head @returns {FollowUpGit} */
function realGit(dir, head) {
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    isAncestor: (sha) => {
      try { git('merge-base', '--is-ancestor', sha, head); return true; } catch { return false; }
    },
    changed: (sha) => git('diff', '--name-only', '--no-renames', sha, head).split('\n'),
  };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const event = opt.event ?? '';
  const fullLabel = opt['full-label'] ?? '';
  const ctx = {
    repoId: Number(opt['repo-id']), runId: Number(opt['run-id']), pr: Number(opt.pr),
    headSha: opt['head-sha'] ?? '', headRef: opt['head-ref'] ?? '', headRepoId: Number(opt['head-repo-id']),
  };
  /** @type {FollowUpDecision} */
  let d;
  try {
    if (event !== 'pull_request' || fullLabel === 'true') {
      // Answered without a lookup: the queue, the daily run and a dispatch never ask the API.
      d = decideFollowUp({ event, fullLabel, runs: [], ctx, git: { isAncestor: () => false, changed: () => [] } });
    } else if (!/^[\w.-]+\/[\w.-]+$/.test(opt.repo ?? '') || !Number.isInteger(ctx.repoId) || !Number.isInteger(ctx.runId)
      || !Number.isInteger(ctx.pr) || !Number.isInteger(ctx.headRepoId) || !ctx.headRef || !/^[0-9a-f]{40}$/.test(ctx.headSha)) {
      d = { followup: false, why: 'missing or malformed arguments; everything runs' };
      console.log(`::warning::docs-followup: ${d.why}`);
    } else {
      const runs = await listRuns(/** @type {string} */ (opt.repo), ctx.headRef);
      d = decideFollowUp({ event, fullLabel, runs, ctx, git: realGit(opt.checkout ?? process.cwd(), ctx.headSha) });
    }
  } catch (e) {
    d = { followup: false, why: `could not look up this pull request's passing runs (${e instanceof Error ? e.message : e}); everything runs` };
    console.log(`::warning::docs-followup: ${d.why}`);
  }
  console.log(`docs-only follow-up: ${d.followup} — ${d.why}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Docs-only follow-up (D-8396):** ${d.followup} — ${d.why}\n`); } catch { /* the summary is a courtesy */ }
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_followup=${d.followup}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
