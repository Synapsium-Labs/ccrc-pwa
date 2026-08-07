/** Compact "time until reset" from an epoch-seconds timestamp: "2h 10m", "3d 4h",
 *  "45m", "now", or "—" when unknown. */
export function formatReset(resetAt: number | null, nowSec: number): string {
  if (resetAt === null) return '—';
  const s = resetAt - nowSec;
  if (s <= 0) return 'now';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** AccountsScreen's freshness line, from an age in seconds (nowSec - ts):
 *  "2h ago", "3d ago", "just now" under two minutes, or "—" when `ts` itself
 *  is null — no telemetry has ever landed for this account, which is a
 *  different fact from "landed a moment ago" and must not collapse into it. */
export function formatAge(ageSec: number | null): string {
  if (ageSec === null) return '—';
  const s = Math.max(0, ageSec);
  const m = Math.floor(s / 60);
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
