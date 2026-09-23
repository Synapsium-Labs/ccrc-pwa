import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { SessionRecord } from '../registry.js';
import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { isFullLine, parsePrLines, phaseFor, type CcdPrLine } from '../prstate.js';
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
 * What a LIVE lookup's measured phase proves. Total over `PrPhase`, so a
 * phase added to the vocabulary is a compile error here until someone decides
 * what it proves. `none` and `no-commits` are gh's positive answer that no PR
 * is bound to this branch; `unknown` (including `merge-unproven`, where gh
 * said MERGED and a conjunct failed) and `unchecked` prove nothing.
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
 *     other caller of the verb (`verbSupported`). A bound open/draft/merged/
 *     closed PR answers `spent`; gh's "none bound" answers `unspent`; every
 *     other answer — `branch-drift` (the lookup provably did not look for this
 *     branch's PR), a whole-repo failure, a failed ccd call, an unparseable or
 *     foreign line — answers `unmeasured`, with the reason in `detail`.
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
  const measured = phaseFor(line);
  const proves = LIVE_PHASE[measured.phase];
  if (proves === 'spent' && measured.number !== null) return { kind: 'spent', pr: measured.number, source: 'live' };
  if (proves === 'unspent') return { kind: 'unspent' };
  return { kind: 'unmeasured',
    detail: `pr-state answered ${measured.phase}${measured.reason === null ? '' : ` (${measured.reason})`}` };
}
