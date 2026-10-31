// #1170. L1: the host-pressure decider. Pure: it takes what the pressure lane holds (the last reading that landed, the
// last ask that did not, a request still out) and the link's state, and answers `FleetHealth.psi`. The lane
// (`pressureLane.ts`) only asks and records; every decision is here.
//
// THE CLASSIFICATION. A link is STALLED when it is down, when the last ask went unanswered after the last reading
// landed, or when an ask has been out longer than `PRESSURE_INFLIGHT_STALL_MS`. A stalled link whose last reading
// (no older than `PRESSURE_EVIDENCE_MS`) showed `full` at or above `PSI_WARN_FULL_PCT` is `host-pressure`: the agent
// was alive and the host was stalling it, which is what a registry flap under a thrash looks like. Any other stall is
// `link-down`, exactly as before. An agent that predates the op, or a kernel with no PSI, is never a stall: it is
// `unmeasured`, and the link is judged by `linkUp` alone.
import { PSI_CRITICAL_FULL_PCT, PSI_WARN_FULL_PCT, worstFull, type HostPressureHealth, type HostPsi, type PressureLink } from '../../shared/pressure.js';

/** The lane's clock: one read every ten seconds, so the last reading before a stall is at most that old. */
export const PRESSURE_SWEEP_MS = 10_000;
/** An ask out this long is a stall, though the request's own deadline (15 s) has not passed. */
export const PRESSURE_INFLIGHT_STALL_MS = 5_000;
/** A reading older than this explains nothing: the level reads `unmeasured`, and a stall is `link-down`. */
export const PRESSURE_EVIDENCE_MS = 5 * 60_000;

/** What the lane holds. */
export interface PressureState {
  /** The last reading that landed. */
  last: { at: number; psi: HostPsi } | null;
  /** When the last ask went unanswered (a timeout, a disconnect, an error reply), or null. */
  unansweredAt: number | null;
  /** When the ask still out was sent, or null. */
  inflightSince: number | null;
}

export const EMPTY_PRESSURE: PressureState = { last: null, unansweredAt: null, inflightSince: null };

/** The level one reading carries. */
export function pressureLevelOf(psi: HostPsi): 'ok' | 'warn' | 'critical' {
  const w = worstFull(psi);
  return w >= PSI_CRITICAL_FULL_PCT ? 'critical' : w >= PSI_WARN_FULL_PCT ? 'warn' : 'ok';
}

/** Is the link stalled, by what the lane holds and whether it is up? */
export function linkStalled(s: PressureState, linkUp: boolean, now: number): boolean {
  if (!linkUp) return true;
  if (s.unansweredAt !== null && (s.last === null || s.unansweredAt >= s.last.at)) return true;
  return s.inflightSince !== null && now - s.inflightSince >= PRESSURE_INFLIGHT_STALL_MS;
}

/** The link's classification (see the header). */
export function pressureLink(s: PressureState, linkUp: boolean, now: number): PressureLink {
  if (!linkStalled(s, linkUp, now)) return 'answering';
  const ev = evidence(s, now);
  return ev !== null && worstFull(ev.psi) >= PSI_WARN_FULL_PCT ? 'host-pressure' : 'link-down';
}

/** The last reading when it is young enough to say anything, else null. */
const evidence = (s: PressureState, now: number): PressureState['last'] =>
  s.last !== null && now - s.last.at <= PRESSURE_EVIDENCE_MS ? s.last : null;

/** `FleetHealth.psi`: the last reading, its level (`unmeasured` when there is none or it is too old to say anything),
 *  and the link's classification. */
export function pressureBlock(s: PressureState, linkUp: boolean, now: number): HostPressureHealth {
  const fresh = evidence(s, now);
  return {
    at: s.last?.at ?? null,
    level: fresh === null ? 'unmeasured' : pressureLevelOf(fresh.psi),
    link: pressureLink(s, linkUp, now),
    memory: s.last?.psi.memory ?? null,
    io: s.last?.psi.io ?? null,
  };
}
