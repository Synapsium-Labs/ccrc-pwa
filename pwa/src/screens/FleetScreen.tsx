// Fleet screen (route `/`) — a thin renderer over the fleet store. Single
// column of project cards, each holding its sessions as compact lines,
// offline/notice banners, skeletons while the first snapshot is in flight, a
// friendly first-run block, and a floating "+" within thumb reach that opens
// the NewSessionSheet.
import { useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  ATTENTION_DOT, BareRow, BuildLine, Button, Select, Skeleton,
} from '@ccrc/ui';
import { AccountsStrip } from '../fleet/AccountsStrip';
import { FleetHostBanner, fleetHostBannerShows } from '../fleet/FleetHostBanner';
import { HaltBanner, haltBannerShows } from '../fleet/HaltBanner';
import { UpdateBanner, updateBannerShows } from '../fleet/UpdateBanner';
import { UPDATES_STALE_TEXT } from '../fleet/useUpdatesView';
import { SubstrateBanner, substrateBannerShows } from '../fleet/SubstrateBanner';
import { PasskeyNotice, passkeyNoticeShows, usePasskeyStatus } from '../fleet/PasskeyNotice';
import { BannerStack } from '../fleet/BannerStack';
import { fleetSummary } from '../fleet/fleetSummary';
import { poolLagText } from '../fleet/poolLag';
import { unreadMailCount } from '../fleet/navBadges';
import { HotFilesStrip } from '../fleet/HotFilesStrip';
import { FleetCards } from '../fleet/FleetCards';
import { BucketBar } from '../fleet/BucketBar';
import { FleetHead } from '../fleet/FleetHead';
import { isRunClosed } from '../fleet/runWords';
import { useFleetChrome } from '../fleet/FleetChrome';
import { useFleetFlows } from '../fleet/FleetFlows';
import { navigate } from '../lib/router';
import { ackAll, acksSnapshot, prune, subscribeAcks } from '../lib/seen';
import { archivedSizeText, archivedSummary } from './ArchiveScreen';
import type { FleetStore } from '../stores/fleet';
import { CLASSES, type ModelClass } from '../../../shared/models';
import { useFrameSet } from '../skins/frame';
import '../fleet/fleet.css';

export function FleetScreen({
  store: storeProp,
  onOpen,
  onNewSession,
  selectedId = null,
  showAccounts = true,
  banners = true,
  headChrome = true,
  headCount = true,
  epoch,
  observedEpoch,
}: {
  /** Injectable for tests; it must be the host's own (`FleetChromeProvider store=`), which it defaults to. */
  store?: FleetStore;
  onOpen?: (id: string) => void;
  onNewSession?: () => void;
  selectedId?: string | null; // the open session, highlighted in the desktop sidebar
  showAccounts?: boolean; // false on desktop — the accounts strip is a top bar there
  /** False where the skin's frame places the banner stack under its bar (W2 Task S4b): one stack at any width. */
  banners?: boolean;
  /** False where the skin's bar holds the head's wordmark and doors (Refined's `Sidebar` and Instrument's
   *  `ListColumn` at a desk, W2 Task S4b, T2e); the readouts stay. */
  headChrome?: boolean;
  /** False where the skin's status bar prints the fleet's count (Instrument's `ListColumn` at a desk, T2g, D-6715):
   *  the head draws no count line. The pool lag stays. */
  headCount?: boolean;
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
  // The polls and the sheets' open state live above this screen (D-5468): in W2 a fleet list is a skin's part and
  // remounts on a skin switch, so an open sheet must outlive it, and a second reader must not start a second poll.
  // `FleetChromeProvider` holds them once for the shell and `FleetFlows` renders the sheets beside it (`app.tsx`).
  // The list reads the SAME store the sheets and planes act on: a different one would show one fleet and act on
  // another, silently, so it throws instead.
  const chrome = useFleetChrome();
  if (storeProp !== undefined && storeProp !== chrome.store) throw new Error('FleetScreen store is not the FleetChrome store');
  const store = storeProp ?? chrome.store;
  const useStore = store;
  const sessions = useStore((s) => s.sessions);
  const conn = useStore((s) => s.conn);

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
  const flows = useFleetFlows();
  const newSession = onNewSession ?? flows.openNewSession;
  // The `/api/projects` plane — rows, class, placement readers, the `+`'s
  // in-flight set and the pool sheet's selection — lives in its own hook
  // (`useProjectRows`), which is where its generation discipline and its two
  // deviations are argued; the chrome calls it once.
  const projects = chrome.projects;
  // The skin's own fleet list, when it has one (Instrument's table, W2 Task S10); none outside a frame or in Refined.
  const set = useFrameSet();
  const FleetList = set?.FleetList ?? null;
  // The skin's own head where this column holds the chrome (Refined's phone header, W2 Task S5), with the lane gauges
  // under it, so the strip below steps aside: one readout of the lanes at any width. And its own New session door.
  const Head = headChrome ? set?.Head ?? null : null;
  const Fab = set?.Fab ?? null;

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
  // One poll of /api/fleet/health feeds both the banner and BuildLine below
  // (spec §6) — the chrome owns it (D-5468) so neither issues its own request.
  // The same for /api/updates (centralised-update §13): ONE 60 s poll, its
  // view handed down to every reader of the inventory, none of which polls on
  // its own.
  const fleetHealth = chrome.health;
  const updates = chrome.updates;
  // Wave 19, R24(b): a later poll failed and the view is the last answer that landed; every reader below says so.
  const stale = updates.view !== null && updates.failure !== null;

  // `bucket`, not `dialogPending` — the LAST client-side re-derivation of the
  // attention bucket, and the one that sat directly above the bucket bar that
  // reads the server's answer. They disagreed on the same screen: the server
  // buckets a killed-but-still-dialogPending session `dead` (shared/api.ts's
  // ladder checks `status === 'dead'` first, and fleet.ts keeps ORing a stale
  // hook `waiting` into `dialogPending`), so this head said "1 waiting" while
  // the chip below it said "Dead 1" and the row said `exited`.
  // Counted by `fleetSummary`, the fleet's one count readout (W2 Task S2c), which every shell's readout renders
  // too. `null` runs: this head has never carried the runs part (the runs line below is their door).
  const countLine = fleetSummary(sessions, null).readout;

  // The feed's unread count: `unreadMailCount` (navBadges.ts), the one function every door that shows it reads (the
  // tabs of W2 Task S4b too). An `interrupt` record never counts (`raisesUnread`, D-5431).
  const feed = useStore((s) => s.feed);
  const unreadMail = unreadMailCount(feed, acks);

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
  const poolLag = poolLagText(epoch, observedEpoch);

  // Task 4: which card each run belongs on — the card its WORKER renders on —
  // is decided with every row's card by `fleetTree` (D-5527), from the whole
  // session list, because a card sees only its own rows and cannot answer it
  // (`runCard`'s docstring has the two fallbacks and why each is load-bearing).

  return (
    <section aria-label="Fleet" className="fleet" data-conn={conn}>
      {Head !== null ? <Head /> : (
        <FleetHead
          countLine={headCount && sessions.length > 0 ? countLine : null}
          poolLag={poolLag}
          unreadMail={unreadMail}
          chrome={headChrome}
        />
      )}
      {/* The global banners (W2 Task S2c's stack), here unless the skin's frame places them under its bar at a desk
          (Refined, W2 Task S4b): `banners` is false then, so one stack is mounted at any width. */}
      {banners && <FleetBanners />}

      {/* Its own poller, independent of `sessions` — it must render in EVERY
          branch below, not just the populated one. It used to sit only in
          the third (populated) arm, so a fresh fleet with zero sessions ever
          started (the first-run panel, mobile's only view of the strip)
          rendered no accounts strip at all — and at the time that was the
          app's only door to /accounts, gone in the exact state a new operator
          hits first. It is not the only door any more (the header control
          above, D-161); the rule that a door must never render nothing is
          unchanged. */}
      {showAccounts && Head === null && <AccountsStrip />}

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
        {/* `w-auto flex-none max-w-full`: a control sized to its own option
            list, not to the row. These REPLACE `Select`'s own `w-full`
            rather than outranking it — `cn` is tailwind-merge, so one width
            utility reaches the DOM and it is this one. The rule that shipped
            here instead (`.fleet-class-select { width: auto }`, one class
            against `.route-select`'s one, 650 lines earlier in the same
            sheet) lost the tie to source order and never applied once: the
            control rendered 286px instead of the 167px its widest option
            asks for, and the head overflowed the viewport by 225px at 390px.
            `fleet-css.test.ts` pins the mechanism that replaced it. */}
        <Select
          className="w-auto flex-none max-w-full"
          aria-label="Class"
          value={projects.classFilter}
          onChange={(e) => projects.chooseClass(e.target.value as '' | 'default' | ModelClass)}
        >
          <option value="">Coordinator row</option>
          <option value="default">Default</option>
          {[...CLASSES].reverse().map((c) => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </Select>
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

          {/* The list itself: the skin's own (Instrument's status-grouped table, W2 Task S10, D-5473), or the shared
              project cards (`FleetCards`), which that table also places in its project mode. */}
          {FleetList === null ? <FleetCards selectedId={selectedId} onOpen={open} /> : <FleetList />}
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

      {Fab !== null ? <Fab /> : (
        <button type="button" className="fab" aria-label="New session" onClick={newSession}>
          <span aria-hidden="true">+</span>
        </button>
      )}

      {/* Wave 19, D-5124: the four surfaces show the stale sentence; this one region announces it, once. */}
      <div className="sr-only" role="status">{stale ? UPDATES_STALE_TEXT : null}</div>
      <BuildLine health={fleetHealth} nodes={updates.view?.nodes ?? null} staleNote={stale ? UPDATES_STALE_TEXT : null} />
    </section>
  );
}

/** The fleet's global banners, through the one stack both shells place (W2 Task S2c, BannerStack.tsx): the first two
 *  that apply in rank order, every alert, and "+n more" for the rest. Each banner stays mounted and renders exactly as
 *  it did in the fleet column; `shows` is the module's own predicate. Takes no props: it reads the shell's chrome
 *  (D-5468), so the fleet column and a skin's frame (W2 Task S4b) place the same stack, and only one of them at a
 *  time does. */
export function FleetBanners(): ReactNode {
  const chrome = useFleetChrome();
  const useStore = chrome.store;
  const sessions = useStore((s) => s.sessions);
  const conn = useStore((s) => s.conn);
  const notices = useStore((s) => s.notices);
  const dismissNotice = useStore((s) => s.dismissNotice);
  const fleetHealth = chrome.health;
  const updates = chrome.updates;
  // Wave 19, R24(b): a later poll failed and the view is the last answer that landed; every banner says so.
  const stale = updates.view !== null && updates.failure !== null;
  // The passkey notice's posture, read once here for the stack's predicate and the notice alike.
  const passkeyStatus = usePasskeyStatus();
  return (
    <BannerStack
      items={[
        {
          id: 'fleet-host',
          shows: fleetHostBannerShows(fleetHealth),
          node: <FleetHostBanner health={fleetHealth} nodes={updates.view?.nodes ?? null} intent={updates.view?.intent ?? null} stale={stale} />,
        },
        // The halt, with each halting node's Ack in place (programme wave 14, R15(a)): above Update all, which it
        // disables while it stands. Re-polls on every Ack.
        {
          id: 'halt',
          shows: haltBannerShows(updates.view),
          node: <HaltBanner updates={updates.view} seq={updates.seq} onAcked={updates.reload} stale={stale} />,
        },
        {
          id: 'update',
          shows: updateBannerShows(updates.view),
          node: <UpdateBanner updates={updates.view} health={fleetHealth} onMoved={updates.reload} stale={stale} />,
        },
        // The substrate fault, said once (spec §4) — derived from the SAME injected store the rows render from,
        // so the banner and the chips can never disagree about which fleet they describe.
        { id: 'substrate', shows: substrateBannerShows(sessions), node: <SubstrateBanner store={useStore} /> },
        {
          id: 'offline',
          shows: conn === 'down',
          node: conn === 'down' && (
            <div className={`offline-banner ${ATTENTION_DOT}`} role="status">
              Reconnecting…
            </div>
          ),
        },
        // Cold start hydrated from the offline snapshot (lib/offline.ts): cards render instantly, clearly marked
        // stale until the socket opens.
        {
          id: 'connecting',
          shows: conn === 'connecting' && sessions.length > 0,
          node: conn === 'connecting' && sessions.length > 0 && (
            <div className={`offline-banner ${ATTENTION_DOT}`} role="status">
              Last known state — connecting…
            </div>
          ),
        },
        ...notices.map((n) => ({
          id: 'notice' as const,
          key: n.id,
          shows: true,
          node: (
            <div className="notice" role="status">
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
          ),
        })),
        // The passphrase-only notice (D-161) — renders ITSELF or nothing, from the box's own posture, so it is
        // in the stack unconditionally: every branch below needs it, and a first-run box with zero sessions is
        // the one most likely to have a gate armed and no passkey on it yet. Outside `showAccounts` too — that
        // flag is about which surface owns the accounts STRIP (top bar vs fleet list), and this is not it.
        { id: 'passkey', shows: passkeyNoticeShows(passkeyStatus), node: <PasskeyNotice status={passkeyStatus} /> },
      ]}
    />
  );
}
