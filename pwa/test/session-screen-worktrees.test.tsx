// Desktop polish C48 (D-8782), review 2864 F2, F3 and F9: the REAL screen's wiring of the session's worktrees, store to details.
// The fleet list draws no worktree row; a session's own page lists the worktrees it started or holds, with the row's three
// controls. The cases open `SessionScreen` over a fleet store carrying the frame, so a screen that passes the wrong id to
// `leasesStartedBy`, or reads the frame some other way, goes red here (the section's own tests build their facts by hand).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';
import { frame, lease } from './delegationFixture';

// SessionScreen renders ChatList, and Virtuoso needs a real viewport jsdom does not have (the stand-in session-lifecycle uses).
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: { totalCount: number; itemContent: (i: number) => ReactNode; computeItemKey?: (i: number) => string | number }) =>
      React.createElement('div', { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) => React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i)))),
  };
});

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const makeStore = (id: string): SessionStore => createSessionStore(id, {
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  api: { prompt: vi.fn().mockResolvedValue(undefined) },
});
const makeFleet = (): FleetStore => {
  const store = createFleetStore();
  act(() => { store.setState({ roster: TEST_ROSTER }); });
  return store;
};

const coord = (over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a', name: 'coord-a', ...over });
const worker = fleetSession({ id: 'worker-a', project: 'project-a', workspace: 'worker-a', workdir: '/work/project-a/.ws/worker-a', name: 'worker-a' });

/** The screen of session `id` over `sessions` and a frame of `leases`, its details open. */
const openScreen = (id: string, sessions: FleetSession[], leases: ReturnType<typeof lease>[]): void => {
  const fleet = makeFleet();
  act(() => { fleet.setState({ sessions, delegation: frame({ leases }) }); });
  render(<SessionScreen id={id} store={makeStore(id)} fleet={fleet} />);
  const details = screen.queryByRole('button', { name: 'Session details' });
  if (details !== null && details.getAttribute('aria-expanded') === 'false') fireEvent.click(details);
};
/** A worktree whose path ends in its admin record, as Claude Code names them (a row says its path, H3, D-8875). */
const tree = (over: Parameters<typeof lease>[0] & { adminRecord: string }): ReturnType<typeof lease> =>
  lease({ canonicalPath: `/work/project-a/.claude/worktrees/${over.adminRecord}`, ...over });
const section = (): HTMLElement | null => document.querySelector<HTMLElement>('.sess-worktrees');
const rows = (): string[] => [...document.querySelectorAll('.sess-worktrees .proj-work')].map((r) => r.textContent ?? '');

describe('the session page lists the worktrees the session holds (D-8782)', () => {
  it('SW-S1: the coordinator\'s page lists its worktree with the three controls, and another session\'s worktree is not on it', () => {
    openScreen('coord-a', [coord(), worker], [
      tree({ leaseId: 'l-mine', parentId: 'coord-a', adminRecord: 'agent-mine', sourceKind: 'raw', disposition: 'retained', expiresAt: null }),
      tree({ leaseId: 'l-other', parentId: 'coord-b', adminRecord: 'agent-other' }),
    ]);
    const s = section();
    if (s === null) throw new Error('the page draws no worktree section');
    expect(within(s).getByText('Worktrees')).toBeTruthy();
    expect(rows().join('|')).toContain('agent-mine');
    expect(rows().join('|')).not.toContain('agent-other');
    // The controls this row offers are the card row's: Keep worktree and Not delegated (Attach to… needs an inferred row).
    expect(within(s).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Not delegated']));
  });

  it('SW-S2 (review 2864 F2, F9): an offline coordinator\'s own page lists the worktree it held, with its controls', () => {
    // The coordinator is archived (a listed session no longer live); the server filed its lease under the offline group.
    openScreen('coord-a', [coord({ archivedAt: Date.now() - 60_000 }), worker], [
      tree({ leaseId: 'l-held', parentId: 'coord-a', via: 'worker-a', group: 'offline-coordinator', adminRecord: 'agent-held',
        sourceKind: 'raw', disposition: 'ephemeral', expiresAt: null }),
    ]);
    expect(section(), 'the page draws the section').not.toBeNull();
    expect(rows().join('|')).toContain('agent-held');
    const names = within(section()!).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(expect.arrayContaining(['Keep worktree', 'Not delegated']));
  });

  it('SW-S3: the worker the lease is via lists it too, naming no worker (it is its own page)', () => {
    openScreen('worker-a', [coord(), worker], [tree({ leaseId: 'l-via', parentId: 'coord-a', via: 'worker-a', adminRecord: 'agent-via' })]);
    expect(rows().join('|')).toContain('agent-via');
    expect(rows().join('|')).not.toContain('via worker-a');
  });

  it('SW-S4 (rule 7): a lease whose path is a listed session\'s workdir is not on the page; the session\'s own row is the honest one', () => {
    openScreen('coord-a', [coord(), worker], [
      tree({ leaseId: 'l-ws', parentId: 'coord-a', via: 'worker-a', adminRecord: 'agent-ws', canonicalPath: worker.workdir }),
      tree({ leaseId: 'l-real', parentId: 'coord-a', adminRecord: 'agent-real' }),
    ]);
    expect(rows().join('|')).toContain('agent-real');
    expect(rows().join('|')).not.toContain('agent-ws');
  });

  it('SW-S5: a session that holds no worktree draws no section, and a frame with none draws none', () => {
    openScreen('coord-a', [coord(), worker], []);
    expect(section()).toBeNull();
    cleanup();
    openScreen('coord-a', [coord(), worker], [lease({ leaseId: 'l-other', parentId: 'coord-b' })]);
    expect(section()).toBeNull();
  });
});
