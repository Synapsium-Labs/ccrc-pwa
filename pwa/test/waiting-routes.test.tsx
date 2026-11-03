// The two ladder arms of the Waiting on you routes (desktop-polish PL5a, D-7712): `WaitingRoute` and `ItemRoute` read the
// fleet store, call the api, and navigate; the screens they render take props only. The store is the test's own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/lib/apiError';
import { api } from '../src/lib/api';
import { createFleetStore } from '../src/stores/fleet';
import { ROUTES, matchRoute } from '../src/lib/routes';
import { ItemRoute, ItemRouteAt, WaitingRoute, itemPath } from '../src/ledgers/WaitingRoutes';
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

  it('previous and next follow the list it was opened from: the combined list', () => {
    const nav = openAt('/waiting/2', 2);
    expect(within(nav).getByText('2 of 4')).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Next item' }));
    expect(here()).toBe('/waiting/4');
    fireEvent.click(within(nav).getByRole('button', { name: 'Previous item' }));
    expect(here()).toBe('/waiting/3');
    fireEvent.click(within(nav).getByRole('button', { name: 'Back to Waiting on you' }));
    expect(here()).toBe('/waiting');
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

  /** A screen `width` wide, as the media queries the page asks read it. */
  const widthIs = (width: number) => vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    return { matches: min !== null && width >= Number(min[1]), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  });

  it('on a wide screen the list stays beside the item: the list it was opened from, the open item marked', () => {
    widthIs(1280);
    openAt(`/waiting/2?from=${encodeURIComponent('waiting:prog-b')}`, 2);
    const beside = screen.getByRole('complementary', { name: 'The list beside this item' });
    const rows = within(beside).getAllByRole('button').filter((b) => b.hasAttribute('data-item'));
    expect(rows.map((r) => r.getAttribute('data-item'))).toEqual(['3', '2']); // prog-b's share, in the list's order
    expect(rows.find((r) => r.getAttribute('aria-current') === 'page')?.getAttribute('data-item')).toBe('2');
    fireEvent.click(rows[0]!);
    expect(location.pathname).toBe('/waiting/3');
    expect(new URLSearchParams(location.search).get('from')).toBe('waiting:prog-b');
  });

  it('the combined list beside an item is every programme\'s share, in the combined order', () => {
    widthIs(1920);
    openAt('/waiting/4', 4);
    const beside = screen.getByRole('complementary', { name: 'The list beside this item' });
    expect(within(beside).getAllByRole('button').filter((b) => b.hasAttribute('data-item')).map((r) => r.getAttribute('data-item')))
      .toEqual(['3', '2', '4', '1']);
  });

  it.each([390, 900, 1279])('at %ipx the item is alone, with its way back and its steps', (width) => {
    widthIs(width);
    const nav = openAt('/waiting/2', 2);
    expect(screen.queryByRole('complementary', { name: 'The list beside this item' })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Back to Waiting on you' })).toBeTruthy();
    expect(within(nav).getByText('2 of 4')).toBeTruthy();
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

  it('the combined list reads its filter back from its URL, as the way back leaves it', () => {
    history.replaceState(null, '', '/waiting?programme=prog-b');
    render(<WaitingRoute store={rig()} />);
    expect(screen.queryByRole('button', { name: /Four/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Two/ })).toBeTruthy();
  });
});
