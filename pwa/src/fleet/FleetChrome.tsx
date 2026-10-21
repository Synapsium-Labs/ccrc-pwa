// The fleet's shared chrome state, lifted above the fleet screen (D-5468).
//
// Before W2 `FleetScreen` owned three polls (`/api/fleet/health` every 15 s, `/api/updates` every 60 s, and the
// `/api/projects` plane) and the open state of its five sheets. In the two skins the fleet list is a skin's part, so
// it remounts on a skin switch, and more than one part reads the same health and updates (Instrument's status bar,
// Refined's app bar, either list). Left on the screen, a switch would close an open sheet (spec §5.4) and a second
// reader would start a second poll. So the provider below calls each plane ONCE for the whole shell, and every
// reader asks `useFleetChrome()` instead of polling on its own.
//
// Outside a provider `useFleetChrome()` THROWS rather than answering a default: a part that forgets the host would
// otherwise start rendering with no health, no updates and sheets that never open, and say nothing.
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetHealth } from '../../../shared/api';
import { useFleetHealth } from './useFleetHealth';
import { useUpdatesView, type UpdatesPoll } from './useUpdatesView';
import { useProjectRows, type ProjectRowsPlane } from './useProjectRows';
import { useActionsSheet, type ActionsSheet } from './useActionsSheet';
import { useArchiveAll, type ArchiveAllPlane } from './ArchiveAllPlane';
import type { FleetStore } from '../stores/fleet';

export interface FleetChrome {
  /** The store the planes and the sheets act on (the app's, or a test's). */
  store: FleetStore;
  /** ONE `/api/fleet/health` poll, read by the banners and `BuildLine` (spec §6). */
  health: FleetHealth | null;
  /** ONE `/api/updates` poll (centralised-update §13), handed to every reader of the inventory. */
  updates: UpdatesPoll;
  /** The `/api/projects` plane: rows, class, placement readers, the `+`'s in-flight set, the pool sheet's selection. */
  projects: ProjectRowsPlane;
  /** The ··· sheet's lifecycle: which session it is about, and what it does when that session changes or vanishes. */
  actions: ActionsSheet;
  /** "Archive all"'s loop and its in-flight set, which every card reads. */
  archiveAll: ArchiveAllPlane;
  /** Which project's "Archive all" confirm is asking, or none. */
  archiveAllFor: string | null;
  setArchiveAllFor: (project: string | null) => void;
  newOpen: boolean;
  setNewOpen: (open: boolean) => void;
  /** Which project's `+` sheet is open (named workspaces S7), or none. */
  addWorkspaceFor: string | null;
  setAddWorkspaceFor: (project: string | null) => void;
  /** The guarded reap flow's subject, by id only: the session is looked up fresh from the live list. */
  reapId: string | null;
  setReapId: (id: string | null) => void;
}

const FleetChromeContext = createContext<FleetChrome | null>(null);

export function FleetChromeProvider({ store, children }: { store: FleetStore; children?: ReactNode }): ReactNode {
  const useStore = store;
  const sessions = useStore((s) => s.sessions);
  const pools = useStore((s) => s.pools);
  const health = useFleetHealth();
  const updates = useUpdatesView();
  const projects = useProjectRows(pools, store.getState().setProjects);
  const actions = useActionsSheet(sessions);
  const archiveAll = useArchiveAll(store);
  const [archiveAllFor, setArchiveAllFor] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [addWorkspaceFor, setAddWorkspaceFor] = useState<string | null>(null);
  const [reapId, setReapId] = useState<string | null>(null);
  const value: FleetChrome = {
    store, health, updates, projects, actions, archiveAll,
    archiveAllFor, setArchiveAllFor, newOpen, setNewOpen, addWorkspaceFor, setAddWorkspaceFor, reapId, setReapId,
  };
  return <FleetChromeContext.Provider value={value}>{children}</FleetChromeContext.Provider>;
}

export function useFleetChrome(): FleetChrome {
  const chrome = useContext(FleetChromeContext);
  if (chrome === null) throw new Error('FleetChrome is not mounted');
  return chrome;
}
