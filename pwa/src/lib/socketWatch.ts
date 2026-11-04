// The socket watchdog's decider (console speed, task C1 "the link and the start"; spec 2026-11-04 §2.3, D11). Pure:
// `ReconnectingSocket` (`lib/ws.ts`) keeps the state and the timer, and asks here what to do next.
//
// A socket is `connecting` until it opens, `open` until the server's first `beat` frame, and `armed` after it. Only
// an armed socket is ever closed for silence, by the check or by `nudge()` on a return to the page, so a server too
// old to send beats, or a quiet fleet that sends no fleet frame for an hour, never has its open socket closed under
// it; before a beat only the connect limit acts. Any message resets the silence, not only a beat, so a
// busy but live link does not flap: thirty seconds is three missed ten-second beats.
import { isRecord } from './wire';

/** An armed socket that has heard nothing for this long is dead (D11). */
export const SILENCE_MS = 30_000;
/** A socket that has not opened after this long is given up and retried. */
export const CONNECT_MS = 10_000;

/** How often the socket asks `nextWatchStep`. A close therefore lands within this much after its bound. */
export const WATCH_CHECK_MS = 5_000;

export type WatchPhase = 'connecting' | 'open' | 'armed';

export interface WatchState {
  readonly phase: WatchPhase;
  /** When this phase began (the attempt for `connecting`, the open for `open` and `armed`). */
  readonly since: number;
  /** When the last parsed message arrived on this socket, or null before the first. */
  readonly lastMessageAt: number | null;
}

export type WatchStep = 'wait' | 'close-silent' | 'close-connect';

export function nextWatchStep(s: WatchState, nowMs: number): WatchStep {
  if (s.phase === 'connecting') return nowMs - s.since >= CONNECT_MS ? 'close-connect' : 'wait';
  if (s.phase === 'armed') return nowMs - (s.lastMessageAt ?? s.since) >= SILENCE_MS ? 'close-silent' : 'wait';
  return 'wait';
}

/** On the page becoming visible or coming back online: is the last message old enough that the socket is suspect?
 *  Null (nothing heard) is stale. */
export function staleOnVisible(lastMessageAt: number | null, nowMs: number): boolean {
  return lastMessageAt === null || nowMs - lastMessageAt >= SILENCE_MS;
}

/** The server's heartbeat frame, `{type:'beat'}` (spec §2.2, D14): a transport frame, consumed by the socket and never
 *  handed to a store. Its first arrival arms the watchdog. */
export function isBeatFrame(msg: unknown): boolean {
  return isRecord(msg) && msg.type === 'beat';
}
