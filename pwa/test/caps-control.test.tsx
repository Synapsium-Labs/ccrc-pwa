// The operator's dial on the coordination cap (one since the daily brake was
// retired, D-7068). Its shape is CoordBanner's
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
import { capInForce, capIsAutomatic, capIsOverride, capSourceWords, capsUsageWords } from '../src/fleet/capsWords';
import { ApiError } from '../src/lib/api';
import type { CoordCapsView } from '../../shared/api';
import type { CoordCapNow } from '../../shared/runCap';

afterEach(cleanup);

const VIEW = (over: Partial<CoordCapsView> = {}): CoordCapsView => ({
  caps: { maxConcurrentWorkers: 3 },
  usage: { running: 1 },
  ...over,
});
const READ = (): Promise<CoordCapsView> => Promise.resolve(VIEW());

describe('CapsControl', () => {
  it('renders nothing until the first read lands', () => {
    const { container } = render(<CapsControl coordCaps={() => new Promise<CoordCapsView>(() => {})} />);
    expect(container.querySelector('.caps-control')).toBeNull();
  });

  it('shows usage against the cap once the read lands', async () => {
    render(<CapsControl coordCaps={READ} />);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });

  it('armed, says how many runs hold a slot and how many wait (D-8792)', async () => {
    render(<CapsControl coordCaps={() => Promise.resolve(VIEW({ usage: { running: 5, waiting: 2, workingOnly: true } }))} />);
    expect(await screen.findByText('3 / 3 working, 2 waiting')).toBeInTheDocument();
  });

  it('in shadow, says the count the cap still uses and how many of it wait (D-8792)', async () => {
    render(<CapsControl coordCaps={() => Promise.resolve(VIEW({ usage: { running: 3, waiting: 2, workingOnly: false } }))} />);
    expect(await screen.findByText('3 / 3, 2 of them waiting')).toBeInTheDocument();
  });

  it('an older server that sends no waiting count keeps today\'s reading', async () => {
    render(<CapsControl coordCaps={READ} />);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).toBeNull();
  });

  it('has no per-day dial: the daily brake is retired (D-7068)', async () => {
    // The server no longer refuses on a daily count nor reports one, so a row for
    // it would be a dial wired to nothing. One input, one usage reading.
    const { container } = render(<CapsControl coordCaps={READ} />);
    await screen.findByText('1 / 3');
    expect(screen.queryByLabelText(/per day/i), 'the retired per-day dial is back').toBeNull();
    expect(container.querySelector('#caps-per-day')).toBeNull();
    expect(container.querySelectorAll('.caps-field')).toHaveLength(1);
    expect(container.querySelectorAll('.caps-usage')).toHaveLength(1);
  });

  it('sends only the field the operator changed', async () => {
    const setCoordCaps = vi.fn(async () => VIEW({ caps: { maxConcurrentWorkers: 5 } }));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(setCoordCaps).toHaveBeenCalledWith({ maxConcurrentWorkers: 5 }));
  });

  it('sends nothing at all when the field was not touched', async () => {
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
    const setCoordCaps = vi.fn(async () => VIEW({ caps: { maxConcurrentWorkers: 4 } }));
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
    // THE LAYOUT EFFECT IS UNMEASURED, and this test does not pretend otherwise:
    // jsdom does no layout, so nothing here can observe that the empty region
    // costs no row. What is held is the SHAPE of the rule — which is the half
    // that carries the accessibility decision, and the half a later edit would
    // silently reverse. `display: none` would collapse the note
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

describe('capsUsageWords, the one reader of the waiting count (D-8792)', () => {
  it('armed: the runs that hold a slot, then the ones left out', () => {
    expect(capsUsageWords({ running: 4, waiting: 1, workingOnly: true }, 3)).toBe('3 / 3 working, 1 waiting');
    expect(capsUsageWords({ running: 1, waiting: 0, workingOnly: true }, 3)).toBe('1 / 3 working, 0 waiting');
  });

  it('shadow (or no flag): the count the cap uses, and how many of it wait', () => {
    expect(capsUsageWords({ running: 4, waiting: 1, workingOnly: false }, 3)).toBe('4 / 3, 1 of them waiting');
    expect(capsUsageWords({ running: 4, waiting: 1 }, 3)).toBe('4 / 3, 1 of them waiting');
  });

  it('an absent or malformed count reads as today, never as a guessed zero', () => {
    expect(capsUsageWords({ running: 2 }, 3)).toBe('2 / 3');
    for (const waiting of [-1, 1.5, Number.NaN, '2' as unknown as number]) {
      expect(capsUsageWords({ running: 2, waiting, workingOnly: true }, 3), String(waiting)).toBe('2 / 3');
    }
  });
});

// D-8920 (the operator's ruling of 2026-11-22): the run cap is derived from the machine the fleet runs
// on. The control shows that number and what it was derived from; the box is only the operator's override.
const GiB = 2 ** 30;
const DERIVED = { kind: 'measured', cap: 16, bound: 'cores', memTotalBytes: 64 * GiB, cores: 16 } as const;
const AUTOMATIC: CoordCapNow = { mode: 'automatic', cap: 16, derived: DERIVED };
const OVERRIDE: CoordCapNow = { mode: 'override', cap: 12, derived: DERIVED };
const UNMEASURED: CoordCapNow = { mode: 'automatic', cap: 24, derived: { kind: 'unmeasured', why: 'no-reading' } };
/** A view from a server that derives the cap. `stored` is the number it keeps beside it. */
const NOW = (capNow: CoordCapNow, stored = 24, running = 5): CoordCapsView =>
  ({ caps: { maxConcurrentWorkers: stored }, usage: { running }, capNow });

describe('CapsControl: automatic and override (D-8920)', () => {
  it('automatic: says the number and what it was derived from, and shows the derived cap, not the stored one', async () => {
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(AUTOMATIC))} />);
    expect(await screen.findByText('Automatic: 16 (from 64 GB and 16 cores)')).toBeInTheDocument();
    expect(screen.getByText('5 / 16'), 'the usage is read against the cap in force').toBeInTheDocument();
    expect((screen.getByLabelText(/workers/i) as HTMLInputElement).value, 'the box shows the cap in force').toBe('16');
    expect(screen.queryByText(/24/), 'the stored number is on screen as if it were the cap').toBeNull();
    expect(screen.queryByRole('button', { name: /use automatic/i }), 'nothing to clear while automatic').toBeNull();
  });

  it('automatic, untouched: save sends nothing, so the operator who does nothing sets nothing', async () => {
    const setCoordCaps = vi.fn(async () => NOW(AUTOMATIC));
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(AUTOMATIC))} setCoordCaps={setCoordCaps} />);
    fireEvent.click(await screen.findByRole('button', { name: /^save$/i }));
    expect(setCoordCaps).not.toHaveBeenCalled();
  });

  // The operator can FIX the cap at the number on screen. While the number is the server's own, a number saved from a
  // box they typed in is always an ask, the automatic number included: comparing it with the cap in force would send
  // nothing and say nothing, and the mode would stay automatic.
  it('automatic: typing the automatic number itself and saving sends it as the override', async () => {
    const setCoordCaps = vi.fn(async () => NOW({ mode: 'override', cap: 16, derived: DERIVED }, 16));
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(AUTOMATIC))} setCoordCaps={setCoordCaps} />);
    // Retyped, as a hand does it: the box is cleared to one digit and the number typed back.
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/workers/i), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(setCoordCaps).toHaveBeenCalledWith({ maxConcurrentWorkers: 16 }));
    expect(await screen.findByText('Set by hand: 16. Automatic would be 16 (from 64 GB and 16 cores).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use automatic/i })).toBeInTheDocument();
  });

  it('an unmeasured host: typing the stored number in use and saving makes it the override', async () => {
    const setCoordCaps = vi.fn(async () => NOW({ mode: 'override', cap: 24, derived: { kind: 'unmeasured', why: 'agent-older' } }));
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(UNMEASURED))} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/workers/i), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(setCoordCaps).toHaveBeenCalledWith({ maxConcurrentWorkers: 24 }));
  });

  it('an override, or an older server: the same number typed again is still no ask (the number is the operator\'s own)', async () => {
    const setCoordCaps = vi.fn(async () => NOW(OVERRIDE, 12));
    const first = render(<CapsControl coordCaps={() => Promise.resolve(NOW(OVERRIDE, 12))} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/workers/i), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    first.unmount();
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/workers/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(setCoordCaps).not.toHaveBeenCalled();
  });

  it('a number typed over the automatic cap is sent as the override, and the answer is what is shown', async () => {
    const setCoordCaps = vi.fn(async () => NOW(OVERRIDE, 12));
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(AUTOMATIC))} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(setCoordCaps).toHaveBeenCalledWith({ maxConcurrentWorkers: 12 }));
    expect(await screen.findByText('Set by hand: 12. Automatic would be 16 (from 64 GB and 16 cores).')).toBeInTheDocument();
    expect(screen.getByText('5 / 12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use automatic/i })).toBeInTheDocument();
  });

  it('use automatic clears the override: it sends the mode alone, and the control settles on the answer', async () => {
    const setCoordCaps = vi.fn(async () => NOW(AUTOMATIC, 12));
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(OVERRIDE, 12))} setCoordCaps={setCoordCaps} />);
    fireEvent.click(await screen.findByRole('button', { name: /use automatic/i }));
    await waitFor(() => expect(setCoordCaps).toHaveBeenCalledWith({ mode: 'automatic' }));
    expect(await screen.findByText('Automatic: 16 (from 64 GB and 16 cores)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /use automatic/i })).toBeNull();
    expect((screen.getByLabelText(/workers/i) as HTMLInputElement).value).toBe('16');
  });

  it('use automatic that could not be confirmed says so, and one that is refused says why', async () => {
    const unread = vi.fn(async () => 'unreadable' as const);
    const first = render(<CapsControl coordCaps={() => Promise.resolve(NOW(OVERRIDE, 12))} setCoordCaps={unread} />);
    fireEvent.click(await screen.findByRole('button', { name: /use automatic/i }));
    expect(await screen.findByText(/unconfirmed/i)).toBeInTheDocument();
    first.unmount();
    const refused = vi.fn(() => Promise.reject(new ApiError(400, { ok: false, error: 'bad-request', detail: 'mode must be automatic or override' })));
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(OVERRIDE, 12))} setCoordCaps={refused} />);
    fireEvent.click(await screen.findByRole('button', { name: /use automatic/i }));
    expect(await screen.findByText('mode must be automatic or override')).toBeInTheDocument();
  });

  it('an unmeasured host: says the stored number is in use and why, never a derived number from nowhere', async () => {
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(UNMEASURED))} />);
    expect(await screen.findByText('Automatic, but the fleet host has not been measured yet. Using the stored number, 24, until it is.'))
      .toBeInTheDocument();
    expect(screen.getByText('5 / 24')).toBeInTheDocument();
  });

  it('a host whose sessions have a memory limit below the box: both figures are on screen', async () => {
    const limited: CoordCapNow = { mode: 'automatic', cap: 8,
      derived: { kind: 'measured', cap: 8, bound: 'session-limit', memTotalBytes: 64 * GiB, cores: 16, sessionMemLimitBytes: 24 * GiB } };
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(limited))} />);
    expect(await screen.findByText('Automatic: 8 (from 64 GB, of which sessions may use 24 GB, and 16 cores)')).toBeInTheDocument();
  });

  it('an older server (no capNow): the stored number, no sentence and no automatic button, as before', async () => {
    const { container } = render(<CapsControl coordCaps={READ} />);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(container.querySelector('.caps-source')).toBeNull();
    expect(screen.queryByRole('button', { name: /use automatic/i })).toBeNull();
    expect((screen.getByLabelText(/workers/i) as HTMLInputElement).value).toBe('3');
  });

  it('the sentence is not a second live region: the note stays the one place the control announces', async () => {
    render(<CapsControl coordCaps={() => Promise.resolve(NOW(AUTOMATIC))} />);
    await screen.findByText('Automatic: 16 (from 64 GB and 16 cores)');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('the cap words, the console\'s readers of capNow (D-8920)', () => {
  it('the cap in force is the server\'s, and the stored number only when the server sends none', () => {
    expect(capInForce(NOW(AUTOMATIC))).toBe(16);
    expect(capInForce(NOW(OVERRIDE, 12))).toBe(12);
    expect(capInForce(NOW(UNMEASURED))).toBe(24);
    expect(capInForce({ caps: { maxConcurrentWorkers: 3 }, usage: { running: 0 } })).toBe(3);
    // A malformed field is an older server's absence, never a cap of its own.
    expect(capInForce({ caps: { maxConcurrentWorkers: 3 }, usage: { running: 0 }, capNow: { mode: 'automatic', cap: 0, derived: { kind: 'unmeasured', why: 'no-reading' } } })).toBe(3);
  });

  it('only an override can be cleared; the number is the server\'s own only under automatic; an older server is neither', () => {
    expect([capIsOverride(NOW(OVERRIDE)), capIsAutomatic(NOW(OVERRIDE))]).toEqual([true, false]);
    expect([capIsOverride(NOW(AUTOMATIC)), capIsAutomatic(NOW(AUTOMATIC))]).toEqual([false, true]);
    expect([capIsOverride(NOW(UNMEASURED)), capIsAutomatic(NOW(UNMEASURED))]).toEqual([false, true]);
    const older: CoordCapsView = { caps: { maxConcurrentWorkers: 3 }, usage: { running: 0 } };
    expect([capIsOverride(older), capIsAutomatic(older)]).toEqual([false, false]);
  });

  it('the measured sentences, and none for an older server', () => {
    expect(capSourceWords(NOW(AUTOMATIC))).toBe('Automatic: 16 (from 64 GB and 16 cores)');
    expect(capSourceWords(NOW(OVERRIDE))).toBe('Set by hand: 12. Automatic would be 16 (from 64 GB and 16 cores).');
    expect(capSourceWords({ caps: { maxConcurrentWorkers: 3 }, usage: { running: 0 } })).toBeNull();
  });

  // WHY there is no automatic number, one sentence per remedy: waiting only helps in the first case.
  it.each([
    ['no-reading', 'Automatic, but the fleet host has not been measured yet. Using the stored number, 24, until it is.',
      'Set by hand: 12. There is no automatic number: the fleet host has not been measured yet.'],
    ['agent-older', 'Automatic, but the fleet agent is too old to measure its host. Using the stored number, 24, until the agent is updated.',
      'Set by hand: 12. There is no automatic number: the fleet agent is too old to measure its host.'],
    ['read-failed', 'Automatic, but the fleet host\'s size could not be read. Using the stored number, 24.',
      'Set by hand: 12. There is no automatic number: the fleet host\'s size could not be read.'],
  ] as const)('an unmeasured host says why (%s), under automatic and under an override', (why, automatic, override) => {
    expect(capSourceWords(NOW({ mode: 'automatic', cap: 24, derived: { kind: 'unmeasured', why } }))).toBe(automatic);
    expect(capSourceWords(NOW({ mode: 'override', cap: 12, derived: { kind: 'unmeasured', why } }))).toBe(override);
  });

  it('an unmeasured answer from a server that sends no reason reads as not measured yet', () => {
    const view = { caps: { maxConcurrentWorkers: 24 }, usage: { running: 5 }, capNow: { mode: 'automatic', cap: 24, derived: { kind: 'unmeasured' } } };
    expect(capSourceWords(view as unknown as CoordCapsView))
      .toBe('Automatic, but the fleet host has not been measured yet. Using the stored number, 24, until it is.');
  });

  it('a limit on the sessions\' memory below the box\'s is said beside it; one at or above the box\'s is not', () => {
    const from = (sessionMemLimitBytes: number | undefined, bound: 'session-limit' | 'cores'): string | null => capSourceWords(NOW({ mode: 'automatic', cap: 8,
      derived: { kind: 'measured', cap: 8, bound, memTotalBytes: 64 * GiB, cores: 16, ...(sessionMemLimitBytes === undefined ? {} : { sessionMemLimitBytes }) } }));
    expect(from(24 * GiB, 'session-limit')).toBe('Automatic: 8 (from 64 GB, of which sessions may use 24 GB, and 16 cores)');
    expect(from(64 * GiB, 'cores')).toBe('Automatic: 8 (from 64 GB and 16 cores)');
    expect(from(200 * GiB, 'cores')).toBe('Automatic: 8 (from 64 GB and 16 cores)');
    expect(from(undefined, 'cores')).toBe('Automatic: 8 (from 64 GB and 16 cores)');
  });

  it('memory is whole GB above ten and one decimal below, and one core is singular', () => {
    const from = (memTotalBytes: number, cores: number): string | null =>
      capSourceWords(NOW({ mode: 'automatic', cap: 1, derived: { kind: 'measured', cap: 1, bound: 'cores', memTotalBytes, cores } }));
    expect(from(Math.round(63.6 * GiB), 16)).toBe('Automatic: 1 (from 64 GB and 16 cores)');
    expect(from(Math.round(7.63 * GiB), 4)).toBe('Automatic: 1 (from 7.6 GB and 4 cores)');
    expect(from(16 * GiB, 1)).toBe('Automatic: 1 (from 16 GB and 1 core)');
  });
});
