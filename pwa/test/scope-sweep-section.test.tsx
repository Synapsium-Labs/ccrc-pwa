// D-7994: Settings › Automation › "Leftover processes". The card reads both of the sweep's switches through its own hook
// (as the Settings frame hands it one) and writes `{on}`; every case spies `api.scopeSweep` and `api.setScopeSweepBusy`, or
// hands the card a poll of its own, and renders the card alone. Every word is `SCOPE_SWEEP_TEXT`, read by name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ScopeSweepView } from '../../shared/scope-sweep';
import { ScopeSweepSection } from '../src/fleet/ScopeSweepSection';
import { COLLECT_SECTION_TEXT } from '../src/fleet/collectLaneWords';
import { COORD_CONFIRM_MS } from '../src/fleet/coordWords';
import { useScopeSweepView, type ScopeSweepPoll } from '../src/fleet/useScopeSweepView';
import { SCOPE_SWEEP_TEXT as T, asScopeSweepView, scopeSweepChecked, scopeSweepIdleLine } from '../src/fleet/scopeSweepWords';
import { ApiError, api } from '../src/lib/api';
import { COORD_UNSUPPORTED_TEXT } from '../src/lib/refusalWords';
import { UNCONFIRMED_TEXT } from '../src/fleet/settingsText';

function Polled(): ReactNode {
  return <ScopeSweepSection poll={useScopeSweepView()} />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const view = (over: Partial<ScopeSweepView> = {}): ScopeSweepView => ({ stop: 'set', busy: 'clear', ...over });
const radio = (name: string): HTMLInputElement => screen.getByRole<HTMLInputElement>('radio', { name });
const group = (): HTMLElement => screen.getByRole('group', { name: T.legend });
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

/** A card on a poll the case owns: `show` is a read landing. */
function owned(first: ScopeSweepView): { poll: ScopeSweepPoll; show: (v: ScopeSweepView) => void } {
  const poll: ScopeSweepPoll = { view: first, failure: null, reload: vi.fn(), settle: vi.fn() };
  const { rerender } = render(<ScopeSweepSection poll={poll} />);
  return { poll, show: (v) => { rerender(<ScopeSweepSection poll={{ ...poll, view: v }} />); } };
}

type SetAnswer = Awaited<ReturnType<typeof api.setScopeSweepBusy>>;
const deferred = (): { promise: Promise<SetAnswer>; resolve: (a: SetAnswer) => void; reject: (e: unknown) => void } => {
  let resolve: (a: SetAnswer) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<SetAnswer>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
/** The route's not-ran arm, its body exactly as `notRanSentence` writes it. */
const notRan = (): ApiError => new ApiError(502, {
  ok: false,
  error: 'fleetFailed',
  detail: 'ccd scope-sweep-busy was not answered (timeout: no answer) — unmeasured, asked again on a later pass',
});

describe('the read: the card says what the registry says (D-7994)', () => {
  it('shadow: both switches are visible, Record only checked, the idle line says it is stopping', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    expect(radio(T.on).checked).toBe(false);
    expect(screen.getByRole('heading', { level: 3, name: T.title })).toBeInTheDocument();
    expect(screen.getByText(`${T.idleLead}: ${T.idleOn}`)).toBeInTheDocument();
    expect(screen.getByText(T.offNote)).toBeInTheDocument();
    expect(screen.getByText(T.onNote)).toBeInTheDocument();
    expect(screen.getByText(T.when)).toBeInTheDocument();
    expect(screen.queryByText(T.needsIdle)).toBeNull();
  });

  it.each<[ScopeSweepView, string, boolean, boolean]>([
    [{ stop: 'clear', busy: 'clear' }, T.idleOff, false, true],
    [{ stop: 'set', busy: 'clear' }, T.idleOn, false, true],
    [{ stop: 'set', busy: 'set' }, T.idleOn, true, false],
    [{ stop: 'clear', busy: 'set' }, T.idleOff, true, false],
  ])('%j reads as its two markers, and the radio is the busy marker', (v, idle, on, off) => {
    owned(v);
    expect(screen.getByText(`${T.idleLead}: ${idle}`)).toBeInTheDocument();
    expect(radio(T.on).checked).toBe(on);
    expect(radio(T.off).checked).toBe(off);
  });

  it('the idle switch has no control here: its marker is the operator\'s by hand, so only the busy radios exist', () => {
    owned(view({ stop: 'clear' }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('Stop them with idle leftovers not being stopped: the card says it has no effect yet', () => {
    owned(view({ stop: 'clear', busy: 'set' }));
    expect(screen.getByText(T.needsIdle)).toBeInTheDocument();
    expect(screen.queryByText(T.when)).toBeNull();
  });

  it('Stop them with the sweep armed: nothing more to say', () => {
    owned(view({ busy: 'set' }));
    expect(screen.queryByText(T.needsIdle)).toBeNull();
    expect(screen.queryByText(T.when)).toBeNull();
  });

  it('a registry that cannot be listed checks neither, and says so; either tap can still replace it', () => {
    owned({ stop: 'unmeasurable', busy: 'unmeasurable' });
    expect(screen.getByText(T.unmeasured)).toBeInTheDocument();
    expect(radio(T.on).checked).toBe(false);
    expect(radio(T.off).checked).toBe(false);
    expect(radio(T.on).disabled).toBe(false);
    expect(screen.getByText(`${T.idleLead}: ${T.idleUnread}`)).toBeInTheDocument();
    expect(screen.queryByText(T.when)).toBeNull();
  });

  it('a failed poll keeps the last reading and says it may be out of date', () => {
    render(<ScopeSweepSection poll={{ view: view(), failure: 'failed', reload: vi.fn(), settle: vi.fn() }} />);
    expect(screen.getByText(T.stale)).toBeInTheDocument();
    expect(radio(T.off).checked).toBe(true);
  });

  it('an older server\'s 404 replaces the body with the one not-available line', async () => {
    vi.spyOn(api, 'scopeSweep').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    render(<Polled />);
    await waitFor(() => expect(screen.getByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument());
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('a failed first read says it could not be read', async () => {
    vi.spyOn(api, 'scopeSweep').mockRejectedValue(new TypeError('failed to fetch'));
    render(<Polled />);
    await waitFor(() => expect(screen.getByText(T.unread)).toBeInTheDocument());
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('names neither a path nor a marker in its words', () => {
    for (const word of Object.values(T)) expect(word).not.toMatch(/-live|-paused|\/|~|\$REG|--state/);
  });
});

describe('the write (D-7994)', () => {
  it('Stop them goes out as {on:true} and the reply is what the card then shows', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setScopeSweepBusy').mockResolvedValue(view({ busy: 'set' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    fireEvent.click(radio(T.on));
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ on: true });
    expect(screen.queryByRole('status')).toBeNull();
    expect(group()).not.toBeDisabled();
  });

  it('Record only goes out as {on:false}', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view({ busy: 'set' }));
    const set = vi.spyOn(api, 'setScopeSweepBusy').mockResolvedValue(view());
    render(<Polled />);
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    fireEvent.click(radio(T.off));
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    expect(set).toHaveBeenCalledWith({ on: false });
  });

  it('a tap holds the choice and shows the reading until the answer lands, and a second tap asks nothing', async () => {
    const write = deferred();
    const set = vi.spyOn(api, 'setScopeSweepBusy').mockReturnValue(write.promise);
    const { poll } = owned(view());
    fireEvent.click(radio(T.on));
    expect(screen.getByRole('status')).toHaveTextContent(T.asked);
    expect(radio(T.off).checked, 'the tap is never shown as landed').toBe(true);
    expect(group()).toBeDisabled();
    fireEvent.click(radio(T.on));
    expect(set).toHaveBeenCalledTimes(1);
    await act(async () => { write.resolve({ ...view({ busy: 'set' }) }); await write.promise; });
    expect(poll.settle).toHaveBeenCalledWith(view({ busy: 'set' }));
    expect(screen.queryByText(T.asked)).toBeNull();
    expect(group()).not.toBeDisabled();
  });

  it('an answer that does not read what the tap asked says so, and settles on what it reads', async () => {
    vi.spyOn(api, 'setScopeSweepBusy').mockResolvedValue(view());
    const { poll } = owned(view());
    fireEvent.click(radio(T.on));
    await flush();
    expect(poll.settle).toHaveBeenCalledWith(view());
    expect(screen.getByRole('status')).toHaveTextContent(T.unconfirmed);
    expect(radio(T.off).checked).toBe(true);
  });

  it('no answer within the bound says so, keeps the last reading, frees the choice and re-reads', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'setScopeSweepBusy').mockReturnValue(deferred().promise);
    const { poll, show } = owned(view());
    fireEvent.click(radio(T.on));
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS - 1); });
    expect(group()).toBeDisabled();
    expect(poll.reload).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('status')).toHaveTextContent(T.unconfirmed);
    expect(radio(T.off).checked).toBe(true);
    expect(group()).not.toBeDisabled();
    expect(poll.reload).toHaveBeenCalledTimes(1);
    show(view({ busy: 'set' }));   // the late read retires the line
    expect(screen.queryByRole('status')).toBeNull();
    expect(radio(T.on).checked).toBe(true);
  });

  it('a read that shows the tap settles the wait, and leaves no timer to speak later', () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'setScopeSweepBusy').mockReturnValue(deferred().promise);
    const { poll, show } = owned(view());
    fireEvent.click(radio(T.on));
    show(view({ busy: 'set' }));
    expect(screen.queryByText(T.asked)).toBeNull();
    expect(group()).not.toBeDisabled();
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS * 2); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(poll.reload).not.toHaveBeenCalled();
  });

  it('a lost answer after a read showed the tap says nothing under the armed switch', async () => {
    const write = deferred();
    vi.spyOn(api, 'setScopeSweepBusy').mockReturnValue(write.promise);
    const { poll, show } = owned(view());
    fireEvent.click(radio(T.on));
    show(view({ busy: 'set' }));
    await act(async () => { write.reject(notRan()); await write.promise.catch(() => undefined); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(poll.settle).not.toHaveBeenCalled();
  });

  it('past the bound with no read, the answer still lands: a good one settles, in place of the unconfirmed line', async () => {
    vi.useFakeTimers();
    const write = deferred();
    vi.spyOn(api, 'setScopeSweepBusy').mockReturnValue(write.promise);
    const { poll } = owned(view());
    fireEvent.click(radio(T.on));
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS); });
    expect(screen.getByRole('status')).toHaveTextContent(T.unconfirmed);
    await act(async () => { write.resolve(view({ busy: 'set' })); await write.promise; });
    expect(poll.settle).toHaveBeenCalledWith(view({ busy: 'set' }));
    expect(screen.queryByText(T.unconfirmed)).toBeNull();
  });

  it('an older tap\'s late answer leaves a newer tap\'s wait alone', async () => {
    vi.useFakeTimers();
    const older = deferred();
    const newer = deferred();
    vi.spyOn(api, 'setScopeSweepBusy').mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { poll } = owned({ stop: 'unmeasurable', busy: 'unmeasurable' });
    fireEvent.click(radio(T.on));
    act(() => { vi.advanceTimersByTime(COORD_CONFIRM_MS); });
    fireEvent.click(radio(T.off));
    await act(async () => { older.resolve(view({ busy: 'set' })); await older.promise; });
    expect(poll.settle).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(T.asked);
    expect(group()).toBeDisabled();
    await act(async () => { newer.resolve(view()); await newer.promise; });
    expect(poll.settle).toHaveBeenCalledWith(view());
  });

  it('a box without the verb is refused in the coordination surfaces\' words, and re-reads', async () => {
    vi.spyOn(api, 'setScopeSweepBusy').mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    const { poll } = owned(view());
    fireEvent.click(radio(T.on));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(`${T.refused} (${COORD_UNSUPPORTED_TEXT})`);
    expect(radio(T.off).checked, 'the tap is never shown as landed').toBe(true);
    expect(poll.reload).toHaveBeenCalledTimes(1);
  });

  it('a verb that ran and died says refused, with its own words', async () => {
    vi.spyOn(api, 'setScopeSweepBusy').mockRejectedValue(new ApiError(502, { ok: false, error: 'fleetFailed', stderr: 'could not raise' }));
    owned(view());
    fireEvent.click(radio(T.on));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(T.refused);
    expect(screen.getByRole('status')).toHaveTextContent('could not raise');
  });

  it('a verb that may never have run proves nothing: never a refusal, and no promise of a later pass', async () => {
    vi.spyOn(api, 'setScopeSweepBusy').mockRejectedValue(notRan());
    const { poll } = owned(view());
    fireEvent.click(radio(T.on));
    await flush();
    expect(screen.getByRole('status').textContent).toBe(T.unanswered);
    expect(poll.reload).toHaveBeenCalledTimes(1);
  });

  it('a network failure is unanswered, never a refusal', async () => {
    vi.spyOn(api, 'setScopeSweepBusy').mockRejectedValue(new TypeError('failed to fetch'));
    owned(view());
    fireEvent.click(radio(T.on));
    await flush();
    expect(screen.getByRole('status').textContent).toBe(T.unanswered);
  });

  it('a reply it cannot read says it may have saved, and re-reads', async () => {
    vi.spyOn(api, 'setScopeSweepBusy').mockResolvedValue('unreadable');
    const { poll } = owned(view());
    fireEvent.click(radio(T.on));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(UNCONFIRMED_TEXT);
    expect(poll.reload).toHaveBeenCalledTimes(1);
    expect(poll.settle).not.toHaveBeenCalled();
  });
});

describe('scopeSweepWords', () => {
  it('reads a whole view, and nothing else', () => {
    expect(asScopeSweepView(view())).toEqual(view());
    expect(asScopeSweepView({ ok: true, ...view() })).toEqual(view());
    for (const bad of [null, {}, { stop: 'set' }, { stop: 'on', busy: 'clear' }, { stop: 'set', busy: true }]) expect(asScopeSweepView(bad)).toBeNull();
  });
  it('only a measured marker checks a radio', () => {
    expect(scopeSweepChecked(view({ busy: 'set' }))).toBe('on');
    expect(scopeSweepChecked(view({ busy: 'clear' }))).toBe('off');
    expect(scopeSweepChecked(view({ busy: 'unmeasurable' }))).toBeNull();
  });
  it('the idle line reads the idle marker alone', () => {
    expect(scopeSweepIdleLine(view({ stop: 'clear', busy: 'set' }))).toBe(`${T.idleLead}: ${T.idleOff}`);
    expect(scopeSweepIdleLine(view({ stop: 'unmeasurable' }))).toBe(`${T.idleLead}: ${T.idleUnread}`);
  });
});
