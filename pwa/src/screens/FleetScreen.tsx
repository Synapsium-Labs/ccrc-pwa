// Fleet screen (route `/`) — a thin renderer over the fleet store. Single
// column of session cards, offline/notice banners, skeletons while the first
// snapshot is in flight, a friendly first-run block, and a floating "+"
// within thumb reach that opens the NewSessionSheet.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { NewSessionSheet } from '../fleet/NewSessionSheet';
import { AccountsStrip } from '../fleet/AccountsStrip';
import { FleetHostBanner } from '../fleet/FleetHostBanner';
import { NotificationBell } from '../fleet/NotificationBell';
import { groupFleet } from '../fleet/groupFleet';
import { ProjectGroup } from '../fleet/ProjectGroup';
import { api, apiErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import { useFleetStore, type FleetStore } from '../stores/fleet';
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
  const addWorkspace = async (project: string): Promise<void> => {
    try {
      await api.workspaceAdd(project);
    } catch (err) {
      toast(`Couldn't create workspace — ${apiErrorText(err)}`, 'error');
    }
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
              <ProjectGroup
                key={g.project}
                group={g}
                onOpen={open}
                selectedId={selectedId}
                onAddWorkspace={(p) => void addWorkspace(p)}
              />
            ))}
          </div>
        </>
      )}

      <button type="button" className="fab" aria-label="New session" onClick={newSession}>
        <span aria-hidden="true">+</span>
      </button>

      <NewSessionSheet open={newOpen} onClose={() => setNewOpen(false)} fleet={store} />
    </main>
  );
}
