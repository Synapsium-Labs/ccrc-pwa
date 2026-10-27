import type { FleetState } from './fleetstate.js';
import type { Deps } from './server.js';
import type { Viewers } from './viewer.js';
import type { NotifyLog } from './notifylog.js';
import type { SessionRecord } from './registry.js';
import type { CoordStore } from './coord/store.js';
import type { TurnVerdict } from './coord/archiveDoor.js';
import { notify, type NoticeRecord } from './notice.js';
import { CCD_ARGV, HIBERNATE_HOLD_OK_CAP, capSupported, ccdCan, sweepDec } from './ccdargv.js';
import {
  HIBERNATE_ACT_LINE_MS, HIBERNATE_AFTER_HOURS_FILE, HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER,
  HIBERNATE_PER_SWEEP, HIBERNATE_SHADOW_LINE_MS, HIBERNATE_SWEEP_ACTOR, IDLE_HOURS_POLICY, NO_HIBERNATE_SUFFIX,
  hibernateAfterMs, hibernateVerdict, type HibernateInput, type HibernateLive, type HibernateMark, type HibernateRow,
  type HibernateStoreRead, type HibernateVerdict,
} from './coord/hibernate.js';
import { RECLAIM_PAUSE_MARKER, programmeHoldOf } from './coord/rundefs.js';
import { PRESENCE_OPEN_TTL_MS, TERMINAL_RUN_STATES, type FleetSession } from '../../shared/api.js';
import { readSwitches, type MarkerSwitchName } from '../../shared/switches.js';
import {
  RUN_DONE_POLICY, STOP_DONE_ACTOR, STOP_DONE_DISABLED_MARKER, STOP_DONE_GRACE_MS, STOP_DONE_MEASURES_PER_PASS,
  STOP_DONE_PARKED_STATES, STOP_DONE_PER_PASS, STOP_DONE_RETRY_MS,
  mailOnly, stopDoneVerdict, type StopDoneHeldKind, type StopDoneInput, type StopDoneLive, type StopDoneMark, type StopDoneRow,
  type StopDoneStoreRead, type StopDoneVerdict,
} from './stopDone.js';
import type { SleepPolicy } from './sleep.js';
import type { LaneName } from './laneSchedule.js';

/**
 * PUT A SESSION TO SLEEP, THE ONE EXECUTOR (D-7042; ARCH-43, consolidation spec K1): L4, it reads, logs and acts; it
 * decides nothing — `decideSleep` (`sleep.ts`, L1) holds the ladder, steered by each lane's policy row. Two lanes put a
 * session to sleep with `ccd hibernate`, and they are two rows of one table here (`SLEEP_LANES`):
 *
 *  - `run-done` (the stop-done lane, D-5370, D-5427, D-6091, D-6092): a finished run's worker. LIVE under its own kill
 *    switches; its clock is the run's close; a programme hold, or one naming a terminal run, passes through
 *    `ccd hibernate --hold-ok <the exact text>` on a box that advertises `hibernate-hold-ok`.
 *  - `idle-hours` (hibernation, D-5242): a long-idle session. SHADOW unless ARMED: without `$REG/hibernate-live`, or on a
 *    box whose ccd does not list `hibernate`, or before `buildServer` hands over the coordination serialiser, a
 *    `hibernate` answer only logs its shadow line. Arming is the operator's act; nothing in the tree writes the marker.
 *
 * Every way the two lanes differ is a field of the row (C4a's difference table, `sleep-lanes-pin.test.ts`): kill
 * switches, arming, population and its order, per-pass caps, when the act runs, retry memory, the store reads, the live
 * reads and their order, notices, log sentences, the actor and whether the verb is asked again beside the argv. Merging
 * the rows' code never merges their arming or their herd budget (spec K1): each pass counts its own acts and measures.
 *
 * ONE PASS (`sleepPass`): the lane's switches through the one reader (`readSwitches`), on the tick's listing; the
 * quiet threshold (idle-hours' N, `$REG/hibernate-after-hours` read only when listed; run-done's grace); arming; the
 * population; the lane's binding read for it (today's two store-read functions, D-7044); the verdict on what is known; a
 * row answered `measure` has its live state read and is asked again; at most the lane's acts (and measures), each act
 * after the loop or inline, as the row says, or the shadow line.
 *
 * ONE ACT (`sleepAct`): ON THE COORDINATION SERIALISER and then the session's own queue (D-5428), so a dispatch opening
 * a run onto it, or a mail delivery typing into its pane, finishes first; inside them the registry record and the row
 * the frame assembles from it (`rowAtAct`; unreadable holds `unmeasured`), the store, presence and the live state are
 * read AGAIN — the tick's roster read alone is kept when the re-read row has none — the row's `.hold` is classified
 * again (`heldKindOf`) and the verdict asked again; where the row says so the verb is asked again beside the argv (a box
 * can be re-handshaken in the wait); only a `hibernate` answer composes `ccd hibernate <id>` (`CCD_ARGV.hibernate`,
 * the lane declared by `sweepDec` under its own actor). ccd re-measures the box-local half at the act and the one hold
 * the server cannot see (`attached`); its refusal, `ccd: session-busy: <reason>` at exit 3, is read off a call that ran
 * (D-6840). The act never throws.
 *
 * WHY THE ACT READS AS DELIBERATE. `cmd_hibernate` journals a `hibernate` row before it unsupervises, and
 * `DEAD_COORDINATOR_DELIBERATE_ACTS` names `hibernate`, so the dead-coordinator lane, the PWA (`hibernatedAt`) and child
 * reclamation read a deliberate sleep, never a crash. A sleeping row carries the stop stamp `ccd hibernate` writes, so
 * run-done's population never asks it twice; it wakes as any sleeping session does (mail under the wake budget, a
 * re-dispatch's `ensure`, an open screen). The pane menu is the watcher's newest scrape, and the live reads use the
 * tick's record: a uuid or wrapper that changed since fails closed (the marker reads `foreign`, the live file
 * `unmeasured`). Presence is never persisted: every candidate holds `viewer` for `PRESENCE_OPEN_TTL_MS` after
 * `startedAt`, so a hidden tab that has not reconnected after a deploy is not an empty screen.
 */

// ── The act's port, the verdicts and what an act came to ───────────────────────────────────────────────────────────

/** The act's half of a lane's deps: the runner, the box's caps, the serialiser, the session queue and the re-read. */
export interface SleepActPort<Row> {
  readonly runCcd: Deps['runCcd'];
  readonly fleetState: FleetState | undefined;
  /** The coordination serialiser (`CoordRoutesHandle.serial`); null until `buildServer` hands it over. */
  readonly serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null;
  /** The process's per-session write queue. */
  readonly queueRun: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  /** At the act: the registry record read again and the frame's row assembled from it (`readSessionRecord`, then
   *  `liveRowFor`). `ok: false` when either could not be read — the act then holds `unmeasured`. */
  readonly rowAtAct: (rec: SessionRecord) => Promise<{ ok: true; row: Row } | { ok: false }>;
}

/** A verdict as the executor reads it: each lane's own verdict type (`StopDoneVerdict`, `HibernateVerdict`) is one. */
export type SleepAnswer =
  | { readonly act: 'hibernate'; readonly idleMs: number; readonly holdOk?: string }
  | { readonly act: 'measure' }
  | { readonly act: 'hold' };

/** A lane's `hibernate` answer. */
export type Asleep<V> = Extract<V, { readonly act: 'hibernate' }>;
const isAsleep = <V extends SleepAnswer>(v: V): v is Asleep<V> => v.act === 'hibernate';

/** What the executor reads off every lane's deps: its clock. */
export interface SleepDepsBase { readonly now: () => number }

/** The port once the lane is armed: its serialiser handed over. */
type ArmedPort<Row> = SleepActPort<Row> & { readonly serial: NonNullable<SleepActPort<Row>['serial']> };

/** What one act came to, before the lane words it. `held-at-act` with `verdict: null`: the record could not be re-read
 *  (`unmeasured`). `by` says where a skip or a failure came from: the verb asked again, ccd, or a throw. */
export type SleepActResult<V, St> =
  | { readonly kind: 'hibernated'; readonly verdict: Asleep<V>; readonly store: St }
  | { readonly kind: 'held-at-act'; readonly verdict: V | null }
  | { readonly kind: 'skipped'; readonly detail: string; readonly by: 'verb' | 'ccd' }
  | { readonly kind: 'failed'; readonly detail: string; readonly by: 'ccd' | 'throw' };

/** The pass's facts every ask reads: the listing, the quiet threshold, the box's answers and the binding read. */
export interface SleepPassFacts<St> {
  readonly names: readonly string[];
  /** idle-hours' N; run-done's grace. */
  readonly quietMs: number;
  /** `ccdCan(fleetState, 'hibernate')`, asked once a pass. */
  readonly verb: boolean;
  /** `capSupported(fleetState, HIBERNATE_HOLD_OK_CAP)` for a lane that passes holds; false for the other. */
  readonly holdOkVerb: boolean;
  /** The lane's binding read for one session of the pass (D-7044). */
  readonly storeOf: (id: string) => St;
}

// ── The lane row ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Who the pass looks at. `dispatched-children-by-id`: the frame's dispatched children that are neither stopped nor
 *  archived, with a record, not in retry, sorted by id. `recorded-rows-in-frame-order`: every row with a record. */
export type SleepPopulation = 'dispatched-children-by-id' | 'recorded-rows-in-frame-order';

/** Each pass's own budget. `past: 'stop'`: the pass stops once it has `acts` due or has measured `measures`; `'wait'`:
 *  past `acts` a row simply waits for the next pass while measures go on (`measures: null`, unbounded). */
export interface SleepCaps { readonly acts: number; readonly measures: number | null; readonly past: 'stop' | 'wait' }

/** What a refused act leaves behind. `hold-off`: not asked again for `ms` (`of` is the lane memory's map), pruned at the
 *  pass's start. `ask-next-pass`: asked again next pass; skip and failure lines at most once per `lineMs` per id,
 *  shadow lines once per `shadowLineMs`, both maps (`of`) pruned of ids the pass no longer sees. */
export type SleepRetry<M> =
  | { readonly kind: 'hold-off'; readonly ms: number; readonly of: (m: M) => Map<string, number> }
  | { readonly kind: 'ask-next-pass'; readonly lineMs: number; readonly shadowLineMs: number;
    readonly of: (m: M) => readonly Map<string, number>[] };

/** The lane's notices (stop-done's two feed rows through the funnel; none for idle-hours). `pass` is given `null`
 *  facts for an empty population. */
export interface SleepNotices<D, M, V, St> {
  readonly pass: (deps: D, mem: M, pop: readonly FleetSession[], f: SleepPassFacts<St> | null, now: number) => void;
  readonly slept: (deps: D, id: string, v: Asleep<V>, store: St) => void;
}

/**
 * One sleep lane. `D`, `M` and `O` are the lane's own deps, memory and outcome types (kept by its pass's signature),
 * `Row` the row its re-read returns, `St` its store read, `V` its verdict. Every value is C4a's measured row.
 */
export interface SleepLane<D extends SleepDepsBase, M, Row extends { readonly subagents: FleetSession['subagents'] }, St, V extends SleepAnswer, O> {
  readonly policy: SleepPolicy<string>;
  /** Any of these listed: the pass reads, logs and does nothing (by `SWITCHES` name). */
  readonly kill: readonly MarkerSwitchName[];
  /** The switch that arms the act; `null`: live, no switch. */
  readonly arming: MarkerSwitchName | null;
  /** Its `LANE_SCHEDULE` row, which `FleetWatcher.sweepSleep` runs it through (D-7045). */
  readonly cadence: LaneName;
  readonly population: SleepPopulation;
  readonly caps: SleepCaps;
  /** `after-the-loop`: in population order once every row is judged; `inline`: as each row is reached. */
  readonly acts: 'after-the-loop' | 'inline';
  readonly retry: SleepRetry<M>;
  /** `needed`: no store, the lane does not run (the watcher's check); `optional`: no store holds `runs-unreadable`. */
  readonly store: 'needed' | 'optional';
  /** Not armed (or the serialiser not handed over): `nothing` is read or done, or the `shadow` line is logged. */
  readonly unarmed: 'nothing' | 'shadow';
  /** `holds-before-measure`: asked once a pass, a verdict input (`no-verb`); `arms-and-asked-at-act`: part of arming,
   *  and asked again beside the argv (`skipped`, `no-verb`). */
  readonly verb: 'holds-before-measure' | 'arms-and-asked-at-act';
  /** The lane passes a workspace hold through `--hold-ok` (`hibernate-hold-ok`, asked once a pass). */
  readonly holdOk: boolean;
  readonly actor: string;
  /** `per-pass`: one clock read for the pass's first asks (and the retry prune); `per-row`: one per row. */
  readonly clock: 'per-pass' | 'per-row';
  /** The quiet threshold; a promise only when it reads a file. */
  readonly quietMs: (deps: D, names: readonly string[]) => number | Promise<number>;
  readonly port: (deps: D) => SleepActPort<Row> | null;
  /** The binding read: the store's answers for `ids`, read the way the lane reads them today (D-7044). */
  readonly bindings: (deps: D, ids: readonly string[]) => (id: string) => St;
  /** The lane's asks, each with its reads in its own order: the first (live state unread), the measured one (the
   *  live reads, then the clock), and the one at the act (store, presence and live state again). */
  readonly asks: {
    readonly first: (deps: D, f: SleepPassFacts<St>, row: FleetSession, now: number) => V;
    readonly measured: (deps: D, f: SleepPassFacts<St>, row: FleetSession, rec: SessionRecord) => Promise<{ v: V; now: number }>;
    readonly atAct: (deps: D, f: SleepPassFacts<St>, row: Row, rec: SessionRecord) => Promise<{ v: V; store: St }>;
  };
  readonly notices: SleepNotices<D, M, V, St> | null;
  /** The shadow line, throttled (`null`: the lane has no shadow). */
  readonly shadow: ((deps: D, mem: M, id: string, v: Asleep<V>, now: number) => void) | null;
  /** The lane's lines for what its acts came to: inline after each act, or after the loop for every act. */
  readonly said: (deps: D, mem: M, id: string, r: SleepActResult<V, St>) => void;
  /** The outcome of a row the pass judged without acting (`null`: no outcome), and of one it acted on. */
  readonly outcome: {
    readonly judged: (id: string, v: V) => O | null;
    readonly acted: (id: string, v: Asleep<V>, r: SleepActResult<V, St>) => O;
  };
}

// ── The one pass and the one act ──────────────────────────────────────────────────────────────────────────────────────

/** ccd's refusal of an act it re-measured as not idle (`_hib_refuse`, exit 3): `ccd: session-busy: <reason>`. */
const SESSION_BUSY = /ccd: session-busy: ?(\S*)/;

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The exact `.hold` text a verdict passed with, or null. */
const holdOkOf = (v: SleepAnswer): string | null => (v.act === 'hibernate' ? v.holdOk ?? null : null);

const byIdOrder = (a: FleetSession, b: FleetSession): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One pass of a lane over the tick's rows, records and listing. Returns what it did, for the caller's log and the
 *  tests. */
export async function sleepPass<D extends SleepDepsBase, M, Row extends { readonly subagents: FleetSession['subagents'] }, St, V extends SleepAnswer, O>(
  lane: SleepLane<D, M, Row, St, V, O>, deps: D, mem: M,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<O[]> {
  const switches = readSwitches(names);
  if (lane.kill.some((k) => switches[k] === 'set')) return [];
  const q = lane.quietMs(deps, names);
  const quietMs = typeof q === 'number' ? q : await q;
  const port = lane.port(deps);
  const serial = port?.serial ?? null;
  const armed: ArmedPort<Row> | null = port !== null && serial !== null
    && (lane.arming === null || switches[lane.arming] === 'set')
    && (lane.verb !== 'arms-and-asked-at-act' || ccdCan(port.fleetState, 'hibernate')) ? { ...port, serial } : null;
  if (armed === null && lane.unarmed === 'nothing') return [];
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const passNow = lane.clock === 'per-pass' ? deps.now() : null;
  const retry = lane.retry;
  if (retry.kind === 'hold-off') {
    const at = retry.of(mem);
    const now = passNow ?? deps.now();
    for (const [id, until] of [...at]) if (until <= now) at.delete(id);
  }
  const inRetry = (id: string): boolean => retry.kind === 'hold-off' && retry.of(mem).has(id);
  const pop = lane.population === 'dispatched-children-by-id'
    ? sessions.filter((s) => s.child.kind === 'child' && s.stoppedBy === null && s.archivedAt === null && byId.has(s.id)
      && !inRetry(s.id)).sort(byIdOrder)
    : sessions.filter((s) => byId.has(s.id));
  const finish = (): void => {
    if (retry.kind !== 'ask-next-pass') return;
    const seen = new Set(sessions.map((s) => s.id));
    for (const m of retry.of(mem)) for (const id of [...m.keys()]) if (!seen.has(id)) m.delete(id);
  };
  if (pop.length === 0) {
    lane.notices?.pass(deps, mem, pop, null, passNow ?? 0);
    finish();
    return [];
  }
  const fleetState = port?.fleetState;
  const f: SleepPassFacts<St> = {
    names, quietMs, storeOf: lane.bindings(deps, pop.map((s) => s.id)),
    verb: ccdCan(fleetState, 'hibernate'),
    holdOkVerb: lane.holdOk && capSupported(fleetState, HIBERNATE_HOLD_OK_CAP),
  };
  lane.notices?.pass(deps, mem, pop, f, passNow ?? 0);
  const out: O[] = [];
  const due: Array<{ readonly row: FleetSession; readonly rec: SessionRecord; readonly v: Asleep<V>; readonly port: ArmedPort<Row> }> = [];
  let acted = 0;
  let measured = 0;
  for (const row of pop) {
    if (lane.caps.past === 'stop' && acted >= lane.caps.acts) break;
    const rec = byId.get(row.id)!;
    let now = passNow ?? deps.now();
    let v = lane.asks.first(deps, f, row, now);
    if (v.act === 'measure') {
      if (lane.caps.measures !== null && measured >= lane.caps.measures) break;
      measured++;
      ({ v, now } = await lane.asks.measured(deps, f, row, rec));
    }
    if (!isAsleep(v)) {
      const o = lane.outcome.judged(row.id, v);
      if (o !== null) out.push(o);
      continue;
    }
    const asleep = v;
    if (armed === null) {
      const o = lane.outcome.judged(row.id, v);
      if (o !== null) out.push(o);
      lane.shadow?.(deps, mem, row.id, asleep, now);
      continue;
    }
    // Past the pass's own bound the row waits for the next pass: no line, no act.
    if (acted >= lane.caps.acts) {
      const o = lane.outcome.judged(row.id, v);
      if (o !== null) out.push(o);
      continue;
    }
    acted++;
    if (lane.acts === 'after-the-loop') { due.push({ row, rec, v: asleep, port: armed }); continue; }
    const r = await sleepAct(lane, deps, mem, f, armed, row, rec);
    out.push(lane.outcome.acted(row.id, asleep, r));
    lane.said(deps, mem, row.id, r);
  }
  const results: Array<readonly [string, SleepActResult<V, St>]> = [];
  for (const d of due) {
    const r = await sleepAct(lane, deps, mem, f, d.port, d.row, d.rec);
    out.push(lane.outcome.acted(d.row.id, d.v, r));
    results.push([d.row.id, r]);
  }
  for (const [id, r] of results) lane.said(deps, mem, id, r);
  finish();
  return out;
}

/** The act, for one row the pass answered `hibernate` for: on the serialiser, then the session's queue; everything
 *  re-read and the verdict asked again inside them; the verb again where the lane says so; only then `ccd hibernate`.
 *  Never throws. */
export async function sleepAct<D extends SleepDepsBase, M, Row extends { readonly subagents: FleetSession['subagents'] }, St, V extends SleepAnswer, O>(
  lane: SleepLane<D, M, Row, St, V, O>, deps: D, mem: M, f: SleepPassFacts<St>, port: ArmedPort<Row>,
  row: FleetSession, rec: SessionRecord,
): Promise<SleepActResult<V, St>> {
  const id = row.id;
  const retry = lane.retry;
  const holdOff = (): void => {
    if (retry.kind === 'hold-off') retry.of(mem).set(id, deps.now() + retry.ms);
  };
  try {
    return await port.serial(() => port.queueRun(id, async (): Promise<SleepActResult<V, St>> => {
      const fresh = await port.rowAtAct(rec);
      if (!fresh.ok) return { kind: 'held-at-act', verdict: null };
      // Only the roster falls back to the tick's read, when the re-read row has none.
      const again: Row = { ...fresh.row, subagents: fresh.row.subagents ?? row.subagents };
      const { v, store } = await lane.asks.atAct(deps, f, again, rec);
      if (!isAsleep(v)) return { kind: 'held-at-act', verdict: v };
      // Never sent to a ccd that does not list the verb, asked again here where the lane says so.
      if (lane.verb === 'arms-and-asked-at-act' && !ccdCan(port.fleetState, 'hibernate')) {
        return { kind: 'skipped', detail: 'no-verb', by: 'verb' };
      }
      const res = await port.runCcd(CCD_ARGV.hibernate(id, sweepDec(port.fleetState, lane.actor), holdOkOf(v)));
      if (!res.ok) {
        holdOff();
        // D-6840: a call that never ran has no `session-busy` to read off the runner's forged stderr.
        const busy = res.ran === false ? null : SESSION_BUSY.exec(res.stderr);
        return busy !== null
          ? { kind: 'skipped', detail: busy[1] || 'busy', by: 'ccd' }
          : { kind: 'failed', detail: res.stderr, by: 'ccd' };
      }
      lane.notices?.slept(deps, id, v, store);
      return { kind: 'hibernated', verdict: v, store };
    }));
  } catch (err) {
    holdOff();
    return { kind: 'failed', detail: errText(err), by: 'throw' };
  }
}

// ── run-done (the stop-done lane): its binding read, live reads, notices and lines ──────────────────────────────────

/** run-done's store port: the batched placed-run read, the live claims, outstanding mail, the feed archive and the run
 *  read `heldKindOf` classifies a run suffix by. */
export type RunDoneCoordPort = Pick<CoordStore, 'lastRunBySession' | 'activeClaims' | 'outstandingMailFor' | 'recordFeedEvent' | 'run'>;

export interface StopDoneSweepDeps {
  readonly coord: RunDoneCoordPort;
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

async function runDoneLive(deps: StopDoneSweepDeps, rec: SessionRecord): Promise<StopDoneLive> {
  const w = await deps.liveWord(rec);
  const turn = await deps.turnVerdict(rec, rec.uuid);
  const mark = await deps.mark(rec);
  return { kind: 'read', word: w.ok ? { ok: true, word: w.word } : { ok: false, reason: w.reason }, turn, mark };
}

/** run-done's verdict input: the row's `.hold` classified again at each ask (`heldKindOf`), presence read as it is
 *  built. */
function runDoneInput(
  deps: StopDoneSweepDeps, f: SleepPassFacts<StopDoneStoreRead>, row: StopDoneRow, store: StopDoneStoreRead,
  live: StopDoneLive, at: number,
): StopDoneInput {
  return {
    row, heldKind: heldKindOf(row.held, deps.coord), holdOkVerb: f.holdOkVerb, store, viewer: deps.viewers?.isOpen(row.id) ?? true,
    sinceStartMs: at - deps.startedAt,
    viewerOpenTtlMs: PRESENCE_OPEN_TTL_MS, verb: f.verb, optedOut: f.names.includes(`${row.id}.${NO_HIBERNATE_SUFFIX}`),
    live, now: at, graceMs: f.quietMs,
  };
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

/** The run's state as the act's store read it, `unknown` when it could not. */
const runStateOf = (store: StopDoneStoreRead): string => (store.ok && store.last !== null ? store.last.state : 'unknown');

/** The pair's two records, each its own literal (D-7041): the asleep row names its worker's session and run, the
 *  mail-only count is a `coord` record with no run and no session. Built here, not as a ternary inside `notify`'s
 *  arguments, so `review-cap`'s census (D-6911) reads the one record `notify` is handed, never a `kind: 'run'` branch
 *  beside the other branch's empty session. */
function feedRecord(row: StopDoneFeedRow): NoticeRecord {
  if (row.kind === 'asleep') {
    return {
      kind: 'run', sessionId: row.id, runId: row.runId, title: 'Worker asleep',
      body: `${row.id} was put to sleep: its run ${row.runId} is ${runStateWords(row.state)} and it sat idle. Mail, a re-dispatch or a restart wakes it.`,
    };
  }
  return {
    kind: 'coord', sessionId: '', runId: null, title: `${STOP_DONE_MAIL_ONLY_TITLE}: ${row.count}`,
    body: `${row.count} finished worker(s) stay awake for unread mail to them, with nothing in the coordination store or their workspace holding them besides; their panes are measured once it is read.`,
  };
}

function recordFeed(deps: StopDoneSweepDeps, row: StopDoneFeedRow): void {
  // D-7041: through the funnel, record-only (recorded whatever the presence, never pushed), with the lane's own prefix
  // and sentence on a failed archive. `viewers` is not handed over: record-only consults no presence.
  notify({ notifyLog: deps.notifyLog, coord: deps.coord }, feedRecord(row), 'record-only', {
    lane: 'stop-done',
    degraded: row.kind === 'asleep' ? `${row.id}'s sleep has no feed row` : 'the mail-only count has no feed row',
  });
}

/** The excluded row, written on this process's first pass and then only when the count differs from the last one. */
function recordMailOnly(deps: StopDoneSweepDeps, mem: StopDoneMemory, count: number): void {
  if (count === mem.mailOnly) return;
  mem.mailOnly = count;
  recordFeed(deps, { kind: 'mail-only', count });
}

/** The `run-done` lane row (D-5370, D-5427, D-6091, D-6092): live, three kill switches, dispatched children by id, at
 *  most 3 acts and 6 measures a pass, acts after the loop, an hour's hold-off after a refused act, the verb a verdict
 *  input, a workspace hold passed with `--hold-ok`. */
export const RUN_DONE_LANE: SleepLane<StopDoneSweepDeps, StopDoneMemory, StopDoneRow, StopDoneStoreRead, StopDoneVerdict, StopDoneOutcome> = {
  policy: RUN_DONE_POLICY,
  kill: [STOP_DONE_DISABLED_MARKER, RECLAIM_PAUSE_MARKER, HIBERNATE_DISABLED_MARKER],
  arming: null,
  cadence: 'sleepRunDone',
  population: 'dispatched-children-by-id',
  caps: { acts: STOP_DONE_PER_PASS, measures: STOP_DONE_MEASURES_PER_PASS, past: 'stop' },
  acts: 'after-the-loop',
  retry: { kind: 'hold-off', ms: STOP_DONE_RETRY_MS, of: (m) => m.retryAt },
  store: 'needed',
  unarmed: 'nothing',
  verb: 'holds-before-measure',
  holdOk: true,
  actor: STOP_DONE_ACTOR,
  clock: 'per-pass',
  quietMs: () => STOP_DONE_GRACE_MS,
  port: (deps) => deps,
  bindings: (deps, ids) => {
    const reads = storeReads(deps.coord, ids);
    return (id) => reads.get(id)!;
  },
  asks: {
    first: (deps, f, row, now) => stopDoneVerdict(runDoneInput(deps, f, row, f.storeOf(row.id), { kind: 'unread' }, now)),
    measured: async (deps, f, row, rec) => {
      const store = f.storeOf(row.id);
      const live = await runDoneLive(deps, rec);
      const now = deps.now();
      return { v: stopDoneVerdict(runDoneInput(deps, f, row, store, live, now)), now };
    },
    atAct: async (deps, f, row, rec) => {
      const at = deps.now();
      const store = storeReads(deps.coord, [row.id]).get(row.id)!;
      return { v: stopDoneVerdict(runDoneInput(deps, f, row, store, await runDoneLive(deps, rec), at)), store };
    },
  },
  notices: {
    // The excluded row's count, over the whole population (pure: the verdict asked twice, no live read).
    pass: (deps, mem, pop, f, now) => recordMailOnly(deps, mem, f === null ? 0
      : pop.filter((row) => mailOnly(runDoneInput(deps, f, row, f.storeOf(row.id), { kind: 'unread' }, now))).length),
    slept: (deps, id, v, store) => recordFeed(deps, { kind: 'asleep', id, runId: v.runId, state: runStateOf(store) }),
  },
  shadow: null,
  said: (_deps, _mem, id, r) => {
    if (r.kind === 'hibernated') console.warn(`ccrc-server: stop-done: put ${id} to sleep (run ${r.verdict.runId} ${runStateWords(runStateOf(r.store))}, idle; D-5370, D-5427, D-6091, D-6092)`);
    else if (r.kind === 'skipped') console.warn(`ccrc-server: stop-done: ccd re-measured ${id} as ${r.detail} — not asked again for an hour`);
    else if (r.kind === 'failed') console.warn(`ccrc-server: stop-done: the hibernate of ${id} failed (${r.detail}) — not asked again for an hour`);
  },
  outcome: {
    judged: () => null,
    acted: (id, _v, r) => (r.kind === 'hibernated' ? { id, kind: 'hibernated', runId: r.verdict.runId }
      : r.kind === 'held-at-act' ? { id, kind: 'held-at-act', verdict: r.verdict ?? { act: 'hold', reason: 'unmeasured' } }
        : { id, kind: r.kind, detail: r.detail }),
  },
};

/** One pass of the lane. Returns what it did, for the caller's log and the tests. */
export async function stopDonePass(
  deps: StopDoneSweepDeps, mem: StopDoneMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<StopDoneOutcome[]> {
  return sleepPass(RUN_DONE_LANE, deps, mem, sessions, records, names);
}

// ── idle-hours (hibernation): its binding read, live reads and lines ────────────────────────────────────────────────

/** idle-hours' store port: the bound runs (`bindingsOf`), the live claims and outstanding mail. */
export type IdleHoursCoordPort = Pick<CoordStore, 'bindingsOf' | 'activeClaims' | 'outstandingMailFor'>;

/** The act's half of the deps: absent in a shadow-only harness, and then nothing can act whatever the markers say. */
export interface HibernateActPort {
  readonly runCcd: Deps['runCcd'];
  readonly fleetState: FleetState | undefined;
  /** The coordination serialiser (`CoordRoutesHandle.serial`); null until `buildServer` hands it over, and while it is
   *  the sweep stays in shadow. */
  readonly serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null;
  /** The process's per-session write queue. */
  readonly queueRun: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  /** At the act: the registry record read again and the frame's row assembled from it (`readSessionRecord`, then
   *  `liveRowFor`). `ok: false` when either could not be read — the act then holds `unmeasured`. */
  readonly rowAtAct: (rec: SessionRecord) => Promise<{ ok: true; row: HibernateRow } | { ok: false }>;
}

export interface HibernateSweepDeps {
  /** Undefined without a coordination store: every row then holds `runs-unreadable`. */
  readonly coord: IdleHoursCoordPort | undefined;
  /** Undefined: every row holds `viewer` (fail closed): a screen nothing measured is never an empty one. */
  readonly viewers: Pick<Viewers, 'isOpen'> | undefined;
  /** `turnverdict.ts`'s `liveWordFor`, over the watcher's thunks. */
  readonly liveWord: (rec: SessionRecord) => Promise<
    { ok: true; word: string; since: number | null } | { ok: false; reason: 'no-pane' | 'no-config-dir' | 'unmeasured' }>;
  /** `turnverdict.ts`'s `turnMarkFor`: the turn marker, judged against the live process. */
  readonly mark: (rec: SessionRecord) => Promise<HibernateMark>;
  /** `$REG/hibernate-after-hours`'s body; called only when the listing names it. */
  readonly readAfterHours: () => Promise<string | null>;
  readonly log: (line: string) => void;
  readonly startedAt: number;
  readonly now: () => number;
  /** Null: shadow only, whatever the markers say. */
  readonly act: HibernateActPort | null;
}

export interface HibernateSweepMemory {
  /** The last shadow line per id. Pruned of ids the pass no longer sees. */
  readonly lastLine: Map<string, number>;
  /** The last skip or failure line per id after an act ccd refused or that failed. Pruned the same way. */
  readonly lastActLine: Map<string, number>;
}

/** What one row came to: the verdict the pass reached, and — armed, for a `hibernate` answer — what the act did. */
export type HibernateActOutcome =
  | { readonly kind: 'hibernated' }
  | { readonly kind: 'held-at-act'; readonly verdict: HibernateVerdict }
  | { readonly kind: 'skipped'; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string };
export interface HibernateSweepOutcome {
  readonly id: string;
  readonly verdict: HibernateVerdict;
  readonly act?: HibernateActOutcome;
}

/** One session's store answers. The live claims are read once a pass and handed in (null when that read failed).
 *  FAIL CLOSED (hibernate-store-reads-fail-closed (D-5426)): mail is `outstandingMailFor`'s — delivered but not yet
 *  acknowledged counts, as it does for the stop-done lane — and a claim or mail read that fails, or no store at all,
 *  holds `runs-unreadable` exactly as a failed run read does. */
function storeRead(coord: HibernateSweepDeps['coord'], claimants: ReadonlySet<string> | null, id: string): HibernateStoreRead {
  if (coord === undefined) return { ok: false, detail: 'no coordination store' };
  if (claimants === null) return { ok: false, detail: 'the live claims could not be read' };
  try {
    const bound = coord.bindingsOf(id);
    const worker = bound.worker();
    if (!worker.ok) return { ok: false, detail: worker.detail };
    const claimant = bound.claimant();
    if (!claimant.ok) return { ok: false, detail: claimant.detail };
    return {
      ok: true, openWorker: worker.siblings.length > 0, openClaimant: claimant.siblings.length > 0,
      claim: claimants.has(id),
      // D-5838: a PARKED row does not veto (it waits on its box, up to 24 h, and
      // would keep this session resident that long). Its retry still reaches
      // the session through the due loop, and a hibernated one through the
      // ensure-wake gate first; a fresh box then differs from its park and lands.
      mail: coord.outstandingMailFor(id).some((m) => m.parkedAt == null),
    };
  } catch (err) {
    return { ok: false, detail: errText(err) };
  }
}

async function idleHoursLive(deps: HibernateSweepDeps, rec: SessionRecord): Promise<HibernateLive> {
  const w = await deps.liveWord(rec);
  const mark = await deps.mark(rec);
  return { kind: 'read', word: w.ok ? { ok: true, word: w.word } : { ok: false, reason: w.reason }, mark };
}

/** The live claims, read once (null when the read failed or there is no store). */
function claimantsOf(coord: HibernateSweepDeps['coord']): ReadonlySet<string> | null {
  if (coord === undefined) return null;
  try {
    return new Set(coord.activeClaims().map((c) => c.heldBy));
  } catch {
    return null;
  }
}

const hours = (ms: number): number => Math.floor(ms / (60 * 60_000));

/** idle-hours' binding read: the live claims once, then each session's store read at each ask. */
function idleHoursBindings(deps: HibernateSweepDeps): (id: string) => HibernateStoreRead {
  const claimants = claimantsOf(deps.coord);
  return (id) => storeRead(deps.coord, claimants, id);
}

/** idle-hours' verdict input, built again for each ask: the store and presence are read as it is built, AFTER the
 *  live reads, which take real time. */
function idleHoursInput(
  deps: HibernateSweepDeps, f: SleepPassFacts<HibernateStoreRead>, row: HibernateRow, live: HibernateLive, at: number,
): HibernateInput {
  return {
    row, optedOut: f.names.includes(`${row.id}.${NO_HIBERNATE_SUFFIX}`), store: f.storeOf(row.id),
    viewer: deps.viewers?.isOpen(row.id) ?? true, sinceStartMs: at - deps.startedAt, live,
  };
}

/** A skip or failure line, at most once per id per `HIBERNATE_ACT_LINE_MS`. */
function noteAct(deps: HibernateSweepDeps, mem: HibernateSweepMemory, id: string, line: string): void {
  const now = deps.now();
  const last = mem.lastActLine.get(id);
  if (last !== undefined && now - last < HIBERNATE_ACT_LINE_MS) return;
  mem.lastActLine.set(id, now);
  deps.log(line);
}

/** The `idle-hours` lane row (D-5242): shadow unless armed by `hibernate-live` with the verb on the box and the
 *  serialiser handed over; every recorded row in frame order; at most 3 acts a pass, measures unbounded; acts inline;
 *  asked again next pass, its lines throttled hourly; the verb asked again beside the argv. */
export const IDLE_HOURS_LANE: SleepLane<HibernateSweepDeps, HibernateSweepMemory, HibernateRow, HibernateStoreRead, HibernateVerdict, HibernateSweepOutcome> = {
  policy: IDLE_HOURS_POLICY,
  kill: [HIBERNATE_DISABLED_MARKER],
  arming: HIBERNATE_LIVE_MARKER,
  cadence: 'sleepIdleHours',
  population: 'recorded-rows-in-frame-order',
  caps: { acts: HIBERNATE_PER_SWEEP, measures: null, past: 'wait' },
  acts: 'inline',
  retry: { kind: 'ask-next-pass', lineMs: HIBERNATE_ACT_LINE_MS, shadowLineMs: HIBERNATE_SHADOW_LINE_MS, of: (m) => [m.lastLine, m.lastActLine] },
  store: 'optional',
  unarmed: 'shadow',
  verb: 'arms-and-asked-at-act',
  holdOk: false,
  actor: HIBERNATE_SWEEP_ACTOR,
  clock: 'per-row',
  quietMs: (deps, names) => (names.includes(HIBERNATE_AFTER_HOURS_FILE)
    ? deps.readAfterHours().then(hibernateAfterMs) : hibernateAfterMs(null)),
  port: (deps) => deps.act,
  bindings: (deps) => idleHoursBindings(deps),
  asks: {
    first: (deps, f, row, now) => hibernateVerdict(idleHoursInput(deps, f, row, { kind: 'unread' }, now), now, f.quietMs),
    measured: async (deps, f, row, rec) => {
      const live = await idleHoursLive(deps, rec);
      const now = deps.now();
      return { v: hibernateVerdict(idleHoursInput(deps, f, row, live, now), now, f.quietMs), now };
    },
    atAct: async (deps, f, row, rec) => {
      const live = await idleHoursLive(deps, rec);
      const at = deps.now();
      const store = idleHoursBindings(deps)(row.id);
      const v = hibernateVerdict(idleHoursInput(deps, { ...f, storeOf: () => store }, row, live, at), at, f.quietMs);
      return { v, store };
    },
  },
  notices: null,
  shadow: (deps, mem, id, v, now) => {
    const last = mem.lastLine.get(id);
    if (last !== undefined && now - last < HIBERNATE_SHADOW_LINE_MS) return;
    mem.lastLine.set(id, now);
    deps.log(`ccrc-server: hibernate-shadow ${id} idle=${hours(v.idleMs)}h`);
  },
  said: (deps, mem, id, r) => {
    if (r.kind === 'hibernated') {
      mem.lastActLine.delete(id);
      deps.log(`ccrc-server: hibernated ${id} idle=${hours(r.verdict.idleMs)}h (D-5242)`);
    } else if (r.kind === 'skipped' && r.by === 'ccd') {
      noteAct(deps, mem, id, `ccrc-server: hibernate-skip ${id}: ccd re-measured it as ${r.detail} — asked again next sweep`);
    } else if (r.kind === 'failed') {
      noteAct(deps, mem, id, `ccrc-server: hibernate of ${id} failed (${r.by === 'throw' ? r.detail : r.detail.trim() || 'no stderr'}) — asked again next sweep`);
    }
  },
  outcome: {
    judged: (id, v) => ({ id, verdict: v }),
    acted: (id, v, r) => ({
      id, verdict: v,
      act: r.kind === 'hibernated' ? { kind: 'hibernated' }
        : r.kind === 'held-at-act' ? { kind: 'held-at-act', verdict: r.verdict ?? { act: 'hold', reason: 'unmeasured' } }
          : { kind: r.kind, detail: r.detail },
    }),
  },
};

/** One pass. Returns every row's verdict (and, armed, what each act did), for the tests and the watcher's log. */
export async function hibernatePass(
  deps: HibernateSweepDeps, mem: HibernateSweepMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<HibernateSweepOutcome[]> {
  return sleepPass(IDLE_HOURS_LANE, deps, mem, sessions, records, names);
}

/** The sleep lanes, one row per policy, in the order the tick starts them (C4e walks them). */
export const SLEEP_LANES = [RUN_DONE_LANE, IDLE_HOURS_LANE] as const;
