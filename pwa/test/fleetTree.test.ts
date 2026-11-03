// The fleet tree (D-5527): ONE pure model decides each row's CARD and its
// PARENT, for both skins. Neutral fixture names only (public repo).
import { describe, expect, it } from 'vitest';
import type { DelegationProjectionWire, FleetSession, RunSummary } from '../../shared/api';
import { fleetSession, DEAD_LIFECYCLE } from './fleetFixture';
import { cardsOf, coordinationLine, coordinationOf as coordinationOfTree, fleetTree as fleetTreeOf, unplacedActivities, workingOn } from '../src/fleet/fleetTree';
import { withRunBinding } from './runBindingFixture';
import { fingerprint, recording, type Recorded } from './characterise';
import { STATE_WORD } from '../src/fleet/sessionFacts';
import { childOfRunLabel } from '../src/fleet/runWords';
import { TOOL_USE_ID, activity, frame, lease, unowned } from './delegationFixture';
import { creatorChip, inferredChip } from '../src/fleet/delegationWords';

/** W4-U0: every `fleetTree` call this file's cases make, recorded (see `characterise.ts`). */
const treeCalls: Recorded<Parameters<typeof fleetTreeOf>>[] = [];
const recordedTree = recording(fleetTreeOf, treeCalls);

// The tree and the header as a current server feeds them (D-7182, C7d): each session carries the run binding the server
// sends over the runs the case hands them (`runBindingFixture.ts`). Every assertion below reads the real model.
const fleetTree = (sessions: FleetSession[], projects: readonly string[], rs: readonly RunSummary[]): ReturnType<typeof fleetTreeOf> =>
  recordedTree(withRunBinding(sessions, rs), projects, rs);
const coordinationOf = (s: FleetSession, sessions: readonly FleetSession[], rs: readonly RunSummary[]): ReturnType<typeof coordinationOfTree> =>
  coordinationOfTree(withRunBinding([s], rs)[0]!, withRunBinding(sessions, rs), rs);

const COORD = 'lane-a-project-a';

const sess = (id: string, over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id, project: 'project-a', workspace: id, ...over });

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 41, program: 'port-api', programTitle: 'Port the API', wave: 5, waveOf: 7,
  project: 'project-b', homeProject: 'project-b', sessionId: null, workspace: null, branch: null,
  state: 'dispatched', kind: 'work', reviews: null,
  claimedBy: COORD, resumed: false, clearedAt: null,
  openedAt: 1_800_000_000_000, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, ...over,
});

const coordinator = sess(COORD, { workspace: null, role: 'coordinator', name: 'the coordinator' });
/** A workspace of project-b that a coordinator of project-a dispatched. `boardProject` is what the server's
 *  placement answers for it: the coordinator's project (stamped), or `null` (an older server, a failed read). */
const crossChild = (boardProject: string | null, over: Partial<FleetSession> = {}): FleetSession =>
  sess('lane-b-project-b-quiet-river', {
    project: 'project-b', workspace: 'quiet-river', role: 'child',
    child: { kind: 'child', runId: 39 }, held: 'program:port-api wave:5/7 run:41', boardProject, ...over,
  });
const sameChild = sess('lane-a-project-a-still-pond', { role: 'child', child: { kind: 'child', runId: 40 } });
const projectBMain = sess('lane-b-project-b', { project: 'project-b', workspace: null });

const runs = [
  run({ id: 40, program: 'tidy-docs', wave: 1, waveOf: 2, project: 'project-a', homeProject: 'project-a',
        sessionId: sameChild.id }),
  run({ id: 41, sessionId: 'lane-b-project-b-quiet-river', resumed: true }),
];

/** `[card, [[id, depth], …]]` per card, in display order. */
const shape = (sessions: FleetSession[], rs: RunSummary[] = runs) =>
  fleetTree(sessions, [], rs).map((g) => [g.project, g.rows.map((r) =>
    r.kind === 'session' ? [r.session.id, r.depth] : r.kind === 'pending' ? [`spawn:${r.run.id}`, r.depth] : [r.kind, r.depth])] as const);

describe('fleetTree — a coordinator\'s workspaces nest under it across projects (D-5527)', () => {
  it('a cross-project child nests under its coordinator, on the coordinator\'s card, when the server placed it there', () => {
    const tree = shape([coordinator, sameChild, crossChild('project-a'), projectBMain]);
    // Children in programme order (nestFleet's rule 2): wave 1 of tidy-docs before wave 5 of port-api.
    expect(tree.find(([p]) => p === 'project-a')![1]).toEqual([
      [COORD, 0], ['lane-a-project-a-still-pond', 1], ['lane-b-project-b-quiet-river', 1],
    ]);
    expect(tree.find(([p]) => p === 'project-b')![1]).toEqual([['lane-b-project-b', 0]]);
  });

  it('…and when the server did NOT place it (boardProject null: an older server or a failed read), the row stays home, unbracketed and unmarked', () => {
    // Rule 2: the client never overrides the server's placement. On its own
    // project's card the child needs no indicator, and the card's orphan marker
    // (orphanWords.ts) is what names the coordinator elsewhere.
    const tree = shape([coordinator, crossChild(null), projectBMain]);
    expect(tree.find(([p]) => p === 'project-a')![1]).toEqual([[COORD, 0]]);
    expect(tree.find(([p]) => p === 'project-b')![1]).toEqual([['lane-b-project-b', 0], ['lane-b-project-b-quiet-river', 0]]);
    expect(workingOn(crossChild(null), cardsOf([crossChild(null)]))).toBeNull();
  });

  it('a same-project child nests exactly as nestFleet nests it today', () => {
    expect(shape([coordinator, sameChild])).toEqual([
      ['project-a', [[COORD, 0], ['lane-a-project-a-still-pond', 1]]],
    ]);
  });

  it('the child\'s own project card keeps saying where its workspace went', () => {
    const b = fleetTree([coordinator, crossChild('project-a'), projectBMain], [], runs).find((g) => g.project === 'project-b')!;
    expect(b.elsewhere).toEqual([{ project: 'project-a', count: 1 }]);
  });

  it('a card\'s runs are the runs whose worker renders on it — the bracket and the run reach the same card', () => {
    const tree = fleetTree([coordinator, crossChild('project-a'), projectBMain], [], runs);
    expect(tree.find((g) => g.project === 'project-a')!.runs.map((r) => r.id)).toEqual([40, 41]);
    expect(tree.find((g) => g.project === 'project-b')!.runs).toEqual([]);
  });

  it('a pending spawn of a cross-project wave reads under its coordinator, on the coordinator\'s card', () => {
    const spawn = run({ id: 43, state: 'planned', dispatchStartedAt: 1_800_000_000_500, sessionId: null });
    const tree = shape([coordinator, projectBMain], [spawn]);
    expect(tree.find(([p]) => p === 'project-a')![1]).toEqual([[COORD, 0], ['spawn:43', 1]]);
  });
});

describe('fleetTree — a child whose coordinator is missing, stopped or archived (acceptance 4)', () => {
  it('MISSING (not on the fleet): stays on the card the server placed it on — the coordinator\'s project — at top level', () => {
    const orphanRuns = [run({ id: 41, sessionId: 'lane-b-project-b-quiet-river', claimedBy: 'lane-c-gone' })];
    const tree = shape([crossChild('project-a'), projectBMain], orphanRuns);
    expect(tree.find(([p]) => p === 'project-a')![1]).toEqual([['lane-b-project-b-quiet-river', 0]]);
  });

  it('MISSING and unplaced (boardProject null): falls back to its own project\'s card, top level — never nowhere', () => {
    const orphanRuns = [run({ id: 41, sessionId: 'lane-b-project-b-quiet-river', claimedBy: 'lane-c-gone' })];
    const tree = shape([crossChild(null), projectBMain], orphanRuns);
    expect(tree.find(([p]) => p === 'project-b')![1]).toEqual([['lane-b-project-b', 0], ['lane-b-project-b-quiet-river', 0]]);
  });

  it('STOPPED (a dead workspace coordinator is still a live-list row): the child stays nested under it', () => {
    const deadCoord = sess('lane-a-project-a-old-coord', { role: 'coordinator', status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'dead' });
    const r = [run({ id: 41, sessionId: 'lane-b-project-b-quiet-river', claimedBy: deadCoord.id })];
    const tree = shape([deadCoord, crossChild('project-a'), projectBMain], r);
    expect(tree.find(([p]) => p === 'project-a')![1]).toEqual([[deadCoord.id, 0], ['lane-b-project-b-quiet-river', 1]]);
  });

  it('ARCHIVED (in the fold, so not a live row): the child stays on the coordinator\'s card, top level', () => {
    const archived = sess('lane-a-project-a-old-coord', {
      role: 'coordinator', status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'archived', archivedAt: 1_800_000_000_000,
    });
    const r = [run({ id: 41, sessionId: 'lane-b-project-b-quiet-river', claimedBy: archived.id })];
    const g = fleetTree([archived, crossChild('project-a'), projectBMain], [], r).find((x) => x.project === 'project-a')!;
    expect(g.rows.map((x) => x.kind === 'session' ? [x.session.id, x.depth] : null)).toEqual([['lane-b-project-b-quiet-river', 0]]);
    expect(g.archived.map((s) => s.id)).toEqual([archived.id]);
  });
});

describe('the indicator — whose code a row works on (acceptance 2)', () => {
  it('names the row\'s own project when it differs from the card it renders on', () => {
    const all = [coordinator, crossChild('project-a'), sameChild, projectBMain];
    const cards = cardsOf(all);
    expect(workingOn(crossChild('project-a'), cards)).toBe('project-b');
    expect(workingOn(sameChild, cards)).toBeNull();
    expect(workingOn(coordinator, cards)).toBeNull();
    expect(workingOn(projectBMain, cards)).toBeNull();
  });

  it('an orphan keeps its indicator wherever it lands', () => {
    const orphan = [run({ id: 41, sessionId: 'lane-b-project-b-quiet-river', claimedBy: 'lane-c-gone' })];
    const child = crossChild('project-a');
    expect(orphan[0]!.claimedBy).toBe('lane-c-gone');
    expect(workingOn(child, cardsOf([child]))).toBe('project-b');
  });

  it('a row on its own project\'s card says nothing, so a fleet with no programme reads as it does today', () => {
    const child = crossChild(null);
    expect(workingOn(child, cardsOf([child]))).toBeNull();
  });
});

describe('coordinationOf — the session header\'s facts', () => {
  it('a cross-project child: working on its project, coordinated from its coordinator, with the run that says so', () => {
    const c = coordinationOf(crossChild('project-a'), [coordinator, crossChild('project-a')], runs);
    expect(c).toEqual({ workingOn: 'project-b', coordinator: 'the coordinator', card: 'project-a', run: runs[1],
      // D-5545: the header links to the coordinator and says its state in the row's own words.
      coordinatorId: COORD, coordinatorState: STATE_WORD[coordinator.bucket] });
    expect(coordinationLine(c!).text)
      .toBe('working on project-b · coordinated from the coordinator · port-api · wave 5 of 7 · run #41');
  });

  it('a same-project child carries its run and its coordinator, and no working-on', () => {
    expect(coordinationOf(sameChild, [coordinator, sameChild], runs))
      .toEqual({ workingOn: null, coordinator: 'the coordinator', card: 'project-a', run: runs[0],
        coordinatorId: COORD, coordinatorState: STATE_WORD[coordinator.bucket] });
    expect(coordinationLine(coordinationOf(sameChild, [coordinator, sameChild], runs)!).text)
      .toBe('coordinated from the coordinator · tidy-docs · wave 1 of 2 · run #40');
  });

  it('a coordinator the fleet does not carry is named by the project it sits in, never guessed', () => {
    const r = [run({ id: 41, sessionId: 'lane-b-project-b-quiet-river', claimedBy: 'lane-c-gone' })];
    const c = coordinationOf(crossChild('project-a'), [crossChild('project-a')], r)!;
    expect(c).toEqual({ workingOn: 'project-b', coordinator: null, card: 'project-a', run: r[0],
      coordinatorId: null, coordinatorState: null });
    expect(coordinationLine(c).text).toBe('working on project-b · coordinated from project-a · port-api · wave 5 of 7 · run #41');
  });

  it('a session no run names and no card displaces has nothing to say', () => {
    expect(coordinationOf(coordinator, [coordinator], runs)).toBeNull();
  });
});

describe('the run label — programme and wave, never a bare run number (operator ruling 2026-10-18)', () => {
  const child = crossChild('project-a');
  it('a work run reads "<programme> · wave N of M"', () => {
    const l = childOfRunLabel(child, { run: runs[1]!, coordinator: 'the coordinator' })!;
    expect(l.text).toBe('port-api · wave 5 of 7');
    expect(l.text).not.toMatch(/#\d/);
    expect(l.title).toBe('this workspace does one wave of Port the API for the coordinator; it is stopped or reclaimed when the wave is done');
  });

  it('a review run reads "<programme> · review of wave N"', () => {
    const review = run({ id: 42, kind: 'review', reviews: 41, sessionId: child.id });
    expect(childOfRunLabel(child, { run: review, coordinator: 'the coordinator' })!.text).toBe('port-api · review of wave 5');
  });

  it('a wave with no stated total reads "wave N"', () => {
    expect(childOfRunLabel(child, { run: run({ waveOf: null }), coordinator: null })!.text).toBe('port-api · wave 5');
  });

  it('names the CURRENT run of a resumed workspace, not the run that minted it', () => {
    // quiet-river was minted by run 39 (wave 4) and resumed by run 41 (wave 5).
    expect(childOfRunLabel(child, { run: runs[1]!, coordinator: null })!.text).toBe('port-api · wave 5 of 7');
  });

  it('a child no open run names says so in words; the run number is the title\'s, not the row\'s', () => {
    const l = childOfRunLabel(child, { run: null, coordinator: null })!;
    expect(l.text).toBe('run not on the board');
    expect(l.data).toBe('child');
    expect(l.title).toContain('run #39');
  });

  it('an unreadable marker still says so, and a non-child still says nothing', () => {
    expect(childOfRunLabel({ child: { kind: 'unreadable' } })!.text).toBe('child marker unreadable');
    expect(childOfRunLabel({ child: { kind: 'none' } })).toBeNull();
    expect(childOfRunLabel({})).toBeNull();
  });
});

describe('one parent rule for the bracket, the label and the header (D-5527 rule 1)', () => {
  it('a worker two active runs name, from different claimants, nests under the claimant of the LATEST run — the one its label names', () => {
    const c2 = sess('lane-a-project-a-second', { workspace: null, role: 'coordinator', name: 'the second' });
    const w = sess('lane-a-project-a-worker', { role: 'child', child: { kind: 'child', runId: 50 } });
    const rs = [
      run({ id: 50, wave: 4, project: 'project-a', homeProject: 'project-a', sessionId: w.id, claimedBy: c2.id }),
      run({ id: 51, wave: 5, project: 'project-a', homeProject: 'project-a', sessionId: w.id, claimedBy: COORD }),
    ];
    const tree = shape([coordinator, c2, w], rs);
    expect(tree.find(([p]) => p === 'project-a')![1]).toEqual([[COORD, 0], [w.id, 1], [c2.id, 0]]);
    expect(coordinationOf(w, [coordinator, c2, w], rs)!.coordinator).toBe('the coordinator');
  });

  it('a run a session claims for itself names no coordinator and no parent', () => {
    const w = sess('lane-a-project-a-solo', { role: 'child', child: { kind: 'child', runId: 60 } });
    const rs = [run({ id: 60, project: 'project-a', homeProject: 'project-a', sessionId: w.id, claimedBy: w.id })];
    const c = coordinationOf(w, [w], rs)!;
    expect(c.coordinator).toBeNull();
    expect(coordinationLine(c).text).not.toContain('coordinated from');
    expect(shape([w], rs)).toEqual([['project-a', [[w.id, 0]]]]);
  });

  it('KNOWN LIMIT: a cross-project coordinator that is itself a child keeps its own children on the card the server placed them on', () => {
    // top (project-a) coordinates mid (project-b, placed on project-a); mid
    // coordinates leaf (project-c, placed on project-b — the stamp names the
    // claimant's OWN project, D-5523). Rule 2 never overrides placement, so leaf
    // stays top level on project-b; nestFleet's one level keeps mid a child.
    const mid = sess('lane-b-project-b-mid', { project: 'project-b', role: 'coordinator', boardProject: 'project-a' });
    const leaf = sess('lane-c-project-c-leaf', { project: 'project-c', role: 'child', boardProject: 'project-b' });
    const rs = [
      run({ id: 70, project: 'project-b', homeProject: 'project-b', sessionId: mid.id, claimedBy: COORD }),
      run({ id: 71, project: 'project-c', homeProject: 'project-c', sessionId: leaf.id, claimedBy: mid.id }),
    ];
    const tree = shape([coordinator, mid, leaf], rs);
    expect(tree.find(([p]) => p === 'project-a')![1]).toEqual([[COORD, 0], [mid.id, 1]]);
    expect(tree.find(([p]) => p === 'project-b')![1]).toEqual([[leaf.id, 0]]);
  });
});

describe('the header title for a review run', () => {
  it('says the workspace REVIEWS one wave, like the row', () => {
    const review = run({ id: 42, kind: 'review', reviews: 41, sessionId: 'lane-b-project-b-quiet-river' });
    const c = coordinationOf(crossChild('project-a'), [coordinator, crossChild('project-a')], [review])!;
    expect(coordinationLine(c).title).toMatch(/^this workspace reviews one wave of Port the API/);
  });
});

// Delegation broker wave 4, PR2 Task 2.5: each delegation row on ONE card. Every case calls the UNRECORDED
// `fleetTreeOf`, so W4-U0's fingerprints below stay exactly what main produced.
describe('fleetTree — delegation rows land on their parent\'s card (delegation broker wave 4)', () => {
  const coordA = fleetSession({ id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a' });
  const mainB = fleetSession({ id: 'main-b', project: 'project-b', workspace: null, workdir: '/work/project-b' });
  /** `[card, [row ids]]`, in group order. */
  const ids = (groups: ReturnType<typeof fleetTreeOf>) => groups.map((g) => [g.project, g.rows.map((r) =>
    r.kind === 'session' ? r.session.id : r.kind === 'lease' ? `lease:${r.lease.leaseId}` : r.kind === 'activity'
      ? `activity:${r.activity.activityId}` : r.kind === 'unowned' ? `unowned:${r.item.adminRecord}`
        : r.kind === 'delegation-group' ? `group:${r.group}` : r.kind)] as const);
  const count = (groups: ReturnType<typeof fleetTreeOf>, pred: (r: (typeof groups)[number]['rows'][number]) => boolean) =>
    groups.reduce((n, g) => n + g.rows.filter(pred).length, 0);

  it('W4-U20: a worktree in project-b whose parent lives in project-a lands on project-a\'s card, nested', () => {
    const w = frame({ leases: [lease({ leaseId: 'l-b', project: 'project-b', parentId: 'coord-a',
      canonicalPath: '/work/project-b/.claude/worktrees/agent-b1' })] });
    const tree = ids(fleetTreeOf([coordA, mainB], [], [], {}, w));
    expect(tree).toEqual([['project-a', ['coord-a', 'lease:l-b']], ['project-b', ['main-b']]]);
  });

  it('W4-U21: an unowned tree of a project nothing else names creates that project\'s card, holding only the group', () => {
    const w = frame({ unowned: [unowned({ project: 'project-c', adminRecord: 'u-c' })] });
    const tree = ids(fleetTreeOf([coordA], [], [], {}, w));
    expect(tree).toEqual([['project-a', ['coord-a']], ['project-c', ['group:unowned', 'unowned:u-c']]]);
  });

  it('W4-U22: one worktree is drawn on exactly one card', () => {
    const w = frame({ leases: [
      lease({ leaseId: 'l-b', project: 'project-b', parentId: 'coord-a' }),
      lease({ leaseId: 'l-gone', project: 'project-b', parentId: 'coord-gone' }),
      lease({ leaseId: 'l-a', project: 'project-a', parentId: 'main-b' }),
    ] });
    const groups = fleetTreeOf([coordA, mainB], ['project-a', 'project-b'], [], {}, w);
    for (const id of ['l-b', 'l-gone', 'l-a']) {
      expect(count(groups, (r) => r.kind === 'lease' && r.lease.leaseId === id), id).toBe(1);
    }
    // A parent the fleet does not carry: the worktree renders on its own project, in the offline group.
    expect(ids(groups).find(([p]) => p === 'project-b')![1]).toEqual(['main-b', 'lease:l-a', 'group:offline-coordinator', 'lease:l-gone']);
  });

  it('W4-U36: an activity whose parent the fleet does not carry is on no card (the wire gives it no project)', () => {
    const w = frame({ activities: [activity({ activityId: 'a-gone', parentId: 'coord-gone' })] });
    const groups = fleetTreeOf([coordA, mainB], [], [], {}, w);
    expect(count(groups, (r) => r.kind === 'activity')).toBe(0);
    expect(unplacedActivities([coordA, mainB], w)).toBe(1);
    expect(unplacedActivities([coordA, mainB], null)).toBe(0);
    expect(unplacedActivities([coordA], frame({ activities: [activity({ parentId: 'coord-a' })] }))).toBe(0);
  });

  // Review 1029's F2: the reader at the tree's own seam. The members arrive as the socket parses them, objects with
  // words this build has never heard of and a field it does not know, never normalized before `fleetTree`.
  it('W4-U7b: the tree reads the frame through readDelegation: future words re-filed, every member kept, none running', () => {
    const future = {
      asOf: '2026-10-26T10:10:00.000Z',
      activities: [
        { ...activity({ activityId: 'a-group' }), group: 'future-group', futureField: 1 },
        { ...activity({ activityId: 'a-words' }), placement: 'future-placement', liveness: 'future-liveness' },
      ],
      leases: [
        { ...lease({ leaseId: 'l-raw', sourceKind: 'raw' }), group: 'future-group', liveness: 'future-liveness', workspace: 'future-workspace' },
        { ...lease({ leaseId: 'l-agent', adminRecord: 'agent-a2', canonicalPath: '/work/project-a/.claude/worktrees/agent-a2' }),
          workspace: 'future-workspace' },
      ],
      unowned: [{ ...unowned({ adminRecord: 'u-future' }), workspace: 'future-workspace' }],
    } as unknown as DelegationProjectionWire;
    const groups = fleetTreeOf([coordA, mainB], [], [], {}, future);
    expect(ids(groups)).toEqual([
      ['project-a', ['coord-a', 'activity:a-words', 'lease:l-agent',
        'group:offline-coordinator', 'lease:l-raw', 'activity:a-group', 'group:unowned', 'unowned:u-future']],
      ['project-b', ['main-b']],
    ]);
    const rows = groups.flatMap((g) => g.rows);
    expect(rows.flatMap((r) => (r.kind === 'delegation-group' ? [[r.group, r.count]] : []))).toEqual([['offline-coordinator', 2], ['unowned', 1]]);
    const acts = new Map(rows.flatMap((r) => (r.kind === 'activity' ? [[r.activity.activityId, r.activity] as const] : [])));
    const trees = new Map(rows.flatMap((r) => (r.kind === 'lease' ? [[r.lease.leaseId, r.lease] as const] : [])));
    const items = rows.flatMap((r) => (r.kind === 'unowned' ? [r.item] : []));
    expect([acts.size, trees.size, items.length], 'every member is kept, once').toEqual([2, 2, 1]);
    expect(acts.get('a-group')).toMatchObject({ group: 'offline-coordinator', liveness: 'live', futureField: 1 });
    expect(acts.get('a-words')).toMatchObject({ group: 'parent', placement: 'row', liveness: 'unmeasured' });
    expect(trees.get('l-raw')).toMatchObject({ group: 'offline-coordinator', liveness: 'unmeasured', workspace: 'unmeasured' });
    expect(trees.get('l-agent')).toMatchObject({ group: 'parent', liveness: 'live', workspace: 'unmeasured' });
    expect(items).toMatchObject([{ adminRecord: 'u-future', workspace: 'unmeasured' }]);
    // Only what the server measured live reads live: no future word becomes "running".
    const live = [...acts.values(), ...trees.values()].filter((m) => m.liveness === 'live');
    expect(live.map((m) => ('activityId' in m ? m.activityId : m.leaseId))).toEqual(['a-group', 'l-agent']);
    // The raw tree keeps both of its chips, whatever its other words; the agent one wears neither.
    const raw = trees.get('l-raw')!;
    expect(inferredChip(raw)?.text).toBe('inferred');
    expect(creatorChip(raw)?.title).toContain(TOOL_USE_ID);
    expect(inferredChip(trees.get('l-agent')!)).toBeNull();
  });
});

describe('W4-U0: today\'s tree, characterised before delegation rows (delegation broker wave 4)', () => {
  it('every fixture set above renders the JSON captured on main', () => {
    expect(treeCalls.length).toBeGreaterThan(0);
    expect(treeCalls.map((c) => fingerprint(c.json))).toMatchInlineSnapshot(`
      [
        "7238fc1ccb39cd91",
        "2dcc8e7db34b6972",
        "c2b1c4fbc383efa3",
        "afec98f7add32b4a",
        "afec98f7add32b4a",
        "7abe92f21eb047dc",
        "3b0c6bc57e68b73e",
        "495e11812fac1dfd",
        "5c64241582b713b0",
        "1fecb6a5645e7e8e",
        "ae77e22eac7c913b",
        "10e24e1975059fe1",
        "a3d43382df21dd42",
      ]
    `);
  });

  it('W4-U19 (rule 6): every input above with no frame renders the identical JSON', () => {
    expect(treeCalls.length).toBeGreaterThan(0);
    for (const c of treeCalls) {
      const [sessions, projects, runs, acks] = c.args;
      expect(JSON.stringify(fleetTreeOf(sessions, projects, runs, acks, null))).toBe(c.json);
    }
  });
});
