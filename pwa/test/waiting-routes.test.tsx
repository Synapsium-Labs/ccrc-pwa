// The two ladder arms of the Waiting on you routes (desktop-polish PL5a, D-7712): `WaitingRoute` and `ItemRoute` read the
// fleet store, call the api, and navigate; the screens they render take props only. The store is the test's own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../src/lib/apiError';
import { api } from '../src/lib/api';
import { createFleetStore } from '../src/stores/fleet';
import { ItemRoute, WaitingRoute } from '../src/ledgers/WaitingRoutes';
import { fleetSession } from './fleetFixture';
import { itemView, runRow, waitingView } from './ledgersFixture';

const makeSocket = (): WebSocket => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket;
const mk = () => createFleetStore({ makeSocket });

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

describe('ItemRoute', () => {
  it('a tick calls the route with the typed answer, then reads the list again', async () => {
    const store = mk();
    const item = itemView({ id: 7, kind: 'value', title: 'Review rounds' });
    act(() => store.setState({ waiting: waitingView({ items: [item] }) }));
    const checking = itemView({ id: 7, kind: 'value', title: 'Review rounds', state: 'checking' });
    const tick = vi.spyOn(api, 'tickItem').mockResolvedValue({ ok: true, item: checking });
    const reread = vi.spyOn(api, 'waiting').mockResolvedValue({ ok: true, waiting: waitingView({ items: [checking] }) });
    render(<ItemRoute id={7} store={store} />);
    fireEvent.change(screen.getByRole('textbox', { name: /your value/i }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(reread).toHaveBeenCalledTimes(1));
    expect(tick).toHaveBeenCalledWith(7, '4');
    await waitFor(() => expect(store.getState().waiting?.items[0]?.state).toBe('checking'));
  });

  it('a Do item ticks with no answer argument at all', async () => {
    const store = mk();
    act(() => store.setState({ waiting: waitingView({ items: [itemView({ id: 8 })] }) }));
    const tick = vi.spyOn(api, 'tickItem').mockResolvedValue({ ok: true, item: itemView({ id: 8, state: 'checking' }) });
    vi.spyOn(api, 'waiting').mockResolvedValue({ ok: true, waiting: waitingView() });
    render(<ItemRoute id={8} store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(tick).toHaveBeenCalledTimes(1));
    expect(tick.mock.calls[0]).toEqual([8]);
  });

  it('a refused tick shows its sentence and reads nothing again', async () => {
    const store = mk();
    act(() => store.setState({ waiting: waitingView({ items: [itemView({ id: 9 })] }) }));
    vi.spyOn(api, 'tickItem').mockRejectedValue(new ApiError(409, { ok: false, error: 'not-open' }));
    const reread = vi.spyOn(api, 'waiting');
    render(<ItemRoute id={9} store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not open any more/);
    expect(reread).not.toHaveBeenCalled();
  });

  it('Dismiss is offered only once the runs frame says the programme has no open run', () => {
    const store = mk();
    act(() => store.setState({ waiting: waitingView({ items: [itemView({ id: 3, program: 'prog-a' })] }) }));
    const view = render(<ItemRoute id={3} store={store} />);
    // No runs frame yet: the programme's runs are unknown, so they count as open and the button is not offered.
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    act(() => store.setState({ runsFrameSeen: true, runs: [runRow({ id: 1, program: 'prog-a', state: 'working' })] }));
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    act(() => store.setState({ runs: [runRow({ id: 1, program: 'prog-a', state: 'done' }), runRow({ id: 2, program: 'prog-b', state: 'working' })] }));
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    view.unmount();
  });

  it('Dismiss calls the route, reads the list again and goes back to the list', async () => {
    const store = mk();
    act(() => store.setState({ runsFrameSeen: true, runs: [], waiting: waitingView({ items: [itemView({ id: 3 })] }) }));
    const dismiss = vi.spyOn(api, 'dismissItem').mockResolvedValue({ ok: true, item: itemView({ id: 3, state: 'dismissed' }) });
    vi.spyOn(api, 'waiting').mockResolvedValue({ ok: true, waiting: waitingView() });
    history.replaceState(null, '', '/waiting/3');
    render(<ItemRoute id={3} store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(location.pathname).toBe('/waiting'));
    expect(dismiss).toHaveBeenCalledWith(3);
  });

  it('finds a recently cleared item, and says so when the list does not hold it', () => {
    const store = mk();
    act(() => store.setState({ waiting: waitingView({ cleared: [itemView({ id: 5, state: 'done', title: 'Approve it' })] }) }));
    const view = render(<ItemRoute id={5} store={store} />);
    expect(screen.getByRole('heading', { name: 'Approve it' })).toBeTruthy();
    view.unmount();
    render(<ItemRoute id={6} store={store} />);
    expect(screen.getByText('That item is not on the list any more.')).toBeTruthy();
  });

  it('before the first update it says it is waiting, never that the item is gone', () => {
    render(<ItemRoute id={5} store={mk()} />);
    expect(screen.getByRole('status').textContent).toMatch(/first update/i);
    expect(screen.queryByText('That item is not on the list any more.')).toBeNull();
  });
});

describe('WaitingRoute', () => {
  it('counts a session\'s question only once the fleet frame has landed', () => {
    const store = mk();
    act(() => store.setState({ waiting: waitingView(), sessions: [fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'A question' })] }));
    const view = render(<WaitingRoute store={store} />);
    expect(screen.queryByText('A question')).toBeNull(); // the snapshot's rows are not a fact yet
    expect(screen.getByText('Nothing needs you.')).toBeTruthy();
    act(() => store.setState({ fleetFrameSeen: true }));
    expect(screen.getByRole('button', { name: /A question/ })).toBeTruthy();
    view.unmount();
  });

  it('opens an item at its own path and a question at its session', () => {
    const store = mk();
    act(() => store.setState({
      fleetFrameSeen: true, sessions: [fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'A question' })],
      waiting: waitingView({ items: [itemView({ id: 4, title: 'Pick one' })] }),
    }));
    render(<WaitingRoute store={store} />);
    fireEvent.click(screen.getByRole('button', { name: /Pick one/ }));
    expect(location.pathname).toBe('/waiting/4');
    fireEvent.click(screen.getByRole('button', { name: /A question/ }));
    expect(location.pathname).toBe('/s/project-a-ask');
  });
});
