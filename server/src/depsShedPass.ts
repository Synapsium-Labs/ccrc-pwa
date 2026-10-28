import type { FleetState } from './fleetstate.js';
import type { Deps } from './server.js';
import type { Viewers } from './viewer.js';
import type { NotifyLog } from './notifylog.js';
import type { SessionRecord } from './registry.js';
import type { CoordStore } from './coord/store.js';
import type { DepsShedConfig } from './config.js';
import { notify, type NoticeRecord } from './notice.js';
import { CCD_ARGV, ccdCan, sweepDec } from './ccdargv.js';
import { NO_HIBERNATE_SUFFIX } from './coord/hibernate.js';
import { childReclaimBornAt, childReclaimClaimsByChair, childReclaimRowUuid } from './coord/childReclaim.js';
import { CHILD_BIRTH_SKEW_MS } from './coord/childSpent.js';
import { childReclaimCoordinated } from './childReclaimSweep.js';
import { RUN_DONE_LANE, heldKindOf, runDoneLastPlacedOf, runDoneViewerFacts } from './sleepLane.js';
import {
  DEPS_SHED_ACTOR, DEPS_SHED_FINAL_REFUSALS, DEPS_SHED_RETRY_MAX_MS, DEPS_SHED_RETRY_MS, depsShedVerdict, type DepsShedChair, type DepsShedInput, type DepsShedStamp,
  type DepsShedStoreRead, type DepsShedVerdict,
} from './depsShed.js';
import type { FleetSession } from '../../shared/api.js';
import { DEPS_SHED_LIVE_MARKER, readSwitches, type MarkerSwitchName } from '../../shared/switches.js';

/**
 * THE DEPS-SHED ARM OF THE RUN-DONE ROW (D-7278; design note `docs/superpowers/plans/2026-10-28-worktree-leak-design.md`
 * §4): L4, it reads, logs and acts; it decides nothing — `depsShedVerdict` (`depsShed.ts`, L1) holds the rule.
 *
 * A second pass in the run-done lane's body (`FleetWatcher.sleepRunDone`), after `stopDonePass`, on the same tick's rows
 * and listing, the same `sleepRunDone` cadence row and single flight, the same coordination serialiser and the same kill
 * switches (`stop-done-disabled`, `reclaim-paused`, `hibernate-disabled`). It is a pass of its own, not a `SLEEP_LANES`
 * row, because its population is the one the sleep ladder skips (a row with a stop stamp answers `stopped` there) and
 * its act is not `ccd hibernate`: the legitimately different job beside the sleep, after it.
 *
 * SHADOW UNLESS ARMED. Without `$REG/deps-shed-live` (no writer in the tree) the act composes the verb's `--dry-run`,
 * which runs every rung on the box and removes nothing, and records one feed row per row per sleep, "Dependencies would
 * be removed", with the box's own count and bytes. Armed, it composes the act itself.
 *
 * ONE PASS. The switches over the tick's listing; nothing until the serialiser is handed over; the population (every
 * sleeping, non-archived workspace row with a record, not in its retry hold-off, not settled for this sleep, and in
 * shadow not already reported for this sleep); the store read once for all of them; each row's shed stamp read only
 * when the listing names it; the verdict for each; at most `CCRC_DEPS_SHED_PER_PASS` of the `shed` answers acted on,
 * rows the box has not refused this sleep first, then oldest clock first.
 *
 * ONE ACT. Armed, on the coordination serialiser and then the session's queue (below); in shadow, on neither: the row assembled again
 * (`rowAtAct`), the store, presence and the stamp read again, the hold classified again and the verdict asked again;
 * then the capability, and the kill and arming switches over a fresh listing, the read nearest the argv (an arming
 * switch gone since the pass holds; one raised since the pass leaves this act a dry run, the safe direction). The box
 * re-proves the rest (`ccd ws-shed-deps`). The act never throws.
 *
 * THE SERIALISER AND THE QUEUE, ARMED ONLY. The shadow's dry run removes nothing and takes no lock, so the box's
 * re-proof is enough and it holds neither the coordination serialiser nor the session's queue: dispatch, claims and
 * closes, and that session's swap, reap, forget, title and pr routes, never queue behind its `du`, `git status` and
 * process walk. The armed act holds both from the verdict's re-read to the box's answer, because a dispatch
 * or claim that would wake or bind this session must not land between the store read that says its work is finished
 * and the removal. The hold's budget: at most `CCRC_DEPS_SHED_PER_PASS` acts (default 1) a `sleepRunDone` pass, each
 * bounded by the verb's runner row (`CCD_VERB_TIMEOUT_MS['ws-shed-deps']`, 240 s, of which a healthy act uses seconds),
 * and only once a sleep per row.
 *
 * REFUSALS. A refusal or failure holds the row off for `DEPS_SHED_RETRY_MS`, doubled for each further one in the same
 * sleep up to `DEPS_SHED_RETRY_MAX_MS`, and the row then sorts after every row the box has not refused this sleep, so a
 * set of rows that keep refusing (a leaked worker holding its node_modules) never starves a fresh one of the per-pass
 * slot. `nothing-to-shed` and `already-shed` (`DEPS_SHED_FINAL_REFUSALS`) stay true for the whole sleep: the row is not
 * asked again until it sleeps anew.
 */

/** The run-done row's kill switches, which stop this pass too: the lane row's own list, read, never respelled. */
export const DEPS_SHED_KILL: readonly MarkerSwitchName[] = RUN_DONE_LANE.kill;

/** The shed stamp's registry suffix: `$REG/<id>.depsshed`, `<epoch seconds> <bytes>`, ccd's one writer. */
export const DEPS_SHED_STAMP_SUFFIX = 'depsshed';

/** The store port: the placed-run read, the live claims, the coordinator claims and births, the hold's run read and the
 *  feed archive. */
export type DepsShedCoordPort = Pick<CoordStore,
  'lastRunBySession' | 'activeClaims' | 'childReclaimCoordinatorClaims' | 'lifecycleBirthEventsFor' | 'run' | 'recordFeedEvent'>;

export interface DepsShedPassDeps {
  readonly coord: DepsShedCoordPort;
  readonly runCcd: Deps['runCcd'];
  readonly fleetState: FleetState | undefined;
  /** Undefined: every row holds `viewer` (fail closed). */
  readonly viewers: Pick<Viewers, 'isOpen'> | undefined;
  readonly notifyLog: NotifyLog | undefined;
  /** `$REG/<id>.depsshed`'s body, as read; null when it could not be read. Called only when the listing names it. */
  readonly readStamp: (id: string) => Promise<string | null>;
  /** At the act: the registry record read again and the frame's row assembled from it. */
  readonly rowAtAct: (rec: SessionRecord) => Promise<{ ok: true; row: FleetSession } | { ok: false }>;
  /** The coordination serialiser; null until `buildServer` hands it over, and while it is the arm does nothing. */
  readonly serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null;
  readonly queueRun: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  /** At the act: the registry listed again, for the switches and the stamp; null when it cannot be listed. */
  readonly listing: () => Promise<readonly string[] | null>;
  readonly config: DepsShedConfig;
  readonly startedAt: number;
  readonly now: () => number;
}

export interface DepsShedMemory {
  /** After a refused or failed ask: not asked again before this instant. */
  readonly retryAt: Map<string, number>;
  /** Shadow: the stop stamp (`stoppedBy.at`) of the sleep a row's "would" row was written for. */
  readonly reported: Map<string, number>;
  /** The stop stamp of the sleep the box answered a final refusal for (`DEPS_SHED_FINAL_REFUSALS`): not asked again. */
  readonly settled: Map<string, number>;
  /** Per row, the sleep (its stop stamp) and how many refusals or failures the box has answered in it. */
  readonly refusals: Map<string, { readonly at: number; readonly n: number }>;
}

/** An empty memory: the watcher's, and each test's. */
export const depsShedMemory = (): DepsShedMemory =>
  ({ retryAt: new Map(), reported: new Map(), settled: new Map(), refusals: new Map() });

export type DepsShedOutcome =
  | { readonly id: string; readonly kind: 'shed' | 'would-shed'; readonly dirs: number; readonly bytes: number | null }
  | { readonly id: string; readonly kind: 'refused' | 'failed'; readonly word: string; readonly detail: string }
  | { readonly id: string; readonly kind: 'held-at-act'; readonly verdict: DepsShedVerdict | null }
  | { readonly id: string; readonly kind: 'switched-off'; readonly detail: string }
  | { readonly id: string; readonly kind: 'unreadable'; readonly detail: string };

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const natOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** The stamp's body, read: its epoch, in ms, or `unreadable`. */
export function parseDepsShedStamp(body: string | null): DepsShedStamp {
  if (body === null) return { kind: 'unreadable' };
  const m = /^([1-9][0-9]{0,11})(?: [0-9-]*)?\s*$/.exec(body);
  return m === null ? { kind: 'unreadable' } : { kind: 'at', atMs: Number(m[1]) * 1000 };
}

/** The verb's one JSON line, as the act reads it. */
type Removal<K extends string> = { readonly kind: K; readonly dirs: number; readonly bytes: number | null };
type BoxNo<K extends string> = { readonly kind: K; readonly word: string; readonly detail: string };
export type DepsShedAnswer =
  | Removal<'shed'> | Removal<'would-shed'> | BoxNo<'refused'> | BoxNo<'failed'>
  | { readonly kind: 'unreadable'; readonly detail: string };

export function parseDepsShedAnswer(stdout: string, id: string): DepsShedAnswer {
  let doc: unknown;
  try { doc = JSON.parse(stdout.trim().split('\n').pop() ?? ''); } catch { return { kind: 'unreadable', detail: 'ws-shed-deps answered no document' }; }
  if (!isObj(doc)) return { kind: 'unreadable', detail: 'ws-shed-deps answered no document' };
  if (doc['session'] !== id) return { kind: 'unreadable', detail: 'ws-shed-deps answered for another session' };
  const detail = typeof doc['detail'] === 'string' ? doc['detail'] : '';
  if (typeof doc['refused'] === 'string') return { kind: 'refused', word: doc['refused'], detail };
  if (typeof doc['failed'] === 'string') return { kind: 'failed', word: doc['failed'], detail };
  const dirs = natOrNull(doc['dirs']);
  if (dirs !== null && (doc['shed'] === true || doc['wouldShed'] === true)) {
    return { kind: doc['shed'] === true ? 'shed' : 'would-shed', dirs, bytes: natOrNull(doc['bytes']) };
  }
  return { kind: 'unreadable', detail: 'ws-shed-deps answered a document this server does not know' };
}

/** The pass's batched store read: for each id its facts, or the one detail that holds them all. */
function storeReads(deps: DepsShedPassDeps, rows: readonly FleetSession[], recs: ReadonlyMap<string, SessionRecord>, now: number):
  Map<string, DepsShedStoreRead> {
  const out = new Map<string, DepsShedStoreRead>();
  const ids = rows.map((r) => r.id);
  try {
    const last = deps.coord.lastRunBySession(ids);
    const claimants = new Set(deps.coord.activeClaims().map((c) => c.heldBy));
    const chairs = childReclaimClaimsByChair(deps.coord);
    for (const row of rows) {
      if (!last.ok) { out.set(row.id, { ok: false, detail: last.detail }); continue; }
      try {
        const run = runDoneLastPlacedOf(last, row.id);
        const claim = chairs.get(row.id);
        const rec = recs.get(row.id);
        const chair: DepsShedChair = claim === undefined ? { kind: 'never' }
          : claim === 'open' ? { kind: 'open' } : claim === 'unplaced' ? { kind: 'unplaced' }
            : {
              kind: 'ended', at: claim,
              // A child's chair counts only in its own generation (the fence the sweep, the close and the stale arm use);
              // a non-child that ever held one is a coordinator.
              ownGeneration: row.child.kind !== 'child' || childReclaimCoordinated(claim,
                () => childReclaimBornAt(deps.coord, row.id, now, rec === undefined ? null : childReclaimRowUuid(rec)), CHILD_BIRTH_SKEW_MS),
            };
        out.set(row.id, {
          ok: true, last: run === null ? null : { runId: run.runId, state: run.state, closedAt: run.closedAt },
          openWorker: last.openPlacedWorkers.includes(row.id), claim: claimants.has(row.id), chair,
        });
      } catch (err) {
        out.set(row.id, { ok: false, detail: errText(err) });
      }
    }
  } catch (err) {
    for (const id of ids) out.set(id, { ok: false, detail: errText(err) });
  }
  return out;
}

async function stampOf(deps: DepsShedPassDeps, names: readonly string[], id: string): Promise<DepsShedStamp> {
  if (!names.includes(`${id}.${DEPS_SHED_STAMP_SUFFIX}`)) return { kind: 'absent' };
  try { return parseDepsShedStamp(await deps.readStamp(id)); } catch { return { kind: 'unreadable' }; }
}

function inputOf(deps: DepsShedPassDeps, row: FleetSession, store: DepsShedStoreRead, stamp: DepsShedStamp,
  names: readonly string[], now: number): DepsShedInput {
  return {
    row, heldKind: heldKindOf(row.held, deps.coord), store, stamp,
    optedOut: names.includes(`${row.id}.${NO_HIBERNATE_SUFFIX}`), ...runDoneViewerFacts(deps, row.id, now),
    verb: ccdCan(deps.fleetState, 'wsShedDeps'), now,
    afterMs: deps.config.afterMs, parkedAfterMs: deps.config.parkedAfterMs,
  };
}

const sizeWords = (dirs: number, bytes: number | null): string =>
  `${dirs} director${dirs === 1 ? 'y' : 'ies'}${bytes === null ? '' : `, ${Math.round(bytes / (1024 * 1024))} MiB`}`;

/** The arm's feed rows, through ONE writer site: what was removed, or (shadow) what would be. Recorded, never pushed. */
function recordFeed(deps: DepsShedPassDeps, id: string, cls: string, a: { kind: 'shed' | 'would-shed'; dirs: number; bytes: number | null }): void {
  const record: NoticeRecord = a.kind === 'shed'
    ? {
      kind: 'coord', sessionId: id, runId: null, title: 'Dependencies removed',
      body: `${id} (${cls}, asleep) had its ignored dependency directories removed: ${sizeWords(a.dirs, a.bytes)}. Its worktree and every git fact stay; its next test step runs npm ci.`,
    }
    : {
      kind: 'coord', sessionId: id, runId: null, title: 'Dependencies would be removed',
      body: `${id} (${cls}, asleep) would have its ignored dependency directories removed: ${sizeWords(a.dirs, a.bytes)}. Shadow: nothing was removed (${DEPS_SHED_LIVE_MARKER} is not set).`,
    };
  notify({ notifyLog: deps.notifyLog, coord: deps.coord }, record, 'record-only', {
    lane: 'deps-shed', degraded: `${id}'s ${a.kind === 'shed' ? 'shed' : 'would-shed'} row has no feed row`,
  });
}

/** One pass of the arm. Returns what it did, for the caller's log and the tests. */
export async function depsShedPass(
  deps: DepsShedPassDeps, mem: DepsShedMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<DepsShedOutcome[]> {
  const switches = readSwitches(names);
  if (DEPS_SHED_KILL.some((k) => switches[k] !== 'clear')) return [];
  const serial = deps.serial;
  if (serial === null) return [];
  const armed = switches[DEPS_SHED_LIVE_MARKER] === 'set';
  const now = deps.now();
  for (const [id, until] of [...mem.retryAt]) if (until <= now) mem.retryAt.delete(id);
  const sleepOf = new Map(sessions.map((s) => [s.id, s.stoppedBy?.at] as const));
  // Each per-sleep memory lapses when its row is gone or sleeps anew.
  for (const m of [mem.reported, mem.settled]) for (const [id, at] of [...m]) if (sleepOf.get(id) !== at) m.delete(id);
  for (const [id, r] of [...mem.refusals]) if (sleepOf.get(id) !== r.at) mem.refusals.delete(id);
  const recs = new Map(records.map((r) => [r.id, r] as const));
  const pop = sessions.filter((s) => s.stoppedBy !== null && s.workspace !== null && s.archivedAt === null && recs.has(s.id)
    && !mem.retryAt.has(s.id) && mem.settled.get(s.id) !== s.stoppedBy.at
    && (armed || mem.reported.get(s.id) !== s.stoppedBy.at));
  if (pop.length === 0) return [];
  const reads = storeReads(deps, pop, recs, now);
  const due: Array<{ readonly row: FleetSession; readonly clockAt: number }> = [];
  for (const row of pop) {
    const v = depsShedVerdict(inputOf(deps, row, reads.get(row.id)!, await stampOf(deps, names, row.id), names, now));
    if (v.act === 'shed') due.push({ row, clockAt: v.clockAt });
  }
  const refused = (r: FleetSession): number => (mem.refusals.has(r.id) ? 1 : 0);
  due.sort((a, b) => refused(a.row) - refused(b.row) || a.clockAt - b.clockAt
    || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
  const out: DepsShedOutcome[] = [];
  for (const d of due.slice(0, deps.config.perPass)) {
    out.push(await depsShedAct(deps, mem, serial, armed, d.row, recs.get(d.row.id)!));
  }
  return out;
}

/** The act for one row the pass answered `shed` for. Never throws. */
async function depsShedAct(
  deps: DepsShedPassDeps, mem: DepsShedMemory, serial: NonNullable<DepsShedPassDeps['serial']>, armedAtPass: boolean,
  row: FleetSession, rec: SessionRecord,
): Promise<DepsShedOutcome> {
  const id = row.id;
  const sleepAt = row.stoppedBy?.at ?? 0;
  const holdOff = (): void => {
    const prev = mem.refusals.get(id);
    const n = prev !== undefined && prev.at === sleepAt ? prev.n + 1 : 1;
    mem.refusals.set(id, { at: sleepAt, n });
    mem.retryAt.set(id, deps.now() + Math.min(DEPS_SHED_RETRY_MAX_MS, DEPS_SHED_RETRY_MS * 2 ** Math.min(n - 1, 30)));
  };
  // Armed only: the coordination serialiser, then the session's queue, around the act (the header's THE SERIALISER AND
  // THE QUEUE). The dry run takes neither.
  const guarded = <T>(fn: () => Promise<T>): Promise<T> => (armedAtPass ? serial(() => deps.queueRun(id, fn)) : fn());
  try {
    return await guarded(async (): Promise<DepsShedOutcome> => {
      const fresh = await deps.rowAtAct(rec);
      if (!fresh.ok) return { id, kind: 'held-at-act', verdict: null };
      const listing = await deps.listing();
      if (listing === null) return { id, kind: 'switched-off', detail: 'registry-unlistable' };
      const at = deps.now();
      const store = storeReads(deps, [fresh.row], new Map([[id, rec]]), at).get(id)!;
      const v = depsShedVerdict(inputOf(deps, fresh.row, store, await stampOf(deps, listing, id), listing, at));
      if (v.act !== 'shed') return { id, kind: 'held-at-act', verdict: v };
      // The switches over the fresh listing, the read nearest the argv: a kill switch, or an arming switch gone.
      const s = readSwitches(listing);
      const raised = DEPS_SHED_KILL.find((k) => s[k] !== 'clear');
      if (raised !== undefined) return { id, kind: 'switched-off', detail: raised };
      if (armedAtPass && s[DEPS_SHED_LIVE_MARKER] !== 'set') return { id, kind: 'switched-off', detail: DEPS_SHED_LIVE_MARKER };
      if (!ccdCan(deps.fleetState, 'wsShedDeps')) return { id, kind: 'held-at-act', verdict: { act: 'hold', reason: 'no-verb' } };
      const res = await deps.runCcd(CCD_ARGV.wsShedDeps(id, v.class, !armedAtPass, sweepDec(deps.fleetState, DEPS_SHED_ACTOR)));
      const a: DepsShedAnswer = res.ran === false ? { kind: 'unreadable', detail: res.stderr || 'the call never ran' }
        : parseDepsShedAnswer(res.stdout, id);
      if (a.kind === 'shed' || a.kind === 'would-shed') {
        if (a.kind === 'would-shed') mem.reported.set(id, fresh.row.stoppedBy?.at ?? row.stoppedBy!.at);
        recordFeed(deps, id, v.class, a);
        console.warn(`ccrc-server: deps-shed: ${a.kind === 'shed' ? 'removed' : 'would remove'} ${id}'s dependencies (${v.class}, ${sizeWords(a.dirs, a.bytes)}; D-7278)`);
        return { id, kind: a.kind, dirs: a.dirs, bytes: a.bytes };
      }
      if (a.kind === 'refused' && DEPS_SHED_FINAL_REFUSALS.includes(a.word)) {
        mem.settled.set(id, fresh.row.stoppedBy?.at ?? sleepAt);
        console.warn(`ccrc-server: deps-shed: ccd refused ${id}: ${a.word} — not asked again this sleep`);
        return { id, kind: a.kind, word: a.word, detail: a.detail };
      }
      holdOff();
      if (a.kind === 'refused' || a.kind === 'failed') {
        console.warn(`ccrc-server: deps-shed: ccd ${a.kind} ${id}: ${a.word} — held off (${mem.refusals.get(id)?.n ?? 1} this sleep)`);
        return { id, kind: a.kind, word: a.word, detail: a.detail };
      }
      console.warn(`ccrc-server: deps-shed: the ask about ${id} came to nothing readable (${a.detail}) — held off`);
      return { id, kind: 'unreadable', detail: a.detail };
    });
  } catch (err) {
    holdOff();
    return { id, kind: 'unreadable', detail: errText(err) };
  }
}
