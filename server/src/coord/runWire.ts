import type { ChildMark, RunSummary, SessionRun } from '../../../shared/api.js';
import type { BindingReadPort } from './bindingReads.js';
import { childBirthOf } from './childSpent.js';
import { bindingOf, childrenOf, incarnationOf, unbornIncarnation, type BindingRun, type Incarnation } from './runBinding.js';

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
 * THE INCARNATION OF A SESSION is read from its registry mark exactly as `heldFor` and the drift lane read it: a `.child`
 * mark names the minting run, `childBirthOf` places that run's birth, and a session with no mark (a coordinator, a manual
 * workspace) or a mark that cannot be read has no birth and keeps the id-string rule. A worker the registry no longer lists
 * is read as a session with no mark, which is the rule every reader had before the binding.
 */

const toSessionRun = (r: BindingRun | null): SessionRun | null => r === null ? null : { id: r.id, state: r.state, claimedBy: r.claimedBy };

/** The incarnation of `sessionId` whose registry mark is `child`. A `child` mark reads its minting run through `port.run`;
 *  that read can fail, and then the birth is unplaceable (`childBirthOf`'s own word), never an empty answer. */
export function incarnationOfMark(port: Pick<BindingReadPort, 'run'>, sessionId: string, child: ChildMark): Incarnation {
  switch (child.kind) {
    case 'child': return incarnationOf(sessionId, childBirthOf(port.run(child.runId), sessionId));
    case 'unreadable': return unbornIncarnation(sessionId, 'unplaceable');
    case 'none': return unbornIncarnation(sessionId, 'not-a-child');
  }
}

/** One session's two named queries over its binding series, or the reason the series could not be read. */
export type SessionRunRead =
  | { readonly ok: true; readonly run: SessionRun | null; readonly openRun: SessionRun | null }
  | { readonly ok: false; readonly detail: string };

/** `FleetSession.run` and `.openRun` for one session: `bindingOf` over `port.bindingRunsOf(id)`. A series this process
 *  cannot represent answers `ok:false` with why, never a guess. */
export function sessionRunRead(port: Pick<BindingReadPort, 'bindingRunsOf'>, sessionId: string, incarnation: Incarnation): SessionRunRead {
  const series = port.bindingRunsOf(sessionId);
  if (!series.ok) return { ok: false, detail: series.detail };
  const binding = bindingOf(series.runs, incarnation);
  return { ok: true, run: toSessionRun(binding.newest), openRun: toSessionRun(binding.open) };
}

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
