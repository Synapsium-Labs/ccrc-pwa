// A SLEEPING SESSION, in the PWA's words (D-5242, `hibernate-long-idle-sessions`, plan Task 18; this module and the
// surfaces beyond the plan's file list are `wake-on-open-surfaces`, D-5430). `ccd hibernate` stops
// a long-idle session cleanly and stamps `$REG/<id>.hibernated`; the server reads it as `FleetSession.hibernatedAt`
// and leaves the bucket `dead` (no new bucket member). This module is the PWA's one reader of that field: every
// surface that would call such a row dead (the line, the header, the screen, the actions and swap sheets, the
// coordinator presence) asks here first, so a sleeping session reads as asleep and offers Wake, never as a death.
import type { FleetSession } from '../../../shared/api';
import { elapsedShort } from '@ccrc/ui';

/** When this row went to sleep (epoch MS), or `null` when it is not asleep.
 *
 *  BOTH halves. `hibernatedAt` alone is not enough: the frame that wakes a session can carry a stale marker for a
 *  tick (`cmd_ensure` removes `.hibernated`, and the listing that carries it is read beside the liveness probe), and a
 *  live row is awake whatever that says. `status` alone is not enough either: a dead row with no marker crashed, or
 *  was stopped, and opening it must never restart it silently.
 *
 *  `?? null`, never the typed field directly: the live `fleet` frame is CAST on arrival (`stores/fleet.ts`'s
 *  `asFleetMsg`), so a row from a server older than the field lacks the key at runtime. */
export function hibernatedSince(s: Pick<FleetSession, 'status'> & Partial<Pick<FleetSession, 'hibernatedAt'>>): number | null {
  const at = s.hibernatedAt ?? null;
  if (s.status !== 'dead' || typeof at !== 'number' || !Number.isFinite(at)) return null;
  return at;
}

/** The row's state word for a sleeping session: `hibernated · 6h`. The ladder is `elapsedShort`'s. */
export function hibernatedWords(at: number, now: number): string {
  return `hibernated · ${elapsedShort(now - at) ?? '<1m'}`;
}
