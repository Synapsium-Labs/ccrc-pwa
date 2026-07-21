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
