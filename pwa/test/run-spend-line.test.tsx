// D-6799: what a run's sessions have spent, in ONE line. `runSpendLine` owns the words; the run page mounts them (the runs
// rebuild, D-8072, A10: the board's row no longer does, which was 69 reads per mount).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { RUN_SPEND_UNMEASURED_REASONS, type RunSpend, type RunSummary } from '../../shared/api';
import { runSpendLine } from '../src/fleet/runSpendWords';
import { RunRow } from '../src/screens/RunRow';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MEASURED: RunSpend = { measured: true, measuredAt: '2026-10-24T12:00:00Z', proxyUsd: 1.5234,
  tokens: { input: 1_200, cacheWrite: 300_000, cacheRead: 4_500_000, output: 17_400 } };

describe('runSpendLine', () => {
  it('measured: a short half (dollars, output) and a long half (input, cache), the whole in the title', () => {
    const l = runSpendLine(MEASURED)!;
    expect(l.measured).toBe(true);
    expect(l.short).toBe('≈ $1.52 · out 17.4k');
    expect(l.long).toBe('in 1.2k · cache r 4.5m w 300k');
    expect(l.title).toContain('proxy');
    expect(l.title).toContain('not an invoice');
    expect(l.title).toContain('7-day window');
    expect(l.title).toContain('Partial');
    expect(l.title).toContain('2026-10-24T12:00:00Z');
  });
  it('unmeasured says so, with the reason in words, and is never a zero', () => {
    for (const reason of RUN_SPEND_UNMEASURED_REASONS) {
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
    briefQueued: true, clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});

describe('the run row reads no spend (A10)', () => {
  it('a row mounts with no spend line and sends no read, for a run with a session or without one', () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    for (const r of [run(), run({ sessionId: null, state: 'planned' })]) {
      render(
        <ul><RunRow run={r} nowMs={Date.now()} session={null} coordSession={null} frameSeen={false}
          programHasOpenRun={true} onAbandon={() => {}} onResume={() => {}} /></ul>);
      expect(screen.queryByTestId('run-spend')).toBeNull();
      cleanup();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('the board leaves no spend hook or class behind', () => {
    const src = (f: string): string => readFileSync(path.join(import.meta.dirname, '..', 'src', f), 'utf8');
    expect(existsSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'useRunSpend.ts'))).toBe(false);
    expect(src('screens/RunRow.tsx')).not.toMatch(/useRunSpend|runSpendLine|loadSpend/);
    expect(src('fleet/fleet.css')).not.toMatch(/\.run-row \.run-spend/);
  });
});
