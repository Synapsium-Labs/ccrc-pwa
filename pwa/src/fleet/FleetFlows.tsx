// The fleet-level flows' host (D-5468): the five sheets `FleetScreen` used to render inside its own `<main>`, now
// rendered once beside the shell from `useFleetChrome()`'s state, with the same props they had there. A sheet opened
// from a fleet list therefore outlives that list: a skin switch remounts the list (spec §5.4) and the sheet stays.
// Every sheet is a portalled layer, so where this mounts in the tree moves no pixel.
//
// `useFleetFlows()` is how a part opens one. It never holds state of its own; the state is the chrome's.
import type { ReactNode } from 'react';
import { NewSessionSheet } from './NewSessionSheet';
import { PoolSheet } from './PoolSheet';
import { SessionActionsSheet } from './SessionActionsSheet';
import { ArchiveAllConfirm } from './ArchiveAllPlane';
import { ReapSheet } from '../session/ReapSheet';
import { useFleetChrome } from './FleetChrome';

export interface FleetFlowDoors {
  openNewSession: () => void;
  /** The ··· sheet for a session in the live list; an id the list does not hold opens nothing. */
  openActions: (id: string) => void;
  /** The pool sheet for a project. The project alone (D-5677): the pool is read from that project's `/api/projects` row, as today. */
  openPool: (project: string) => void;
  openArchiveAll: (project: string) => void;
  openReap: (id: string) => void;
}

export function useFleetFlows(): FleetFlowDoors {
  const chrome = useFleetChrome();
  const sessions = chrome.store((s) => s.sessions);
  return {
    openNewSession: () => chrome.setNewOpen(true),
    openActions: (id) => {
      const session = sessions.find((s) => s.id === id);
      if (session !== undefined) chrome.actions.openFor(session);
    },
    openPool: chrome.projects.openPool,
    openArchiveAll: (project) => chrome.setArchiveAllFor(project),
    openReap: (id) => chrome.setReapId(id),
  };
}

export function FleetFlows(): ReactNode {
  const { store, projects, actions, archiveAll, archiveAllFor, setArchiveAllFor, newOpen, setNewOpen, reapId, setReapId } =
    useFleetChrome();
  const sessions = store((s) => s.sessions);
  return (
    <>
      <NewSessionSheet open={newOpen} onClose={() => setNewOpen(false)} fleet={store} />

      <PoolSheet
        project={projects.poolSelection?.project ?? null}
        selectedPool={projects.poolSelection?.pool}
        open={projects.poolOpen}
        onClose={projects.closePool}
        onPoolChanged={projects.notePoolWrite}
        fleet={store}
      />

      <SessionActionsSheet
        session={actions.session}
        open={actions.open}
        onClose={actions.close}
        onReap={setReapId}
        fleet={store}
      />

      <ArchiveAllConfirm
        project={archiveAllFor}
        sessions={sessions}
        onClose={() => setArchiveAllFor(null)}
        onConfirm={(project) => void archiveAll.run(project)}
      />

      <ReapSheet
        session={sessions.find((sn) => sn.id === reapId) ?? null}
        open={reapId !== null}
        onClose={() => setReapId(null)}
        onReaped={() => setReapId(null)}
      />
    </>
  );
}
