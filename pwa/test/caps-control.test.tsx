// The operator's dial on the two coordination caps. Its shape is CoordBanner's
// beside it — injectable props defaulting to the `api` singleton, a render gate
// that shows nothing until the first read lands — with ONE deliberate
// departure: the pause toggle refuses to be optimistic because a
// `{type:'coord'}` frame exists to settle it, and no frame carries caps, so
// this control settles on the response body instead (D-1158).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CapsControl } from '../src/fleet/CapsControl';
import { ApiError } from '../src/lib/api';
import type { CoordCapsView } from '../../shared/api';

afterEach(cleanup);

const VIEW = (over: Partial<CoordCapsView> = {}): CoordCapsView => ({
  caps: { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 },
  usage: { running: 1, dispatchedIn24h: 4 },
  ...over,
});
const READ = (): Promise<CoordCapsView> => Promise.resolve(VIEW());

describe('CapsControl', () => {
  it('renders nothing until the first read lands', () => {
    const { container } = render(<CapsControl coordCaps={() => new Promise<CoordCapsView>(() => {})} />);
    expect(container.querySelector('.caps-control')).toBeNull();
  });

  it('shows usage against each cap once the read lands', async () => {
    render(<CapsControl coordCaps={READ} />);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('4 / 12')).toBeInTheDocument();
  });

  it('sends only the field the operator changed', async () => {
    const setCoordCaps = vi.fn(async () => VIEW({ caps: { maxConcurrentWorkers: 5, maxSessionsPerDay: 12 } }));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(setCoordCaps).toHaveBeenCalledWith({ maxConcurrentWorkers: 5 }));
  });

  it('sends nothing at all when neither field was touched', async () => {
    // The route refuses an empty body; the control should not spend a round trip
    // discovering that.
    const setCoordCaps = vi.fn(async () => VIEW());
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument());
    expect(setCoordCaps).not.toHaveBeenCalled();
  });

  it('settles on the response body, not on what was typed', async () => {
    // The server is the authority on what was stored. Typing 9 and being told 4
    // must render 4 — the honesty half of "the reply is the confirmation".
    const setCoordCaps = vi.fn(async () => VIEW({ caps: { maxConcurrentWorkers: 4, maxSessionsPerDay: 12 } }));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText('1 / 4')).toBeInTheDocument();
  });

  it('says so, inline, when the write is refused', async () => {
    const setCoordCaps = vi.fn(() => Promise.reject(new ApiError(400,
      { ok: false, error: 'bad-request',
        detail: 'maxConcurrentWorkers must be an integer between 1 and 64' })));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/between 1 and 64/)).toBeInTheDocument();
  });

  it('does NOT claim the write failed when only the ANSWER was unreadable', async () => {
    // The D-1150 distinction at a new seam. The caps may well have been written;
    // reporting a failure is a lie the operator would act on by retrying.
    const setCoordCaps = vi.fn(async () => 'unreadable' as const);
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const msg = await screen.findByText(/unconfirmed/i);
    expect(msg).toBeInTheDocument();
    // …and it must not ALSO say the write failed.
    expect(msg.textContent).not.toMatch(/failed|refused/i);
  });

  it('renders nothing on a box with no coordination database', async () => {
    const { container } = render(<CapsControl
      coordCaps={() => Promise.reject(new ApiError(501, { ok: false, error: 'not-configured' }))} />);
    await waitFor(() => expect(container.querySelector('.caps-control')).toBeNull());
  });

  it('renders nothing, rather than a guess, when the read fails outright', async () => {
    // "Could not read the caps" is not "the caps are 0/0". Same rule
    // CoordBanner's absent-frame state follows.
    const { container } = render(<CapsControl
      coordCaps={() => Promise.reject(new ApiError(500, { ok: false }))} />);
    await waitFor(() => expect(container.querySelector('.caps-control')).toBeNull());
  });
});
