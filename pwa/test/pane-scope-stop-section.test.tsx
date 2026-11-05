// D-7902: Settings › Automation › "Stop leftovers". The card reads the coord frame (a store handed in, `coordFrameSeen`
// set by the case) and writes `{state}`; every case spies `api.setPaneScopeStop` and renders the card alone. Every word is
// `PANE_SCOPE_STOP_TEXT`, read by name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CoordStatus, MarkerState } from '../../shared/api';
import { PaneScopeStopSection } from '../src/fleet/PaneScopeStopSection';
import { COLLECT_SECTION_TEXT } from '../src/fleet/collectLaneWords';
import { COORD_CONFIRM_MS } from '../src/fleet/coordWords';
import { PANE_SCOPE_STOP_TEXT as T, isPaneScopeStopRefusal, paneScopeStopChecked, paneScopeStopMarker } from '../src/fleet/paneScopeStopWords';
import { SETTINGS_CARDS, UNCONFIRMED_TEXT } from '../src/fleet/settingsText';
import { ApiError, api } from '../src/lib/api';
import { COORD_UNSUPPORTED_TEXT } from '../src/lib/refusalWords';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const coord = (paneScopeStop?: MarkerState): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], ...(paneScopeStop === undefined ? {} : { paneScopeStop }) });
const frame = (store: FleetStore, c: CoordStatus | null): void => {
  act(() => { store.setState({ coord: c, coordFrameSeen: true }); });
};
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const shown = (marker: MarkerState | undefined): FleetStore => {
  const store = makeStore();
  render(<PaneScopeStopSection store={store} />);
  frame(store, coord(marker));
  return store;
};
const radio = (name: string): HTMLInputElement => screen.getByRole<HTMLInputElement>('radio', { name });
const group = (): HTMLElement => screen.getByRole('group', { name: T.legend });
/** The route's not-ran arm, its body exactly as `notRanSentence` writes it. */
const notRan = (): ApiError => new ApiError(502, {
  ok: false,
  error: 'fleetFailed',
  detail: 'ccd pane-scope-stop was not answered (timeout: no answer) — unmeasured, asked again on a later pass',
});
type SetAnswer = Awaited<ReturnType<typeof api.setPaneScopeStop>>;
const deferred = (): { promise: Promise<SetAnswer>; resolve: (a: SetAnswer) => void; reject: (e: unknown) => void } => {
  let resolve: (a: SetAnswer) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<SetAnswer>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('the read (D-7902)', () => {
  it('draws no choice before the first coord frame', () => {
    render(<PaneScopeStopSection store={makeStore()} />);
    expect(screen.getByRole('heading', { level: 3, name: SETTINGS_CARDS.automation.paneScopeStop.title })).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.queryByText(COLLECT_SECTION_TEXT.notAvailable)).toBeNull();
  });

  it('a frame without the field is a server older than the switch: not available, no choice', () => {
    shown(undefined);
    expect(screen.getByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toEqual([]);
  });

  it('a lost coord status offers no choice either', () => {
    const store = makeStore();
    render(<PaneScopeStopSection store={store} />);
    frame(store, null);
    expect(screen.getByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument();
  });

  it('clear reads Log only, the shipped state, and set reads Stop what is left', () => {
    const store = shown('clear');
    expect(radio(T.shadow)).toBeChecked();
    expect(radio(T.live)).not.toBeChecked();
    frame(store, coord('set'));
    expect(radio(T.live)).toBeChecked();
    expect(radio(T.shadow)).not.toBeChecked();
  });

  it('unmeasurable checks neither, says so, and either tap can replace it', () => {
    const set = vi.spyOn(api, 'setPaneScopeStop').mockResolvedValue({ ok: true, requested: 'shadow' });
    shown('unmeasurable');
    expect(screen.getByText(T.unmeasurable)).toBeInTheDocument();
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    fireEvent.click(radio(T.shadow));
    expect(set).toHaveBeenCalledWith('shadow');
  });

  it('the one reader: absence is null, and a word this build does not know is doubt, never clear', () => {
    expect(paneScopeStopMarker(null)).toBeNull();
    expect(paneScopeStopMarker({ pause: 'clear' })).toBeNull();
    expect(paneScopeStopMarker({ paneScopeStop: 'set' })).toBe('set');
    expect(paneScopeStopMarker({ paneScopeStop: 'armed' })).toBe('unmeasurable');
    expect(paneScopeStopChecked('unmeasurable')).toBeNull();
  });

  it('names neither a path nor a marker in its words', () => {
    shown('clear');
    expect(document.body.textContent ?? '').not.toMatch(/\$REG|pane-scope-stop|cgroup|tmux-spawn|\.cc-sessions/);
  });
});

describe('the write (D-7902)', () => {
  it('a tap asks once, shows the frame\'s reading until a later frame confirms it, then settles', async () => {
    const set = vi.spyOn(api, 'setPaneScopeStop').mockResolvedValue({ ok: true, requested: 'live' });
    const store = shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('live');
    expect(radio(T.shadow)).toBeChecked();   // the server's answer, never the tap
    expect(group()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(T.asked);

    frame(store, coord('set'));
    expect(radio(T.live)).toBeChecked();
    expect(group()).not.toBeDisabled();
    expect(screen.queryByText(T.asked)).toBeNull();
  });

  it('turns it off the same way', async () => {
    const set = vi.spyOn(api, 'setPaneScopeStop').mockResolvedValue({ ok: true, requested: 'shadow' });
    const store = shown('set');
    fireEvent.click(radio(T.shadow));
    await settle();
    expect(set).toHaveBeenCalledWith('shadow');
    frame(store, coord('clear'));
    expect(radio(T.shadow)).toBeChecked();
    expect(group()).not.toBeDisabled();
  });

  it('only the reading a tap asked for settles it: neither the old one again nor a new doubt', async () => {
    vi.spyOn(api, 'setPaneScopeStop').mockResolvedValue({ ok: true, requested: 'live' });
    const store = shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    frame(store, coord('clear'));
    expect(group()).toBeDisabled();
    frame(store, coord('unmeasurable'));
    expect(group()).toBeDisabled();
    expect(screen.getByText(T.asked)).toBeInTheDocument();
    frame(store, coord('set'));
    expect(group()).not.toBeDisabled();
  });

  it('no frame within the bound says so, keeps the last reading and frees the choice; a late frame retires the line', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'setPaneScopeStop').mockResolvedValue({ ok: true, requested: 'live' });
    const store = shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS - 1); });
    expect(group()).toBeDisabled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(group()).not.toBeDisabled();
    expect(radio(T.shadow)).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent(T.unconfirmed);

    frame(store, coord('set'));
    expect(radio(T.live)).toBeChecked();
    expect(screen.queryByText(T.unconfirmed)).toBeNull();
  });

  it('a confirmed tap leaves no timer to speak later', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'setPaneScopeStop').mockResolvedValue({ ok: true, requested: 'live' });
    const store = shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    frame(store, coord('set'));
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS); });
    expect(screen.queryByText(T.unconfirmed)).toBeNull();
  });

  it('a 2xx it could not read says it may have saved, and still waits for the frame', async () => {
    vi.spyOn(api, 'setPaneScopeStop').mockResolvedValue('unreadable');
    shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    expect(screen.getByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    expect(group()).toBeDisabled();
  });

  it('a box without the verb is refused in the coordination surfaces\' words, and nothing moves', async () => {
    vi.spyOn(api, 'setPaneScopeStop').mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    expect(screen.getByText(`${T.refused} (${COORD_UNSUPPORTED_TEXT})`)).toBeInTheDocument();
    expect(radio(T.shadow)).toBeChecked();
    expect(group()).not.toBeDisabled();
  });

  it('a verb that ran and died shows its own words as a refusal', async () => {
    vi.spyOn(api, 'setPaneScopeStop').mockRejectedValue(new ApiError(502, { ok: false, error: 'fleetFailed', stderr: 'no registry' }));
    shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    expect(screen.getByText(`${T.refused} (no registry)`)).toBeInTheDocument();
    expect(group()).not.toBeDisabled();
  });

  it('a verb that may never have run proves nothing: never a refusal, and no promise of a later pass', async () => {
    vi.spyOn(api, 'setPaneScopeStop').mockRejectedValue(notRan());
    shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent(new RegExp(`^${T.unanswered}$`));
    expect(screen.queryByText(new RegExp(T.refused))).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/later pass/);
    expect(group()).not.toBeDisabled();
  });

  it('stderr alone tells the two fleetFailed answers apart, an empty one included', () => {
    expect(isPaneScopeStopRefusal({ error: 'fleetFailed', detail: 'not answered' })).toBe(false);
    expect(isPaneScopeStopRefusal({ error: 'fleetFailed', stderr: '' })).toBe(true);
    expect(isPaneScopeStopRefusal({ error: 'fleetFailed', stderr: 'no registry' })).toBe(true);
    expect(isPaneScopeStopRefusal({ error: 'unsupported' })).toBe(true);
  });

  it('a lost answer after a frame read the tap says nothing under the armed switch', async () => {
    const answer = deferred();
    vi.spyOn(api, 'setPaneScopeStop').mockReturnValue(answer.promise);
    const store = shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    frame(store, coord('set'));
    answer.reject(notRan());
    await settle();
    expect(radio(T.live)).toBeChecked();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the same answer after the bound and a late frame says nothing either', async () => {
    vi.useFakeTimers();
    const answer = deferred();
    vi.spyOn(api, 'setPaneScopeStop').mockReturnValue(answer.promise);
    const store = shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS); });
    frame(store, coord('set'));
    answer.reject(new ApiError(502, { ok: false, error: 'fleetFailed', stderr: 'no registry' }));
    await settle();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('an unreadable 2xx after a frame read the tap says nothing either', async () => {
    const answer = deferred();
    vi.spyOn(api, 'setPaneScopeStop').mockReturnValue(answer.promise);
    const store = shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    frame(store, coord('set'));
    answer.resolve('unreadable');
    await settle();
    expect(screen.queryByText(UNCONFIRMED_TEXT)).toBeNull();
  });

  it('past the bound with no frame, the lost answer still speaks, in place of the unconfirmed line', async () => {
    vi.useFakeTimers();
    const answer = deferred();
    vi.spyOn(api, 'setPaneScopeStop').mockReturnValue(answer.promise);
    shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS); });
    answer.reject(notRan());
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent(new RegExp(`^${T.unanswered}$`));
  });

  it('an older tap\'s late answer leaves a newer tap\'s wait alone', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const set = vi.spyOn(api, 'setPaneScopeStop').mockReturnValueOnce(first.promise).mockReturnValueOnce(deferred().promise);
    shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS); });
    fireEvent.click(radio(T.live));
    await settle();
    expect(set).toHaveBeenCalledTimes(2);
    first.reject(notRan());
    await settle();
    expect(group()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(T.asked);
    expect(screen.queryByText(T.unanswered)).toBeNull();
  });

  it('a failure that proves nothing is never called a refusal', async () => {
    const set = vi.spyOn(api, 'setPaneScopeStop');
    set.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    expect(screen.getByText(T.unanswered)).toBeInTheDocument();
    expect(group()).not.toBeDisabled();

    set.mockRejectedValueOnce(new ApiError(504, { error: 'gateway-timeout', message: 'upstream' }));
    fireEvent.click(radio(T.live));
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent(T.unanswered);
    expect(screen.queryByText(new RegExp(T.refused))).toBeNull();
    expect(isPaneScopeStopRefusal({ error: 'gateway-timeout' })).toBe(false);
  });

  it('a tap while one is waiting asks nothing', async () => {
    const set = vi.spyOn(api, 'setPaneScopeStop').mockResolvedValue({ ok: true, requested: 'live' });
    shown('clear');
    fireEvent.click(radio(T.live));
    await settle();
    fireEvent.click(radio(T.live));
    fireEvent.click(radio(T.shadow));
    await settle();
    expect(set).toHaveBeenCalledTimes(1);
  });
});
