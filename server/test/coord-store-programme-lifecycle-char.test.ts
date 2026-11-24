// Programme lifecycle W1, task 1 (plan docs/superpowers/plans/2026-11-24-programme-lifecycle.md): CHARACTERIZATION of the
// store's programme facts as `main` had them before the lifecycle build, each row pinned on the old code first. Later
// tasks flip the rows they change, in their own commits, and each flipped row says so (`FLIPPED (task n)`).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-lifecycle-char-'), '.ccrc', 'coord.db')));

const open = (s: CoordStore, program: string, claimedBy: string, wave = 1) => {
  const r = s.openRun({ program, title: `wave ${wave}`, project: 'project-a', wave, waveOf: null, claimedBy });
  if (!('id' in r)) throw new Error(`open refused: ${JSON.stringify(r)}`);
  return r.id;
};
const closeDone = (s: CoordStore, id: number, program: string): void => {
  expect(s.advance(id, 'dispatched', 'coordinator').ok).toBe(true);
  expect(s.closeRun({ runId: id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null, program, viaClosing: true }))
    .toMatchObject({ ok: true });
};
const abandon = (s: CoordStore, id: number, program: string): void => {
  expect(s.closeRun({ runId: id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program, viaClosing: false }))
    .toMatchObject({ ok: true });
};
const stateOf = (s: CoordStore, slug: string): string | undefined =>
  (s.db.prepare('SELECT state FROM programs WHERE slug = ?').get(slug) as { state: string } | undefined)?.state;
const claimedByOf = (s: CoordStore, program: string): (string | null)[] =>
  (s.db.prepare('SELECT claimedBy FROM runs WHERE program = ? ORDER BY id').all(program) as { claimedBy: string | null }[]).map((r) => r.claimedBy);

describe('programme lifecycle characterization (main before the lifecycle build)', () => {
  it('openRun creates the programme row once, stored active', () => {
    const s = store();
    open(s, 'programme-a', 'lane-a-one');
    open(s, 'programme-a', 'lane-a-one', 2);
    expect(s.db.prepare("SELECT count(*) AS c FROM programs WHERE slug = 'programme-a'").get()).toEqual({ c: 1 });
    expect(stateOf(s, 'programme-a')).toBe('active');
  });

  it('closing the last run leaves the programme stored active (FLIPPED (task 5): D-51 retired it to done)', () => {
    const s = store();
    const id = open(s, 'programme-a', 'lane-a-one');
    closeDone(s, id, 'programme-a');
    expect(stateOf(s, 'programme-a')).toBe('active');
  });

  it('a failed last run leaves the programme stored active (FLIPPED (task 5): D-51 retired it to abandoned)', () => {
    const s = store();
    const id = open(s, 'programme-a', 'lane-a-one');
    abandon(s, id, 'programme-a');
    expect(stateOf(s, 'programme-a')).toBe('active');
  });

  it('programmeLive reads the decision: an ended state is not live (FLIPPED (task 6): it read planEnd alone)', () => {
    const s = store();
    open(s, 'programme-a', 'lane-a-one');
    expect(s.programmeLive('programme-a')).toBe(true);
    s.db.prepare("UPDATE programs SET state = 'done' WHERE slug = 'programme-a'").run();
    expect(s.programmeLive('programme-a')).toBe(false);
    expect(s.programmeLive('programme-absent')).toBe(false);
  });

  it('soleActiveCoordinator answers the one active programme\'s claimant, and null for two', () => {
    const s = store();
    const a = open(s, 'programme-a', 'lane-a-one');
    expect(s.advance(a, 'dispatched', 'coordinator').ok).toBe(true);
    expect(s.soleActiveCoordinator()).toBe('lane-a-one');
    const b = open(s, 'programme-b', 'lane-a-two');
    expect(s.advance(b, 'dispatched', 'coordinator').ok).toBe(true);
    expect(s.soleActiveCoordinator()).toBeNull();
  });

  it('claimsProgramme keeps an Idle programme\'s owner (FLIPPED (task 8): it read open runs, so a closed last run lost it)', () => {
    const s = store();
    const id = open(s, 'programme-a', 'lane-a-one');
    expect(s.claimsProgramme('lane-a-one', 'programme-a')).toBe(true);
    closeDone(s, id, 'programme-a');
    expect(s.claimsProgramme('lane-a-one', 'programme-a')).toBe(true);
    expect(s.claimsProgramme('lane-a-two', 'programme-a')).toBe(false);
  });

  it('reclaimProgram moves claimedBy on every claimed run of the programme, finished ones included (D-8199)', () => {
    const s = store();
    const one = open(s, 'programme-a', 'lane-a-one');
    closeDone(s, one, 'programme-a');
    open(s, 'programme-a', 'lane-a-one', 2);
    const r = s.reclaimProgram(one, 'lane-a-two', Date.now(), 'project-a');
    expect(r).toMatchObject({ ok: true, program: 'programme-a', from: 'lane-a-one' });
    expect(claimedByOf(s, 'programme-a')).toEqual(['lane-a-two', 'lane-a-two']);
  });

  it('a release (to null) clears claimedBy on every claimed run', () => {
    const s = store();
    const one = open(s, 'programme-a', 'lane-a-one');
    open(s, 'programme-a', 'lane-a-one', 2);
    expect(s.reclaimProgram(one, null, Date.now(), null)).toMatchObject({ ok: true });
    expect(claimedByOf(s, 'programme-a')).toEqual([null, null]);
  });

  it('openRun refuses one session a second programme (FLIPPED (task 7): main admitted it, the case R11 refuses)', () => {
    const s = store();
    open(s, 'programme-a', 'lane-a-one');
    const second = s.openRun({ program: 'programme-b', title: 'wave 1', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a-one' });
    expect(second).toMatchObject({ refused: 'owns-another-programme', by: 'programme-a' });
  });
});
