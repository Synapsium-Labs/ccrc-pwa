// A cold start draws the device's copy of the Waiting on you list, marked as not current, with an item's acts blocked until
// the live list lands (console speed, Task C4; spec §2.6, Figure 8, D16; the operator's ruling on item 34: "Show it, marked as
// not current until live data replaces it."). Each case starts the way a cold start does: the copy is saved on the device
// FIRST, then a fresh store is made, which reads it once.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/lib/apiError';
import { api } from '../src/lib/api';
import { saveFleetSnapshot, saveWaitingSnapshot } from '../src/lib/offline';
import { createFleetStore } from '../src/stores/fleet';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { placeBadge, useNavBadges } from '../src/fleet/navBadges';
import { ItemRoute, WaitingRoute } from '../src/ledgers/WaitingRoutes';
import { EMPTY_WORD, GONE_WORD, NOT_CURRENT_ACTS_WORD, NO_FRAME_WORD, SAVED_ROWS_WORD } from '../src/ledgers/ledgerWords';
import { fleetSession } from './fleetFixture';
import { MIN, itemView, runRow, waitingView } from './ledgersFixture';

const makeSocket = (): WebSocket => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket;

const savedItem = itemView({ id: 7, title: 'Saved item', kind: 'value' });
const liveItem = itemView({ id: 8, title: 'Live item' });
const savedList = waitingView({ items: [savedItem] });
const liveList = waitingView({ items: [liveItem] });

/** A cold start: the device's copy saved four minutes ago (and, with `rows`, the fleet snapshot), then a fresh store. */
function coldStart({ list = savedList, rows = false }: { list?: typeof savedList | null; rows?: boolean } = {}) {
  if (list !== null) saveWaitingSnapshot(list, Date.now() - 4 * MIN);
  if (rows) saveFleetSnapshot([fleetSession({ id: 'sess-a' })]);
  return createFleetStore({ makeSocket });
}

const statusTexts = (): string[] => screen.queryAllByRole('status').map((s) => s.textContent ?? '');

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); history.replaceState(null, '', '/'); });

describe('the Waiting on you page on a cold start', () => {
  it('a cold start with a saved list draws it at once, with the saved line and its age', () => {
    const store = coldStart({ rows: true });
    render(<WaitingRoute store={store} />);
    expect(screen.getByText('Saved item')).toBeTruthy();
    expect(statusTexts()).toContain('Saved on this device 4m ago, not current. Waiting for live data…');
    expect(screen.queryByText(NO_FRAME_WORD)).toBeNull();
    // The copy never becomes the page's list.
    expect(store.getState().waiting).toBeNull();
  });

  it('the live list replaces it and the line goes', () => {
    const store = coldStart({ rows: true });
    render(<WaitingRoute store={store} />);
    act(() => store.setState({ waiting: liveList, fleetFrameSeen: true, sessions: [] }));
    expect(screen.getByText('Live item')).toBeTruthy();
    expect(screen.queryByText('Saved item')).toBeNull();
    expect(screen.queryByText(/not current/)).toBeNull();
  });

  it('a live list with no live rows yet draws with the saved-rows line', () => {
    const store = coldStart({ rows: true });
    render(<WaitingRoute store={store} />);
    act(() => store.setState({ waiting: liveList }));
    expect(screen.getByText('Live item')).toBeTruthy();
    expect(statusTexts()).toContain(SAVED_ROWS_WORD);
  });

  // Review 1561 F4: a saved source never says "Nothing needs you.": the rows or the list are the device's, so an empty
  // result is not a fact. The waiting line stands under the not-current line instead.
  it('a heard empty list with saved rows that ask nothing says it is waiting, never "Nothing needs you."', () => {
    const store = coldStart({ list: null, rows: true }); // the device's one row is not asking a question
    render(<WaitingRoute store={store} />);
    act(() => store.setState({ waiting: waitingView() }));
    expect(statusTexts()).toContain(SAVED_ROWS_WORD);
    expect(screen.getByText(NO_FRAME_WORD)).toBeTruthy();
    expect(screen.queryByText(EMPTY_WORD)).toBeNull();
  });

  it('a saved empty list says it is waiting, never "Nothing needs you."', () => {
    const store = coldStart({ list: waitingView(), rows: true });
    render(<WaitingRoute store={store} />);
    expect(statusTexts()[0]).toMatch(/^Saved on this device/);
    expect(screen.getByText(NO_FRAME_WORD)).toBeTruthy();
    expect(screen.queryByText(EMPTY_WORD)).toBeNull();
  });

  it('nothing saved keeps "Waiting for the first update from the server…"', () => {
    const store = coldStart({ list: null, rows: true });
    render(<WaitingRoute store={store} />);
    expect(statusTexts()).toContain(NO_FRAME_WORD);
    expect(screen.queryByText(/not current/)).toBeNull();
  });

  // Review 1556 R1: with no fleet snapshot on the device, nothing was saved, so nothing is drawn "as last saved".
  it('no fleet snapshot on the device: a list that lands before the fleet frame draws the waiting line', () => {
    const store = coldStart({ list: null });
    render(<WaitingRoute store={store} />);
    act(() => store.setState({ waiting: waitingView() }));
    expect(statusTexts()).toContain(NO_FRAME_WORD);
    expect(screen.queryByText('Nothing needs you.')).toBeNull();
    expect(screen.queryByText(/not current/)).toBeNull();
  });

  it('no fleet snapshot on the device: a saved list alone draws the waiting line', () => {
    const store = coldStart();
    render(<WaitingRoute store={store} />);
    expect(statusTexts()).toContain(NO_FRAME_WORD);
    expect(screen.queryByText('Saved item')).toBeNull();
  });

  it('a box with no coordination database says so, not the saved list', async () => {
    vi.spyOn(api, 'waiting').mockRejectedValue(new ApiError(503, { ok: false, error: 'not-configured' }));
    const store = coldStart({ rows: true });
    render(<WaitingRoute store={store} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/coordination/i);
    expect(screen.queryByText('Saved item')).toBeNull();
    expect(screen.queryByText(/not current/)).toBeNull();
  });

  it('the Waiting badge counts nothing before live data', () => {
    const store = coldStart({ rows: true });
    // The fleet's live rows have landed; the list has not.
    act(() => store.setState({ fleetFrameSeen: true, sessions: [] }));
    const wrapper = ({ children }: { children?: ReactNode }) => <FleetChromeProvider store={store}>{children}</FleetChromeProvider>;
    const { result } = renderHook(() => useNavBadges(), { wrapper });
    expect(result.current.waitingItems).toBeNull();
    expect(placeBadge('waiting', result.current).count).toBe(0);
  });
});

describe('an item opened on a cold start', () => {
  const secretItem = itemView({
    id: 9, kind: 'secret', title: 'Paste the publish token', secretSlot: 'npm-token',
    secretSet: { at: Date.now() - 10 * MIN, tail: 'ab12', masked: true },
  });

  /** The secret panel's field, once its sign-in read has landed: from then on Save is held by `current` alone (review
   *  1556 R4 X2), never by a panel still asking. */
  const secretFieldReady = async (): Promise<HTMLInputElement> => {
    const field = screen.getByLabelText(/secret|value|token/i, { selector: 'input' }) as HTMLInputElement;
    await waitFor(() => expect(field.disabled).toBe(false));
    return field;
  };

  it('an item from the saved copy draws with Mark done, Dismiss, Save and Remove disabled and says why', async () => {
    const store = coldStart({ list: waitingView({ items: [savedItem, secretItem] }) });
    const first = render(<ItemRoute id={7} store={store} />);
    expect(screen.getByText('Saved item')).toBeTruthy();
    expect(statusTexts()).toContain('Saved on this device 4m ago, not current. Waiting for live data…');
    expect((screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(NOT_CURRENT_ACTS_WORD)).toHaveLength(1);
    // The input stays enabled, so an answer can be typed while waiting; Mark done stays off with one typed (R4 X10).
    expect((screen.getByRole('textbox', { name: /your value/i }) as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole('textbox', { name: /your value/i }), { target: { value: '4' } });
    expect((screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement).disabled).toBe(true);
    first.unmount();

    // Dismiss is drawn for a programme the runs frame says has ended.
    act(() => store.setState({ runsFrameSeen: true, runs: [] }));
    const second = render(<ItemRoute id={7} store={store} />);
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
    second.unmount();

    act(() => store.setState({ runsFrameSeen: false, runs: [] }));
    render(<ItemRoute id={9} store={store} />);
    fireEvent.change(await secretFieldReady(), { target: { value: 'a-value' } });
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /remove/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(NOT_CURRENT_ACTS_WORD)).toHaveLength(1);
  });

  it('clicking a disabled act sends nothing', async () => {
    const tick = vi.spyOn(api, 'tickItem');
    const dismiss = vi.spyOn(api, 'dismissItem');
    const save = vi.spyOn(api, 'saveItemSecret');
    const remove = vi.spyOn(api, 'removeStoredSecret');
    const store = coldStart({ list: waitingView({ items: [savedItem, secretItem] }) });
    const first = render(<ItemRoute id={7} store={store} />);
    fireEvent.change(screen.getByRole('textbox', { name: /your value/i }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    first.unmount();
    act(() => store.setState({ runsFrameSeen: true, runs: [] }));
    const second = render(<ItemRoute id={7} store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    second.unmount();
    act(() => store.setState({ runsFrameSeen: false, runs: [] }));
    render(<ItemRoute id={9} store={store} />);
    const field = await secretFieldReady();
    fireEvent.change(field, { target: { value: 'a-value' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    // Nothing went out, and no confirmation opened for a removal.
    await new Promise((r) => setTimeout(r, 0));
    expect(tick).toHaveBeenCalledTimes(0);
    expect(dismiss).toHaveBeenCalledTimes(0);
    expect(save).toHaveBeenCalledTimes(0);
    expect(remove).toHaveBeenCalledTimes(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('when the live list lands, the same item\'s acts open and a typed answer is kept', async () => {
    const tick = vi.spyOn(api, 'tickItem').mockResolvedValue({ ok: true, item: { ...savedItem, state: 'checking' } });
    vi.spyOn(api, 'waiting').mockResolvedValue({ ok: true, waiting: savedList });
    const store = coldStart();
    render(<ItemRoute id={7} store={store} />);
    fireEvent.change(screen.getByRole('textbox', { name: /your value/i }), { target: { value: '4' } });
    act(() => store.setState({ waiting: savedList }));
    expect(screen.queryByText(/not current/)).toBeNull();
    expect(screen.queryByText(NOT_CURRENT_ACTS_WORD)).toBeNull();
    expect((screen.getByRole('textbox', { name: /your value/i }) as HTMLInputElement).value).toBe('4');
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(false);
    fireEvent.click(done);
    await waitFor(() => expect(tick).toHaveBeenCalledWith(7, '4'));
  });

  // Review 1556 R4 X8: the item's twin of the list's case.
  it('an item on a box with no coordination database says so, not the saved copy', async () => {
    vi.spyOn(api, 'waiting').mockRejectedValue(new ApiError(503, { ok: false, error: 'not-configured' }));
    const store = coldStart();
    render(<ItemRoute id={7} store={store} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/coordination/i);
    expect(screen.queryByText('Saved item')).toBeNull();
    expect(screen.queryByText(/not current/)).toBeNull();
  });

  // Review 1556 R4 X7 (departure c4-item-not-in-copy-waits): only the live list can say an item is gone.
  it('an item the saved copy does not hold keeps waiting, never "gone"', () => {
    const store = coldStart();
    render(<ItemRoute id={99} store={store} />);
    expect(statusTexts()).toContain(NO_FRAME_WORD);
    expect(screen.queryByText(GONE_WORD)).toBeNull();
  });

  // Review 1556 M3: the saved item's band draws its Spec link from the copy, as the list does.
  it('the saved item\'s band links the spec the copy pins', () => {
    const goals = { program: 'prog-a', specPath: 'docs/superpowers/specs/2026-10-31-prog-a-design.md', inShort: null, inShortAt: null, modifications: [] };
    const store = coldStart({ list: waitingView({ items: [savedItem], goals: [goals] as never }) });
    act(() => store.setState({ runsFrameSeen: true, runs: [runRow({ id: 1, program: 'prog-a', homeProject: 'project-a' } as never)] }));
    render(<ItemRoute id={7} store={store} />);
    expect(screen.getByRole('link', { name: /^Spec for/ }).getAttribute('href')).toBe('/docs/project-a/specs/2026-10-31-prog-a-design.md');
  });

  it('the item strip on a saved copy has the way back alone', () => {
    const store = coldStart({ list: waitingView({ items: [savedItem, itemView({ id: 10, title: 'Another saved item' })] }) });
    render(<ItemRoute id={7} store={store} />);
    const strip = screen.getByRole('navigation');
    expect(within(strip).getAllByRole('button')).toHaveLength(1);
    expect(within(strip).queryByRole('button', { name: /next/i })).toBeNull();
    expect(within(strip).queryByRole('button', { name: /previous/i })).toBeNull();
  });
});
