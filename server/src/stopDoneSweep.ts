import type { FleetState } from './fleetstate.js';
import type { Deps } from './server.js';
import type { Presence } from './presence.js';
import type { NotifyLog } from './notifylog.js';
import type { SessionRecord } from './registry.js';
import type { CoordStore } from './coord/store.js';
import type { TurnVerdict } from './coord/archiveDoor.js';
import { CCD_ARGV, stopSurfaceSupported } from './ccdargv.js';
import { RECLAIM_PAUSE_MARKER } from './coord/rundefs.js';
import { expiryReviewing } from './coord/expireArchived.js';
import { PRESENCE_TTL_MS, type FleetSession } from '../../shared/api.js';
import {
  STOP_DONE_DISABLED_MARKER, STOP_DONE_GRACE_MS, STOP_DONE_MEASURES_PER_PASS, STOP_DONE_PER_PASS, STOP_DONE_RETRY_MS,
  stopDoneVerdict, type StopDoneInput, type StopDoneLive, type StopDoneMark, type StopDoneRow, type StopDoneStoreRead,
  type StopDoneVerdict,
} from './stopDone.js';

/**
 * STOP A FINISHED RUN'S WORKER (D-5370), the lane: L4, it reads and acts and DECIDES nothing — `stopDoneVerdict`
 * (`stopDone.ts`, L1) holds the rule. A SWEEP, never a step of the run's transition: `closeRun` commits `done` without
 * waiting on ccd, and this lane finds the worker on a later pass (`FleetWatcher.sweepStopDone`, at
 * `STOP_DONE_SWEEP_MS`, on the tick's own assembled rows).
 *
 * ONE PASS:
 *  1. the switches, read from the tick's registry listing: `$REG/stop-done-disabled` (this lane's kill switch) or
 *     `$REG/reclaim-paused` (the fleet's one cleanup switch, which every cleanup lane honours) listed, nothing happens;
 *  2. the population is the rows the frame shows as dispatched children that are neither stopped nor archived, and the
 *     store is asked ONCE for all of them (`lastRunBySession`, `activeClaims`, and `outstandingMailFor` and
 *     `expiryReviewing` per candidate);
 *  3. the verdict runs on what is known; a row it answers `measure` for has its live word, its turn verdict and its turn
 *     marker read (at most `STOP_DONE_MEASURES_PER_PASS`), and the verdict runs again;
 *  4. at most `STOP_DONE_PER_PASS` stops, each ON THE COORDINATION SERIALISER and then the session's own queue, so a
 *     dispatch that is opening a run onto this worker, or a mail delivery typing into its pane, finishes first; inside
 *     them the registry record (and the row the frame assembles from it), the store, presence and the live state are read
 *     AGAIN and the verdict asked again — the tick's roster read alone is kept when the re-read row has none — and only
 *     `stop` composes
 *     `ccd stop <id> --surface agent` — the existing, already-granted `CCD_ARGV.stopId` (no new ccd verb).
 *
 * WHY THE STOP READS AS DELIBERATE. `cmd_stop` journals a `stop` row with the declared surface before it unsupervises,
 * and writes `.stopped` with it, so the dead-coordinator lane (`DEAD_COORDINATOR_DELIBERATE_ACTS` names `stop`), the
 * PWA (`stoppedBy`, the row's `stopped` lifecycle) and child reclamation all read a stop, never a crash. A box whose ccd
 * cannot take `--surface` holds (`no-surface`): this lane never stops a session undeclared.
 *
 * IDEMPOTENT ACROSS RESTARTS without a memory of its own: a stopped row carries `stoppedBy` and holds `stopped`; a
 * re-dispatch's `ensure` clears `.stopped` and opens a run, which holds `run-worker` until that run is `done` too.
 * The only memory is `retryAt`, after a stop the box refused — lost on a restart, which costs one more ask.
 */

export interface StopDoneSweepDeps {
  readonly coord: Pick<CoordStore, 'lastRunBySession' | 'activeClaims' | 'outstandingMailFor' | 'recordFeedEvent'
    | 'runsNamingSession' | 'run'>;
  readonly runCcd: Deps['runCcd'];
  readonly fleetState: FleetState | undefined;
  readonly presence: Pick<Presence, 'isVisible'> | undefined;
  readonly notifyLog: NotifyLog | undefined;
  /** `turnverdict.ts`'s `liveWordFor` and `turnVerdictFor`, over the watcher's thunks. */
  readonly liveWord: (rec: SessionRecord) => Promise<
    { ok: true; word: string; since: number | null } | { ok: false; reason: 'no-pane' | 'no-config-dir' | 'unmeasured' }>;
  readonly turnVerdict: (rec: SessionRecord, uuid: string) => Promise<TurnVerdict>;
  /** `turnverdict.ts`'s `turnMarkFor`: the turn marker, judged against the live process. */
  readonly mark: (rec: SessionRecord) => Promise<StopDoneMark>;
  /** At the act: the registry record read again and the frame's row assembled from it (`readSessionRecord`, then
   *  `liveRowFor`). `ok: false` when either could not be read — the act then holds `unmeasured`. */
  readonly rowAtAct: (rec: SessionRecord) => Promise<{ ok: true; row: StopDoneRow } | { ok: false }>;
  /** The coordination serialiser (`CoordRoutesHandle.serial`); null until `buildServer` hands it over, and while it
   *  is the lane measures and stops nothing. */
  readonly serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null;
  /** The process's per-session write queue. */
  readonly queueRun: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  readonly startedAt: number;
  readonly now: () => number;
}

export interface StopDoneMemory {
  /** After a refused stop: not asked again before this instant. */
  readonly retryAt: Map<string, number>;
}

export type StopDoneOutcome =
  | { readonly id: string; readonly kind: 'stopped'; readonly runId: number }
  | { readonly id: string; readonly kind: 'held-at-act'; readonly verdict: StopDoneVerdict }
  | { readonly id: string; readonly kind: 'failed'; readonly detail: string };

/** One session's store answers, from the pass's batched reads. */
function storeReadFor(
  id: string,
  last: ReturnType<CoordStore['lastRunBySession']>,
  claimants: ReadonlySet<string>,
  coord: StopDoneSweepDeps['coord'],
): StopDoneStoreRead {
  if (!last.ok) return { ok: false, detail: last.detail };
  try {
    const run = last.last.find((l) => l.sessionId === id) ?? null;
    return {
      ok: true,
      last: run === null ? null : { runId: run.runId, state: run.state, closedAt: run.closedAt },
      openWorker: last.openWorkers.includes(id),
      openClaimant: last.openClaimants.includes(id),
      claim: claimants.has(id),
      mail: coord.outstandingMailFor(id, 1).length > 0,
      reviewing: (() => {
        const r = expiryReviewing(coord, id);
        if (!r.ok) throw new Error(r.detail);
        return r.reviewing;
      })(),
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The store's answers for `ids`, read once. A read that throws holds every one of them (`runs-unreadable`). */
function storeReads(coord: StopDoneSweepDeps['coord'], ids: readonly string[]): Map<string, StopDoneStoreRead> {
  const out = new Map<string, StopDoneStoreRead>();
  try {
    const last = coord.lastRunBySession(ids);
    const claimants = new Set(coord.activeClaims().map((c) => c.heldBy));
    for (const id of ids) out.set(id, storeReadFor(id, last, claimants, coord));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    for (const id of ids) out.set(id, { ok: false, detail });
  }
  return out;
}

async function readLive(deps: StopDoneSweepDeps, rec: SessionRecord): Promise<StopDoneLive> {
  const w = await deps.liveWord(rec);
  const turn = await deps.turnVerdict(rec, rec.uuid);
  const mark = await deps.mark(rec);
  return { kind: 'read', word: w.ok ? { ok: true, word: w.word } : { ok: false, reason: w.reason }, turn, mark };
}

function recordFeed(deps: StopDoneSweepDeps, id: string, runId: number): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({
      kind: 'run', sessionId: id, runId, title: 'Worker stopped',
      body: `${id} was stopped: its run ${runId} is done and it sat idle. A re-dispatch onto it restarts it.`,
    });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    console.warn(`ccrc-server: stop-done: recordFeedEvent failed (${err instanceof Error ? err.message : String(err)}) — ${id}'s stop has no feed row`);
  } finally {
    void log.flush();
  }
}

/** One pass of the lane. Returns what it did, for the caller's log and the tests. */
export async function stopDonePass(
  deps: StopDoneSweepDeps, mem: StopDoneMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<StopDoneOutcome[]> {
  if (names.includes(STOP_DONE_DISABLED_MARKER) || names.includes(RECLAIM_PAUSE_MARKER)) return [];
  const serial = deps.serial;
  if (serial === null) return [];
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const now = deps.now();
  for (const [id, at] of [...mem.retryAt]) if (at <= now) mem.retryAt.delete(id);
  const pop = sessions
    .filter((s) => s.child.kind === 'child' && s.stoppedBy === null && s.archivedAt === null && byId.has(s.id)
      && !mem.retryAt.has(s.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (pop.length === 0) return [];
  const reads = storeReads(deps.coord, pop.map((s) => s.id));
  const surface = stopSurfaceSupported(deps.fleetState);
  const inputFor = (row: StopDoneRow, store: StopDoneStoreRead, live: StopDoneLive, at: number): StopDoneInput => ({
    row, store, viewer: deps.presence?.isVisible(row.id) ?? false, sinceStartMs: at - deps.startedAt,
    presenceTtlMs: PRESENCE_TTL_MS, surface, live, now: at, graceMs: STOP_DONE_GRACE_MS,
  });
  const due: FleetSession[] = [];
  let measured = 0;
  for (const row of pop) {
    if (due.length >= STOP_DONE_PER_PASS) break;
    const store = reads.get(row.id)!;
    let v = stopDoneVerdict(inputFor(row, store, { kind: 'unread' }, now));
    if (v.act !== 'measure') continue;
    if (measured >= STOP_DONE_MEASURES_PER_PASS) break;
    measured++;
    v = stopDoneVerdict(inputFor(row, store, await readLive(deps, byId.get(row.id)!), deps.now()));
    if (v.act === 'stop') due.push(row);
  }
  const out: StopDoneOutcome[] = [];
  for (const row of due) {
    const rec = byId.get(row.id)!;
    try {
      out.push(await serial(() => deps.queueRun(row.id, async (): Promise<StopDoneOutcome> => {
        // AT THE ACT, again: a run may have been opened onto it, a hold written, mail queued, a screen opened. The
        // record and its row are re-read; only the roster falls back to the tick's read when the re-read has none.
        const fresh = await deps.rowAtAct(rec);
        if (!fresh.ok) return { id: row.id, kind: 'held-at-act', verdict: { act: 'hold', reason: 'unmeasured' } };
        const again: StopDoneRow = { ...fresh.row, subagents: fresh.row.subagents ?? row.subagents };
        const at = deps.now();
        const store = storeReads(deps.coord, [row.id]).get(row.id)!;
        const v = stopDoneVerdict(inputFor(again, store, await readLive(deps, rec), at));
        if (v.act !== 'stop') return { id: row.id, kind: 'held-at-act', verdict: v };
        const res = await deps.runCcd(CCD_ARGV.stopId(row.id, 'agent'));
        if (!res.ok) {
          mem.retryAt.set(row.id, deps.now() + STOP_DONE_RETRY_MS);
          return { id: row.id, kind: 'failed', detail: res.stderr };
        }
        recordFeed(deps, row.id, v.runId);
        return { id: row.id, kind: 'stopped', runId: v.runId };
      })));
    } catch (err) {
      mem.retryAt.set(row.id, deps.now() + STOP_DONE_RETRY_MS);
      out.push({ id: row.id, kind: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const o of out) {
    if (o.kind === 'stopped') console.warn(`ccrc-server: stop-done: stopped ${o.id} (run ${o.runId} done, idle; D-5370)`);
    else if (o.kind === 'failed') console.warn(`ccrc-server: stop-done: the stop of ${o.id} failed (${o.detail}) — not asked again for an hour`);
  }
  return out;
}
