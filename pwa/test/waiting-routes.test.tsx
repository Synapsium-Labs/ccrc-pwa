// The two ladder arms of the Waiting on you routes (desktop-polish PL5a, D-7712): `WaitingRoute` and `ItemRoute` read the
// fleet store, call the api, and navigate; the screens they render take props only. The store is the test's own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/lib/apiError';
import { api } from '../src/lib/api';
import { createFleetStore } from '../src/stores/fleet';
import { ROUTES, matchRoute } from '../src/lib/routes';
import { ItemListColumn, ItemRoute, ItemRouteAt, WaitingRoute, itemPath } from '../src/ledgers/WaitingRoutes';
import { navigate, useLocation } from '../src/lib/router';
import { refetchWaiting } from '../src/ledgers/waitingStore';
import { fleetSession } from './fleetFixture';
import { MIN, NOW, itemView, runRow, waitingView } from './ledgersFixture';

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
    expect(api.waiting).toHaveBeenCalledTimes(1); // the re-read after the move
  });

  it('a tick\'s re-read starts after a focus read already on the wire, so the list shows the tick', async () => {
    const store = mk();
    const open = itemView({ id: 7 });
    const checking = itemView({ id: 7, state: 'checking', tickedAt: NOW - MIN });
    act(() => store.setState({ waiting: waitingView({ items: [open] }) }));
    let release!: (v: { ok: true; waiting: ReturnType<typeof waitingView> }) => void;
    const first = new Promise<{ ok: true; waiting: ReturnType<typeof waitingView> }>((r) => { release = r; });
    const read = vi.spyOn(api, 'waiting').mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ok: true, waiting: waitingView({ items: [checking] }) });
    const tick = vi.spyOn(api, 'tickItem').mockResolvedValue({ ok: true, item: checking });
    render(<ItemRoute id={7} store={store} />);
    void refetchWaiting(store, api.waiting, true); // the focus read, on the wire and not yet answered
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(tick).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(read).toHaveBeenCalledTimes(1); // the tick's read waits behind it
    await act(async () => { release({ ok: true, waiting: waitingView({ items: [open] }) }); });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(store.getState().waiting?.items[0]?.state).toBe('checking'));
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
  it('waits for the fleet frame before it calls the list empty or lists a session\'s question', () => {
    const store = mk();
    // The order of a cold start: the waiting frame first, the fleet frame after.
    act(() => store.setState({ waiting: waitingView(), sessions: [fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'A question' })] }));
    const view = render(<WaitingRoute store={store} />);
    expect(screen.queryByText('A question')).toBeNull(); // the snapshot's rows are not a fact yet
    expect(screen.queryByText('Nothing needs you.')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/first update/i);
    act(() => store.setState({ fleetFrameSeen: true }));
    expect(screen.getByRole('button', { name: /A question/ })).toBeTruthy();
    view.unmount();
  });

  it('a programme is not called ended before the runs frame lands, and is once it has none open', () => {
    const store = mk();
    act(() => store.setState({ fleetFrameSeen: true, sessions: [], waiting: waitingView({ items: [itemView({ id: 1, program: 'prog-a' })] }) }));
    render(<WaitingRoute store={store} />);
    expect(screen.queryByText(/the programme has no open run/)).toBeNull();
    act(() => store.setState({ runsFrameSeen: true, runs: [runRow({ id: 1, program: 'prog-a', state: 'done' })] }));
    expect(screen.getByText(/the programme has no open run/)).toBeTruthy();
  });

  it('says there is no list to wait for when this box has no coordination database', async () => {
    const store = mk();
    vi.spyOn(api, 'waiting').mockRejectedValue(new ApiError(503, { ok: false, error: 'not-configured' }));
    render(<WaitingRoute store={store} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/no coordination database/);
    expect(screen.queryByText(/first update/i)).toBeNull();
  });

  it('keeps waiting when the read fails for any other reason', async () => {
    const store = mk();
    const read = vi.spyOn(api, 'waiting').mockRejectedValue(new TypeError('offline'));
    render(<WaitingRoute store={store} />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toMatch(/first update/i);
    expect(screen.queryByRole('alert')).toBeNull();
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

describe('the routes\' own paths', () => {
  it('itemPath and the list\'s path are the route table\'s, and each is on its own route', () => {
    expect(matchRoute(itemPath(12))?.route.id).toBe('item');
    expect(matchRoute(itemPath(12))?.param).toBe('12');
    const row = ROUTES.find((r) => r.id === 'waiting')!;
    expect(matchRoute(row.path!)?.route.id).toBe('waiting');
    expect(itemPath(1).startsWith(`${row.path}/`)).toBe(true);
  });

  it('ItemRouteAt opens the item its parameter names, and says so for one that names none', () => {
    const store = mk();
    act(() => store.setState({ waiting: waitingView({ items: [itemView({ id: 12, title: 'Twelve' })] }) }));
    const view = render(<ItemRouteAt param="12" store={store} />);
    expect(screen.getByRole('heading', { name: 'Twelve' })).toBeTruthy();
    view.unmount();
    render(<ItemRouteAt param="99999999999999999999" store={store} />);
    expect(screen.getByText('That item is not on the list any more.')).toBeTruthy();
  });

  it('ItemRouteAt keys the item by its id, so a typed answer does not follow the operator to the next item', () => {
    const store = mk();
    act(() => store.setState({ waiting: waitingView({ items: [
      itemView({ id: 1, kind: 'value', title: 'One' }), itemView({ id: 2, kind: 'value', title: 'Two' }),
    ] }) }));
    const view = render(<ItemRouteAt param="1" store={store} />);
    fireEvent.change(screen.getByRole('textbox', { name: /your value/i }), { target: { value: 'typed on one' } });
    view.rerender(<ItemRouteAt param="2" store={store} />);
    expect((screen.getByRole('textbox', { name: /your value/i }) as HTMLInputElement).value).toBe('');
  });
});

describe('moving between items (plan PL9; spec §2 "Moving between items", D23)', () => {
  // prog-b holds the blocking item, so it sorts first: the combined list draws 3, 2, then 4, 1.
  const ITEMS = [
    itemView({ id: 1, program: 'prog-a', neededBy: 'later', title: 'One' }),
    itemView({ id: 2, program: 'prog-b', neededBy: 'soon', title: 'Two' }),
    itemView({ id: 3, program: 'prog-b', neededBy: 'blocking', title: 'Three' }),
    itemView({ id: 4, program: 'prog-a', neededBy: 'soon', title: 'Four' }),
  ];
  const rig = () => {
    const store = mk();
    act(() => store.setState({ fleetFrameSeen: true, sessions: [], waiting: waitingView({ items: ITEMS, cleared: [itemView({ id: 9, state: 'done', title: 'Nine' })] }) }));
    return store;
  };
  /** Open item `id` at `url`, as a reload or a shared link would. */
  const openAt = (url: string, id: number) => {
    history.replaceState(null, '', url);
    render(<ItemRouteAt param={String(id)} store={rig()} />);
    return screen.getByRole('navigation', { name: 'Between items' });
  };
  const here = (): string => location.pathname + location.search;

  /** The item route as the app's ladder mounts it, following the router: the path's id is the route's parameter. With the
   *  column beside it, as the frame's nav slot draws it on a desk. */
  function Routed({ store, column = false }: { store: ReturnType<typeof mk>; column?: boolean }) {
    const { path } = useLocation();
    const id = /^\/waiting\/(\d+)$/.exec(path)?.[1] ?? null;
    if (id === null) return <p>at {path}</p>;
    return (
      <>
        {column && <ItemListColumn param={id} store={store} fleet={<section aria-label="Fleet stand-in" />} />}
        <ItemRouteAt param={id} store={store} />
      </>
    );
  }
  const routedAt = (url: string, store = rig(), column = false) => {
    history.replaceState(null, '', url);
    render(<Routed store={store} column={column} />);
    return store;
  };
  const strip = () => screen.getByRole('navigation', { name: 'Between items' });

  it('previous and next follow the list it was opened from: the combined list, and Previous steps back from the item reached', () => {
    routedAt('/waiting/2');
    expect(within(strip()).getByText('2 of 4')).toBeTruthy();
    fireEvent.click(within(strip()).getByRole('button', { name: 'Next item' }));
    expect(here()).toBe('/waiting/4');
    expect(within(strip()).getByText('3 of 4')).toBeTruthy();
    fireEvent.click(within(strip()).getByRole('button', { name: 'Previous item' }));
    expect(here()).toBe('/waiting/2');
    fireEvent.click(within(strip()).getByRole('button', { name: 'Back to Waiting on you' }));
    expect(here()).toBe('/waiting');
  });

  it('each step is a history entry: Back returns to the item it came from, with its own place', async () => {
    routedAt('/waiting/2');
    fireEvent.click(within(strip()).getByRole('button', { name: 'Next item' }));
    expect(here()).toBe('/waiting/4');
    act(() => { history.back(); });
    await waitFor(() => expect(here()).toBe('/waiting/2'));
    await waitFor(() => expect(within(strip()).getByText('2 of 4')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Two' })).toBeTruthy();
  });

  it('previous and next follow the list it was opened from: one programme\'s view, and the way back returns to it', () => {
    const nav = openAt(`/waiting/4?from=${encodeURIComponent('programme:prog-a')}`, 4);
    expect(within(nav).getByText('1 of 2')).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Next item' }));
    expect(location.pathname).toBe('/waiting/1');
    expect(new URLSearchParams(location.search).get('from')).toBe('programme:prog-a');
    fireEvent.click(within(nav).getByRole('button', { name: /^Back to / }));
    expect(here()).toBe('/programmes/prog-a');
  });

  it('previous and next follow the list it was opened from: the side rail\'s filter to one programme', () => {
    const nav = openAt(`/waiting/3?from=${encodeURIComponent('waiting:prog-b')}`, 3);
    expect(within(nav).getByText('1 of 2')).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Next item' }));
    expect(location.pathname).toBe('/waiting/2');
    expect(new URLSearchParams(location.search).get('from')).toBe('waiting:prog-b');
    fireEvent.click(within(nav).getByRole('button', { name: 'Back to Waiting on you' }));
    expect(location.pathname).toBe('/waiting');
    expect(new URLSearchParams(location.search).get('programme')).toBe('prog-b');
  });

  it('the first item has no previous and the last no next', () => {
    const first = openAt('/waiting/3', 3);
    expect((within(first).getByRole('button', { name: 'Previous item' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(first).getByRole('button', { name: 'Next item' }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    const last = openAt('/waiting/1', 1);
    expect((within(last).getByRole('button', { name: 'Next item' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(last).getByText('4 of 4')).toBeTruthy();
  });

  it.each(['programme:prog-a', 'programme:../x', 'nonsense'])('an unknown or stale from (%s) falls back to the combined list', (from) => {
    const nav = openAt(`/waiting/2?from=${encodeURIComponent(from)}`, 2);
    expect(within(nav).getByText('2 of 4')).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Back to Waiting on you' }));
    expect(here()).toBe('/waiting');
  });

  it('the way back is a labelled control at every width, never the chevron the desk shell hides', () => {
    const nav = openAt('/waiting/2', 2);
    const back = within(nav).getByRole('button', { name: 'Back to Waiting on you' });
    expect(back.textContent).toContain('Waiting on you');
    expect(back.classList.contains('back-btn')).toBe(false); // shell.css hides `.shell-detail .back-btn` at 900 and up
  });

  it('an item no list holds (recently cleared) keeps its way back, with no position and no steps', () => {
    const nav = openAt('/waiting/9', 9);
    expect(within(nav).getByRole('button', { name: 'Back to Waiting on you' })).toBeTruthy();
    expect(within(nav).queryByText(/ of /)).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Next item' })).toBeNull();
  });

  it('an item that is gone keeps its way back too', () => {
    history.replaceState(null, '', '/waiting/77');
    render(<ItemRouteAt param="77" store={rig()} />);
    expect(screen.getByText('That item is not on the list any more.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Waiting on you' }));
    expect(here()).toBe('/waiting');
  });

  it('an item that is gone goes back to the combined list when its from names a programme no list holds', () => {
    history.replaceState(null, '', `/waiting/77?from=${encodeURIComponent('programme:zzz')}`);
    render(<ItemRouteAt param="77" store={rig()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Waiting on you' }));
    expect(here()).toBe('/waiting');
  });

  /** The column the frame draws beside the item on a desk (`ItemListColumn`), at `url`, with a stand-in for the fleet column. */
  const columnAt = (url: string, id: number) => {
    history.replaceState(null, '', url);
    render(<ItemListColumn param={String(id)} store={rig()} fleet={<section aria-label="Fleet stand-in" />} />);
  };

  it('on a desk the list stays beside the item: the list it was opened from, the open item marked, in place of the fleet', () => {
    columnAt(`/waiting/2?from=${encodeURIComponent('waiting:prog-b')}`, 2);
    expect(screen.queryByRole('region', { name: 'Fleet stand-in' })).toBeNull();
    const beside = screen.getByRole('complementary', { name: 'The list beside this item' });
    const rows = within(beside).getAllByRole('button').filter((b) => b.hasAttribute('data-item'));
    expect(rows.map((r) => r.getAttribute('data-item'))).toEqual(['3', '2']); // prog-b's share, in the list's order
    expect(rows.find((r) => r.getAttribute('aria-current') === 'page')?.getAttribute('data-item')).toBe('2');
    fireEvent.click(rows[0]!);
    expect(location.pathname).toBe('/waiting/3');
    expect(new URLSearchParams(location.search).get('from')).toBe('waiting:prog-b');
  });

  it('the combined list beside an item is every programme\'s share, in the combined order', () => {
    columnAt('/waiting/4', 4);
    const beside = screen.getByRole('complementary', { name: 'The list beside this item' });
    expect(within(beside).getAllByRole('button').filter((b) => b.hasAttribute('data-item')).map((r) => r.getAttribute('data-item')))
      .toEqual(['3', '2', '4', '1']);
  });

  it('an item the list does not hold (recently cleared, gone) keeps the list it was opened from beside it, nothing marked', () => {
    columnAt(`/waiting/9?from=${encodeURIComponent('programme:prog-a')}`, 9);
    const beside = screen.getByRole('complementary', { name: 'The list beside this item' });
    expect(within(beside).getAllByRole('button').filter((b) => b.hasAttribute('data-item')).map((r) => r.getAttribute('data-item')))
      .toEqual(['4', '1']);
    expect(within(beside).queryAllByRole('button').some((b) => b.hasAttribute('aria-current'))).toBe(false);
    expect(screen.queryByRole('region', { name: 'Fleet stand-in' })).toBeNull();
  });

  it('before the list is heard, the column is the fleet', () => {
    history.replaceState(null, '', '/waiting/2');
    render(<ItemListColumn param="2" store={mk()} fleet={<section aria-label="Fleet stand-in" />} />);
    expect(screen.getByRole('region', { name: 'Fleet stand-in' })).toBeTruthy();
  });

  it('the item page itself draws no second list: the strip and the item only', () => {
    openAt('/waiting/2', 2);
    expect(screen.queryByRole('complementary', { name: 'The list beside this item' })).toBeNull();
  });

  it('the combined list opens an item with its side rail\'s filter in the link, and keeps the filter in its own URL', () => {
    history.replaceState(null, '', '/waiting');
    render(<WaitingRoute store={rig()} />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Programmes' })).getByRole('button', { name: /prog-a/ }));
    expect(here()).toBe('/waiting?programme=prog-a');
    fireEvent.click(screen.getByRole('button', { name: /Four/ }));
    expect(location.pathname).toBe('/waiting/4');
    expect(new URLSearchParams(location.search).get('from')).toBe('waiting:prog-a');
  });

  it('the filter is the URL\'s alone: a door tap to the bare list shows every programme', () => {
    history.replaceState(null, '', '/waiting?programme=prog-a');
    render(<WaitingRoute store={rig()} />);
    expect(screen.queryByRole('button', { name: /Two/ })).toBeNull();
    act(() => navigate('/waiting'));
    expect(screen.getByRole('button', { name: /Two/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Four/ })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Programmes' })).getByRole('button', { name: /All programmes/ })
      .getAttribute('aria-pressed')).toBe('true');
  });

  it('the combined list reads its filter back from its URL, as the way back leaves it', () => {
    history.replaceState(null, '', '/waiting?programme=prog-b');
    render(<WaitingRoute store={rig()} />);
    expect(screen.queryByRole('button', { name: /Four/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Two/ })).toBeTruthy();
  });
});

describe('the walk keeps its place while the operator stays on one item (fix round 1, departure pl9-walk-keeps-its-place)', () => {
  const soon = (id: number, over: Parameters<typeof itemView>[0] = {}) =>
    itemView({ id, program: 'prog-a', neededBy: 'soon', title: `Item ${id}`, raisedAt: NOW - (100 - id) * MIN, ...over });
  const rigOf = (items: ReturnType<typeof itemView>[]) => {
    const store = mk();
    act(() => store.setState({ fleetFrameSeen: true, sessions: [], waiting: waitingView({ items }) }));
    return store;
  };
  function Routed({ store }: { store: ReturnType<typeof mk> }) {
    const { path } = useLocation();
    const id = /^\/waiting\/(\d+)$/.exec(path)?.[1] ?? null;
    if (id === null) return <p>at {path}</p>;
    return (
      <>
        <ItemListColumn param={id} store={store} fleet={<section aria-label="Fleet stand-in" />} />
        <ItemRouteAt param={id} store={store} />
      </>
    );
  }
  const open = (store: ReturnType<typeof mk>, url: string) => { history.replaceState(null, '', url); render(<Routed store={store} />); };
  const strip = () => screen.getByRole('navigation', { name: 'Between items' });
  const step = (name: 'Next item' | 'Previous item') => fireEvent.click(within(strip()).getByRole('button', { name }));
  /** The coordinator's change pushed while the operator stays on the page: the store's list replaced. */
  const push = (store: ReturnType<typeof mk>, items: ReturnType<typeof itemView>[], cleared: ReturnType<typeof itemView>[] = []) =>
    act(() => store.setState({ waiting: waitingView({ items, cleared }) }));

  it('open 11 of 10, 11, 12, tick it, and Next still goes to 12, the item that was next', () => {
    const store = rigOf([soon(10), soon(11), soon(12)]);
    open(store, '/waiting/11');
    expect(within(strip()).getByText('2 of 3')).toBeTruthy();
    push(store, [soon(10), soon(11, { state: 'checking' }), soon(12)]); // the live order is now 10, 12, 11
    expect(within(strip()).getByText('2 of 3')).toBeTruthy();
    expect((within(strip()).getByRole('button', { name: 'Next item' }) as HTMLButtonElement).disabled).toBe(false);
    step('Next item');
    expect(location.pathname).toBe('/waiting/12');
    // Landed: the steps are the live order's again (10, 12, 11).
    expect(within(strip()).getByText('2 of 3')).toBeTruthy();
    step('Next item');
    expect(location.pathname).toBe('/waiting/11');
  });

  it('with a later-needed 13 present, Next from the ticked 11 still goes to 12, never past it', () => {
    const store = rigOf([soon(10), soon(11), soon(12), soon(13, { neededBy: 'later' })]);
    open(store, '/waiting/11');
    push(store, [soon(10), soon(11, { state: 'checking' }), soon(12), soon(13, { neededBy: 'later' })]);
    step('Next item');
    expect(location.pathname).toBe('/waiting/12');
  });

  it('a blocking item ticked at the head of its group keeps its place: no Previous, and Next is the item that was next', () => {
    // prog-b holds the blocking 20, so it is drawn first: 20, 21, then prog-a's 22. Ticked, 20 blocks nothing, and the groups
    // go by slug: 22, then 20, 21.
    const items = [soon(20, { program: 'prog-b', neededBy: 'blocking' }), soon(21, { program: 'prog-b' }), soon(22)];
    const store = rigOf(items);
    open(store, '/waiting/20');
    expect(within(strip()).getByText('1 of 3')).toBeTruthy();
    push(store, [soon(20, { program: 'prog-b', neededBy: 'blocking', state: 'checking' }), soon(21, { program: 'prog-b' }), soon(22)]);
    expect(within(strip()).getByText('1 of 3')).toBeTruthy();
    expect((within(strip()).getByRole('button', { name: 'Previous item' }) as HTMLButtonElement).disabled).toBe(true);
    step('Next item');
    expect(location.pathname).toBe('/waiting/21');
  });

  it('the open item confirmed while it is shown: the list stays beside it, Previous and Next stay, and the strip says so', () => {
    const store = rigOf([soon(10), soon(11), soon(12)]);
    open(store, '/waiting/11');
    push(store, [soon(10), soon(12)], [soon(11, { state: 'done', closedAt: NOW })]);
    expect(screen.getByRole('complementary', { name: 'The list beside this item' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Fleet stand-in' })).toBeNull();
    expect(within(strip()).getByText('2 of 3')).toBeTruthy();
    expect(within(strip()).getByText('This item is not on the list now.')).toBeTruthy();
    step('Previous item');
    expect(location.pathname).toBe('/waiting/10');
  });

  it('after Previous or Next, focus is on the same control, or on the other one when the end of the list disables it', () => {
    const store = rigOf([soon(10), soon(11), soon(12)]);
    open(store, '/waiting/10');
    const next = within(strip()).getByRole('button', { name: 'Next item' });
    next.focus();
    step('Next item');
    expect(location.pathname).toBe('/waiting/11');
    expect(document.activeElement).toBe(within(strip()).getByRole('button', { name: 'Next item' }));
    step('Next item');
    expect(location.pathname).toBe('/waiting/12');
    expect((within(strip()).getByRole('button', { name: 'Next item' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(within(strip()).getByRole('button', { name: 'Previous item' }));
  });

  it('the position is announced politely as it changes', () => {
    const store = rigOf([soon(10), soon(11)]);
    open(store, '/waiting/10');
    const pos = within(strip()).getByRole('status');
    expect(pos.textContent).toBe('1 of 2');
    step('Next item');
    expect(within(strip()).getByRole('status')).toBe(pos);
    expect(pos.textContent).toBe('2 of 2');
  });
});
