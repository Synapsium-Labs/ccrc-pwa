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
import { ToastHost } from '@ccrc/ui';
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

  // The same word serves a value the registry DID list but this build cannot
  // read (above) and a registry that did not list at all, so it names
  // neither cause.
  it("the 'unmeasurable' word blames no cause — it also covers a value the registry did list", () => {
    expect(CHILD_RECLAIM_MARKER_WORD.unmeasurable).toBe('reclaim switch unreadable');
    expect(CHILD_RECLAIM_MARKER_WORD.unmeasurable).not.toMatch(/registry/i);
  });

  // The server sends `reclaim` unconditionally, even from a fleet box that
  // lacks the reclaim capabilities — where the sweep
  // does nothing and the route answers 501. `clear` must claim only the
  // SWITCH's own state, never that reclamation is actually running, so a
  // capability-less box's honesty comes from the tap's own inline 501, not
  // from this word overclaiming what the frame cannot back.
  it("the 'clear' word claims only the switch's state — never that reclamation is running", () => {
    expect(CHILD_RECLAIM_MARKER_WORD.clear).toBe('reclaim not paused');
    expect(CHILD_RECLAIM_MARKER_WORD.clear).not.toMatch(/reclaimed when|runs close|is running/i);
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

  // The 'off' direction's own busy label —
  // only the 'on' direction's 'pausing…' had a case.
  it("a resume tap shows resuming… — the word does NOT flip either", async () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'set' }));
    const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume reclaim' }));
    expect(childReclaimPause).toHaveBeenCalledWith('off');
    expect(await screen.findByText('resuming…')).toBeInTheDocument();
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.set)).toBeInTheDocument();
  });

  // `marker !== 'set'` reads `'unmeasurable'`
  // as "not set" too, so a tap on it asks `'on'` — the fail direction of the
  // one control is STOP deletion, never resume it, even from doubt.
  it("a tap on 'unmeasurable' asks childReclaimPause('on') — doubt fails toward stopping deletion", () => {
    const store = makeStore();
    seen(store, { ...coord(), reclaim: 'quarantined' });
    const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button'));
    expect(childReclaimPause).toHaveBeenCalledWith('on');
  });

  it('settles only when a LATER frame reports the value the tap asked for', async () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'clear' }));
    render(<ChildReclaimBanner store={store} childReclaimPause={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('pausing…')).toBeInTheDocument();
    seen(store, coord({ reclaim: 'clear', childReclaimAttention: [item()] }));   // a frame, still disagreeing
    expect(screen.getByText('pausing…')).toBeInTheDocument();
    // The settle effect keys on `marker` alone, so
    // a frame whose `reclaim` value CHANGES but still is not the value the tap
    // asked for ('set') must not settle either — the guard is `marker ===
    // wantedRef.current`, never merely "marker changed".
    seen(store, { ...coord(), reclaim: 'quarantined' });
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

  // `inlinePauseError` has no `bad-request`
  // arm — a 400 must fall through to the ordinary toast like CoordBanner's own.
  it('a 400 (bad-request) falls through to the ordinary toast, not the inline banner', async () => {
    const store = makeStore();
    seen(store, coord());
    const childReclaimPause = vi.fn().mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request' }));
    render(<><ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/bad-request/i)).toBeInTheDocument();
    expect(document.querySelector('.toast')).not.toBeNull();
    expect(document.querySelector('.child-reclaim-error')).toBeNull();
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
    // A report, not a tap: the only INTERACTIVE element on the row is the
    // switch — buttons AND links, so a future remedy link on a row would fail
    // this too (the assertion counts both, not buttons only).
    expect([...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]).toHaveLength(1);
  });

  it('renders no list when nothing is standing', () => {
    const store = makeStore();
    seen(store, coord());
    render(<ChildReclaimBanner store={store} />);
    expect(document.querySelector('.child-reclaim-attention')).toBeNull();
  });

  // `role="status"` wraps the switch readout ALONE —
  // a changing attention list must not spam a live region with every
  // standing child's sentence on each sweep tick.
  it('role="status" covers the switch readout only, not the attention list', () => {
    const store = makeStore();
    seen(store, coord({ childReclaimAttention: [item()] }));
    render(<ChildReclaimBanner store={store} />);
    const status = screen.getByRole('status');
    expect(status.querySelector('.child-reclaim-attention')).toBeNull();
    expect(status.textContent).toContain(CHILD_RECLAIM_MARKER_WORD.clear);
    expect(document.querySelector('.child-reclaim-attention')).not.toBeNull();
  });

  // The twin of `coord-banner.test.tsx`'s own case: a NEW reading of this
  // row's switch retires an inline refusal about the old one, so a 501 never
  // sits under a word that has since moved on.
  it('clears an inline refusal when a later frame moves the reclaim switch — no stale 501 under a row that has moved on', async () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'clear' }));
    const childReclaimPause = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(COORD_UNSUPPORTED_TEXT)).toBeInTheDocument();

    // The switch is raised another way (by hand on the box, or from a second
    // phone): the refusal above belonged to before.
    seen(store, coord({ reclaim: 'set' }));
    expect(screen.queryByText(COORD_UNSUPPORTED_TEXT)).toBeNull();
    expect(document.querySelector('.child-reclaim-error')).toBeNull();
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.set)).toBeInTheDocument();
  });

  // This row's own direction: the
  // frame now carries both rows' facts. A frame that changes only the PAUSE
  // row's fields (`pause`/`mail`) must not clear THIS row's inline refusal —
  // `reclaim` itself never moved, so nothing this row measured changed.
  it('an inline refusal survives a frame that changes only the pause row\'s fields — reclaim did not move', async () => {
    const store = makeStore();
    seen(store, coord());
    const childReclaimPause = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(COORD_UNSUPPORTED_TEXT)).toBeInTheDocument();

    // A frame lands that differs ONLY in `pause` — this row's own field,
    // `reclaim`, is unchanged.
    seen(store, coord({ pause: 'set' }));
    expect(screen.getByText(COORD_UNSUPPORTED_TEXT)).toBeInTheDocument();
    expect(document.querySelector('.child-reclaim-error')).not.toBeNull();
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

  // The case above never isolates any ONE of
  // `isAttention`'s three checks — `{sessionId: 7}` fails BOTH the sessionId
  // and (lacking `sentence`) the sentence check at once, so deleting either
  // alone would still pass it. Each bad member below is wrong in exactly one
  // field, valid in the rest, so each pins its own check.
  it("childReclaimAttentionOf drops a member wrong in exactly ONE field — sessionId, sentence, or runId — each on its own", () => {
    const good = item();
    const badSessionId = { ...good, sessionId: 7 };
    const badSentence = { sessionId: good.sessionId, runId: good.runId };   // no `sentence` at all
    const badRunId = { ...good, runId: '41' };
    expect(childReclaimAttentionOf({ childReclaimAttention: [good, badSessionId] })).toEqual([good]);
    expect(childReclaimAttentionOf({ childReclaimAttention: [good, badSentence] })).toEqual([good]);
    expect(childReclaimAttentionOf({ childReclaimAttention: [good, badRunId] })).toEqual([good]);
  });

  // Only the fields the renderer reads are required —
  // a member with no `token` (or `at`) still reports, rather than an under-
  // count the moment a future server dropped a field this row never shows.
  it('childReclaimAttentionOf accepts a member with no token or at — the renderer never reads either', () => {
    const bare = { sessionId: 'ccrc-pwa-bare-item', runId: null, sentence: 'a sentence with no token or at' };
    expect(childReclaimAttentionOf({ childReclaimAttention: [bare] })).toEqual([bare]);
  });
});
