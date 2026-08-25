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

/** A stopwatch reading for a span that is still running — `0:42`, `4:07`,
 *  `1:02:03` — from a span in MILLISECONDS.
 *
 *  A third time format here, deliberately, rather than a fourth idiom
 *  somewhere else: `formatReset` counts DOWN to a future moment and
 *  `formatAge` rounds a settled past to a coarse ago-phrase, which collapses
 *  everything under two minutes into "just now". The dispatch window is
 *  exactly the span that lives inside that collapse — an operator watching a
 *  spawn wants "42 seconds and climbing", and "just now" for four straight
 *  minutes is the same silence the window exists to end.
 *
 *  Milliseconds in, because the fields it measures (`dispatchStartedAt`,
 *  `dispatchedAt`) are millisecond epochs and the threshold it is rendered
 *  beside (`SPAWN_STALL_MS`) is a millisecond constant: converting to seconds
 *  first would make a boundary stated in milliseconds unmeasurable by up to
 *  999 of them.
 *
 *  The partial second is FLOORED, never rounded — the clock states time that
 *  has actually passed. A negative span is clamped to zero rather than
 *  rendered: `dispatchStartedAt` is stamped by the server's clock and
 *  subtracted from the phone's, so a few seconds of ordinary skew must read as
 *  "it just began", not as `-0:03`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
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
