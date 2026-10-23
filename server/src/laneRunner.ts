// L4 — the one place a watcher lane is throttled, kept to a single flight and caught (D-5862; ARCH-68 #803; spec K11).
//
// `FleetWatcher.runLane` and its companions delegate here; the rows are `LANE_SCHEDULE`'s (`./laneSchedule.ts`). The
// runner decides nothing about WHAT a lane does, only WHEN it may run and what a second caller gets:
//   - the throttle stamps BEFORE the lane's work is awaited, on the row's own clock, so a tick that lands mid-run is
//     throttled;
//   - `skip` refuses a second run (and abandons one older than the row's `staleAfterMs`: an owner token means only the
//     run that was started last may clear the flight), `join` hands back the run in flight, `join-rerun` joins and
//     lets a caller queue exactly one rerun, `none` lets runs overlap;
//   - a lane whose row has a `warnKey` is caught here with that sentence; a lane without one hands its rejection
//     back to its caller.
// It never awaits a lane its caller did not await: `run` returns the lane's own promise (or null when throttled).
import { LANE_SCHEDULE, type LaneClock, type LaneRow } from './laneSchedule.js';

export interface LaneClocks {
  wall(): number;
  mono(): number;
}

interface Flight { readonly token: symbol; readonly promise: Promise<unknown>; readonly startedAt: number }
interface LaneState { stamp: number; flight: Flight | null; again: (() => void) | null }

export class LaneRunner {
  private readonly rows = new Map<string, LaneRow>();
  private readonly state = new Map<string, LaneState>();

  constructor(
    private readonly clocks: LaneClocks,
    rows: readonly LaneRow[] = LANE_SCHEDULE,
    private readonly warn: (message: string) => void = (m) => console.warn(m),
  ) {
    for (const r of rows) {
      this.rows.set(r.name, r);
      // A lane starts due. A wall-clock lane has always started its stamp at 0; a monotonic clock reads small at
      // boot, so its stamp starts below any reading.
      this.state.set(r.name, { stamp: r.clock === 'wall' ? 0 : Number.NEGATIVE_INFINITY, flight: null, again: null });
    }
  }

  private at(clock: LaneClock): number { return clock === 'mono' ? this.clocks.mono() : this.clocks.wall(); }
  private rowOf(name: string): LaneRow {
    const row = this.rows.get(name);
    if (row === undefined) throw new Error(`no lane named ${name}`);
    return row;
  }
  private stateOf(name: string): LaneState { this.rowOf(name); return this.state.get(name)!; }

  /** Whether the lane's cadence has elapsed on its own clock (pure: it stamps and starts nothing). */
  due(name: string): boolean {
    const row = this.rowOf(name);
    return this.at(row.clock) - this.stateOf(name).stamp >= row.cadenceMs;
  }

  /** An on-demand run's stamp (`inventoryNow`, `serverCapsNow`): the next beat counts from here. */
  stamp(name: string): void { this.stateOf(name).stamp = this.at(this.rowOf(name).clock); }

  /** The next `run` is due, whatever the clock says (`childMarkLeftListing` for the lifecycle lane). */
  kick(name: string): void { this.stateOf(name).stamp = this.rowOf(name).clock === 'wall' ? 0 : Number.NEGATIVE_INFINITY; }

  /** The post-gather re-stamp on the decision clock: a gather slower than the cadence throttles the next beat from
   *  the decision, not from the start. The lane's own pass counter stays the lane's. */
  restamp(name: string): void { this.stamp(name); }

  /** The run in flight, or null (the dead-coordinator seal reads it where it read a guard and a promise). */
  inFlight(name: string): Promise<unknown> | null { return this.stateOf(name).flight?.promise ?? null; }

  /** Ask for exactly one rerun when the run in flight settles; honoured on a `join-rerun` row only, and only while a
   *  run is in flight, and the last asker's thunk is the one called. */
  requestRerun(name: string, again: () => void): void {
    const row = this.rowOf(name);
    const st = this.stateOf(name);
    if (row.flight === 'join-rerun' && st.flight !== null) st.again = again;
  }

  /** The beat: runs the lane when its cadence has elapsed, else answers null. A run in flight is joined, refused or
   *  overlapped as the row says. */
  run<T>(name: string, fn: () => Promise<T> | T): Promise<T | undefined> | null {
    if (!this.due(name)) return null;
    return this.start(name, fn, false);
  }

  /** An on-demand run (no cadence check): joins a run in flight on a `join` or `join-rerun` row, else starts one.
   *  Only for a row with no `warnKey`: such a caller owns its rejection. */
  runNow<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    if (this.rowOf(name).warnKey !== null) throw new Error(`runNow: ${name} has a warnKey, so its rejection is caught by the runner`);
    return this.start(name, fn, true) as Promise<T>;
  }

  private start<T>(name: string, fn: () => Promise<T> | T, onDemand: boolean): Promise<T | undefined> | null {
    const row = this.rowOf(name);
    const st = this.stateOf(name);
    const cur = st.flight;
    if (cur !== null) {
      const stuck = row.flight === 'skip' && row.staleAfterMs !== undefined && this.at(row.clock) - cur.startedAt > row.staleAfterMs;
      if (row.flight === 'join' || row.flight === 'join-rerun') return cur.promise as Promise<T>;
      if (row.flight === 'skip' && !stuck) return onDemand ? cur.promise as Promise<T> : null;
    }
    this.stamp(name);
    const token = Symbol(name);
    let work: Promise<T>;
    try { work = Promise.resolve(fn()); } catch (e) { work = Promise.reject(e); }
    const caught = row.warnKey === null ? work : work.catch((err: unknown) => {
      this.warn(`${row.warnKey}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      return undefined as T;
    });
    const promise = caught.finally(() => {
      if (st.flight?.token !== token) return;
      st.flight = null;
      const again = st.again;
      st.again = null;
      if (again !== null) again();
    });
    st.flight = { token, promise, startedAt: this.at(row.clock) };
    return promise;
  }
}
