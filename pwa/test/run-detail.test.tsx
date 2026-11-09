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
import { fleetSession } from './fleetFixture';

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
    expect(groups).toEqual(['belongs', 'who', 'when', 'work', 'trail']);
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

  it('a server without the record route (404 not-found) reads as a failed load, not a missing run', async () => {
    reads(run());
    vi.spyOn(api, 'runRecord').mockRejectedValue(new ApiError(404, { error: 'not-found' }));
    render(<RunDetailScreen id={410} store={mk()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load this run. Try again.');
    expect(screen.queryByText('There is no run 410.')).toBeNull();
  });

  it('the header draws the row\'s waits-on line', async () => {
    const r = run({ state: 'awaiting-review', waitsOn: 'reviewer' } as Partial<RunSummary>);
    reads(r);
    render(<RunDetailScreen id={410} store={mk()} />);
    expect(await screen.findByText('Waits on a reviewer.')).toBeInTheDocument();
  });

  it('an open run follows the live runs frame', async () => {
    const r = run({ state: 'working' } as Partial<RunSummary>);
    reads(r);
    const store = mk();
    render(<RunDetailScreen id={410} store={store} />);
    await screen.findByText('Programme A');
    expect(document.querySelector('.rd-state')?.textContent).not.toBe('awaiting review');
    act(() => { store.setState({ runs: [{ ...r, state: 'awaiting-review', waitsOn: 'reviewer' } as RunSummary], runsFrameSeen: true }); });
    expect(await screen.findByText('Waits on a reviewer.')).toBeInTheDocument();
  });

  it('a server without the record route still offers the session, from the run read it does have', async () => {
    const r = run({ sessionId: 'worker-a' } as Partial<RunSummary>);
    reads(r);
    vi.spyOn(api, 'runRecord').mockRejectedValue(new ApiError(404, { error: 'not-found' }));
    render(<RunDetailScreen id={410} store={mk()} />);
    expect(await screen.findByRole('link', { name: 'Open the session' })).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toBe('Could not load this run. Try again.');
  });

  it('a run that leaves the live frame is read again, so the page shows its close', async () => {
    const r = run({ state: 'working' } as Partial<RunSummary>);
    const rd = reads(r);
    const store = mk();
    act(() => { store.setState({ runs: [r], runsFrameSeen: true }); });
    render(<RunDetailScreen id={410} store={store} />);
    await screen.findByText('Programme A');
    expect(rd.record).toHaveBeenCalledTimes(1);
    rd.record.mockImplementation(async () => record(run({ state: 'done' } as Partial<RunSummary>)));
    act(() => { store.setState({ runs: [] }); });
    await vi.waitFor(() => expect(rd.record).toHaveBeenCalledTimes(2));
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

describe('the controls and the trail (Task 7a)', () => {
  const withSessions = (r: RunSummary, ids: string[]) => {
    const store = mk();
    act(() => { store.setState({ sessions: ids.map((id) => ({ id })) as never, fleetFrameSeen: true }); });
    reads(r);
    render(<RunDetailScreen id={r.id} store={store} />);
    return store;
  };
  const event = (over: Partial<RunRecordAnswer['events'][number]> = {}) =>
    ({ at: T0, from: 'planned', to: 'dispatched', by: 'coordinator', detail: null, ...over }) as RunRecordAnswer['events'][number];

  it('Open the session shows when a session exists or existed and can be opened', async () => {
    withSessions(run({ sessionId: 'worker-a' } as Partial<RunSummary>), ['worker-a']);
    expect(await screen.findByRole('link', { name: 'Open the session' })).toHaveAttribute('href', '/s/worker-a');
  });

  it('a closed run whose session is gone from the fleet still offers its session', async () => {
    withSessions(run({ sessionId: 'worker-b', state: 'done', closedAt: T0 + 1000 } as Partial<RunSummary>), []);
    expect(await screen.findByRole('link', { name: 'Open the session' })).toHaveAttribute('href', '/s/worker-b');
  });

  it('no session, no control', async () => {
    reads(run({ sessionId: null, claimedBy: null } as Partial<RunSummary>));
    await open(run());
    expect(screen.queryByRole('link', { name: 'Open the session' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open the coordinator' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lift cap' })).toBeNull();
  });

  it('Open the coordinator shows when the claimant has a session', async () => {
    withSessions(run({ claimedBy: 'coord-a' } as Partial<RunSummary>), ['coord-a']);
    expect(await screen.findByRole('link', { name: 'Open the coordinator' })).toHaveAttribute('href', '/s/coord-a');
    cleanup();
    withSessions(run({ claimedBy: 'coord-b' } as Partial<RunSummary>), []);
    await screen.findByRole('heading', { level: 1, name: 'Run 410' });
    expect(screen.queryByRole('link', { name: 'Open the coordinator' })).toBeNull();
  });

  it('Lift cap shows when the run\'s review cap is waiting and opens LiftCapSheet', async () => {
    const ask = vi.spyOn(api, 'reviewCap').mockReturnValue(new Promise(() => {}));
    reads(run({ reviewCap: { rounds: 3, cap: 3, askedAt: T0, liftedAt: null } } as Partial<RunSummary>));
    await open(run());
    fireEvent.click(await screen.findByRole('button', { name: 'Lift cap' }));
    expect(await screen.findByText('Lift the review cap?')).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith(410);
  });

  it('Lift cap stays away for a lifted cap and an older server\'s run', async () => {
    reads(run({ reviewCap: { rounds: 3, cap: 3, askedAt: T0, liftedAt: T0 + 1 } } as Partial<RunSummary>));
    await open(run());
    expect(screen.queryByRole('button', { name: 'Lift cap' })).toBeNull();
  });

  it('each control is one tap to its place', async () => {
    const store = withSessions(run({ sessionId: 'worker-a', claimedBy: 'coord-a' } as Partial<RunSummary>), ['worker-a', 'coord-a']);
    expect(store).toBeDefined();
    fireEvent.click(await screen.findByRole('link', { name: 'Open the coordinator' }));
    expect(location.pathname).toBe('/s/coord-a');
    fireEvent.click(screen.getByRole('link', { name: 'Open the session' }));
    expect(location.pathname).toBe('/s/worker-a');
  });

  it('the trail lists every event newest first, as time, words and who', async () => {
    const r = run();
    reads(r, { record: async () => record(r, { events: [
      event({ at: T0 + 3_600_000, from: 'working', to: 'done', by: 'operator', detail: 'abandon:overtaken' }),
      event({ at: T0, by: 'session' }),
    ] }) });
    await open(r);
    const rows = within(document.querySelector('[data-group="trail"]') as HTMLElement).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toBe(`${runWhen(T0 + 3_600_000)}working to done: abandon:overtakenyou`);
    expect(rows[1]?.textContent).toBe(`${runWhen(T0)}planned to dispatcheda session`);
  });

  it('a span of stall checks is one line, and older events are counted', async () => {
    const r = run();
    reads(r, { record: async () => record(r, {
      events: [event({ from: 'working', to: 'working', by: 'sweep', folded: { count: 6, untilAt: T0 + 2 * 86_400_000 } })],
      olderEvents: 12,
    }) });
    await open(r);
    expect(screen.getByText('6 stall checks, 2 to 4 Nov')).toBeInTheDocument();
    expect(screen.getByText('12 older events not shown.')).toBeInTheDocument();
  });

  it('the trail sits last at every width', async () => {
    const r = run();
    reads(r, { record: async () => record(r, { events: [event()] }) });
    await open(r);
    const sections = Array.from(document.querySelectorAll('[data-group]'));
    expect(sections[sections.length - 1]?.getAttribute('data-group')).toBe('trail');
    expect(document.querySelector('[data-group="trail"]')?.nextElementSibling?.getAttribute('data-group') ?? null).toBeNull();
  });

  it('the detail shows through the redaction profile as stored', async () => {
    const r = run();
    reads(r, { record: async () => record(r, { events: [event({ detail: 'token=[redacted]' })] }) });
    await open(r);
    expect(screen.getByText(/planned to dispatched: token=\[redacted\]/)).toBeInTheDocument();
  });

  it('a closed run still shows its trail', async () => {
    const r = run({ state: 'done', closedAt: T0 + 5000, closedBy: 'operator' });
    reads(r, { record: async () => record(r, { events: [event({ from: 'working', to: 'done', by: 'operator' })] }) });
    await open(r);
    expect(screen.getByText('working to done')).toBeInTheDocument();
    expect(screen.getByText('you')).toBeInTheDocument();
  });
});

describe('Abandon on the run page (wave B3, spec 9.1, 8.4)', () => {
  it('an open run shows Abandon', async () => {
    const r = run();
    reads(r);
    await open(r);
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeInTheDocument();
  });

  it('an open run with no verdict still shows Abandon', async () => {
    const r = run({ stuck: undefined });
    reads(r);
    await open(r);
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeInTheDocument();
  });

  it('an open run with a wrong stuck reason still shows Abandon', async () => {
    const r = run({ stuck: { reason: 'not-a-reason-this-build-knows' } } as unknown as Partial<RunSummary>);
    reads(r);
    await open(r);
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeInTheDocument();
  });

  it('a planned run with no session shows Abandon too, the wedge it exists for', async () => {
    const r = run({ state: 'planned', sessionId: null });
    reads(r);
    await open(r);
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeInTheDocument();
  });

  it('the page uses this same sheet: its title, buttons and the call to the abandon route', async () => {
    const r = run();
    reads(r);
    const abandon = vi.spyOn(api, 'abandonRun').mockResolvedValue({ released: true });
    await open(r);
    fireEvent.click(screen.getByRole('button', { name: 'Abandon' }));
    expect(await screen.findByText('Abandon run 410?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See this run' })).toHaveAttribute('href', '/runs/410');
    expect(abandon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Abandon run 410' }));
    await vi.waitFor(() => expect(abandon).toHaveBeenCalledWith(410));
  });

  it('after an abandon the page shows the close', async () => {
    const open_ = run();
    const closed = run({ state: 'failed', closedAt: T0 + 3_600_000, closedBy: 'operator', closeDetail: 'abandon:overtaken' });
    let abandoned = false;
    reads(open_, { record: async () => record(abandoned ? closed : open_) });
    vi.spyOn(api, 'abandonRun').mockImplementation(async () => { abandoned = true; return { released: true }; });
    await open(open_);
    fireEvent.click(screen.getByRole('button', { name: 'Abandon' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abandon run 410' }));
    expect(await screen.findByText('closed by you: overtaken')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abandon' })).toBeNull();
  });
});

// Resume on the run page (the runs rebuild, Task 19, D-8075; spec 2026-11-04 §8.4, §9.5, A46, A55, A60, D-1146). `resumeShown` is
// the one decider: the server's verdict on the coordinator, and the run open or its programme with no open run.
describe('Resume on the run page', () => {
  const GONE = { id: 'coord-a', project: 'project-a', role: 'coordinator', status: 'dead', lifecycle: 'orphan' };
  const LIVE = { id: 'coord-a', project: 'project-a', role: 'coordinator', status: 'idle', lifecycle: 'running' };
  const page = async (r: RunSummary, o: { sessions?: Record<string, unknown>[]; live?: RunSummary[]; runsFrameSeen?: boolean; fleetFrameSeen?: boolean } = {}) => {
    const store = mk();
    act(() => {
      store.setState({
        sessions: (o.sessions ?? []).map((s) => fleetSession(s as never)), fleetFrameSeen: o.fleetFrameSeen ?? true,
        runs: o.live ?? [], runsFrameSeen: o.runsFrameSeen ?? true,
      });
    });
    reads(r);
    render(<RunDetailScreen id={r.id} store={store} />);
    await screen.findByRole('heading', { level: 1, name: `Run ${r.id}` });
  };
  const resume = () => screen.queryByRole('button', { name: 'Resume run 410' });
  const claimed = (over: Partial<RunSummary> = {}) => run({ claimedBy: 'coord-a', ...over } as Partial<RunSummary>);

  it('Resume shows on the run page from coordinatorGone', async () => {
    await page(claimed({ coordinatorGone: true }), { sessions: [LIVE] });
    expect(resume()).not.toBeNull();
  });
  it('a live coordinator shows no Resume', async () => {
    await page(claimed({ coordinatorGone: false }), { sessions: [LIVE] });
    expect(resume()).toBeNull();
  });
  it('a claimant with no fleet row still shows Resume', async () => {
    await page(claimed({ coordinatorGone: true }), { sessions: [] });
    expect(resume()).not.toBeNull();
  });
  it('an older server with no field reads coordinatorPresence', async () => {
    await page(claimed(), { sessions: [GONE] });
    expect(resume()).not.toBeNull();
    cleanup();
    await page(claimed(), { sessions: [] });
    expect(resume()).toBeNull();
  });
  it('coordinatorGone false hides Resume over a presence of dead, as a substrate fault sends (D-7370)', async () => {
    await page(claimed({ coordinatorGone: false }), { sessions: [GONE] });
    expect(resume()).toBeNull();
  });
  it('a closed run of an all-terminal programme shows it, and a closed run beside an open wave shows none (D-1146)', async () => {
    const done = claimed({ state: 'done', closedAt: T0 + 1000, coordinatorGone: true } as Partial<RunSummary>);
    await page(done, { sessions: [GONE], live: [] });
    expect(resume()).not.toBeNull();
    cleanup();
    await page(done, { sessions: [GONE], live: [run({ id: 411, program: 'programme-a' })] });
    expect(resume()).toBeNull();
  });
  it('a runs frame not yet heard hides it', async () => {
    await page(claimed({ coordinatorGone: true }), { sessions: [GONE], runsFrameSeen: false });
    expect(resume()).toBeNull();
  });
  it('opens the sheet with its lead sentence, and sends nothing by opening it', async () => {
    await page(claimed({ coordinatorGone: true }), { sessions: [GONE] });
    fireEvent.click(resume()!);
    expect(await screen.findByText(/claims run 410/)).toBeTruthy();
    expect(screen.getByText('Only if this work should go on. A dead programme is abandoned, not handed over.')).toBeTruthy();
  });
});
