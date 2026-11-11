// The flake ledger (D-8268). A flake is a job that FAILED and then PASSED on the same head sha: a re-run attempt of
// one workflow run, or a second run of the same workflow on that sha. Nothing in the tree changed between the two, so
// the failure was not the code's. Over a window of days this reads the repository's `merge_group` and `pull_request`
// workflow runs through `gh api` (read-only GETs, paginated by hand), lists the jobs of every attempt of each run that
// could hold such a pair, and writes one ledger row per failed execution that a later pass on the same key (workflow
// path, job name, head sha) answered:
//
//   { date, event, workflow, job, sha, signature, signatureSource, failingTests,
//     failedRunId, failedAttempt, failedJobId, failedConclusion, failedAt,
//     passedRunId, passedAttempt, passedJobId, passedAt }
//
// A job that failed twice and then passed is two rows (both failures were flakes); a failure no pass followed is no
// row (it may be a real failure); a pass followed by a failure is no row; `cancelled` and `skipped` attempts are
// neither side. `timed_out` counts as a failure.
//
// The signature names WHAT failed, from the cheapest source that answers: the failed job's log (vitest's `FAIL` lines,
// then an unhandled error's first line, then the first specific `##[error]` line; skipped by `--no-logs`), then the
// job's check-run annotations, then the name of the step that failed (`step: <name>`). Digits in an error line are
// folded to `N` so one cause reads as one signature; test names keep theirs. A log or annotation that cannot be read
// (an expired log, say) falls through to the next source and never fails the pass.
//
// Run it (any machine with `gh` signed in; the token needs only read access to Actions):
//
//   node .github/ci/flake-ledger.mjs --repo OWNER/NAME [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--days N]
//     [--event merge_group|pull_request]... [--exclude <job-name regex>]... [--no-logs] [--top N]
//     [--out ledger.jsonl] [--summary-out top.json]
//
// The repository defaults to `$GITHUB_REPOSITORY`; the window to the seven UTC days ending today (`--days N` sets its
// length, `--until` its last day, `--since` its first). Rows go to stdout as JSON lines (or to `--out`); the top-N
// summary by signature goes to stderr as text (and to `--summary-out` as JSON). Exit 0 on a finished pass, 1 when a
// listing could not be read (a server error is asked again twice first), 2 on a usage error. A summary job that fails because a shard failed is its own row with
// its own signature; `--exclude` drops such jobs by name (in ci.yml, `--exclude '^test \('` drops the `test (server)`
// and `test (pwa)` verdicts and keeps the shards that failed under them).
//
// The merge-queue keeper can call it on its own schedule (say `--days 1 --out <its state dir>/flakes-<day>.jsonl`)
// and read the summary JSON; nothing in this repository calls it. It is deliberately NOT a workflow or a required
// check: adding either is an operator's ruling. Runs are listed one UTC day at a time because GitHub returns at most
// 1000 runs for a filtered listing; a day holding more is reported as a warning, never silently cut. A pair whose two
// runs were created on either side of the window's edge is missed.
//
// Pure parts (`toExecutions`, `candidateRuns`, `pairFlakes`, `parseLogSignature`, `annotationSignature`,
// `summarize`, `daySlices`, `parseArgs`) and the pass over an injected reader (`runLedger`) are unit-tested offline in
// server/test/ci-flake-ledger.test.ts, with the CLI run once against a fake `gh`; `ghIo` is the only code that talks to
// GitHub.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EVENTS = Object.freeze(['merge_group', 'pull_request']);
const FAILED = new Set(['failure', 'timed_out']);
const PASSED = 'success';
const PER_PAGE = 100;
/** Jobs come back with their steps, and a 100-job page of a re-run run took GitHub close to its own timeout (a
 *  502, or a cancelled stream); 50 a page answers in a few seconds. */
const JOBS_PER_PAGE = 50;
/** GitHub's cap on a filtered workflow-run listing. */
const LISTING_CAP = 1000;
const MAX_SIGNATURE = 240;
const MAX_TESTS = 10;

/**
 * @typedef {{ id: number, name?: string, path?: string, event: string, head_sha: string, run_attempt?: number,
 *   created_at?: string }} Run
 * @typedef {{ name: string, number?: number, conclusion: string | null }} Step
 * @typedef {{ id: number, run_id?: number, run_attempt?: number, name: string, conclusion: string | null,
 *   started_at: string | null, completed_at: string | null, head_sha?: string, steps?: Step[] }} Job
 * @typedef {{ runId: number, attempt: number, jobId: number, event: string, workflow: string, job: string, sha: string,
 *   conclusion: string, startedAt: string, completedAt: string, failedStep: string | null }} Execution
 * @typedef {{ failed: Execution, passed: Execution }} Pair
 * @typedef {{ path?: string, message?: string, annotation_level?: string }} Annotation
 * @typedef {{ signature: string, tests: string[] }} LogSignature
 * @typedef {{ date: string, event: string, workflow: string, job: string, sha: string, signature: string,
 *   signatureSource: 'log' | 'annotation' | 'step' | 'none', failingTests: string[],
 *   failedRunId: number, failedAttempt: number, failedJobId: number, failedConclusion: string, failedAt: string,
 *   passedRunId: number, passedAttempt: number, passedJobId: number, passedAt: string }} LedgerRow
 * @typedef {{ signature: string, count: number, jobs: string[], events: string[], firstDate: string,
 *   lastDate: string, runIds: number[] }} SummaryLine
 * @typedef {{ listRuns: (event: string, day: string) => Promise<{ runs: Run[], total: number }>,
 *   listJobs: (runId: number) => Promise<Job[]>, annotations: (jobId: number) => Promise<Annotation[]>,
 *   jobLog: (jobId: number) => Promise<string | null> }} Io
 */

/** One execution per job of a run (every attempt, as `filter=all` lists them).
 *  @param {Run} run @param {Job[]} jobs @returns {Execution[]} */
export function toExecutions(run, jobs) {
  return jobs.map((j) => ({
    runId: run.id,
    attempt: j.run_attempt ?? run.run_attempt ?? 1,
    jobId: j.id,
    event: run.event,
    workflow: run.path || run.name || '',
    job: j.name,
    sha: j.head_sha || run.head_sha,
    conclusion: j.conclusion ?? '',
    startedAt: j.started_at ?? '',
    completedAt: j.completed_at ?? '',
    failedStep: (j.steps ?? []).find((s) => s.conclusion !== null && FAILED.has(s.conclusion))?.name ?? null,
  }));
}

/** The runs worth listing jobs for: a run that was re-run (attempt > 1), and every run of a (workflow, sha) that ran
 *  more than once. A lone first attempt can hold no pair, and skipping it saves one listing per run.
 *  @param {Run[]} runs @returns {Run[]} */
export function candidateRuns(runs) {
  /** @type {Map<string, Run[]>} */
  const bySha = new Map();
  for (const r of runs) {
    const k = `${r.path || r.name || ''}\0${r.head_sha}`;
    bySha.set(k, [...(bySha.get(k) ?? []), r]);
  }
  return runs.filter((r) => (r.run_attempt ?? 1) > 1 || (bySha.get(`${r.path || r.name || ''}\0${r.head_sha}`)?.length ?? 0) > 1);
}

/** @param {Execution} a @param {Execution} b */
function byTime(a, b) {
  const ta = a.startedAt || a.completedAt;
  const tb = b.startedAt || b.completedAt;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.runId - b.runId || a.attempt - b.attempt || a.jobId - b.jobId;
}

/**
 * Every failed execution paired with the first pass after it on the same (workflow, job, sha). Pure; the input order
 * does not matter. Pairs come back oldest failure first.
 * @param {Execution[]} executions @param {{ exclude?: RegExp[] }} [opt] @returns {Pair[]}
 */
export function pairFlakes(executions, opt = {}) {
  const exclude = opt.exclude ?? [];
  /** @type {Map<string, Execution[]>} */
  const groups = new Map();
  for (const e of executions) {
    if (exclude.some((re) => re.test(e.job))) continue;
    if (!FAILED.has(e.conclusion) && e.conclusion !== PASSED) continue;
    const k = `${e.workflow}\0${e.job}\0${e.sha}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  /** @type {Pair[]} */
  const pairs = [];
  for (const group of groups.values()) {
    /** @type {Execution[]} */
    let pending = [];
    for (const e of [...group].sort(byTime)) {
      if (FAILED.has(e.conclusion)) pending.push(e);
      else {
        for (const failed of pending) pairs.push({ failed, passed: e });
        pending = [];
      }
    }
  }
  return pairs.sort((a, b) => {
    const ta = a.failed.completedAt || a.failed.startedAt;
    const tb = b.failed.completedAt || b.failed.startedAt;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.failed.runId - b.failed.runId || a.failed.attempt - b.failed.attempt || a.failed.jobId - b.failed.jobId;
  });
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const RUNNER_STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
const VITEST_FAIL = /^\s*FAIL\s+(?:\|[^|]+\|\s+)?(\S+\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s+\[[^\]]*\])?(?:\s+>\s+(.+?))?\s*$/;
const DURATION = /\s+\d+(?:\.\d+)?ms$/;
/** The first line of an error vitest reports below its "Unhandled Errors" banner: `TypeError: …`, `Error: …`. */
const UNHANDLED_ERROR = /^\s*(?:[A-Z]\w*)?(?:Error|Exception)\b/;
const ORIGINATED = /originated in "([^"]+)" test file/;
const GENERIC = /^(?:Process completed with exit code \d+\.?|The operation was canceled\.?|The job was canceled\.?)$/;

/** @param {string} s */
const clip = (s) => (s.length > MAX_SIGNATURE ? `${s.slice(0, MAX_SIGNATURE - 1)}…` : s);
/** Digits folded, whitespace collapsed: one cause reads as one signature. @param {string} s */
const fold = (s) => clip(s.replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim());

/**
 * What a failed job's log says failed, or null. vitest's `FAIL` lines first (the first one is the signature, every
 * distinct one up to ten is listed), then the first error line below an "Unhandled Errors" banner (listing the
 * test file vitest says it originated in), then the first `##[error]` line that is not the generic exit-code or cancel line.
 * @param {string} log @returns {LogSignature | null}
 */
export function parseLogSignature(log) {
  const lines = log.split(/\r?\n/).map((l) => l.replace(ANSI, '').replace(RUNNER_STAMP, ''));
  /** @type {string[]} */
  const tests = [];
  for (const l of lines) {
    const m = VITEST_FAIL.exec(l);
    if (!m) continue;
    const name = clip(m[2] ? `${m[1]} > ${m[2].replace(DURATION, '').trim()}` : /** @type {string} */ (m[1]));
    if (!tests.includes(name) && tests.length < MAX_TESTS) tests.push(name);
  }
  if (tests.length > 0) return { signature: /** @type {string} */ (tests[0]), tests };
  const banner = lines.findIndex((l) => /Unhandled (?:Errors?|Rejections?)\b/.test(l));
  if (banner >= 0) {
    const after = lines.slice(banner + 1);
    const at = after.findIndex((l) => UNHANDLED_ERROR.test(l));
    if (at >= 0) {
      const origin = after.slice(at + 1, at + 4).map((l) => ORIGINATED.exec(l)?.[1]).find(Boolean);
      // The cause is the signature, so one teardown race in many files reads as one line of the summary; the file
      // vitest names goes in `tests`.
      return { signature: clip(`unhandled: ${fold(/** @type {string} */ (after[at]))}`), tests: origin ? [origin] : [] };
    }
  }
  for (const l of lines) {
    const m = /##\[error\](.*)$/.exec(l);
    const msg = m?.[1]?.trim();
    if (msg && !GENERIC.test(msg)) return { signature: `error: ${fold(msg)}`, tests: [] };
  }
  return null;
}

/** The first failure annotation that is not the generic exit-code or cancel line, as `<path>: <message>`.
 *  @param {Annotation[]} annotations @returns {string | null} */
export function annotationSignature(annotations) {
  for (const a of annotations) {
    if (a.annotation_level !== 'failure') continue;
    const msg = (a.message ?? '').split('\n')[0]?.trim() ?? '';
    if (!msg || GENERIC.test(msg)) continue;
    const where = a.path && a.path !== '.github' ? `${a.path}: ` : '';
    return clip(`${where}${fold(msg)}`);
  }
  return null;
}

/**
 * The top `top` signatures by count; ties go to the newest last date, then the signature.
 * @param {Array<Pick<LedgerRow, 'signature' | 'job' | 'date' | 'failedRunId' | 'event'>>} rows @param {number} top
 * @returns {SummaryLine[]}
 */
export function summarize(rows, top) {
  /** @type {Map<string, SummaryLine>} */
  const by = new Map();
  for (const r of rows) {
    const s = by.get(r.signature) ?? { signature: r.signature, count: 0, jobs: [], events: [], firstDate: r.date, lastDate: r.date, runIds: [] };
    s.count += 1;
    if (!s.jobs.includes(r.job)) s.jobs.push(r.job);
    if (!s.events.includes(r.event)) s.events.push(r.event);
    if (!s.runIds.includes(r.failedRunId)) s.runIds.push(r.failedRunId);
    if (r.date < s.firstDate) s.firstDate = r.date;
    if (r.date > s.lastDate) s.lastDate = r.date;
    by.set(r.signature, s);
  }
  return [...by.values()]
    .map((s) => ({ ...s, jobs: [...s.jobs].sort(), events: [...s.events].sort(), runIds: [...s.runIds].sort((a, b) => a - b) }))
    .sort((a, b) => b.count - a.count || (a.lastDate === b.lastDate ? 0 : a.lastDate < b.lastDate ? 1 : -1) || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0))
    .slice(0, top);
}

export class UsageError extends Error {}

const DAY = /^\d{4}-\d\d-\d\d$/;
/** @param {string} flag @param {string} s */
function dayMs(flag, s) {
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (!DAY.test(s) || Number.isNaN(ms)) throw new UsageError(`${flag} must be YYYY-MM-DD, got ${JSON.stringify(s)}`);
  return ms;
}
/** @param {number} ms */
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Every UTC day from `since` to `until`, both included. @param {string} since @param {string} until @returns {string[]} */
export function daySlices(since, until) {
  const a = dayMs('--since', since);
  const b = dayMs('--until', until);
  if (a > b) throw new UsageError(`--since ${since} is after --until ${until}`);
  /** @type {string[]} */
  const out = [];
  for (let t = a; t <= b; t += 86_400_000) out.push(isoDay(t));
  return out;
}

/**
 * @param {string[]} argv @param {Date} now @param {Record<string, string | undefined>} env
 * @returns {{ repo: string, since: string, until: string, days: string[], events: string[], exclude: RegExp[],
 *   logs: boolean, top: number, out: string | null, summaryOut: string | null }}
 */
export function parseArgs(argv, now, env) {
  /** @type {Record<string, string>} */
  const one = {};
  /** @type {string[]} */
  const events = [];
  /** @type {RegExp[]} */
  const exclude = [];
  let logs = true;
  const VALUED = ['--repo', '--since', '--until', '--days', '--top', '--out', '--summary-out', '--event', '--exclude'];
  for (let i = 0; i < argv.length; i++) {
    const a = /** @type {string} */ (argv[i]);
    if (a === '--no-logs') { logs = false; continue; }
    if (!VALUED.includes(a)) throw new UsageError(`unknown flag ${JSON.stringify(a)}`);
    const v = argv[++i];
    if (v === undefined) throw new UsageError(`${a} needs a value`);
    if (a === '--event') {
      if (!EVENTS.includes(v)) throw new UsageError(`--event must be one of ${EVENTS.join(', ')}, got ${JSON.stringify(v)}`);
      if (!events.includes(v)) events.push(v);
    } else if (a === '--exclude') {
      try { exclude.push(new RegExp(v)); } catch { throw new UsageError(`--exclude ${JSON.stringify(v)} is not a regular expression`); }
    } else one[a] = v;
  }
  const positive = (/** @type {string} */ flag, /** @type {string} */ fallback) => {
    const n = Number(one[flag] ?? fallback);
    if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} must be a positive whole number`);
    return n;
  };
  const until = one['--until'] ?? isoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = one['--since'] ?? isoDay(dayMs('--until', until) - (positive('--days', '7') - 1) * 86_400_000);
  const days = daySlices(since, until);
  const repo = one['--repo'] || env.GITHUB_REPOSITORY || '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new UsageError('no repository: pass --repo OWNER/NAME or set GITHUB_REPOSITORY');
  return {
    repo, since, until, days, events: events.length ? events : [...EVENTS], exclude, logs,
    top: positive('--top', '10'), out: one['--out'] ?? null, summaryOut: one['--summary-out'] ?? null,
  };
}

/** @param {Pair} p @param {{ signature: string, source: LedgerRow['signatureSource'], tests: string[] }} sig
 *  @returns {LedgerRow} */
function ledgerRow({ failed, passed }, sig) {
  return {
    date: (failed.completedAt || failed.startedAt).slice(0, 10),
    event: failed.event, workflow: failed.workflow, job: failed.job, sha: failed.sha,
    signature: sig.signature, signatureSource: sig.source, failingTests: sig.tests,
    failedRunId: failed.runId, failedAttempt: failed.attempt, failedJobId: failed.jobId,
    failedConclusion: failed.conclusion, failedAt: failed.completedAt,
    passedRunId: passed.runId, passedAttempt: passed.attempt, passedJobId: passed.jobId, passedAt: passed.completedAt,
  };
}

/** @param {Io} io @param {Execution} failed @param {boolean} logs */
async function signatureOf(io, failed, logs) {
  if (logs) {
    const text = await io.jobLog(failed.jobId);
    const fromLog = text ? parseLogSignature(text) : null;
    if (fromLog) return { signature: fromLog.signature, source: /** @type {const} */ ('log'), tests: fromLog.tests };
  }
  const fromAnnotations = annotationSignature(await io.annotations(failed.jobId));
  if (fromAnnotations) return { signature: fromAnnotations, source: /** @type {const} */ ('annotation'), tests: [] };
  if (failed.failedStep) return { signature: `step: ${failed.failedStep}`, source: /** @type {const} */ ('step'), tests: [] };
  return { signature: `unknown: ${failed.conclusion}`, source: /** @type {const} */ ('none'), tests: [] };
}

/**
 * The whole pass over a reader: list the window's runs, list jobs for the candidates, pair, and name each failure.
 * @param {Io} io @param {{ events: string[], days: string[], logs: boolean, exclude: RegExp[] }} opt
 * @returns {Promise<{ rows: LedgerRow[], warnings: string[] }>}
 */
export async function runLedger(io, opt) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<number, Run>} */
  const runs = new Map();
  for (const event of opt.events) {
    for (const day of opt.days) {
      const { runs: list, total } = await io.listRuns(event, day);
      if (total > list.length) {
        warnings.push(`${event} ${day}: ${total} runs, the listing returned ${list.length}; pairs among the rest are missed`);
      }
      for (const r of list) runs.set(r.id, r);
    }
  }
  /** @type {Execution[]} */
  const executions = [];
  for (const r of candidateRuns([...runs.values()])) executions.push(...toExecutions(r, await io.listJobs(r.id)));
  /** @type {LedgerRow[]} */
  const rows = [];
  for (const p of pairFlakes(executions, { exclude: opt.exclude })) rows.push(ledgerRow(p, await signatureOf(io, p.failed, opt.logs)));
  return { rows, warnings };
}

/** A server error (or a rate-limit answer) is worth asking again; a client error is not. */
const RETRYABLE = /HTTP (?:5\d\d|429)\b|secondary rate limit|timed? ?out|ECONNRESET|stream error/i;
const RETRIES = 2;

/** The `gh api` reader: GETs only, each page asked for by number, a server error asked again twice with a 2 s then
 *  4 s pause before the pass fails.
 *  @param {{ repo: string, gh?: (args: string[]) => string, sleep?: (ms: number) => Promise<void> }} o @returns {Io} */
export function ghIo({
  repo,
  gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 }),
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
}) {
  /** @param {string} route @param {string[]} [flags] @returns {Promise<string>} */
  const call = async (route, flags = []) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return gh(['api', route, ...flags]);
      } catch (e) {
        const text = `${e instanceof Error ? e.message : String(e)} ${/** @type {{ stderr?: unknown }} */ (e)?.stderr ?? ''}`;
        if (attempt >= RETRIES || !RETRYABLE.test(text)) throw e;
        await sleep(2000 * 2 ** attempt);
      }
    }
  };
  /** @param {string} route */
  const get = async (route) => JSON.parse(await call(route));
  /** @template T @param {string} route @param {string} key @param {number} perPage
   *  @returns {Promise<{ items: T[], total: number }>} */
  const pages = async (route, key, perPage) => {
    /** @type {T[]} */
    const items = [];
    let total = 0;
    for (let page = 1; ; page++) {
      const body = await get(`${route}&per_page=${perPage}&page=${page}`);
      total = Number(body.total_count ?? 0);
      const got = /** @type {T[]} */ (body[key] ?? []);
      items.push(...got);
      if (got.length < perPage || items.length >= Math.min(total, LISTING_CAP)) break;
    }
    return { items, total };
  };
  return {
    listRuns: async (event, day) => {
      const { items, total } = await pages(`repos/${repo}/actions/runs?event=${event}&created=${day}`, 'workflow_runs', PER_PAGE);
      return { runs: /** @type {Run[]} */ (items), total };
    },
    listJobs: async (runId) => /** @type {Job[]} */ ((await pages(`repos/${repo}/actions/runs/${runId}/jobs?filter=all`, 'jobs', JOBS_PER_PAGE)).items),
    annotations: async (jobId) => {
      try { return await get(`repos/${repo}/check-runs/${jobId}/annotations?per_page=${PER_PAGE}`); } catch { return []; }
    },
    // A job log carries the runner's colour codes, which `gh api` refuses to print without
    // `--allow-escape-sequences`; a `gh` too old to know the flag never refused them, so it is asked again without.
    jobLog: async (jobId) => {
      const route = `repos/${repo}/actions/jobs/${jobId}/logs`;
      try {
        return await call(route, ['--allow-escape-sequences']);
      } catch (e) {
        if (!/unknown flag/.test(`${e instanceof Error ? e.message : String(e)} ${/** @type {{ stderr?: unknown }} */ (e)?.stderr ?? ''}`)) return null;
        try { return await call(route); } catch { return null; }
      }
    },
  };
}

/** @param {SummaryLine[]} top @param {{ repo: string, since: string, until: string, events: string[] }} opt @param {number} n */
function summaryText(top, opt, n) {
  const head = `flake ledger ${opt.repo} ${opt.since}..${opt.until} (${opt.events.join(', ')}): ${n} flake${n === 1 ? '' : 's'}`;
  if (top.length === 0) return `${head}\n`;
  const lines = top.map((s) => `${String(s.count).padStart(4)}  ${s.signature}  [${s.jobs.join(', ')}; last ${s.lastDate}]`);
  return `${head}\ntop ${top.length} by signature:\n${lines.join('\n')}\n`;
}

/** @param {string[]} argv @returns {Promise<number>} */
async function main(argv) {
  let opt;
  try {
    opt = parseArgs(argv, new Date(), process.env);
  } catch (e) {
    process.stderr.write(`flake-ledger: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  let result;
  try {
    result = await runLedger(ghIo({ repo: opt.repo }), opt);
  } catch (e) {
    process.stderr.write(`flake-ledger: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const jsonl = result.rows.map((r) => `${JSON.stringify(r)}\n`).join('');
  if (opt.out) writeFileSync(opt.out, jsonl);
  else process.stdout.write(jsonl);
  const top = summarize(result.rows, opt.top);
  for (const w of result.warnings) process.stderr.write(`flake-ledger: warning: ${w}\n`);
  process.stderr.write(summaryText(top, opt, result.rows.length));
  if (opt.summaryOut) {
    writeFileSync(opt.summaryOut, `${JSON.stringify({ repo: opt.repo, since: opt.since, until: opt.until, events: opt.events, flakes: result.rows.length, top }, null, 2)}\n`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`flake-ledger: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exitCode = 1;
  });
}
