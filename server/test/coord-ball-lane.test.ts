// D-8126 wave A6 (coordinator-autonomy-default plan, Tasks A6-2, A6-3 and A6-4): the reads in `coord/coordBallLane.ts`,
// on a fake port. The sweep-level cases are in `stall-sweep.test.ts` and `idle-compact-nudge-lane.test.ts`; these pin
// what a sweep's one-run fixtures cannot see: the claimed series' filter and order, the newest event across several,
// and the R7 notice reading nothing without an episode.
import { describe, it, expect } from 'vitest';
import { claimedOpenRuns, idleNudgeOpenRunOf, r7BreachNotice } from '../src/coord/coordBallLane.js';
import type { WatcherCoordPort } from '../src/coord/ports.js';
import type { StallCoordBlockedInput } from '../src/coord/stall.js';

const NOW = 1_800_000_000_000;
const COORD = 'coord-a';
interface FakeRun { id: number; sessionId: string | null; claimedBy: string | null; state: string; program?: string }
function port(runs: readonly FakeRun[], events: Record<number, number[]> = {}, blocking: readonly string[] = []): WatcherCoordPort {
  const fake = {
    bindingRunsOf: () => ({ ok: true, runs: runs.map((r) => ({ ...r, openedAt: 0, closedAt: null, sessionBornAt: null, sessionBornFor: null, dispatchStartedAt: null })) }),
    run: (id: number) => {
      const r = runs.find((x) => x.id === id);
      return { ok: true, run: r === undefined ? null : {
        id: r.id, kind: 'work', state: r.state, sessionId: r.sessionId, claimedBy: r.claimedBy, dispatchedAt: null,
        program: r.program ?? 'prog-a', wave: 1, waveOf: 2, project: 'project-a', workspace: null,
      } };
    },
    runEvents: (id: number) => (events[id] ?? []).map((at) => ({ at, fromState: 'working', toState: 'working', causedBy: 'x', detail: null })),
    programmeHasBlockingItem: (p: string) => blocking.includes(p),
  };
  return fake as unknown as WatcherCoordPort;
}

describe('claimedOpenRuns', () => {
  it('keeps only the runs the coordinator claims that are not terminal, in id order, a planned run with no worker included', () => {
    const p = port([
      { id: 9, sessionId: 'lane-a', claimedBy: COORD, state: 'awaiting-review' },
      { id: 3, sessionId: null, claimedBy: COORD, state: 'planned' },
      { id: 5, sessionId: 'lane-b', claimedBy: COORD, state: 'done' },
      { id: 7, sessionId: COORD, claimedBy: 'coord-b', state: 'working' },   // the coordinator is this run's worker
    ]);
    const r = claimedOpenRuns(p, COORD);
    expect(r.ok && r.runs.map((x) => [x.id, x.sessionId])).toEqual([[3, ''], [9, 'lane-a']]);
  });
});

describe('idleNudgeOpenRunOf', () => {
  it('the newest event across every claimed run, whichever order they come in', () => {
    const p = port([{ id: 1, sessionId: 'lane-a', claimedBy: COORD, state: 'working' }, { id: 2, sessionId: 'lane-b', claimedBy: COORD, state: 'awaiting-review' }],
      { 1: [NOW - 3_600_000, NOW - 60_000], 2: [NOW - 7_200_000] });
    expect(idleNudgeOpenRunOf(p, COORD)).toEqual({ ok: true, lastEventAt: NOW - 60_000, blocked: false });
  });
  it('blocked when any claimed run\'s programme holds a blocking item; null when it claims none', () => {
    const runs = [{ id: 1, sessionId: 'lane-a', claimedBy: COORD, state: 'working', program: 'prog-b' }];
    expect(idleNudgeOpenRunOf(port(runs, {}, ['prog-b']), COORD)).toEqual({ ok: true, lastEventAt: null, blocked: true });
    expect(idleNudgeOpenRunOf(port([]), COORD)).toBeNull();
  });
});

describe('r7BreachNotice', () => {
  it('reads nothing without an open episode', () => {
    const untouchable = new Proxy({}, { get: () => { throw new Error('the store was read'); } }) as WatcherCoordPort;
    expect(r7BreachNotice(untouchable, {} as StallCoordBlockedInput, null, NOW)).toBeNull();
  });
});
