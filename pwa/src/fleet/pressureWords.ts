// #1170. L1: the host-pressure banner's words and its predicate. It reads the server's `psi` block through
// `readHostPressure` alone and works out nothing the server did not decide: the level and the link's classification are
// the server's (`server/src/pressure.ts`), and the line names the stalled share the block carries. Absent, malformed,
// `ok` with an answering link, and `unmeasured` with no stall all read as "no banner": a banner that fires on nothing
// stops being read.
import type { FleetHealth } from '../../../shared/api';
import { readHostPressure, type HostPressureHealth, type PsiResource } from '../../../shared/pressure';

/** Does the banner show? The server's level is `warn` or `critical`, or it read a stalled link as host pressure. The
 *  banner stack asks it (BannerStack.tsx). */
export function pressureBannerShows(health: FleetHealth | null | undefined): boolean {
  const p = readHostPressure(health ?? null);
  return p !== null && (p.level === 'warn' || p.level === 'critical' || p.link === 'host-pressure');
}

/** Critical when the server says critical or host pressure; otherwise warn. */
export function pressureTone(p: HostPressureHealth): 'critical' | 'warn' {
  return p.level === 'critical' || p.link === 'host-pressure' ? 'critical' : 'warn';
}

/** The larger `full` share of one resource's two windows, whole percent, floored so a figure never reads higher than
 *  what was measured. */
const fullPct = (r: PsiResource | null): number | null => (r === null ? null : Math.floor(Math.max(r.full.avg10, r.full.avg60)));

/** The one line. Host pressure names what the stall is (the agent alive, the host stalling it) so it is not read as a
 *  network fault; the level lines name the stalled shares. */
export function pressureLine(p: HostPressureHealth): string {
  const mem = fullPct(p.memory);
  const io = fullPct(p.io);
  const shares = [mem === null ? null : `memory stalled ${mem}%`, io === null ? null : `io ${io}%`].filter((s) => s !== null).join(' · ');
  const tail = shares === '' ? '' : ` · ${shares}`;
  if (p.link === 'host-pressure') return `Fleet host thrashing: the agent is stalled by host pressure, not offline${tail}`;
  return p.level === 'critical' ? `Fleet host thrashing${tail}` : `Fleet host under memory or io pressure${tail}`;
}
