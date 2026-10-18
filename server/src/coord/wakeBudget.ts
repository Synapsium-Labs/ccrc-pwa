/**
 * THE WAKE BUDGET (D-5242, `hibernate-long-idle-sessions`, plan Task 17b): L1, pure.
 *
 * Every wake of a hibernated session is a cold `--resume` (`ccd ensure`), on a box measured at its memory cap, and
 * `ccd`'s spawn path has no concurrency control of its own. So AUTOMATIC wakes — the mail lane's — are bounded
 * fleet-wide: at most `WAKE_BURST` in any `WAKE_WINDOW_MS`, the rest left outstanding (never parked) for a later sweep.
 * A wake somebody ASKED for — the operator's `POST /api/sessions/:id/ensure`, a dispatch resuming its worker — is never
 * refused (the operator asked; a dispatch's resume is the coordinator's), but it is recorded and counts in the window, so
 * an automatic wake never lands on top of one.
 *
 * The window's state is ONE in-memory list the server owns (`FleetWatcher.admitWake`, handed to the routes through the
 * watcher the way the coordination handle is). A restart empties it, which can let one extra burst through, and no more.
 * The figure is lowered by a PR, never by hand (plan Task 19's stop rule).
 */

/** At most this many wakes, automatic and asked together, in any `WAKE_WINDOW_MS`, before an automatic one waits. */
export const WAKE_BURST = 2;
/** The window, in MS. A wake exactly this old no longer counts. */
export const WAKE_WINDOW_MS = 60_000;

/** `auto`: the mail lane's; refused while the window is full. `asked`: an operator's or a dispatch's; always admitted. */
export type WakeKind = 'auto' | 'asked';

/** Admit a wake at `now`? Returns the window's new list: the wakes still inside it, plus this one when it is admitted.
 *  The list handed in is never mutated. */
export function wakeAdmit(recent: readonly number[], now: number, kind: WakeKind): { admit: boolean; recent: number[] } {
  const live = recent.filter((t) => now - t < WAKE_WINDOW_MS);
  if (kind === 'auto' && live.length >= WAKE_BURST) return { admit: false, recent: live };
  return { admit: true, recent: [...live, now] };
}
