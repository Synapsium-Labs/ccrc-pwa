// The run page, `/runs/<id>` (the runs rebuild, Task 7, D-8072; spec 2026-11-04 §8.4, F16, checks 5 and 16, A42). The page
// reads the fleet store and the api and navigates; the api is the test's own. Neutral names only: the repository is public.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RunHit, RunRecordAnswer, RunSpend, RunSummary } from '../../shared/api';
import { ApiError, ApiTimeout, api } from '../src/lib/api';
import { createFleetStore } from '../src/stores/fleet';
import { isRunId, matchRoute, runPath, runQueryOf, runsSearchPath, topRouteOf } from '../src/lib/routes';
import { RunDetailScreen } from '../src/screens/RunDetailScreen';
import { runWhen } from '../src/fleet/runDetailWords';
import { App } from '../src/app';
import { navigate } from '../src/lib/router';
import { runRow } from './ledgersFixture';

const makeSocket = (): WebSocket => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket;
const mk = () => createFleetStore({ makeSocket });

const T0 = Date.UTC(2026, 10, 2, 11, 20);
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  ...runRow({ id: 410, program: 'programme-a' }),
  programTitle: 'Programme A', project: 'project-a', homeProject: 'project-a', workspace: null, branch: null, reviews: null,
  openedAt: T0, dispatchedAt: T0 + 60_000, handoffCommit: null, items: { done: 1, total: 3 }, unreadMail: 0,
  resumed: false, clearedAt: null, dispatchStartedAt: null, lastMoveAt: T0 + 120_000, ...over,
}) as unknown as RunSummary;
const record = (r: RunSummary, over: Partial<RunRecordAnswer> = {}): RunRecordAnswer => ({ ok: true, run: r, events: [], reviewedBy: [], olderEvents: 0, ...over });
const unmeasured: RunSpend = { measured: false, reason: 'no-sweep' };

/** Every read answers unless the case replaces it. */
function reads(r: RunSummary, over: { record?: () => Promise<RunRecordAnswer>; run?: () => Promise<{ ok: true; run: RunSummary; spend: RunSpend }> } = {}) {
  return {
    record: vi.spyOn(api, 'runRecord').mockImplementation(over.record ?? (async () => record(r))),
    one: vi.spyOn(api, 'run').mockImplementation(over.run ?? (async () => ({ ok: true, run: r, spend: unmeasured }))),
    items: vi.spyOn(api, 'runItems').mockResolvedValue({ ok: true, items: [
      { id: 1, title: 'a', state: 'done', claimedBy: null }, { id: 2, title: 'b', state: 'pending', claimedBy: null },
    ] }),
    signals: vi.spyOn(api, 'runSignals').mockRejectedValue(new ApiError(404, { ok: false })),
    goals: vi.spyOn(api, 'goals').mockRejectedValue(new ApiError(404, { ok: false })),
  };
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

const open = async (r: RunSummary, id = r.id) => {
  render(<RunDetailScreen id={id} store={mk()} />);
  await screen.findByRole('heading', { level: 1, name: `Run ${id}` });
};

describe('the route', () => {
  it('/runs/410 opens a closed run', async () => {
    const closed = run({ state: 'done', closedAt: T0 + 3_600_000, closedBy: 'operator', closeDetail: 'abandon:overtaken' });
    const r = reads(closed);
    history.replaceState(null, '', '/runs/410');
    expect(matchRoute('/runs/410')?.route.id).toBe('run');
    expect(topRouteOf('/runs/410')?.id).toBe('runs');
    await open(closed);
    expect(r.record).toHaveBeenCalledWith(410);
    expect(screen.getByText('closed by you: overtaken')).toBeInTheDocument();
  });

  it('0, 007 and a number past safe integer are refused and send no read', () => {
    const r = reads(run());
    for (const p of ['/runs/0', '/runs/007', '/runs/99999999999999999999', '/runs/-1', '/runs/1e3', '/runs/x']) {
      expect(matchRoute(p), p).toBeNull();
      navigate(p);
      const view = render(<App />);
      view.unmount();
    }
    expect(isRunId('0')).toBe(false);
    expect(isRunId('9007199254740993')).toBe(false);
    expect(r.record).not.toHaveBeenCalled();
    expect(r.one).not.toHaveBeenCalled();
  });

  it('/runs/410/ opens', () => {
    expect(matchRoute('/runs/410/')?.route.id).toBe('run');
    expect(matchRoute('/runs/410/')?.param).toBe('410');
    expect(runPath(410)).toBe('/runs/410');
    expect(runPath(410, 'a b')).toBe('/runs/410?q=a+b');
    expect(runQueryOf('?q=a+b')).toBe('a b');
    expect(runQueryOf('')).toBeNull();
  });
});

describe('the header and the facts', () => {
  it('a slow spend read delays one line and nothing else', async () => {
    let finish: (v: { ok: true; run: RunSummary; spend: RunSpend }) => void = () => {};
    const r = run();
    reads(r, { run: () => new Promise((res) => { finish = res; }) });
    await open(r);
    expect(screen.getByText('Programme A')).toBeInTheDocument();
    expect(screen.queryByText('Spend')).toBeNull();
    await act(async () => { finish({ ok: true, run: r, spend: { measured: true, proxyUsd: 1.234, tokens: { input: 10, output: 2500, cacheRead: 0, cacheWrite: 0 }, measuredAt: 'now' } as unknown as RunSpend }); });
    expect(await screen.findByText('Spend')).toBeInTheDocument();
  });

  it('spend reads ≈ $X.XX · out N', async () => {
    const r = run();
    reads(r, { run: async () => ({ ok: true, run: r, spend: { measured: true, proxyUsd: 1.234, tokens: { input: 10, output: 2500, cacheRead: 0, cacheWrite: 0 }, measuredAt: 'now' } as unknown as RunSpend }) });
    await open(r);
    expect(await screen.findByText(/^≈ \$1\.23 · out /)).toBeInTheDocument();
  });

  it('a closed run shows no Abandon', async () => {
    const closed = run({ state: 'done', closedAt: T0 + 1000, closedBy: 'coordinator' });
    reads(closed);
    await open(closed);
    expect(screen.queryByRole('button', { name: /abandon/i })).toBeNull();
  });

  it('the line carries only what the word lacks', async () => {
    const byYou = run({ state: 'done', closedAt: T0 + 3_600_000, closedBy: 'operator', closeDetail: 'abandon:overtaken' });
    reads(byYou);
    const view = render(<RunDetailScreen id={410} store={mk()} />);
    await screen.findByText('closed by you: overtaken');
    expect(document.querySelector('.rd-close')?.textContent).toBe(runWhen(T0 + 3_600_000));
    view.unmount();
    vi.restoreAllMocks();
    const done = run({ state: 'done', closedAt: T0 + 3_600_000, closedBy: 'coordinator' });
    reads(done);
    render(<RunDetailScreen id={410} store={mk()} />);
    expect(await screen.findByText(`Closed by the coordinator, ${runWhen(T0 + 3_600_000)}`)).toBeInTheDocument();
  });

  it('an absent fact is left out, except Last move, which says None recorded', async () => {
    const r = run({ lastMoveAt: null, dispatchedAt: null, workspace: null, branch: null });
    reads(r);
    await open(r);
    const when = document.querySelector('[data-group="when"]') as HTMLElement;
    expect(within(when).getByText('Last move').nextElementSibling?.textContent).toBe('None recorded');
    expect(within(when).queryByText('Dispatched')).toBeNull();
    expect(within(when).queryByText('Closed')).toBeNull();
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Branch')).toBeNull();
  });

  it('the facts come in §8.4\'s order, under their groups', async () => {
    const r = run({ state: 'done', closedAt: T0 + 5000, closedBy: 'coordinator', workspace: 'ws-a', branch: 'ws/a', claimedBy: 'lane-a-project-a' });
    reads(r);
    await open(r);
    await screen.findByText('Items done');
    const groups = [...document.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'));
    expect(groups).toEqual(['belongs', 'who', 'when', 'work']);
    const keys = [...document.querySelectorAll('[data-fact]')].map((f) => f.getAttribute('data-fact'));
    expect(keys).toEqual(['programme', 'wave', 'project', 'coordinator', 'opened', 'dispatched', 'lastMove', 'closed', 'workspace', 'branch', 'items', 'spend']);
  });

  it('items, suite and checks, and unread mail read from their own calls', async () => {
    const r = run({ unreadMail: 2 });
    const got = reads(r);
    got.signals.mockResolvedValue({ ok: true, signals: { signals: { suite: { ok: true, value: 'green' }, failure: { ok: false, why: 'absent' } } } as never });
    await open(r);
    expect(await screen.findByText('1 of 2')).toBeInTheDocument();
    expect(await screen.findByText('suite green')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(got.items).toHaveBeenCalledWith(410);
    expect(got.signals).toHaveBeenCalledWith(410);
  });

  it('reviews and reviewed-by link to their run pages', async () => {
    const r = run({ kind: 'review', reviews: 409 });
    reads(r);
    vi.spyOn(api, 'runRecord').mockResolvedValue(record(r, { reviewedBy: [{ id: 411 } as RunHit] }));
    await open(r);
    expect(screen.getByRole('link', { name: 'run 409' })).toHaveAttribute('href', '/runs/409');
    expect(screen.getByRole('link', { name: 'run 411' })).toHaveAttribute('href', '/runs/411');
  });
});

describe('the Who and Pull requests facts', () => {
  it('a claimant with no fleet row reads gone when the server says coordinatorGone', async () => {
    const r = run({ state: 'done', closedAt: T0 + 5000, closedBy: 'coordinator', claimedBy: 'lane-a-project-a', coordinatorGone: true });
    reads(r);
    await open(r);
    await screen.findByText('Items done');
    expect(within(document.querySelector('[data-fact="coordinator"]') as HTMLElement).getByText('gone')).toBeInTheDocument();
  });

  it('an absent verdict falls back to the presence reading: not reported when the claimant is unlisted', async () => {
    const r = run({ state: 'done', closedAt: T0 + 5000, closedBy: 'coordinator', claimedBy: 'lane-a-project-a' });
    reads(r);
    await open(r);
    await screen.findByText('Items done');
    expect(within(document.querySelector('[data-fact="coordinator"]') as HTMLElement).getByText('not reported')).toBeInTheDocument();
  });

  it('the Pull requests link opens the pull request in a new tab and never navigates in-app', async () => {
    const r = run({ state: 'done', closedAt: T0 + 5000, closedBy: 'coordinator', sessionId: 'worker-a' });
    reads(r);
    const store = mk();
    act(() => { store.setState({ sessions: [{ id: 'worker-a', pr: { number: 12, url: 'https://example.test/o/r/pull/12' } }] as never, fleetFrameSeen: true }); });
    const push = vi.spyOn(history, 'pushState');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<RunDetailScreen id={410} store={store} />);
    const link = await screen.findByRole('link', { name: '#12' });
    expect(link).toHaveAttribute('href', 'https://example.test/o/r/pull/12');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(push).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://example.test/o/r/pull/12', '_blank', 'noopener,noreferrer');
  });
});

describe('the states', () => {
  it('There is no run 9999.', async () => {
    reads(run());
    vi.spyOn(api, 'runRecord').mockRejectedValue(new ApiError(404, { ok: false, error: 'unknown-run' }));
    render(<RunDetailScreen id={9999} store={mk()} />);
    expect(await screen.findByText('There is no run 9999.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Runs' })).toHaveAttribute('href', '/runs');
  });

  it('Could not load this run. Try again. on ApiTimeout', async () => {
    reads(run());
    const rec = vi.spyOn(api, 'runRecord').mockRejectedValueOnce(new ApiTimeout('/api/runs/410/record', 20_000));
    render(<RunDetailScreen id={410} store={mk()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load this run. Try again.');
    rec.mockResolvedValue(record(run()));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Programme A')).toBeInTheDocument();
  });
});

describe('the way back', () => {
  it('the strip shows ‹ Search results, is named Back to Search results for screen readers, and keeps the query', async () => {
    reads(run());
    history.replaceState(null, '', '/runs/410?q=port');
    render(<RunDetailScreen id={410} store={mk()} />);
    const back = await screen.findByRole('button', { name: 'Back to Search results' });
    expect(back.textContent).toBe('‹Search results');
    fireEvent.click(back);
    expect(location.pathname + location.search).toBe(runsSearchPath('port'));
  });

  it('a reload of /runs/410?q=x keeps that strip', async () => {
    reads(run());
    history.replaceState(null, '', '/runs/410?q=x');
    const first = render(<RunDetailScreen id={410} store={mk()} />);
    await screen.findByRole('button', { name: 'Back to Search results' });
    first.unmount();
    render(<RunDetailScreen id={410} store={mk()} />);
    expect(await screen.findByRole('button', { name: 'Back to Search results' })).toBeInTheDocument();
  });

  it('the strip shows ‹ Runs, named Back to Runs, from a cold link', async () => {
    reads(run());
    history.replaceState(null, '', '/runs/410');
    render(<RunDetailScreen id={410} store={mk()} />);
    const back = await screen.findByRole('button', { name: 'Back to Runs' });
    expect(back.textContent).toBe('‹Runs');
    fireEvent.click(back);
    expect(location.pathname).toBe('/runs');
  });
});
