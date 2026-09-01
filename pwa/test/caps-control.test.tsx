// The operator's dial on the two coordination caps. Its shape is CoordBanner's
// beside it — injectable props defaulting to the `api` singleton, a render gate
// that shows nothing until the first read lands — with ONE deliberate
// departure: the pause toggle refuses to be optimistic because a
// `{type:'coord'}` frame exists to settle it, and no frame carries caps, so
// this control settles on the response body instead (D-1209).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('a cleared field is not a request to set the cap to zero', async () => {
    // D-1221. `Number('')` is 0, and 0 differs from the stored 3, so the cleared
    // field was sent as an EXPLICIT request to set the cap to zero — the one
    // value `CAP_MIN` exists to forbid, because a stored 0 refuses every dispatch
    // for ever and has no ungated door to undo it. The operator gets a bounds
    // refusal for a field they merely emptied, and the request they never made is
    // the one that would have wedged the fleet had the server allowed it.
    //
    // The control decides what was ASKED FOR; the server decides whether the ask
    // is allowed. A blank box is not an ask for zero, and reading it as one is a
    // shape error here, not a policy judgement borrowed from there.
    const setCoordCaps = vi.fn(async () => VIEW());
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/not a number/i)).toBeInTheDocument();
    expect(setCoordCaps, 'a cleared field was sent as a value').not.toHaveBeenCalled();
  });

  it('still sends a number the server will refuse — bounds are not this control to judge', async () => {
    // The other direction, and the line between the two. 99 is out of bounds and
    // goes anyway: the refusal that comes back names the field and the bounds in
    // the route's own words, and re-deriving that sentence here would be a second
    // copy of the policy. Only the NOT-A-NUMBER case is decided locally.
    const setCoordCaps = vi.fn(async () => VIEW());
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(setCoordCaps).toHaveBeenCalledWith({ maxConcurrentWorkers: 99 }));
  });

  it('announces what it is saying in a live region', async () => {
    // D-1222. The note is the whole of this control's feedback — there is no
    // toast, no banner, and a successful write simply re-renders numbers. Outside
    // a live region a screen-reader user gets nothing at all from a refusal, and
    // the moment it appears is the moment the operator has just committed to the
    // save. `role="status"` is this repo's own precedent for exactly this
    // (`AccountsScreen`, `MailScreen`, `FleetScreen`'s ack note).
    const setCoordCaps = vi.fn(() => Promise.reject(new ApiError(400,
      { ok: false, error: 'bad-request',
        detail: 'maxConcurrentWorkers must be an integer between 1 and 64' })));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/between 1 and 64/);
    expect(screen.getByRole('status').textContent,
      'the note is rendered outside any live region — a screen reader is told nothing')
      .toMatch(/between 1 and 64/);
  });

  it('the live region exists BEFORE it has anything to say', async () => {
    // D-1230. The test above pins that the refusal text lands in *a* live region.
    // It does NOT pin the property the fix was actually about — that the region
    // is mounted before it has content, because a `role="status"` inserted at the
    // same moment its text appears is announced unreliably. Measured: reverting
    // to the pre-commit conditional mount while KEEPING `role="status"` left the
    // whole file green, so the always-mounted half shipped with no mechanism and
    // the `.caps-note:empty` rule beside it became dead code with nothing to
    // notice. That is the same defect the coordinator raised as MUST-FIX B, in
    // the fix for one of its own siblings.
    render(<CapsControl coordCaps={READ} />);
    await screen.findByText('1 / 3');
    const region = screen.getByRole('status',
      { name: undefined }) as HTMLElement;
    expect(region, 'the region is created together with its text — announced unreliably')
      .toBeInTheDocument();
    expect(region.textContent, 'the region is not empty at rest').toBe('');
  });

  it('the empty-state rule keeps the region in the accessibility tree, and costs no layout', () => {
    // jsdom does no layout, so the SHAPE of the rule is what can be held here —
    // and it is the half that matters. `display: none` would collapse the note
    // correctly and silently undo D-1222 by taking the region out of the
    // accessibility tree; `height: 0` alone left the flex line and its row-gap
    // standing, which is what D-1236 was (the rule's own comment claimed it
    // collapsed to nothing, and the strip was permanently 8px taller).
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fleet', 'fleet.css'),
      'utf8');
    const rule = /\.caps-control \.caps-note:empty\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'the empty-state rule is gone — the live region now costs a row of layout')
      .not.toBeNull();
    expect(rule![1], 'display:none takes the live region out of the accessibility tree')
      .not.toMatch(/display\s*:\s*none/);
    expect(rule![1], 'a zero-height flex item still forms a line and pays the row gap')
      .toMatch(/position\s*:\s*absolute/);
  });

  it('does NOT wipe the unconfirmed warning when the correction leaves nothing to send', async () => {
    // D-1235. The D-1220 fix cleared EVERY note kind on the no-op path, and
    // `unconfirmed` is the one note a no-op does not supersede: it says the write
    // MAY have landed and the answer could not be read, so the rendered number is
    // not known to be the stored one. An operator who reverts the box to what the
    // screen shows would erase the only signal that the screen might be wrong —
    // the same class of lie as calling an unreadable answer a failure, which this
    // component's own D-1150 note refuses.
    const setCoordCaps = vi.fn(async () => 'unreadable' as const);
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    const input = await screen.findByLabelText(/workers/i);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/unconfirmed/i);
    fireEvent.change(input, { target: { value: '3' } });     // back to what is rendered
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(setCoordCaps).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent,
      'the no-op save erased the only warning that the stored value is unknown')
      .toMatch(/unconfirmed/i);
  });

  it('clears a stale refusal when the correction leaves nothing to send', async () => {
    // D-1220. The no-op early return sat ABOVE `setNote({kind:'none'})`, and the
    // draft is deliberately not reset on a refusal — so correcting the field back
    // to the stored value produced an empty partial, returned before the note was
    // cleared, and left a refusal on screen beside a state that is now perfectly
    // valid. The operator is told their input is wrong while it is right.
    const setCoordCaps = vi.fn(() => Promise.reject(new ApiError(400,
      { ok: false, error: 'bad-request',
        detail: 'maxConcurrentWorkers must be an integer between 1 and 64' })));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    const input = await screen.findByLabelText(/workers/i);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/between 1 and 64/);
    fireEvent.change(input, { target: { value: '3' } });      // back to the stored value
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.queryByText(/between 1 and 64/),
      'the refusal is still on screen beside a valid field').toBeNull());
    expect(setCoordCaps, 'the second click spent a round trip on nothing')
      .toHaveBeenCalledTimes(1);
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
