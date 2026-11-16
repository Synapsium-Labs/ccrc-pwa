// A re-open is a new run with a new id, and it leaves the programme's state alone (runs rebuild spec A27; wave B4 Task 14, D-8074).
// The group abandon closes a run for good; a later open of the same wave must not revive the programme, because reviving it
// would change `soleActiveCoordinator`'s answer for every other run.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));

const open = (s: CoordStore, program: string, wave: number): number => {
  const r = s.openRun({ program, title: `${program} title`, project: 'ccrc-pwa', wave, waveOf: 3, claimedBy: 'demo-coordinator' });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};

const programState = (s: CoordStore, slug: string): unknown =>
  (s.db.prepare('SELECT state FROM programs WHERE slug = ?').get(slug) as { state: string }).state;

describe('a re-open is a new id and leaves programs.state alone', () => {
  it('opening the same wave again after it closed mints a new run, and an archived programme stays archived', () => {
    const s = store();
    const first = open(s, 'build4', 1);
    expect(s.advance(first, 'failed', 'test-close').ok).toBe(true);
    s.db.prepare('UPDATE programs SET state = ? WHERE slug = ?').run('archived', 'build4');
    const again = open(s, 'build4', 1);
    expect(again).not.toBe(first);
    expect(programState(s, 'build4')).toBe('archived');
    // CONTROL: the first run stays closed; the new one is the only open run of the programme.
    expect((s.db.prepare('SELECT state FROM runs WHERE id = ?').get(first) as { state: string }).state).toBe('failed');
    expect((s.db.prepare('SELECT state FROM runs WHERE id = ?').get(again) as { state: string }).state).toBe('planned');
  });

  it('a retry of an open that is still planned reuses its id, so only a closed run is ever re-opened as new', () => {
    const s = store();
    const a = open(s, 'build5', 1);
    expect(open(s, 'build5', 1)).toBe(a);
  });
});
