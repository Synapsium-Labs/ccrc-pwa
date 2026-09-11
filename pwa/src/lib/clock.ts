/** Local HH:MM for an epoch-SECONDS instant (the unit Claude Code writes
 *  `quotaLimits.resetsAt` in — D-2365), with the date when it is not today.
 *  `now` is a parameter so the same instant tests identically in every TZ. */
export function resetClock(epochSeconds: number, now: Date = new Date()): string | null {
  if (!Number.isFinite(epochSeconds)) return null;
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? hm : `${hm} · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}
