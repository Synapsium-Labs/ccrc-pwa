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
 */
export type ChildSpentVerdict =
  | { readonly kind: 'spent'; readonly pr: number; readonly source: 'registry' | 'prhistory' | 'live' }
  | { readonly kind: 'unspent' }
  | { readonly kind: 'unmeasured'; readonly detail: string };

/** The ports this verdict reads through — consumer-declared (L2), the same
 *  four `verifyDone` takes. Both `Deps` and `DispatchRunDeps` satisfy it. */
export interface ChildSpentDeps { io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState }

/**
 * The FALLBACK mapping, reached only when no row of `line.rows` names the
 * child's branch as its head in the same repository (the any-same-branch-row
 * check above `childSpent` runs first).
 *
 * WHICH ARMS ARE STILL REACHABLE FROM THAT CALL SITE, AND WHY THE OTHERS STAY.
 * `childSpent` only ever calls `phaseFor(line)` here after establishing that
 * `line.rows` holds no row with `isCrossRepository === false` and
 * `headRefName === line.branch` — which is exactly the pair of conjuncts
 * `boundRow` requires before it can return a non-null row. So `boundRow`
 * inside this call always returns `null`, and `phaseFor` can only answer
 * `none` (has commits past base) or `no-commits` (level with base) — the two
 * arms this mapping sends to `unspent`. The four `spent` arms (`open`,
 * `draft`, `merged`, `closed`) and the `unknown`/`unchecked` arms are
 * therefore UNREACHABLE from this call site today: any row that could produce
 * one of them is, by construction, a same-repository same-branch row the
 * `sameRepo` check above would already have answered from. They stay in the
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
 *  3. A LIVE `ccd pr-state --session <id>` — nothing in this system learns of
 *     a PR by push, and the sweep's cadence is minutes while a coordinator
 *     opens wave N+1 seconds after the worker's done mail. Gated like every
 *     other caller of the verb (`verbSupported`). The operator's rule (D-3347):
 *     a PR OPENED FROM THE CHILD'S BRANCH SPENDS IT, in any state, whatever its
 *     base, whether or not it BINDS — binding (`boundRow`'s base/`ours`
 *     conjuncts) is a fact about which PR a workspace's control renders, not
 *     about whether the branch has been spent. So this rung reads every row of
 *     `line.rows` — measured 2026-09-23 to survive ccd's own `--head` filter
 *     unfiltered, base and `ours` included — for one whose `isCrossRepository`
 *     is exactly `false` (passed through from gh's own JSON unchanged; `ours`,
 *     not this field, is what ccd itself computes and annotates) and whose
 *     `headRefName` names `line.branch`; ANY such row answers `spent`, naming
 *     the highest-numbered one. A same-branch row whose repository could not
 *     be established (`isCrossRepository` absent) is not guessed into either
 *     bucket — it answers `unmeasured` unless a genuine same-repo row also
 *     exists. Only when no SAME-REPOSITORY same-branch row exists — none at
 *     all, or every same-branch row is a stranger's fork — does gh's measured
 *     phase decide: `none`/`no-commits` answers `unspent`; every other
 *     answer — `branch-drift` (the lookup provably did not look for this
 *     branch's PR), a whole-repo failure, a failed ccd call, an unparseable or
 *     foreign line — answers `unmeasured`, with the reason in `detail`. A
 *     recycled slug inherits its head name's PR history and reads spent; wave
 *     3 separates incarnations.
 *
 * COST, measured rather than assumed: steps 1–2 are file reads; step 3 is one
 * gh call on the fleet box, bounded by `pr-state`'s 20 s remote budget, and it
 * runs only for a CHILD with no PR on record — never for a workspace with no
 * marker (`childBindGate` returns before calling this).
 */
export async function childSpent(deps: ChildSpentDeps, rec: SessionRecord): Promise<ChildSpentVerdict> {
  if (rec.prNumber !== null) return { kind: 'spent', pr: rec.prNumber, source: 'registry' };

  const history = await readPrHistory(deps.io, deps.cfg.registryDir, rec.id);
  if (!history.ok) return { kind: 'unmeasured', detail: 'the PR ledger (.prhistory) could not be read' };
  let newest: PrLineageEntry | null = null;
  for (const e of history.entries) if (newest === null || e.recordedAt >= newest.recordedAt) newest = e;
  if (newest !== null) return { kind: 'spent', pr: newest.pr, source: 'prhistory' };

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
  // Neither `false` (same-repo, handled above) nor `true` (a stranger's fork,
  // which never counts): `isCrossRepository` absent means ccd's own gh read
  // did not establish which repository this row's PR lives in, and a row this
  // wave cannot place is not spent by guess.
  const unestablished = sameBranch.filter((r) => r.isCrossRepository !== false && r.isCrossRepository !== true);
  if (sameRepo.length > 0) {
    const named = sameRepo.filter((r): r is CcdPrRow & { number: number } => typeof r.number === 'number');
    if (named.length === 0) {
      return { kind: 'unmeasured',
        detail: 'pr-state named a same-branch PR with no number to report as spent' };
    }
    const highest = named.reduce((a, b) => (b.number > a.number ? b : a));
    return { kind: 'spent', pr: highest.number, source: 'live' };
  }
  if (unestablished.length > 0) {
    return { kind: 'unmeasured',
      detail: 'pr-state named a same-branch PR whose repository could not be established' };
  }

  // Reached only when `sameRepo` and `unestablished` are both empty, which
  // means `boundRow(line.rows, …)` inside `phaseFor` can only ever return
  // `null` here (see `LIVE_PHASE`'s own doc for why) — so `measured.phase` can
  // only be `none` or `no-commits` in practice, and `proves` can only be
  // `unspent`. The `spent` and `unmeasured` arms below are dead code from this
  // call site today, kept for the same totality/defence reason `LIVE_PHASE`
  // itself is kept total: `phaseFor` is shared, and a future change to it or
  // to the filters above must not silently start reading one of these arms as
  // if it had always been live.
  const measured = phaseFor(line);
  const proves = LIVE_PHASE[measured.phase];
  if (proves === 'spent' && measured.number !== null) return { kind: 'spent', pr: measured.number, source: 'live' };
  if (proves === 'unspent') return { kind: 'unspent' };
  return { kind: 'unmeasured',
    detail: `pr-state answered ${measured.phase}${measured.reason === null ? '' : ` (${measured.reason})`}` };
}
