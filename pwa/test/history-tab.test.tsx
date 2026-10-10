import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LifecycleGap, LifecycleQueryResult, MirroredLifecycleEvent } from '../../shared/api';
import { HistoryTab } from '../src/session/HistoryTab';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createSessionStore } from '../src/stores/session';
import { api } from '../src/lib/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const T0 = 1_755_000_000_000;

const ev = (over: Partial<MirroredLifecycleEvent> = {}): MirroredLifecycleEvent => ({
  uid: '1755000000000000000.100.1', at: T0, act: 'archive', badact: null,
  outcome: 'done', badoutcome: null, id: 'demo-quiet-basin', tx: null,
  verb: 'ws-archive', refusal: null, detail: null, truncated: false,
  obs: {
    cg: 'pane', cgraw: '0::/app.slice/tmux-spawn-x.scope', pid: 100, ppid: 1,
    pane: 'cc-demo-quiet-basin', paneWhy: null, tty: true, ssh: null,
  },
  dec: { surface: 'cli', actor: 'the operator', reason: 'merged:#42', crosspool: null },
  meas: null, raw: '{}', gen: '1755000000000000000', ingestedAt: T0 + 500,
  ...over,
});

const gap = (over: Partial<LifecycleGap> = {}): LifecycleGap => ({
  at: T0 + 60_000, gen: '1755000000000000000', reason: 'shrank',
  detail: 'generation shrank below its cursor; re-read from 0', lostFrom: null, lostTo: null,
  ...over,
});

const stub = (r: LifecycleQueryResult) => vi.spyOn(api, 'lifecycle').mockResolvedValue(r);

describe('HistoryTab', () => {
  it('fetches on open and not while closed', async () => {
    const spy = stub({ events: [ev()], gaps: [] });
    const { rerender } = render(<HistoryTab id="demo-quiet-basin" open={false} onClose={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
    rerender(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('demo-quiet-basin'));
  });

  it('renders obs and dec side by side in ONE row — two families, never a merged who (R3)', async () => {
    stub({ events: [ev()], gaps: [] });
    const { baseElement } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() => expect(baseElement.querySelector('.history-row')).not.toBeNull());
    const row = baseElement.querySelector('.history-row')!;
    expect(row.querySelector('.history-obs')!.textContent).toContain('observed: pane');
    expect(row.querySelector('.history-dec')!.textContent)
      .toContain('declared: cli · the operator — merged:#42');
    // The declared reason renders VERBATIM — attribution, not authentication.
  });

  it('gives disagrees its own colour hook', async () => {
    // The supervisor passes no flags, so a `pwa` declaration from it is the
    // real disagreement shape (shared/api.ts's DEC_CORROBORATES).
    stub({
      events: [ev({
        obs: { cg: 'supervisor', cgraw: '0::/app.slice/claude-session@x.service', pid: 1, ppid: 1, pane: null, paneWhy: null, tty: false, ssh: null },
        dec: { surface: 'pwa', actor: null, reason: null, crosspool: null },
      })],
      gaps: [],
    });
    const { baseElement } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() =>
      expect(baseElement.querySelector('.history-corr[data-corr="disagrees"]')).not.toBeNull());
  });

  it('renders a gap as a hole in the timeline, not silence (D6)', async () => {
    stub({ events: [ev()], gaps: [gap()] });
    const { baseElement } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() => expect(baseElement.querySelector('.history-row--gap')).not.toBeNull());
    expect(baseElement.querySelector('.history-gap')!.textContent).toContain('shrank');
  });

  it('renders an unmodelled act with its preserved token, never a blank cell', async () => {
    stub({ events: [ev({ act: 'unknown', badact: 'quarantine' })], gaps: [] });
    const { baseElement } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() =>
      expect(baseElement.querySelector('.history-act')!.textContent).toContain('quarantine'));
  });

  it('says the honest thing for an empty answer', async () => {
    stub({ events: [], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/no journal rows/i)).toBeInTheDocument());
    expect(screen.getByText(/predates the lifecycle journal/i)).toBeInTheDocument();
  });

  it('names a failed read instead of rendering a confident empty timeline', async () => {
    vi.spyOn(api, 'lifecycle').mockRejectedValue(new Error('not-configured'));
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/couldn't read the journal/i)).toBeInTheDocument());
    expect(screen.queryByText(/no journal rows/i)).toBeNull();
  });
});

describe('SessionScreen opens the history from the header overflow', () => {
  it('the History menu item mounts the tab and it fetches this session', async () => {
    const spy = stub({ events: [], gaps: [] });
    const store = createSessionStore('claude:demo', {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
      api: { prompt: async () => {} },
    });
    act(() => {
      store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
    });
    render(<SessionScreen id="claude:demo" store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByText('History'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('claude:demo'));
  });
});

// THE DEGRADED ROWS. Every row above carries a complete `obs` and `dec`; the
// journal is a RECORD, so a line that lost a field is the ordinary case the
// later rows read against — and none of those arms had a case (measured:
// statements 27 and 88 and branches 27#0, 47#0, 49#1, 52#0, 57#1, 61#0, 61#1,
// 129#1, 130#1 of `HistoryTab.tsx` uncovered with this file 8/8 green).
describe('a journal row that lost a field still says what it knows', () => {
  it('a line with no readable time shows an em dash and sinks to the END', () => {
    // `null` is not 0 — 0 is a date. And the sort sends an undated row last
    // rather than first, because a row claiming to predate the session is
    // a worse lie than one admitting it has no time.
    const spy = stub({ events: [ev({ at: null, verb: 'ws-rm' }), ev({ at: T0, verb: 'ws-archive' })], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    return waitFor(() => {
      expect(spy).toHaveBeenCalled();
      const times = [...document.querySelectorAll('.history-when')].map((n) => n.textContent);
      expect(times, 'the undated row did not sink').toEqual([expect.stringContaining('·'), '—']);
    });
  });

  it('a row that observed NOTHING says so, rather than leaving the cell empty', async () => {
    // `obs: null` is a real shape — a journal line written by a surface with
    // no cgroup to read. "observed: nothing" is a measurement; an empty cell
    // reads as a rendering bug.
    stub({ events: [ev({ obs: null, dec: null })], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    expect(await screen.findByText('observed: nothing')).toBeInTheDocument();
    expect(screen.getByText('declared: nothing')).toBeInTheDocument();
  });

  it('an observation with no classification says `unclassified`, and omits a pane it has none of', async () => {
    stub({ events: [ev({ obs: { cg: null, cgraw: null, pid: 1, ppid: 0, pane: null, paneWhy: null, tty: false, ssh: null } })], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    const cell = await screen.findByText(/^observed:/);
    expect(cell.textContent).toBe('observed: unclassified');
  });

  it('a declaration with no actor and no reason is just its surface', async () => {
    // Three optional halves on one line, each omitted independently: a
    // trailing ` · ` or ` — ` with nothing after it is the failure this
    // shape prevents.
    stub({ events: [ev({ dec: { surface: 'pwa', actor: null, reason: null, crosspool: null } })], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    const cell = await screen.findByText(/^declared:/);
    expect(cell.textContent).toBe('declared: pwa');
  });

  it('a refusal this build has a word for is said in words', async () => {
    stub({ events: [ev({ outcome: 'refused', refusal: 'tip-unreadable' })], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('.history-refusal')).not.toBeNull());
    const said = document.querySelector('.history-refusal')?.textContent ?? '';
    expect(said, 'the raw token reached the reader').not.toBe('tip-unreadable');
    expect(said).toMatch(/could not resolve/);
  });

  it("a refusal from another family renders as ITSELF — a grep target beats silence", async () => {
    // `wsaudit`'s tokens have no L0 word here. Rendering nothing would make
    // a refused row look like it refused for no reason at all.
    stub({ events: [ev({ outcome: 'refused', refusal: 'some-token-from-wsaudit' })], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    expect(await screen.findByText('some-token-from-wsaudit')).toBeInTheDocument();
  });

  it('a row with no refusal renders no refusal cell at all', async () => {
    stub({ events: [ev()], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('.history-row')).not.toBeNull());
    expect(document.querySelector('.history-refusal'),
      'an empty refusal cell is a cell that says something happened').toBeNull();
  });

  it('a row with no uid is still keyed, and renders beside one that has one', async () => {
    // `e.uid ?? i`: a journal line whose uid the box could not read must not
    // collide with another's React key, which is how two rows become one.
    stub({ events: [ev({ uid: null, verb: 'ws-rm' }), ev({ uid: null, verb: 'ws-archive' })], gaps: [] });
    render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll('.history-row')).toHaveLength(2));
  });

  it('a read for an EARLIER open cannot render over the newer one', async () => {
    // The `live` flag, and reaching it takes two opens: with `open={false}`
    // the sheet renders nothing at all, so a late answer is invisible either
    // way (measured — deleting the flag leaves a one-open case green). The
    // tab re-fetches on EVERY open, so the real hazard is a slow first read
    // landing after a second has already answered: without the flag it
    // overwrites the newer rows with the older ones.
    const pending: ((r: LifecycleQueryResult) => void)[] = [];
    vi.spyOn(api, 'lifecycle').mockImplementation(() =>
      new Promise<LifecycleQueryResult>((res) => { pending.push(res); }));

    const { rerender } = render(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    expect(await screen.findByText(/Reading the journal/)).toBeInTheDocument();
    rerender(<HistoryTab id="demo-quiet-basin" open={false} onClose={() => {}} />);
    rerender(<HistoryTab id="demo-quiet-basin" open onClose={() => {}} />);
    await waitFor(() => expect(pending).toHaveLength(2));

    // The SECOND read answers first, with one row; then the first read's
    // answer lands with two.
    await act(async () => { pending[1]!({ events: [ev({ verb: 'ws-archive' })], gaps: [] }); await Promise.resolve(); });
    await waitFor(() => expect(document.querySelectorAll('.history-row')).toHaveLength(1));

    await act(async () => {
      pending[0]!({ events: [ev({ verb: 'ws-rm' }), ev({ verb: 'ws-reap' })], gaps: [] });
      await Promise.resolve();
    });
    expect(document.querySelectorAll('.history-row'),
      "an earlier open's answer replaced the newer one").toHaveLength(1);
  });
}, 20_000);
