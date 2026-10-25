import type { FleetState } from './fleetstate.js';
import type { Deps } from './server.js';
import type { Viewers } from './viewer.js';
import type { NotifyLog } from './notifylog.js';
import type { SessionRecord } from './registry.js';
import type { CoordStore } from './coord/store.js';
import type { TurnVerdict } from './coord/archiveDoor.js';
import { CCD_ARGV, HIBERNATE_HOLD_OK_CAP, capSupported, sweepDec, verbSupported } from './ccdargv.js';
import { HIBERNATE_DISABLED_MARKER, NO_HIBERNATE_SUFFIX } from './coord/hibernate.js';
import { RECLAIM_PAUSE_MARKER } from './coord/rundefs.js';
import { programmeHoldOf } from './coord/rundefs.js';
import { VIEWER_OPEN_TTL_MS, TERMINAL_RUN_STATES, type FleetSession } from '../../shared/api.js';
import {
  STOP_DONE_ACTOR, STOP_DONE_DISABLED_MARKER, STOP_DONE_GRACE_MS, STOP_DONE_MEASURES_PER_PASS, STOP_DONE_PARKED_STATES,
  STOP_DONE_PER_PASS, STOP_DONE_RETRY_MS,
  mailOnly, stopDoneVerdict, type StopDoneHeldKind, type StopDoneInput, type StopDoneLive, type StopDoneMark, type StopDoneRow,
  type StopDoneStoreRead, type StopDoneVerdict,
} from './stopDone.js';

/**
 * STOP A FINISHED RUN'S WORKER (D-5370), the lane: L4, it reads and acts and DECIDES nothing — `stopDoneVerdict`
 * (`stopDone.ts`, L1) holds the rule. A SWEEP, never a step of the run's transition: `closeRun` commits `done` without
 * waiting on ccd, and this lane finds the worker on a later pass (`FleetWatcher.sweepStopDone`, at
 * `STOP_DONE_SWEEP_MS`, on the tick's own assembled rows).
 *
 * SINCE TASK 17b IT PUTS THE WORKER TO SLEEP (stop-done-composes-hibernate (D-5427)): its act is `ccd hibernate`, so a
 * finished worker wakes as any sleeping session does (mail under the wake budget, a re-dispatch's `ensure`, an open
 * screen), and it keeps hibernation's use holds — the opt-out, scheduled work, the marker's two, and ccd's own
 * `attached` at the act. Since D-6091 its clock is the run's close: `recent` is the grace of marker quiet, never N, and
 * a programme hold or a hold naming a terminal run passes through `ccd hibernate --hold-ok <the exact text>` on a box
 * that advertises `hibernate-hold-ok`. It stays live under its own switches; hibernation's sweep acts only once armed.
 * Since D-6092 (W1-1b, F5 (b)) "finished" is the verdict's: a `failed` run's worker sleeps as a `done` one does, and
 * a producer parked at review, merge or close sleeps after `STOP_DONE_PARKED_IDLE_MS` of marker quiet.
 *
 * ONE PASS:
 *  1. the switches, read from the tick's registry listing: `$REG/stop-done-disabled` (this lane's kill switch),
 *     `$REG/reclaim-paused` (the fleet's one cleanup switch, which every cleanup lane honours) or
 *     `$REG/hibernate-disabled` (hibernation's, which every act that puts a session to sleep honours) listed, nothing
 *     happens; `$REG/hibernate-after-hours` is not this lane's (D-6091: its clock is the run's close);
 *  2. the population is the rows the frame shows as dispatched children that are neither stopped nor archived (a
 *     sleeping row carries the stop stamp `ccd hibernate` writes, so it is never asked twice), and the store is asked
 *     ONCE for all of them (`lastRunBySession`'s placed reads, `activeClaims`, and `outstandingMailFor` per candidate),
 *     and each row's `.hold` is classified (`heldKindOf`: `programmeHoldOf`, and the store's `run` read for a run suffix);
 *  3. the verdict runs on what is known; a row it answers `measure` for has its live word, its turn verdict and its turn
 *     marker read (at most `STOP_DONE_MEASURES_PER_PASS`), and the verdict runs again;
 *  4. at most `STOP_DONE_PER_PASS` acts, each ON THE COORDINATION SERIALISER and then the session's own queue, so a
 *     dispatch that is opening a run onto this worker, or a mail delivery typing into its pane, finishes first; inside
 *     them the registry record (and the row the frame assembles from it), the store, presence and the live state are read
 *     AGAIN and the verdict asked again — the tick's roster read alone is kept when the re-read row has none — and only
 *     `hibernate` composes `ccd hibernate <id>` (`CCD_ARGV.hibernate`, declared by `sweepDec` as the lane
 *     `sweep:stop-done`; with `--hold-ok <text>` when the verdict passed a programme hold, the text classified AT THE
 *     ACT, which ccd re-reads byte for byte). ccd re-measures at the act; its `session-busy` refusal (exit 3) is remembered like any refusal.
 *     The pane menu is the watcher's newest scrape, and the live reads use the tick's record: a uuid or wrapper that
 *     changed since fails closed (the marker reads `foreign`, the live file `unmeasured`).
 *
 * WHY THE ACT READS AS DELIBERATE. `cmd_hibernate` journals a `hibernate` row before it unsupervises, and
 * `DEAD_COORDINATOR_DELIBERATE_ACTS` names `hibernate`, so the dead-coordinator lane, the PWA (`hibernatedAt`) and
 * child reclamation read a deliberate sleep, never a crash. A box whose ccd lacks the verb holds (`no-verb`).
 *
 * IDEMPOTENT ACROSS RESTARTS without a memory of its own: a sleeping row carries `stoppedBy` and is outside the
 * population; a re-dispatch's `ensure` clears `.stopped` and `.hibernated` and opens a run, which holds `run-worker`
 * until that run is `done` too. The only memory is `retryAt`, after an act the box refused — lost on a restart, which
 * costs one more ask.
 */

export interface StopDoneSweepDeps {
  readonly coord: Pick<CoordStore, 'lastRunBySession' | 'activeClaims' | 'outstandingMailFor' | 'recordFeedEvent' | 'run'>;
  readonly runCcd: Deps['runCcd'];
  readonly fleetState: FleetState | undefined;
  /** D-5242's presence contract: `isOpen`, an open screen visible or hidden — a hidden but open tab holds a finished
   *  worker as it holds a sleeping session. */
  readonly viewers: Pick<Viewers, 'isOpen'> | undefined;
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
  /** D-6091: the mail-only count the lane's last excluded row carried; absent until this process's first pass writes
   *  one, so a restart writes one row, zero included, and a zero reads apart from a lane that never ran. */
  mailOnly?: number;
}

/** The excluded row's title (D-6091): a finished worker that nothing but unread mail keeps awake is counted, never put
 *  to sleep. */
export const STOP_DONE_MAIL_ONLY_TITLE = 'Workers kept awake by unread mail';

export type StopDoneOutcome =
  | { readonly id: string; readonly kind: 'hibernated'; readonly runId: number }
  | { readonly id: string; readonly kind: 'skipped'; readonly detail: string }
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
    // D-6091: the PLACED reads — a `planned` run (a wave not yet dispatched) is neither its newest run nor an open one.
    const run = last.lastPlaced.find((l) => l.sessionId === id) ?? null;
    return {
      ok: true,
      last: run === null ? null : { runId: run.runId, state: run.state, closedAt: run.closedAt },
      openWorker: last.openPlacedWorkers.includes(id),
      parkedWorker: last.parkedPlacedWorkers.includes(id),
      openClaimant: last.openClaimants.includes(id),
      claim: claimants.has(id),
      // D-5838: a PARKED row does not veto (it waits on its box, up to 24 h, and
      // would keep a finished worker resident that long). Stopping it leaves the
      // row to the lifecycle rung, which rejects a stopped recipient's mail
      // `recipient-stopped` exactly as before the park existed.
      mail: coord.outstandingMailFor(id).some((m) => m.parkedAt == null),
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

/** The row's `.hold`, classified (D-6091): the grammar through `programmeHoldOf`, the one reader of
 *  `HOLD_REASON_PATTERN`, and a run suffix's state through the store's `run` read. Any read that cannot be made, or
 *  a run the store does not have, answers `unreadable`, which holds. */
export function heldKindOf(held: string | null, coord: Pick<StopDoneSweepDeps['coord'], 'run'>): StopDoneHeldKind {
  if (held === null) return 'none';
  const hold = programmeHoldOf(held);
  if (hold === null) return 'operator';
  if (hold.runId === null) return 'programme';
  try {
    const r = coord.run(hold.runId);
    if (!r.ok || r.run === null) return 'unreadable';
    return (TERMINAL_RUN_STATES as readonly string[]).includes(r.run.state) ? 'run-terminal' : 'run-live';
  } catch {
    return 'unreadable';
  }
}

async function readLive(deps: StopDoneSweepDeps, rec: SessionRecord): Promise<StopDoneLive> {
  const w = await deps.liveWord(rec);
  const turn = await deps.turnVerdict(rec, rec.uuid);
  const mark = await deps.mark(rec);
  return { kind: 'read', word: w.ok ? { ok: true, word: w.word } : { ok: false, reason: w.reason }, turn, mark };
}

/** The lane's two feed rows (D-6091), through ONE writer site (consolidation W1a C1e's ratchet counts sites): a
 *  worker put to sleep, naming its run's state, and the excluded row, the count of workers nothing but unread mail
 *  keeps awake. Recorded and archived, never pushed. */
type StopDoneFeedRow =
  | { readonly kind: 'asleep'; readonly id: string; readonly runId: number; readonly state: string }
  | { readonly kind: 'mail-only'; readonly count: number };

/** The run's state in the asleep row and the journal line (D-6092): `done` or `failed` as it reads, a parked run as
 *  "parked at <state>". */
function runStateWords(state: string): string {
  return STOP_DONE_PARKED_STATES.includes(state) ? `parked at ${state}` : state;
}

function recordFeed(deps: StopDoneSweepDeps, row: StopDoneFeedRow): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record(row.kind === 'asleep'
      ? {
        kind: 'run', sessionId: row.id, runId: row.runId, title: 'Worker asleep',
        body: `${row.id} was put to sleep: its run ${row.runId} is ${runStateWords(row.state)} and it sat idle. Mail, a re-dispatch or a restart wakes it.`,
      }
      : {
        kind: 'coord', sessionId: '', runId: null, title: `${STOP_DONE_MAIL_ONLY_TITLE}: ${row.count}`,
        body: `${row.count} finished worker(s) stay awake for unread mail to them, with nothing in the coordination store or their workspace holding them besides; their panes are measured once it is read.`,
      });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    const what = row.kind === 'asleep' ? `${row.id}'s sleep has no feed row` : 'the mail-only count has no feed row';
    console.warn(`ccrc-server: stop-done: recordFeedEvent failed (${err instanceof Error ? err.message : String(err)}) — ${what}`);
  } finally {
    void log.flush();
  }
}

/** The excluded row, written on this process's first pass and then only when the count differs from the last one. */
function recordMailOnly(deps: StopDoneSweepDeps, mem: StopDoneMemory, count: number): void {
  if (count === mem.mailOnly) return;
  mem.mailOnly = count;
  recordFeed(deps, { kind: 'mail-only', count });
}

/** One pass of the lane. Returns what it did, for the caller's log and the tests. */
export async function stopDonePass(
  deps: StopDoneSweepDeps, mem: StopDoneMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<StopDoneOutcome[]> {
  if (names.includes(STOP_DONE_DISABLED_MARKER) || names.includes(RECLAIM_PAUSE_MARKER)
    || names.includes(HIBERNATE_DISABLED_MARKER)) return [];
  const serial = deps.serial;
  if (serial === null) return [];
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const now = deps.now();
  for (const [id, at] of [...mem.retryAt]) if (at <= now) mem.retryAt.delete(id);
  const pop = sessions
    .filter((s) => s.child.kind === 'child' && s.stoppedBy === null && s.archivedAt === null && byId.has(s.id)
      && !mem.retryAt.has(s.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (pop.length === 0) { recordMailOnly(deps, mem, 0); return []; }
  const reads = storeReads(deps.coord, pop.map((s) => s.id));
  const verb = verbSupported(deps.fleetState, CCD_ARGV.hibernate(pop[0]!.id, null));
  const holdOkVerb = capSupported(deps.fleetState, HIBERNATE_HOLD_OK_CAP);
  const inputFor = (row: StopDoneRow, store: StopDoneStoreRead, live: StopDoneLive, at: number): StopDoneInput => ({
    row, heldKind: heldKindOf(row.held, deps.coord), holdOkVerb, store, viewer: deps.viewers?.isOpen(row.id) ?? true,
    sinceStartMs: at - deps.startedAt,
    presenceTtlMs: VIEWER_OPEN_TTL_MS, verb, optedOut: names.includes(`${row.id}.${NO_HIBERNATE_SUFFIX}`),
    live, now: at, graceMs: STOP_DONE_GRACE_MS,
  });
  // The excluded row's count, over the whole population (pure: the verdict asked twice, no live read).
  recordMailOnly(deps, mem, pop.filter((row) => mailOnly(inputFor(row, reads.get(row.id)!, { kind: 'unread' }, now))).length);
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
    if (v.act === 'hibernate') due.push(row);
  }
  const out: StopDoneOutcome[] = [];
  const states = new Map<string, string>();
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
        if (v.act !== 'hibernate') return { id: row.id, kind: 'held-at-act', verdict: v };
        const res = await deps.runCcd(CCD_ARGV.hibernate(row.id, sweepDec(deps.fleetState, STOP_DONE_ACTOR), v.holdOk ?? null));
        if (!res.ok) {
          mem.retryAt.set(row.id, deps.now() + STOP_DONE_RETRY_MS);
          // D-6840: a call that never ran has no `session-busy` to read off the runner's forged stderr.
          const busy = res.ran === false ? null : /ccd: session-busy: ?(\S*)/.exec(res.stderr);
          return busy !== null
            ? { id: row.id, kind: 'skipped', detail: busy[1] || 'busy' }
            : { id: row.id, kind: 'failed', detail: res.stderr };
        }
        const state = store.ok && store.last !== null ? store.last.state : 'unknown';
        states.set(row.id, state);
        recordFeed(deps, { kind: 'asleep', id: row.id, runId: v.runId, state });
        return { id: row.id, kind: 'hibernated', runId: v.runId };
      })));
    } catch (err) {
      mem.retryAt.set(row.id, deps.now() + STOP_DONE_RETRY_MS);
      out.push({ id: row.id, kind: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const o of out) {
    if (o.kind === 'hibernated') console.warn(`ccrc-server: stop-done: put ${o.id} to sleep (run ${o.runId} ${runStateWords(states.get(o.id) ?? 'unknown')}, idle; D-5370, D-5427, D-6091, D-6092)`);
    else if (o.kind === 'skipped') console.warn(`ccrc-server: stop-done: ccd re-measured ${o.id} as ${o.detail} — not asked again for an hour`);
    else if (o.kind === 'failed') console.warn(`ccrc-server: stop-done: the hibernate of ${o.id} failed (${o.detail}) — not asked again for an hour`);
  }
  return out;
}
