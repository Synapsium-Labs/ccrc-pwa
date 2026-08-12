import { EventEmitter } from 'node:events';
import type { CoordStatus, FleetSession, RunSummary, SessionStreamMsg } from '../../shared/api.js';

export interface Notice { message: string }

/** Per-session stream events, carrying a SessionStreamMsg payload. */
export type SessionEventName = `session:${string}`;

/**
 * Typed event bus shared between the watcher, routes, and websocket streams.
 * Events: 'fleet' (FleetSession[]), 'notice' ({message}), 'runs' (RunSummary[],
 * Build 7 — see `FleetWatcher.emitRuns`), 'coord' (CoordStatus, Build 4 — see
 * `FleetWatcher.emitCoord`), 'session:<id>' (SessionStreamMsg).
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
  override emit(event: SessionEventName, msg: SessionStreamMsg): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on(event: 'fleet', listener: (sessions: FleetSession[]) => void): this;
  override on(event: 'notice', listener: (notice: Notice) => void): this;
  override on(event: 'runs', listener: (runs: RunSummary[]) => void): this;
  override on(event: 'coord', listener: (coord: CoordStatus) => void): this;
  override on(event: SessionEventName, listener: (msg: SessionStreamMsg) => void): this;
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override off(event: 'fleet', listener: (sessions: FleetSession[]) => void): this;
  override off(event: 'notice', listener: (notice: Notice) => void): this;
  override off(event: 'runs', listener: (runs: RunSummary[]) => void): this;
  override off(event: 'coord', listener: (coord: CoordStatus) => void): this;
  override off(event: SessionEventName, listener: (msg: SessionStreamMsg) => void): this;
  override off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }
}
