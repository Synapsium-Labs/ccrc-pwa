import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PANE_LISTING_DEADLINE_MS, PANE_LISTING_FORMAT, Tmux, parsePaneListing, pidFromListing, verdictFromListing,
  type ExecResult, type PaneListing, type Runner,
} from '../src/exec.js';
import { isExecAllowed } from '../../agent/src/whitelist.js';

const ran = (stdout: string, over: Partial<ExecResult> = {}): ExecResult =>
  ({ ran: true, code: 0, stdout, stderr: '', ...over }) as ExecResult;

describe('parsePaneListing', () => {
  it('answers live sessions with the active window\'s lowest pane', () => {
    const out = [
      'cc-sess-a 0 0 111', // inactive window
      'cc-sess-a 1 1 223', // active window, second pane
      'cc-sess-a 1 0 222', // active window, lowest pane
      'cc-sess-b 1 0 333',
      '',
    ].join('\n');
    const l = parsePaneListing(ran(out), 42);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.at).toBe(42);
    expect(l.panes.get('cc-sess-a')).toEqual({ pid: 222 });
    expect(l.panes.get('cc-sess-b')).toEqual({ pid: 333 });
    expect(l.panes.size).toBe(2);
  });

  it('a session name with a space parses', () => {
    const l = parsePaneListing(ran('my session 1 0 444\ncc-sess-b 1 0 333\n'), 1);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.panes.get('my session')).toEqual({ pid: 444 });
    expect(l.panes.get('cc-sess-b')).toEqual({ pid: 333 });
  });

  it('a session listed with no active window answers pid null', () => {
    const l = parsePaneListing(ran('cc-sess-a 0 0 111\n'), 1);
    expect(l.ok && l.panes.get('cc-sess-a')).toEqual({ pid: null });
  });

  it('an exit-0 answer with no pane line is no listing (a running tmux has a session; none exits 1)', () => {
    for (const out of ['', '\n']) {
      const e = parsePaneListing(ran(out), 1);
      expect(e.ok).toBe(false);
      if (!e.ok) expect(e.detail).toBe('tmux listed no panes');
    }
  });

  it.each([
    ['a non-zero exit', ran('', { code: 1, stderr: 'no server running on /tmp/x' })],
    ['a non-zero exit with no message', ran('', { code: 1 })],
    ['a signal', ran('cc-a 1 0 5\n', { signal: 'SIGTERM' })],
    ['ran:false', { ran: false, reason: 'spawn', detail: 'ENOENT', code: 1, stdout: '', stderr: '' } as ExecResult],
    ['an unparseable line', ran('cc-a 1 0 5\nnot a row\n')],
  ])('%s answers ok:false with a non-empty detail', (_n, r) => {
    const l = parsePaneListing(r, 7);
    expect(l.ok).toBe(false);
    if (l.ok) return;
    expect(l.at).toBe(7);
    expect(l.detail).not.toBe('');
  });
});

describe('verdictFromListing', () => {
  const ok: PaneListing & { ok: true } = {
    ok: true, at: 1, panes: new Map([['cc-sess_a', { pid: 5 }], ['cc-sess-b', { pid: null }]]),
  };
  it('named is live, absent is gone, and a dotted id matches through tmuxName', () => {
    expect(verdictFromListing(ok, 'sess-b')).toEqual({ verdict: 'live' });
    expect(verdictFromListing(ok, 'sess-c')).toEqual({ verdict: 'gone' });
    expect(verdictFromListing(ok, 'sess.a')).toEqual({ verdict: 'live' });
  });
  it('a colon in an id maps through tmuxName like a dot', () => {
    expect(verdictFromListing(ok, 'sess:a')).toEqual({ verdict: 'live' });
  });
});

describe('PANE_LISTING_FORMAT', () => {
  it('is pinned', () => {
    expect(PANE_LISTING_FORMAT).toBe('#{session_name} #{window_active} #{pane_index} #{pane_pid}');
  });
});

describe('Tmux.listPanes', () => {
  it('runs exactly one exec with the granted prefix', async () => {
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return ran('cc-x 1 0 9\n'); };
    const before = Date.now();
    const l = await new Tmux(run).listPanes();
    expect(calls).toEqual([['tmux', 'list-panes', '-a', '-F', PANE_LISTING_FORMAT]]);
    expect(l.ok).toBe(true);
    expect(l.at).toBeGreaterThanOrEqual(before);
    expect(l.at).toBeLessThanOrEqual(Date.now());
    expect(isExecAllowed('tmux', calls[0]!.slice(1))).toBe(true);
  });
});

describe('Tmux.listPanes deadline', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('a tmux that never answers reads as a failed listing after the deadline', async () => {
    vi.useFakeTimers();
    const run: Runner = () => new Promise(() => {});
    const p = new Tmux(run).listPanes();
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(PANE_LISTING_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const l = await p;
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.detail).toBe('tmux list-panes did not answer within 10 s');
  });
  it('an answer in time leaves no timer behind', async () => {
    vi.useFakeTimers();
    const run: Runner = async () => ran('cc-x 1 0 9\n');
    const l = await new Tmux(run).listPanes();
    expect(l.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('pidFromListing', () => {
  it('answers the active pane pid through tmuxName, null for an absent or windowless session', () => {
    const l = parsePaneListing(ran('cc-sess_a 1 0 222\ncc-sess-c 0 0 9\n'), 1);
    if (!l.ok) throw new Error('listing');
    expect(pidFromListing(l, 'sess.a')).toBe(222);
    expect(pidFromListing(l, 'sess-c')).toBeNull();
    expect(pidFromListing(l, 'sess-x')).toBeNull();
  });
});
