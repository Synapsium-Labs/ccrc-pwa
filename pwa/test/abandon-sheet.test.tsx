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
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RunSummary } from '../../shared/api';
import { AbandonSheet } from '../src/fleet/AbandonSheet';
import { CoordBanner } from '../src/fleet/CoordBanner';
import { RunsScreen } from '../src/screens/RunsScreen';
import { ApiError, COORD_UNSUPPORTED_TEXT, UNSUPPORTED_VERB_TEXT } from '../src/lib/api';
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

// Review fix round 1, Important 1: `AbandonSheet` is mounted UNCONDITIONALLY
// at screen level (`RunsScreen.tsx`, no `key`), so the only way to exercise
// "Cancel run 3, then open run 7" or "run 3's request resolves after run 7's
// sheet is already open" is a stateful harness that actually SWITCHES the
// `run` prop, the same way `RunsScreen` itself does — `AbandonSheet` alone,
// rendered once with a fixed `run`, cannot reach either bug.
function Harness({
  abandonRun, onDone,
}: {
  abandonRun: (id: number) => Promise<void>;
  onDone?: () => void;
}): ReactNode {
  const [target, setTarget] = useState<RunSummary | null>(run());
  return (
    <>
      <button type="button" onClick={() => setTarget(run({ id: 7, workspace: 'far-mesa' }))}>
        open run 7
      </button>
      <AbandonSheet run={target} onClose={() => setTarget(null)} onDone={onDone} abandonRun={abandonRun} />
    </>
  );
}

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

  // Review fix round 1, Minor 4: `sendCloseOutcome`'s `advanceFailed` arm
  // (`server/src/coord/routes.ts:141`) forwards `AdvanceResult`'s failure
  // verbatim, and one of its two members is `{ok:false, error:'unknown-run'}`
  // at 409 (not 404) — reachable if the run vanishes between `coord.run(id)`
  // and the transaction commit. Before this fix that landed on the total
  // map's `unknown` catch-all instead of the accurate, already-defined
  // sentence — the same one the 404 case above renders.
  it('renders a 409 {error:\'unknown-run\'} with the accurate sentence, not the generic catch-all', async () => {
    const abandonRun = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'unknown-run' }));
    render(<AbandonSheet run={run()} onClose={() => {}} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    expect(await screen.findByText('that run is gone — the board will catch up')).toBeInTheDocument();
    expect(screen.queryByText(/does not recognise/i)).toBeNull();
  });

  it('renders 501 as "the fleet host needs the newer ccd"', async () => {
    const abandonRun = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<AbandonSheet run={run()} onClose={() => {}} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    expect(await screen.findByText('the fleet host needs the newer ccd')).toBeInTheDocument();
  });

  // Whole-branch review, M2: this sentence shipped as TWO byte-identical
  // literals in source — `ABANDON_COPY.unsupported` here and
  // `inlinePauseError`'s own 501 arm in `CoordBanner.tsx` — with
  // `UNSUPPORTED_VERB_TEXT` (`lib/api.ts`) a third, DELIBERATELY different
  // spelling for the lifecycle routes. The two coordination sites now read
  // one constant. This renders BOTH surfaces at 501 and compares what the
  // operator actually sees, so a re-inlined literal at either site is caught
  // however it happens to be spelled — a per-file literal assertion (the two
  // that already exist, one in each file) cannot see the pair drifting apart.
  it('the two coordination surfaces render ONE 501 sentence, from one home (M2)', async () => {
    const abandonRun = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<AbandonSheet run={run()} onClose={() => {}} abandonRun={abandonRun} />);
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    const fromSheet = (await screen.findByText(COORD_UNSUPPORTED_TEXT)).textContent;

    cleanup();

    const store = makeStore();
    act(() => { store.setState({ coord: { pause: 'clear', mail: 'clear' }, coordFrameSeen: true }); });
    const coordPause = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<CoordBanner store={store} coordPause={coordPause} />);
    fireEvent.click(screen.getByRole('button'));
    const fromBanner = (await screen.findByText(COORD_UNSUPPORTED_TEXT)).textContent;

    expect(fromSheet).toBe(fromBanner);
    expect(fromSheet).toBe(COORD_UNSUPPORTED_TEXT);
    // …and it stays DISTINCT from the lifecycle routes' own sentence: that
    // third spelling is argued for by name in `lib/api.ts`'s own docstring,
    // not drift, and collapsing the three into one is not what this pins.
    expect(fromSheet).not.toBe(UNSUPPORTED_VERB_TEXT);
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

    // Task 13, spec §4.4: `RunsScreen` also mounts `StartProgramSheet` now,
    // whose own `useProjectedHome(open)` (review fix round 1, Minor 2) is
    // gated on the SHEET's own `open` — never tapped here, so it never
    // polls `/api/accounts` in this test at all. The exclusion below is
    // defensive rather than currently load-bearing: it keeps this assertion
    // meaning "no OTHER route at all" (review fix round 1, Minor 1) even if
    // that gate is ever widened, rather than narrowing to "only the abandon
    // route", which would stop catching a stray SECOND route (a prefetch, a
    // second run's abandon) alongside the real one.
    const otherCalls = (): [string, RequestInit][] =>
      fetchImpl.mock.calls.filter(([url]) => !String(url).includes('/api/accounts')) as [string, RequestInit][];

    // First tap: the row's own control opens the sheet. Nothing has been
    // sent to any route yet — opening is not confirming.
    fireEvent.click(screen.getByRole('button', { name: /abandon run 3/i }));
    expect(await screen.findByText(/a release destroys nothing/i)).toBeInTheDocument();
    expect(otherCalls()).toHaveLength(0);

    // Second tap: the sheet's OWN confirm button is what actually abandons,
    // through the real `api.abandonRun` (the default, uninjected here) —
    // pins the production wiring, not only a test-only injected function
    // (Task 11 review, lesson 2).
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(otherCalls()).toHaveLength(1);
    const [url, init] = otherCalls()[0] as [string, RequestInit];
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

// Review fix round 1, Important 1: `AbandonSheet` is mounted UNCONDITIONALLY
// at screen level and `run === null` only renders nothing — it does not
// unmount, so `busy`/`error` used to survive every close and every switch of
// target. The `Harness` component above is what makes both reachable
// scenarios actually reachable in a test: neither exists when `AbandonSheet`
// is rendered once with a single fixed `run`.
describe('per-target state (review fix round 1, Important 1)', () => {
  it("clears a previous run's refusal when Cancel is tapped and a different run's sheet opens", async () => {
    const abandonRun = vi.fn().mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'ccd: ws-release: permission denied' }),
    );
    render(<Harness abandonRun={abandonRun} />);

    // Abandon run 3 — it fails, and the refusal renders inline.
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    expect(await screen.findByText('ccd: ws-release: permission denied')).toBeInTheDocument();

    // Cancel, then open a DIFFERENT run's sheet.
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole('button', { name: /open run 7/i }));

    // Run 7's sheet must not open already showing run 3's refusal. Matching
    // the consequence line specifically (not a bare /run 7/i, which also
    // matches the harness's own "open run 7" trigger button still on
    // screen) — same specificity `sheet.test-d.tsx`'s neighbours use.
    expect(await screen.findByText(/^Abandon run 7 —/)).toBeInTheDocument();
    expect(screen.queryByText('ccd: ws-release: permission denied')).toBeNull();
  });

  it("a superseded in-flight abandon cannot close or write into a different run's now-open sheet", async () => {
    let resolveRun3: (() => void) | null = null;
    const abandonRun = vi.fn((id: number) => {
      if (id === 3) return new Promise<void>((resolve) => { resolveRun3 = resolve; });
      return Promise.resolve();
    });
    const onDone = vi.fn();
    render(<Harness abandonRun={abandonRun} onDone={onDone} />);

    // Confirm run 3 — the request is deliberately left hanging.
    fireEvent.click(screen.getByRole('button', { name: /^abandon$/i }));
    expect(await screen.findByText(/abandoning…/i)).toBeInTheDocument();

    // Dismissed via the SCRIM, not the (disabled-while-busy) Cancel button —
    // the path the review found ungated on `busy`
    // (`components/Sheet.tsx:45`, `Drawer.Root onOpenChange`).
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    // vaul/Radix's own dismissal is not always synchronous with the click —
    // its underlying `Drawer.Root onOpenChange` can fire a beat later than
    // the overlay's own `onClick`. Waiting for the FIRST sheet to actually
    // be gone before reopening avoids racing a delayed vaul callback against
    // the second sheet's own mount (a jsdom/vaul timing artifact, not the
    // behaviour under test — the two-sheet race itself is exercised by the
    // assertions below, once both are settled at a real DOM state each).
    await waitFor(() => expect(screen.queryByRole('button', { name: /^abandon$/i })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /open run 7/i }));

    // A different run's sheet opens — it must not be stuck reading
    // "Abandoning…" for a request it never made. Matching the consequence
    // line specifically (not a bare /run 7/i, which also matches the
    // harness's own "open run 7" trigger button still on screen).
    expect(await screen.findByText(/^Abandon run 7 —/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^abandon$/i })).not.toBeDisabled();

    // Run 3's request FINALLY resolves. It must not close run 7's sheet or
    // fire onDone for a run the operator never touched.
    resolveRun3!();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/^Abandon run 7 —/)).toBeInTheDocument();
  });
});
