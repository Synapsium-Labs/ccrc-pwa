import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { isFullLine, parsePrLines, phaseFor } from '../prstate.js';
import { readRegistry } from '../registry.js';
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
/** `branch` here is a FALLBACK, not the measurement: `verifyDone` resolves the
 *  branch to re-measure against from the LIVE registry, keyed on `sessionId`,
 *  and falls back to this field whenever that lookup does not hand back a
 *  branch — which is NOT only "the registry row is gone entirely". See the
 *  `record?.branch ?? run.branch` call site in `verifyDone` for the other
 *  reachable triggers (a failed registry directory listing, an incomplete row
 *  `readRegistry` itself drops, and a found row whose own `.branch` field is
 *  null) — this comment used to name only the first and call it exhaustive,
 *  which it never was. `DoneRun` reads field-for-field like the `runs` row it
 *  is usually built from (`RunRow`, `store.ts:40`) — but `runs.branch` is
 *  written exactly once, by `markDispatched` at dispatch time, and
 *  `FleetWatcher.sweepNames` (`watch.ts:543-610`) renames the registry's
 *  branch autonomously, on the ordinary path, strictly before the first push
 *  — i.e. before any `worker_done` this claim could be. Do not read this
 *  type as "the run's branch"; it is "the run's branch, if the live registry
 *  could not name a better one just now". */
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
  // why the DB column cannot be trusted here. `record` is undefined — sending
  // this to the `run.branch` fallback below — on (at least) THREE distinct
  // states, only one of which is "this session retired":
  //  1. TERMINAL — the registry genuinely no longer carries a row for this
  //     session (retired, purged). The only case an earlier version of this
  //     comment named, as if it were the only one.
  //  2. TRANSIENT — `readRegistry`'s own directory listing failed outright
  //     (`io.readdir` -> null -> every row, not just this one, reads as
  //     absent — `registry.ts:104`); in remote mode that is a single failed
  //     agent-WS round trip, not evidence anything retired.
  //  3. TRANSIENT — this session's row IS present in the listing but
  //     `readRegistry` drops it silently for having a missing/unreadable
  //     `wrapper`/`workdir`/`uuid` field (`registry.ts:123`, "incomplete
  //     registry entry — skip, don't crash").
  // A FOURTH state reaches this same `run.branch` fallback WITHOUT `record`
  // ever being undefined at all: the row is found, but its own `.branch`
  // field reads null (absent, or unreadable the same way `field()` collapses
  // any read failure — `registry.ts:77-80`), and the `??` below falls back on
  // THAT null, not on a missing record.
  // Nothing on `SessionRecord` today lets a caller tell the transient states
  // (2, 3, 4) apart from the terminal one (1) or from each other — the
  // fallback is approximate in all four, not just the one case this comment
  // used to admit to. It is tolerable rather than a correctness gap because a
  // stale `run.branch` still degrades to a typed `tip-unmeasurable` refusal
  // (never a false accept — see `readBranchTip`), and a `worker_done` this
  // resolves wrong is replayed and re-verified on the next sweep the same as
  // any other refusal (spec:174-177, D-10).
  const record = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === run.sessionId);
  const branch = record?.branch ?? run.branch;

  const tip = await readBranchTip(deps.io, deps.cfg.projectsRoot, run.project, branch);
  if (tip === null) {
    return { ok: false, code: 'tip-unmeasurable',
      detail: `no readable ref for ${branch} under ${run.project}` };
  }
  if (tip !== claim.branchTip) {
    return { ok: false, code: 'stale-tip',
      detail: `${branch} is at ${tip}, the claim says ${claim.branchTip}` };
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
