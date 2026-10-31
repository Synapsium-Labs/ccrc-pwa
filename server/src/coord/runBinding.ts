import { TERMINAL_RUN_STATES, type RunState } from '../../../shared/api.js';
import type { ChildBirth } from './childSpent.js';

/**
 * The run binding (ARCH-60, GitHub #795; epic #771; consolidation spec §3 K10). L1: no `fs`, no store, no clock, and no
 * act. A `RunBinding` is the one link between a coordinator's run and the worker session that does it. It is keyed on
 * the worker's INCARNATION (the session id plus the birth the server stamped when that occupant was minted), never on
 * the bare id string. A workspace name is reused (the slug picker only checks the registry's files), so the id string
 * alone lets a run opened for an earlier occupant answer for a later one: that is #746 (a "coordinator gone" card on a
 * live child) and the ghost parent D6 (#758, decision D-5920) names.
 *
 * WHAT IS STORED, WHAT IS DERIVED. Nothing here is stored. The binding is DERIVED from the run series the store
 * answers (`CoordStore.bindingRunsOf`), exactly as `parentOfSession` always derived the parent, so `reclaimProgram`'s
 * rewrite of `claimedBy` is followed for free. It is WRITTEN only by the run lifecycle: `openRun` (the open route binds
 * a named workspace), `dispatchRun` (binds and clears), `closeRun` (ends it, by the run's state) and `reclaimProgram`
 * (moves the claimant). `BINDING_WRITER_FILES` and `bindingWriterCalls` are the pin on that.
 *
 * THE INCARNATION. `born` carries the birth of the occupant's minting run (`childBirthOf`, `coord/childSpent.ts`, the
 * ONE reading of it). `unborn` is every session that has no placeable birth: a coordinator or a manual workspace (no
 * `.child` marker, `not-a-child`) and a child whose birth cannot be placed (`unplaceable`). Those keep the rule that
 * held before this file (the id string), so a refactor that moves the readers changes no answer for them; the word
 * says which kind of unknown it is, so a caller that must treat the two differently can.
 *
 * WHICH RUNS BIND A BORN INCARNATION. A run names the session, and
 *   - carries a birth: it binds iff that birth is THIS incarnation's (same instant, recorded for this session id);
 *   - carries none (a run bound before this build's stamp, or to a session that never had a placeable birth): opened at or
 *     after the birth it binds; opened BEFORE the birth it is UNDECIDABLE, a third answer and not `false`. Two histories
 *     produce that row and the columns cannot tell them apart: a ghost (#746, #758: the run was opened for an earlier
 *     occupant of a reused name) and a live binding (`openRun`'s dup arm returns the planned run with its original
 *     `openedAt`, and the open route then binds it). An undecidable run is never a parent, a claimant or a child (no
 *     ghost coordinator), and is never dropped: `bindingOf` lists it in `undecided`. Since ARCH-62 slice 4 (#1407)
 *     `CoordStore.bindSession` records the occupant's birth on a later wave it binds (`stampOccupantBirth`), so a run
 *     bound to the live worker is `bound` and a run bound to an earlier occupant is `unbound`, whatever its `openedAt`;
 *     the undecidable arm is left for rows bound before the stamp. An `unborn` session that reuses a name keeps the
 *     id-string rule (gap 1 of #1407, tracked in #1532). One LEGACY exception, accepted and pinned
 *     (`run-binding-bound-birth.test.ts`): migration 16's backfill dated every bound run to its OWN `dispatchStartedAt`,
 *     later waves included, so for a worker alive across that migration the newest placeable birth of its id can be a
 *     backfilled wave-N row rather than its minting run. A wave bound after this build is then stamped with that
 *     wave-N instant and reads `unbound` for the live occupant, as the backfilled wave-N row itself already does. The
 *     columns cannot tell a backfilled wave-N row from a minting run, so the stamp does not guess; such workers age out.
 *
 * TWO QUERIES, NAMED. `newest` is the newest run that binds the incarnation in ANY state (the card's `session.run`);
 * `open` is the newest that is not terminal (`session.openRun`). A state this build cannot name counts as open, as
 * every session-keyed reader of the store counts it. The parent is the open run's claimant; an ownerless open run
 * makes the parent `null` (`parentOfSession`'s `LIMIT 1`), and is no entry in `claimantsOf`.
 */

declare const incarnationBrand: unique symbol;

/** Why an incarnation has no birth: no marker names a minting run, or the marker's run could not place one. */
export type UnbornWhy = 'not-a-child' | 'unplaceable';

type IncarnationShape =
  | { readonly kind: 'born'; readonly sessionId: string; readonly bornAt: number }
  | { readonly kind: 'unborn'; readonly sessionId: string; readonly why: UnbornWhy };

/** A worker session's incarnation: the session id plus the birth of its current occupant. Built only by the three
 *  constructors below, so a bare id string cannot stand in for one. */
export type Incarnation = IncarnationShape & { readonly [incarnationBrand]: true };

export const bornIncarnation = (sessionId: string, bornAt: number): Incarnation =>
  ({ kind: 'born', sessionId, bornAt }) as Incarnation;

export const unbornIncarnation = (sessionId: string, why: UnbornWhy): Incarnation =>
  ({ kind: 'unborn', sessionId, why }) as Incarnation;

/** The incarnation of a child whose minting run answered `birth` (`childBirthOf`). */
export const incarnationOf = (sessionId: string, birth: ChildBirth): Incarnation =>
  birth.kind === 'at' ? bornIncarnation(sessionId, birth.ms) : unbornIncarnation(sessionId, 'unplaceable');

/** The columns of a run the binding reads: `CoordStore.bindingRunsOf`'s row, and satisfied structurally by `RunRow`. */
export interface BindingRun {
  readonly id: number;
  readonly sessionId: string | null;
  readonly claimedBy: string | null;
  readonly state: RunState;
  readonly openedAt: number;
  readonly sessionBornAt: number | null;
  readonly sessionBornFor: string | null;
}

/** Whether `run` binds `incarnation`: yes, no, or `'undecidable'` (an unstamped run opened before the birth). */
export type RunBinds = 'bound' | 'unbound' | 'undecidable';

/** Whether `run` names `sessionId` as its worker: the id-string rule, the first test of `bindsRun` and the whole test for a
 *  caller that holds ONE run (the minting run of a child's marker, a hold candidate) and no series. It proves no birth, so a
 *  decision that must tell one occupant of a reused name from another reads the series through `bindingOf` instead. */
export const runNamesSession = (run: { readonly sessionId: string | null }, sessionId: string): boolean => run.sessionId === sessionId;

/** Whether `run` is bound to `incarnation`, by the rules above. */
export function bindsRun(incarnation: Incarnation, run: BindingRun): RunBinds {
  if (!runNamesSession(run, incarnation.sessionId)) return 'unbound';
  if (incarnation.kind === 'unborn') return 'bound';
  if (run.sessionBornAt !== null) {
    return run.sessionBornFor === incarnation.sessionId && run.sessionBornAt === incarnation.bornAt ? 'bound' : 'unbound';
  }
  return run.openedAt >= incarnation.bornAt ? 'bound' : 'undecidable';
}

const binds = (incarnation: Incarnation, run: BindingRun): boolean => bindsRun(incarnation, run) === 'bound';

export const isOpen = (run: BindingRun): boolean => !(TERMINAL_RUN_STATES as readonly RunState[]).includes(run.state);

/** The two named queries over one incarnation: the newest bound run in any state, and the newest open one. */
export interface SessionBinding {
  readonly newest: BindingRun | null;
  readonly open: BindingRun | null;
  /** Runs naming the session that neither bind nor are known not to (`'undecidable'`), newest first. Never a parent. */
  readonly undecided: readonly BindingRun[];
}

const byIdDesc = (a: BindingRun, b: BindingRun): number => b.id - a.id;

export function bindingOf(runs: readonly BindingRun[], incarnation: Incarnation): SessionBinding {
  const bound = runs.filter((r) => binds(incarnation, r)).sort(byIdDesc);
  const undecided = runs.filter((r) => bindsRun(incarnation, r) === 'undecidable').sort(byIdDesc);
  return { newest: bound[0] ?? null, open: bound.find(isOpen) ?? null, undecided };
}

/** The worker's parent: the claimant of its open binding, `null` when it has none or the open run is ownerless. */
export const parentOf = (binding: SessionBinding): string | null => binding.open?.claimedBy ?? null;

/** `parentOf`, or else the claimant of an UNDECIDED open run that `minter` also claims: a run planned before the worker's
 *  birth and then bound to it (the openRun dup arm, a wave N >= 2 run) is a real binding `bindsRun` cannot prove, and its
 *  claimant is the minting run's own, so it cannot be a ghost of another programme. Undecided runs of other claimants stay
 *  excluded (#746, D6 of D-5920). */
export function parentOrMinter(binding: SessionBinding, minter: string | null): string | null {
  const proven = parentOf(binding);
  if (proven !== null || minter === null) return proven;
  return binding.undecided.find((r) => isOpen(r) && r.claimedBy === minter)?.claimedBy ?? null;
}

/** Whether the series holds an OPEN run that names the session but that the binding cannot place (`undecided`) and that
 *  records no claimant. It still counts as a sibling, as every reader counted it before the binding (the ruling on ARCH-62
 *  slice 1): the child keeps a run it cannot prove, so it is `run-unclaimed`, not "no run names it". */
export const hasOwnerlessUndecidedOpen = (binding: SessionBinding): boolean =>
  binding.undecided.some((r) => isOpen(r) && r.claimedBy === null);

/** A child's parent, decided once for every caller (heldFor, the drift lane): the claimant of its open binding, else
 *  `parentOrMinter` over the same series, so a run planned before the birth and bound to it (wave N >= 2) keeps the
 *  minting run's claimant while a ghost of another programme never becomes the parent. `runs` is the store's
 *  `bindingRunsOf` series for the child; `minter` the claimant of the run the child's mark names. */
export function childParentOf(runs: readonly BindingRun[], minter: string | null, incarnation: Incarnation): string | null {
  return parentOrMinter(bindingOf(runs, incarnation), minter);
}

/** EVERY coordinator that currently has this incarnation working for it, newest open run first, each once. */
export function claimantsOf(runs: readonly BindingRun[], incarnation: Incarnation): string[] {
  const seen = new Set<string>();
  for (const r of runs.filter((x) => binds(incarnation, x) && isOpen(x)).sort(byIdDesc)) {
    if (r.claimedBy !== null) seen.add(r.claimedBy);
  }
  return [...seen];
}

/** Every run that binds `incarnation`, by id: in any state, or only the open ones. The readers that list a worker's runs
 *  (`CoordStore.runsNamingSession`, `openRunsForSession`) project this; `bindingOf` answers the newest and the open one. */
export function boundRunsOf(runs: readonly BindingRun[], incarnation: Incarnation, which: 'any' | 'open'): BindingRun[] {
  return runs.filter((r) => binds(incarnation, r) && (which === 'any' || isOpen(r))).sort((a, b) => a.id - b.id);
}

/** The open runs `coordinatorId` claims whose worker is the incarnation they were opened for, in id order. A run that
 *  names no session is no child yet and is not listed. `incarnationFor` is the worker's CURRENT incarnation. */
export function childrenOf(
  runs: readonly BindingRun[], coordinatorId: string, incarnationFor: (sessionId: string) => Incarnation,
): BindingRun[] {
  return runs
    .filter((r) => r.claimedBy === coordinatorId && r.sessionId !== null && isOpen(r) && binds(incarnationFor(r.sessionId), r))
    .sort((a, b) => a.id - b.id);
}

/** One run's names and interval, as the delegation frame's R9 reads them (`CoordStore.delegationRunStamps`). */
export interface StampedRun {
  readonly id: number; readonly sessionId: string | null; readonly claimedBy: string | null; readonly openedAt: number; readonly closedAt: number | null;
}

/** R9 (delegation broker wave 4): the coordinator `sessionId` worked for at the instant `at` (epoch ms): the claimant, other than
 *  the session itself, of a run that names it as worker and whose interval `[openedAt, closedAt ?? +inf]` holds `at`; the greatest
 *  run id when several do, `null` when none does. A closed run still answers inside its interval (lineage outlives its run), and
 *  the answer is never asked again (nesting is one level). Legitimately different from `bindingOf`: that decides a session's
 *  CURRENT binding by its birth; this asks about a past instant, so the instant binds the run and the id-string rule names it. */
export function claimantAt(runs: readonly StampedRun[], sessionId: string, at: number): string | null {
  let best: StampedRun | null = null;
  for (const r of runs) {
    if (!runNamesSession(r, sessionId) || r.claimedBy === null || r.claimedBy === sessionId) continue;
    if (r.openedAt > at || (r.closedAt !== null && r.closedAt < at)) continue;
    if (best === null || r.id > best.id) best = r;
  }
  return best?.claimedBy ?? null;
}

/** The store verbs that write the binding: bind or move a run's worker, clear it, and move the claimant. */
export const BINDING_WRITER_VERBS: readonly string[] = ['openRun', 'bindSession', 'setSession', 'clearSession', 'markDispatched', 'reclaimProgram'];

/** The only files that may call them: the store itself, the open route, `dispatchRun` and the reclaim door. */
export const BINDING_WRITER_FILES: readonly string[] = [
  'server/src/coord/store.ts', 'server/src/coord/routes.ts', 'server/src/coord/dispatch.ts', 'server/src/coord/reclaim.ts',
];

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Every call of a binding write verb in `files` (a method call, `.verb(`; definitions and comments are not calls). */
export function bindingWriterCalls(files: readonly { file: string; text: string }[]): { file: string; verb: string }[] {
  const hits: { file: string; verb: string }[] = [];
  for (const { file, text } of files) {
    const code = stripComments(text);
    for (const verb of BINDING_WRITER_VERBS) {
      if (new RegExp(`\\.${verb}\\(`).test(code)) hits.push({ file, verb });
    }
  }
  return hits;
}
