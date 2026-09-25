import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { SessionRecord } from '../registry.js';
import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { isFullLine, parsePrLines, phaseFor, type CcdPrLine, type CcdPrRow } from '../prstate.js';
import { readPrHistory } from './prhistory.js';
import type { PrLineageEntry } from './store.js';
import type { PrPhase } from '../../../shared/api.js';

/**
 * Whether a CHILD is SPENT — its branch has ever had a PR, in any phase
 * (child-reclamation spec §4, §5.3). THREE answers, never a boolean: an
 * unreadable ledger or a lookup that did not answer is not evidence that no
 * PR exists, and a gate that read it as `unspent` would bind a spent child —
 * the exact hand-over rule 3 forbids. `source` says which evidence spoke.
 *
 * `incarnation` says WHICH WORKSPACE that evidence proves spent. A child's
 * branch name is a recycled slug (spec §5.5), so a PR row can belong to an
 * earlier workspace that wore the same name. `this` is a live row dated after
 * this child's birth (`placeChildRow`); `unplaced` is evidence that cannot be
 * dated against it — the fast path's registry number and `.prhistory` carry
 * no date at all, which the type states, and a live row may be undated too.
 * Rows placed `inherited` never reach a verdict: they are dropped. The two
 * consumers read it differently, which is why it is a word and not folded:
 * a bind refuses either incarnation; a close that DESTROYS acts on `this`
 * alone (spec §5.7), and dates a fast-path answer through `childSpentLive`.
 */
export type ChildSpentVerdict =
  | { readonly kind: 'spent'; readonly pr: number; readonly source: 'registry' | 'prhistory';
      readonly incarnation: 'unplaced' }
  | { readonly kind: 'spent'; readonly pr: number; readonly source: 'live';
      readonly incarnation: 'this' | 'unplaced' }
  | { readonly kind: 'unspent' }
  | { readonly kind: 'unmeasured'; readonly detail: string };

/**
 * A child's BIRTH: the instant its workspace was minted, which every PR row
 * on its branch is dated against. It is the MINTING run's `dispatchStartedAt`
 * — the server's own clock, stamped immediately before the `ws-add` that
 * minted the session, and never cleared (`CoordStore.markDispatchStarted`).
 * A REQUIRED input to `childSpent` and `childSpentLive`, never optional: a
 * caller that omitted it would silently change what every row means. Its own
 * second arm is `unplaceable`, a word no row placement uses (`childBirthOf`
 * says when), and it places every row `unplaced` — never `inherited`.
 */
export type ChildBirth =
  | { readonly kind: 'at'; readonly ms: number }
  | { readonly kind: 'unplaceable'; readonly detail: string };

/** The clock-skew allowance either side of a birth, in ms. The birth is the
 *  server's clock and `createdAt` is GitHub's, so a row inside ±this window is
 *  neither provably old nor provably new. NAMED ONCE. */
export const CHILD_BIRTH_SKEW_MS = 120_000;

/** Where one same-repository same-branch PR row sits against a birth. */
export type ChildRowPlacement = 'this' | 'inherited' | 'unplaced';

/** gh's own `createdAt` shape: a full ISO-8601 instant WITH its zone. The
 *  shape is required, not merely `Date.parse` succeeding, because `Date.parse`
 *  also accepts a bare date (read as midnight UTC) and a zone-less time (read
 *  as the SERVER's local time) — a rule, not a fact, and a day's error dwarfs
 *  the skew. No `g` flag: `.test` must carry no `lastIndex` between calls. */
const GH_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * One row's placement (spec §5.3; a recycled slug, §5.5): `this` when its
 * `createdAt` is at or after birth + skew; `inherited` when it is before
 * birth − skew; `unplaced` for everything else — no `createdAt` (every row an
 * older ccd emits), one not in gh's shape or naming no real instant, an
 * unplaceable birth, or a date inside ±skew. Only `inherited` licenses
 * dropping a row, so every doubt lands on `unplaced`.
 */
export function placeChildRow(createdAt: unknown, birth: ChildBirth): ChildRowPlacement {
  if (birth.kind !== 'at') return 'unplaced';
  if (typeof createdAt !== 'string' || !GH_INSTANT.test(createdAt)) return 'unplaced';
  const ms = Date.parse(createdAt);
  // NaN — gh's shape naming no real instant, e.g. month 13 — fails both
  // comparisons below and lands on `unplaced` by the same rule as the window.
  if (ms >= birth.ms + CHILD_BIRTH_SKEW_MS) return 'this';
  if (ms < birth.ms - CHILD_BIRTH_SKEW_MS) return 'inherited';
  return 'unplaced';
}

/** The minting run's row as the birth reads it — the two columns it needs
 *  out of `CoordStore.run`'s answer, which satisfies this type structurally,
 *  so a caller hands the store's own read over unchanged. Its three answers
 *  stay three: a row, no row, and a row that could not be read. */
export type ChildBirthRunRead =
  | { readonly ok: true;
      readonly run: { readonly sessionId: string | null; readonly dispatchStartedAt: number | null } | null }
  | { readonly ok: false; readonly detail: string };

/**
 * The birth of session `sessionId`, from the read of the run its marker names
 * (spec §5.1: the marker names the MINTING run). UNPLACEABLE — each in its own
 * words — when the row could not be read, when there is no such row, when its
 * `dispatchStartedAt` is null (no fresh-spawn dispatch ever started), or when
 * its `sessionId` is not this session: a run whose retry minted another
 * workspace, leaving this one an orphan the stamp does not describe.
 */
export function childBirthOf(read: ChildBirthRunRead, sessionId: string): ChildBirth {
  if (!read.ok) return { kind: 'unplaceable', detail: `the minting run could not be read: ${read.detail}` };
  if (read.run === null) return { kind: 'unplaceable', detail: 'the minting run is absent' };
  if (read.run.dispatchStartedAt === null) {
    return { kind: 'unplaceable', detail: 'the minting run never stamped a dispatch start' };
  }
  if (read.run.sessionId !== sessionId) {
    return { kind: 'unplaceable', detail: 'the minting run is bound to another session' };
  }
  return { kind: 'at', ms: read.run.dispatchStartedAt };
}

/** The ports this verdict reads through — consumer-declared (L2), the same
 *  four `verifyDone` takes. Both `Deps` and `DispatchRunDeps` satisfy it. */
export interface ChildSpentDeps { io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState }

/**
 * The FALLBACK mapping, reached only when no row of `line.rows` that survives
 * incarnation placement names the child's branch as its head in the same
 * repository (the any-same-branch-row check in `childSpentLive` runs first).
 *
 * WHICH ARMS ARE STILL REACHABLE FROM THAT CALL SITE, AND WHY THE OTHERS STAY.
 * `childSpentLive` only ever calls `phaseFor` here on the line with its
 * `inherited` rows DROPPED, after establishing that the rows left hold no row
 * with `isCrossRepository === false` and
 * `headRefName === line.branch` — which is exactly the pair of conjuncts
 * `boundRow` requires before it can return a non-null row. So `boundRow`
 * inside this call always returns `null`, and `phaseFor` can only answer
 * `none` (has commits past base) or `no-commits` (level with base) — the two
 * arms this mapping sends to `unspent`. The four `spent` arms (`open`,
 * `draft`, `merged`, `closed`) and the `unknown`/`unchecked` arms are
 * therefore UNREACHABLE from this call site today: any row that could produce
 * one of them is, by construction, a same-repository same-branch row that
 * either was dropped as `inherited` or survived into `kept`, which would
 * already have answered. They stay in the
 * table anyway for two reasons — TOTALITY (`Record<PrPhase, …>` is a compile
 * error the day `PrPhase` grows a member nobody has classified) and DEFENCE
 * (`phaseFor` is a shared helper with other call sites; a future change to
 * `boundRow` or to this file's own filtering must not silently start reading
 * one of the unreachable arms as if it still meant what it used to). No
 * behaviour change rides on this comment — only which of the six entries a
 * test can actually exercise from `childSpent` changed, not the mapping.
 */
const LIVE_PHASE: Readonly<Record<PrPhase, 'spent' | 'unspent' | 'unmeasured'>> = {
  open: 'spent', draft: 'spent', merged: 'spent', closed: 'spent',
  none: 'unspent', 'no-commits': 'unspent',
  unchecked: 'unmeasured', unknown: 'unmeasured',
};

/**
 * The spent verdict, MEASURED at the moment it is asked (spec §5.3). Three
 * sources, in this order, and the order is the argument:
 *
 *  1. `rec.prNumber` — present is evidence of spent. ONE DIRECTION ONLY: the
 *     registry reads `.prnumber` through the collapsing `field()`, which folds
 *     an unreadable file into the same null as an absent one, so a null says
 *     nothing and the verdict falls through.
 *  2. `.prhistory`, through `readPrHistory` — which tells absent from
 *     unreadable. Unreadable answers `unmeasured`: `closeRun`'s own fail-shut
 *     direction on the same file. Any entry answers `spent`, naming the
 *     NEWEST by `recordedAt` (the ledger is append-only, so a retired PR stays
 *     a PR).
 *  3. The LIVE rung, `childSpentLive` — see its own docstring.
 *
 * Rungs 1–2 answer `incarnation: 'unplaced'`: neither carries a date, and
 * rung 1 is where a merge commit's bind lands, so neither can say which
 * workspace wearing this slug the PR belongs to. `birth` is spent by rung 3
 * alone, and is REQUIRED here anyway so no caller can reach rung 3 without it.
 *
 * COST, measured rather than assumed: steps 1–2 are file reads; step 3 is one
 * gh call on the fleet box, bounded by `pr-state`'s 20 s remote budget, and it
 * runs only for a CHILD with no PR on record — never for a workspace with no
 * marker (`childBindGate` returns before calling this).
 */
export async function childSpent(
  deps: ChildSpentDeps, rec: SessionRecord, birth: ChildBirth,
): Promise<ChildSpentVerdict> {
  if (rec.prNumber !== null) {
    return { kind: 'spent', pr: rec.prNumber, source: 'registry', incarnation: 'unplaced' };
  }

  const history = await readPrHistory(deps.io, deps.cfg.registryDir, rec.id);
  if (!history.ok) return { kind: 'unmeasured', detail: 'the PR ledger (.prhistory) could not be read' };
  let newest: PrLineageEntry | null = null;
  for (const e of history.entries) if (newest === null || e.recordedAt >= newest.recordedAt) newest = e;
  if (newest !== null) return { kind: 'spent', pr: newest.pr, source: 'prhistory', incarnation: 'unplaced' };

  return childSpentLive(deps, rec, birth);
}

/**
 * The LIVE rung of `childSpent` (spec §5.3), exported on its own for its
 * second caller: the close (spec §5.7), which may DESTROY a spent child and so
 * never acts on the fast path alone — when `childSpent` answers spent from
 * `rec.prNumber` or `.prhistory` (`incarnation: 'unplaced'`), the close calls
 * this to DATE that PR, and treats only spent/this as finished. It therefore
 * reads no fast path of its own: `rec.prNumber` is ignored here.
 *
 * A LIVE `ccd pr-state --session <id>` — nothing in this system learns of a
 * PR by push, and the sweep's cadence is minutes while a coordinator opens
 * wave N+1 seconds after the worker's done mail. Gated like every other
 * caller of the verb (`verbSupported`). The operator's rule (D-3347): a PR
 * OPENED FROM THE CHILD'S BRANCH SPENDS IT, in any state, whatever its base,
 * whether or not it BINDS — binding (`boundRow`'s base/`ours` conjuncts) is a
 * fact about which PR a workspace's control renders, not about whether the
 * branch has been spent. So this rung reads every row of `line.rows` —
 * measured 2026-09-23 to survive ccd's own `--head` filter unfiltered, base
 * and `ours` included — for one whose `isCrossRepository` is exactly `false`
 * (passed through from gh's own JSON unchanged; `ours`, not this field, is
 * what ccd itself computes and annotates) and whose `headRefName` names
 * `line.branch`.
 *
 * EVERY SUCH ROW IS PLACED against `birth` (`placeChildRow`): a child's branch
 * name is a recycled slug (spec §5.5), and a row created before this child
 * was minted belongs to an earlier workspace that wore the name. `inherited`
 * rows are DROPPED — from this step and from every later one, `phaseFor`'s
 * `boundRow` included, so an old merged PR that would bind the tip (the merge
 * commit's shape) cannot spend this child by the back door. Any row left
 * answers `spent`: `incarnation: 'this'` naming the highest-numbered `this`
 * row when one exists, else `'unplaced'` naming the highest-numbered row
 * left. When every same-branch row is `inherited`, the line falls through the
 * steps below as if it had none.
 *
 * A same-branch row whose repository could not be established
 * (`isCrossRepository` absent) is not guessed into either bucket — it answers
 * `unmeasured` unless a genuine same-repo row also exists. Neither is a row
 * this rung cannot even COMPARE: a line with no string `branch`, or a non-fork
 * row whose `headRefName` is not a string, answers `unmeasured` the same way
 * (D-3351) — a fork's unreadable head is ignored, since forks never count
 * regardless. Only when no surviving SAME-REPOSITORY same-branch row exists —
 * none at all, every one inherited, or every same-branch row a stranger's
 * fork — and `line.tip` is a string (a null or absent `tip` is ccd's own "I
 * did not measure that", D-3351, never a fact about the branch's PRs) does
 * gh's measured phase decide: `none`/`no-commits` answers `unspent`; every
 * other answer — `branch-drift` (the lookup provably did not look for this
 * branch's PR), a whole-repo failure, a failed ccd call, an unparseable or
 * foreign line — answers `unmeasured`, with the reason in `detail`.
 *
 * COST: one gh call on the fleet box, bounded by `pr-state`'s 20 s remote
 * budget — for the close, inside whatever lock the close holds.
 */
export async function childSpentLive(
  deps: ChildSpentDeps, rec: SessionRecord, birth: ChildBirth,
): Promise<ChildSpentVerdict> {
  const argv = CCD_ARGV.prStateSession(rec.id);
  if (!verbSupported(deps.fleetState, argv)) {
    return { kind: 'unmeasured', detail: 'the fleet host cannot answer pr-state' };
  }
  const res = await deps.runCcd(argv);
  if (!res.ok) return { kind: 'unmeasured', detail: `pr-state failed: ${res.stderr.trim()}` };
  const lines = parsePrLines(res.stdout);
  const line = lines.find((l): l is CcdPrLine => isFullLine(l) && l.id === rec.id);
  if (line === undefined) {
    const failure = lines.find((l) => !isFullLine(l));
    return { kind: 'unmeasured', detail: failure === undefined
      ? 'pr-state answered no line for this session'
      : `pr-state answered ${failure.reason ?? 'unknown'}` };
  }
  // D-3351: without this check, a line with no `branch` at all (and a string
  // `tip`, and only rows with string heads) falls through to `phaseFor` and
  // answers `unspent` — not by matching anything below, but by matching
  // NOTHING: `r.headRefName === line.branch` answers `false` for
  // every row with a string head, so they fall OUT of `sameBranch` rather than
  // into it, and the same undefined `line.branch` makes `phaseFor`'s own
  // `boundRow` conjunct fail identically, landing on `row === null` →
  // `none`/`no-commits` → `unspent`. Refused here instead, before any of that
  // runs, so a branchless line reads "not measured", not "no PR".
  if (typeof line.branch !== 'string') {
    return { kind: 'unmeasured', detail: 'pr-state named no branch for this session' };
  }
  // D-3347: a PR opened from the child's branch spends it, whatever its base
  // and whether or not it binds — `boundRow`'s base/`ours` conjuncts decide
  // which PR a workspace's CONTROL renders, not whether the branch is spent.
  // `line.branch`, NOT `rec.branch`: it is the exact string ccd queried gh
  // WITH (`--head`), so a registry rename landing between the server's own
  // read of `rec` and ccd's read of the same registry cannot make a real PR
  // miss this check — this compares against what the gh call actually asked,
  // not against a value that could have moved since.
  const sameBranch = line.rows.filter((r) => r.headRefName === line.branch);
  const sameRepo = sameBranch.filter((r) => r.isCrossRepository === false);
  // Incarnation placement (spec §5.3, §5.5): only a row PROVEN to predate this
  // child's birth leaves the line, and it leaves every step below — `rows` is
  // what `phaseFor` is handed, so its `boundRow` never sees one either.
  const inherited = new Set(sameRepo.filter((r) => placeChildRow(r.createdAt, birth) === 'inherited'));
  const rows = line.rows.filter((r) => !inherited.has(r));
  const kept = sameRepo.filter((r) => !inherited.has(r));
  // Neither `false` (same-repo, handled above) nor `true` (a stranger's fork,
  // which never counts): `isCrossRepository` absent means ccd's own gh read
  // did not establish which repository this row's PR lives in, and a row this
  // rung cannot attribute to a repository is not spent by guess.
  const unestablished = sameBranch.filter((r) => r.isCrossRepository !== false && r.isCrossRepository !== true);
  // D-3351: a row whose `headRefName` is not a string can never equal the
  // string `line.branch` above, so it never reaches `sameBranch` (or
  // `unestablished`) though it is exactly as uncomparable as they are — this
  // reads `line.rows` directly rather than filtering `sameBranch`. A FORK
  // (`isCrossRepository === true`) is excluded here: forks never count,
  // readable head or not, so an unreadable one is simply ignored.
  const headUnreadable = line.rows.filter((r) => r.isCrossRepository !== true && typeof r.headRefName !== 'string');
  if (kept.length > 0) {
    const named = kept.filter((r): r is CcdPrRow & { number: number } => typeof r.number === 'number');
    if (named.length === 0) {
      return { kind: 'unmeasured',
        detail: 'pr-state named a same-branch PR with no number to report as spent' };
    }
    const dated = named.filter((r) => placeChildRow(r.createdAt, birth) === 'this');
    const pool = dated.length > 0 ? dated : named;
    const highest = pool.reduce((a, b) => (b.number > a.number ? b : a));
    return { kind: 'spent', pr: highest.number, source: 'live', incarnation: dated.length > 0 ? 'this' : 'unplaced' };
  }
  if (headUnreadable.length > 0) {
    return { kind: 'unmeasured',
      detail: 'pr-state named a PR whose head branch could not be read' };
  }
  if (unestablished.length > 0) {
    return { kind: 'unmeasured',
      detail: 'pr-state named a same-branch PR whose repository could not be established' };
  }
  // D-3351: a null `tip` already means "not measured" on both sides —
  // `ccd/ccd`'s branch-drift comment and `CcdPrLine`'s own docstring in
  // prstate.ts both say so, for a branch not resolving for ccd, most often
  // a hand rename or delete. An ABSENT tip key is D-3351's own extension:
  // falling through to `phaseFor` on a line that never looked would read
  // "I did not look" as "there is nothing to find".
  if (typeof line.tip !== 'string') {
    return { kind: 'unmeasured',
      detail: "pr-state could not resolve this session's branch (tip unmeasured)" };
  }

  // Reached only when `kept`, `headUnreadable` and `unestablished` are all
  // empty and `line.tip` is a string, which means `boundRow(rows, …)` inside
  // `phaseFor` can only ever return `null` here (see `LIVE_PHASE`'s own doc
  // for why — `rows` holds no inherited row, and no other same-repo
  // same-branch row survived to reach this line) — so `measured.phase` can
  // only be `none` or `no-commits` in practice, and `proves` can only be
  // `unspent`. The `spent` and `unmeasured` arms below are dead code from this
  // call site today, kept for the same totality/defence reason `LIVE_PHASE`
  // itself is kept total: `phaseFor` is shared, and a future change to it or
  // to the filters above must not silently start reading one of these arms as
  // if it had always been live. The dead `spent` arm says `unplaced`: an
  // answer nobody dated may not authorise a destruction.
  const measured = phaseFor({ ...line, rows });
  const proves = LIVE_PHASE[measured.phase];
  if (proves === 'spent' && measured.number !== null) {
    return { kind: 'spent', pr: measured.number, source: 'live', incarnation: 'unplaced' };
  }
  if (proves === 'unspent') return { kind: 'unspent' };
  return { kind: 'unmeasured',
    detail: `pr-state answered ${measured.phase}${measured.reason === null ? '' : ` (${measured.reason})`}` };
}
