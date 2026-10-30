// D-7319 (operator ruling 2026-10-29): THE EXECUTOR that abandons a run whose dispatch never came back, so the operator
// no longer abandons it by hand. Its one caller is the dead-coordinator lane's pass (`watch.ts`, `deadCoordinatorPass`),
// a reason that lane carries beside its own on the same tick, cadence and serialiser, and not a timer of its own.
//
// IT REUSES THE ONE ABANDON. The act is `closeRun`'s abandon arm, reached only through `CoordRoutesHandle.withSweepAbandon`
// (`causedBy: 'sweep'`, the compare-and-set on `claimedBy` and a re-measure inside the arm), the very arm the run row's
// Abandon button and `AbandonSheet` reach through `POST /api/runs/:id/abandon`. For a run with no session that arm makes
// no fleet act: it closes the run `failed`, cancels the run's outstanding mail and releases its claims, in one
// transaction. Nothing here writes a run state.
//
// In order, every doubt "not this time":
//   1. the store's candidates (`stalledDispatchRunIds`: planned, no session, stamped at or before `now - bound`);
//      none, and nothing else is read;
//   2. per candidate, the facts — the switch (Settings' row), the run read whole, its journal, ONE measured registry
//      read (rows, refused names, and the cleanup pause from the same listing) — and `deadDispatchVerdict` (L1);
//   3. a dead one is handed to the abandon arm with this file's re-measure as its guard: the same facts read again,
//      inside the coordination serialiser, IMMEDIATELY before the commit. Any answer but dead stops it
//      (`sweep-stopped`), and a changed `claimedBy` refuses it (`claimant-changed`);
//   4. after the commit, and only then: the reason journaled on the run (`DISPATCH_ABANDON_EVENT`), and the coordinator
//      mailed through the server's own mail path (`queueSystemMail`). Mail queued BEFORE the commit would be cancelled
//      by it: the close parks every outstanding delivery of the run's mail.
// A RETURNED CHILD IS BOUND (D-7563, operator ruling 2026-10-30). When exactly one registry row's `.child` marker names
// the candidate, this file also asks tmux for that row's pane and the store for the runs that already name its session,
// and the verdict (L1) answers `bind` when the pane is live, the row holds no hold, no run names it and the run's
// journal never unbound it. The bind is the same pass's act, under the same switch, pause and cap: THE CHILD BIND GATE
// first (`childBindGate`, `childBind.ts`, the one gate every door that binds an existing workspace to a run goes
// through: a spent or unmeasured child never binds), then its re-measure (every fact read again, inside the
// serialiser), then `bindReturnedChild` (`dispatch.ts`, the spawn arm's own `setSession` write, refused on any change
// since), then the bind journaled on the run (`DISPATCH_BIND_EVENT`). Nothing is closed or mailed; the fleet is asked
// only the tmux read and the gate's own reads. A bound run names a session, so it is never a candidate again: a second
// pass does nothing. A run the resume arm later unbinds as spent journals `session-unbound:`, which keeps it from
// being bound back. Any other shape of child keeps the run, as before.
// AT MOST `DISPATCH_ABANDON_PER_PASS` CANDIDATES A PASS (D-7502), the oldest stamps first (the store's order); the rest
// wait for the next pass, which reads the candidates afresh. The loop holds the coordination serialiser throughout.
// It never retries inside itself; the next pass reads again. A run it abandoned is terminal, so it is never a candidate
// again, and no second mail is sent.
//
// A LATE CHILD. If a `ws-add` for the run were ever to finish after the act, its workspace carries `.child` naming a
// run that is now terminal. The run stays `failed` (a dispatch that already returned never binds it, and no path
// moves a terminal run back), and the child reclaim lane takes that workspace under its existing rule for a child of
// a closed run, which `reclaim-paused` and `child-reclaim-disabled` still stop. The coordinator, already mailed,
// dispatches a new run. The bound is what makes this residual: the stamp is past the `ws-add` ceiling by then.
import type { FleetIO } from '../io.js';
import type { SessionVerdict } from '../exec.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { RunCcd } from './ports.js';
import type { CoordStore } from './store.js';
import type { CloseOutcome, SweepCloseGuard } from './close.js';
import type { DeadCoordinatorStop } from '../deadCoordinator.js';
import { closeRefusalOf } from './archiveDoor.js';
import { queueSystemMail } from './rundefsTx.js';
import { measuredIdentity, readRegistryMeasured } from '../registry.js';
import { readSwitches } from '../../../shared/switches.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import {
  DISPATCH_ABANDON_EVENT, DISPATCH_ABANDON_SUBJECT, DISPATCH_BIND_EVENT, dispatchAbandonMailBody,
} from '../../../shared/dispatch-abandon.js';
import {
  deadDispatchVerdict, dispatchAbandonViewOf, type DeadDispatchRegistry, type DeadDispatchVerdict, type ReturnedChildFacts,
} from './deadDispatch.js';
import { bindReturnedChild } from './dispatch.js';
import { childBindGate } from './childBind.js';
import { unboundSessionOf } from './runSpend.js';

/** D-7502: at most this many candidates are handled in one pass. The loop runs inside the coordination serialiser,
 *  which every dispatch waits on from before its `ws-add` to after its bind, and each candidate costs up to two measured
 *  registry reads (the verdict and the arm's re-measure) and one close transaction. Twenty bounds that hold to forty
 *  registry reads. At the lane's one-minute cadence it still drains 1 200 an hour, far above any backlog a failing
 *  dispatch path leaves (one stalled run per dispatch that never came back). It is wider than the other lanes'
 *  caps of two to eight because a candidate that is kept (a child marker, a box that mints without one) stays a
 *  candidate and takes a slot every pass, oldest first: twenty such runs together are needed to starve a newer one. */
export const DISPATCH_ABANDON_PER_PASS = 20;

/** The executor's ports (L2, declared by this consumer). `serial` is the coordination serialiser's sweep handle, and
 *  the abandon it hands in is the ONLY way this file ends a run. */
export interface AbandonDeadDispatchDeps {
  coord: CoordStore;
  io: FleetIO;
  cfg: CcrcConfig;
  /** D-7563: the one child's pane, asked only when exactly one row's marker names the run. */
  tmux: { sessionVerdict(id: string): Promise<SessionVerdict> };
  /** D-7563: the child bind gate's reads (its `pr-state`), asked only for a run the verdict would bind. */
  runCcd: RunCcd;
  fleetState?: FleetState | undefined;
  serial: <T>(coord: CoordStore, fn: (
    abandon: (runId: number, claimedBy: string, guard: SweepCloseGuard['stillCrashed']) => Promise<CloseOutcome>,
  ) => Promise<T>) => Promise<T>;
  now: () => number;
}

/** What one pass did: the runs it abandoned, those it bound to their returned child (D-7563), and those it kept or could
 *  not move, each with why. */
export interface AbandonDeadDispatchOutcome {
  readonly abandoned: readonly { readonly runId: number; readonly claimedBy: string; readonly mailed: boolean }[];
  readonly bound: readonly { readonly runId: number; readonly sessionId: string; readonly claimedBy: string }[];
  readonly kept: readonly { readonly runId: number; readonly why: string }[];
}

/** The registry as the verdict reads it, from ONE measured read: rows, refused names, and the pause from its listing. */
async function registryFacts(deps: Pick<AbandonDeadDispatchDeps, 'io' | 'cfg'>): Promise<DeadDispatchRegistry> {
  let read;
  // [registry-refused:refuses] an unlistable registry, or any refused name, keeps every run: the verdict abandons none.
  try { read = await readRegistryMeasured(deps.io, deps.cfg); } catch { return { listed: false }; }
  if (!read.listed) return { listed: false };
  return {
    listed: true,
    refused: read.refused.size,
    pause: readSwitches(read.names)[RECLAIM_PAUSE_MARKER],
    records: read.records.map((r) => ({
      id: r.id, project: r.project, workspace: r.workspace, child: r.child, held: r.held, spawned: r.spawn !== null,
      identityMeasured: measuredIdentity(r) !== null,
    })),
  };
}

/** D-7563: the one child's facts beyond the registry, or none when not exactly one row's marker names run `id`. A throw
 *  from tmux reads `unknown` and a failed store read `unreadable`: neither binds. */
async function returnedChildOf(
  deps: Pick<AbandonDeadDispatchDeps, 'coord' | 'tmux'>, id: number, registry: DeadDispatchRegistry,
  unbound: readonly string[],
): Promise<ReturnedChildFacts | undefined> {
  if (!registry.listed) return undefined;
  const children = registry.records.filter((r) => r.child.kind === 'child' && r.child.runId === id);
  if (children.length !== 1) return undefined;
  const sid = children[0]!.id;
  let pane: ReturnedChildFacts['pane'];
  try { pane = (await deps.tmux.sessionVerdict(sid)).verdict; } catch { pane = 'unknown'; }
  // Read AFTER tmux's round trip, so the count is never older than the pane it is judged with.
  const named = deps.coord.runsNamingSession(sid);
  return { id: sid, pane, namedBy: named.ok ? named.runs.length : 'unreadable', unboundBefore: unbound.includes(sid) };
}

/** Every fact the verdict needs for run `id`, read now, and the verdict. A run the store cannot read is kept. */
export async function deadDispatchOf(deps: Pick<AbandonDeadDispatchDeps, 'coord' | 'io' | 'cfg' | 'tmux' | 'now'>, id: number):
  Promise<{ verdict: DeadDispatchVerdict; run: { program: string; wave: number; waveOf: number | null; project: string } | null }> {
  const read = deps.coord.run(id);
  if (!read.ok || read.run === null) {
    return { verdict: { kind: 'keep', why: 'run-unreadable', detail: read.ok ? 'the run is gone' : read.detail }, run: null };
  }
  const run = read.run;
  const armed = dispatchAbandonViewOf(deps.coord.dispatchAbandonSetting(), deps.cfg.dispatchAbandonMs).armed;
  const events = deps.coord.runEvents(id);
  const childOmitted = events.some((e) => e.detail !== null && e.detail.startsWith('child-omitted:'));
  const unbound = events.flatMap((e) => { const u = unboundSessionOf(e.detail); return u === null ? [] : [u]; });
  const registry = await registryFacts(deps);
  const returned = await returnedChildOf(deps, id, registry, unbound);
  // The instant is read AFTER the registry's and tmux's round trips, so the age is never older than what was measured.
  const verdict = deadDispatchVerdict({
    armed, run, childOmitted, registry, ...(returned === undefined ? {} : { returned }), now: deps.now(), boundMs: deps.cfg.dispatchAbandonMs,
  });
  return { verdict, run: { program: run.program, wave: run.wave, waveOf: run.waveOf, project: run.project } };
}

/** Why a run was not abandoned: a keep's reason (and detail), or `bind` (D-7563) where the re-measure of an abandon
 *  found a returned child instead. */
const whyOf = (v: Exclude<DeadDispatchVerdict, { kind: 'dead' }>): string =>
  (v.kind === 'bind' ? v.kind : v.detail === undefined ? v.why : `${v.why}: ${v.detail}`);

/** One pass. Never throws for a single run's refusal; a throw from the store or the serialiser reaches the caller. */
export async function abandonDeadDispatches(deps: AbandonDeadDispatchDeps): Promise<AbandonDeadDispatchOutcome> {
  const abandoned: { runId: number; claimedBy: string; mailed: boolean }[] = [];
  const bound: { runId: number; sessionId: string; claimedBy: string }[] = [];
  const kept: { runId: number; why: string }[] = [];
  const ids = deps.coord.stalledDispatchRunIds(deps.now() - deps.cfg.dispatchAbandonMs);
  if (ids.length === 0) return { abandoned, bound, kept };
  // The switch first, once: an off switch reads nothing more (no registry read on the fleet's behalf).
  if (!dispatchAbandonViewOf(deps.coord.dispatchAbandonSetting(), deps.cfg.dispatchAbandonMs).armed) {
    return { abandoned, bound, kept: ids.map((runId) => ({ runId, why: 'switch-off' })) };
  }
  // D-7502: the oldest stamps first (`stalledDispatchRunIds` orders by stamp, then id); the rest wait for the next pass.
  const thisPass = ids.slice(0, DISPATCH_ABANDON_PER_PASS);
  await deps.serial(deps.coord, async (abandon) => {
    for (const id of thisPass) {
      const first = await deadDispatchOf(deps, id);
      if (first.verdict.kind === 'keep') { kept.push({ runId: id, why: whyOf(first.verdict) }); continue; }
      if (first.verdict.kind === 'bind') { await bindOne(deps, id, first.verdict.sessionId, bound, kept); continue; }
      const { claimedBy, startedAt } = first.verdict;
      const guard = async (): Promise<DeadCoordinatorStop | null> => {
        const again = await deadDispatchOf(deps, id);
        return again.verdict.kind === 'dead' ? null : { kind: 'remeasured', why: `re-measured: ${whyOf(again.verdict)}` };
      };
      const out = await abandon(id, claimedBy, guard);
      if (!out.ok) {
        const why = out.kind === 'sweep-stopped' ? out.stop.why
          : out.kind === 'claimant-changed' ? `claimant-changed: ${out.claimedBy ?? 'none'}`
            : (() => { const r = closeRefusalOf(id, out); return r.detail === undefined ? r.kind : `${r.kind}: ${r.detail}`; })();
        kept.push({ runId: id, why });
        continue;
      }
      // THE JOURNAL and THE MAIL, after the commit only. Each is guarded: the run is abandoned whatever they do.
      const boundMs = deps.cfg.dispatchAbandonMs;
      try {
        deps.coord.recordRunEvent(id, 'sweep', `${DISPATCH_ABANDON_EVENT} started=${startedAt} bound=${boundMs}`);
      } catch (err) {
        console.warn(`ccrc-server: dispatch-abandon: run #${id} was abandoned but its reason could not be journaled (${err instanceof Error ? err.message : String(err)})`);
      }
      let mailed = false;
      try {
        const r = first.run!;
        queueSystemMail(deps.coord, { program: r.program, wave: r.wave, waveOf: r.waveOf }, {
          fromId: 'operator', toId: claimedBy, runId: id, kind: 'status', subject: DISPATCH_ABANDON_SUBJECT,
          body: dispatchAbandonMailBody({ runId: id, program: r.program, wave: r.wave, project: r.project, startedAt, boundMs }),
        });
        mailed = true;
      } catch (err) {
        console.warn(`ccrc-server: dispatch-abandon: run #${id} was abandoned but ${claimedBy} could not be mailed (${err instanceof Error ? err.message : String(err)})`);
      }
      console.warn(`ccrc-server: dispatch-abandon: run #${id} abandoned — its dispatch started ${new Date(startedAt).toISOString()} and never came back; ${mailed ? `mailed ${claimedBy}` : 'not mailed'}`);
      abandoned.push({ runId: id, claimedBy, mailed });
    }
  });
  for (const runId of ids.slice(DISPATCH_ABANDON_PER_PASS)) kept.push({ runId, why: `pass-cap: next pass (${DISPATCH_ABANDON_PER_PASS} a pass)` });
  return { abandoned, bound, kept };
}

/** D-7563: one returned child's bind. FIRST the child bind gate on the session the verdict named (`childBindGate`, the
 *  one gate every door that binds an existing workspace to a run goes through): any answer but `ok` keeps the run, its
 *  code in the why. THEN the re-measure (every fact read again inside the serialiser, after the gate's round trips): it
 *  must answer `bind` itself, to the session the gate passed, and its facts, the latest, are the ones bound.
 *  `bindReturnedChild` then re-reads the run and writes with no `await` between, refusing any change since. The journal
 *  follows the write and is guarded: the run is bound whatever it does. */
async function bindOne(
  deps: Pick<AbandonDeadDispatchDeps, 'coord' | 'io' | 'cfg' | 'tmux' | 'now' | 'runCcd' | 'fleetState'>,
  id: number, gated: string,
  bound: { runId: number; sessionId: string; claimedBy: string }[], kept: { runId: number; why: string }[],
): Promise<void> {
  const fleet = deps.fleetState === undefined ? {} : { fleetState: deps.fleetState };
  const gate = await childBindGate({ io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, ...fleet }, deps.coord, gated);
  if (!gate.ok) {
    const said = gate.code === 'workspace-spent' ? `${gate.code} #${gate.pr}` : `${gate.code}: ${gate.detail}`;
    kept.push({ runId: id, why: `bind refused: child gate ${said}` });
    return;
  }
  const v = (await deadDispatchOf(deps, id)).verdict;
  if (v.kind !== 'bind') {
    // A re-measure that reads dead (the child gone since) abandons nothing here: the next pass reads it afresh.
    kept.push({ runId: id, why: `re-measured: ${v.kind === 'dead' ? v.kind : whyOf(v)}` });
    return;
  }
  if (v.sessionId !== gated) {
    kept.push({ runId: id, why: `re-measured: another child (${v.sessionId}) than the gate passed` });
    return;
  }
  const out = bindReturnedChild(deps.coord, { runId: id, sessionId: v.sessionId, claimedBy: v.claimedBy, startedAt: v.startedAt });
  if (!out.ok) { kept.push({ runId: id, why: `bind refused: ${out.why}` }); return; }
  try {
    deps.coord.recordRunEvent(id, 'sweep', `${DISPATCH_BIND_EVENT} session=${v.sessionId} started=${v.startedAt}`);
  } catch (err) {
    console.warn(`ccrc-server: dispatch-abandon: run #${id} was bound to ${v.sessionId} but the bind could not be journaled (${err instanceof Error ? err.message : String(err)})`);
  }
  console.warn(`ccrc-server: dispatch-abandon: run #${id} bound to ${v.sessionId}, the one child workspace that came back for its dispatch of ${new Date(v.startedAt).toISOString()}`);
  bound.push({ runId: id, sessionId: v.sessionId, claimedBy: v.claimedBy });
}
