import { EventEmitter } from 'node:events';
import type { HookStateRawRead } from './hookstate.js';
import type { CoordStatus, DelegationProjectionWire, Dialog, Divergence, FleetSession, RunSummary, SessionStreamMsg, ProjectPoolsWire } from '../../shared/api.js';

export interface Notice { message: string }

/** Per-session stream events, carrying a SessionStreamMsg payload. */
export type SessionEventName = `session:${string}`;

/** The screen an answer route saw the pane move to (`DialogAnswered`'s `next`, decision
 *  `ask-answer-returns-next-screen`), for every open stream of that session: `answered:<id>`. */
export type AnsweredEventName = `answered:${string}`;

/** The watcher's look at one session's pane this tick, for the session's feed (ARCH-52, #787): `pane:<id>`. `at` is when
 *  the capture began (what an answer handled since is judged against); `doneAt` is when it returned (what freshness is
 *  judged against: a capture the remote tmux timeout ended took that long and is not stale for it). `pane` is null for
 *  a pane tmux could not capture. */
export type PaneEventName = `pane:${string}`;
export interface PaneReading { readonly at: number; readonly doneAt: number; readonly pane: string | null }

/** The watcher's raw read of one session's hookstate this tick, for the session's feed: `hook:<id>`. `at` is when the
 *  read returned; `uuid` is the identity the read was gated on. */
export type HookEventName = `hook:${string}`;
export interface HookReading { readonly at: number; readonly uuid: string; readonly raw: HookStateRawRead }

/**
 * Typed event bus shared between the watcher, routes, and websocket streams.
 * Events: 'fleet' (FleetSession[]), 'notice' ({message}), 'runs' (RunSummary[],
 * Build 7 — see `FleetWatcher.emitRuns`), 'coord' (CoordStatus, Build 4 — see
 * `FleetWatcher.emitCoord`), 'session:<id>' (SessionStreamMsg), 'answered:<id>' (Dialog | null),
 * 'pane:<id>' / 'hook:<id>' (the watcher's per-tick readings, for a session's feed).
 */
export class Bus extends EventEmitter {
  constructor() {
    super();
    // EventEmitter's default cap (10) is a leak HEURISTIC sized for a
    // handful of subscribers per emitter — not for "one `notice` listener per
    // concurrent viewer", which is this bus's actual, by-design fan-out:
    // every open per-session stream (`sessionws.ts`'s `SessionStream`) and
    // every open `/ws/fleet` connection (`server.ts`) adds one. Past 10
    // simultaneous viewers this logged "Possible EventEmitter memory leak
    // detected" on the live server, even though every listener IS removed on
    // close (`sessionws.ts`'s `stop()`, `server.ts`'s socket `'close'`) — a
    // wrong default, not a leak, so the fix is a higher explicit cap rather
    // than chasing a listener that was never actually left behind.
    this.setMaxListeners(100);
  }

  override emit(event: 'fleet', sessions: FleetSession[]): boolean;
  override emit(event: 'notice', notice: Notice): boolean;
  override emit(event: 'runs', runs: RunSummary[]): boolean;
  override emit(event: 'coord', coord: CoordStatus): boolean;
  override emit(event: 'divergence', divergences: Divergence[]): boolean;
  override emit(event: 'pools', pools: ProjectPoolsWire): boolean;
  /** Wave 4 (delegation broker): `null` WITHDRAWS the frame (the lane can no longer project). */
  override emit(event: 'delegation', delegation: DelegationProjectionWire | null): boolean;
  override emit(event: SessionEventName, msg: SessionStreamMsg): boolean;
  override emit(event: AnsweredEventName, next: Dialog | null): boolean;
  override emit(event: PaneEventName, reading: PaneReading): boolean;
  override emit(event: HookEventName, reading: HookReading): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on(event: 'fleet', listener: (sessions: FleetSession[]) => void): this;
  override on(event: 'notice', listener: (notice: Notice) => void): this;
  override on(event: 'runs', listener: (runs: RunSummary[]) => void): this;
  override on(event: 'coord', listener: (coord: CoordStatus) => void): this;
  override on(event: 'divergence', listener: (divergences: Divergence[]) => void): this;
  override on(event: 'pools', listener: (pools: ProjectPoolsWire) => void): this;
  override on(event: 'delegation', listener: (delegation: DelegationProjectionWire | null) => void): this;
  override on(event: SessionEventName, listener: (msg: SessionStreamMsg) => void): this;
  override on(event: AnsweredEventName, listener: (next: Dialog | null) => void): this;
  override on(event: PaneEventName, listener: (reading: PaneReading) => void): this;
  override on(event: HookEventName, listener: (reading: HookReading) => void): this;
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override off(event: 'fleet', listener: (sessions: FleetSession[]) => void): this;
  override off(event: 'notice', listener: (notice: Notice) => void): this;
  override off(event: 'runs', listener: (runs: RunSummary[]) => void): this;
  override off(event: 'coord', listener: (coord: CoordStatus) => void): this;
  override off(event: 'divergence', listener: (divergences: Divergence[]) => void): this;
  override off(event: 'pools', listener: (pools: ProjectPoolsWire) => void): this;
  override off(event: 'delegation', listener: (delegation: DelegationProjectionWire | null) => void): this;
  override off(event: SessionEventName, listener: (msg: SessionStreamMsg) => void): this;
  override off(event: AnsweredEventName, listener: (next: Dialog | null) => void): this;
  override off(event: PaneEventName, listener: (reading: PaneReading) => void): this;
  override off(event: HookEventName, listener: (reading: HookReading) => void): this;
  override off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }
}
