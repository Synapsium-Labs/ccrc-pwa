// Settings › Integrations' one read of the project list (D-8932). The Project linking card drew it
// from a read of its own; the GitHub card beside it reads the same rows (each project's visibility reading is one GitHub
// call the fleet box made), so the read moved up to the section, which hands it to both. One request, one answer.
//
// What moved is the card's own state, unchanged: the first read, the row a write stored (`stored`), and the list read
// again after a write whose outcome is unknown (`refresh`, newest wins, a failed one leaves a list that cannot be trusted).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectRow } from '../../../../shared/api';
import type { ProjectLinkingWire } from '../../../../shared/linking';
import { loadProjects } from '../../fleet/useProjectRows';

/** One read of the project list, and the rows the cards draw from it. */
export type ProjectListRead = { kind: 'loading' } | { kind: 'failed' } | { kind: 'read'; rows: ProjectRow[] };

export interface ProjectList {
  read: ProjectListRead;
  /** Put the linking cell a write answered on its project's rows. */
  stored: (project: string, linking: ProjectLinkingWire) => void;
  /** Read the list again; the newest read wins. */
  refresh: () => Promise<void>;
}

export function useProjectList(): ProjectList {
  const [read, setRead] = useState<ProjectListRead>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    loadProjects().then(
      (r) => { if (live) setRead({ kind: 'read', rows: r.projects }); },
      () => { if (live) setRead({ kind: 'failed' }); },
    );
    return () => { live = false; };
  }, []);
  const stored = useCallback((project: string, linking: ProjectLinkingWire): void => {
    setRead((r) => r.kind !== 'read' ? r : { kind: 'read', rows: r.rows.map((p) => p.name === project ? { ...p, linking } : p) });
  }, []);
  // The project list read again after a write whose outcome is unknown: its linking cell may be stale. The newest read wins; a
  // failed one leaves a list that cannot be trusted, so the card says so (D-8186 A1).
  const listSeq = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const mine = ++listSeq.current;
    try {
      const r = await loadProjects();
      if (mine === listSeq.current) setRead({ kind: 'read', rows: r.projects });
    } catch {
      if (mine === listSeq.current) setRead({ kind: 'failed' });
    }
  }, []);
  return { read, stored, refresh };
}
