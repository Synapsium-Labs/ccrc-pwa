// `CoordStore.openRunsClaimedBy` (workspace lifecycle spec §5.2): the runs a session COORDINATES, read for the archive
// door's `coordinator-has-open-runs` refusal and its `{programme:'end'}` act, against a real `coord.db`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));

const open = (s: CoordStore, program: string, wave: number, claimedBy = 'demo-coordinator'): number => {
  const r = s.openRun({ program, title: `${program} title`, project: 'ccrc-pwa', wave, waveOf: 3, claimedBy });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};

describe('CoordStore.openRunsClaimedBy', () => {
  it('answers this claimant\'s non-terminal runs, in id order, with the columns the refusal names', () => {
    const s = store();
    const a = open(s, 'lifecycle', 1);
    const b = open(s, 'lifecycle', 2);
    const other = open(s, 'elsewhere', 1, 'another-coordinator');
    const closed = open(s, 'over', 1);
    expect(s.advance(closed, 'failed', 'test-close').ok).toBe(true);
    expect(s.openRunsClaimedBy('demo-coordinator')).toEqual({
      ok: true,
      siblings: [
        { id: a, program: 'lifecycle', wave: 1, waveOf: 3 },
        { id: b, program: 'lifecycle', wave: 2, waveOf: 3 },
      ],
    });
    // CONTROL: the other claimant's run is a real open run — it is excluded by its column, not by its state.
    expect(s.openRunsClaimedBy('another-coordinator')).toEqual({
      ok: true, siblings: [{ id: other, program: 'elsewhere', wave: 1, waveOf: 3 }],
    });
  });

  it('keys on the CLAIMANT column — a run naming the session only as its worker is not one it coordinates', () => {
    const s = store();
    const r = open(s, 'lifecycle', 1, 'someone-else');
    s.bindSession(r, 'demo-coordinator');
    expect(s.openRunsClaimedBy('demo-coordinator')).toEqual({ ok: true, siblings: [] });
  });

  it('counts a row in a state this build cannot name as open — the terminal set is the only exclusion', () => {
    const s = store();
    const r = open(s, 'lifecycle', 1);
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('unknown', r);
    expect(s.openRunsClaimedBy('demo-coordinator')).toMatchObject({ ok: true, siblings: [{ id: r }] });
  });

  it('refuses the WHOLE read when one row cannot be represented — never a partial list', () => {
    const s = store();
    open(s, 'lifecycle', 1);
    s.db.prepare(
      'INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(4242, 'lifecycle', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3, 'ccrc-pwa', 'planned', 'demo-coordinator', Date.now());
    expect(s.openRunsClaimedBy('demo-coordinator')).toMatchObject({ ok: false, kind: 'run-unreadable' });
  });
});
