import { EventEmitter } from 'node:events';
import type { FleetSession, SessionStreamMsg } from '../../shared/api.js';

export interface Notice { message: string }

/** Per-session stream events, carrying a SessionStreamMsg payload. */
export type SessionEventName = `session:${string}`;

/**
 * Typed event bus shared between the watcher, routes, and websocket streams.
 * Events: 'fleet' (FleetSession[]), 'notice' ({message}), 'session:<id>' (SessionStreamMsg).
 */
export class Bus extends EventEmitter {
  override emit(event: 'fleet', sessions: FleetSession[]): boolean;
  override emit(event: 'notice', notice: Notice): boolean;
  override emit(event: SessionEventName, msg: SessionStreamMsg): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on(event: 'fleet', listener: (sessions: FleetSession[]) => void): this;
  override on(event: 'notice', listener: (notice: Notice) => void): this;
  override on(event: SessionEventName, listener: (msg: SessionStreamMsg) => void): this;
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override off(event: 'fleet', listener: (sessions: FleetSession[]) => void): this;
  override off(event: 'notice', listener: (notice: Notice) => void): this;
  override off(event: SessionEventName, listener: (msg: SessionStreamMsg) => void): this;
  override off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }
}
