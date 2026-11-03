// The PWA's run-to-session readers (D-7182, D-7205, D-7207; Task C7d Step 2; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 3's lookup table; ARCH-61's PWA half, GitHub #796).
// `workerOf` reads an open run's worker from the session's own wire binding and a closed run's through its named by-id
// arm; `coordinatorOf` is a named by-id lookup for every run; `claimedRunsOf` is the one coordinator-side reader;
// `boundOpenRun` is the session's open bound run as the runs list carries it.
import { describe, it, expect } from 'vitest';
import { childIdsOf, sessionRunOf, type FleetSession, type RunSummary, type SessionRun } from '../../shared/api';
import { coordinationOf, fleetTree, parentIdOf } from '../src/fleet/fleetTree';
import { orphanNote } from '../src/fleet/orphanWords';
import { fleetSession } from './fleetFixture';
import { boundOpenRun, claimedRunsOf, coordinatorOf, workerOf } from '../src/fleet/runWords';
import { coordinatorPresence } from '../src/fleet/presence';

const W = 'session-a';
const C = 'coord-a';
const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: `program-${id}`, programTitle: `Program ${id}`, wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: W, workspace: 'ws-a', branch: 'ws/ws-a', state: 'working', kind: 'work', reviews: null,
  claimedBy: C, resumed: false, clearedAt: null, openedAt: 1, dispatchStartedAt: null, dispatchedAt: 1, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, ...over,
});
const closed = (id: number, over: Partial<RunSummary> = {}): RunSummary => run(id, { state: 'done', closedAt: 2, ...over });
const bound = (r: RunSummary): SessionRun => ({ id: r.id, state: r.state, claimedBy: r.claimedBy });
const worker = (over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: W, project: 'project-a', workspace: 'ws-a', role: 'child', child: { kind: 'child', runId: 10 }, ...over });
const coord = (over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: C, project: 'project-a', role: 'coordinator', status: 'dead', bucket: 'dead', lifecycle: 'orphan', ...over });
const byId = (...ss: FleetSession[]): ReadonlyMap<string, FleetSession> => new Map(ss.map((s) => [s.id, s] as const));
const idOf = (s: FleetSession | null): string | null => s?.id ?? null;

describe('workerOf, an open run: the session counts only when its own wire binding names the run', () => {
  it('a run worked by the session (its open binding names it)', () => {
    const r = run(10);
    expect(idOf(workerOf(r, byId(worker({ run: bound(r), openRun: bound(r) }))))).toBe(W);
  });
  it('a run worked by the session through its newest binding alone (no open key)', () => {
    const r = run(11);
    expect(idOf(workerOf(r, byId(worker({ run: bound(r) }))))).toBe(W);
  });
  it('a run worked by another session: that session, never the one beside it', () => {
    const r = run(12, { sessionId: 'session-b' });
    const other = worker({ id: 'session-b', run: bound(r), openRun: bound(r) });
    expect(idOf(workerOf(r, byId(worker({ run: bound(run(13)), openRun: bound(run(13)) }), other)))).toBe('session-b');
  });
  it('a recycled worker id (#746): the listed session carries the id but its binding names another run, so no worker', () => {
    const r = run(83, { state: 'planned' });
    expect(workerOf(r, byId(worker({ run: bound(run(504)), openRun: bound(run(504)) })))).toBeNull();
    expect(workerOf(r, byId(worker({ run: null, openRun: null })))).toBeNull();
  });
  it('the skew row (an older server, no binding keys at all): an open run finds no worker', () => {
    const r = run(51);
    const s = worker({});
    expect('run' in s || 'openRun' in s).toBe(false);
    expect(workerOf(r, byId(s))).toBeNull();
  });
  it('a run with no worker (planned, sessionId null), or a worker the list does not carry: null', () => {
    expect(workerOf(run(50, { sessionId: null, state: 'planned' }), byId(worker({})))).toBeNull();
    expect(workerOf(run(54, { sessionId: 'gone' }), byId(worker({})))).toBeNull();
  });
});

describe('workerOf, a closed run: the named by-id arm (D-7205), today\'s lookup', () => {
  it('a closed run of a live session keeps its worker', () => {
    const r = closed(30);
    expect(idOf(workerOf(r, byId(worker({ run: bound(r), openRun: null }))))).toBe(W);
  });
  it('an older closed run of a session whose newest bound run is another keeps its worker', () => {
    expect(idOf(workerOf(closed(40), byId(worker({ run: bound(run(41)), openRun: bound(run(41)) }))))).toBe(W);
  });
  it('a closed run against an older server (no binding) keeps its worker, as today', () => {
    expect(idOf(workerOf(closed(42), byId(worker({}))))).toBe(W);
  });
});

describe('coordinatorOf: a named by-id lookup for every run (D-7207)', () => {
  // C7a's four ordinary open runs `childIds` does not describe: each keeps today's coordinator, `coordinatorPresence`
  // and so the Resume door (a dead coordinator reads `dead`, which is what shows the door).
  const ORDINARY: ReadonlyArray<{ name: string; run: RunSummary; sessions: FleetSession[] }> = [
    { name: 'an open planned run with sessionId null', run: run(50, { sessionId: null, workspace: null, branch: null, state: 'planned' }), sessions: [worker({ run: null, openRun: null }), coord()] },
    { name: 'an open run whose worker binding is undecidable (no run key on the worker)', run: run(51), sessions: [worker({}), coord()] },
    { name: 'an open run on a tick whose childIds are empty (the registry was unlistable)', run: run(52, { childIds: [] }), sessions: [worker({ run: bound(run(52)), openRun: bound(run(52)) }), coord()] },
    { name: 'an open run with no childIds key', run: run(53), sessions: [worker({ run: bound(run(53)), openRun: bound(run(53)) }), coord()] },
  ];
  for (const o of ORDINARY) {
    it(`${o.name}: today's coordinator and coordinatorPresence`, () => {
      const c = coordinatorOf(o.run, byId(...o.sessions));
      expect({ coord: idOf(c), presence: coordinatorPresence(o.run.claimedBy, c, true) }).toEqual({ coord: C, presence: 'dead' });
    });
  }
  it('a closed run keeps its coordinator', () => {
    expect(idOf(coordinatorOf(closed(31), byId(worker({}), coord())))).toBe(C);
  });
  it('a recycled coordinator id is answered as today: the hazard no wire fact closes', () => {
    // The run was claimed by an earlier occupant of the id; nothing on the wire binds the claimant's incarnation, so
    // the listed session carrying the id is the answer (named in the PR body).
    const live = coord({ status: 'idle', bucket: 'idle', lifecycle: 'running' });
    expect(idOf(coordinatorOf(run(12, { childIds: [] }), byId(worker({}), live)))).toBe(C);
  });
  it('an ownerless run, or a claimant the list does not carry: null', () => {
    expect(coordinatorOf(run(60, { claimedBy: null }), byId(coord()))).toBeNull();
    expect(coordinatorOf(run(61, { claimedBy: 'gone' }), byId(coord()))).toBeNull();
  });
});

describe('claimedRunsOf: the open runs this session claims, in list order', () => {
  it('keeps the claimant\'s open runs and drops a closed run, another claimant\'s and an ownerless one', () => {
    const runs = [run(1), closed(2), run(3, { claimedBy: 'coord-b' }), run(4, { claimedBy: null }), run(5, { state: 'planned', sessionId: null })];
    expect(claimedRunsOf(runs, C).map((r) => r.id)).toEqual([1, 5]);
    expect(claimedRunsOf(runs, 'coord-b').map((r) => r.id)).toEqual([3]);
    expect(claimedRunsOf(runs, 'nobody')).toEqual([]);
  });
  it('a state this build cannot name counts as open (isRunClosed), as the archive door\'s terminal set does', () => {
    expect(claimedRunsOf([run(7, { state: 'brand-new' as RunSummary['state'] })], C).map((r) => r.id)).toEqual([7]);
  });
});

describe('boundOpenRun: the session\'s open bound run, as the runs list carries it', () => {
  it('the open binding\'s row', () => {
    expect(boundOpenRun([run(10), run(11)], worker({ run: bound(run(11)), openRun: bound(run(11)) }))?.id).toBe(11);
  });
  it('the open run, not the newest: a newer run closed while an older one is open', () => {
    expect(boundOpenRun([run(20)], worker({ run: bound(closed(21)), openRun: bound(run(20)) }))?.id).toBe(20);
  });
  it('no binding (an older server, or none binds this incarnation), or a run the list has no row for: null', () => {
    expect(boundOpenRun([run(51)], worker({}))).toBeNull();
    expect(boundOpenRun([run(83)], worker({ run: null, openRun: null }))).toBeNull();
    expect(boundOpenRun([run(10)], worker({ run: bound(run(99)), openRun: bound(run(99)) }))).toBeNull();
  });
});

// The skew rows (spec §5.1 rule 1c; Task C7d Step 12): the new PWA against a server predating ARCH-61's server half
// (#1546), whose fleet frame carries no `run` or `openRun` key and whose runs carry no `childIds`. The keys read as
// `null`, `null` and `[]`, and every worker-side surface then shows what it shows for a session with no run: no
// bracket, no header programme line, no hold door, no orphan marker. The coordinator side is unchanged (`coordinatorOf`
// and `claimedRunsOf` read the run's claimant id, D-7207), so the palette's programme terms and the Resume door stay.
describe('the skew rows: an older server sends no binding', () => {
  const coordS = coord({ status: 'idle', bucket: 'idle', lifecycle: 'running', name: 'the coordinator' });
  const workerS = worker({ held: 'program:program-10 wave:1/2 run:10' });
  const r10 = run(10);
  it('the binding keys read null, null and []', () => {
    expect(sessionRunOf(workerS)).toBeNull();
    expect(sessionRunOf(workerS, 'open')).toBeNull();
    expect(childIdsOf(r10)).toEqual([]);
  });
  it('the worker-side readers answer as for a session with no run', () => {
    const fleet = [coordS, workerS];
    const rowsOf = (runs: RunSummary[]): string[] => fleetTree(fleet, [], runs).flatMap((g) => g.rows.map((x) => (x.kind === 'session' ? `${x.session.id}:${x.depth}` : x.kind === 'pending' ? `spawn:${x.run.id}` : x.kind)));
    expect(rowsOf([r10])).toEqual(rowsOf([]));
    expect(parentIdOf(workerS, [r10])).toBeNull();
    expect(coordinationOf(workerS, fleet, [r10])).toEqual(coordinationOf(workerS, fleet, []));
    expect(boundOpenRun([r10], workerS)).toBeNull();
    expect(orphanNote({ kind: 'session', depth: 0, session: workerS }, [r10], 'project-a', [workerS], () => null, true)).toBeNull();
    expect(workerOf(r10, byId(...fleet))).toBeNull();
  });
  it('the coordinator side keeps today\'s answer: the claimant, and its claimed open runs', () => {
    expect(idOf(coordinatorOf(r10, byId(coordS, workerS)))).toBe(C);
    expect(claimedRunsOf([r10], C).map((r) => r.id)).toEqual([10]);
  });
});
