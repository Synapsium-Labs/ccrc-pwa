// The in-flight guard of "Archive all" (workspace lifecycle spec §5.1), pinned.
//
// `useArchiveAll`'s `run` (src/fleet/ArchiveAllPlane.tsx, lifted out of FleetScreen with its whole flow) refuses a
// second call for a project whose loop is already running, through a REF
// (a second call from the same render would read stale state). The real QuickConfirm cannot reach it under jsdom: the
// sheet unmounts before a second click lands. So this file stubs QuickConfirm with a confirm that fires `onConfirm`
// twice in ONE synchronous handler — the phone's double tap, collapsed to its essence. It is a separate file because
// `vi.mock` is hoisted file-wide and must not touch the real-sheet cases in fleet-screen.test.tsx.
// Delete the guard (`if (archivingRef.current.has(project)) return;`) and this goes red: the first assertion to fail is the duplicate summary toast (`findByText` sees two "Archived 2, skipped 0, refused 0." toasts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession, UpdatesView } from '../../shared/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { ToastHost } from '@ccrc/ui';

// QuickConfirm lives in @ccrc/ui now, so the mock moved with it — and it is a
// PARTIAL mock via `importOriginal`: this file also renders a real ToastHost
// and FleetScreen pulls Button, Skeleton, Door and BuildLine from the same
// package, so a wholesale factory would blank all of them.
vi.mock('@ccrc/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ccrc/ui')>()),
  // Mirrors the real prop contract: nothing when closed; when open, one button that confirms. The real one calls
  // `onConfirm()` then `onClose()` once; this one calls `onConfirm()` TWICE, then closes.
  QuickConfirm: (p: { open: boolean; confirmLabel: string; onConfirm: () => void; onClose: () => void }) =>
    p.open
      ? <button type="button" onClick={() => { p.onConfirm(); p.onConfirm(); p.onClose(); }}>{p.confirmLabel}</button>
      : null,
}));

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MIN = 60_000;

const session = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude:OpenClawHetzner',
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/home/rc/projects/OpenClawHetzner',
  workspace: null,
  name: null,
  status: 'idle',
  statusUpdatedAt: Date.now() - 2 * MIN,
  limits: { five: 10, seven: 40 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null,
  version: '2.1.0',
  ...over,
});

const makeStore = (): FleetStore =>
  createFleetStore({
    makeSocket: () =>
      ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });

const rel = (closedAt: number) =>
  ({ runId: closedAt, program: 'lifecycle', programTitle: null, claimedBy: 'coord', closedAt, child: false });

describe("Archive all's in-flight guard (workspace lifecycle spec §5.1)", () => {
  it('a confirm that fires twice in one tick runs ONE loop: each row is archived once, not twice', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    const archive = vi.spyOn(api, 'archive').mockResolvedValue(null);
    const store = makeStore();
    render(<><FleetScreen store={store} /><ToastHost /></>);
    act(() => {
      store.setState({
        conn: 'open',
        sessions: [
          session({ id: 'a-one', project: 'alpha', workspace: 'one', bucket: 'idle', releasedFrom: rel(300) }),
          session({ id: 'a-two', project: 'alpha', workspace: 'two', bucket: 'idle', releasedFrom: rel(200) }),
        ],
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: /released \(2\)/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive all 2 released workspaces in alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive 2' }));
    expect(await screen.findByText('Archived 2, skipped 0, refused 0.')).toBeInTheDocument();
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(2));
    expect(archive.mock.calls).toEqual([['a-one'], ['a-two']]);
  });
});
