import type { ChildMark, RunSummary } from '../../../shared/api.js';
import type { BindingReadPort } from './bindingReads.js';
import { childBirthOf } from './childSpent.js';
import type { RunVerdicts } from './runVerdicts.js';
import type { WorkerSeenReader } from './workerSeen.js';
import { childrenOf, incarnationOf, unbornIncarnation, type Incarnation } from './runBinding.js';

/**
 * The run binding as it rides the wire (ARCH-61 server half, GitHub #796; epic #771; consolidation spec §3 K10, §5.9). No I/O:
 * every function takes the store through a consumer-declared port (`BindingReadPort`) and decides through `bindingOf` and
 * `childrenOf` (`coord/runBinding.ts`), the one place that says which run is a session's. Nothing here compares a run's
 * `sessionId` or `claimedBy` to a session id.
 *
 * TWO WIRE FIELDS, both computed by the server once per frame it builds and sent additively (`FLEET_PROTO` is not bumped; an
 * older peer omits them and a reader tolerates the absence through `sessionRunOf` and `childIdsOf`):
 *   - `FleetSession.run` / `FleetSession.openRun`: the newest run naming the session's incarnation in any state, and the
 *     newest open one (`SessionBinding.newest` / `.open`). Sent by `assembleFleet`.
 *   - `RunSummary.childIds`: `childrenOf(claimant)`, the open runs the run's coordinator has working for it, each bound to the
 *     incarnation of the worker it was opened for. Sent on the live `{type:'runs'}` frame.
 *
 * And a third, beside them on the same frame and on the same terms (D-7334, programme-boxes spec §2.5): `RunSummary.lastMoveAt`,
 * the run's newest move as `CoordStore.runLastMoves` reads it, carried by `withLastMoves` below.
 *
 * THE INCARNATION OF A SESSION is read from its registry mark exactly as `heldFor` and the drift lane read it: a `.child`
 * mark names the minting run, `childBirthOf` places that run's birth, and a session with no mark (a coordinator, a manual
 * workspace) or a mark that cannot be read has no birth and keeps the id-string rule. A worker the registry no longer lists
 * is read as a session with no mark, which is the rule every reader had before the binding.
 */

/** The incarnation of `sessionId` whose registry mark is `child`. A `child` mark reads its minting run through `port.run`;
 *  that read can fail, and then the birth is unplaceable (`childBirthOf`'s own word), never an empty answer. */
export function incarnationOfMark(port: Pick<BindingReadPort, 'run'>, sessionId: string, child: ChildMark): Incarnation {
  switch (child.kind) {
    case 'child': {
      const minting = port.run(child.runId);
      return incarnationOf(sessionId, childBirthOf(minting, sessionId), minting.ok ? minting.run : null);
    }
    case 'unreadable': return unbornIncarnation(sessionId, 'unplaceable');
    case 'none': return unbornIncarnation(sessionId, 'not-a-child');
  }
}

/** `FleetSession.run` and `.openRun` for one session: defined beside the store's other binding readers (`bindingReads.ts`), so
 *  `CoordStore.bindingsOf` answers it; re-exported here for the wire's readers. */
export { sessionRunRead, type SessionRunRead } from './bindingReads.js';

/** Each of `sessions`' incarnation, read once. A mark is the registry's reading of the session, as the fleet row carries it. */
export function incarnationsOfSessions(
  port: Pick<BindingReadPort, 'run'>, sessions: readonly { readonly id: string; readonly child: ChildMark }[],
): ReadonlyMap<string, Incarnation> {
  return new Map(sessions.map((s) => [s.id, incarnationOfMark(port, s.id, s.child)]));
}

/** `RunSummary.childIds` for every run in `runs`: `childrenOf(claimant)`, read once per distinct claimant. `incarnations` is the
 *  fleet's reading of its sessions; a worker it does not list keeps the id-string rule. A run that names no coordinator has no
 *  children (`[]`). A claimant whose series cannot be read leaves its runs WITHOUT the field (absence permits, never a false
 *  empty list), and `onUnreadable` says which and why. */
export function withChildIds(
  port: Pick<BindingReadPort, 'bindingRunsOf'>, runs: readonly RunSummary[], incarnations: ReadonlyMap<string, Incarnation>,
  onUnreadable: (claimant: string, detail: string) => void,
): RunSummary[] {
  const incarnationFor = (sessionId: string): Incarnation => incarnations.get(sessionId) ?? unbornIncarnation(sessionId, 'not-a-child');
  const byClaimant = new Map<string, readonly number[] | null>();
  const childIdsFor = (claimant: string): readonly number[] | null => {
    if (!byClaimant.has(claimant)) {
      const series = port.bindingRunsOf(claimant);
      if (!series.ok) onUnreadable(claimant, series.detail);
      byClaimant.set(claimant, series.ok ? childrenOf(series.runs, claimant, incarnationFor).map((r) => r.id) : null);
    }
    return byClaimant.get(claimant) ?? null;
  };
  return runs.map((run) => {
    const childIds = run.claimedBy === null ? [] : childIdsFor(run.claimedBy);
    return childIds === null ? run : { ...run, childIds };
  });
}

/** `CoordStore.runLastMoves`' answer (D-7334), declared here by its consumer: each asked run's newest move, or null when it
 *  has none, every asked id present; or the read's failure with its detail. */
export type RunLastMovesRead =
  | { readonly ok: true; readonly moves: ReadonlyMap<number, number | null> }
  | { readonly ok: false; readonly detail: string };

/** The one read `withLastMoves` needs from the store. */
export interface LastMovesPort {
  runLastMoves(runIds: readonly number[]): RunLastMovesRead;
}

/** `RunSummary.lastMoveAt` for every run in `runs`, in ONE read for the frame (D-7334). A run with no move carries `null`, which
 *  the app's reader turns into its dispatch or open time. A read that fails leaves EVERY run without the field (absence permits:
 *  the app then shows no movement, as for an older server, never a false quiet), and `onUnreadable` says why. */
export function withLastMoves<R extends { readonly id: number }>(
  port: LastMovesPort, runs: readonly R[], onUnreadable: (detail: string) => void,
): (R & { readonly lastMoveAt?: number | null })[] {
  const read = port.runLastMoves(runs.map((r) => r.id));
  if (!read.ok) {
    onUnreadable(read.detail);
    return [...runs];
  }
  return runs.map((run) => ({ ...run, lastMoveAt: read.moves.get(run.id) ?? null }));
}

/** D-8285: `RunSummary.workerLastSeen` and `.workerLastTurn` on every answer `withVerdicts` stamps, from the stall sweep's one
 *  reader (`workerSeen.ts`). A run with no entry stamps nothing: absence reads "not measured", as for an older server. */
export function withWorkerSeen<R extends { readonly id: number }>(reader: WorkerSeenReader, runs: readonly R[]): R[] {
  return runs.map((run) => {
    const s = reader.of(run.id);
    return s === null ? run : { ...run, workerLastSeen: s.lastSeen, workerLastTurn: s.turn };
  });
}

/** The reader `withVerdicts` takes:`RunVerdicts`' two reads, and nothing it could write (D-8071; spec §7, A45). */
export type VerdictReader = Pick<RunVerdicts, 'of' | 'ofProgramme'>;

/** The stuck verdict's fields on every answer that carries a `RunSummary`, beside `withLastMoves`: the runs frame, its cold
 *  start, `GET /api/runs` and `GET /api/runs/:id` (D-8071; spec §7). An open run takes `stuck`, `waitsOn`, `blockedBy` and
 *  `coordinatorGone` from its entry; a closed run takes only `coordinatorGone`, from its programme's entry (A55). A run with
 *  no entry, and an empty reader, stamp nothing: absence permits, and an older PWA draws exactly as before. */
export function withVerdicts<R extends { readonly id: number }>(verdicts: VerdictReader, runs: readonly R[]): R[] {
  return runs.map((run) => {
    const v = verdicts.of(run.id);
    if (v !== null) {
      return { ...run, stuck: v.stuck, ...(v.waitsOn === undefined ? {} : { waitsOn: v.waitsOn }),
        blockedBy: v.blockedBy, coordinatorGone: v.coordinatorGone };
    }
    const r = run as R & { readonly program?: string; readonly state?: string };
    if ((r.state === 'done' || r.state === 'failed') && typeof r.program === 'string') {
      const g = verdicts.ofProgramme(r.program);
      if (g !== null) return { ...run, coordinatorGone: g };
    }
    return run;
  });
}
