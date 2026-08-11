// Fleet screen (route `/`) — a thin renderer over the fleet store. Single
// column of project cards, each holding its sessions as compact lines,
// offline/notice banners, skeletons while the first snapshot is in flight, a
// friendly first-run block, and a floating "+" within thumb reach that opens
// the NewSessionSheet.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { NewSessionSheet } from '../fleet/NewSessionSheet';
import { AccountsStrip } from '../fleet/AccountsStrip';
import { FleetHostBanner } from '../fleet/FleetHostBanner';
import { MailBadge } from '../fleet/MailBadge';
import { NotificationBell } from '../fleet/NotificationBell';
import { groupFleet } from '../fleet/groupFleet';
import { ProjectCard } from '../fleet/ProjectCard';
import { SessionActionsSheet } from '../fleet/SessionActionsSheet';
import { BUCKET_ORDER } from '../fleet/sortFleet';
import { runClosedAt } from '../fleet/runWords';
import { useFolded } from '../fleet/foldState';
import { useProjectedHome } from '../fleet/useProjectedHome';
import { api, apiErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import { ackAll, acksSnapshot, FEED_ACK_KEY, isUnseen, isUnseenAt, prune, subscribeAcks } from '../lib/seen';
import { ReapSheet } from '../session/ReapSheet';
import { archivedSizeText, archivedSummary } from './ArchiveScreen';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import type { FleetSession } from '../../../shared/api';
import '../fleet/fleet.css';

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
}: {
  store?: FleetStore; // injectable for tests
  onOpen?: (id: string) => void;
  onNewSession?: () => void;
  selectedId?: string | null; // the open session, highlighted in the desktop sidebar
  showAccounts?: boolean; // false on desktop — the accounts strip is a top bar there
}): ReactNode {
  const useStore = store;
  const sessions = useStore((s) => s.sessions);
  const conn = useStore((s) => s.conn);
  const notices = useStore((s) => s.notices);
  const dismissNotice = useStore((s) => s.dismissNotice);

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

  // The fleet socket is the source of truth: no optimistic row here — the new
  // session appears on the next snapshot, so a refusal (e.g. no origin/HEAD)
  // never briefly shows a workspace that ccd declined to create.
  //
  // In-flight per PROJECT, because ccd does not dedupe: ws-add draws a fresh
  // random slug on every call and only checks it against the registry, so two
  // concurrent calls both succeed — two worktrees, two branches, two systemd
  // units, two of three account lanes consumed. And the window is not a
  // moment: _spawn runs synchronously and _accept_first_run_prompts waits up to
  // ~15 minutes for a big resume, with nothing on screen to say so.
  const [adding, setAdding] = useState<ReadonlySet<string>>(() => new Set());
  const addWorkspace = async (project: string): Promise<void> => {
    if (adding.has(project)) return;
    setAdding((s) => new Set(s).add(project));
    try {
      await api.workspaceAdd(project);
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
  // Build 7's run board footer. `closedAt === null` is "IS finished"'s own
  // negation (RunSummary's own docstring on that field) — the same split
  // RunsScreen itself uses to separate its active/finished groups, through
  // the same `runClosedAt` tolerance helper (a row that OMITS `closedAt`
  // reads as active here too, not undercounted by a bare `=== null`).
  const activeRuns = useStore((s) => s.runs).filter((r) => runClosedAt(r) === null).length;
  // Fold state persists across navigation (foldState.ts) — useState here would
  // re-expand every project on the way back from a session.
  const [folded, toggleFold] = useFolded();
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

  return (
    <main className="fleet" data-conn={conn}>
      <header className="fleet-head">
        <span className="wordmark">ccrc</span>
        <div className="fleet-head-right">
          {sessions.length > 0 && <span className="fleet-count">{countLine}</span>}
          <MailBadge unread={unreadMail} />
          <NotificationBell />
        </div>
      </header>

      <FleetHostBanner />

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
          rendered no accounts strip at all — the app's only door to
          /accounts, gone in the exact state a new operator hits first. */}
      {showAccounts && <AccountsStrip />}

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
            {groupFleet(sessions, acks).map((g) => (
              <ProjectCard
                key={g.project}
                group={g}
                onOpen={open}
                selectedId={selectedId}
                onAddWorkspace={(p) => void addWorkspace(p)}
                projected={projected}
                adding={adding.has(g.project)}
                collapsed={folded.has(g.project)}
                onToggle={toggleFold}
                onActions={openActionsFor}
                /* INVERTED against the project fold on purpose: foldState
                   stores what is COLLAPSED, so absence means open — right for
                   a project, wrong for an archive fold that must start
                   closed. Under this composite key, presence means EXPANDED. */
                archivedOpen={folded.has(`${g.project}::archived`)}
              />
            ))}
          </div>
          {/* The only door to /runs, so it renders whenever this arm does —
              including with nothing running. `.fleet-archived-row` may come and go
              with its own count because /archive has a second route in from every
              project card's sub-fold; this one has no second route. */}
          <button
            type="button"
            className="fleet-runs-row"
            aria-label={activeRuns > 0 ? `Runs · ${activeRuns} active` : 'Runs · none active'}
            onClick={() => navigate('/runs')}
          >
            Runs · {activeRuns > 0 ? `${activeRuns} active` : 'none active'}
          </button>
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
    </main>
  );
}
