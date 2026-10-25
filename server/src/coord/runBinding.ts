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
 *   - carries none (a later wave opened on a worker that already exists, which `bindSession` leaves unstamped): opened
 *     at or after the birth it binds; opened BEFORE the birth it is UNDECIDABLE, a third answer and not `false`. Two
 *     histories produce that row and the columns cannot tell them apart: a ghost (#746, #758: the run was opened for an
 *     earlier occupant of a reused name) and a live binding (`openRun`'s dup arm returns the planned run with its
 *     original `openedAt`, and the open route then binds it, so a run opened before the occupant was born is bound to
 *     it). Deviation from #758: the rule is not "a run opened before the birth cannot bind". An undecidable run is
 *     never a parent, a claimant or a child (no ghost coordinator), and is never dropped: `bindingOf` lists it in
 *     `undecided`, so a reader says "unknown" and not "coordinator gone". The exact answer needs the bind to record
 *     the incarnation it bound (a bound-birth column written by `bindSession`); that migration is a follow-up.
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

/** Whether `run` is bound to `incarnation`, by the rules above. */
export function bindsRun(incarnation: Incarnation, run: BindingRun): RunBinds {
  if (run.sessionId !== incarnation.sessionId) return 'unbound';
  if (incarnation.kind === 'unborn') return 'bound';
  if (run.sessionBornAt !== null) {
    return run.sessionBornFor === incarnation.sessionId && run.sessionBornAt === incarnation.bornAt ? 'bound' : 'unbound';
  }
  return run.openedAt >= incarnation.bornAt ? 'bound' : 'undecidable';
}

const binds = (incarnation: Incarnation, run: BindingRun): boolean => bindsRun(incarnation, run) === 'bound';

const isOpen = (run: BindingRun): boolean => !(TERMINAL_RUN_STATES as readonly RunState[]).includes(run.state);

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

/** EVERY coordinator that currently has this incarnation working for it, newest open run first, each once. */
export function claimantsOf(runs: readonly BindingRun[], incarnation: Incarnation): string[] {
  const seen = new Set<string>();
  for (const r of runs.filter((x) => binds(incarnation, x) && isOpen(x)).sort(byIdDesc)) {
    if (r.claimedBy !== null) seen.add(r.claimedBy);
  }
  return [...seen];
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
