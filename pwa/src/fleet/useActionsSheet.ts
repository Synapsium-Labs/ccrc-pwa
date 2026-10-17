// The fleet line's ··· sheet, held open correctly — the one plane on this
// screen whose whole reason is a lifecycle, not a value.
//
// WHY IT IS ITS OWN FILE. Three pieces of state, an effect and an opener, all
// answering one question the screen does not otherwise ask: what does a sheet
// do while the thing it is about changes underneath it? Both of its findings
// are about that and about nothing else, so the argument reads better next to
// its own state than buried a third of the way down a screen.
import { useEffect, useState } from 'react';
import type { FleetSession } from '../../../shared/api';

export interface ActionsSheet {
  session: FleetSession | null;
  open: boolean;
  openFor: (session: FleetSession) => void;
  close: () => void;
}

/** One sheet for the whole screen, fed by whichever line was tapped. Only the
 *  id is the source of truth (Finding 5 of the whole-branch review): the
 *  session is refreshed from the live `sessions` list rather than frozen at tap
 *  time, so a fleet update while the sheet is open keeps its limit note and
 *  Remove-workspace visibility current. `open` is a SEPARATE boolean — matching
 *  how NewSessionSheet and SwapSheet are toggled — so closing never clears the
 *  session: `SessionActionsSheet` stays mounted and vaul gets to play its exit
 *  animation instead of popping out of existence (Finding 2). */
export function useActionsSheet(sessions: readonly FleetSession[]): ActionsSheet {
  const [id, setId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<FleetSession | null>(null);

  useEffect(() => {
    if (id === null) return;
    const live = sessions.find((s) => s.id === id) ?? null;
    if (live !== null) {
      setSession(live);
    } else if (open) {
      // The session vanished from the fleet entirely (workspace removed,
      // process gone) while the sheet was open — there is nothing left to
      // act on. Close it exactly as a manual dismiss would: the session
      // keeps its last known value so the sheet still has something to
      // animate out over, rather than popping (same class of bug as
      // Finding 2, from a different trigger).
      setOpen(false);
    }
  }, [sessions, id, open]);

  return {
    session,
    open,
    openFor: (tapped) => {
      setId(tapped.id);
      setSession(tapped);
      setOpen(true);
    },
    close: () => setOpen(false),
  };
}
