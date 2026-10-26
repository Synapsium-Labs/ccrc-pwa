// #1170: the fleet host's pressure stall information (PSI), L0 vocabulary. The agent's `pressure` op reads
// /proc/pressure/{memory,io} and answers what it read (`HostPsi`); the server's decider (`server/src/pressure.ts`) holds
// the last reading and classifies a stalled link by it; `GET /api/fleet/health` carries the result as `psi`, and the
// PWA's host-pressure banner reads it through `readHostPressure` alone.
//
// WHY. Under a host thrash (memory PSI full above 50%) the agent's own pages are refaulted in D-state, its accept queue
// backs up and every registry read times out: the controller saw "registry directory could not be listed" flaps and
// nothing said why. A stalled link whose last reading showed the host stalling is the HOST, not the link.
//
// Imports nothing: the agent, the server and the PWA all read it.

/** One PSI line's two short windows, in percent of wall time stalled (0..100). `avg300` and `total` are not read. */
export interface PsiAvg { avg10: number; avg60: number }
/** One resource's two lines: `some` (at least one task stalled) and `full` (every non-idle task stalled). */
export interface PsiResource { some: PsiAvg; full: PsiAvg }
/** What the agent read: memory and I/O. CPU is not read (its `full` line means nothing at the host level). */
export interface HostPsi { memory: PsiResource; io: PsiResource }

/** `full` at or above this share (either resource, either window) is a host under pressure: the banner's warn, and the
 *  threshold a stalled link's last reading must reach to be read as host pressure rather than a link fault. */
export const PSI_WARN_FULL_PCT = 10;
/** `full` at or above this share is a thrash (#1170's incident ran at 50% and over): the banner's critical. */
export const PSI_CRITICAL_FULL_PCT = 50;

export type PressureLevel = 'ok' | 'warn' | 'critical' | 'unmeasured';
/**
 * What the link is doing, by the evidence beside it:
 * - `answering`: the last reading landed in time.
 * - `host-pressure`: the link is down or stalled, and the last reading before it showed the host stalling. The agent
 *   was alive and the host is thrashing: not a registry flap and not a network fault.
 * - `link-down`: the link is down or stalled with no such reading: what it always meant.
 */
export type PressureLink = 'answering' | 'host-pressure' | 'link-down';

/** `FleetHealth.psi`: the last reading the server holds (`memory`/`io`, `null` before the first), when it was taken,
 *  its level, and the link's classification. */
export interface HostPressureHealth {
  /** Epoch ms of the reading `memory`/`io` carry, or `null` when none has landed. */
  at: number | null;
  level: PressureLevel;
  link: PressureLink;
  memory: PsiResource | null;
  io: PsiResource | null;
}

const PRESSURE_LEVEL_MAP: Record<PressureLevel, true> = { ok: true, warn: true, critical: true, unmeasured: true };
const PRESSURE_LINK_MAP: Record<PressureLink, true> = { answering: true, 'host-pressure': true, 'link-down': true };
/** Every `PressureLevel` and every `PressureLink`, derived from the types (a member added to a union is a compile error
 *  until it is here). */
export const PRESSURE_LEVELS = Object.keys(PRESSURE_LEVEL_MAP) as PressureLevel[];
export const PRESSURE_LINKS = Object.keys(PRESSURE_LINK_MAP) as PressureLink[];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pct = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null);

/** One `/proc/pressure/<resource>` file's text (`some avg10=… avg60=… avg300=… total=…` and a `full` line), or `null`
 *  when either line is missing or malformed. An older kernel's memory file with no `full` line is `null`: unknown. */
export function parsePressureText(text: string): PsiResource | null {
  const line = (kind: 'some' | 'full'): PsiAvg | null => {
    const m = new RegExp(`^${kind} avg10=(\\d+(?:\\.\\d+)?) avg60=(\\d+(?:\\.\\d+)?) `, 'm').exec(text);
    if (m === null) return null;
    const avg10 = pct(Number(m[1]));
    const avg60 = pct(Number(m[2]));
    return avg10 === null || avg60 === null ? null : { avg10, avg60 };
  };
  const some = line('some');
  const full = line('full');
  return some === null || full === null ? null : { some, full };
}

function readAvg(v: unknown): PsiAvg | null {
  if (!isObj(v)) return null;
  const avg10 = pct(v['avg10']);
  const avg60 = pct(v['avg60']);
  return avg10 === null || avg60 === null ? null : { avg10, avg60 };
}

function readResource(v: unknown): PsiResource | null {
  if (!isObj(v)) return null;
  const some = readAvg(v['some']);
  const full = readAvg(v['full']);
  return some === null || full === null ? null : { some, full };
}

/** THE ONE READER of the agent's `pressure` reply (a wire boundary: validated, never trusted): both resources, or
 *  `null` when either is malformed. */
export function readHostPsi(x: unknown): HostPsi | null {
  if (!isObj(x)) return null;
  const memory = readResource(x['memory']);
  const io = readResource(x['io']);
  return memory === null || io === null ? null : { memory, io };
}

/** The worst `full` share across both resources and both windows: the one figure the level and the link read. */
export function worstFull(psi: HostPsi): number {
  return Math.max(psi.memory.full.avg10, psi.memory.full.avg60, psi.io.full.avg10, psi.io.full.avg60);
}

/** THE ONE READER of `FleetHealth.psi`: the block, or `null`. Absent (an older server) and malformed alike read as
 *  `null`, which is UNKNOWN, never "the host is fine". */
export function readHostPressure(x: unknown): HostPressureHealth | null {
  if (!isObj(x)) return null;
  const v = x['psi'];
  if (!isObj(v)) return null;
  const at = v['at'] === null ? null : typeof v['at'] === 'number' && Number.isFinite(v['at']) ? v['at'] : undefined;
  const level = v['level'];
  const link = v['link'];
  if (at === undefined || typeof level !== 'string' || !(PRESSURE_LEVELS as string[]).includes(level)) return null;
  if (typeof link !== 'string' || !(PRESSURE_LINKS as string[]).includes(link)) return null;
  const memory = v['memory'] === null ? null : readResource(v['memory']);
  const io = v['io'] === null ? null : readResource(v['io']);
  if ((v['memory'] !== null && memory === null) || (v['io'] !== null && io === null)) return null;
  return { at, level: level as PressureLevel, link: link as PressureLink, memory, io };
}
