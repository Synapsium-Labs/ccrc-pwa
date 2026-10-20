// The Settings frame's reads, made once (settings spec §4.4, D-5504).
//
// ONE OWNER FOR EVERY SETTINGS READ. Today's single page made each read in the section that showed it; five pages and
// an index that shows every section's status would make each read once per page, and twice where the index and a
// page are both on screen (Refined's nav, Instrument's list column). So the reads move here, above the frame, and
// every section, the index and its status lines read the one `SettingsView` this publishes. No file under
// `screens/settings/` but this one imports a read hook or `lib/push`'s reads (`settings-frame.test.tsx`'s scan).
//
// MOUNTED UNCONDITIONALLY, with `active` (§4.4). `app.tsx` holds it around the whole shell, on every route: a provider
// that appeared only on Settings routes would change the element tree above `.app-shell`, so React would remount the
// frame on every entry to and exit from Settings, losing the sidebar's scroll (D-161) and S2b's frame identity
// (`app.test.tsx` pins both). While `active` is false the context is null and nothing reads: the reads live in
// `SettingsReads`, a sibling that mounts when `active` turns true (its hooks start) and unmounts when it turns false
// (their effects stop), and that hands its view up. Its slot is the first child and `children` always the second,
// so the shell below never moves.
//
// The cadences are today's (§4.4's table): the updates and stall watch polls, the collector read, the coord frame's
// cleanup pause (a WebSocket frame, not a request), the auth status once per mount, and the push state when Settings
// opens and again whenever the index mounts (`rereadPush`), so a toggle on the Notifications page shows on the index
// after Back.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthStatus, MarkerState } from '../../../../shared/api';
import { childReclaimMarker } from '../../fleet/childReclaimWords';
import { useCollectLaneView, type CollectLanePoll } from '../../fleet/useCollectLaneView';
import { useLinearConnection, type LinearPoll } from '../../fleet/useLinearConnection';
import { useStallWatchView, type StallWatchPoll } from '../../fleet/useStallWatchView';
import { useUpdatesView, type UpdatesPoll } from '../../fleet/useUpdatesView';
import { readAuthStatus } from '../../lib/auth';
import { pushEnabled, pushSupported } from '../../lib/push';
import { useFleetStore } from '../../stores/fleet';

/** The auth status read: not landed, failed (an older server, a proxy's 404, no network), or its answer. */
export type AuthRead = { kind: 'pending' } | { kind: 'failed' } | { kind: 'read'; status: Partial<AuthStatus> };

/** This browser's push state: the Bell's own reads, plus the permission for "blocked". `unsupported` is never `off`. */
export type PushState = 'pending' | 'unsupported' | 'blocked' | 'on' | 'off' | 'failed';

/** The cleanup pause, from the coord frame: a skeleton until the first frame lands, then its marker (null for a
 *  server older than the switch). */
export type PauseRead = { kind: 'pending' } | { kind: 'read'; marker: MarkerState | null };

export interface SettingsView {
  readonly updates: UpdatesPoll;
  readonly stall: StallWatchPoll;
  readonly collect: CollectLanePoll;
  /** The Linear connection (named workspaces S4b), shown on the Security page; read when the page becomes visible, not polled. */
  readonly linear: LinearPoll;
  readonly pause: PauseRead;
  readonly auth: AuthRead;
  readonly push: PushState;
  /** Read the push state again (the index calls it when it mounts). */
  readonly rereadPush: () => void;
}

const SettingsViewContext = createContext<SettingsView | null>(null);

/** The one view, or null off Settings (and before the reads have mounted). */
export function useSettingsView(): SettingsView | null {
  return useContext(SettingsViewContext);
}

/** Async, once per ask: unsupported first, then a blocked permission, then the subscription itself. */
async function readPush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return 'blocked';
  return (await pushEnabled()) ? 'on' : 'off';
}

function SettingsReads({ onView }: { onView: (view: SettingsView | null) => void }): null {
  // Each hook answers a fresh object per render, so each is held by its fields: the view changes only when a read
  // does, and handing it up never loops.
  const u = useUpdatesView();
  const updates = useMemo<UpdatesPoll>(
    () => ({ view: u.view, failure: u.failure, seq: u.seq, reload: u.reload }), [u.view, u.failure, u.seq, u.reload]);
  const st = useStallWatchView();
  const stall = useMemo<StallWatchPoll>(
    () => ({ view: st.view, failure: st.failure, reload: st.reload, settle: st.settle }),
    [st.view, st.failure, st.reload, st.settle]);
  const c = useCollectLaneView();
  const collect = useMemo<CollectLanePoll>(
    () => ({ view: c.view, failure: c.failure, reload: c.reload, settle: c.settle }),
    [c.view, c.failure, c.reload, c.settle]);
  const l = useLinearConnection();
  const linear = useMemo<LinearPoll>(
    () => ({ view: l.view, failure: l.failure, reload: l.reload, settle: l.settle }), [l.view, l.failure, l.reload, l.settle]);
  const coord = useFleetStore((s) => s.coord);
  const coordFrameSeen = useFleetStore((s) => s.coordFrameSeen);
  const marker = coordFrameSeen ? childReclaimMarker(coord) : null;
  const pause = useMemo<PauseRead>(
    () => (coordFrameSeen ? { kind: 'read', marker } : { kind: 'pending' }), [coordFrameSeen, marker]);

  const [auth, setAuth] = useState<AuthRead>({ kind: 'pending' });
  useEffect(() => {
    let live = true;
    void readAuthStatus().then(
      (status) => { if (live) setAuth({ kind: 'read', status }); },
      () => { if (live) setAuth({ kind: 'failed' }); },
    );
    return () => { live = false; };
  }, []);

  // Unsupported is known at once (no await), so a page never draws the Bell's row for a browser that has none.
  const [push, setPush] = useState<PushState>(() => (pushSupported() ? 'pending' : 'unsupported'));
  const [pushAsk, setPushAsk] = useState(0);
  useEffect(() => {
    let live = true;
    void readPush().then(
      (state) => { if (live) setPush(state); },
      () => { if (live) setPush('failed'); },
    );
    return () => { live = false; };
  }, [pushAsk]);
  const rereadPush = useCallback(() => setPushAsk((n) => n + 1), []);

  const view = useMemo<SettingsView>(
    () => ({ updates, stall, collect, linear, pause, auth, push, rereadPush }),
    [updates, stall, collect, linear, pause, auth, push, rereadPush],
  );
  // A layout effect, so the frame's first paint on Settings already has the view.
  useLayoutEffect(() => { onView(view); }, [view, onView]);
  useLayoutEffect(() => () => onView(null), [onView]);
  return null;
}

export function SettingsDataProvider({ active, children }: { active: boolean; children?: ReactNode }): ReactNode {
  const [view, setView] = useState<SettingsView | null>(null);
  return (
    <SettingsViewContext.Provider value={active ? view : null}>
      {active ? <SettingsReads onView={setView} /> : null}
      {children}
    </SettingsViewContext.Provider>
  );
}
