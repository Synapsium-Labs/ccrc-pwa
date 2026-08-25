// The programme tree, as five rules a reviewer can reject one at a time
// (Task 4, spawn visibility). The helper is PURE and decides the whole shape
// of a card's body — which row is a child of which, in what order, and where
// a spawn that has no session yet goes — so every rule below is a unit
// assertion over `nestFleet`, never a render.
//
// The edge is `run.claimedBy` (the coordinator that opened the run — the
// parent) -> `run.sessionId` (the worker it dispatched — the child). Both
// halves ride on `RunSummary` (Tasks 1-2), and the `runs` frame this reads is
// ACTIVE-ONLY by construction (`watch.ts`'s `emitRuns` calls `coord.runs()`
// with no options), so the tree describes the programme structure that is live
// right now and forgets it the moment the programme closes.
import { describe, it, expect } from 'vitest';
import type { FleetSession, RunSummary } from '../../shared/api';
import { nestFleet, type FleetRow } from '../src/fleet/nestFleet';

const sess = (id: string, over: Partial<FleetSession> = {}): FleetSession => ({
  id, wrapper: 'claude', home: 'claude', project: 'ccrc-pwa', workdir: '/w',
  workspace: id, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null,
  started: true, spawnState: null, ...over,
});

/** A run in the shape the `runs` frame actually carries one. `claimedBy` is
 *  spelled at every call site rather than defaulted, because the ownership
 *  edge IS the subject of this file. */
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 1, program: 'build9b', programTitle: 'Build 9b', wave: 1, waveOf: 3,
  project: 'ccrc-pwa', sessionId: null, workspace: null, branch: null,
  state: 'dispatched', claimedBy: 'coord', resumed: false, clearedAt: null,
  openedAt: 1_800_000_000_000, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0, ...over,
});

/** `[what, depth]` per row, in display order — a session row by its id, a
 *  pending spawn by the run it is waiting on. One readable literal per
 *  assertion, so a rule that breaks says which row moved. */
const shape = (rows: readonly FleetRow[]): [string, number][] =>
  rows.map((r) => (r.kind === 'session' ? [r.session.id, r.depth] : [`spawn:${r.run.id}`, r.depth]));

describe('nestFleet — rule 0: a fleet with no programme reads exactly as it does today', () => {
  it('returns every session at depth 0, in the order it was given', () => {
    // The no-regression baseline, and the reason the helper takes `sortFleet`'s
    // OUTPUT rather than re-sorting: with nothing to nest, this is the identity
    // function over the list the card already rendered.
    const sessions = [sess('a'), sess('b'), sess('c')];
    expect(shape(nestFleet(sessions, []))).toEqual([['a', 0], ['b', 0], ['c', 0]]);
  });

  it('does not mutate either input', () => {
    const sessions = [sess('a'), sess('b')];
    const runs = [run({ id: 2, sessionId: 'b', claimedBy: 'a' })];
    const sessionsCopy = [...sessions];
    const runsCopy = [...runs];
    nestFleet(sessions, runs);
    expect(sessions).toEqual(sessionsCopy);
    expect(runs).toEqual(runsCopy);
  });
});

describe('nestFleet — rule 1: the happy shape', () => {
  it('brackets both workers under the coordinator that owns their runs, each exactly once', () => {
    const sessions = [sess('coord'), sess('w1'), sess('w2')];
    const rows = nestFleet(sessions, [
      run({ id: 10, wave: 1, sessionId: 'w1', claimedBy: 'coord' }),
      run({ id: 11, wave: 2, sessionId: 'w2', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['w1', 1], ['w2', 1]]);
    // "exactly once — never also at top level" is the half a naive
    // implementation fails: rendering the children under the parent AND
    // leaving them in the ordinary list is two rows for one session.
    expect(rows.filter((r) => r.kind === 'session' && r.session.id === 'w1')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'session' && r.session.id === 'w2')).toHaveLength(1);
  });
});

describe('nestFleet — rule 2: children are in PROGRAMME order, not status order', () => {
  it('sorts children by the run’s wave ascending, then by run id — against the list’s own order', () => {
    // The input order DISAGREES with the programme order on purpose: `w2` is
    // ahead of `w1` in `sortFleet`'s result (it was interacted with more
    // recently), and the tree must still read wave 1 then wave 2. A child's
    // position is a fact about the programme, not about how busy it is.
    const sessions = [sess('coord'), sess('w2'), sess('w1')];
    const rows = nestFleet(sessions, [
      run({ id: 11, wave: 2, sessionId: 'w2', claimedBy: 'coord' }),
      run({ id: 10, wave: 1, sessionId: 'w1', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['w1', 1], ['w2', 1]]);
  });

  it('breaks a same-wave tie on run id, ascending', () => {
    const sessions = [sess('coord'), sess('later'), sess('earlier')];
    const rows = nestFleet(sessions, [
      run({ id: 21, wave: 2, sessionId: 'later', claimedBy: 'coord' }),
      run({ id: 20, wave: 2, sessionId: 'earlier', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['earlier', 1], ['later', 1]]);
  });
});

describe('nestFleet — rule 3: an orphan is never bracketed', () => {
  it('leaves a child at top level when its parent is not on this project’s list', () => {
    // The coordinator is on another project, archived, or simply not measured
    // this pass. Absence permits: no dangling `└─` pointing at nothing.
    const sessions = [sess('w1')];
    const rows = nestFleet(sessions, [run({ id: 10, sessionId: 'w1', claimedBy: 'coord-elsewhere' })]);
    expect(shape(rows)).toEqual([['w1', 0]]);
  });

  it('leaves a child at top level when the run records no owner at all', () => {
    // `claimedBy: null` is a row from a database written before the column had
    // a writer, or a hand-inserted recovery row (`shared/api.ts`'s own
    // docstring). A fabricated owner would nest a run under a coordinator that
    // never claimed it.
    const sessions = [sess('w1')];
    const rows = nestFleet(sessions, [run({ id: 10, sessionId: 'w1', claimedBy: null })]);
    expect(shape(rows)).toEqual([['w1', 0]]);
  });

  it('never nests a session under itself', () => {
    // A run whose owner and worker are the same session: bracketing it under
    // itself is a row that is its own parent, and the indent would say
    // something no programme ever means.
    const sessions = [sess('solo')];
    const rows = nestFleet(sessions, [run({ id: 10, sessionId: 'solo', claimedBy: 'solo' })]);
    expect(shape(rows)).toEqual([['solo', 0]]);
  });
});

describe('nestFleet — rule 4: one level only, and the tie-break is stated', () => {
  it('keeps a session that is BOTH a child and a parent at top level, with its own children beneath it', () => {
    // `mid` is the worker of `top`'s run and the coordinator of `leaf`'s.
    // Nesting it would either hide `leaf` or demand a second level, and the
    // operator asked for one bracket, not a tree — so the parent role wins and
    // `mid` renders at depth 0 with `leaf` beneath it.
    const sessions = [sess('top'), sess('mid'), sess('leaf')];
    const rows = nestFleet(sessions, [
      run({ id: 10, wave: 1, sessionId: 'mid', claimedBy: 'top' }),
      run({ id: 11, wave: 1, sessionId: 'leaf', claimedBy: 'mid' }),
    ]);
    expect(shape(rows)).toEqual([['top', 0], ['mid', 0], ['leaf', 1]]);
  });

  it('is the PARENT role that wins even when the parent’s own pending spawn is the only edge it owns', () => {
    // Same rule, reached through rule 5's row rather than a settled child: a
    // session with a spawn in flight beneath it is a parent, so it is never
    // itself bracketed.
    const sessions = [sess('top'), sess('mid')];
    const rows = nestFleet(sessions, [
      run({ id: 10, wave: 1, sessionId: 'mid', claimedBy: 'top' }),
      run({ id: 11, wave: 2, state: 'planned', dispatchStartedAt: 1, claimedBy: 'mid' }),
    ]);
    expect(shape(rows)).toEqual([['top', 0], ['mid', 0], ['spawn:11', 1]]);
  });
});

describe('nestFleet — rule 5: the pending child', () => {
  const pending = (over: Partial<RunSummary> = {}): RunSummary =>
    run({ state: 'planned', sessionId: null, dispatchStartedAt: 1_800_000_000_000, ...over });

  it('renders a spawn with no session yet as a child of the coordinator that asked for it', () => {
    const rows = nestFleet([sess('coord')], [pending({ id: 12 })]);
    expect(shape(rows)).toEqual([['coord', 0], ['spawn:12', 1]]);
  });

  it('puts the pending line AFTER the settled children', () => {
    // The children that exist are the programme's present tense; the one being
    // spawned is its next moment, and it reads last.
    const sessions = [sess('coord'), sess('w1')];
    const rows = nestFleet(sessions, [
      pending({ id: 12, wave: 2 }),
      run({ id: 10, wave: 1, sessionId: 'w1', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['w1', 1], ['spawn:12', 1]]);
  });

  it('disappears the moment the run reaches `dispatched`, BEFORE its session row has even arrived', () => {
    // The stamp is NEVER cleared (§Design: it is a measurement, not a mode
    // flag), so `state` is the whole of what ends this row — and the session
    // list deliberately does NOT hold `w1` here, because that is what makes
    // the state half load-bearing: the server binds the session (`setSession`)
    // and advances the run before the fleet snapshot this card renders from
    // has necessarily named it. Measured (mutation 4, first attempt): with
    // `w1` on the list, dropping the `planned` half of the condition changed
    // nothing — the row was already excluded for having a session, and the
    // test proved the other rule twice.
    const rows = nestFleet([sess('coord')], [
      run({ id: 12, state: 'dispatched', sessionId: 'w1', claimedBy: 'coord', dispatchStartedAt: 1 }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0]]);
  });

  it('still shows the settled child once that session row does arrive — two rows for one spawn is worse than none', () => {
    const sessions = [sess('coord'), sess('w1')];
    const rows = nestFleet(sessions, [
      run({ id: 12, state: 'dispatched', sessionId: 'w1', claimedBy: 'coord', dispatchStartedAt: 1 }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['w1', 1]]);
  });

  it('never renders for a planned run nobody has dispatched — the stamp is the whole signal', () => {
    // `dispatchStartedAt: null` is the ordinary state of a wave N+1 opened and
    // waiting, and it is also every wave N>=2 RESUME (which mints no workspace
    // and stamps nothing). Neither is a spawn to narrate.
    const rows = nestFleet([sess('coord')], [pending({ id: 12, dispatchStartedAt: null })]);
    expect(shape(rows)).toEqual([['coord', 0]]);
  });

  it('renders at TOP level rather than vanishing when the parent is absent', () => {
    // The operator still needs to know a spawn is happening, even when the
    // coordinator that asked for it is not on this card.
    const rows = nestFleet([sess('w1')], [pending({ id: 12, claimedBy: 'coord-elsewhere' })]);
    expect(shape(rows)).toEqual([['w1', 0], ['spawn:12', 0]]);
  });

  it('renders on a card holding no sessions at all', () => {
    // Every workspace of a project archived, and a fresh worker being spawned
    // into it: the card's body is the pending line and nothing else.
    expect(shape(nestFleet([], [pending({ id: 12 })]))).toEqual([['spawn:12', 0]]);
  });

  it('yields to the real session row when the run already has one bound', () => {
    // MEASURED WINDOW, not a hypothetical: `dispatch.ts` binds the session
    // (`coord.setSession`, :355) as soon as the registry diff names it, and
    // only advances the state much later (`coord.dispatchRun`, :473) — so a
    // hold or an advance failing in between leaves a run `planned`, stamped,
    // AND bound. The session row is the honest row; a phantom beside it would
    // be the second row rule 5 forbids.
    const sessions = [sess('coord'), sess('w1')];
    const rows = nestFleet(sessions, [pending({ id: 12, sessionId: 'w1' })]);
    expect(shape(rows)).toEqual([['coord', 0], ['w1', 1]]);
  });

  it('orders several pending spawns under one parent by wave, then run id', () => {
    const rows = nestFleet([sess('coord')], [
      pending({ id: 31, wave: 3 }),
      pending({ id: 30, wave: 2 }),
      pending({ id: 29, wave: 3 }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['spawn:30', 1], ['spawn:29', 1], ['spawn:31', 1]]);
  });
});

describe('nestFleet — the top-level order is never re-sorted', () => {
  it('removes a child from the list and re-inserts it under its parent, leaving every other row where it was', () => {
    // `sortFleet`'s result is the top-level order, verbatim. The parents keep
    // their positions relative to each other and to every unrelated row — the
    // helper only ever LIFTS a child out and puts it back one line down.
    const sessions = [sess('other'), sess('w1'), sess('coord'), sess('unrelated')];
    const rows = nestFleet(sessions, [run({ id: 10, sessionId: 'w1', claimedBy: 'coord' })]);
    expect(shape(rows)).toEqual([['other', 0], ['coord', 0], ['w1', 1], ['unrelated', 0]]);
  });
});
