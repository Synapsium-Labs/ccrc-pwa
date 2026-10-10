// The project list this sheet offers, and the one thing that can go wrong
// reading it.
//
// EXTRACTED FROM `StartProgramSheet`, which was one 770-line function. This is
// the smallest plane in it that stands alone: a read on open, a filter on the
// query, and THREE answers — not two. `null` is "the read has not landed", an
// error string is "the read failed", and an array is the list. Collapsing the
// first two into an empty array is what made `ProjectPicker` show a skeleton
// for ever on a box that refused the read, which is the defect its own header
// argues about.
//
// WHY A HOOK AND NOT A COMPONENT. The list is state the sheet's RENDER CHAIN
// consults from six different arms (a refusal needs to know whether the list
// is empty because nothing matched or because nothing arrived), so moving the
// markup would leave the state behind and move nothing. The state is the part
// that can be lifted.
import { useEffect, useMemo, useState } from 'react';
import type { ProjectRow } from '../../../shared/api';
import { apiErrorText } from '../lib/api';

export interface ProjectList {
  /** `null` until the read lands. An empty array is a measured emptiness. */
  readonly list: readonly ProjectRow[] | null;
  /** The read's own failure sentence, or `null`. Never folded into `list`. */
  readonly listError: string | null;
  /** `list` narrowed by the query, case-insensitively on the name. */
  readonly matching: readonly ProjectRow[];
}

export function useProjectList(
  open: boolean,
  query: string,
  loadProjects: () => Promise<{ projects: ProjectRow[] }>,
): ProjectList {
  const [list, setList] = useState<ProjectRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    // RESET BOTH on every open. The sheet is mounted UNCONDITIONALLY at screen
    // level, so a second open must not show the first open's error above a
    // list that is being read again.
    setList(null);
    setListError(null);
    loadProjects().then(
      (r) => { if (!cancelled) setList(r.projects); },
      (err: unknown) => { if (!cancelled) setListError(apiErrorText(err)); },
    );
    return () => { cancelled = true; };
  }, [open, loadProjects]);

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (list === null) return [];
    if (needle === '') return list;
    return list.filter((p) => p.name.toLowerCase().includes(needle));
  }, [list, query]);

  return { list, listError, matching };
}
