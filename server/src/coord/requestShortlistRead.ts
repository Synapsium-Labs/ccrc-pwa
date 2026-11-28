// The code shortlist's reader (context C5 Coordination, L3; Overlord W2 request record plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-requests.md` §7 and Task B2, RQ4, RQ5). It composes three reads and decides
// nothing: what each read means, which paths are asked and how a programme ranks are `requestShortlist.ts`'s (L1).
//
// - `liveProgrammes`: the programmes not ended (`isEnded`), through `CoordStore.programs()`.
// - `claimsByProgramme`: the live claims (`CoordStore.activeClaims()`) whose lease has not run out (the claims route's own
//   filter, `expiresAt > now`), each joined to its run's programme; a claim with no run, or whose run has no row, is dropped.
// - `touchedByProgramme`: the one history read an open makes. Its agent is the history door's own choice (`historyAgentFor`),
//   its port the history op's (`FleetIO.overlordHistory`), its wait `TOUCHED_OPEN_WAIT_MS` through the time port. The wait's
//   handle is a local of the call, so this is a deadline inside one adapter call, never a scheduler. Each row's ccrc id maps
//   to its runs through `runs.sessionId` (the run's project) and `runs.claimedBy` (the coordinator's project, else the run's).
//
// Each read answers what it is: a throw is that read's own unmeasured word, never an empty list. Nothing here logs: a path is
// data from another box, and none reaches a log line (request-shortlist-read.test.ts plants a marker to prove it).
//
// No caller in production at this tip: the open door of request record B's next part is its first (a census in
// request-shortlist-read.test.ts pins that no source outside this file imports it).
import type { DatabaseSync } from 'node:sqlite';
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
import type { CoordStore } from './store.js';

/** The store reads the shortlist takes. */
export type ShortlistCoord = Pick<CoordStore, 'programs' | 'activeClaims'>;

export interface ShortlistReadDeps {
  readonly coord: ShortlistCoord;
  /** `coord.db`'s handle, for the two runs reads. */
  readonly db: DatabaseSync;
  /** Every agent link this server holds, as the history door's choice reads it. */
  readonly links: () => readonly HistoryLink[];
  readonly io: Pick<FleetIO, 'overlordHistory'>;
  readonly time: { readonly clock: Clock; readonly scheduler: Scheduler };
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
export function claimsByProgramme(coord: Pick<CoordStore, 'activeClaims'>, db: DatabaseSync, now: number): ClaimsRead {
  try {
    const live = coord.activeClaims().filter((c) => c.expiresAt > now && c.runId !== null);
    const ids = [...new Set(live.map((c) => c.runId as number))];
    const programOf = new Map<number, string>();
    if (ids.length > 0) {
      const rows = db.prepare('SELECT id, program FROM runs WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(ids)) as { id: number | bigint; program: string }[];
      for (const r of rows) programOf.set(Number(r.id), r.program);
    }
    const claims: ClaimByProgramme[] = [];
    for (const c of live) {
      const programme = programOf.get(c.runId as number);
      if (programme !== undefined) claims.push({ programme, project: c.project, paths: c.paths, renewedAt: c.renewedAt });
    }
    return { kind: 'measured', claims };
  } catch {
    return { kind: 'unmeasured', why: 'claims-unreadable' };
  }
}

/** Each ccrc id's runs: a worker's through `sessionId` (the run's project), a coordinator's through `claimedBy` (its
 *  coordinator project, else the run's). Unmeasured when the read throws. */
export function sessionRuns(db: DatabaseSync, ids: readonly string[]): SessionRunsRead {
  try {
    const runs = new Map<string, SessionRun[]>();
    if (ids.length === 0) return { kind: 'measured', runs };
    const json = JSON.stringify([...new Set(ids)]);
    const rows = db.prepare(
      'SELECT DISTINCT program, project, coordProject, sessionId, claimedBy FROM runs '
      + 'WHERE sessionId IN (SELECT value FROM json_each(?)) OR claimedBy IN (SELECT value FROM json_each(?))',
    ).all(json, json) as { program: string; project: string; coordProject: string | null; sessionId: string | null; claimedBy: string | null }[];
    const add = (id: string, run: SessionRun): void => {
      const list = runs.get(id) ?? [];
      if (!list.some((r) => r.programme === run.programme && r.project === run.project)) list.push(run);
      runs.set(id, list);
    };
    const wanted = new Set(ids);
    for (const r of rows) {
      if (r.sessionId !== null && wanted.has(r.sessionId)) add(r.sessionId, { programme: r.program, project: r.project });
      if (r.claimedBy !== null && wanted.has(r.claimedBy)) add(r.claimedBy, { programme: r.program, project: r.coordProject ?? r.project });
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
  const runs = answer.kind === 'rows' ? sessionRuns(deps.db, answer.rows.map((r) => r.ccrcId)) : { kind: 'measured' as const, runs: new Map() };
  return touchedReadOf(answer, runs);
}

/** The shortlist for one open's expected paths: the three reads, then the decider. The touched read is made only when a path
 *  is asked (RQ4: an empty list matches on claims alone). */
export async function readShortlist(deps: ShortlistReadDeps, expected: readonly ExpectedPath[]): Promise<Shortlist> {
  const live = liveProgrammes(deps.coord);
  const claims = claimsByProgramme(deps.coord, deps.db, deps.time.clock.wall());
  const touched = await touchedByProgramme(deps, expected);
  return codeShortlist({ expected, claims, touched, live });
}
