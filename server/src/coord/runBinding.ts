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
 * says which kind of unknown it is, so a caller that must treat the two differently can. The one exception is below
 * (`anchoredIncarnation`): an `unplaceable` child whose own minting run still records its birth, and no newer one is on
 * record for the id.
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
 *     the undecidable arm is left for rows bound before the stamp. A worker whose OWN minting run recorded its birth but
 *     whose dispatch moved since (`unplaceable` with `recordedAt`, the re-stamped arm of `childBirthOf`) is that birth
 *     when it is the newest birth the worker's series records for the id (`anchoredIncarnation`, which every reader that
 *     holds the series applies before `bindsRun`), so an earlier occupant's run is `unbound`. That is the birth the stamp
 *     writes on a later wave (`occupantBirthOf`), so the two halves agree. When the series records a NEWER birth for the id
 *     (a cross-build rollback redrew the name on the minting run after a later mint), the stamp and the run's own birth
 *     disagree, and the worker keeps the id-string rule. Every other unborn session keeps it too: an adopted worker
 *     (D-6993: its minting run records no birth, and a birth another run recorded for the id may be an earlier
 *     occupant's, so it is never borrowed), a minting run that is absent, rebound or unreadable, and a `not-a-child`
 *     session (gap 1 of #1407, tracked in #1532). The stamp refuses the same borrowing: a wave bound after a run of the
 *     series adopted the name records no birth (`occupantBirthOf`). One LEGACY exception,
 *     accepted and pinned
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
  | { readonly kind: 'unborn'; readonly sessionId: string; readonly why: UnbornWhy;
      /** The birth the occupant's OWN minting run recorded for it when that run's dispatch moved since (`ChildBirth`'s
       *  `recorded`, the re-stamped arm). Absent on every other unborn session: no run of its own dates it. */
      readonly recordedAt?: number };

/** A worker session's incarnation: the session id plus the birth of its current occupant. Built only by the three
 *  constructors below, so a bare id string cannot stand in for one. */
export type Incarnation = IncarnationShape & { readonly [incarnationBrand]: true };

export const bornIncarnation = (sessionId: string, bornAt: number): Incarnation =>
  ({ kind: 'born', sessionId, bornAt }) as Incarnation;

export const unbornIncarnation = (sessionId: string, why: UnbornWhy, recordedAt?: number): Incarnation =>
  (recordedAt === undefined ? { kind: 'unborn', sessionId, why } : { kind: 'unborn', sessionId, why, recordedAt }) as Incarnation;

/** The incarnation of a child whose minting run answered `birth` (`childBirthOf`). An unplaceable birth keeps the one
 *  instant its own minting run recorded for it, if any (`recorded`): `anchoredIncarnation` reads that and nothing else. */
export const incarnationOf = (sessionId: string, birth: ChildBirth): Incarnation =>
  birth.kind === 'at' ? bornIncarnation(sessionId, birth.ms) : unbornIncarnation(sessionId, 'unplaceable', birth.recorded);

/** The columns of a run the binding reads: `CoordStore.bindingRunsOf`'s row, and satisfied structurally by `RunRow`. */
export interface BindingRun {
  readonly id: number;
  readonly sessionId: string | null;
  readonly claimedBy: string | null;
  readonly state: RunState;
  readonly openedAt: number;
  readonly sessionBornAt: number | null;
  readonly sessionBornFor: string | null;
  /** When the run's fresh-spawn dispatch began (`CoordStore.markDispatchStarted`, the fresh-spawn arm only), or `null`.
   *  Read by `occupantBirthOf` alone: a run that names the session, records no birth and was dispatched after a birth on
   *  record is an ADOPTION (`dispatch.ts#spawnFresh`, D-6993). */
  readonly dispatchStartedAt: number | null;
}

/** Whether `run` binds `incarnation`: yes, no, or `'undecidable'` (an unstamped run opened before the birth). */
export type RunBinds = 'bound' | 'unbound' | 'undecidable';

/** Whether `run` names `sessionId` as its worker: the id-string rule, the first test of `bindsRun` and the whole test for a
 *  caller that holds ONE run (the minting run of a child's marker, a hold candidate) and no series. It proves no birth, so a
 *  decision that must tell one occupant of a reused name from another reads the series through `bindingOf` instead. */
export const runNamesSession = (run: { readonly sessionId: string | null }, sessionId: string): boolean => run.sessionId === sessionId;

/** Whether `run` is bound to `incarnation`, by the rules above. ONE run, no series: a reader that holds the worker's series
 *  anchors first (`anchoredIncarnation`, as `bindingOf`, `claimantsOf` and `boundRunsOf` do), and `childrenOf` is handed
 *  incarnations anchored where the worker's series was read (`runWire.incarnationsOfSessions`). An unanchored `recordedAt`
 *  is read as what it is, an unborn incarnation: the id-string rule. */
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

/** Every birth a run of `runs` recorded FOR `sessionId`, whatever the run names now: the births the stamp and the anchor
 *  both read, so the two halves read the same set. */
const birthsOnRecord = (runs: readonly BindingRun[], sessionId: string): number[] =>
  runs.filter((r) => r.sessionBornFor === sessionId && r.sessionBornAt !== null).map((r) => r.sessionBornAt as number);

/** The birth a LATER wave bound to `sessionId` records (`CoordStore.stampOccupantBirth` writes this, over `bindingRunsOf`'s
 *  series): the NEWEST birth any run of the series recorded for the id, so a moved `dispatchStartedAt` on the minting run
 *  (the re-stamped arm of `childBirthOf`) does not stop the stamp. `null`, and no stamp, when no run recorded one, AND when
 *  that birth was not provably minted by the occupant's own run: a run of the series names the session, records no birth
 *  and was dispatched after it (`dispatchStartedAt` later than the birth). That run ADOPTED a workspace under the name
 *  (`dispatch.ts#spawnFresh`'s adopted arm, D-6993), so the newest birth on record can be an EARLIER occupant's, and
 *  stamping it would date the adopted worker's wave to that occupant. Every fresh spawn records its birth as its own
 *  `dispatchStartedAt`, so no fresh mint is mistaken for an adoption. The anchor reads a re-stamped minting run's own birth
 *  only when it is this one (`anchoredIncarnation`), so a wave this stamps binds the worker the anchor names. */
export function occupantBirthOf(runs: readonly BindingRun[], sessionId: string): number | null {
  const births = birthsOnRecord(runs, sessionId);
  if (births.length === 0) return null;
  const newest = Math.max(...births);
  const adoptedSince = runs.some((r) => runNamesSession(r, sessionId) && r.sessionBornAt === null
    && r.dispatchStartedAt !== null && r.dispatchStartedAt > newest);
  return adoptedSince ? null : newest;
}

/** The incarnation every reader decides with, over `runs`, the WORKER's series (`CoordStore.bindingRunsOf`). An
 *  `unplaceable` incarnation whose OWN minting run recorded a birth for it (`recordedAt`, the re-stamped arm of
 *  `childBirthOf`: the run's `dispatchStartedAt` moved after the birth) is that birth, so a run recorded for an older birth
 *  belongs to an earlier occupant of the name and is `unbound`, ONLY while no run of the series records a NEWER birth for
 *  the id. That newest birth is what the stamp writes on a later wave (`occupantBirthOf`), so anchored and stamped agree.
 *  A newer birth on record means the minting run's birth is not the newest: a cross-build rollback redrew the name on that
 *  run after a later mint, and the live occupant's own new-build waves carry the newer birth. The anchor would then drop
 *  them and keep a dead coordinator's wave, so the incarnation keeps the id-string rule instead (`recordedAt` dropped),
 *  as every unplaceable worker read on the merge base. Every other incarnation is itself, and an unborn one keeps the
 *  id-string rule: an adopted worker (its minting run records no birth, D-6993), a minting run that is absent, rebound or
 *  unreadable, and a `not-a-child` session (gap 1 of #1407, tracked in #1532). A birth some OTHER run recorded for the id
 *  is never anchored to: under a recycled name it is an earlier occupant's, and anchoring to it would make that
 *  occupant's open run the parent (D6, D-5920). Idempotent: its answer carries no `recordedAt`. */
export function anchoredIncarnation(runs: readonly BindingRun[], incarnation: Incarnation): Incarnation {
  if (incarnation.kind !== 'unborn' || incarnation.recordedAt === undefined) return incarnation;
  const { sessionId, why, recordedAt } = incarnation;
  const newerOnRecord = birthsOnRecord(runs, sessionId).some((at) => at > recordedAt);
  return newerOnRecord ? unbornIncarnation(sessionId, why) : bornIncarnation(sessionId, recordedAt);
}

export function bindingOf(runs: readonly BindingRun[], rawIncarnation: Incarnation): SessionBinding {
  const incarnation = anchoredIncarnation(runs, rawIncarnation);
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
export function claimantsOf(runs: readonly BindingRun[], rawIncarnation: Incarnation): string[] {
  const incarnation = anchoredIncarnation(runs, rawIncarnation);
  const seen = new Set<string>();
  for (const r of runs.filter((x) => binds(incarnation, x) && isOpen(x)).sort(byIdDesc)) {
    if (r.claimedBy !== null) seen.add(r.claimedBy);
  }
  return [...seen];
}

/** Every run that binds `incarnation`, by id: in any state, or only the open ones. The readers that list a worker's runs
 *  (`CoordStore.runsNamingSession`, `openRunsForSession`) project this; `bindingOf` answers the newest and the open one. */
export function boundRunsOf(runs: readonly BindingRun[], rawIncarnation: Incarnation, which: 'any' | 'open'): BindingRun[] {
  const incarnation = anchoredIncarnation(runs, rawIncarnation);
  return runs.filter((r) => binds(incarnation, r) && (which === 'any' || isOpen(r))).sort((a, b) => a.id - b.id);
}

/** The open runs `coordinatorId` claims whose worker is the incarnation they were opened for, in id order. A run that
 *  names no session is no child yet and is not listed. `incarnationFor` is the worker's CURRENT incarnation, ANCHORED over
 *  the worker's own series (`runWire.incarnationsOfSessions`): `runs` is the claimant's series, which need not hold the
 *  worker's newest birth, so it cannot anchor here. */
export function childrenOf(
  runs: readonly BindingRun[], coordinatorId: string, incarnationFor: (sessionId: string) => Incarnation,
): BindingRun[] {
  return runs
    .filter((r) => r.claimedBy === coordinatorId && r.sessionId !== null && isOpen(r) && binds(incarnationFor(r.sessionId), r))
    .sort((a, b) => a.id - b.id);
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
