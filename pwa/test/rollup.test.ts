// The fleet rollup's decider (D-6088), skin-independent: what a fleet list rolls up, from the fleet tree, the clock,
// the open session and the per-device preferences. Both skins' lists render its answer
// (`fleet-rollup-render.test.tsx` pins that), so a restyle that drops a rule goes red here AND there.
import { describe, expect, it } from 'vitest';
import type { FleetSession, RunSummary } from '../../shared/api';
import { fleetTree } from '../src/fleet/fleetTree';
import {
  NO_ROLLUP_PREFS, operatorAsk, prunePrefs, rollupFleet, toggleChildren, toggleProject,
  type CardRollup, type RolledRow, type RollupPrefs,
} from '../src/fleet/rollup';
import {
  HOUR, MIN, NOW, answeredByCoordinator, asking, coordinatorFleet, heldByCoordinator, run, sess,
} from './rollupFixture';

const roll = (
  sessions: FleetSession[], runs: RunSummary[] = [], prefs: RollupPrefs = NO_ROLLUP_PREFS,
  now = NOW, selectedId: string | null = null,
): ReadonlyMap<string, CardRollup> => rollupFleet(fleetTree(sessions, [], runs), prefs, now, selectedId).cards;

const card = (cards: ReadonlyMap<string, CardRollup>, project: string): CardRollup => {
  const c = cards.get(project);
  if (c === undefined) throw new Error(`no card ${project}`);
  return c;
};

/** `[what, depth]` per row: a session by id, a spawn by run, the summary line by its text. */
const shape = (rows: readonly RolledRow[]): [string, number][] => rows.map((r) =>
  r.kind === 'session' ? [r.session.id, r.depth] : r.kind === 'pending' ? [`spawn:${r.run.id}`, r.depth] : [`» ${r.text}`, r.depth]);

describe('rollup — projects (rule 2)', () => {
  it('rolls up an inactive project: nothing working, nobody waiting, no change in 30 minutes', () => {
    const c = card(roll([sess('a1', 'project-a'), sess('a2', 'project-a', { status: 'dead', bucket: 'dead' })]), 'project-a');
    expect(c.cls).toBe('inactive');
    expect(c.collapsed).toBe(true);
    expect(c.lastActive).toBe(NOW - 5 * HOUR);
  });

  it('keeps a working project open', () => {
    const c = card(roll([sess('b1', 'project-b', { status: 'busy', bucket: 'working' })]), 'project-b');
    expect([c.cls, c.collapsed]).toEqual(['active', false]);
  });

  it('keeps a project open while its last change is inside the 30-minute window, and rolls it up after', () => {
    const quietSince = NOW - 20 * MIN;
    const s = [sess('a1', 'project-a', { bucket: 'done', bucketSince: quietSince, statusUpdatedAt: quietSince })];
    expect(card(roll(s), 'project-a').collapsed).toBe(false);
    expect(card(roll(s, [], NO_ROLLUP_PREFS, quietSince + 31 * MIN), 'project-a').collapsed).toBe(true);
  });

  it('keeps a project with a fault or a strand open', () => {
    const fault = sess('a1', 'project-a', { substrate: { at: NOW - 5 * HOUR, text: 'tmux unanswered' } });
    const strand = sess('d1', 'project-d', { stranded: { at: NOW - 5 * HOUR, reason: 'no account' } });
    const cards = roll([fault, strand]);
    expect(card(cards, 'project-a').cls).toBe('active');
    expect(card(cards, 'project-d').cls).toBe('active');
  });

  it('keeps a project open while a spawn is pending on it', () => {
    const coord = sess('coord', 'project-c');
    const spawn = run(9, 'coord', null, { state: 'planned', dispatchStartedAt: NOW - MIN });
    expect(card(roll([coord], [spawn]), 'project-c').cls).toBe('active');
  });

  it('never rolls up a project holding an operator-facing question, even against a stored collapse', () => {
    const { sessions, runs } = coordinatorFleet(asking());
    // Make everything else quiet, so only the question could keep it open.
    const quiet = sessions.map((s) => (s.id === 'w5' ? s : { ...s, status: 'idle' as const, bucket: 'idle' as const }));
    const prefs: RollupPrefs = { projects: { 'project-c': { collapsed: true, cls: 'active' } }, openChildren: [] };
    const c = card(roll(quiet, runs, prefs), 'project-c');
    expect(c.pinnedOpen).toBe(true);
    expect(c.collapsed).toBe(false);
  });
});

describe('rollup — the operator-facing predicate (rule 1)', () => {
  it('is the ladder\'s attention: an unheld question is, a held or answered one is not', () => {
    expect(operatorAsk(sess('x', 'p', asking()))).toBe(true);
    expect(operatorAsk(sess('x', 'p', heldByCoordinator()))).toBe(false);
    expect(operatorAsk(sess('x', 'p', answeredByCoordinator()))).toBe(false);
    // A killed pane that still carries the dialog flag is dead first (the ladder), never a question.
    expect(operatorAsk(sess('x', 'p', { dialogPending: true, status: 'dead', bucket: 'dead' }))).toBe(false);
  });
});

describe('rollup — children (rules 6 and 7)', () => {
  it('folds a coordinator\'s workers into one summary line', () => {
    const { sessions, runs } = coordinatorFleet({});
    const c = card(roll(sessions, runs), 'project-c');
    expect(shape(c.rows)).toEqual([['coord', 0], ['» 5 workers · 2 working · 3 idle', 1]]);
  });

  it('keeps an operator-facing child visible while its siblings fold, and counts it as needs you', () => {
    const { sessions, runs } = coordinatorFleet(asking());
    const c = card(roll(sessions, runs), 'project-c');
    expect(shape(c.rows)).toEqual([
      ['coord', 0], ['» 5 workers · 2 working · 2 idle · 1 needs you', 1], ['w5', 1],
    ]);
  });

  it('does not keep a child visible for a question its coordinator holds', () => {
    const { sessions, runs } = coordinatorFleet(heldByCoordinator());
    const c = card(roll(sessions, runs), 'project-c');
    expect(shape(c.rows)).toEqual([['coord', 0], ['» 5 workers · 3 working · 2 idle', 1]]);
  });

  it('does not keep a child visible for a question its coordinator answered', () => {
    const { sessions, runs } = coordinatorFleet(answeredByCoordinator());
    const c = card(roll(sessions, runs), 'project-c');
    expect(shape(c.rows)).toEqual([['coord', 0], ['» 5 workers · 2 working · 3 idle', 1]]);
  });

  it('counts a hibernated worker as asleep and a pending spawn as spawning', () => {
    const { sessions, runs } = coordinatorFleet({ status: 'dead', bucket: 'dead', hibernatedAt: NOW - HOUR });
    const spawn = run(30, 'coord', null, { state: 'planned', dispatchStartedAt: NOW - MIN });
    const c = card(roll(sessions, [...runs, spawn]), 'project-c');
    expect(c.rows[1]).toMatchObject({ kind: 'summary', text: '6 workers · 2 working · 2 idle · 1 asleep · 1 spawning' });
  });

  it('shows every worker under the line once the line is opened', () => {
    const { sessions, runs } = coordinatorFleet(asking());
    const prefs = toggleChildren(NO_ROLLUP_PREFS, 'coord');
    const c = card(roll(sessions, runs, prefs), 'project-c');
    expect(c.rows[1]).toMatchObject({ kind: 'summary', expanded: true });
    expect(shape(c.rows).slice(2).map(([id]) => id).sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    expect(toggleChildren(prefs, 'coord').openChildren).toEqual([]);
  });

  it('keeps the open session visible inside a fold', () => {
    const { sessions, runs } = coordinatorFleet({});
    const c = card(roll(sessions, runs, NO_ROLLUP_PREFS, NOW, 'w3'), 'project-c');
    expect(shape(c.rows)).toEqual([['coord', 0], ['» 5 workers · 2 working · 3 idle', 1], ['w3', 1]]);
  });

  it('leaves a lone child as its own row (D-6089)', () => {
    const coord = sess('coord', 'project-c', { status: 'busy', bucket: 'working' });
    const c = card(roll([coord, sess('w1', 'project-c')], [run(10, 'coord', 'w1')]), 'project-c');
    expect(shape(c.rows)).toEqual([['coord', 0], ['w1', 1]]);
  });
});

describe('rollup — the operator\'s own toggle (rule 4)', () => {
  const quiet = [sess('a1', 'project-a')];
  const busy = [sess('a1', 'project-a', { status: 'busy', bucket: 'working' })];

  it('sticks within the activity class it was made in', () => {
    const opened = toggleProject(NO_ROLLUP_PREFS, card(roll(quiet), 'project-a'), 'project-a');
    expect(card(roll(quiet, [], opened), 'project-a').collapsed).toBe(false);
    // Toggling back to the default removes the entry rather than storing it.
    const closed = toggleProject(opened, card(roll(quiet, [], opened), 'project-a'), 'project-a');
    expect(closed.projects).toEqual({});
  });

  it('is dropped when the class changes, so the default applies again', () => {
    const opened = toggleProject(NO_ROLLUP_PREFS, card(roll(quiet), 'project-a'), 'project-a');
    // The project wakes up: the stored "open while inactive" no longer applies…
    const woken = rollupFleet(fleetTree(busy, [], []), opened, NOW, null);
    expect(woken.cards.get('project-a')?.collapsed).toBe(false);
    const pruned = prunePrefs(opened, woken, new Set(['a1']));
    expect(pruned?.projects).toEqual({});
    // …and once it is quiet again, it rolls up by default.
    expect(card(roll(quiet, [], pruned ?? opened), 'project-a').collapsed).toBe(true);
  });

  it('a collapse of an active project does not survive it going quiet and waking again', () => {
    const shut = toggleProject(NO_ROLLUP_PREFS, card(roll(busy), 'project-a'), 'project-a');
    expect(card(roll(busy, [], shut), 'project-a').collapsed).toBe(true);
    const asleep = rollupFleet(fleetTree(quiet, [], []), shut, NOW, null);
    const pruned = prunePrefs(shut, asleep, new Set(['a1'])) ?? shut;
    expect(card(roll(busy, [], pruned), 'project-a').collapsed).toBe(false);
  });

  it('does nothing on a project held open by a question', () => {
    const { sessions, runs } = coordinatorFleet(asking());
    const c = card(roll(sessions, runs), 'project-c');
    expect(toggleProject(NO_ROLLUP_PREFS, c, 'project-c')).toBe(NO_ROLLUP_PREFS);
  });

  it('prunes nothing when nothing changed, and drops opened lines whose coordinator left', () => {
    const r = rollupFleet(fleetTree(quiet, [], []), NO_ROLLUP_PREFS, NOW, null);
    expect(prunePrefs(NO_ROLLUP_PREFS, r, new Set(['a1']))).toBeNull();
    const withGone = toggleChildren(NO_ROLLUP_PREFS, 'gone-coord');
    expect(prunePrefs(withGone, r, new Set(['a1']))?.openChildren).toEqual([]);
  });
});
