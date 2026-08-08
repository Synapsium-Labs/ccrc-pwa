import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { isFullLine, parsePrLines, phaseFor } from '../prstate.js';
import { readBranchTip } from './gitref.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { FleetIO } from '../io.js';
import type { Deps } from '../server.js';
import type { MailRejectCode, PrPhase } from '../../../shared/api.js';

const SHA = /^[0-9a-f]{40}$/;

/** What a `worker_done` claims (mail kind `status`, subject `wave-done` —
 *  spec:127-129). Every field is UNTRUSTED input off an HTTP body. */
export interface DoneClaim {
  branchTip: string;
  prNumber: number | null;
  prPhase: PrPhase;
  handoffCommit: string;
}

export type DoneVerdict =
  | { ok: true; measured: { branchTip: string; prNumber: number | null; prPhase: PrPhase } }
  | { ok: false; code: Extract<MailRejectCode,
      'stale-tip' | 'tip-unmeasurable' | 'pr-regressed' | 'pr-unmeasurable' | 'no-handoff-commit'>;
      detail: string };

/** `verifyDone`'s two object parameters, named rather than inlined: the
 *  verb-gate scanner (`verb-gate.test.ts`) recognises an enclosing function by
 *  matching the WHOLE signature on the single line that carries the opening
 *  `{` (deliberately — see that file's own docstring on what the scan does
 *  and does not cover), and an inline multi-line object-type parameter pushes
 *  the `{` onto its own line, which the scanner then cannot resolve to this
 *  function at all — the call site would report `gated: false` regardless of
 *  the `verbSupported(` call two lines below it. Naming the types keeps the
 *  signature, params and return type on one line. */
export interface VerifyDoneDeps { io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState }
export interface DoneRun { sessionId: string; project: string; branch: string }

/**
 * A PR phase that has gone BACKWARDS since the worker looked. Forward motion is
 * not a mismatch: a PR that merged after the worker reported it open is the run
 * succeeding, not a stale claim.
 *
 * `unchecked`/`unknown` are neither — they are FAILED READS (`shared/api.ts`'s
 * `PrReason` docstring makes that split explicit) and get their own code, so a
 * GitHub outage can never read as "the PR regressed" or, worse, as agreement.
 */
function prVerdict(claimed: PrPhase, measured: PrPhase): 'ok' | 'regressed' | 'unmeasurable' {
  if (measured === 'unknown' || measured === 'unchecked') return 'unmeasurable';
  if (measured === 'closed' && claimed !== 'closed') return 'regressed';
  if (claimed === 'merged' && measured !== 'merged') return 'regressed';
  if ((claimed === 'open' || claimed === 'draft') &&
      (measured === 'none' || measured === 'no-commits')) return 'regressed';
  return 'ok';
}

/**
 * Re-measure a done claim. THE RUN IS NOT TOUCHED HERE — this answers, and the
 * route decides; a verifier that also advanced would be a verifier nobody can
 * call twice.
 *
 * WHAT IS RE-MEASURED, AND WHAT IS NOT (deviation D-2, stated here because this
 * is where a future reader will look for the guarantee):
 *  - `branchTip` — measured, from git's own ref files (`gitref.ts`).
 *  - `prNumber`/`prPhase` — measured, through `ccd pr-state --session`, the
 *    same verb and the same parser the PR lane already uses. Never `gh`: there
 *    is no `gh` key in the agent's whitelist and there must not be one
 *    (`agent/src/whitelist.ts:296-303`).
 *  - `handoffCommit` — CORRESPONDENCE ONLY. The server cannot read a commit
 *    object (no git, and `FleetIO` reads bytes), so it cannot tell whether the
 *    commit edits `docs/superpowers/programs/<slug>.md`. What it CAN prove is
 *    that the worker's own two facts agree and that the tip is real. Whether
 *    the commit is a real handoff is the coordinator's ordinary review of the
 *    diff — spec:246-252, "briefs are written prose reviewed like code". Do
 *    not let a later reader mistake this token for the stronger claim.
 */
export async function verifyDone(deps: VerifyDoneDeps, run: DoneRun, claim: DoneClaim): Promise<DoneVerdict> {
  // Cheapest first, and it is also the one that needs no I/O: a claim whose own
  // two facts disagree is rejected before the fleet is touched at all.
  if (!SHA.test(claim.handoffCommit) || !SHA.test(claim.branchTip) ||
      claim.handoffCommit !== claim.branchTip) {
    return { ok: false, code: 'no-handoff-commit',
      detail: 'handoffCommit must be the 40-hex sha this same claim reports as branchTip' };
  }

  const tip = await readBranchTip(deps.io, deps.cfg.projectsRoot, run.project, run.branch);
  if (tip === null) {
    return { ok: false, code: 'tip-unmeasurable',
      detail: `no readable ref for ${run.branch} under ${run.project}` };
  }
  if (tip !== claim.branchTip) {
    return { ok: false, code: 'stale-tip',
      detail: `${run.branch} is at ${tip}, the claim says ${claim.branchTip}` };
  }

  const argv = CCD_ARGV.prStateSession(run.sessionId);
  if (!verbSupported(deps.fleetState, argv)) {
    return { ok: false, code: 'pr-unmeasurable', detail: 'the fleet host cannot answer pr-state' };
  }
  const res = await deps.runCcd(argv);
  if (!res.ok) return { ok: false, code: 'pr-unmeasurable', detail: res.stderr.trim() };
  const line = parsePrLines(res.stdout).find(isFullLine);
  if (!line) return { ok: false, code: 'pr-unmeasurable', detail: 'pr-state answered no full line' };
  const measured = phaseFor(line);

  const verdict = prVerdict(claim.prPhase, measured.phase);
  if (verdict === 'unmeasurable') {
    return { ok: false, code: 'pr-unmeasurable', detail: `pr-state answered ${measured.phase}` };
  }
  if (verdict === 'regressed') {
    return { ok: false, code: 'pr-regressed',
      detail: `the claim says ${claim.prPhase}, the PR is ${measured.phase}` };
  }
  if (claim.prNumber !== null && measured.number !== null && claim.prNumber !== measured.number) {
    return { ok: false, code: 'pr-regressed',
      detail: `the claim names PR #${claim.prNumber}, the branch is bound to #${measured.number}` };
  }
  return { ok: true, measured: { branchTip: tip, prNumber: measured.number, prPhase: measured.phase } };
}
