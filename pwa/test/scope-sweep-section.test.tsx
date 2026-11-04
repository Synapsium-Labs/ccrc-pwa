// D-7994: Settings › Automation › "Leftover processes". The card reads both of the sweep's switches through its own hook
// (as the Settings frame hands it one) and writes `{on}`; every case spies `api.scopeSweep` and `api.setScopeSweepBusy`
// and renders the card alone. Every word is L0's `SCOPE_SWEEP_TEXT`, read by name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SCOPE_SWEEP_TEXT as T, type ScopeSweepView } from '../../shared/scope-sweep';
import { ScopeSweepSection } from '../src/fleet/ScopeSweepSection';
import { useScopeSweepView } from '../src/fleet/useScopeSweepView';
import { asScopeSweepView, scopeSweepChecked } from '../src/fleet/scopeSweepWords';
import { ApiError, api } from '../src/lib/api';
import { UNCONFIRMED_TEXT } from '../src/fleet/settingsText';

function Polled(): ReactNode {
  return <ScopeSweepSection poll={useScopeSweepView()} />;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const view = (over: Partial<ScopeSweepView> = {}): ScopeSweepView => ({ stop: 'set', busy: 'clear', ...over });
const radio = (name: string): HTMLInputElement => screen.getByRole('radio', { name }) as HTMLInputElement;

describe('the Leftover processes card (D-7994)', () => {
  it('shadow: both switches are visible, Record only checked, the idle line says it is stopping', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    expect(radio(T.on).checked).toBe(false);
    expect(screen.getByRole('heading', { level: 3, name: T.title })).toBeInTheDocument();
    expect(screen.getByText(T.idleLead, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(T.idleOn, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(T.offNote)).toBeInTheDocument();
    expect(screen.getByText(T.onNote)).toBeInTheDocument();
    expect(screen.getByText(T.when)).toBeInTheDocument();
    expect(screen.queryByText(T.needsIdle)).toBeNull();
  });

  it('the idle switch has no control here: its marker is the operator\'s by hand, so only the busy radios exist', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view({ stop: 'clear' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText(T.idleOff, { exact: false })).toBeInTheDocument();
  });

  it('Stop them goes out as {on:true} and the reply is what the card then shows', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setScopeSweepBusy').mockResolvedValue(view({ busy: 'set' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    fireEvent.click(radio(T.on));
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    expect(set).toHaveBeenCalledWith({ on: true });
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

  it('Stop them with idle leftovers not being stopped: the card says it has no effect yet', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view({ stop: 'clear', busy: 'set' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    expect(screen.getByText(T.needsIdle)).toBeInTheDocument();
  });

  it('a registry that cannot be listed checks neither, and says so; either tap can still replace it', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view({ stop: 'unmeasurable', busy: 'unmeasurable' }));
    render(<Polled />);
    await waitFor(() => expect(screen.getByText(T.unmeasured)).toBeInTheDocument());
    expect(radio(T.on).checked).toBe(false);
    expect(radio(T.off).checked).toBe(false);
    expect(screen.getByText(T.idleUnread, { exact: false })).toBeInTheDocument();
  });

  it('a refused write says so under the choice, with the server\'s detail, and re-reads', async () => {
    const read = vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    vi.spyOn(api, 'setScopeSweepBusy').mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported', detail: 'this ccd has no such verb' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    fireEvent.click(radio(T.on));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(T.refused));
    expect(screen.getByRole('status')).toHaveTextContent('this ccd has no such verb');
    expect(radio(T.off).checked, 'the tap is never shown as landed').toBe(true);
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
  });

  it('a verb that failed says refused, with its own words', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    vi.spyOn(api, 'setScopeSweepBusy').mockRejectedValue(new ApiError(502, { ok: false, error: 'fleetFailed', stderr: 'could not raise' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    fireEvent.click(radio(T.on));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`${T.refused} (could not raise)`));
  });

  it('a verb that never ran is unconfirmed: whether the switch moved is not known', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    vi.spyOn(api, 'setScopeSweepBusy').mockRejectedValue(new ApiError(502, { ok: false, error: 'fleetFailed', detail: 'the link dropped' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    fireEvent.click(radio(T.on));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`${T.unanswered} (the link dropped)`));
  });

  it('a network failure is unconfirmed, never a refusal', async () => {
    vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    vi.spyOn(api, 'setScopeSweepBusy').mockRejectedValue(new TypeError('failed to fetch'));
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    fireEvent.click(radio(T.on));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(T.unanswered));
  });

  it('a reply it cannot read says unconfirmed and re-reads', async () => {
    const read = vi.spyOn(api, 'scopeSweep').mockResolvedValue(view());
    vi.spyOn(api, 'setScopeSweepBusy').mockResolvedValue('unreadable');
    render(<Polled />);
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
    fireEvent.click(radio(T.on));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(UNCONFIRMED_TEXT));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
  });

  it('an older server\'s 404 replaces the body with the one not-available line', async () => {
    vi.spyOn(api, 'scopeSweep').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    render(<Polled />);
    await waitFor(() => expect(screen.queryByRole('radio')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: T.title })).toBeInTheDocument());
  });

  it('a failed first read says it could not be read', async () => {
    vi.spyOn(api, 'scopeSweep').mockRejectedValue(new TypeError('failed to fetch'));
    render(<Polled />);
    await waitFor(() => expect(screen.getByText(T.unread)).toBeInTheDocument());
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
});
