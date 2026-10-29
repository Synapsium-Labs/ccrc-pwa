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
// It never retries inside itself; the next pass reads again. A run it abandoned is terminal, so it is never a candidate
// again, and no second mail is sent.
//
// A LATE CHILD. If a `ws-add` for the run were ever to finish after the act, its workspace carries `.child` naming a
// run that is now terminal. The run stays `failed` (a dispatch that already returned never binds it, and no path
// moves a terminal run back), and the child reclaim lane takes that workspace under its existing rule for a child of
// a closed run, which `reclaim-paused` and `child-reclaim-disabled` still stop. The coordinator, already mailed,
// dispatches a new run. The bound is what makes this residual: the stamp is past the `ws-add` ceiling by then.
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { CoordStore } from './store.js';
import type { CloseOutcome, SweepCloseGuard } from './close.js';
import type { DeadCoordinatorStop } from '../deadCoordinator.js';
import { closeRefusalOf } from './archiveDoor.js';
import { queueSystemMail } from './rundefsTx.js';
import { measuredIdentity, readRegistryMeasured } from '../registry.js';
import { readSwitches } from '../../../shared/switches.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import {
  DISPATCH_ABANDON_EVENT, DISPATCH_ABANDON_SUBJECT, dispatchAbandonMailBody,
} from '../../../shared/dispatch-abandon.js';
import { deadDispatchVerdict, dispatchAbandonViewOf, type DeadDispatchRegistry, type DeadDispatchVerdict } from './deadDispatch.js';

/** The executor's ports (L2, declared by this consumer). `serial` is the coordination serialiser's sweep handle, and
 *  the abandon it hands in is the ONLY way this file ends a run. */
export interface AbandonDeadDispatchDeps {
  coord: CoordStore;
  io: FleetIO;
  cfg: CcrcConfig;
  serial: <T>(coord: CoordStore, fn: (
    abandon: (runId: number, claimedBy: string, guard: SweepCloseGuard['stillCrashed']) => Promise<CloseOutcome>,
  ) => Promise<T>) => Promise<T>;
  now: () => number;
}

/** What one pass did: the runs it abandoned, and those it kept or could not move, each with why. */
export interface AbandonDeadDispatchOutcome {
  readonly abandoned: readonly { readonly runId: number; readonly claimedBy: string; readonly mailed: boolean }[];
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

/** Every fact the verdict needs for run `id`, read now, and the verdict. A run the store cannot read is kept. */
export async function deadDispatchOf(deps: Pick<AbandonDeadDispatchDeps, 'coord' | 'io' | 'cfg' | 'now'>, id: number):
  Promise<{ verdict: DeadDispatchVerdict; run: { program: string; wave: number; waveOf: number | null; project: string } | null }> {
  const read = deps.coord.run(id);
  if (!read.ok || read.run === null) {
    return { verdict: { kind: 'keep', why: 'run-unreadable', detail: read.ok ? 'the run is gone' : read.detail }, run: null };
  }
  const run = read.run;
  const armed = dispatchAbandonViewOf(deps.coord.dispatchAbandonSetting(), deps.cfg.dispatchAbandonMs).armed;
  const childOmitted = deps.coord.runEvents(id).some((e) => e.detail !== null && e.detail.startsWith('child-omitted:'));
  const registry = await registryFacts(deps);
  // The instant is read AFTER the registry's round trip, so the age is never older than what was measured.
  const verdict = deadDispatchVerdict({ armed, run, childOmitted, registry, now: deps.now(), boundMs: deps.cfg.dispatchAbandonMs });
  return { verdict, run: { program: run.program, wave: run.wave, waveOf: run.waveOf, project: run.project } };
}

const whyOf = (v: Extract<DeadDispatchVerdict, { kind: 'keep' }>): string => (v.detail === undefined ? v.why : `${v.why}: ${v.detail}`);

/** One pass. Never throws for a single run's refusal; a throw from the store or the serialiser reaches the caller. */
export async function abandonDeadDispatches(deps: AbandonDeadDispatchDeps): Promise<AbandonDeadDispatchOutcome> {
  const abandoned: { runId: number; claimedBy: string; mailed: boolean }[] = [];
  const kept: { runId: number; why: string }[] = [];
  const ids = deps.coord.stalledDispatchRunIds(deps.now() - deps.cfg.dispatchAbandonMs);
  if (ids.length === 0) return { abandoned, kept };
  // The switch first, once: an off switch reads nothing more (no registry read on the fleet's behalf).
  if (!dispatchAbandonViewOf(deps.coord.dispatchAbandonSetting(), deps.cfg.dispatchAbandonMs).armed) {
    return { abandoned, kept: ids.map((runId) => ({ runId, why: 'switch-off' })) };
  }
  await deps.serial(deps.coord, async (abandon) => {
    for (const id of ids) {
      const first = await deadDispatchOf(deps, id);
      if (first.verdict.kind !== 'dead') { kept.push({ runId: id, why: whyOf(first.verdict) }); continue; }
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
  return { abandoned, kept };
}
