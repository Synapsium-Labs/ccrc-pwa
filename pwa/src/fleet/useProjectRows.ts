// The fleet screen's `/api/projects` plane, lifted out of the screen whole.
//
// WHY IT IS ITS OWN FILE. `FleetScreen` was a 727-line component body, and
// about a third of it answered ONE question — what has the projects route
// measured? — through eight pieces of state, four refs, two effects, three
// memoised readers and a write. Every one of them is read by the others and
// by nothing else on the screen: the class the chooser holds is the class
// `refreshProjects` sends and the class the `+` posts; the pool the sheet
// shows is the pool the route measured, kept through a write that has not
// come back yet. The screen's remaining concerns (the sheets, the buckets,
// the archive-all loop) touch none of it.
//
// EVERY COMMENT CAME WITH ITS CODE — the generation discipline, the
// visibility token, D-2721's remeasurement and D-2722's silence are this
// plane's reasons, and they belong where the plane is.
//
// A HOOK, NOT A COMPONENT, because what moved is state and effects with no
// markup of its own: the screen still renders every card, chip and sheet.
// Nothing here reaches the DOM, so this file is `.ts` and the contrast gate
// has nothing to re-key.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@ccrc/ui';
import type {
  ProjectPoolsWire, ProjectPoolWire, ProjectRepoWire, ProjectRow,
} from '../../../shared/api';
import type { ModelClass } from '../../../shared/models';
import { api, apiErrorText } from '../lib/api';
import { poolOfPlacement, type ProjectPlacementRead } from './placementWords';

/** The pools frame reduced to one comparable string. Key ORDER is not
 *  significance: the wire is rebuilt per frame, so an object that re-serialises
 *  with its keys in another order is the same measurement and must not look
 *  like a new one. */
const poolsFingerprint = (pools: ProjectPoolsWire): string => JSON.stringify(
  pools,
  (_key, value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  },
);

export type PoolSelection = {
  project: string;
  pool?: NonNullable<ProjectRow['pool']>;
};

type PoolWrite = {
  project: string;
  pool: NonNullable<ProjectRow['pool']>;
};

/** The route's own four answers. `legacy` is the pre-route server, `pending`
 *  and `failed` are this device's two ways of not knowing, and only `ready`
 *  carries rows — a distinction every reader below preserves rather than
 *  folding to "no rows". */
export type ProjectRowsRead =
  | { kind: 'legacy' }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'ready'; rows: readonly ProjectRow[] };

/** The pool the sheet is opened on, and the one it keeps while it stays open —
 *  ONE reading used by both the card tap and the open-sheet remeasurement, so
 *  the two can never drift (D-2721). A live write for THIS project precedes the
 *  route read (D-2704/D-2707; D-2714 pins when the bridge clears).
 *
 *  The non-measured arm yields no pool. At the tap site it cannot fire at all:
 *  the only way to open this sheet is `PoolChip`, and `ProjectCard` renders no
 *  chip for a non-measured read. It is the REMEASUREMENT that made this arm
 *  reachable, and its caller — not this function — decides what a read that
 *  cannot speak means for an already-open sheet (D-2722). Nothing here may
 *  conclude "old server, fall through to the frame": that path is unreachable
 *  from both call sites, and a shipped justification for an unreachable path
 *  is a false claim. */
const poolSelectionFor = (
  project: string,
  read: ProjectPlacementRead,
  write: PoolWrite | null,
): PoolSelection => {
  const written = write?.project === project ? write.pool : undefined;
  return {
    project,
    ...(written !== undefined
      ? { pool: written }
      : read.kind === 'measured' ? { pool: read.pool } : {}),
  };
};

export interface ProjectRowsPlane {
  rows: ProjectRowsRead;
  /** R5 (D-3010): the card set is seeded from the known-project list once it
   *  lands. Before it lands — `legacy`, `pending`, `failed` — the cards are
   *  session-derived exactly as before, and the set only ever GROWS when the
   *  read arrives: a card cannot be destroyed by a read this device has not
   *  made yet. Not hydrated and not persisted, for `pools`' own reason. */
  knownProjects: readonly string[];
  classFilter: '' | 'default' | ModelClass;
  chooseClass: (next: '' | 'default' | ModelClass) => void;
  placementFor: (project: string) => ProjectPlacementRead;
  poolFor: (project: string) => ProjectPoolWire | null;
  repoFor: (project: string) => ProjectRepoWire | undefined;
  adding: ReadonlySet<string>;
  addWorkspace: (project: string) => Promise<void>;
  poolSelection: PoolSelection | null;
  poolOpen: boolean;
  openPool: (project: string) => void;
  closePool: () => void;
  notePoolWrite: (project: string, pool: NonNullable<ProjectRow['pool']>) => void;
}

/** @param pools the live pools frame off the fleet store — this plane's
 *  invalidation signal, not something it fetches.
 *  @param publish the store's own `setProjects`. The rows have a SECOND reader
 *  off this screen (the session pickers read them out of the store), so a
 *  measurement that landed only here would leave that reader on the last one
 *  this device happened to take. Held in a ref: `refreshProjects`'s identity is
 *  deliberately stable, and a changing callback would give it a changing one. */
export function useProjectRows(
  pools: ProjectPoolsWire | null,
  publish: (rows: readonly ProjectRow[]) => void,
): ProjectRowsPlane {
  const publishRef = useRef(publish);
  publishRef.current = publish;
  // Keep the route-owned subject through vaul's exit animation, as the other
  // fleet sheets do. Pool and project come from the same `/api/projects` row.
  const [poolSelection, setPoolSelection] = useState<PoolSelection | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const poolWrite = useRef<PoolWrite | null>(null);

  // The fleet socket is the source of truth: no optimistic row here — the new
  // session appears on the next snapshot, so a refusal (e.g. no origin/HEAD)
  // never briefly shows a workspace that ccd declined to create.
  //
  // In-flight per PROJECT — a COURTESY now, no longer the gate. ccd's own
  // `cmd_ws_add` takes a per-project `flock -n` spanning slug selection through
  // the last registry write and refuses a second concurrent add with
  // `busy: another ws-add for <project> is in flight`, so the two-worktrees
  // outcome this comment used to describe as unfixed is closed on the box —
  // which matters, because React state does not survive a reload and never
  // covered a second tab, a second device, or the coordinator's own HTTP call.
  // This state is kept because it spares the operator a round trip and a
  // refusal toast, not because it prevents anything.
  //
  // The window is bounded too: the settle is capped at SPAWN_SETTLE_S (240s) on
  // this path, not the ~15 minutes an unbounded `_accept_first_run_prompts`
  // used to allow — and a settle that runs out is now a REPORT against a
  // workspace that exists, is claimed and is supervised, not an orphan.
  const [adding, setAdding] = useState<ReadonlySet<string>>(() => new Set());

  // `/api/projects` performs one agent round trip per project, so this lifecycle
  // has no timer. Pools-frame identity and visible-page return invalidate it;
  // the latter remeasures changed limits when a phone is picked up. A successful
  // add is the other imperative refresh. Generations keep late responses from
  // overwriting a newer measurement. The visibility token coalesces only an
  // equal reconnect frame while that visibility read remains unresolved; a
  // changed frame still starts its own request immediately (D-2702).
  // The class chooser (routing spec, slice 5, Task 6): `''` is the unset
  // "Coordinator row" — the class-blind fetch and route-less `+` every build
  // before this task has always sent. A ref beside the state, not a
  // `refreshProjects` dependency: that callback's identity is kept stable
  // for the pools/visibility effects below, so the class it reads has to
  // arrive through the same synchronously-updated-ref idiom `poolsFingerprintRef`
  // already uses two lines down, rather than by giving it a changing identity.
  const [classFilter, setClassFilter] = useState<'' | 'default' | ModelClass>('');
  const classFilterRef = useRef<'' | 'default' | ModelClass>('');
  classFilterRef.current = classFilter;
  const projectRequest = useRef(0);
  const visibilityRequest = useRef<{ token: number; pools: string } | null>(null);
  const writeRefresh = useRef<{ token: number; write: PoolWrite } | null>(null);
  const poolsFingerprintRef = useRef(pools === null ? null : poolsFingerprint(pools));
  poolsFingerprintRef.current = pools === null ? null : poolsFingerprint(pools);
  const [projectRows, setProjectRows] = useState<ProjectRowsRead>({ kind: 'legacy' });
  const refreshProjects = useCallback(async (
    visibilityPools?: string,
    write?: PoolWrite,
  ): Promise<void> => {
    const request = ++projectRequest.current;
    if (visibilityPools !== undefined) visibilityRequest.current = { token: request, pools: visibilityPools };
    if (write !== undefined) writeRefresh.current = { token: request, write };
    setProjectRows((rows) => rows.kind === 'ready' ? rows : { kind: 'pending' });
    try {
      const cls = classFilterRef.current;
      const response = await api.projects(cls === '' ? undefined : cls);
      if (request === projectRequest.current) {
        setProjectRows({ kind: 'ready', rows: response.projects });
        publishRef.current(response.projects);
      }
    } catch {
      if (request === projectRequest.current) {
        setProjectRows((rows) => rows.kind === 'ready' ? rows : { kind: 'failed' });
      }
    } finally {
      if (visibilityRequest.current?.token === request) visibilityRequest.current = null;
      if (writeRefresh.current?.token === request) {
        const { write: pending } = writeRefresh.current;
        if (poolWrite.current === pending) poolWrite.current = null;
        writeRefresh.current = null;
      }
    }
  }, []);
  useEffect(() => {
    if (pools === null) return;
    const fingerprint = poolsFingerprint(pools);
    if (visibilityRequest.current?.pools === fingerprint) return;
    visibilityRequest.current = null;
    void refreshProjects();
  }, [pools, refreshProjects]);
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && poolsFingerprintRef.current !== null) {
        void refreshProjects(poolsFingerprintRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshProjects]);

  // Memoised on the rows it reads, so the remeasurement below can depend on it
  // honestly: a reader rebuilt every render would make that effect re-run on
  // every render it caused.
  const placementFor = useCallback((project: string): ProjectPlacementRead => {
    if (projectRows.kind !== 'ready') return projectRows;
    const row = projectRows.rows.find((candidate) => candidate.name === project);
    if (row === undefined) return { kind: 'missing' };
    return Object.hasOwn(row, 'pool') && row.pool !== undefined
      && Object.hasOwn(row, 'placement') && row.placement !== undefined
      ? { kind: 'measured', pool: row.pool, placement: row.placement }
      : { kind: 'legacy' };
  }, [projectRows]);

  // Task 4 fix round 1: a card's own `placement`/`pool` names ONE project —
  // its own. A row the key flip moved onto this card belongs to a DIFFERENT
  // project by construction, so its off-pool judgment needs THAT project's
  // tag, not this card's. The absence discipline itself is `poolOfPlacement`'s
  // and is spelled once beside `ProjectPlacementRead` (final fix round): only
  // a `measured` read yields a pool, everything else (`pending`/`failed`/
  // `missing`/`legacy`) answers `null` — no account claim from an unmeasured
  // or absent read. What THIS adds is the per-project lookup and the memo.
  const poolFor = useCallback((project: string): ProjectPoolWire | null =>
    poolOfPlacement(placementFor(project)), [placementFor]);

  // Task 6: a displaced row's repo label needs ITS OWN project's repo, which
  // is by construction a different project from the card it renders on — the
  // same shape `poolFor` above threads for the same reason.
  const repoFor = useCallback((project: string): ProjectRepoWire | undefined => {
    if (projectRows.kind !== 'ready') return undefined;
    const row = projectRows.rows.find((candidate) => candidate.name === project);
    // `Object.hasOwn`: the key ABSENT is an older server and must read as
    // "nothing measured", never as `{state:'unmeasured'}` (ProjectRow's doc).
    return row !== undefined && Object.hasOwn(row, 'repo') ? row.repo : undefined;
  }, [projectRows]);

  // D-2721: the selection is a snapshot taken when the card was tapped, and the
  // route remeasures underneath an open sheet — a pools frame, a visible-page
  // return and the write's own refresh each land a fresher `ProjectRow.pool` in
  // `projectRows` that the tapped value would otherwise outlive, leaving the
  // card and the sheet above it stating different pools for one project at one
  // instant. Nothing new is fetched here: the answer is already in this
  // plane, only the wiring was missing.
  //
  // ONLY while open. The snapshot's other job is to survive vaul's exit
  // animation, so remeasuring through the close would flip the copy mid-flight
  // — to the FRAME's pool, or to "this box has not said" only in the narrow
  // case where no frame has arrived at all. Frozen on close stays frozen.
  //
  // D-2722: a read that is not `measured` leaves the selection ALONE. This is
  // forced, not preferred — the seam has no vocabulary for measured absence.
  // `selectedPool`'s `undefined` already means "old server omitted the field",
  // and every `ProjectPoolWire` member asserts a tag file was reached, so there
  // is no value here that says "the route answered and did not list this
  // project" (D-2723 parks the carrier that could). Clearing it hands the sheet
  // to `projectPoolOf`, and that FABRICATES rather than going stale: a project
  // the frame never listed reads back `{state:'untagged'}` — "every account may
  // serve it", the constraint-LIFTING direction — and a `listed:false` frame
  // reads back `{state:'unreadable'}`, naming a tag file nobody opened. Keeping
  // the last value the route actually measured is the only other thing this
  // seam can express. Keyed on the READ, never on whether the result happens to
  // carry a pool: that shape is `poolSelectionFor`'s decision, and re-reading it
  // here would silently change this rule if its convention ever moved.
  useEffect(() => {
    if (!poolOpen) return;
    setPoolSelection((selected) => {
      if (selected === null) return selected;
      const read = placementFor(selected.project);
      if (read.kind !== 'measured') return selected;
      return poolSelectionFor(selected.project, read, poolWrite.current);
    });
  }, [poolOpen, placementFor]);

  const addWorkspace = async (project: string): Promise<void> => {
    if (adding.has(project)) return;
    setAdding((s) => new Set(s).add(project));
    try {
      // Seeds the SAME class the chooser fetched with — the `+` starts a
      // workspace on the lane the row above it just forecast, rather than
      // asking the coordinator to re-decide from an unset row.
      await (classFilter === ''
        ? api.workspaceAdd(project)
        : api.workspaceAdd(project, { class: classFilter }));
      void refreshProjects();
    } catch (err) {
      toast(`Couldn't create workspace — ${apiErrorText(err)}`, 'error');
    } finally {
      // finally, not the try tail: a refusal must re-arm the button, or ccd
      // saying no leaves a `+` that can never be pressed again.
      setAdding((s) => {
        const next = new Set(s);
        next.delete(project);
        return next;
      });
    }
  };

  return {
    rows: projectRows,
    knownProjects: projectRows.kind === 'ready' ? projectRows.rows.map((r) => r.name) : [],
    classFilter,
    chooseClass: (next) => {
      setClassFilter(next);
      // Synchronously, beside the state: `refreshProjects` reads the ref and
      // its identity is deliberately stable, so a class set only in state
      // would be fetched with the PREVIOUS one.
      classFilterRef.current = next;
      void refreshProjects();
    },
    placementFor,
    poolFor,
    repoFor,
    adding,
    addWorkspace,
    poolSelection,
    poolOpen,
    openPool: (project) => {
      setPoolSelection(poolSelectionFor(project, placementFor(project), poolWrite.current));
      setPoolOpen(true);
    },
    closePool: () => setPoolOpen(false),
    notePoolWrite: (project, pool) => {
      const write = { project, pool };
      poolWrite.current = write;
      setPoolSelection((selected) => selected?.project === project ? { project, pool } : selected);
      void refreshProjects(undefined, write);
    },
  };
}
