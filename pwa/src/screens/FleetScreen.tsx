// Fleet screen (route `/`) — a thin renderer over the fleet store. Single
// column of project cards, each holding its sessions as compact lines,
// offline/notice banners, skeletons while the first snapshot is in flight, a
// friendly first-run block, and a floating "+" within thumb reach that opens
// the NewSessionSheet.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  ATTENTION_DOT, BareRow, BuildLine, Button, Skeleton, useNow,
} from '@ccrc/ui';
import { NewSessionSheet } from '../fleet/NewSessionSheet';
import { PoolSheet } from '../fleet/PoolSheet';
import { AccountsStrip } from '../fleet/AccountsStrip';
import { FleetHostBanner } from '../fleet/FleetHostBanner';
import { HaltBanner } from '../fleet/HaltBanner';
import { useFleetHealth } from '../fleet/useFleetHealth';
import { UpdateBanner } from '../fleet/UpdateBanner';
import { useUpdatesView } from '../fleet/useUpdatesView';
import { SubstrateBanner } from '../fleet/SubstrateBanner';
import { PasskeyNotice } from '../fleet/PasskeyNotice';
import { HotFilesStrip } from '../fleet/HotFilesStrip';
import { groupFleet } from '../fleet/groupFleet';
import { ArchiveAllConfirm, useArchiveAll } from '../fleet/ArchiveAllPlane';
import { ProjectCard } from '../fleet/ProjectCard';
import { SessionActionsSheet } from '../fleet/SessionActionsSheet';
import { BucketBar } from '../fleet/BucketBar';
import { FleetHead } from '../fleet/FleetHead';
import { anyDispatchPending, isRunClosed, runCard, runHomeProject } from '../fleet/runWords';
import { useFolded } from '../fleet/foldState';
import { useProjectedHome } from '../fleet/useProjectedHome';
import { useProjectRows } from '../fleet/useProjectRows';
import { useActionsSheet } from '../fleet/useActionsSheet';
import { navigate } from '../lib/router';
import { ackAll, acksSnapshot, FEED_ACK_KEY, isUnseenAt, prune, subscribeAcks } from '../lib/seen';
import { ReapSheet } from '../session/ReapSheet';
import { archivedSizeText, archivedSummary } from './ArchiveScreen';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { CLASSES, type ModelClass } from '../../../shared/models';
import { boardHome } from '../../../shared/api';
import '../fleet/fleet.css';

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

  const open = onOpen ?? ((id: string) => navigate(`/s/${encodeURIComponent(id)}`));
  const [newOpen, setNewOpen] = useState(false);
  const newSession = onNewSession ?? (() => setNewOpen(true));
  // The `/api/projects` plane — rows, class, placement readers, the `+`'s
  // in-flight set and the pool sheet's selection — lives in its own hook
  // (`useProjectRows`), which is where its generation discipline and its two
  // deviations are argued.
  const projects = useProjectRows(pools, useStore.getState().setProjects);

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
  // The ··· sheet's own lifecycle (`useActionsSheet`) — which session it is
  // about, and what it does when that session changes or vanishes.
  const actions = useActionsSheet(sessions);
  // The guarded reap flow, reachable from the fleet line's ··· regardless of
  // whether that session's chat screen is currently open — an archived
  // workspace's only other route to cleanup is a screen there is no reason
  // to open. Only the id is held: the session it names is looked up fresh
  // from the live list below, same reasoning as `actionsSession` above.
  const [reapId, setReapId] = useState<string | null>(null);
  // "Archive all" in a card's Released fold (workspace lifecycle spec §5.1).
  // The loop and the confirm's sentence live in `ArchiveAllPlane`; the screen
  // keeps only which project is asking, because the cards read the in-flight
  // set and a set owned inside the sheet could not reach them.
  const [archiveAllFor, setArchiveAllFor] = useState<string | null>(null);
  const archiveAll = useArchiveAll(store);

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

  // Task 4: which card each run belongs on — the card its WORKER renders on.
  // Built ONCE here from the whole session list, because a card sees only
  // its own rows and cannot answer it (`runCard`'s docstring has the two
  // fallbacks and why each is load-bearing).
  const cardOf = new Map(sessions.map((s) => [s.id, boardHome(s)] as const));

  return (
    <main className="fleet" data-conn={conn}>
      <FleetHead
        countLine={sessions.length > 0 ? countLine : null}
        poolLag={poolLag}
        unreadMail={unreadMail}
      />
      <FleetHostBanner health={fleetHealth} nodes={updates.view?.nodes ?? null} intent={updates.view?.intent ?? null} />
      {/* The halt, with each halting node's Ack in place (programme wave 14, R15(a)): above Update all, which it
          disables while it stands. Re-polls on every Ack. */}
      <HaltBanner updates={updates.view} seq={updates.seq} onAcked={updates.reload} />
      <UpdateBanner updates={updates.view} health={fleetHealth} onMoved={updates.reload} />

      {/* The substrate fault, said once (spec §4) — derived from the SAME
          injected store the rows render from, so the banner and the chips can
          never disagree about which fleet they describe. */}
      <SubstrateBanner store={useStore} />

      {conn === 'down' && (
        <div className={`offline-banner ${ATTENTION_DOT}`} role="status">
          Reconnecting…
        </div>
      )}

      {conn === 'connecting' && sessions.length > 0 && (
        // Cold start hydrated from the offline snapshot (lib/offline.ts):
        // cards render instantly, clearly marked stale until the socket opens.
        <div className={`offline-banner ${ATTENTION_DOT}`} role="status">
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
        <BareRow
          className="fleet-runs-row"
          aria-label={`Runs · ${runsLabel}`}
          onClick={() => navigate('/runs')}
        >
          Runs · {runsLabel}
        </BareRow>
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
          value={projects.classFilter}
          onChange={(e) => projects.chooseClass(e.target.value as '' | 'default' | ModelClass)}
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
          <Button variant="primary" onClick={newSession}>
            Start a session
          </Button>
        </section>
      ) : (
        <>
          <BucketBar sessions={sessions} acks={acks} ackAll={ackAll} />

          <div className="fleet-list">
            {groupFleet(sessions, projects.knownProjects, acks).map((g) => (
              <ProjectCard
                key={g.project}
                group={g}
                onOpen={open}
                selectedId={selectedId}
                onAddWorkspace={(p) => void projects.addWorkspace(p)}
                projected={projected}
                placement={projects.placementFor(g.project)}
                poolFor={projects.poolFor}
                repoFor={projects.repoFor}
                adding={projects.adding.has(g.project)}
                collapsed={folded.has(g.project)}
                onToggle={toggleFold}
                onActions={actions.openFor}
                roster={roster}
                pools={pools}
                onPool={projects.openPool}
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
                /* The same inversion, for the Released fold (workspace lifecycle spec §5.1). */
                releasedOpen={folded.has(`${g.project}::released`)}
                onArchiveReleased={setArchiveAllFor}
                archivingReleased={archiveAll.archiving.has(g.project)}
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
            <BareRow className="fleet-archived-row" onClick={() => navigate('/archive')}>
              {`Archived on disk · ${archived.count} · ${archivedSizeText(archived)}`}
            </BareRow>
          )}
        </>
      )}

      <button type="button" className="fab" aria-label="New session" onClick={newSession}>
        <span aria-hidden="true">+</span>
      </button>

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

      <BuildLine health={fleetHealth} nodes={updates.view?.nodes ?? null} />
    </main>
  );
}
