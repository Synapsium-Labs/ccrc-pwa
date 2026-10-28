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

/** The viewer's local day for an epoch-MILLISECONDS instant, as `YYYY-MM-DD`: one key all day, a new one at local
 *  midnight. The transcript's row barrier compares it for the rows whose words read the clock (`resetClock` says the
 *  date only when it is not today), so those rows draw again when the day changes and no other row does (desktop
 *  polish Task C7, review 1128). */
export function dayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
