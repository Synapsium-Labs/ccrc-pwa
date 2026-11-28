// The code shortlist's reader (context C5 Coordination, L3; Overlord W2 request record plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-requests.md` §7 and Task B2, RQ4, RQ5). It composes three reads and decides
// nothing: what each read means, which paths are asked and how a programme ranks are `requestShortlist.ts`'s (L1).
//
// - `liveProgrammes`: the programmes not ended (`isEnded`), through `CoordStore.programs()`.
// - `claimsByProgramme`: the live claims (`CoordStore.activeClaims()`) whose lease has not run out (the claims route's own
//   filter, `expiresAt > now`), each joined to its run's programme (`CoordStore.run`); a claim with no run, or whose run has
//   no row, is dropped.
// - `touchedByProgramme`: the one history read an open makes. Its agent is the history door's own choice (`historyAgentFor`),
//   its port the history op's (`FleetIO.overlordHistory`), its wait `TOUCHED_OPEN_WAIT_MS` through the time port. The wait's
//   handle is a local of the call, so this is a deadline inside one adapter call, never a scheduler. Each row's ccrc id maps
//   to its runs through the store's one reader of the run and session link (`CoordStore.bindingRunsOf`): a run it works on
//   gives that run's project, a run it claims gives the coordinator's project, else the run's.
//
// It holds no handle and writes no SQL: every read is a `CoordStore` method (the coordination ring's handle rule). Each read
// answers what it is: a throw or an unreadable answer is that read's own unmeasured word, never an empty list. Nothing here
// logs: a path is data from another box, and none reaches a log line (request-shortlist-read.test.ts plants a marker).
//
// No caller in production at this tip: the open door of request record B's next part is its first (a census in
// request-shortlist-read.test.ts pins that no source imports it).
import { isEnded } from '../../../shared/programmeLifecycle.js';
import type { OverlordHistoryRequest } from '../../../shared/overlordHistory.js';
import type { ExpectedPath } from '../../../shared/overlordRequests.js';
import type { FleetIO } from '../io.js';
import type { Cancel, Clock, Scheduler } from '../time/ports.js';
import { historyAgentFor, type HistoryLink, type HistoryReadOutcome } from './overlordHistory.js';
import {
  TOUCHED_OPEN_WAIT_MS, codeShortlist, touchedAnswerOf, touchedReadOf, touchedRequestOf,
  type ClaimByProgramme, type ClaimsRead, type LiveRead, type SessionRun, type SessionRunsRead, type Shortlist, type TouchedRead,
} from './requestShortlist.js';
import type { CoordStore, RunRow } from './store.js';

/** The store reads the shortlist takes. */
export type ShortlistCoord = Pick<CoordStore, 'programs' | 'activeClaims' | 'run' | 'bindingRunsOf'>;

export interface ShortlistReadDeps {
  readonly coord: ShortlistCoord;
  /** Every agent link this server holds, as the history door's choice reads it. */
  readonly links: () => readonly HistoryLink[];
  readonly io: Pick<FleetIO, 'overlordHistory'>;
  readonly time: { readonly clock: Clock; readonly scheduler: Scheduler };
}

/** A run read that is not a run: thrown inside a read, so that read answers its unmeasured word. */
class RunUnreadable extends Error {}

/** One run by id, read once per call through `cache`: the row, null for no row, or a throw for an unreadable one. */
function runOf(coord: Pick<CoordStore, 'run'>, cache: Map<number, RunRow | null>, id: number): RunRow | null {
  if (cache.has(id)) return cache.get(id)!;
  const r = coord.run(id);
  if (!r.ok) throw new RunUnreadable();
  cache.set(id, r.run);
  return r.run;
}

/** The live programmes, or `programmes-unreadable`. */
export function liveProgrammes(coord: Pick<CoordStore, 'programs'>): LiveRead {
  try {
    return { kind: 'measured', live: new Set(coord.programs().filter((p) => !isEnded(p.state)).map((p) => p.slug)) };
  } catch {
    return { kind: 'unmeasured', why: 'programmes-unreadable' };
  }
}

/** The live, unexpired claims with a run, by their run's programme, or `claims-unreadable`. */
export function claimsByProgramme(coord: Pick<CoordStore, 'activeClaims' | 'run'>, now: number): ClaimsRead {
  try {
    const cache = new Map<number, RunRow | null>();
    const claims: ClaimByProgramme[] = [];
    for (const c of coord.activeClaims()) {
      if (c.expiresAt <= now || c.runId === null) continue;
      const run = runOf(coord, cache, c.runId);
      if (run !== null) claims.push({ programme: run.program, project: c.project, paths: c.paths, renewedAt: c.renewedAt });
    }
    return { kind: 'measured', claims };
  } catch {
    return { kind: 'unmeasured', why: 'claims-unreadable' };
  }
}

/** Each ccrc id's runs: one it works on gives the run's project, one it claims the coordinator's project, else the run's.
 *  Unmeasured when any read throws or answers unreadable (all or nothing: a partial map would drop a programme silently). */
export function sessionRuns(coord: Pick<CoordStore, 'run' | 'bindingRunsOf'>, ids: readonly string[]): SessionRunsRead {
  try {
    const cache = new Map<number, RunRow | null>();
    const runs = new Map<string, SessionRun[]>();
    for (const id of new Set(ids)) {
      const bound = coord.bindingRunsOf(id);
      if (!bound.ok) return { kind: 'unmeasured' };
      const list: SessionRun[] = [];
      const add = (run: SessionRun): void => {
        if (!list.some((r) => r.programme === run.programme && r.project === run.project)) list.push(run);
      };
      for (const b of bound.runs) {
        const run = runOf(coord, cache, b.id);
        if (run === null) continue;
        if (b.sessionId === id) add({ programme: run.program, project: run.project });
        if (b.claimedBy === id) add({ programme: run.program, project: run.coordProject ?? run.project });
      }
      if (list.length > 0) runs.set(id, list);
    }
    return { kind: 'measured', runs };
  } catch {
    return { kind: 'unmeasured' };
  }
}

/** The one history read, bounded by the door's wait. Resolves with the port's outcome, or `timeout` at the wait. */
async function askWithin(deps: ShortlistReadDeps, req: OverlordHistoryRequest): Promise<HistoryReadOutcome> {
  const ac = new AbortController();
  let cancel: Cancel = () => {};
  const deadline = new Promise<HistoryReadOutcome>((resolve) => {
    cancel = deps.time.scheduler.after(TOUCHED_OPEN_WAIT_MS, () => { ac.abort(); resolve({ kind: 'timeout' }); });
  });
  try {
    return await Promise.race([deps.io.overlordHistory(req, ac.signal), deadline]);
  } catch {
    return { kind: 'lost' };
  } finally {
    cancel();
  }
}

/** History's `touched` for the expected paths, by programme: one op call, or `not-asked` when there is no path to ask. */
export async function touchedByProgramme(deps: ShortlistReadDeps, expected: readonly ExpectedPath[]): Promise<TouchedRead> {
  const asked = touchedRequestOf(expected);
  if (asked === null) return { kind: 'not-asked' };
  const links = deps.links();
  const choice = historyAgentFor(links);
  const outcome: HistoryReadOutcome = choice.kind === 'agent' ? await askWithin(deps, asked.request) : choice;
  const answer = touchedAnswerOf(outcome, asked, links.some((l) => !l.connected));
  const runs: SessionRunsRead = answer.kind === 'rows'
    ? sessionRuns(deps.coord, answer.rows.map((r) => r.ccrcId)) : { kind: 'measured', runs: new Map() };
  return touchedReadOf(answer, runs);
}

/** The shortlist for one open's expected paths: the three reads, then the decider. The touched read is made only when a path
 *  is asked (RQ4: an empty list matches on claims alone). */
export async function readShortlist(deps: ShortlistReadDeps, expected: readonly ExpectedPath[]): Promise<Shortlist> {
  const live = liveProgrammes(deps.coord);
  const claims = claimsByProgramme(deps.coord, deps.time.clock.wall());
  const touched = await touchedByProgramme(deps, expected);
  return codeShortlist({ expected, claims, touched, live });
}
