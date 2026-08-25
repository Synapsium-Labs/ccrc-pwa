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
  dec: { surface: 'cli', actor: 'the operator', reason: 'merged:#42' },
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
        dec: { surface: 'pwa', actor: null, reason: null },
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
