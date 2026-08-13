// The pause banner and its toggle (Task 11, spec §4.2). TDD red-first: this
// file is written BEFORE `CoordBanner.tsx`/`coordWords.ts` exist and is run
// once to confirm it fails for the right reason (missing modules), then again
// once the implementation lands.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { CoordStatus } from '../../shared/api';
import { CoordBanner } from '../src/fleet/CoordBanner';
import { COORD_CONFIRM_MS, MARKER_GLYPH, MARKER_WORD } from '../src/fleet/coordWords';
import { ApiError } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';
import { FleetScreen } from '../src/screens/FleetScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Store whose ReconnectingSocket gets an inert fake — connect() is harmless
 *  and never actually invoked by these tests, which drive the store directly
 *  via `setState`, the same idiom `runs-screen.test.tsx`/`tap-targets.test.tsx`
 *  already use. */
const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});

const coord = (over: Partial<CoordStatus> = {}): CoordStatus => ({ pause: 'clear', mail: 'clear', ...over });

describe('the coord banner', () => {
  it('renders NOTHING before any coord frame — absence is not "not paused"', () => {
    const store = makeStore();
    const { container } = render(<CoordBanner store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Task 11 review, Minor 2: `coord !== null` and `coordFrameSeen` happen to
  // move together in the real store, so nothing above actually exercises the
  // `!coordFrameSeen ||` half of the render gate on its own — a mutant that
  // deletes that clause and leaves only `coord === null` would still pass
  // every test above. `tap-targets.test.tsx:283`'s "reads unknown, not 'none
  // active', before runsFrameSeen" is the precedent this mirrors: a payload
  // can arrive without the sticky flag having been set by the real onMessage
  // path, and the render decision has to key off the FLAG, not the payload's
  // mere presence.
  it('renders nothing when coord has arrived but coordFrameSeen is still false — the sticky flag gates the render, not the payload alone', () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'set' }), coordFrameSeen: false }); });
    const { container } = render(<CoordBanner store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders two cues, word and glyph, from parallel tables — never colour alone', () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    render(<CoordBanner store={store} />);
    expect(screen.getByText(MARKER_WORD.clear)).toBeInTheDocument();
    const glyph = document.querySelector('.coord-glyph');
    expect(glyph).not.toBeNull();
    expect(glyph?.textContent).toBe(MARKER_GLYPH.clear);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders unmeasurable honestly: "the registry could not be read — dispatch would refuse"', () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'unmeasurable' }), coordFrameSeen: true }); });
    render(<CoordBanner store={store} />);
    expect(screen.getByText('the registry could not be read — dispatch would refuse')).toBeInTheDocument();
  });

  it('shows pausing… on tap and does NOT flip the state', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    const coordPause = vi.fn(() => new Promise<void>(() => {})); // never resolves in this test
    render(<CoordBanner store={store} coordPause={coordPause} />);

    fireEvent.click(screen.getByRole('button'));
    expect(coordPause).toHaveBeenCalledWith(true);
    expect(await screen.findByText('pausing…')).toBeInTheDocument();
    // The word/glyph above the button are UNCHANGED — no optimism.
    expect(screen.getByText(MARKER_WORD.clear)).toBeInTheDocument();
  });

  it('settles only when the next coord frame confirms', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    const coordPause = vi.fn().mockResolvedValue(undefined);
    render(<CoordBanner store={store} coordPause={coordPause} />);

    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('pausing…')).toBeInTheDocument();

    // A frame that arrives but still disagrees changes nothing — the tap is
    // still outstanding.
    act(() => { store.setState({ coord: coord({ pause: 'clear' }) }); });
    expect(screen.getByText('pausing…')).toBeInTheDocument();

    // The CONFIRMING frame lands.
    act(() => { store.setState({ coord: coord({ pause: 'set' }) }); });
    expect(await screen.findByText('Resume')).toBeInTheDocument();
    expect(screen.getByText(MARKER_WORD.set)).toBeInTheDocument();
  });

  it('renders "unconfirmed — check /runs" when no frame confirms inside COORD_CONFIRM_MS', async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
      const coordPause = vi.fn().mockResolvedValue(undefined);
      render(<CoordBanner store={store} coordPause={coordPause} />);

      fireEvent.click(screen.getByRole('button'));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // flush the resolved coordPause promise
      expect(screen.getByText('pausing…')).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(COORD_CONFIRM_MS); });
      expect(screen.getByText('unconfirmed — check /runs')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Un-briefed behaviour, called out in the report and ruled "keep, but add
  // the missing test" on review: a `coord` frame that lands AFTER the
  // COORD_CONFIRM_MS timeout still resolves the outstanding tap, rather than
  // leaving the banner stuck reading "unconfirmed" forever once a real
  // (if late) answer has actually arrived.
  it('a late-confirming coord frame clears "unconfirmed" — self-healing, never stuck', async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
      const coordPause = vi.fn().mockResolvedValue(undefined);
      render(<CoordBanner store={store} coordPause={coordPause} />);

      fireEvent.click(screen.getByRole('button'));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(COORD_CONFIRM_MS); });
      expect(screen.getByText('unconfirmed — check /runs')).toBeInTheDocument();

      // The confirming frame finally lands, late.
      act(() => { store.setState({ coord: coord({ pause: 'set' }) }); });
      expect(screen.queryByText('unconfirmed — check /runs')).toBeNull();
      expect(screen.getByText('Resume')).toBeInTheDocument();
      expect(screen.getByText(MARKER_WORD.set)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the 501 as "the fleet host needs the newer ccd"', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    const coordPause = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<CoordBanner store={store} coordPause={coordPause} />);

    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('the fleet host needs the newer ccd')).toBeInTheDocument();
    // Not stuck in "pausing…" forever — a failed write has nothing left to
    // wait for.
    expect(screen.queryByText('pausing…')).toBeNull();
  });

  it('renders the 502 stderr, not a generic toast', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    const coordPause = vi.fn().mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'ccd: coord-pause: permission denied' }),
    );
    render(<><CoordBanner store={store} coordPause={coordPause} /><ToastHost /></>);

    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('ccd: coord-pause: permission denied')).toBeInTheDocument();
    expect(document.querySelector('.toast')).toBeNull();
  });

  // Whole-branch review, M1: the 502 arm used to extract `body.stderr` itself
  // and fall back to `apiErrorText(err)` — but `apiErrorText` is ALREADY
  // stderr-first (`lib/api.ts:149-160`), so the whole branch was byte-
  // equivalent to `return apiErrorText(err)`. The stderr case above is the
  // only one the suite exercised, which is why the redundancy could not be
  // seen from the tests. This is the OTHER half of the branch: what makes a
  // 502 inline is the STATUS, not the presence of stderr — deleting the arm
  // drops this refusal into the ordinary toast, where a coordination write's
  // failure is not what the banner is for.
  it('renders a 502 with no stderr inline as well — the branch is the STATUS, not the stderr read (M1)', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    const coordPause = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, error: 'fleet-failed' }));
    render(<><CoordBanner store={store} coordPause={coordPause} /><ToastHost /></>);

    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('fleet-failed')).toBeInTheDocument();
    expect(document.querySelector('.coord-error')).not.toBeNull();
    expect(document.querySelector('.toast')).toBeNull();
  });

  // Whole-branch review, M4: `error` was cleared only on the NEXT tap, so a
  // 501/502 refusal stayed rendered under a banner that had since flipped to
  // a different, freshly-measured state — the refusal describing a fleet the
  // word above it no longer describes.
  it('clears an inline refusal when a later coord frame lands — no stale 501 under a banner that has moved on (M4)', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    const coordPause = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<CoordBanner store={store} coordPause={coordPause} />);

    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('the fleet host needs the newer ccd')).toBeInTheDocument();

    // A real measurement arrives: the fleet IS paused now (someone else, or a
    // box that has since been updated). The refusal above belonged to before.
    act(() => { store.setState({ coord: coord({ pause: 'set' }) }); });

    expect(screen.queryByText('the fleet host needs the newer ccd')).toBeNull();
    expect(document.querySelector('.coord-error')).toBeNull();
    expect(screen.getByText(MARKER_WORD.set)).toBeInTheDocument();
  });

  it('a generic (non-501/502) failure falls through to the ordinary toast, not the inline banner', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    const coordPause = vi.fn().mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request' }));
    render(<><CoordBanner store={store} coordPause={coordPause} /><ToastHost /></>);

    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/bad-request/i)).toBeInTheDocument();
    expect(document.querySelector('.coord-error')).toBeNull();
  });

  it('lives on /runs and nowhere else — a FleetScreen render finds none', () => {
    const store = makeStore();
    act(() => {
      store.setState({ conn: 'open', sessions: [], coord: coord({ pause: 'set' }), coordFrameSeen: true });
    });
    render(<FleetScreen store={store} />);
    expect(document.querySelector('.coord-banner')).toBeNull();
  });

  it('carries a tap target at var(--tap-min)', () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ pause: 'clear' }), coordFrameSeen: true }); });
    render(<CoordBanner store={store} />);
    expect(screen.getByRole('button')).toHaveClass('coord-toggle');
  });

  it('degrades an unknown MarkerState through markerState, never a blank cell', () => {
    const store = makeStore();
    const fromNewerBuild = { pause: 'quarantined', mail: 'clear' } as unknown as CoordStatus;
    act(() => { store.setState({ coord: fromNewerBuild, coordFrameSeen: true }); });
    render(<CoordBanner store={store} />);
    expect(screen.getByText(MARKER_WORD.unmeasurable)).toBeInTheDocument();
    expect(document.querySelector('.coord-glyph')?.textContent).toBe(MARKER_GLYPH.unmeasurable);
  });
});
