// D-5828 (CCRCP-198): a run opened BEFORE a workspace's own run is never that workspace's run.
//
// The measured shape: a planned wave-3 run (#83) still names a workspace id whose workspace was archived and
// reaped long ago, and is claimed by a coordinator that was archived by hand. The id was later given to a NEW
// child of a different, live coordinator, minted by run #504 (its `.child` marker). Matching runs on the id
// string alone attributed #83 to the new child, read #83's archived claimant, and the card said "coordinator
// gone" about a worker whose coordinator is alive. Run ids only increase, so a run whose id is LOWER than the
// row's child-marker run cannot belong to this incarnation of the workspace. Neutral fixture names only.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { childRunContext, coordinationLine, coordinationOf, fleetTree, parentIdOf } from '../src/fleet/fleetTree';
import { orphanNote } from '../src/fleet/orphanWords';
import { runBelongsTo, runForSession } from '../src/fleet/runWords';
import { coordPresence } from '../src/fleet/coordWords';
import { cardFacts, headerFacts, sessionFacts } from '../src/fleet/sessionFacts';
import { ProjectCard } from '../src/fleet/ProjectCard';
import type { FleetRow } from '../src/fleet/nestFleet';

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const WORKER = 'lane-a-project-a-quiet-basin';
const OLD_COORD = 'lane-a-project-a-amber-reef';
const LIVE_COORD = 'lane-a-project-a';

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 83, program: 'drawer-fit', programTitle: 'Fit the drawer', wave: 3, waveOf: 5,
  project: 'project-a', homeProject: 'project-a', sessionId: WORKER, workspace: 'quiet-basin', branch: null,
  state: 'planned', kind: 'work', reviews: null,
  claimedBy: OLD_COORD, resumed: true, clearedAt: null,
  openedAt: NOW - 30 * 86_400_000, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

/** The new child: minted by run 504 (closed since), so its marker names 504. */
const worker = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: WORKER, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'quiet-basin',
  role: 'child', child: { kind: 'child', runId: 504 }, status: 'idle', bucket: 'idle', ...over,
});
/** The hand-archived coordinator that still claims stale run 83: measured dead and stopped. */
const oldCoord = fleetSession({
  id: OLD_COORD, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'amber-reef',
  status: 'dead', bucket: 'archived', bucketSince: NOW - 29 * 86_400_000, lifecycle: 'stopped',
  archivedAt: NOW - 29 * 86_400_000,
});
const liveCoord = fleetSession({
  id: LIVE_COORD, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: null,
  role: 'coordinator', name: 'the coordinator', status: 'busy', bucket: 'working', lifecycle: 'running',
});
const stale = run();
const fleet = (): FleetSession[] => [liveCoord, worker(), oldCoord];
const lookup = (id: string): FleetSession | null => fleet().find((s) => s.id === id) ?? null;
const depth0 = (s: FleetSession): FleetRow => ({ kind: 'session', depth: 0, session: s });

/** The session header's facts, wired exactly as `SessionScreen` wires them. */
const headerInput = (s: FleetSession, runs: readonly RunSummary[]) => {
  const pid = parentIdOf(s, runs);
  const presence = pid === null ? null : coordPresence(pid, lookup(pid), true);
  return sessionFacts({
    session: s, now: NOW, childRun: childRunContext(s, runs, lookup), coordinator: presence,
  });
};

describe('runBelongsTo / runForSession — the one rule that attributes a run to a row (D-5828)', () => {
  it('ignores a run whose id is LOWER than the row\'s child-marker run', () => {
    expect(runBelongsTo(stale, worker())).toBe(false);
    expect(runForSession([stale], worker())).toBeNull();
  });

  it('still answers the marker\'s own run (equal id) and a HIGHER-id successor bound to the same child', () => {
    const own = run({ id: 504, claimedBy: LIVE_COORD, state: 'working' });
    const successor = run({ id: 612, wave: 4, claimedBy: LIVE_COORD, state: 'dispatched' });
    expect(runBelongsTo(own, worker())).toBe(true);
    expect(runForSession([stale, own], worker())).toBe(own);
    expect(runForSession([stale, successor], worker())).toBe(successor);
  });

  it('a row with NO child marker keeps today\'s id-only answer (the known limit)', () => {
    const plain = worker({ child: { kind: 'none' }, role: null });
    expect(runForSession([stale], plain)).toBe(stale);
    expect(runForSession([stale], { id: WORKER })).toBe(stale);
    // An unreadable marker names no run either, so it cannot order one.
    expect(runForSession([stale], worker({ child: { kind: 'unreadable' } }))).toBe(stale);
  });

  it('never matches a run naming another session, whatever the ids', () => {
    expect(runBelongsTo(run({ id: 900, sessionId: 'lane-a-project-a-other' }), worker())).toBe(false);
  });
});

describe('orphanNote — no false "coordinator gone" from a stale run (D-5828)', () => {
  it('a depth-0 child minted by run 504 is not orphaned by run 83\'s archived claimant', () => {
    expect(orphanNote(depth0(worker()), [stale], 'project-a', [liveCoord, worker()], lookup, true)).toBeNull();
  });

  it('…while the same stale run DOES mark a row with no child marker (today\'s behaviour, the known limit)', () => {
    const plain = worker({ child: { kind: 'none' }, role: null });
    expect(orphanNote(depth0(plain), [stale], 'project-a', [liveCoord, plain], lookup, true)?.presence).toBe('dead');
  });

  it('a successor run claimed by a dead coordinator still marks the row — the guard hides only older runs', () => {
    const successor = run({ id: 612, wave: 4 });
    expect(orphanNote(depth0(worker()), [successor], 'project-a', [liveCoord, worker()], lookup, true)?.presence)
      .toBe('dead');
  });
});

describe('the card and the header say nothing from the stale run (D-5828, card ⊆ header D-5545)', () => {
  it('the tree neither parents nor brackets the row under run 83\'s claimant, and the header has no coordination', () => {
    expect(parentIdOf(worker(), [stale])).toBeNull();
    expect(childRunContext(worker(), [stale], lookup)).toEqual({ run: null, coordinator: null });
    expect(coordinationOf(worker(), fleet(), [stale])).toBeNull();
    const card = fleetTree(fleet(), [], [stale]).find((g) => g.project === 'project-a')!;
    // Wherever the stale claimant's own row renders, the worker is never bracketed under it.
    const rows = card.rows.map((r) => (r.kind === 'session' ? [r.session.id, r.depth] : [r.kind, r.depth]));
    expect(rows).toContainEqual([WORKER, 0]);
    expect(rows.every(([, depth]) => depth === 0)).toBe(true);
  });

  it('…nor brackets it under a stale claimant that is still a live row on the card (stopped, not archived)', () => {
    const stoppedCoord = { ...oldCoord, bucket: 'dead' as const, bucketSince: null, archivedAt: null };
    const card = fleetTree([liveCoord, worker(), stoppedCoord], [], [stale]).find((g) => g.project === 'project-a')!;
    const rows = card.rows.map((r) => (r.kind === 'session' ? [r.session.id, r.depth] : [r.kind, r.depth]));
    expect(rows).toContainEqual([WORKER, 0]);
    expect(rows.every(([, depth]) => depth === 0)).toBe(true);
  });

  it('a cross-project row, whose header line is drawn anyway, names no stale run, programme or coordinator', () => {
    const abroad = worker({ project: 'project-b', boardProject: 'project-a' });
    const c = coordinationOf(abroad, fleet(), [stale]);
    expect(c).not.toBeNull();
    expect(c!.run).toBeNull();
    expect(c!.coordinatorId).toBeNull();
    expect(coordinationLine(c!).text).not.toContain('drawer-fit');
    expect(coordinationLine(c!).text).not.toContain('#83');
  });

  it('the header\'s facts carry no programme · wave, no coordinator and no orphan marker', () => {
    const f = headerInput(worker(), [stale]);
    expect(f.orphan).toBeNull();
    expect(f.activeRun).toBeNull();
    const all = headerFacts(f).map((x) => `${x.key}:${x.text}`).join(' | ');
    expect(all).not.toContain('drawer-fit');
    expect(all).not.toContain('coordinator gone');
    const c = cardFacts(f);
    expect(c.marker).toBeNull();
    expect(c.context?.text ?? '').not.toContain('drawer-fit');
  });

  it('…and a held row keeps its raw hold text rather than run 83\'s programme and wave', () => {
    const held = worker({ held: 'program:tidy-docs wave:1/1 run:504' });
    const f = headerInput(held, [stale]);
    expect(f.heldRun).toBeNull();
    expect(cardFacts(f).context?.text ?? '').not.toContain('drawer-fit');
  });

  it('a successor run still reaches the header line (the guard is not a blanket silence)', () => {
    const successor = run({ id: 612, wave: 4, claimedBy: LIVE_COORD, state: 'dispatched' });
    const c = coordinationOf(worker(), fleet(), [stale, successor]);
    expect(c?.run?.id).toBe(612);
    expect(coordinationLine(c!).text).toContain('drawer-fit · wave 4 of 5');
  });

  it('the rendered card shows no "coordinator gone" and no stale programme on the row', () => {
    const group = fleetTree(fleet(), [], [stale]).find((g) => g.project === 'project-a')!;
    const { container } = render(
      <ProjectCard group={group} runs={group.runs} nowMs={NOW} frameSeen coordOf={lookup}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.textContent).not.toContain('coordinator gone');
    expect(container.querySelector('[data-marker^="coordinator-"]')).toBeNull();
    const row = [...container.querySelectorAll('.sess-line')].find((r) => r.textContent!.includes('quiet-basin'))!;
    expect(row.textContent).not.toContain('drawer-fit');
  });

  it('the held cell opens no run-board door for the stale run — its hold reads as the raw text it is', () => {
    const held = worker({ held: 'program:tidy-docs wave:1/1 run:504' });
    const group = fleetTree([liveCoord, held, oldCoord], [], [stale]).find((g) => g.project === 'project-a')!;
    const { container } = render(
      <ProjectCard group={group} runs={group.runs} nowMs={NOW} frameSeen coordOf={lookup}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('button.sess-held')).toBeNull();
    expect(container.querySelector('.sess-held')?.textContent ?? '').not.toContain('drawer-fit');
  });
});
