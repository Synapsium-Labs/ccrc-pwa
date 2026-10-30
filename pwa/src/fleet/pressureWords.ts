// #1170. L1: the host-pressure banner's words and its predicate. It reads the server's `psi` block through
// `readHostPressure` alone and works out nothing the server did not decide: the level and the link's classification are
// the server's (`server/src/pressure.ts`), and the line names the stalled share the block carries. Absent, malformed,
// `ok` with an answering link, and `unmeasured` with no stall all read as "no banner": a banner that fires on nothing
// stops being read.
import type { FleetHealth } from '../../../shared/api';
import { PSI_WARN_FULL_PCT, readHostPressure, type HostPressureHealth, type PsiResource } from '../../../shared/pressure';

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

/** The one line. It names only what is stalling: a resource whose `full` share reached the server's warn line
 *  (`PSI_WARN_FULL_PCT`, the same line `pressureLevelOf` reads), so "memory stalled 0%" never sits under a memory
 *  headline. When neither resource reached the line (host pressure read from older evidence), both measured figures
 *  stay, so the banner still says what it saw. Host pressure names what the stall is (the agent alive, the host
 *  stalling it) so it is not read as a network fault. */
export function pressureLine(p: HostPressureHealth): string {
  const figures = [
    { name: 'memory', pct: fullPct(p.memory) },
    { name: 'io', pct: fullPct(p.io) },
  ].filter((f): f is { name: string; pct: number } => f.pct !== null);
  const stalled = figures.filter((f) => f.pct >= PSI_WARN_FULL_PCT);
  const shown = stalled.length > 0 ? stalled : figures;
  const shares = shown.map((f) => `${f.name} stalled ${f.pct}%`).join(' · ');
  const tail = shares === '' ? '' : ` · ${shares}`;
  if (p.link === 'host-pressure') return `Fleet host thrashing: the agent is stalled by host pressure, not offline${tail}`;
  if (p.level === 'critical') return `Fleet host thrashing${tail}`;
  return stalled.length > 0 ? `Fleet host under ${stalled.map((f) => f.name).join(' and ')} pressure${tail}` : `Fleet host under pressure${tail}`;
}
