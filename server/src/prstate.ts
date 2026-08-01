import type { PrChecks, PrState, PrView, TaskItem } from '../../shared/api.js';

/** One row of `gh pr list --json …`, as `ccd pr-state` re-emits it — plus the
 *  `ours` annotation ccd computed on the box (proof 0: the PR's head commit
 *  exists locally AND is reachable from our branch tip). */
export interface CcdPrRow {
  number?: number; state?: string; headRefName?: string; headRefOid?: string;
  baseRefName?: string; isCrossRepository?: boolean; mergedAt?: string | null;
  mergeCommit?: { oid?: string } | null; url?: string; title?: string;
  isDraft?: boolean; statusCheckRollup?: unknown; ours?: boolean;
}

export interface CcdPrLine {
  id: string; project: string; repo: string; branch: string; base: string; baseShort: string;
  /** Every one of these three is NULLABLE, and null means UNMEASURED — never
   *  zero, never "". `tip` is null when the branch the registry names no longer
   *  resolves in `$main` (a hand rename or delete, which deviation 7 calls
   *  ordinary); `ahead` is null whenever `tip` is, because there is nothing to
   *  count from; `dirty` is null when the worktree could not be corroborated as
   *  this workspace's or its tree could not be read. Deviation 10. A consumer
   *  that treats any of them as 0 is asserting a clean, level, resolvable
   *  workspace it never looked at. */
  tip: string | null; ahead: number | null; dirty: number | null;
  commits: { sha: string; subject: string; body: string }[];
  template: string | null; rows: CcdPrRow[];
  phase: PrState['phase']; number: number | null; checkedAt: number;
  /** ccd's own account of why its `phase` is what it is. `null` for every phase
   *  but the gh-said-MERGED-with-a-failed-conjunct one, where ccd writes
   *  `merge-unproven` — and `phaseFor` recomputes the identical token, which is
   *  what the agreement test pins. Not `null`-typed: a read that never got as
   *  far as the predicate emits one of the two FAILURE shapes below, not a
   *  full line. */
  reason: PrState['reason'];
}

/** A WHOLE-REPO failure: `_gh_repo_slug` or `_gh_pr_list` could not answer, so
 *  nothing is known about any session of that project. It carries no `id`
 *  precisely because it speaks for all of them, and that is what the sweep's
 *  per-project backoff keys off. */
export interface CcdPrFailure { phase: 'unknown'; reason: PrState['reason'] }

/** A PER-SESSION failure: this one workspace's registry is incomplete (no
 *  `branch`), while its siblings are fine. It carries an `id` so it can be
 *  attributed, and it must NEVER be mistaken for either of the other two
 *  shapes — as a whole-repo failure it would back the project off and grey
 *  seven innocent siblings; as a full line it would reach `phaseFor` with no
 *  `rows` and throw. */
export interface CcdPrSessionFailure { id: string; phase: 'unknown'; reason: PrState['reason'] }

const REASONS = new Set(['timeout', 'offline', 'unauthenticated', 'rate-limit',
  'no-remote', 'unsupported', 'agent-down', 'error', 'merge-unproven']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const asReason = (v: unknown): PrState['reason'] =>
  typeof v === 'string' && REASONS.has(v) ? (v as PrState['reason']) : 'error';

/**
 * Which of the three shapes this is. The discriminator is `rows`, NOT `id`: a
 * full line always has the array, and neither failure shape ever does.
 * Discriminating on `id` was the original design and is wrong now that
 * `_pr_state_one` names the session in its failure object — `phaseFor` would
 * call `boundRow(undefined, …)` and throw inside a `void`-dispatched sweep,
 * which loses the sweep for every project after it.
 */
export const isFullLine = (
  v: CcdPrLine | CcdPrFailure | CcdPrSessionFailure,
): v is CcdPrLine => Array.isArray((v as CcdPrLine).rows);

/**
 * `ccd pr-state` output → one entry per line. **Every line is parsed inside
 * its own try/catch**: `FleetWatcher.tick()` is invoked as `void this.tick()`,
 * so an uncaught parse throw on truncated stdout would take the process down,
 * and a half-written line is a routine event when the far side is killed at a
 * timeout.
 */
export function parsePrLines(stdout: string): (CcdPrLine | CcdPrFailure | CcdPrSessionFailure)[] {
  const out: (CcdPrLine | CcdPrFailure | CcdPrSessionFailure)[] = [];
  for (const raw of stdout.split('\n')) {
    const text = raw.trim();
    if (text === '') continue;
    try {
      const v: unknown = JSON.parse(text);
      if (!isRecord(v)) continue;
      // `rows` first, `id` second — three shapes, and the id-carrying failure
      // is a real one, not a malformed line.
      if (Array.isArray(v.rows) && typeof v.id === 'string') out.push(v as unknown as CcdPrLine);
      else if (v.phase === 'unknown' && typeof v.id === 'string') {
        out.push({ id: v.id, phase: 'unknown', reason: asReason(v.reason) });
      } else if (v.phase === 'unknown') out.push({ phase: 'unknown', reason: asReason(v.reason) });
    } catch {
      /* a truncated or half-written line is skipped, never thrown */
    }
  }
  return out;
}

const OID_RE = /^[0-9a-f]{7,40}$/;

/**
 * The merge predicate, conjunctive. `isCrossRepository === false` because
 * `gh pr list --head` matches `headRefName` ACROSS fork owners; the base match
 * because a PR merged elsewhere says nothing about this base; and `ours`
 * because branch name alone is not a binding over a 144-slug namespace that
 * `ws-reap` recycles. `mergeCommit.oid` is required to EXIST but is never used
 * as an identity — two PRs can share one.
 */
export function isMergedRow(row: CcdPrRow, baseShort: string, registryBranch: string): boolean {
  return row.state === 'MERGED' && typeof row.mergedAt === 'string'
    && typeof row.mergeCommit?.oid === 'string' && OID_RE.test(row.mergeCommit.oid)
    && row.isCrossRepository === false
    && row.baseRefName === baseShort
    && row.headRefName === registryBranch
    && row.ours === true;
}

/** The row this workspace's PR control speaks for. Highest `number` wins
 *  AFTER the binding check, never before. */
export function boundRow(rows: readonly CcdPrRow[], baseShort: string, branch: string): CcdPrRow | null {
  const cands = rows.filter((r) =>
    r.isCrossRepository === false && r.baseRefName === baseShort
    && r.headRefName === branch && r.ours === true);
  cands.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  return cands[cands.length - 1] ?? null;
}

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const RUNNING = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'EXPECTED', 'REQUESTED']);
const MAX_CHECK_NAMES = 10;
const MAX_CHECK_NAME_LEN = 120;

/** CI rollup, plus the names of the FAILING checks only. Those names come from
 *  GitHub and are attacker-controllable on any repo that takes fork PRs, so
 *  they are bounded here and inert everywhere downstream: never a prompt,
 *  never an argv, never a shell word. */
export function checksFor(row: CcdPrRow): { checks: PrChecks; checkNames: string[] | null } {
  const raw = Array.isArray(row.statusCheckRollup) ? (row.statusCheckRollup as unknown[]) : null;
  if (raw === null || raw.length === 0) return { checks: null, checkNames: null };
  const stateOf = (c: unknown): string =>
    isRecord(c) ? String(c.conclusion ?? c.state ?? c.status ?? '').toUpperCase() : '';
  const nameOf = (c: unknown): string =>
    (isRecord(c) ? String(c.name ?? c.context ?? 'check') : 'check').slice(0, MAX_CHECK_NAME_LEN);
  const failing = raw.filter((c) => FAILED.has(stateOf(c))).map(nameOf).slice(0, MAX_CHECK_NAMES);
  if (failing.length > 0) return { checks: 'fail', checkNames: failing };
  if (raw.some((c) => RUNNING.has(stateOf(c)))) return { checks: 'pending', checkNames: null };
  return { checks: 'pass', checkNames: null };
}

/** One ccd line → the wire's PrState. */
export function phaseFor(line: CcdPrLine): PrState {
  const row = boundRow(line.rows, line.baseShort, line.branch);
  const base: PrState = {
    phase: 'none', number: null, url: null, title: null, checks: null, checkNames: null,
    // `PrState.ahead` is a count the cap RENDERS, so it stays a number and an
    // unmeasured one shows as no commits to list. The PHASE below reads
    // `line.ahead`, never this, precisely so the coercion cannot become a claim.
    ahead: line.ahead ?? 0, reason: null, checkedAt: line.checkedAt, mergedAt: null,
    // A successful reading clears any scheduled retry by construction.
    retryAt: null,
  };
  // `line.ahead === 0` and NOT `(line.ahead ?? 0) === 0`: null is UNMEASURED —
  // the branch the registry names did not resolve — and `no-commits` is the
  // positive claim that this branch is level with base. Unmeasured falls through
  // to `none`, which is the same rung ccd's python walks (`None == 0` is False
  // there), and the agreement matrix pins the two equal on that row.
  if (row === null) return { ...base, phase: line.ahead === 0 ? 'no-commits' : 'none' };

  const { checks, checkNames } = checksFor(row);
  const common: PrState = {
    ...base, number: row.number ?? null, url: row.url ?? null, title: row.title ?? null,
    checks, checkNames,
  };
  if (isMergedRow(row, line.baseShort, line.branch)) {
    return { ...common, phase: 'merged', mergedAt: Date.parse(String(row.mergedAt)) };
  }
  // gh says MERGED but a conjunct failed: never claim merged on a partial
  // match — both the archive trigger and the cleanup offer hang off it.
  //
  // `merge-unproven`, NOT `error`. GitHub answered perfectly well here, so
  // `error` — which the cap renders as "GitHub could not be read." — is a lie
  // about the one thing that did work, and it sends the reader to check their
  // gh auth over a mergeCommit the API never named. ccd persists the same token
  // for the same row (Task 3), and Step 6's agreement test pins the two equal on
  // `reason` as well as `phase`.
  if (row.state === 'MERGED') return { ...common, phase: 'unknown', reason: 'merge-unproven' };
  if (row.state === 'CLOSED') return { ...common, phase: 'closed' };
  return { ...common, phase: row.isDraft === true ? 'draft' : 'open' };
}

const UNCHECKED: PrState = {
  phase: 'unchecked', number: null, url: null, title: null, checks: null, checkNames: null,
  ahead: 0, reason: null, checkedAt: null, mergedAt: null, retryAt: null,
};

/**
 * A COMPLETE `PrView` that says "we do not know, and here is why" — the one
 * way to build that answer.
 *
 * Every caller that has a reason and no reading goes through this: the failure
 * branch below, and the route's `unsupported` and `agent-down` branches (Task
 * 13 Step 5). Those two used to build the object inline, one of them returning
 * a bare `{}` with no `pr` key at all — which is precisely the silence §2
 * forbids, and which the client renders as "no control" rather than "we could
 * not look". A helper also means the shape cannot drift between the three.
 */
export function unknownView(
  reason: NonNullable<PrState['reason']>,
  prev: PrState | null = null,
): PrView {
  return { pr: { ...(prev ?? UNCHECKED), phase: 'unknown', reason }, draft: null, facts: null };
}

/**
 * What a route or a sweep hands the client. On a failed read the previous
 * value is KEPT — number, title, url and the OLD `checkedAt` — and only the
 * phase greys, which is what makes "last checked 6m ago" honest instead of a
 * fresh-looking lie.
 */
export function prView(
  line: CcdPrLine | CcdPrFailure | CcdPrSessionFailure | null,
  tasks: TaskItem[] | null,
  prev: PrState | null,
): PrView {
  if (line === null) return { pr: prev ?? UNCHECKED, draft: null, facts: null };
  // Both failure shapes land here and are treated identically — whose fault it
  // was matters to the SWEEP's backoff, not to one session's view.
  if (!isFullLine(line)) return unknownView(line.reason ?? 'error', prev);
  const pr = phaseFor(line);
  // `commits` and `dirty` pass through NULLABLE. Coercing either to 0 here is
  // the whole of deviation 10 undone at the last hop: the composer would print
  // "0 commits" for a branch it never resolved and stay silent about
  // uncommitted work in a tree it never read — silence a reader takes for
  // "clean". PrSheet renders the unknown case as unknown.
  const facts = {
    branch: line.branch, baseShort: line.baseShort, repo: line.repo,
    commits: line.ahead, dirty: line.dirty,
  };
  return { pr, draft: pr.phase === 'none' ? draftPr(line, tasks) : null, facts };
}

const FIXUP_RE = /^(fixup|squash|amend|wip)!?\b/i;

/** `ws/quiet-basin` → `quiet-basin`. */
const deslug = (branch: string): string => branch.slice(branch.lastIndexOf('/') + 1);

/**
 * Title and body for a new PR — deterministic, no model call, testable
 * without `gh`.
 *
 * `line.commits` arrives newest-first (`git log base..branch`), so it is
 * reversed once here: "the first commit" in the rules below means the OLDEST,
 * the one that names the intent. Reading it the other way titles every
 * multi-commit PR "fix typo".
 */
export function draftPr(line: CcdPrLine, tasks: TaskItem[] | null): { title: string; body: string } {
  const commits = [...line.commits].reverse();
  const real = commits.filter((c) => !FIXUP_RE.test(c.subject));
  const title =
    commits.length === 1 ? commits[0]!.subject
    : real.length > 0 ? real[0]!.subject
    : deslug(line.branch);

  const parts: string[] = [];
  // A repo with a PR template has an opinion, and automation does not override it.
  if (line.template !== null && line.template.trim() !== '') parts.push(line.template.trim());
  else if (real[0] !== undefined && real[0].body.trim() !== '') {
    parts.push(real[0].body.trim().split('\n\n')[0]!.trim());
  }
  if (tasks !== null && tasks.length > 0) {
    parts.push(['## Plan', ...tasks.map((t) => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.subject}`)].join('\n'));
  }
  if (commits.length > 0) {
    parts.push(['## Commits', ...commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.subject}`)].join('\n'));
  }
  parts.push(`Opened from ccrc workspace \`${line.id}\` (\`${line.branch}\` → \`${line.baseShort}\`).`);
  // NEVER empty: an empty --body suppresses the repo's PR template entirely,
  // and ccd refuses one for that reason.
  return { title, body: parts.join('\n\n') + '\n' };
}
