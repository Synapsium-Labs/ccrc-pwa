// D-7319: Settings › Automation › "Dispatches that never came back". The card reads the switch through its own hook (as
// the Settings frame hands it one) and writes `{choice}`; every case spies `api.dispatchAbandon` and
// `api.setDispatchAbandon` and renders the card alone. Every word is L0's `DISPATCH_ABANDON_TEXT`, read by name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DISPATCH_ABANDON_TEXT as T, type DispatchAbandonView } from '../../shared/dispatch-abandon';
import { DispatchAbandonSection } from '../src/fleet/DispatchAbandonSection';
import { useDispatchAbandonView } from '../src/fleet/useDispatchAbandonView';
import { asDispatchAbandonView, dispatchAbandonLines } from '../src/fleet/dispatchAbandonWords';
import { ApiError, api } from '../src/lib/api';
import { UNCONFIRMED_TEXT } from '../src/fleet/settingsText';

function Polled(): ReactNode {
  return <DispatchAbandonSection poll={useDispatchAbandonView()} />;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const view = (over: Partial<DispatchAbandonView> = {}): DispatchAbandonView =>
  ({ stored: 'on', detail: null, armed: true, boundMs: 900_000, updatedAt: 0, ...over });
const radio = (name: string): HTMLInputElement => screen.getByRole('radio', { name }) as HTMLInputElement;

describe('the Dispatches that never came back card (D-7319)', () => {
  it('a seeded server reads On: the On radio checked, the bound and the pause said under it', async () => {
    vi.spyOn(api, 'dispatchAbandon').mockResolvedValue(view());
    render(<Polled />);
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    expect(radio(T.off).checked).toBe(false);
    expect(screen.getByRole('heading', { level: 3, name: T.title })).toBeInTheDocument();
    expect(screen.getByText(T.bound('15 min'))).toBeInTheDocument();
    expect(screen.getByText(T.pauseNote)).toBeInTheDocument();
    expect(screen.getByText(T.onNote)).toBeInTheDocument();
  });

  it('Off goes out as {choice:"off"} and the reply is what the card then shows', async () => {
    vi.spyOn(api, 'dispatchAbandon').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setDispatchAbandon').mockResolvedValue(view({ stored: 'off', armed: false }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    fireEvent.click(radio(T.off));
    expect(set).toHaveBeenCalledWith({ choice: 'off' });
    await waitFor(() => expect(radio(T.off).checked).toBe(true));
  });

  it('a refused write says so under the choice and re-reads; the checked radio stays the server\'s', async () => {
    const read = vi.spyOn(api, 'dispatchAbandon').mockResolvedValue(view());
    vi.spyOn(api, 'setDispatchAbandon').mockRejectedValue(
      new ApiError(503, { ok: false, error: 'state-unreadable', detail: 'no such table' }));
    render(<Polled />);
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    fireEvent.click(radio(T.off));
    expect(await screen.findByText(`${T.refused} (no such table)`)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio(T.on).checked).toBe(true);
  });

  it('an unreadable 2xx is not a refusal: it may have landed, and the card re-reads', async () => {
    const read = vi.spyOn(api, 'dispatchAbandon').mockResolvedValue(view());
    vi.spyOn(api, 'setDispatchAbandon').mockResolvedValue('unreadable');
    render(<Polled />);
    await waitFor(() => expect(radio(T.on).checked).toBe(true));
    fireEvent.click(radio(T.off));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('a stored token this build does not know checks neither radio and says nothing is abandoned', async () => {
    vi.spyOn(api, 'dispatchAbandon').mockResolvedValue(view({ stored: 'unknown', armed: false }));
    render(<Polled />);
    expect(await screen.findByText(T.unknown)).toBeInTheDocument();
    expect(radio(T.on).checked).toBe(false);
    expect(radio(T.off).checked).toBe(false);
  });

  it('a server without the route (404 not-found) shows only "Not available on this server."', async () => {
    vi.spyOn(api, 'dispatchAbandon').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    render(<Polled />);
    expect(await screen.findByText('Not available on this server.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('dispatchAbandonWords', () => {
  it('the guard takes a whole view and refuses a partial or mistyped one', () => {
    expect(asDispatchAbandonView(view())).toEqual(view());
    expect(asDispatchAbandonView({ ...view(), stored: 'maybe' })).toBeNull();
    expect(asDispatchAbandonView({ ...view(), armed: 'yes' })).toBeNull();
    expect(asDispatchAbandonView({ ...view(), boundMs: undefined })).toBeNull();
    expect(asDispatchAbandonView(null)).toBeNull();
  });

  it('an unreadable switch is said amber with the server\'s detail, before the bound', () => {
    expect(dispatchAbandonLines(view({ stored: 'unreadable', detail: 'disk I/O error', armed: false }))[0])
      .toEqual({ text: `${T.unreadable} (disk I/O error)`, tone: 'warn' });
    expect(dispatchAbandonLines(view({ boundMs: 5_400_000 })).map((l) => l.text)).toEqual([T.bound('1 h 30 min'), T.pauseNote]);
  });
});
