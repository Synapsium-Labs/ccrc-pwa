// D-8077 (the ruled plan's W1, R6): THE RUN-CLOSE LANE'S BRANCH FACTS for a candidate run with a session, read BEFORE the
// coordination serialiser and stamped with their read time. One `ccd pr-state --session` read gives both facts:
//   - an OPEN pull request from the session's own branch (the PR this run would strand);
//   - commits the branch carries that the lane cannot prove are pushed. `pr-state` answers how far the branch is ahead of its
//     base, not what the remote holds, so ANY commit ahead counts as unpushed: the refusal errs toward keeping the run, and a
//     coordinator that has pushed its work closes the run itself.
// An unreadable line, a fleet host that cannot answer `pr-state`, or a failed call is `null`: unmeasured, which refuses (R6).
import { isRegistryId } from '../../../shared/api.js';
import type { FleetState } from '../fleetstate.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import { isFullLine, parsePrLines, type CcdPrLine } from '../prstate.js';
import type { BranchFacts } from './runClose.js';
import type { RunCcd } from './ports.js';

export async function readBranchFacts(
  deps: { readonly runCcd: RunCcd; readonly fleetState?: FleetState | undefined; readonly now: () => number }, sessionId: string,
): Promise<BranchFacts> {
  const unmeasured = (): BranchFacts => ({ readAt: deps.now(), openPr: null, unpushed: null });
  // A stored id that is not a registry id composes no argv: unmeasured, which refuses (R6).
  if (!isRegistryId(sessionId)) return unmeasured();
  if (!ccdCan(deps.fleetState, 'prStateSession')) return unmeasured();
  let stdout: string;
  try {
    const res = await deps.runCcd(CCD_ARGV.prStateSession(sessionId));
    // A call that never ran is unmeasured, never a refusal (D-6034): `ran` is read before `ok`.
    if (res.ran === false || !res.ok) return unmeasured();
    stdout = res.stdout;
  } catch {
    return unmeasured();
  }
  const line = parsePrLines(stdout).find((l): l is CcdPrLine => isFullLine(l) && l.id === sessionId);
  const readAt = deps.now();
  if (line === undefined) return { readAt, openPr: null, unpushed: null };
  const openPr = line.rows.some((r) => r.state === 'OPEN' && (r.headRefName === undefined || r.headRefName === line.branch));
  const unpushed = line.ahead === null ? null : line.ahead > 0;
  return { readAt, openPr, unpushed };
}

/** E5's R6 read (D-8078): is a pull request OPEN from this branch, read by the head and never by `--session` (the session now
 *  belongs to a later run, so its own branch is another run's). One `pr-state --project` read; any open row whose head is the
 *  branch is a yes. A project the host cannot answer, a call that failed or an answer with no line at all is `null`: unmeasured,
 *  which refuses. */
export async function readBranchOpenPr(
  deps: { readonly runCcd: RunCcd; readonly fleetState?: FleetState | undefined },
  project: string, branch: string,
): Promise<boolean | null> {
  if (!ccdCan(deps.fleetState, 'prStateProject')) return null;
  let stdout: string;
  try {
    const res = await deps.runCcd(CCD_ARGV.prStateProject(project));
    if (res.ran === false || !res.ok) return null;
    stdout = res.stdout;
  } catch {
    return null;
  }
  const lines = parsePrLines(stdout).filter((l): l is CcdPrLine => isFullLine(l));
  if (lines.length === 0) return null;
  return lines.some((l) => l.rows.some((r) => r.state === 'OPEN' && r.headRefName === branch));
}
