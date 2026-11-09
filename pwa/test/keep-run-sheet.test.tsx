// The "Keep the run" sheet of an end-request item (runs rebuild §10, Q4; D-8076). The words are the spec's:
// "Keep run 1009? The asker is told." Confirm: Keep the run. Cancel: Back. Success: the toast "Kept run 1009."
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { KeepRunSheet } from '../src/fleet/KeepRunSheet';
import { ApiError } from '../src/lib/apiError';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const TARGET = { itemId: 31, runId: 1009 };

describe('KeepRunSheet', () => {
  it('renders nothing with no target', () => {
    render(<KeepRunSheet target={null} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says Keep run 1009? and that the asker is told, and sends nothing until the confirm', () => {
    const decline = vi.fn();
    render(<KeepRunSheet target={TARGET} onClose={() => {}} decline={decline} />);
    expect(screen.getByText('Keep run 1009?')).toBeInTheDocument();
    expect(screen.getByText('The asker is told.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep the run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(decline).not.toHaveBeenCalled();
  });

  it('the confirm declines that item, toasts Kept run 1009. and closes', async () => {
    const decline = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(<><ToastHost /><KeepRunSheet target={TARGET} onClose={onClose} onDone={onDone} decline={decline} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the run' }));
    await waitFor(() => expect(decline).toHaveBeenCalledWith(31));
    expect(await screen.findByText('Kept run 1009.')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back closes without sending', () => {
    const decline = vi.fn();
    const onClose = vi.fn();
    render(<KeepRunSheet target={TARGET} onClose={onClose} decline={decline} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(decline).not.toHaveBeenCalled();
  });

  it('a refused decline is said in the sheet, which stays open and can be tried again', async () => {
    const decline = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'not-open' }));
    const onClose = vi.fn();
    render(<KeepRunSheet target={TARGET} onClose={onClose} decline={decline} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not open any more/);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Keep the run' })).not.toBeDisabled();
  });

  it('an answer for a target no longer shown does not close or toast', async () => {
    let resolve!: (v: unknown) => void;
    const decline = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    const onClose = vi.fn();
    const { rerender } = render(<KeepRunSheet target={TARGET} onClose={onClose} decline={decline} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the run' }));
    rerender(<KeepRunSheet target={null} onClose={onClose} decline={decline} />);
    resolve({ ok: true });
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });
});
