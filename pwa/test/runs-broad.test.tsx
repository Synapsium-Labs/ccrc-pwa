// The broad pane (the runs rebuild, Task 9a, D-8072; spec 2026-11-04 §8.1, §8.4, A9, A51): at a broad column the board and the
// run sit side by side; narrower, /runs/<id> is the run's page with its strip. The column width is the stubbed `clientWidth`.
// Placeholders only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CoordCapsView, RunSummary } from '../../shared/api';
import { ApiError, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { clearScreenCache } from '../src/lib/screenCache';
import { RunsScreen } from './runs-board';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

const NOW = Date.now();
const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: 'sess-a', workspace: 'ws-a', branch: 'ws/a', state: 'working', kind: 'work', reviews: null, claimedBy: 'sess-coord',
  resumed: false, clearedAt: null, openedAt: NOW - 1_000_000, dispatchStartedAt: null, dispatchedAt: NOW - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 1, total: 2 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true,
    clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});

const store = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

let width = 1300;
beforeEach(() => {
  navigate('/runs', { replace: true });
  clearScreenCache();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList?.contains('runs-column') ? width : 0; } });
  const r = run(410);
  vi.spyOn(api, 'runRecord').mockImplementation(async (id: number) => ({ ok: true, run: run(id), events: [], reviewedBy: [], olderEvents: 0 }) as never);
  vi.spyOn(api, 'run').mockImplementation(async (id: number) => ({ ok: true, run: run(id), spend: { measured: false, reason: 'no-sweep' } }) as never);
  vi.spyOn(api, 'runItems').mockResolvedValue({ ok: true, items: [] } as never);
  vi.spyOn(api, 'runSignals').mockRejectedValue(new ApiError(404, { ok: false }));
  vi.spyOn(api, 'goals').mockRejectedValue(new ApiError(404, { ok: false }));
  vi.spyOn(api, 'findRuns').mockResolvedValue({ ok: true, exact: null, runs: [], reviewsOf: [] } as never);
  void r;
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
  history.replaceState(null, '', '/');
});

function mount(path: string, live: RunSummary[] = [run(410), run(411)]) {
  const s = store();
  act(() => { s.setState({ runs: live, runsFrameSeen: true, sessions: [], fleetFrameSeen: true }); });
  navigate(path, { replace: true });
  const open = /^\/runs\/(\d+)/.exec(path);
  const r = render(<RunsScreen store={s} loadRuns={async () => ({ ok: true, runs: [], nextBefore: null }) as never} loadCaps={NO_CAPS}
    openId={open === null ? null : Number(open[1])} />);
  return { ...r, s };
}
const rowOf = (id: number): HTMLElement => document.querySelector<HTMLElement>(`.run-row[title^="run ${id}"]`)!;

describe('a broad column', () => {
  it('/runs with no run open reads Select a run to see it here.', async () => {
    mount('/runs');
    expect(await screen.findByText('Select a run to see it here.')).toBeInTheDocument();
    expect(document.querySelector('.runs-column')).toHaveAttribute('data-column', 'broad');
  });
  it('a cold /runs/410 draws the list and the pane', async () => {
    mount('/runs/410');
    const pane = document.querySelector<HTMLElement>('.runs-detail-pane')!;
    await within(pane).findByRole('heading', { level: 2, name: 'Run 410' });
    expect(rowOf(411)).not.toBeNull();
  });
  it('a row opens in the right pane and the URL becomes /runs/<id>', async () => {
    const { rerender, s } = mount('/runs');
    await screen.findByText('Select a run to see it here.');
    fireEvent.click(rowOf(411).querySelector('.run-open')!);
    expect(location.pathname).toBe('/runs/411');
    rerender(<RunsScreen store={s} loadRuns={async () => ({ ok: true, runs: [], nextBefore: null }) as never} loadCaps={NO_CAPS} openId={411} />);
    await within(document.querySelector<HTMLElement>('.runs-detail-pane')!).findByRole('heading', { level: 2, name: 'Run 411' });
    expect(rowOf(410)).not.toBeNull();
  });
  it('the pane has no strip and no Back', async () => {
    mount('/runs/410');
    await within(document.querySelector<HTMLElement>('.runs-detail-pane')!).findByRole('heading', { name: 'Run 410' });
    const pane = document.querySelector<HTMLElement>('.runs-detail-pane')!;
    expect(pane.querySelector('.rd-strip')).toBeNull();
    expect(within(pane).queryByRole('navigation')).toBeNull();
    expect(within(pane).queryByText(/Back to/)).toBeNull();
  });
  it('the open row is marked current', async () => {
    mount('/runs/410');
    await screen.findByRole('heading', { name: 'Run 410' });
    expect(rowOf(410).querySelector('.run-open')).toHaveAttribute('aria-current', 'true');
    expect(rowOf(411).querySelector('.run-open')).not.toHaveAttribute('aria-current');
  });
  it('/runs/410?q=x keeps the results in the list, and a result opens in the pane', async () => {
    mount('/runs/410?q=prog');
    await screen.findByRole('region', { name: 'Search results' });
    const pane = document.querySelector<HTMLElement>('.runs-detail-pane')!;
    await within(pane).findByRole('heading', { name: 'Run 410' });
    const link = within(screen.getByRole('region', { name: 'Search results' })).getByRole('link', { name: /Run 411/ });
    expect(link.getAttribute('href')).toBe('/runs/411?q=prog');
    expect(within(screen.getByRole('region', { name: 'Search results' })).getByRole('link', { name: /Run 410/ })).toHaveAttribute('aria-current', 'true');
  });
});

describe('narrower than broad', () => {
  it('the same URL is a page with its strip, and the board is not drawn', async () => {
    width = 900;
    mount('/runs/410');
    await screen.findByRole('heading', { level: 1, name: 'Run 410' });
    expect(document.querySelector('.runs-column')).toHaveAttribute('data-column', 'medium');
    expect(screen.getByRole('navigation', { name: /./ })).toBeInTheDocument();
    expect(document.querySelector('.runs-detail-pane')).toBeNull();
    await waitFor(() => expect(document.querySelector('.run-row')).toBeNull());
    width = 1300;
  });
});
