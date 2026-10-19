// U6's model (D-5587): the board's runs grouped by what they need. A pure
// module, so every case here is data in and groups out; P5 (the board) and P9
// (Instrument's runs split) are its readers.
import { describe, expect, it } from 'vitest';
import { RUN_STATES, type RunState, type RunSummary } from '../../shared/api';
import { RUN_GROUP, groupRuns } from '../src/fleet/runGroups';
import { isRunClosed, programWave, runsByProgram } from '../src/fleet/runWords';

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 1, program: 'programme-a', programTitle: 'Programme A',
  wave: 1, waveOf: 4, project: 'project-a', homeProject: null,
  sessionId: 'ws-a', workspace: 'ws-a', branch: 'ws/ws-a',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: null, resumed: false, clearedAt: null,
  openedAt: 1_000, dispatchStartedAt: null, dispatchedAt: 1_100, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

/** Every id the groups list, in render order. */
const ids = (g: ReturnType<typeof groupRuns>): number[] => [
  ...g.needs.map((row) => row.run.id),
  ...g.running.flatMap((group) => group.runs.map((r) => r.id)),
  ...g.finished.map((r) => r.id),
];

describe('groupRuns (D-5587)', () => {
  it('awaiting-review leads in Needs you, whatever its programme', () => {
    const active = [
      run({ id: 1, program: 'programme-a', state: 'working' }),
      run({ id: 2, program: 'programme-b', programTitle: 'Programme B', state: 'awaiting-review' }),
      run({ id: 3, program: 'programme-c', programTitle: 'Programme C', state: 'dispatched' }),
      run({ id: 4, program: 'programme-c', programTitle: 'Programme C', wave: 2, state: 'awaiting-review' }),
    ];
    const g = groupRuns(active, []);
    expect(g.needs.map((row) => row.run.id).sort()).toEqual([2, 4]);
    // Each Needs-you row carries its programme's title, so the row can say whose it is.
    expect(g.needs.find((row) => row.run.id === 2)?.title).toBe('Programme B');
    expect(g.needs.find((row) => row.run.id === 4)?.title).toBe('Programme C');
    // Needs you comes first in the order the board reads.
    expect(ids(g).slice(0, 2).sort()).toEqual([2, 4]);
  });

  it('a failed run is in Finished, never in Needs you', () => {
    const failed = run({ id: 5, state: 'failed', closedAt: 2_000 });
    const done = run({ id: 6, state: 'done', closedAt: 1_900 });
    const g = groupRuns([run({ id: 1 })], [failed, done]);
    expect(g.needs).toEqual([]);
    expect(g.finished.map((r) => r.id)).toEqual([5, 6]);
    // Defensively: a closed run that reached `active` anyway still files as Finished.
    const leaked = groupRuns([run({ id: 7, state: 'failed' })], []);
    expect(leaked.needs).toEqual([]);
    expect(leaked.running).toEqual([]);
    expect(leaked.finished.map((r) => r.id)).toEqual([7]);
  });

  it('a run is listed once', () => {
    const active = [
      run({ id: 1, program: 'programme-a', wave: 1, state: 'awaiting-review' }),
      run({ id: 2, program: 'programme-a', wave: 2, state: 'working' }),
      run({ id: 3, program: 'programme-b', state: 'awaiting-review' }),
    ];
    const finished = [run({ id: 4, program: 'programme-a', state: 'done', closedAt: 5 })];
    const g = groupRuns(active, finished);
    expect(ids(g).sort()).toEqual([1, 2, 3, 4]);
    // A programme whose only open run waits on review has no Running group of its own.
    expect(g.running.map((group) => group.program)).toEqual(['programme-a']);
    expect(g.running[0]!.runs.map((r) => r.id)).toEqual([2]);
  });

  it("Running groups by programme in runsByProgram's order, with programWave's wave", () => {
    // programme-a's urgency-first head is wave 1 (working outranks dispatched),
    // while the programme has reached wave 2: list[0].wave would say 1.
    const active = [
      run({ id: 1, program: 'programme-b', programTitle: 'Programme B', wave: 1, waveOf: null, state: 'planned' }),
      run({ id: 2, program: 'programme-a', wave: 2, waveOf: 4, state: 'dispatched' }),
      run({ id: 3, program: 'programme-a', wave: 1, waveOf: 4, state: 'working' }),
      // programme-c's furthest wave waits on review: the programme's wave still counts it.
      run({ id: 4, program: 'programme-c', programTitle: 'Programme C', wave: 2, waveOf: 3, state: 'working' }),
      run({ id: 5, program: 'programme-c', programTitle: 'Programme C', wave: 3, waveOf: 3, state: 'awaiting-review' }),
    ];
    const g = groupRuns(active, []);
    const order = runsByProgram(active).map((group) => group.program);
    expect(g.running.map((group) => group.program)).toEqual(order);
    const a = g.running.find((group) => group.program === 'programme-a')!;
    expect(a.runs.map((r) => r.id)).toEqual([3, 2]);
    expect(a.runs[0]!.wave).toBe(1);
    expect({ wave: a.wave, waveOf: a.waveOf }).toEqual(programWave(active.filter((r) => r.program === 'programme-a')));
    expect(a.wave).toBe(2);
    const b = g.running.find((group) => group.program === 'programme-b')!;
    expect({ wave: b.wave, waveOf: b.waveOf }).toEqual({ wave: 1, waveOf: null });
    const c = g.running.find((group) => group.program === 'programme-c')!;
    expect(c.runs.map((r) => r.id)).toEqual([4]);
    expect({ wave: c.wave, waveOf: c.waveOf }).toEqual({ wave: 3, waveOf: 3 });
  });

  it("a group's title is the programme's title, the slug only when no run has one", () => {
    const titled = groupRuns([
      run({ id: 1, program: 'programme-a', programTitle: '', state: 'working' }),
      run({ id: 2, program: 'programme-a', programTitle: 'Programme A', state: 'planned' }),
    ], []);
    expect(titled.running[0]!.title).toBe('Programme A');
    const untitled = groupRuns([
      run({ id: 1, program: 'programme-a', programTitle: '', state: 'working' }),
      run({ id: 2, program: 'programme-a', programTitle: '', state: 'awaiting-review' }),
    ], []);
    expect(untitled.running[0]!.title).toBe('programme-a');
    expect(untitled.needs[0]!.title).toBe('programme-a');
    // A Needs-you row reads the title another run of its programme carries.
    const borrowed = groupRuns([
      run({ id: 1, program: 'programme-a', programTitle: '', state: 'awaiting-review' }),
      run({ id: 2, program: 'programme-a', programTitle: 'Programme A', state: 'working' }),
    ], []);
    expect(borrowed.needs[0]!.title).toBe('Programme A');
  });

  it('every RunState has a group', () => {
    expect(Object.keys(RUN_GROUP).sort()).toEqual([...RUN_STATES].sort());
    // The record's Finished states are exactly the ones isRunClosed closes (D-5650).
    for (const state of RUN_STATES) {
      expect(RUN_GROUP[state] === 'finished').toBe(isRunClosed({ state }));
    }
    expect(RUN_GROUP['awaiting-review']).toBe('needs');
  });

  it('unknown sits under Running, never Needs you', () => {
    const fromNewerBuild = { ...run({ id: 2 }), state: 'quarantined' } as unknown as RunSummary;
    const g = groupRuns([run({ id: 1, state: 'unknown' }), fromNewerBuild], []);
    expect(g.needs).toEqual([]);
    expect(g.running.flatMap((group) => group.runs.map((r) => r.id)).sort()).toEqual([1, 2]);
    expect(RUN_GROUP.unknown satisfies 'needs' | 'running' | 'finished').toBe('running');
    const states: RunState[] = ['unknown'];
    expect(states.map((s) => RUN_GROUP[s])).toEqual(['running']);
  });
});
