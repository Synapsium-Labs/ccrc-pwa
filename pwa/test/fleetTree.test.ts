// The fleet tree (D-5527): ONE pure model decides each row's CARD and its
// PARENT, for both skins. Neutral fixture names only (public repo).
import { describe, expect, it } from 'vitest';
import type { FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { cardsOf, coordinationLine, coordinationOf, fleetTree, workingOn } from '../src/fleet/fleetTree';
import { STATE_WORD } from '../src/fleet/sessionFacts';
import { childOfRunLabel } from '../src/fleet/runWords';

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
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
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
    r.kind === 'session' ? [r.session.id, r.depth] : [`spawn:${r.run.id}`, r.depth])] as const);

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
    const deadCoord = sess('lane-a-project-a-old-coord', { role: 'coordinator', status: 'dead', bucket: 'dead' });
    const r = [run({ id: 41, sessionId: 'lane-b-project-b-quiet-river', claimedBy: deadCoord.id })];
    const tree = shape([deadCoord, crossChild('project-a'), projectBMain], r);
    expect(tree.find(([p]) => p === 'project-a')![1]).toEqual([[deadCoord.id, 0], ['lane-b-project-b-quiet-river', 1]]);
  });

  it('ARCHIVED (in the fold, so not a live row): the child stays on the coordinator\'s card, top level', () => {
    const archived = sess('lane-a-project-a-old-coord', {
      role: 'coordinator', status: 'dead', bucket: 'archived', archivedAt: 1_800_000_000_000,
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
