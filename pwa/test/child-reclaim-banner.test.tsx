// The reclaim row on /runs (child-reclamation spec §5.8, §5.9): the switch on
// automatic child reclamation and the fleet-level attention list, in the pause
// banner's shape — rendered only once a coord frame has arrived, never
// optimistic, refusals inline. `coord-banner.test.tsx` is the template, case
// for case, because the row must behave exactly as its neighbour does.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ChildReclaimAttention, CoordCapsView, CoordStatus } from '../../shared/api';
import { ChildReclaimBanner } from '../src/fleet/ChildReclaimBanner';
import {
  CHILD_RECLAIM_MARKER_GLYPH, CHILD_RECLAIM_MARKER_WORD, childReclaimAttentionOf, childReclaimMarker,
} from '../src/fleet/childReclaimWords';
import { COORD_CONFIRM_MS } from '../src/fleet/coordWords';
import { ApiError, COORD_UNSUPPORTED_TEXT } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';
import { FleetScreen } from '../src/screens/FleetScreen';
import { RunsScreen } from '../src/screens/RunsScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});

const coord = (over: Partial<CoordStatus> = {}): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], ...over });

const item = (over: Partial<ChildReclaimAttention> = {}): ChildReclaimAttention => ({
  sessionId: 'ccrc-pwa-quiet-basin', runId: 41, token: 'tree-unreadable',
  sentence: 'ccrc could not read this worktree, so it cannot prove nothing here would be lost. Nothing was removed.',
  at: Date.now() - 60_000, ...over,
});

const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

const seen = (store: FleetStore, c: CoordStatus | unknown): void => {
  act(() => { store.setState({ coord: c as CoordStatus, coordFrameSeen: true }); });
};

describe('the reclaim row', () => {
  it('renders NOTHING before any coord frame — absence is not "running"', () => {
    const { container } = render(<ChildReclaimBanner store={makeStore()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the payload is there but coordFrameSeen is not — the flag gates, not the payload', () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ reclaim: 'set' }), coordFrameSeen: false }); });
    const { container } = render(<ChildReclaimBanner store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a frame from a server that predates the field — not "unmeasurable"', () => {
    // An older server sends `{pause, mail}` alone. That is not a registry that
    // failed to list; it is a server that has no switch to show.
    const store = makeStore();
    seen(store, { pause: 'clear', mail: 'clear' });
    const { container } = render(<ChildReclaimBanner store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders two cues, word and glyph, from parallel tables — never colour alone', () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'set' }));
    render(<ChildReclaimBanner store={store} />);
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.set)).toBeInTheDocument();
    const glyph = document.querySelector('.child-reclaim-glyph');
    expect(glyph?.textContent).toBe(CHILD_RECLAIM_MARKER_GLYPH.set);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Resume reclaim' })).toHaveClass('child-reclaim-toggle');
  });

  it('degrades a MarkerState from a newer build to unmeasurable, never a blank cell', () => {
    const store = makeStore();
    seen(store, { ...coord(), reclaim: 'quarantined' });
    render(<ChildReclaimBanner store={store} />);
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.unmeasurable)).toBeInTheDocument();
  });

  it("taps call childReclaimPause('on') and show pausing… — the word does NOT flip", async () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'clear' }));
    const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause reclaim' }));
    expect(childReclaimPause).toHaveBeenCalledWith('on');
    expect(await screen.findByText('pausing…')).toBeInTheDocument();
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.clear)).toBeInTheDocument();
  });

  it("a set switch taps childReclaimPause('off')", () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'set' }));
    const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume reclaim' }));
    expect(childReclaimPause).toHaveBeenCalledWith('off');
  });

  it('settles only when a LATER frame reports the value the tap asked for', async () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'clear' }));
    render(<ChildReclaimBanner store={store} childReclaimPause={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('pausing…')).toBeInTheDocument();
    seen(store, coord({ reclaim: 'clear', childReclaimAttention: [item()] }));   // a frame, still disagreeing
    expect(screen.getByText('pausing…')).toBeInTheDocument();
    seen(store, coord({ reclaim: 'set' }));
    expect(await screen.findByText('Resume reclaim')).toBeInTheDocument();
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.set)).toBeInTheDocument();
  });

  it('renders "unconfirmed — check /runs" when no frame confirms inside COORD_CONFIRM_MS', async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      seen(store, coord({ reclaim: 'clear' }));
      render(<ChildReclaimBanner store={store} childReclaimPause={vi.fn().mockResolvedValue(undefined)} />);
      fireEvent.click(screen.getByRole('button'));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(COORD_CONFIRM_MS); });
      expect(screen.getByText('unconfirmed — check /runs')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the 501 inline with the one shared sentence, and drops back to idle', async () => {
    const store = makeStore();
    seen(store, coord());
    const childReclaimPause = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(COORD_UNSUPPORTED_TEXT)).toBeInTheDocument();
    expect(document.querySelector('.child-reclaim-error')).not.toBeNull();
    expect(screen.queryByText('pausing…')).toBeNull();
  });

  it("renders the 502's stderr inline, not as a toast", async () => {
    const store = makeStore();
    seen(store, coord());
    const childReclaimPause = vi.fn().mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'ccd: reclaim-pause: permission denied' }));
    render(<><ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('ccd: reclaim-pause: permission denied')).toBeInTheDocument();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('lists each child a terminal refusal left standing, with the SERVER\'s sentence and its run', () => {
    const store = makeStore();
    const a = item();
    const b = item({ sessionId: 'ccrc-pwa-dry-fern', runId: null, token: 'containment-unproven', sentence: 'a nested checkout of another repository holds work' });
    seen(store, coord({ childReclaimAttention: [a, b] }));
    render(<ChildReclaimBanner store={store} />);
    const rows = [...document.querySelectorAll('.child-reclaim-item')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('run #41');
    expect(rows[0]!.textContent).toContain(a.sessionId);
    expect(rows[0]!.textContent).toContain(a.sentence);
    expect(rows[1]!.textContent).toContain(b.sessionId);
    expect(rows[1]!.textContent).not.toContain('run #');
    // The PWA maps no token: the token itself is never the rendered text.
    expect(rows[0]!.textContent).not.toContain('tree-unreadable');
    // A report, not a tap: the only button on the row is the switch.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders no list when nothing is standing', () => {
    const store = makeStore();
    seen(store, coord());
    render(<ChildReclaimBanner store={store} />);
    expect(document.querySelector('.child-reclaim-attention')).toBeNull();
  });

  it('mounts on /runs, after the pause banner, and nowhere else', () => {
    const store = makeStore();
    seen(store, coord());
    const { container } = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
    const order = [...container.querySelectorAll('.coord-banner, .child-reclaim-banner')];
    expect(order).toEqual([container.querySelector('.coord-banner'), container.querySelector('.child-reclaim-banner')]);
    cleanup();
    const fleet = makeStore();
    act(() => { fleet.setState({ conn: 'open', sessions: [], coord: coord(), coordFrameSeen: true }); });
    render(<FleetScreen store={fleet} />);
    expect(document.querySelector('.child-reclaim-banner')).toBeNull();
  });
});

describe('the two tolerant readers', () => {
  it('childReclaimMarker: absent → null, unknown → unmeasurable, known → itself', () => {
    expect(childReclaimMarker(null)).toBeNull();
    expect(childReclaimMarker({ pause: 'clear', mail: 'clear' })).toBeNull();
    expect(childReclaimMarker({ reclaim: 'weird' })).toBe('unmeasurable');
    expect(childReclaimMarker({ reclaim: 'set' })).toBe('set');
  });

  it('childReclaimAttentionOf: absent or malformed → [], and a malformed member is dropped alone', () => {
    expect(childReclaimAttentionOf({ pause: 'clear' })).toEqual([]);
    expect(childReclaimAttentionOf({ childReclaimAttention: 'nope' })).toEqual([]);
    const good = item();
    expect(childReclaimAttentionOf({ childReclaimAttention: [good, { sessionId: 7 }, null, { ...good, runId: '41' }] }))
      .toEqual([good]);
  });
});
