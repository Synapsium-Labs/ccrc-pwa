// The Stuck band on the board (D-8074; spec 2026-11-04 §8.2, §8.2.1; wave B4 Task 13): the heads in their fixed order, folded
// by default and remembered per viewer, their oldest age against their rows', the held-back line, the group control's words,
// Abandon on stuck rows alone, and no healthy run above the band.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RunStuck, RunSummary, StuckCause, StuckReason } from '../../shared/api';
import { RunsScreen } from './runs-board';
import { fleetSession } from './fleetFixture';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.now();

beforeEach(() => { try { window.localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: `programme-${id}`, programTitle: `Programme ${id}`,
  wave: 2, waveOf: 4, project: 'project-a', homeProject: null,
  sessionId: null, workspace: null, branch: null,
  state: 'planned', kind: 'work', reviews: null,
  claimedBy: 'project-a-coordinator', resumed: false, clearedAt: null,
  openedAt: NOW - 3 * H, dispatchStartedAt: null, dispatchedAt: null, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
            clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});

const stuckRun = (id: number, reason: StuckReason, cause: StuckCause | null, ago: number, over: Partial<RunSummary> = {},
  closes: RunStuck['closes'] = null): RunSummary =>
  run(id, { stuck: { reason, cause, since: NOW - ago, closes }, ...over });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

async function board(active: RunSummary[]): Promise<HTMLElement> {
  const store = makeStore();
  act(() => { store.setState({ runs: active, runsFrameSeen: true, fleetFrameSeen: true, conn: 'open', sessions: [] }); });
  const load = vi.fn().mockResolvedValue({ runs: [] });
  const { container } = render(<RunsScreen store={store} loadRuns={load} />);
  await act(async () => { await Promise.resolve(); });
  return container;
}

const headNames = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('.stuck-head-name')].map((n) => n.textContent ?? '');
const toggle = (name: string): HTMLElement => screen.getByRole('button', { name: new RegExp(`^${name}`) });

const MIXED = (): RunSummary[] => [
  stuckRun(1, 'never-started', null, 23 * D),
  stuckRun(2, 'owner-gone', 'coordinator-archived', 49 * D),
  stuckRun(3, 'review-of-closed', 'target-closed', 30 * D, { kind: 'review', reviews: 9 }),
  stuckRun(4, 'overtaken', null, 28 * D),
  stuckRun(5, 'start-never-landed', null, 8 * D, { workspace: 'lane-a', sessionId: 'project-a-lane-a' }),
];

describe('the heads', () => {
  it('keep a fixed order whatever their sizes, and the heads fold by default', async () => {
    const c = await board([...MIXED(), stuckRun(6, 'overtaken', null, 2 * D), stuckRun(7, 'overtaken', null, 3 * D)]);
    expect(headNames(c)).toEqual([
      'Review of finished work', 'Overtaken by later waves', 'Owner gone', 'Start never finished', 'Never started',
    ]);
    expect(c.querySelectorAll('li.run-stuck')).toHaveLength(0);
    for (const b of c.querySelectorAll('.stuck-head-toggle')) expect(b).toHaveAttribute('aria-expanded', 'false');
  });

  it('heads keep the fixed order when Review falls to 1', async () => {
    const c = await board([
      stuckRun(1, 'review-of-closed', 'target-closed', 3 * D, { kind: 'review', reviews: 9 }),
      stuckRun(2, 'overtaken', null, 5 * D), stuckRun(3, 'overtaken', null, 6 * D), stuckRun(4, 'overtaken', null, 7 * D),
    ]);
    expect(headNames(c)).toEqual(['Review of finished work', 'Overtaken by later waves']);
  });

  it('an empty head leaves and nothing else moves', async () => {
    const c = await board(MIXED().filter((r) => r.stuck!.reason !== 'owner-gone'));
    expect(headNames(c)).toEqual(['Review of finished work', 'Overtaken by later waves', 'Start never finished', 'Never started']);
  });

  it('the band title counts every stuck run', async () => {
    await board(MIXED());
    expect(screen.getByRole('heading', { name: 'Stuck · 5' })).toBeInTheDocument();
    expect(screen.getByText('Nothing is moving these. Each says why, and whether ccrc will close it.')).toBeInTheDocument();
  });

  it('an opened head is remembered per viewer', async () => {
    let c = await board(MIXED());
    fireEvent.click(toggle('Owner gone'));
    expect(toggle('Owner gone')).toHaveAttribute('aria-expanded', 'true');
    expect(c.querySelectorAll('li.run-stuck')).toHaveLength(1);
    cleanup();
    c = await board(MIXED());
    expect(toggle('Owner gone')).toHaveAttribute('aria-expanded', 'true');
    expect(toggle('Overtaken')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle('Owner gone'));
    cleanup();
    c = await board(MIXED());
    expect(c.querySelectorAll('li.run-stuck')).toHaveLength(0);
  });

  it('a head\'s oldest equals the largest age its rows show, for every reason, in whole days and in hours under a day', async () => {
    const reasons: [StuckReason, StuckCause | null][] = [
      ['review-of-closed', 'target-closed'], ['overtaken', null], ['owner-gone', 'coordinator-gone'],
      ['start-never-landed', null], ['never-started', null],
    ];
    for (const ago of [5 * H, 2 * D + 7 * H, 49 * D]) {
      cleanup();
      const runs = reasons.flatMap(([reason, cause], i) => [
        stuckRun(10 + i * 2, reason, cause, ago), stuckRun(11 + i * 2, reason, cause, Math.floor(ago / 2)),
      ]);
      const c = await board(runs);
      for (const reason of reasons.map(([r]) => r)) {
        const group = c.querySelector(`.stuck-group[data-reason="${reason}"]`)!;
        const toggleBtn = group.querySelector<HTMLElement>('.stuck-head-toggle')!;
        if (toggleBtn.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggleBtn);
        const oldest = group.querySelector('.stuck-head-oldest')!.textContent!.replace('· oldest ', '');
        const lines = [...group.querySelectorAll('.run-stuck-line')].map((l) => l.textContent!);
        expect(lines.some((l) => l.includes(`${oldest} ago`)), `${reason} at ${ago}: ${oldest} in ${lines.join(' | ')}`).toBe(true);
      }
      expect(c.querySelector('.stuck-head-oldest')!.textContent).toMatch(ago < D ? /\d+ h$/ : /\d+ days?$/);
    }
  });
});

describe('the group control and the held-back line', () => {
  it('a head of two free runs reads Abandon 2…, not Abandon all 2…', async () => {
    await board([stuckRun(1, 'never-started', null, 9 * D), stuckRun(2, 'never-started', null, 8 * D)]);
    expect(screen.getByRole('button', { name: 'Abandon 2…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abandon all/ })).toBeNull();
  });

  it('a head of three free runs reads Abandon all 3…', async () => {
    await board([1, 2, 3].map((i) => stuckRun(i, 'overtaken', null, (5 + i) * D)));
    expect(screen.getByRole('button', { name: 'Abandon all 3…' })).toBeInTheDocument();
  });

  it('counts only what may go in bulk and says why the rest are held back', async () => {
    const held = (id: number) => stuckRun(id, 'owner-gone', 'coordinator-stopped', 9 * D, { workspace: `lane-${id}`, sessionId: `s-${id}` });
    const c = await board([held(1), held(2), held(3), stuckRun(4, 'owner-gone', 'coordinator-gone', 9 * D), stuckRun(5, 'owner-gone', 'coordinator-gone', 9 * D)]);
    expect(screen.getByRole('button', { name: 'Abandon 2…' })).toBeInTheDocument();
    expect(within(c.querySelector('.stuck-group[data-reason="owner-gone"]')!).getByText('3 hold a workspace or session: one at a time')).toBeInTheDocument();
  });

  it('Start never finished shows the held-back line and no control', async () => {
    const c = await board([1, 2].map((i) => stuckRun(i, 'start-never-landed', null, 8 * D, { workspace: `lane-${i}`, sessionId: `s-${i}` })));
    const group = c.querySelector('.stuck-group[data-reason="start-never-landed"]')!;
    expect(within(group as HTMLElement).getByText('2 hold a workspace or session: one at a time')).toBeInTheDocument();
    expect(group.querySelector('.stuck-head-group')).toBeNull();
  });

  it('one held-back run reads in the singular', async () => {
    await board([stuckRun(1, 'start-never-landed', null, 8 * D, { workspace: 'lane-a' })]);
    expect(screen.getByText('1 holds a workspace or session: one at a time')).toBeInTheDocument();
  });

  it('the group control is a live tap: with one free run it opens that run\'s sheet (Task 14)', async () => {
    await board([stuckRun(1, 'never-started', null, 9 * D)]);
    const control = screen.getByRole('button', { name: 'Abandon 1…' });
    expect(control).toBeEnabled();
    fireEvent.click(control);
    expect(await screen.findByText('Abandon run 1?')).toBeInTheDocument();
  });
});

describe('the rows', () => {
  it('a stuck row reads the lamp, the stuck word, the name, the line and the one marker', async () => {
    const c = await board([stuckRun(3, 'review-of-closed', 'target-closed', 30 * D,
      { kind: 'review', wave: 6, sessionId: 'project-a-lane-a' })]);
    fireEvent.click(toggle('Review of finished work'));
    const row = c.querySelector<HTMLElement>('li.run-stuck')!;
    expect(row.querySelector('.run-state')!.textContent).toBe('stuck');
    expect(row.querySelector('.run-name')!.textContent).toBe('Programme 3 · review of wave 6');
    expect(row.querySelector('.run-stuck-line')!.textContent).toBe('The work it reviews closed 30 days ago · Nothing closes this on its own');
    expect(row.querySelectorAll('.run-marker')).toHaveLength(1);
    expect(row.querySelector('.run-marker')!.textContent).toBe('holds a session');
  });

  it('a shadow clock reads would close, an armed one reads closes, and none reads nothing closes', async () => {
    const c = await board([
      stuckRun(1, 'overtaken', null, 9 * D, {}, { at: NOW + 20 * H, armed: false }),
      stuckRun(2, 'overtaken', null, 8 * D, {}, { at: NOW + 20 * H, armed: true }),
      stuckRun(3, 'overtaken', null, 7 * D),
    ]);
    fireEvent.click(toggle('Overtaken'));
    const lines = [...c.querySelectorAll('.run-stuck-line')].map((l) => l.textContent);
    expect(lines.some((l) => l!.endsWith('ccrc would close this in 20 h'))).toBe(true);
    expect(lines.some((l) => l!.endsWith('ccrc closes this in 20 h'))).toBe(true);
    expect(lines.some((l) => l!.endsWith('Nothing closes this on its own'))).toBe(true);
    // Before auto-close exists no row says would-close (check 2).
    cleanup();
    const c2 = await board([stuckRun(1, 'overtaken', null, 9 * D), stuckRun(2, 'overtaken', null, 8 * D)]);
    fireEvent.click(toggle('Overtaken'));
    expect(c2.textContent).not.toMatch(/would close/);
  });

  it('Abandon sits only on stuck rows, and opens the sheet for that run', async () => {
    const c = await board([stuckRun(1, 'overtaken', null, 9 * D), run(2, { state: 'working', sessionId: 's', workspace: 'w' })]);
    expect(screen.queryByRole('button', { name: 'Abandon run 2' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abandon run 1' })).toBeNull();
    fireEvent.click(toggle('Overtaken'));
    expect(c.querySelectorAll('.run-abandon')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Abandon run 1' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('the abandon sheet repeats the row\'s name and its stuck line', async () => {
    await board([stuckRun(1, 'overtaken', null, 9 * D)]);
    fireEvent.click(toggle('Overtaken'));
    fireEvent.click(screen.getByRole('button', { name: 'Abandon run 1' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('A later wave moved on 9 days ago · Nothing closes this on its own')).toBeInTheDocument();
  });

  it('a stuck run is listed in the band and also stays in its programme group (the band is a second view)', async () => {
    const c = await board([stuckRun(1, 'overtaken', null, 9 * D), run(2, { state: 'working', sessionId: 's', workspace: 'w' })]);
    fireEvent.click(toggle('Overtaken'));
    expect(c.querySelectorAll('li.run-row')).toHaveLength(3);
    expect(c.querySelectorAll('.runs-group li.run-row')).toHaveLength(2);
  });

  it('an owner-gone stuck run keeps its Resume door in its programme group (the band is a second view)', async () => {
    const store = makeStore();
    const dead = fleetSession({ id: 'project-a-coordinator', project: 'project-a', status: 'dead', bucket: 'dead', lifecycle: 'orphan' });
    act(() => {
      store.setState({ runs: [stuckRun(7, 'owner-gone', 'coordinator-archived', 49 * D)], runsFrameSeen: true, fleetFrameSeen: true, conn: 'open',
        sessions: [dead] });
    });
    const { container } = render(<RunsScreen store={store} loadRuns={vi.fn().mockResolvedValue({ runs: [] })} />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.runs-group')!.querySelector('li.run-row')).not.toBeNull();
    expect(within(container.querySelector('.runs-group') as HTMLElement).getByRole('button', { name: 'Resume run 7' })).toBeInTheDocument();
  });

  it('stuck never counts in a badge', async () => {
    const c = await board(MIXED());
    expect(c.querySelector('[data-testid="stuck-band"] [class*="badge"], [data-testid="stuck-band"] [data-badge]')).toBeNull();
    expect(c.textContent).not.toMatch(/needs you/);
  });
});

describe('the top of the board', () => {
  it('no healthy run renders above the band', async () => {
    const c = await board([...MIXED(), run(20, { state: 'working', sessionId: 's', workspace: 'w' })]);
    const band = c.querySelector('[data-testid="stuck-band"]')!;
    for (const li of c.querySelectorAll('li.run-row')) {
      expect(band.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING, `${li.getAttribute('title')} follows the band`).toBeTruthy();
    }
  });

  it('a board with no verdict draws no band', async () => {
    const c = await board([run(1), run(2, { stuck: null })]);
    expect(c.querySelector('[data-testid="stuck-band"]')).toBeNull();
  });
});
