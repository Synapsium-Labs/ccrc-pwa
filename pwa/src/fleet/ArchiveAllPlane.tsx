// "Archive all" in a card's Released fold (workspace lifecycle spec §5.1) —
// the loop, its in-flight guard and the sentence the operator confirms.
//
// WHY IT IS ITS OWN FILE. It is a whole flow: two pieces of state, a ref
// guard, a filtered count, an awaited loop over the fleet, two toasts and a
// sheet. `FleetScreen` keeps none of that — it holds the open project (one
// `useState` the card's callback sets) and renders the confirm, because the
// cards also read the in-flight set and a set owned below them could not
// reach the rows.
//
// TWO EXPORTS, ONE CONCERN, and the split between them is the render seam:
// `useArchiveAll` is the loop and `ArchiveAllConfirm` is the question. The
// consequence sentence travels with the count it describes, so the two can
// never state different numbers.
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { QuickConfirm, toast } from '@ccrc/ui';
import { boardHome, type FleetSession } from '../../../shared/api';
import { api, apiErrorText } from '../lib/api';
import { archivableReleased, archiveReleased, archiveReleasedSummary } from './archiveReleased';
import { inReleasedFold } from './groupFleet';
import type { FleetStore } from '../stores/fleet';

export interface ArchiveAllPlane {
  /** The projects whose loop is running — read by every card, which is why
   *  this is held on the screen and not inside the sheet. */
  archiving: ReadonlySet<string>;
  run: (project: string) => Promise<void>;
}

/** The loop. A second call for a project already running is REFUSED, not
 *  queued, and the guard is a REF rather than the state beside it: a second
 *  call from the same render would read the stale state (the state only drives
 *  the button's disabled look). The window it covers is a phone's — the confirm
 *  sheet stays tappable while it animates closed. `fleet-screen.test.tsx`'s
 *  double tap cannot reach it (under jsdom the real sheet unmounts before a
 *  second click lands), so `archive-all-guard.test.tsx` stubs the sheet with a
 *  confirm that fires twice in one tick. */
export function useArchiveAll(store: FleetStore): ArchiveAllPlane {
  const [archiving, setArchiving] = useState<ReadonlySet<string>>(new Set());
  const archivingRef = useRef<Set<string>>(new Set());
  const run = async (project: string): Promise<void> => {
    if (archivingRef.current.has(project)) return;
    archivingRef.current.add(project);
    // EVERY folded row of this card, children included: the loop skips a child itself, so its summary counts the
    // whole fold — "skipped" then agrees with the card's own "skips N child workspaces".
    const ids = store.getState().sessions
      .filter((s) => boardHome(s) === project && inReleasedFold(s)).map((s) => s.id);
    setArchiving((prev) => new Set(prev).add(project));
    try {
      const result = await archiveReleased(ids, {
        // The NEWEST frame, never a render-scoped list: a row can leave the fold mid-loop.
        current: (id) => store.getState().sessions.find((s) => s.id === id),
        archive: (id) => api.archive(id),
        errorText: apiErrorText,
      });
      // A refusal's reason is the only record of it — the refused row stays in the fold with no reason on it — so
      // that toast carries an action, which keeps it on screen until it is read (Toast.tsx).
      if (result.refused.length > 0) {
        toast(archiveReleasedSummary(result), 'error', { label: 'Dismiss', onClick: () => {} });
      } else {
        toast(archiveReleasedSummary(result), 'info');
      }
    } finally {
      archivingRef.current.delete(project);
      setArchiving((prev) => {
        const next = new Set(prev);
        next.delete(project);
        return next;
      });
    }
  };
  return { archiving, run };
}

export interface ArchiveAllConfirmProps {
  /** The project whose confirm is open, or `null` for none. */
  project: string | null;
  sessions: readonly FleetSession[];
  onClose: () => void;
  onConfirm: (project: string) => void;
}

/** The question, with the count it is about measured right here. `boardHome`,
 *  the card the row RENDERS on — never `s.project`, which a placed row does not
 *  share with its card. */
export function ArchiveAllConfirm({
  project, sessions, onClose, onConfirm,
}: ArchiveAllConfirmProps): ReactNode {
  const rows = project === null ? []
    : sessions.filter((s) => boardHome(s) === project && archivableReleased(s));
  const count = rows.length;
  const live = rows.filter((s) => s.status !== 'dead').length;
  return (
    <QuickConfirm
      open={project !== null}
      onClose={onClose}
      title="Archive released workspaces?"
      consequence={`Archives ${count} released ${count === 1 ? 'workspace' : 'workspaces'} in ${project ?? ''}, one at a time. ${live} of them ${live === 1 ? 'still has a live pane' : 'still have a live pane'}, which is stopped. Restore brings any of them back; once automatic cleanup is on, each is cleaned up seven days after its archive. Child workspaces are skipped, and so is any row that stops being released before its turn.`}
      confirmLabel={`Archive ${count}`}
      onConfirm={() => {
        if (project !== null) onConfirm(project);
      }}
    />
  );
}
