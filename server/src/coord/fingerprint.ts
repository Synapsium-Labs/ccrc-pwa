import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { isFullLine, parsePrLines, phaseFor } from '../prstate.js';
import { measuredIdentity, readRegistryMeasured } from '../registry.js';
import { readBranchTip } from './gitref.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { FleetIO } from '../io.js';
import type { Deps } from '../server.js';
import { isPrPhase, type MailRejectCode, type PrPhase } from '../../../shared/api.js';

const SHA = /^[0-9a-f]{40}$/;

/** What a `worker_done` claims (mail kind `status`, subject `wave-done` —
 *  spec:127-129). Every field is UNTRUSTED input off an HTTP body, and the
 *  `PrPhase` annotation on `prPhase` is a TYPE, not a runtime guarantee: the
 *  route that builds this from JSON has no parse step named anywhere in the
 *  plan, so a body that omits the field, or spells it in a vocabulary an
 *  older/newer build used, arrives here as `undefined` or a bare string
 *  wearing this annotation. `verifyDone` validates both `prPhase` and
 *  `prNumber` itself, the same way it already validates `branchTip` and
 *  `handoffCommit` — `isPrPhase` is the only door (`shared/api.ts:263`). */
export interface DoneClaim {
  branchTip: string;
  prNumber: number | null;
  prPhase: PrPhase;
  handoffCommit: string;
}

export type DoneVerdict =
  | { ok: true; measured: { branchTip: string; prNumber: number | null; prPhase: PrPhase } }
  | { ok: false; code: Extract<MailRejectCode,
      'stale-tip' | 'tip-unmeasurable' | 'branch-unmeasurable' | 'pr-regressed' | 'pr-unmeasurable' |
      'no-handoff-commit'>;
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
/** `branch` here is a FALLBACK, not the measurement, and after Wave 3 §3.2 it
 *  is reached by EXACTLY ONE state: the live registry has no row for this
 *  session at all (retired, purged, or a narrowed drop `readRegistry` itself
 *  logs). The other three states this comment used to list are now refused
 *  above it rather than silently falling through — a failed directory listing
 *  and an unmeasurable identity were already refused `tip-unmeasurable`, and a
 *  found row whose own `.branch` is null is refused `branch-unmeasurable`.
 *  `DoneRun` reads field-for-field like the `runs` row it is usually built
 *  from (`RunRow`, `store.ts:40`) — but `runs.branch` is written exactly once,
 *  by `markDispatched` at dispatch time, and `FleetWatcher.sweepNames`
 *  (`watch.ts`) renames the registry's branch autonomously on the ordinary
 *  path (Wave 3 §3.1 stops it doing so DURING a claim, which is a narrowing,
 *  not a guarantee this column is fresh). Do not read this type as "the run's
 *  branch"; it is "the run's branch, if the live registry has nothing to say
 *  about this session at all" — and because `markDispatched` writes the column
 *  once and nothing updates it, every refusal produced from it says so in its
 *  own detail. */
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
 *  - `branchTip` — measured, from git's own ref files (`gitref.ts`), against
 *    the branch the LIVE REGISTRY names for this session, not `run.branch`
 *    (see `DoneRun`'s own docstring — `run.branch` is a stale DB column on the
 *    ordinary path, once `sweepNames` has renamed the workspace).
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
 *
 * The claim is UNTRUSTED (`DoneClaim`'s own docstring): `branchTip` and
 * `handoffCommit` are validated below by the same `SHA` regex; `prPhase` and
 * `prNumber` are validated the same way, through `isPrPhase` and a `typeof`
 * check, before either fact is re-measured — never trusted off the wire on
 * the strength of a TypeScript annotation the route's JSON parse cannot
 * enforce.
 */
export async function verifyDone(deps: VerifyDoneDeps, run: DoneRun, claim: DoneClaim): Promise<DoneVerdict> {
  // Cheapest first, and it is also the one that needs no I/O: a claim whose own
  // two facts disagree is rejected before the fleet is touched at all.
  if (!SHA.test(claim.handoffCommit) || !SHA.test(claim.branchTip) ||
      claim.handoffCommit !== claim.branchTip) {
    return { ok: false, code: 'no-handoff-commit',
      detail: 'handoffCommit must be the 40-hex sha this same claim reports as branchTip' };
  }
  // Still cheap, still no I/O: `prPhase`/`prNumber` are typed but never
  // parsed anywhere between the HTTP body and here (no route exists yet in
  // this PR, and Task 9's plan never names a parse step) — an omitted or
  // out-of-vocabulary `prPhase`, or a non-number `prNumber`, must be refused
  // here rather than fall through `prVerdict` unmatched and read as `ok`.
  if (!isPrPhase(claim.prPhase) || (claim.prNumber !== null && typeof claim.prNumber !== 'number')) {
    return { ok: false, code: 'pr-unmeasurable',
      detail: 'prPhase must be a recognised PrPhase and prNumber must be a number or null' };
  }

  // The registry's branch, not `run.branch` — see `DoneRun`'s docstring for
  // why the DB column cannot be trusted here. `record` is undefined on ONE
  // state after Wave 3 §3.2: the registry genuinely no longer carries a row
  // for this session (retired, purged; also a NARROWED drop, `registry.ts`'s
  // own `buildRecord` docstring — a triple member neither readable nor
  // listed, or measured-empty; both permanent, both logged there). The state
  // this comment used to list beside it — the row IS found and its own
  // `.branch` reads null — no longer reaches the fallback at all; the `??`
  // that let it through is now the explicit split below, and it REFUSES.
  // The other two gaps an earlier version confessed to — the whole-registry
  // listing failing outright (`io.readdir` -> null), and this session's row
  // being LISTED but its identity unmeasurable — were closed before this wave
  // and are refused `tip-unmeasurable` immediately below. A `worker_done`
  // this refuses is replayed and re-verified on the next sweep the same as
  // any other refusal (spec:174-177, D-10).
  const registryRead = await readRegistryMeasured(deps.io, deps.cfg);
  if (!registryRead.listed) {
    return { ok: false, code: 'tip-unmeasurable',
      detail: 'the registry directory could not be listed — transient, not a fact about this run' };
  }
  const record = registryRead.records.find((r) => r.id === run.sessionId);
  if (record !== undefined && measuredIdentity(record) === null) {
    return { ok: false, code: 'tip-unmeasurable',
      detail: `registry row for ${run.sessionId} is listed but its identity could not be measured — ` +
        'transient, not a fact about this run\'s branch' };
  }
  // WAVE 3 §3.2. The `??` this replaces collapsed two states the caller and
  // the coordinator handle differently — no overloaded null at a seam:
  //
  //  1. NO RECORD AT ALL (retired, purged, or a narrowed drop). `run.branch`
  //     is the only name left and it is worth using — but it is a column
  //     `markDispatched` wrote once at dispatch time and NOTHING ever
  //     updates, so any refusal it produces must say where it came from.
  //     Otherwise a coordinator reads "no readable ref for ws/quiet-mesa" and
  //     goes looking for a branch that was renamed hours ago.
  //  2. RECORD PRESENT, its own `.branch` null. The record DECLINED to name a
  //     branch; guessing with the frozen column is exactly the move that
  //     turns a transient registry read failure into a permanent
  //     `tip-unmeasurable` on a ref that will never exist. Refuse instead,
  //     and let the ordinary replay re-measure (spec:174-177, D-10).
  //
  // `branchEvidence` (registry.ts) is what lets case 2's detail be TRUE rather
  // than merely typed: a listed-but-unreadable `.branch` is transient, a
  // genuinely absent one is not, an EMPTY one is a half-written field, and one
  // sentence covering all three would be a lie about two of them.
  //
  // The empty rung arrived a wave later than the other two (review finding).
  // `field()` trims, so a zero-byte `.branch` used to read as `branch: ''`,
  // sail past the null check below, and be handed to `readBranchTip` as a
  // branch NAME — the refusal a coordinator then read was `tip-unmeasurable`
  // with an empty name in it ("no readable ref for  under demo"), which points
  // at the wrong half of the system. `registry.ts` now normalises it to null
  // at the read, so it arrives here as case 2 and refuses with its own reason.
  let branch: string;
  let branchFromRunRow = false;
  if (record === undefined) {
    branch = run.branch;
    branchFromRunRow = true;
  } else if (record.branch === null) {
    // Frozen-column caveat repeated in the two PERMANENT sentences and not in
    // the transient one: for `unreadable` the answer is "come back and ask
    // again", and telling a coordinator about the run row there would invite a
    // repair it does not need.
    const frozen = 'there is nothing to re-measure, and the run row\'s own branch column was ' +
      'frozen at dispatch time';
    return { ok: false, code: 'branch-unmeasurable',
      detail: record.branchEvidence === 'unreadable'
        ? `the registry lists ${run.sessionId}.branch but its bytes did not come back — ` +
          'transient, not a fact about this run'
        : record.branchEvidence === 'empty'
          ? `the registry's ${run.sessionId}.branch file is empty — a truncated or zero-byte ` +
            `write, not a branch name, so re-reading it will not help: ${frozen}`
          : `the registry row for ${run.sessionId} names no branch at all — ${frozen}` };
  } else {
    branch = record.branch;
  }
  /** Appended to every refusal below that NAMES `branch`, and only when the
   *  name came from the frozen run row. Empty on the ordinary path, so the
   *  coordinator is never told its measurement is stale when it is not. */
  const provenance = branchFromRunRow ? ' — from the run row, which predates any rename' : '';

  const tip = await readBranchTip(deps.io, deps.cfg.projectsRoot, run.project, branch);
  if (tip === null) {
    return { ok: false, code: 'tip-unmeasurable',
      detail: `no readable ref for ${branch} under ${run.project}${provenance}` };
  }
  if (tip !== claim.branchTip) {
    // F5 (build4 dogfood): a stale-tip that NEVER MOVES no matter how many
    // times the same claim is resubmitted is the signature of a brief that
    // told the worker to commit on a separate feature branch instead of this
    // workspace's own — the fingerprint re-measures `branch` (this run's
    // WORKSPACE branch), never a branch the brief merely mentioned, so real,
    // reviewed work sitting on the wrong branch reads exactly like a stale
    // claim forever. Naming that here (not a behaviour change — the code and
    // the refusal are unchanged) is one line a future coordinator can read
    // without having lived through the dogfood that found it.
    return { ok: false, code: 'stale-tip',
      detail: `${branch}${provenance} is at ${tip}, the claim says ${claim.branchTip} — if the worker committed ` +
        'on a DIFFERENT branch than this workspace\'s own, that is the almost-certain cause: the brief ' +
        'must instruct the worker to commit on its workspace branch, never a separate feature branch' };
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
