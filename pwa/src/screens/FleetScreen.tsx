// Fleet screen (route `/`) — a thin renderer over the fleet store. Single
// column of project cards, each holding its sessions as compact lines,
// offline/notice banners, skeletons while the first snapshot is in flight, a
// friendly first-run block, and a floating "+" within thumb reach that opens
// the NewSessionSheet.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { NewSessionSheet } from '../fleet/NewSessionSheet';
import { AccountsStrip } from '../fleet/AccountsStrip';
import { FleetHostBanner } from '../fleet/FleetHostBanner';
import { NotificationBell } from '../fleet/NotificationBell';
import { groupFleet } from '../fleet/groupFleet';
import { ProjectCard } from '../fleet/ProjectCard';
import { SessionActionsSheet } from '../fleet/SessionActionsSheet';
import { useFolded } from '../fleet/foldState';
import { useProjectedHome } from '../fleet/useProjectedHome';
import { api, apiErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import { ReapSheet } from '../session/ReapSheet';
import { archivedSizeText, archivedSummary } from './ArchiveScreen';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import type { FleetSession } from '../../../shared/api';
import '../fleet/fleet.css';

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

  const waiting = sessions.filter((s) => s.dialogPending).length;
  const countLine =
    `${sessions.length} session${sessions.length === 1 ? '' : 's'}` +
    (waiting > 0 ? ` · ${waiting} waiting` : '');

  return (
    <main className="fleet" data-conn={conn}>
      <header className="fleet-head">
        <span className="wordmark">ccrc</span>
        <div className="fleet-head-right">
          {sessions.length > 0 && <span className="fleet-count">{countLine}</span>}
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
          {showAccounts && <AccountsStrip />}
          <div className="fleet-list">
            {groupFleet(sessions).map((g) => (
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
          {archived.count > 0 && (
            /* Folded, never hidden — and never a place that DELETES anything:
               this routes to a list, and every removal still goes through the
               audit and the fingerprint.

               The size half is `archivedSizeText`, shared with the archive
               screen's own total (fix round 3, P3): a fleet whose archives
               were never measured used to read "Archived · 3 · 0 B" — a
               stated total for three workspaces nobody sized — and a
               half-measured fleet stated its measured part as the whole. */
            <button type="button" className="fleet-archived-row" onClick={() => navigate('/archive')}>
              {`Archived · ${archived.count} · ${archivedSizeText(archived)}`}
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
