// The inspector's one reader of the open session (W2 Task S8, D-5474).
//
// The inspector sits in the frame's `<aside aria-label="Inspector">`, OUTSIDE `SessionScreen`, so it cannot be handed
// the screen's store or row. It reads the session id from the ROUTE (`matchRoute`, the table every route reader uses)
// and asks `getSessionStore(id)`, which hands back the one store per id that `SessionScreen` drives: the sections and
// the screen read the same state, and nothing here opens a socket (the screen connects; a store is passive until it
// does). Off a session route the answer is `null`, and every section renders nothing.
import { useMemo } from 'react';
import type { FleetSession } from '../../../shared/api';
import { usePath } from '../lib/router';
import { matchRoute } from '../lib/routes';
import { useFleetStore } from '../stores/fleet';
import { getSessionStore, type SessionStore } from '../stores/session';

/** The width at which a skin places the inspector as a column of its own (spec §5.3, Inspector rows). */
export const INSPECTOR_QUERY = '(min-width: 1600px)';

export interface InspectorSession {
  readonly id: string;
  /** The route's session store: the same instance `SessionScreen` drives for this id. */
  readonly store: SessionStore;
  /** The fleet row, or `null` before the first fleet frame names this id (a deep link). */
  readonly row: FleetSession | null;
}

/** The session id the current path names, or `null` off a session route. */
export function inspectorSessionId(path: string): string | null {
  const m = matchRoute(path);
  return m !== null && m.route.id === 'session' ? m.param : null;
}

export function useInspectorSession(): InspectorSession | null {
  const id = inspectorSessionId(usePath());
  const row = useFleetStore((s) => (id === null ? null : s.sessions.find((x) => x.id === id) ?? null));
  return useMemo(() => (id === null ? null : { id, store: getSessionStore(id), row }), [id, row]);
}
