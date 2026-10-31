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
import { fleetSession } from './fleetFixture';
import { nestFleet as nestFleetOf, type CardDelegation, type FleetRow } from '../src/fleet/nestFleet';
import { withRunBinding } from './runBindingFixture';
import { activity, lease, unowned } from './delegationFixture';
import { fingerprint, recording, type Recorded } from './characterise';

/** W4-U0: every `nestFleet` call this file's cases make, recorded (see `characterise.ts`). */
const nestCalls: Recorded<Parameters<typeof nestFleetOf>>[] = [];
const recordedNest = recording(nestFleetOf, nestCalls);

/** The helper as a current server feeds it (D-7182, C7d): each session carries the run binding the server sends over the
 *  case's runs (`runBindingFixture.ts`), the input `attentionFirst`'s worker reader (`workerOf`) reads. */
const nestFleet = (sessions: readonly FleetSession[], runs: readonly RunSummary[]): FleetRow[] => recordedNest(withRunBinding(sessions, runs), runs);

const sess = (id: string, over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id, project: 'ccrc-pwa', workspace: id, ...over });

/** A run in the shape the `runs` frame actually carries one. `claimedBy` is
 *  spelled at every call site rather than defaulted, because the ownership
 *  edge IS the subject of this file. */
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 1, program: 'build9b', programTitle: 'Build 9b', wave: 1, waveOf: 3,
  // Required on `RunSummary`; `null` is the honest fixture answer — a programme
  // with no stored home, which is what every row on a box that has not yet run
  // a cross-repo programme says. Wave 2's crossing-marker tests build their own
  // non-null variants by spreading this builder; they must not re-add the field
  // here.
  project: 'ccrc-pwa', homeProject: null, sessionId: null, workspace: null, branch: null,
  state: 'dispatched', kind: 'work', reviews: null,
  claimedBy: 'coord', resumed: false, clearedAt: null,
  openedAt: 1_800_000_000_000, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0,
  // F7's per-run health facts. All-clear, deliberately: every case in this file
  // predates the warn row and must keep rendering exactly as it did.
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, ...over,
});

/** `[what, depth]` per row, in display order — a session row by its id, a
 *  pending spawn by the run it is waiting on. One readable literal per
 *  assertion, so a rule that breaks says which row moved. */
const shape = (rows: readonly FleetRow[]): [string, number][] =>
  rows.map((r) => (r.kind === 'session' ? [r.session.id, r.depth] : r.kind === 'pending' ? [`spawn:${r.run.id}`, r.depth] : [r.kind, r.depth]));

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

describe("nestFleet — rule 2: children are attention-first, then in PROGRAMME order — never the list's own", () => {
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

  it('puts a sibling that is waiting on the operator FIRST, ahead of programme order', () => {
    // `later` is wave 2 and would sort after `earlier` by programme order
    // alone; it is blocked on the operator, and an indented row three deep
    // hides that just as well as a fold does (spec §6).
    const sessions = [sess('coord'), sess('earlier'), sess('later', { bucket: 'attention' })];
    const rows = nestFleet(sessions, [
      run({ id: 20, wave: 1, sessionId: 'earlier', claimedBy: 'coord' }),
      run({ id: 21, wave: 2, sessionId: 'later', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['later', 1], ['earlier', 1]]);
  });

  it('CONTROL: with no attention sibling the order is programme order exactly as before', () => {
    // The existing rule-2 cases hard-code `bucket: 'idle'` on every fixture, so
    // an attention-first key is a no-op on them and they cannot pin it. This
    // case states that premise; the case above is the pin.
    const sessions = [sess('coord'), sess('earlier'), sess('later')];
    const rows = nestFleet(sessions, [
      run({ id: 21, wave: 2, sessionId: 'later', claimedBy: 'coord' }),
      run({ id: 20, wave: 1, sessionId: 'earlier', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['coord', 0], ['earlier', 1], ['later', 1]]);
  });

  it('never lifts a waiting row above its PARENT — the key is scoped to siblings', () => {
    // Two children under `coord`, the waiting one at a LATER wave, and a
    // top-level row ahead of `coord`: the waiting child rises among its
    // siblings and no further — the top level is the caller's order, verbatim.
    const sessions = [sess('other'), sess('coord'), sess('kidLate', { bucket: 'attention' }), sess('kidEarly')];
    const rows = nestFleet(sessions, [
      run({ id: 20, wave: 1, sessionId: 'kidEarly', claimedBy: 'coord' }),
      run({ id: 21, wave: 2, sessionId: 'kidLate', claimedBy: 'coord' }),
    ]);
    expect(shape(rows)).toEqual([['other', 0], ['coord', 0], ['kidLate', 1], ['kidEarly', 1]]);
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

// Delegation broker wave 4, PR2 Task 2.4: rules 6-11. Every case calls the UNRECORDED `nestFleetOf`, so W4-U0's
// fingerprints above stay exactly what main produced. `nestD` also asserts one level on every case (W4-U13).
describe('nestFleet — delegation rows (rules 6 to 11, delegation broker wave 4)', () => {
  const nestD = (sessions: FleetSession[], runs: RunSummary[], d: CardDelegation | null): FleetRow[] => {
    const rows = nestFleetOf(sessions, runs, d);
    expect(rows.filter((r) => r.depth > 1), 'nothing is ever drawn at depth 2').toEqual([]);
    return rows;
  };
  const slice = (over: Partial<CardDelegation> = {}): CardDelegation =>
    ({ card: 'ccrc-pwa', activities: [], leases: [], unowned: [], ...over });
  const dshape = (rows: readonly FleetRow[]): [string, number][] => rows.map((r) => {
    switch (r.kind) {
      case 'session': return [r.session.id, r.depth];
      case 'pending': return [`spawn:${r.run.id}`, r.depth];
      case 'activity': return [`activity:${r.activity.activityId}`, r.depth];
      case 'lease': return [`lease:${r.lease.leaseId}`, r.depth];
      case 'unowned': return [`unowned:${r.item.adminRecord}`, r.depth];
      case 'delegation-group': return [`group:${r.group}(${r.count})`, r.depth];
    }
  });
  const leaseRow = (rows: readonly FleetRow[], id: string) => {
    const r = rows.find((x) => x.kind === 'lease' && x.lease.leaseId === id);
    if (r === undefined || r.kind !== 'lease') throw new Error(`no lease row ${id}`);
    return r;
  };
  const sessionRow = (rows: readonly FleetRow[], id: string) => {
    const r = rows.find((x) => x.kind === 'session' && x.session.id === id);
    if (r === undefined || r.kind !== 'session') throw new Error(`no session row ${id}`);
    return r;
  };
  const coord = sess('coord-a', { workdir: '/work/project-a' });
  const worker = sess('worker-a', { workdir: '/work/project-a/.ccd/worker-a' });
  const programme = [run({ id: 7, claimedBy: 'coord-a', sessionId: 'worker-a' })];

  it('W4-U12 (rule 8, depth 0): a coordinator\'s live activity and raw worktree nest one level under it, after its worker', () => {
    const rows = nestD([coord, worker], programme,
      slice({ activities: [activity()], leases: [lease({ sourceKind: 'raw' })] }));
    expect(dshape(rows)).toEqual([['coord-a', 0], ['worker-a', 1], ['activity:act-1', 1], ['lease:lease-1', 1]]);
    expect(leaseRow(rows, 'lease-1').via).toBeNull();
    expect(leaseRow(rows, 'lease-1').group).toBeNull();
  });

  it('W4-U13 (rule 8, one level): a worker\'s activity is its chip, never a row; a worker\'s worktree sits under the coordinator, via the worker', () => {
    const chip = activity({ activityId: 'a-chip', parentId: 'worker-a', placement: 'chip' });
    const skewAct = activity({ activityId: 'a-skew', parentId: 'worker-a', placement: 'row' });
    const viaLease = lease({ leaseId: 'l-via', parentId: 'coord-a', via: 'worker-a' });
    const skewLease = lease({ leaseId: 'l-skew', parentId: 'worker-a', via: null, firstObservedAt: '2026-10-26T11:00:00.000Z' });
    const rows = nestD([coord, worker], programme, slice({ activities: [chip, skewAct], leases: [viaLease, skewLease] }));
    expect(dshape(rows)).toEqual([['coord-a', 0], ['worker-a', 1], ['lease:l-via', 1], ['lease:l-skew', 1]]);
    expect(sessionRow(rows, 'worker-a').delegated?.map((a) => a.activityId)).toEqual(['a-chip', 'a-skew']);
    expect(sessionRow(rows, 'coord-a').delegated).toBeUndefined();
    expect(leaseRow(rows, 'l-via').via).toBe('worker-a');
    expect(leaseRow(rows, 'l-skew').via).toBe('worker-a');
  });

  it('W4-U14 (rule 7, programme wins): a worktree whose path is a listed session\'s workdir is not drawn', () => {
    const rows = nestD([coord, worker], programme,
      slice({ leases: [lease({ leaseId: 'l-ws', parentId: 'coord-a', via: 'worker-a', canonicalPath: worker.workdir })] }));
    expect(dshape(rows)).toEqual([['coord-a', 0], ['worker-a', 1]]);
  });

  it('W4-U15 (rule 7, never lifts): a programme child that owns a worktree stays a child; its worktree is the via row', () => {
    const rows = nestD([coord, worker], programme, slice({ leases: [lease({ leaseId: 'l-w', parentId: 'worker-a' })] }));
    expect(dshape(rows)).toEqual([['coord-a', 0], ['worker-a', 1], ['lease:l-w', 1]]);
    expect(leaseRow(rows, 'l-w').via).toBe('worker-a');
    // The same list without the slice brackets identically: the worktree moved no session row.
    expect(dshape(nestD([coord, worker], programme, null)).slice(0, 2)).toEqual(dshape(rows).slice(0, 2));
  });

  it('W4-U16 (rule 9): a missing parent\'s worktree and an offline activity file under one "offline coordinator" group', () => {
    const rows = nestD([coord, worker], programme, slice({
      leases: [lease({ leaseId: 'l-gone', parentId: 'coord-gone' })],
      activities: [activity({ activityId: 'a-off', group: 'offline-coordinator' })],
    }));
    expect(dshape(rows)).toEqual([
      ['coord-a', 0], ['worker-a', 1], ['group:offline-coordinator(2)', 0], ['lease:l-gone', 1], ['activity:a-off', 1],
    ]);
    expect(leaseRow(rows, 'l-gone').group).toBe('offline-coordinator');
  });

  it('W4-U17 (rule 10): unowned work is one group, after the offline group', () => {
    const rows = nestD([coord], [], slice({
      leases: [lease({ leaseId: 'l-gone', parentId: 'coord-gone' })],
      unowned: [unowned({ adminRecord: 'u1' }), unowned({ adminRecord: 'u2' }), unowned({ adminRecord: 'u3' })],
    }));
    expect(dshape(rows)).toEqual([
      ['coord-a', 0], ['group:offline-coordinator(1)', 0], ['lease:l-gone', 1],
      ['group:unowned(3)', 0], ['unowned:u1', 1], ['unowned:u2', 1], ['unowned:u3', 1],
    ]);
  });

  it('W4-U18 (rule 11): a worktree nests with no run and with an ended, unmeasured state', () => {
    const rows = nestD([coord, worker], [], slice({
      activities: [activity()],
      leases: [lease({ sourceKind: 'raw', liveness: 'ended', workspace: 'unmeasured' })],
    }));
    expect(dshape(rows)).toEqual([['coord-a', 0], ['activity:act-1', 1], ['lease:lease-1', 1], ['worker-a', 0]]);
  });
});

describe('W4-U0: today\'s tree, characterised before delegation rows (delegation broker wave 4)', () => {
  it('every fixture set above renders the JSON captured on main', () => {
    expect(nestCalls.length).toBeGreaterThan(0);
    expect(nestCalls.map((c) => fingerprint(c.json))).toMatchInlineSnapshot(`
      [
        "2492c2b4b77a7ee7",
        "a9231053bdbc6e13",
        "dfa57c739b9f6cc5",
        "dfa57c739b9f6cc5",
        "f34850989ace2fc6",
        "095bb5fe90ea5ec8",
        "f34850989ace2fc6",
        "12dc89e1b0295014",
        "e1db894e885cfe7a",
        "8bd0f387f5fb85c5",
        "fabf0d289d58b4b1",
        "83a654fd3ee945b7",
        "197ca2884d173eed",
        "97488a0242312060",
        "6b23aab7b74e939d",
        "b92c138a6ed3f43d",
        "7280f8ee2e17279e",
        "b92c138a6ed3f43d",
        "ec693fd9544332fb",
        "d2291ee3d9e4430e",
        "ef53fc580bda7912",
        "9d2f0f33dfdf4a7a",
        "eb5aa6b06403a7f7",
      ]
    `);
  });

  it('W4-U11 (rule 6): every input above with no slice, or an empty one, renders the identical JSON', () => {
    expect(nestCalls.length).toBeGreaterThan(0);
    for (const c of nestCalls) {
      const [sessions, runs] = c.args;
      expect(JSON.stringify(nestFleetOf(sessions, runs, null))).toBe(c.json);
      expect(JSON.stringify(nestFleetOf(sessions, runs, { card: 'ccrc-pwa', activities: [], leases: [], unowned: [] }))).toBe(c.json);
    }
  });
});
