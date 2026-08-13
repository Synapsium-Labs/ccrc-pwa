// The abandon sheet — the run board's release valve (Task 12, spec §4.3).
// TDD red-first: this file is written BEFORE `AbandonSheet.tsx` exists and
// before `RunsScreen.tsx` grows the row control, and is run once to confirm
// it fails for the right reason (missing module / missing control), then
// again once the implementation lands.
//
// Two halves, like `coord-banner.test.tsx`'s own split: `AbandonSheet`
// rendered directly (with an INJECTED `abandonRun`, same shape
// `CoordBanner`'s own `coordPause` prop uses) for the copy/refusal cases,
// and `RunsScreen` rendered for real (Task 11 review, lesson 1) for the
// two-tap flow and the row-control structural pins — a control that only
// ever exists in its own isolated test file ships missing the moment
// someone drops the line from `RunsScreen`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { RunSummary } from '../../shared/api';
import { AbandonSheet } from '../src/fleet/AbandonSheet';
import { RunsScreen } from '../src/screens/RunsScreen';
import { ApiError } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Same shape as runs-screen.test.tsx's own `r()` — RunSummary as PR I
// actually shipped it (shared/api.ts), not the plan's illustrative one.
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa',
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0, ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});

describe('AbandonSheet — the copy and the refusals', () => {
  it('names the run AND its workspace in the confirm line', () => {
    render(<AbandonSheet run={run()} onClose={() => {}} />);
    expect(screen.getByText(/run 3/i)).toBeInTheDocument();
    expect(screen.getByText(/clear-cove/i)).toBeInTheDocument();
  });

  it('says a release destroys nothing — the worktree survives, the record stays', () => {
    render(<AbandonSheet run={run()} onClose={() => {}} />);
    expect(screen.getByText(/a release destroys nothing/i)).toBeInTheDocument();
    expect(screen.getByText(/worktree survives/i)).toBeInTheDocument();
    expect(screen.getByText(/record stays/i)).toBeInTheDocument();
  });

  // Negative pin (mail-strip.test.tsx's own idiom: loop every button, check
  // its accessible name/text). "The phone can abandon; the phone can never
  // archive" (spec §4.3, global constraint) is not real unless something
  // fails when it stops being true.
  it('offers NO archive control anywhere in the sheet', () => {
    render(<AbandonSheet run={run()} onClose={() => {}} />);
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(/archive/i);
    }
    expect(screen.queryByText(/archive/i)).toBeNull();
  });

  it('renders 409 bad-transition as "this run already closed", using `from`', async () => {
    const abandonRun = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'bad-transition', from: 'failed', to: 'failed' }),
    );
    render(<AbandonSheet run={run()} onClose={() => {}} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    expect(await screen.findByText(/this run already closed/i)).toBeInTheDocument();
    // `from` is what makes the sentence a measurement, not a hardcoded
    // "done" — a `from: 'failed'` case exercises that it is actually read.
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it('renders 404 as "that run is gone — the board will catch up"', async () => {
    const abandonRun = vi.fn().mockRejectedValue(new ApiError(404, { ok: false, error: 'unknown-run' }));
    render(<AbandonSheet run={run()} onClose={() => {}} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    expect(await screen.findByText('that run is gone — the board will catch up')).toBeInTheDocument();
  });

  it('renders 501 as "the fleet host needs the newer ccd"', async () => {
    const abandonRun = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<AbandonSheet run={run()} onClose={() => {}} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    expect(await screen.findByText('the fleet host needs the newer ccd')).toBeInTheDocument();
  });

  it("renders a 502's stderr verbatim and leaves the sheet open to retry", async () => {
    const abandonRun = vi.fn().mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'ccd: ws-release: permission denied' }),
    );
    const onClose = vi.fn();
    render(<AbandonSheet run={run()} onClose={onClose} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    expect(await screen.findByText('ccd: ws-release: permission denied')).toBeInTheDocument();
    // Not closed, and not stuck disabled — the operator can tap Abandon
    // again without leaving and reopening the sheet.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^abandon$/i })).not.toBeDisabled();
  });
});

describe('the run board’s abandon control (Task 12, spec §4.3)', () => {
  it('needs two taps: the row control opens the sheet, the sheet’s button abandons', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [run()], runsFrameSeen: true }); });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, id: 3, state: 'failed' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchImpl);
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);

    // First tap: the row's own control opens the sheet. Nothing has been
    // sent to the server yet — opening is not confirming.
    fireEvent.click(screen.getByRole('button', { name: /abandon run 3/i }));
    expect(await screen.findByText(/a release destroys nothing/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();

    // Second tap: the sheet's OWN confirm button is what actually abandons,
    // through the real `api.abandonRun` (the default, uninjected here) —
    // pins the production wiring, not only a test-only injected function
    // (Task 11 review, lesson 2).
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/runs/3/abandon');
    expect(init.method).toBe('POST');
    // The sheet closes on success.
    expect(screen.queryByText(/a release destroys nothing/i)).not.toBeInTheDocument();
  });

  // D-B4-14: the fix round's own anchor — `RunsScreen.tsx:118-122` used to
  // wrap the whole row body in `<button className="run-open">`, and a
  // `<button>` inside a `<button>` is invalid HTML and unreachable to a
  // screen reader. The abandon control must be a SIBLING, never nested.
  it('the run row never nests a button inside a button', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [run()], runsFrameSeen: true }); });
    const { container } = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    for (const btn of container.querySelectorAll('button')) {
      expect(btn.querySelector('button')).toBeNull();
    }
  });

  it('an inert row (no session) still offers abandon — that is the wedge it exists for', () => {
    const store = makeStore();
    act(() => {
      store.setState({ runs: [run({ sessionId: null, state: 'planned' })], runsFrameSeen: true });
    });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    // No session to open — .run-open is absent — but the release valve
    // (an ambiguous-dispatch wedge is exactly a `planned` run with no
    // session) is still there.
    expect(screen.queryByRole('button', { name: /clear-cove/i })).toBeNull();
    expect(screen.getByRole('button', { name: /abandon run 3/i })).toBeInTheDocument();
  });
});
