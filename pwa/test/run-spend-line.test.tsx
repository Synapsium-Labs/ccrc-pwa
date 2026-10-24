// D-6799: the run board shows what a run's sessions have spent, in ONE line, at
// every width. Measuring only. The words are `runSpendLine`'s; the row mounts them.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { RunSpend, RunSummary } from '../../shared/api';
import { runSpendLine, compactCount } from '../src/fleet/runSpendWords';
import { RunRow } from '../src/screens/RunRow';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MEASURED: RunSpend = { measured: true, measuredAt: '2026-10-24T12:00:00Z', proxyUsd: 1.5234,
  tokens: { input: 1_200, cacheWrite: 300_000, cacheRead: 4_500_000, output: 17_400 } };

describe('compactCount', () => {
  it('is exact below a thousand and one decimal of k / M above', () => {
    expect([0, 999, 1000, 1234, 17_400, 999_999, 1_000_000, 4_500_000].map(compactCount))
      .toEqual(['0', '999', '1k', '1.2k', '17.4k', '1M', '1M', '4.5M']);
  });
});

describe('runSpendLine', () => {
  it('measured: a short half (dollars, output) and a long half (input, cache), the whole in the title', () => {
    const l = runSpendLine(MEASURED)!;
    expect(l.measured).toBe(true);
    expect(l.short).toBe('≈ $1.52 · out 17.4k');
    expect(l.long).toBe('in 1.2k · cache r 4.5M w 300k');
    expect(l.title).toContain('proxy');
    expect(l.title).toContain('not an invoice');
    expect(l.title).toContain('2026-10-24T12:00:00Z');
  });
  it('unmeasured says so, with the reason in words, and is never a zero', () => {
    for (const reason of ['no-session', 'no-sweep', 'unreadable', 'malformed', 'not-swept'] as const) {
      const l = runSpendLine({ measured: false, reason })!;
      expect(l.measured).toBe(false);
      expect(l.short).toMatch(/^spend not measured/);
      expect(l.long).toBe('');
      expect(l.short + l.title).not.toMatch(/\$0|\b0\b/);
    }
  });
  it('still loading: no line yet', () => { expect(runSpendLine(undefined)).toBeNull(); });
});

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'p', programTitle: 'Build', wave: 1, waveOf: 2, project: 'proj-a', homeProject: null,
  sessionId: 'proj-a-x', workspace: 'x', branch: 'ws/x', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'proj-a-coord', resumed: false, clearedAt: null, openedAt: 1, dispatchStartedAt: null,
  dispatchedAt: 1, closedAt: null, handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null,
    briefQueued: true, clearError: null, coordKickoffPendingSince: null }, childReclaim: null, ...over,
});
const mount = (r: RunSummary, loadSpend: (id: number) => Promise<RunSpend>) => render(
  <ul><RunRow run={r} nowMs={Date.now()} session={null} coordSession={null} frameSeen={false}
    programHasOpenRun={true} onAbandon={() => {}} onResume={() => {}} loadSpend={loadSpend} /></ul>);

describe('the run row\'s spend line', () => {
  it('asks once for the run, then shows both halves in ONE element with the long title', async () => {
    const load = vi.fn().mockResolvedValue(MEASURED);
    mount(run(), load);
    const el = await waitFor(() => screen.getByTestId('run-spend'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(3);
    expect(el.querySelector('.run-spend-short')!.textContent).toBe('≈ $1.52 · out 17.4k');
    expect(el.querySelector('.run-spend-long')!.textContent).toBe('in 1.2k · cache r 4.5M w 300k');
    expect(el.getAttribute('data-measured')).toBe('true');
    expect(screen.getAllByTestId('run-spend')).toHaveLength(1);
  });
  it('a run with no session is not asked about; a failed read says unreadable, not nothing', async () => {
    const load = vi.fn().mockResolvedValue(MEASURED);
    mount(run({ sessionId: null, state: 'planned' }), load);
    expect(screen.getByTestId('run-spend').getAttribute('data-measured')).toBe('false');
    expect(load).not.toHaveBeenCalled();
    cleanup();
    mount(run(), vi.fn().mockRejectedValue(new Error('boom')));
    await waitFor(() => expect(screen.getByTestId('run-spend').textContent).toContain('not measured'));
  });
});

describe('at every width', () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
  it('the long half is hidden below the desktop-row width and the line takes its own full-width row', () => {
    expect(css).toMatch(/\.run-row \.run-spend\s*\{[^}]*flex:\s*1 0 100%/);
    expect(css).toMatch(/@media \(max-width: 479px\)\s*\{[^}]*\.run-row \.run-spend-long\s*\{\s*display:\s*none/);
  });
});
