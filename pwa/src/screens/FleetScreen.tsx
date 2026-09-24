// Fleet screen (route `/`) — a thin renderer over the fleet store. Single
// column of project cards, each holding its sessions as compact lines,
// offline/notice banners, skeletons while the first snapshot is in flight, a
// friendly first-run block, and a floating "+" within thumb reach that opens
// the NewSessionSheet.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { NewSessionSheet } from '../fleet/NewSessionSheet';
import { PoolSheet } from '../fleet/PoolSheet';
import { AccountsStrip } from '../fleet/AccountsStrip';
import { FleetHostBanner } from '../fleet/FleetHostBanner';
import { BuildLine } from '../fleet/BuildLine';
import { useFleetHealth } from '../fleet/useFleetHealth';
import { UpdateBanner } from '../fleet/UpdateBanner';
import { useUpdatesView } from '../fleet/useUpdatesView';
import { SubstrateBanner } from '../fleet/SubstrateBanner';
import { MailBadge } from '../fleet/MailBadge';
import { NotificationBell } from '../fleet/NotificationBell';
import { PasskeyNotice } from '../fleet/PasskeyNotice';
import { HotFilesStrip } from '../fleet/HotFilesStrip';
import { groupFleet } from '../fleet/groupFleet';
import { ProjectCard, poolOfPlacement, type ProjectPlacementRead } from '../fleet/ProjectCard';
import { SessionActionsSheet } from '../fleet/SessionActionsSheet';
import { BUCKET_ORDER } from '../fleet/sortFleet';
import { anyDispatchPending, isRunClosed, runCard, runHomeProject } from '../fleet/runWords';
import { useNow } from '../lib/useNow';
import { useFolded } from '../fleet/foldState';
import { useProjectedHome } from '../fleet/useProjectedHome';
import { api, apiErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import { ackAll, acksSnapshot, FEED_ACK_KEY, isUnseen, isUnseenAt, prune, subscribeAcks } from '../lib/seen';
import { ReapSheet } from '../session/ReapSheet';
import { archivedSizeText, archivedSummary } from './ArchiveScreen';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { CLASSES, type ModelClass } from '../../../shared/models';
import { boardHome, type FleetSession, type ProjectPoolsWire, type ProjectPoolWire, type ProjectRepoWire, type ProjectRow } from '../../../shared/api';
import '../fleet/fleet.css';

const poolsFingerprint = (pools: ProjectPoolsWire): string => JSON.stringify(
  pools,
  (_key, value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  },
);

type PoolSelection = {
  project: string;
  pool?: NonNullable<ProjectRow['pool']>;
};

type PoolWrite = {
  project: string;
  pool: NonNullable<ProjectRow['pool']>;
};

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

/** Section-header noun for each bucket — a heading register, not the row's
 *  own state-word adjective (SessionLine.tsx's private `WORD`, which says
 *  `waiting`/`merged`/`exited` where these say `Attention`/`Cleanup`/`Dead`).
 *  Deliberately a SEPARATE small vocabulary: this is presentational only (it
 *  names buckets, it does not decide which bucket a session is in), so it
 *  carries none of the "one writer" risk `bucket` itself does. Retitling a
 *  section here changes only these headings — no row's word moves with it. */
const SECTION_LABEL: Record<(typeof BUCKET_ORDER)[number], string> = {
  attention: 'Attention', working: 'Working', done: 'Done', idle: 'Idle',
  cleanup: 'Cleanup', archived: 'Archived', dead: 'Dead',
};

export function FleetScreen({
  store = useFleetStore,
  onOpen,
  onNewSession,
  selectedId = null,
  showAccounts = true,
  epoch,
  observedEpoch,
}: {
  store?: FleetStore; // injectable for tests
  onOpen?: (id: string) => void;
  onNewSession?: () => void;
  selectedId?: string | null; // the open session, highlighted in the desktop sidebar
  showAccounts?: boolean; // false on desktop — the accounts strip is a top bar there
  /** The server's current account-pool epoch (`GET /api/pools/epoch`, Task
   *  7), off `useFleetStore`'s `pools.epoch` (`app.tsx`) — the same `pools`
   *  frame the fleet WS/REST wire carries (`server/src/pools.ts`'s
   *  `poolsWire`). Commit 18454187 (T9-R2) wired the real producer, so
   *  `undefined` here now means what the field's own three-valued contract
   *  says it means: this server has no coordination db wired (local mode),
   *  never "nothing polls it yet". */
  epoch?: number;
  /** The fleet host's own observed pool-projection epoch, off the SAME
   *  `pools` frame's `observedEpoch` field. Through commit 18454187 (T9-R2)
   *  this was the agent's handshake report (`AgentReady.observedEpoch`)
   *  forwarded unchanged; since item 1 (wave-1 fix round A) it is the
   *  SERVER's own fresh measurement of `$REG/pool-epoch`
   *  (`server/src/pools.ts`'s `readObservedEpochFromRegistry`, on every
   *  watcher tick / `GET /api/fleet` request) — the handshake value was
   *  sampled once per WS connection and never refreshed for a link that can
   *  live for days, so it read "in sync" forever after one real sync. This
   *  prop's own SHAPE is unchanged (the wire field's name and three-value
   *  contract did not move), only what feeds it. THREE answers, not two:
   *  absent means "this server cannot tell you" (render nothing — the reader
   *  has no evidence either way), `null` means "the node has never synced"
   *  (a real, renderable fact), a number is what it actually has. Never read
   *  as a health tick: a node whose projection is past its lease still
   *  reports a number while `ccd` refuses every tagged placement, so
   *  `observedEpoch === epoch` means only "not stale", never "this node is
   *  placing" — and, separately (disclosed, not fixed, here): `epoch` counts
   *  CENTRAL writes only, while the pool document an operator sees also
   *  derives from the declared roster since T7-R4, so a declared-only pool
   *  change can alter that document while `epoch` — and therefore this
   *  comparison — stands still. `observedEpoch === epoch` has only ever meant
   *  "not stale"; it still never means "agrees". */
  observedEpoch?: number | null;
}): ReactNode {
  const useStore = store;
  const sessions = useStore((s) => s.sessions);
  const conn = useStore((s) => s.conn);
  const notices = useStore((s) => s.notices);
  const dismissNotice = useStore((s) => s.dismissNotice);
  const roster = useStore((s) => s.roster);
  const pools = useStore((s) => s.pools);
  const fleetFrameSeen = useStore((s) => s.fleetFrameSeen);

  useEffect(() => {
    // The fleet stream is the app's heartbeat: connect() is idempotent and
    // the socket deliberately survives navigation, so no disconnect here.
    store.getState().connect();
  }, [store]);

  // The unseen watermark (pwa/src/lib/seen.ts) — per-device, in localStorage.
  // SUBSCRIBED, not read into state: this screen is never unmounted (app.tsx
  // renders it as the desktop sidebar for the whole app lifetime), and the
  // other writer is a different screen — SessionScreen acks on mount. A
  // `useState(loadAcks)` initialiser never re-runs, and a fleet that hasn't
  // changed emits no snapshot to hang a re-read on (watch.ts's `lastJson`
  // guard), so opening a session used to leave its own badge on this screen
  // until something unrelated moved.
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  // Pruned against every fresh snapshot: `prune` only ever REMOVES entries for
  // ids the fleet no longer has, so a session acked a moment ago and still
  // live survives untouched — it starts from seen.ts's own published map, not
  // from a re-read of storage, which is what used to let an ack storage
  // refused be rolled back by the very next tick. It publishes, so no setState
  // is needed here.
  useEffect(() => {
    prune(new Set(sessions.map((s) => s.id)));
  }, [sessions]);

  // "Mark all seen" unmounts itself. Both halves of the repair live here.
  //
  // FOCUS: the button is inside `{unseenCount > 0 && …}`, so activating it
  // removes the focused element, and the browser's fallback for that is
  // `document.body` — the next Tab restarts at the wordmark, past the bell,
  // the banners and every preceding chip. Focus moves to the chip's own
  // label, which is where the operator was.
  //
  // ANNOUNCEMENT: a screen-reader user otherwise gets nothing at all — the
  // control they were on ceased to exist and a pill silently vanished, which
  // is indistinguishable from a no-op. The message names the bucket and the
  // count, because "done" would be the same sentence for every chip.
  const labelRefs = useRef<Partial<Record<(typeof BUCKET_ORDER)[number], HTMLElement | null>>>({});
  const [ackNote, setAckNote] = useState('');
  const markSeen = (
    bucket: (typeof BUCKET_ORDER)[number],
    inBucket: readonly FleetSession[],
    unseenCount: number,
  ): void => {
    ackAll(inBucket, Date.now());
    setAckNote(`${SECTION_LABEL[bucket]}: ${unseenCount} marked seen`);
    labelRefs.current[bucket]?.focus();
  };

  const open = onOpen ?? ((id: string) => navigate(`/s/${encodeURIComponent(id)}`));
  const [newOpen, setNewOpen] = useState(false);
  const newSession = onNewSession ?? (() => setNewOpen(true));
  // Keep the route-owned subject through vaul's exit animation, as the other
  // fleet sheets do. Pool and project come from the same `/api/projects` row.
  const [poolSelection, setPoolSelection] = useState<{
    project: string;
    pool?: NonNullable<ProjectRow['pool']>;
  } | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const poolWrite = useRef<{ project: string; pool: NonNullable<ProjectRow['pool']> } | null>(null);

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
  const writeRefresh = useRef<{ token: number; write: { project: string; pool: NonNullable<ProjectRow['pool']> } } | null>(null);
  const poolsFingerprintRef = useRef(pools === null ? null : poolsFingerprint(pools));
  poolsFingerprintRef.current = pools === null ? null : poolsFingerprint(pools);
  const [projectRows, setProjectRows] = useState<
    | { kind: 'legacy' }
    | { kind: 'pending' }
    | { kind: 'failed' }
    | { kind: 'ready'; rows: readonly ProjectRow[] }
  >({ kind: 'legacy' });
  const refreshProjects = useCallback(async (
    visibilityPools?: string,
    write?: { project: string; pool: NonNullable<ProjectRow['pool']> },
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
        useStore.getState().setProjects(response.projects);
      }
    } catch {
      if (request === projectRequest.current) {
        setProjectRows((rows) => rows.kind === 'ready' ? rows : { kind: 'failed' });
      }
    } finally {
      if (visibilityRequest.current?.token === request) visibilityRequest.current = null;
      if (writeRefresh.current?.token === request) {
        const { write } = writeRefresh.current;
        if (poolWrite.current === write) poolWrite.current = null;
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
  // component, only the wiring was missing.
  //
  // ONLY while open. The snapshot's other job (:129) is to survive vaul's exit
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

  const projected = useProjectedHome();
  // Once, not three times in one interpolation: the footer's count and its
  // size must describe the same pass over the same list.
  const archived = archivedSummary(sessions);
  // Build 7's run board footer (fix, review findings 11/23): `state`, never
  // `closedAt` — `isRunClosed` is the same split `RunsScreen` itself now uses
  // (its own docstring explains why `closedAt` alone is wrong: a
  // reconstructed run never gets one). And `runsFrameSeen`, which this row
  // used to skip reading entirely: `runs` starts `[]` and stays `[]` until a
  // `{type:'runs'}` frame lands (cold start, a socket still connecting, a
  // server built without `deps.coord`), which is indistinguishable from "no
  // runs" by content alone — the store's own docstring on the flag says so.
  // Without this, the footer asserted "Runs · none active" as fact, aria-
  // label included, while /runs one tap away could be showing three runs
  // this row had simply not heard about yet.
  const runsFrameSeen = useStore((s) => s.runsFrameSeen);
  // ONE filtered list, two readers (Task 4): the footer's count and the
  // programme tree the cards draw. The frame is active-only by construction
  // anyway — `watch.ts`'s emitter calls `coord.runs()` with no options — so
  // `isRunClosed` is the belt this row has always worn, and keeping one list
  // means the number in the footer and the edges in the cards can never
  // describe two different sets of runs.
  const activeRuns = useStore((s) => s.runs).filter((r) => !isRunClosed(r));
  const runsLabel =
    !runsFrameSeen ? '—' : activeRuns.length > 0 ? `${activeRuns.length} active` : 'none active';
  // Task 4's clock, for the pending child's elapsed readout — and the CADENCE
  // FOLLOWS THE CONTENT, the `SessionHeader`/`ToolCard` idiom `RunsScreen`
  // already adopted for the same window: a second-granular readout on a
  // half-minute tick is the "board that never moves" §Design complains about.
  // `active: false` when nothing is spawning, so this screen runs NO timer at
  // all in the ordinary case — which is how it has always behaved, and a
  // permanent interval under twenty session rows is not a change anyone asked
  // for. `anyDispatchPending` rather than an inline condition, so what counts
  // as a dispatch window stays `dispatchWindow`'s single answer; it is asked
  // of `activeRuns` and not of the per-card slices, because the tick is one
  // fact about the screen.
  const nowMs = useNow(1_000, anyDispatchPending(activeRuns));
  // Fold state persists across navigation (foldState.ts) — useState here would
  // re-expand every project on the way back from a session.
  const [folded, toggleFold] = useFolded();
  // One poll of /api/fleet/health feeds both the banner and BuildLine below
  // (spec §6) — the screen owns it so the two never issue their own requests.
  // The same for /api/updates (centralised-update §13): ONE 60 s poll, its
  // view handed down to every reader of the inventory on this screen, none of
  // which polls on its own.
  const fleetHealth = useFleetHealth();
  const updates = useUpdatesView();
  // One sheet for the whole screen, fed by whichever line was tapped. Only
  // the id is the source of truth (Finding 5 of the whole-branch review):
  // `actionsSession` is refreshed from the live `sessions` list below rather
  // than frozen at tap time, so a fleet update while the sheet is open keeps
  // its limit note and Remove-workspace visibility current. `actionsOpen` is
  // a separate boolean — matching how NewSessionSheet and SwapSheet are
  // toggled elsewhere in this file — so closing never clears the session:
  // SessionActionsSheet stays mounted and vaul gets to play its exit
  // animation instead of popping out of existence (Finding 2).
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsSession, setActionsSession] = useState<FleetSession | null>(null);
  // The guarded reap flow, reachable from the fleet line's ··· regardless of
  // whether that session's chat screen is currently open — an archived
  // workspace's only other route to cleanup is a screen there is no reason
  // to open. Only the id is held: the session it names is looked up fresh
  // from the live list below, same reasoning as `actionsSession` above.
  const [reapId, setReapId] = useState<string | null>(null);

  useEffect(() => {
    if (actionsId === null) return;
    const live = sessions.find((s) => s.id === actionsId) ?? null;
    if (live !== null) {
      setActionsSession(live);
    } else if (actionsOpen) {
      // The session vanished from the fleet entirely (workspace removed,
      // process gone) while the sheet was open — there is nothing left to
      // act on. Close it exactly as a manual dismiss would: `actionsSession`
      // keeps its last known value so the sheet still has something to
      // animate out over, rather than popping (same class of bug as
      // Finding 2, from a different trigger).
      setActionsOpen(false);
    }
  }, [sessions, actionsId, actionsOpen]);

  const openActionsFor = (session: FleetSession): void => {
    setActionsId(session.id);
    setActionsSession(session);
    setActionsOpen(true);
  };

  // `bucket`, not `dialogPending` — the LAST client-side re-derivation of the
  // attention bucket, and the one that sat directly above the bucket bar that
  // reads the server's answer. They disagreed on the same screen: the server
  // buckets a killed-but-still-dialogPending session `dead` (shared/api.ts's
  // ladder checks `status === 'dead'` first, and fleet.ts keeps ORing a stale
  // hook `waiting` into `dialogPending`), so this head said "1 waiting" while
  // the chip below it said "Dead 1" and the row said `exited`.
  const waiting = sessions.filter((s) => s.bucket === 'attention').length;
  const countLine =
    `${sessions.length} session${sessions.length === 1 ? '' : 's'}` +
    (waiting > 0 ? ` · ${waiting} waiting` : '');

  // The feed's unread count, through the SAME comparison the bucket chips use
  // (seen.ts's isUnseenAt — see groupFleet.ts:30-44's pre-commitment). `acks`
  // is already subscribed on this screen, so this costs one filter.
  const feed = useStore((s) => s.feed);
  const unreadMail = feed.filter((ev) => isUnseenAt(FEED_ACK_KEY, ev.at, acks)).length;

  // The account-pool epoch/observed lag — a STALENESS signal, not a health
  // one (see the prop docs above). Rendered ONLY when both numbers are known
  // AND they actually differ: `epoch === undefined` or `observedEpoch ===
  // undefined` both mean "nothing to compare", and an equal pair means "not
  // stale", not "placing" — the one thing this text must never read as.
  // Before item 1 (wave-1 fix round A) `observedEpoch` was frozen at
  // handshake, so a node that synced once and then stopped kept comparing
  // equal here forever — a false "in sync". `observedEpoch` now refreshes on
  // the server's own watcher tick, so an equal pair here is a genuinely
  // current fact, not a stale first impression.
  const poolLag =
    epoch !== undefined && observedEpoch !== undefined && observedEpoch !== epoch
      ? `epoch ${epoch} / observed ${observedEpoch === null ? 'never synced' : observedEpoch}`
      : null;

  // R5 (D-3010): the card set is seeded from the known-project list once it
  // lands. Before it lands — `legacy`, `pending`, `failed` — the cards are
  // session-derived exactly as before, and the set only ever GROWS when the
  // read arrives: a card cannot be destroyed by a read this device has not
  // made yet. Not hydrated and not persisted, for `pools`' own reason.
  const knownProjects = projectRows.kind === 'ready' ? projectRows.rows.map((r) => r.name) : [];

  // Task 4: which card each run belongs on — the card its WORKER renders on.
  // Built ONCE here from the whole session list, because a card sees only
  // its own rows and cannot answer it (`runCard`'s docstring has the two
  // fallbacks and why each is load-bearing).
  const cardOf = new Map(sessions.map((s) => [s.id, boardHome(s)] as const));

  return (
    <main className="fleet" data-conn={conn}>
      <header className="fleet-head">
        <span className="wordmark">ccrc</span>
        <div className="fleet-head-right">
          {sessions.length > 0 && <span className="fleet-count">{countLine}</span>}
          {poolLag !== null && (
            <span className="pool-epoch-lag" data-testid="pool-epoch-lag" title="account-pool projection lag">
              {poolLag}
            </span>
          )}
          {/* THE DURABLE DOOR TO /accounts (D-161). The AccountsStrip tap
              target was the only one — its own comment says so — and its
              accessible name is "account usage — open accounts": a full-width
              readout of 5h/7d meters, which reads as DATA and not as
              navigation. /runs, /archive and /mail each have an explicit
              control; the screen carrying the passkey enrolment button and the
              sign-out button had none, so the operator hunting for it on a
              laptop never found the screen at all. The strip STAYS a door (a
              second one costs nothing and it is where a gauge is being looked
              at anyway); this is the one that says what it is.

              A SHORT TEXT LABEL, not a lone glyph: icon-only would be exactly
              as undiscoverable as the strip, which is the defect. The
              accessible name names both halves of the screen — sign-in and
              accounts — because "Account" alone is what the strip already
              failed to communicate. */}
          <button
            type="button"
            className="accounts-door"
            aria-label="Your sign-in and accounts"
            onClick={() => navigate('/accounts')}
          >
            <span className="accounts-door-glyph" aria-hidden="true">🔑</span>
            Account
          </button>
          {/* THE DOOR TO /settings (centralised update management §13) — the
              `.accounts-door` pattern directly above, for the argument its
              comment makes: a glyph AND a short text label, because an
              icon-only gear would be exactly as undiscoverable as the
              AccountsStrip tap target that D-161 found was the only door to
              /accounts. The accessible name says what is behind it — updates
              and notifications — because "Settings" alone names no content;
              it begins with the visible word, so a voice user saying what
              they see still reaches it. Rendered unconditionally: a first-run
              fleet with no sessions needs the screen as much as any. A fifth
              item does not fit this group's measured width budget on a
              phone, so the group now wraps rather than overflowing
              (fleet.css, D-3303). */}
          <button
            type="button"
            className="settings-door"
            aria-label="Settings — updates and notifications"
            onClick={() => navigate('/settings')}
          >
            <span className="settings-door-glyph" aria-hidden="true">⚙</span>
            Settings
          </button>
          <MailBadge unread={unreadMail} />
          <NotificationBell />
        </div>
      </header>

      <FleetHostBanner health={fleetHealth} nodes={updates.view?.nodes ?? null} />
      <UpdateBanner updates={updates.view} />

      {/* The substrate fault, said once (spec §4) — derived from the SAME
          injected store the rows render from, so the banner and the chips can
          never disagree about which fleet they describe. */}
      <SubstrateBanner store={useStore} />

      {conn === 'down' && (
        <div className="offline-banner" role="status">
          Reconnecting…
        </div>
      )}

      {conn === 'connecting' && sessions.length > 0 && (
        // Cold start hydrated from the offline snapshot (lib/offline.ts):
        // cards render instantly, clearly marked stale until the socket opens.
        <div className="offline-banner" role="status">
          Last known state — connecting…
        </div>
      )}

      {notices.map((n) => (
        <div key={n.id} className="notice" role="status">
          <span className="notice-msg">{n.message}</span>
          <button
            type="button"
            className="notice-x"
            aria-label="Dismiss"
            onClick={() => dismissNotice(n.id)}
          >
            ×
          </button>
        </div>
      ))}

      {/* Its own poller, independent of `sessions` — it must render in EVERY
          branch below, not just the populated one. It used to sit only in
          the third (populated) arm, so a fresh fleet with zero sessions ever
          started (the first-run panel, mobile's only view of the strip)
          rendered no accounts strip at all — and at the time that was the
          app's only door to /accounts, gone in the exact state a new operator
          hits first. It is not the only door any more (the header control
          above, D-161); the rule that a door must never render nothing is
          unchanged. */}
      {showAccounts && <AccountsStrip />}

      {/* The passphrase-only notice (D-161) — renders ITSELF or nothing, from
          the box's own posture, so it is mounted unconditionally here for the
          same reason AccountsStrip and the runs row are: every branch below
          needs it, and a first-run box with zero sessions is the one most
          likely to have a gate armed and no passkey on it yet. Outside
          `showAccounts` too — that flag is about which surface owns the
          accounts STRIP (top bar vs fleet list), and this is not it. */}
      <PasskeyNotice />

      {/* The only door to /runs (fix, review finding 20) — moved OUT of the
          populated arm for the identical reason `AccountsStrip` was, three
          lines above, and the comment there already tells the story: it used
          to render only when `sessions.length > 0`, so the loading skeleton
          and the first-run panel — spec §8's named "fleet host unreachable,
          runs go honest-stale" case renders as the first-run panel, since a
          `readRegistry` failure still ships an honest `sessions: []` — had
          no door to the one surface that would show the operator their runs
          going stale. D-2's rule: the only door must never render nothing. */}
      {/* THE RUNS LINE — the runs door and the class chooser share one row.
          The chooser had a row to itself and looked orphaned on it; this row
          was already full-width, 44px tall and nearly empty, so pairing them
          costs no height at all. The partner is the RUNS door and not
          `HotFilesStrip` (the other candidate) for one measured reason: that
          strip returns null when no claim is live and says so in its own
          comment, so a chooser paired with it would be side-by-side only
          while somebody held a hot file and alone again the moment the last
          claim expired. The runs door is the opposite — its comment cites
          D-2's rule that the only door must never render nothing, so it is
          the one sibling on this screen guaranteed to be there. */}
      <div className="fleet-runs-line">
        <button
          type="button"
          className="fleet-runs-row"
          aria-label={`Runs · ${runsLabel}`}
          onClick={() => navigate('/runs')}
        >
          Runs · {runsLabel}
        </button>
        {/* The class chooser (routing spec, slice 5, Task 6): forecasts
            EVERY card's placement for one class at a time, the same
            `GET /api/projects?class=` this build has carried since slice 4
            but with no caller until now. "Coordinator row" (unset) is the
            class-blind fetch every build before this task has always sent;
            "Default" asks explicitly for the record's own "no override"
            word — the projects handler (`server.ts`) treats it identically
            to the unset fetch (no per-class shares read, byte-identical
            answer), so choosing it changes nothing about what renders, only
            what the `+` posts. The four classes are `CLASSES` reversed —
            the same capability order `NewSessionSheet`'s own routing row
            uses — never a hand-typed list, so a class this build adds or
            drops shows up here for free. */}
        <select
          className="route-select fleet-class-select"
          aria-label="Class"
          value={classFilter}
          onChange={(e) => {
            const next = e.target.value as '' | 'default' | ModelClass;
            setClassFilter(next);
            classFilterRef.current = next;
            void refreshProjects();
          }}
        >
          <option value="">Coordinator row</option>
          <option value="default">Default</option>
          {[...CLASSES].reverse().map((c) => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Build 9's contested-files signal (D12 ruling 3) — renders itself or
          nothing, so it mounts unconditionally, the AccountsStrip rule. */}
      <HotFilesStrip />

      {sessions.length === 0 && conn !== 'open' ? (
        <div className="fleet-list" data-loading="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card">
              <Skeleton lines={3} />
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <section className="first-run">
          <p className="first-run-mark" aria-hidden="true">
            ❯
          </p>
          <h2 className="first-run-title">No sessions yet</h2>
          <p className="first-run-copy">
            Start Claude on one of your projects and drive it from here — from any device,
            wherever you are.
          </p>
          <button type="button" className="btn-primary" onClick={newSession}>
            Start a session
          </button>
        </section>
      ) : (
        <>
          {/* Bucket chips — above the project cards, one per non-empty
              bucket, in the same RANK order the list itself sorts by. Counts
              come from THIS render's own `sessions` array, the identical one
              the cards below iterate, so a chip's number is always the number
              of ROWS the cards hold for that bucket. `groupFleet` splits its
              per-project fold on `bucket === 'archived'` for exactly this
              reason: on the `archivedAt` split, a merged workspace counted
              under `Cleanup` here and rendered inside a fold labelled
              `Archived (n)`, so this row named a bucket whose rows, glyph and
              merge facts were nowhere on the screen.

              Only the `Archived` chip's rows sit behind a fold, and that fold
              states the identical count. The footer below is the wider DISK
              set (everything with an `archivedAt`, merged ones included) and
              says so in its own words rather than repeating the noun.

              A `<div role="group">`, NOT a `<section aria-label>`: a labelled
              section is a `region` LANDMARK, and seven of them named after
              buckets — none containing any of that bucket's sessions — turns
              the landmark rotor, whose whole job is to move a screen-reader
              user to the region they named, into seven dead ends. */}
          <div className="bucket-bar">
            {BUCKET_ORDER.map((bucket) => {
              const inBucket = sessions.filter((s) => s.bucket === bucket);
              if (inBucket.length === 0) return null;
              const unseenCount = inBucket.filter((s) => isUnseen(s, acks)).length;
              return (
                <div key={bucket} role="group" className="bucket-head" aria-label={SECTION_LABEL[bucket]}>
                  <span
                    className="bucket-head-label"
                    /* The focus target after an ack — see `markSeen`. -1, so
                       it is reachable programmatically and never a Tab stop
                       of its own. */
                    tabIndex={-1}
                    ref={(el) => { labelRefs.current[bucket] = el; }}
                  >
                    {SECTION_LABEL[bucket]}
                  </span>
                  <span className="bucket-head-count">{inBucket.length}</span>
                  {unseenCount > 0 && (
                    <>
                      <span className="bucket-head-unseen" aria-label={`${unseenCount} unseen`}>
                        {unseenCount}
                      </span>
                      <button
                        type="button"
                        className="bucket-head-seen"
                        /* The bucket is IN the accessible name. Every one of
                           these used to be the bare string "Mark all seen",
                           and NVDA's Elements List, JAWS's button list and
                           the VoiceOver rotor all list controls by name
                           alone, outside their containing group — so three
                           unseen buckets produced three identical entries and
                           picking the wrong one silently cleared the badge on
                           the session Claude is still blocked on, with no way
                           to restore it. */
                        aria-label={`Mark all ${SECTION_LABEL[bucket]} seen`}
                        onClick={() => markSeen(bucket, inBucket, unseenCount)}
                      >
                        Mark all seen
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {/* The ack's only evidence. Activating "Mark all seen" DESTROYS the
              control that was activated (both it and the badge live inside
              `unseenCount > 0`), so there is nothing left to announce a state
              change on and — without the focus transfer in `markSeen` — the
              browser drops focus to <body>, restarting the next Tab at the
              top of the document. Outside the chip so it is not unmounted by
              the very update it reports. */}
          <div className="sr-only" role="status">{ackNote}</div>

          <div className="fleet-list">
            {groupFleet(sessions, knownProjects, acks).map((g) => (
              <ProjectCard
                key={g.project}
                group={g}
                onOpen={open}
                selectedId={selectedId}
                onAddWorkspace={(p) => void addWorkspace(p)}
                projected={projected}
                placement={placementFor(g.project)}
                poolFor={poolFor}
                repoFor={repoFor}
                adding={adding.has(g.project)}
                collapsed={folded.has(g.project)}
                onToggle={toggleFold}
                onActions={openActionsFor}
                roster={roster}
                pools={pools}
                onPool={(p) => {
                  setPoolSelection(poolSelectionFor(p, placementFor(p), poolWrite.current));
                  setPoolOpen(true);
                }}
                /* Task 4 (wave 2): THIS card's runs are the runs whose WORKER
                   renders here — `runCard`, never `r.project`. A run kept on
                   its worker's OWN project's card after the row moved would be
                   spec §1's pure regression: one end on each card, no edge. */
                runs={activeRuns.filter((r) => runCard(r, cardOf) === g.project)}
                /* The SECOND list (spec §3 F4): the runs this project is the
                   HOME of, working somewhere else. NOT the exact complement of
                   the filter above (D-2582): a run homed on a third project
                   and working on a fourth is in NEITHER of this card's lists,
                   and a crossing run appears in `runs` on the working card and
                   in `abroad` on the home card — two different cards' lists —
                   so there is no partition across cards either; the two
                   filters are merely disjoint on this one card. What is true:
                   that one asks where the work is, this one asks whose
                   programme it is — and the two never merge, because only the
                   first may reach `nestFleet`. `runHomeProject` rather than
                   `r.homeProject`, for the house rule its own docstring
                   gives — one reader per field — not because the tolerance is
                   load-bearing at THIS `===` comparison: an older server's
                   missing key makes `runHomeProject(r)` `null` and a raw
                   `r.homeProject` `undefined`, and either one `=== g.project`
                   is false, so the failure mode without the tolerant reader
                   would have been a crossing run silently missing its abroad
                   line on an older server, never every run landing on every
                   card. And this predicate SPECIALIZES `crossingNote`'s
                   decision rather than re-spelling it, which is the distinction
                   D-2575 turns on: `crossingNote` asks whether a run is
                   crossing AT ALL, judged from the run's own project, while
                   this asks the same question from a THIRD party — the card
                   whose project is neither necessarily the run's work nor its
                   home. Named here so the next reader neither deletes it as a
                   duplicate of that decision nor forks it into a second copy
                   of it. Since wave 2 it also SUBTRACTS a run whose worker now
                   renders on this very card — that run is a bracketed row
                   here, and a second line for it would state the same wave
                   twice (spec §6). */
                abroad={activeRuns.filter(
                  (r) => runHomeProject(r) === g.project && r.project !== g.project
                    && runCard(r, cardOf) !== g.project)}
                nowMs={nowMs}
                /* Fleet-wide, unlike every other lookup this card is handed —
                   an orphan's coordinator is by construction NOT among this
                   card's own sessions (D-3009), so a card-scoped read would
                   always answer `null` for the one row that asks. */
                coordOf={(id) => sessions.find((s) => s.id === id) ?? null}
                frameSeen={fleetFrameSeen}
                /* INVERTED against the project fold on purpose: foldState
                   stores what is COLLAPSED, so absence means open — right for
                   a project, wrong for an archive fold that must start
                   closed. Under this composite key, presence means EXPANDED. */
                archivedOpen={folded.has(`${g.project}::archived`)}
              />
            ))}
          </div>
          {archived.count > 0 && (
            /* Folded, never hidden — and never a place that DELETES anything:
               this routes to a list, and every removal still goes through the
               audit and the fingerprint.

               The size half is `archivedSizeText`, shared with the archive
               screen's own total (fix round 3, P3): a fleet whose archives
               were never measured used to read "Archived · 3 · 0 B" — a
               stated total for three workspaces nobody sized — and a
               half-measured fleet stated its measured part as the whole.

               "on disk", because this is the ONLY count on the screen that is
               not a bucket. `archivedSummary` keys on `archivedAt`, so it
               covers the merged workspaces the `Cleanup` chip files
               separately — which is right for a disk figure and is why the
               reclaimable bytes are honest — but as the bare word "Archived"
               it put a third number under a noun the chip and the per-project
               fold were already using for a strictly smaller set. Same set as
               `/archive`, which is where this goes. */
            <button type="button" className="fleet-archived-row" onClick={() => navigate('/archive')}>
              {`Archived on disk · ${archived.count} · ${archivedSizeText(archived)}`}
            </button>
          )}
        </>
      )}

      <button type="button" className="fab" aria-label="New session" onClick={newSession}>
        <span aria-hidden="true">+</span>
      </button>

      <NewSessionSheet open={newOpen} onClose={() => setNewOpen(false)} fleet={store} />

      <PoolSheet
        project={poolSelection?.project ?? null}
        selectedPool={poolSelection?.pool}
        open={poolOpen}
        onClose={() => setPoolOpen(false)}
        onPoolChanged={(project, pool) => {
          const write = { project, pool };
          poolWrite.current = write;
          setPoolSelection((selected) => selected?.project === project
            ? { project, pool }
            : selected);
          void refreshProjects(undefined, write);
        }}
        fleet={store}
      />

      <SessionActionsSheet
        session={actionsSession}
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onReap={setReapId}
        fleet={store}
      />

      <ReapSheet
        session={sessions.find((sn) => sn.id === reapId) ?? null}
        open={reapId !== null}
        onClose={() => setReapId(null)}
        onReaped={() => setReapId(null)}
      />

      <BuildLine health={fleetHealth} nodes={updates.view?.nodes ?? null} />
    </main>
  );
}
